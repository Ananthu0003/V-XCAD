"""CAD Copilot V2 - /api/v1 router."""
from __future__ import annotations

import asyncio
import json
import os
import re
from pathlib import Path
from typing import Any

import uuid
import io
import gc
from fastapi import APIRouter, File, Form, HTTPException, UploadFile, BackgroundTasks
from fastapi.responses import FileResponse, StreamingResponse
from app.models.schemas import GenerateResponse, EditRequest, StepRequest, RenderRequest, RenderResponse, RenderArtifacts
from app.services.csg_parser import CSGParser, export_to_step
from app.services.llm_codegen import LLMCodegenService
from app.services.parameter_render import ParameterRenderService

router = APIRouter(tags=["cad"])

_ALLOWED_MIME_PREFIXES = ("image/",)
_ALLOWED_MIME_EXACT   = {"application/pdf"}
_DEFAULT_MODEL = os.getenv("GENAI_MODEL", "gemini-3.5-flash")


import ast

def _extract_parameters(script: str) -> dict[str, Any]:
    """Pull the PARAMETERS block out of the generated script."""
    m = re.search(r"^\s*PARAMETERS\s*(?::[^=\n]+)?\s*=\s*(\{.*)", script, re.M | re.S)
    if m:
        try:
            val = m.group(1)
            brace_count = 0
            end_idx = -1
            for i, c in enumerate(val):
                if c == '{': brace_count += 1
                elif c == '}':
                    brace_count -= 1
                    if brace_count == 0:
                        end_idx = i
                        break
            if end_idx != -1:
                dict_str = val[:end_idx+1]
                parsed = ast.literal_eval(dict_str)
                if isinstance(parsed, dict):
                    return parsed
        except Exception as e:
            print(f"[_extract_parameters] Failed to parse: {e}")
            pass
    return {}

def _extract_metadata(script: str) -> dict[str, Any]:
    """Pull the PARAMETER_METADATA block out of the generated script."""
    m = re.search(r"^\s*PARAMETER_METADATA\s*(?::[^=\n]+)?\s*=\s*(\{.*)", script, re.M | re.S)
    if m:
        try:
            val = m.group(1)
            brace_count = 0
            end_idx = -1
            for i, c in enumerate(val):
                if c == '{': brace_count += 1
                elif c == '}':
                    brace_count -= 1
                    if brace_count == 0:
                        end_idx = i
                        break
            if end_idx != -1:
                dict_str = val[:end_idx+1]
                parsed = ast.literal_eval(dict_str)
                if isinstance(parsed, dict):
                    return parsed
        except Exception as e:
            print(f"[_extract_metadata] Failed to parse: {e}")
            pass
    return {}

def _resolve_mime(content_type: str, filename: str) -> str | None:
    """Return the canonical MIME type or None if unsupported."""
    ct = (content_type or "").lower().split(";")[0].strip()
    if ct in _ALLOWED_MIME_EXACT:
        return ct
    if any(ct.startswith(p) for p in _ALLOWED_MIME_PREFIXES):
        return ct
    # Fallback: infer from extension
    if filename.lower().endswith(".pdf"):
        return "application/pdf"
    return None


def _sanitize_script(script: str) -> str:
    """
    Basic cleanup for generated python build123d code.
    """
    if not script:
        return script
    return script

    # -- Guard 4: Strip BOSL2 includes -----------------------------------------
    script = re.sub(r'include\s*<BOSL2/.*?>;?', '', script, flags=re.I)

    # -- Guard 1: cap every $fn value that exceeds 32 --------------------------
    FN_CAP = 32

    def _cap_fn(match: re.Match) -> str:
        val = int(match.group(1))
        capped = min(val, FN_CAP)
        return match.group(0).replace(match.group(1), str(capped))

    script = re.sub(r'\$fn\s*=\s*(\d+)', _cap_fn, script)

    # -- Guard 2: inject $fn = 32 if entirely absent ---------------------------
    if "$fn" not in script:
        script = "$fn = 32;\n\n" + script

    # -- Guard 3: inject eps = 0.02 if difference() exists but eps is absent --
    has_difference = "difference()" in script
    has_eps        = re.search(r'\beps\s*=', script) is not None

    if has_difference and not has_eps:
        if "// PARAMETERS_START" in script:
            script = script.replace(
                "// PARAMETERS_START",
                "// PARAMETERS_START\neps = 0.02;  // CGAL crash prevention",
                1,
            )
        else:
            # Fallback: inject before the first module or difference() block
            script = re.sub(
                r'(\bmodule\b|\bdifference\(\))',
                r'eps = 0.02;  // CGAL crash prevention\n\n\1',
                script,
                count=1,
            )

    return script

@router.post("/generate")
async def generate(
    prompt: str = Form(...),
    model_name: str = Form(_DEFAULT_MODEL, alias="model"),
    image: UploadFile = File(None),
    base_code: str | None = Form(None),
    selection_context: str | None = Form(None),
) -> StreamingResponse:
    """
    Two-stage CAD generation pipeline:
      1. Audit blueprint image/PDF  →  structured feature-map JSON
      2. Synthesise/refine OpenSCAD script via BOSL2 codegen (Streamed)
    `image` is optional for text-only refinement sessions.
    """
    # ── Validate & read uploaded file ────────────────────────────────────────
    image_bytes: bytes | None = None
    mime_type: str | None = None

    if image and image.filename:
        mime_type = _resolve_mime(image.content_type or "", image.filename)
        if mime_type is None:
            raise HTTPException(
                status_code=400,
                detail={"error": {"message": "File must be an image (PNG/JPEG/WEBP) or PDF."}},
            )
        image_bytes = await image.read()

    # ── Initialise service ────────────────────────────────────────────────────
    try:
        svc = LLMCodegenService(model=model_name)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail={"error": {"message": str(exc)}})

    # ── Stage 1: Blueprint Audit (skip if no image) ──────────────────────────
    feature_map: dict[str, Any] = {}
    if image_bytes and mime_type:
        try:
            feature_map = await asyncio.to_thread(
                svc.audit_blueprint, image_bytes, mime_type
            )
        except Exception as exc:
            # Non-fatal: proceed with empty feature map
            print(f"[audit] failed — {exc}")

    async def stream_generator():
        # Send initial status
        yield f'data: {json.dumps({"status": "starting generation"})}\n\n'

        full_script = ""
        try:
            # ── Stage 2: Script Generation / Refinement ───────────────────────────────
            async for chunk_text in svc.generate_script_stream(
                prompt=prompt,
                image_bytes=image_bytes,
                mime_type=mime_type,
                feature_map=feature_map,
                base_code=base_code,
                selection_context=selection_context,
            ):
                full_script += chunk_text
                # stream token
                yield f'data: {json.dumps({"chunk": chunk_text})}\n\n'

            # ── Server-side safety net ────────────────────────────────────────────────
            clean_script = LLMCodegenService._normalize_script(full_script)
            clean_script = _sanitize_script(clean_script)
            params = _extract_parameters(clean_script)
            metadata = _extract_metadata(clean_script)
            
            # send final script and parameters
            yield f'data: {json.dumps({"script": clean_script, "parameters": params, "metadata": metadata})}\n\n'
            
        except Exception as exc:
            print(f"[generate stream] error: {exc}")
            yield f'data: {json.dumps({"error": {"message": str(exc), "hint": "Check API key and quota."}})}\n\n'

    return StreamingResponse(stream_generator(), media_type="text/event-stream")


@router.post("/edit", response_model=GenerateResponse)
async def edit(request: EditRequest) -> GenerateResponse:
    """
    Surgically edit an existing OpenSCAD script.
    """
    try:
        svc = LLMCodegenService(model=request.model)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail={"error": {"message": str(exc)}})

    try:
        script = await asyncio.to_thread(
            svc.edit_script,
            prompt=request.prompt,
            current_code=request.current_code,
            target_point=request.target_point,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail={"error": {"message": str(exc), "hint": "Check API key and quota."}},
        )

    # Server-side safety net
    script = _sanitize_script(script)

    return GenerateResponse(
        openscad_script=script,
        parameters=_extract_parameters(script),
        metadata=_extract_metadata(script),
    )


def _cleanup_file(path: Path):
    try:
        if path.exists():
            path.unlink()
    except Exception:
        pass


@router.post("/step")
async def export_step(request: StepRequest, background_tasks: BackgroundTasks) -> FileResponse:
    """
    Convert flat CSG tree into a parametric STEP model.
    """
    try:
        shape = CSGParser.parse(request.csg_tree)
        
        # Create unique file path in outputs directory
        outputs_dir = Path(__file__).resolve().parents[3] / "outputs"
        outputs_dir.mkdir(exist_ok=True)
        
        step_filename = f"model_{uuid.uuid4().hex}.step"
        step_path = outputs_dir / step_filename
        
        export_to_step(shape, str(step_path))
        
        background_tasks.add_task(_cleanup_file, step_path)
        
        return FileResponse(
            path=step_path,
            media_type="application/octet-stream",
            filename="generated_model.step"
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail={"error": {"message": f"STEP conversion failed: {exc}"}}
        )


@router.post("/export-step")
async def export_step_stream(request: StepRequest) -> StreamingResponse:
    """
    Convert flat CSG tree into a parametric STEP model and stream in-memory.
    """
    from app.services.export_utils import build123d_to_step_bytes
    
    try:
        shape = CSGParser.parse(request.csg_tree)
        step_bytes = build123d_to_step_bytes(shape)
        
        bio = io.BytesIO(step_bytes)
        return StreamingResponse(
            bio,
            media_type="application/step",
            headers={"Content-Disposition": "attachment; filename=model.step"}
        )
    except Exception as exc:
        import traceback
        log_path = Path(__file__).resolve().parents[3] / "error.log"
        try:
            with open(log_path, "w") as f:
                traceback.print_exc(file=f)
                f.write("\n\n--- CSG TREE ---\n")
                f.write(request.csg_tree)
        except Exception:
            pass
        raise HTTPException(
            status_code=400,
            detail=str(exc)
        )
    finally:
        gc.collect()


@router.post("/render", response_model=RenderResponse)
async def render(
    request: RenderRequest,
) -> RenderResponse:
    """
    Execute a build123d Python script with the given parameters and export
    STL / STEP / DXF / G-code artifacts. Returns URLs the browser can fetch.
    """
    session_id = request.session_id or uuid.uuid4().hex
    output_basename = f"cad_{session_id}"

    svc = ParameterRenderService()
    try:
        result = await svc.render_to_outputs(
            parameters=request.parameters,
            script=request.python_script,
            output_basename=output_basename,
            cam_parameters=request.cam_parameters,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail={"error": {"message": str(exc)}},
        )
    except RuntimeError as exc:
        raise HTTPException(
            status_code=500,
            detail={"error": {"message": str(exc)}},
        )

    # Build artifact URLs — the outputs directory is mounted as /outputs
    def _url(path_str: str | None) -> str | None:
        if not path_str:
            return None
        fname = Path(path_str).name
        return f"/outputs/{fname}"

    artifacts = RenderArtifacts(
        stl_url=_url(result.get("stl_path")),
        step_url=_url(result.get("step_path")),
        dxf_url=_url(result.get("dxf_path")),
        gcode_url=_url(result.get("gcode_path")),
        gcode_content=result.get("gcode_content"),
        toolpaths=result.get("toolpaths"),
        annotations=result.get("annotations"),
    )

    return RenderResponse(
        status="ok",
        session_id=session_id,
        artifacts=artifacts,
    )


@router.post("/import_step")
async def import_step(file: UploadFile = File(...)):
    """
    Import a STEP file directly. Saves it to outputs, generates a tiny build123d wrapper script,
    and passes it through the parameter_render pipeline to extract features and STL.
    """
    if not file.filename.lower().endswith(('.step', '.stp')):
        raise HTTPException(status_code=400, detail="File must be a .step or .stp file")
        
    # Save the uploaded STEP file
    import uuid
    session_id = f"import_{uuid.uuid4().hex[:8]}"
    step_filename = f"src_{session_id}.step"
    step_path = Path("outputs") / step_filename
    step_path.parent.mkdir(parents=True, exist_ok=True)
    
    step_bytes = await file.read()
    with open(step_path, "wb") as f:
        f.write(step_bytes)
        
    # Generate wrapper python script
    # This script simply imports the STEP file as `part` so the render pipeline can process it
    abs_step_path = step_path.absolute().as_posix()
    wrapper_script = f"""import build123d as bd

# Imported STEP File
imported = bd.import_step(r"{abs_step_path}")
if hasattr(imported, "part"):
    part = imported.part
else:
    part = imported
"""
    
    try:
        # Run the render pipeline
        render_svc = ParameterRenderService()
        result = await render_svc.render_to_outputs(
            parameters={},
            script=wrapper_script,
            output_basename=session_id,
            cam_parameters={"cam_setup": {}, "cam_operations": []}
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail={"error": {"message": str(exc)}},
        )

    def _url(path_str: str | None) -> str | None:
        if not path_str:
            return None
        fname = Path(path_str).name
        return f"/outputs/{fname}"

    artifacts = RenderArtifacts(
        stl_url=_url(result.get("stl_path")),
        step_url=_url(result.get("step_path")),
        dxf_url=_url(result.get("dxf_path")),
        gcode_url=_url(result.get("gcode_path")),
        gcode_content=result.get("gcode_content"),
        toolpaths=result.get("toolpaths"),
        annotations=result.get("annotations"),
    )

    return {
        "status": "ok",
        "session_id": session_id,
        "script": wrapper_script,
        "artifacts": artifacts.model_dump()
    }


# --- Legacy endpoints for frontend compatibility ---
from fastapi import APIRouter
import uuid
import json
from pathlib import Path

JOBS_DIR = Path("storage/jobs")

@router.post("/upload")
async def legacy_upload(file: UploadFile = File(...)):
    job_id = f"job_{uuid.uuid4().hex[:8]}"
    job_dir = JOBS_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    
    file_path = job_dir / file.filename
    with open(file_path, "wb") as buffer:
        buffer.write(await file.read())
        
    return {"job_id": job_id}

@router.post("/generate/{job_id}")
async def legacy_generate(job_id: str):
    job_dir = JOBS_DIR / job_id
    if not job_dir.exists():
        raise HTTPException(status_code=404, detail="Job not found")

    image_files = [
        f for f in job_dir.iterdir()
        if f.suffix.lower() in [".png", ".jpg", ".jpeg", ".pdf"]
    ]

    if not image_files:
        raise HTTPException(status_code=404, detail="No blueprint file found")

    image_file = image_files[0]
    image_bytes = image_file.read_bytes()
    mime_type = _resolve_mime(image_file.suffix, image_file.name) or "image/png"

    # Use the new LLMCodegenService
    svc = LLMCodegenService()
    
    # Extract feature graph (Audit phase)
    features = await asyncio.to_thread(svc.audit_blueprint, image_bytes, mime_type)
    
    # Save feature graph to disk
    output_file = job_dir / "feature_graph.json"
    output_file.write_text(json.dumps(features, indent=2), encoding="utf-8")

    # Generate build123d code (Codegen phase)
    prompt = "Create a parametric build123d model based on the extracted features."
    script = await asyncio.to_thread(
        svc.generate_script,
        prompt=prompt,
        image_bytes=image_bytes,
        mime_type=mime_type,
        feature_map=features,
    )
    
    script = _sanitize_script(script)
    
    # Save script to disk
    script_file = job_dir / "model.py"
    script_file.write_text(script, encoding="utf-8")

    return {
        "job_id": job_id,
        "features": features,
        "script": script
    }
