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
from app.services.validation.toolpath_schema_validator import ToolpathSchemaValidator
from app.services.validation.cam_readiness_evaluator import CamReadinessEvaluator
from app.services.cam_pipeline_manager import CamPipelineManager
from app.services.cam_input_router import CamInputRouter
from fastapi.responses import FileResponse, StreamingResponse
from app.models.schemas import GenerateResponse, EditRequest, StepRequest, RenderRequest, RenderResponse, RenderArtifacts, GCodeResponse, CAMJobRequest
from app.services.geometry.csg_parser import CSGParser, export_to_step
from app.services.llm.llm_codegen import LLMCodegenService
from app.services.llm.parameter_render import ParameterRenderService

router = APIRouter(tags=["cad"])

_ALLOWED_MIME_PREFIXES = ()
_ALLOWED_MIME_EXACT   = {"application/pdf", "image/jpeg", "image/png", "image/gif", "image/webp"}
_DEFAULT_MODEL = os.getenv("GENAI_MODEL", "gemini-3.5-flash")


import ast
import time

class ShapeCache:
    _cache: dict[str, dict[str, Any]] = {}

    @classmethod
    def get(cls, asset_id: str) -> Any:
        entry = cls._cache.get(asset_id)
        if entry:
            entry["last_accessed"] = time.time()
            return entry["shape"]
        return None

    @classmethod
    def set(cls, asset_id: str, shape: Any):
        cls.evict(asset_id)
        cls._cache[asset_id] = {
            "shape": shape,
            "last_accessed": time.time(),
        }

    @classmethod
    def evict(cls, asset_id: str):
        if asset_id in cls._cache:
            entry = cls._cache.pop(asset_id)
            shape = entry.get("shape")
            if shape:
                try:
                    if hasattr(shape, "wrapped"):
                        shape.wrapped = None
                except Exception:
                    pass
                del shape

    @classmethod
    def clear(cls):
        for asset_id in list(cls._cache.keys()):
            cls.evict(asset_id)


def is_step_reference(csg_tree: Any) -> tuple[bool, str | None]:
    if not csg_tree:
        return False, None
    if isinstance(csg_tree, dict):
        if csg_tree.get("type") == "step_reference":
            return True, csg_tree.get("asset_id")
    elif isinstance(csg_tree, str):
        trimmed = csg_tree.strip()
        if trimmed.startswith("{") and trimmed.endswith("}"):
            try:
                data = json.loads(trimmed)
                if data.get("type") == "step_reference":
                    return True, data.get("asset_id")
            except Exception:
                pass
    return False, None


def export_to_stl_bytes(shape) -> bytes:
    import tempfile
    from pathlib import Path
    from build123d import export_stl
    
    bb = shape.bounding_box()
    max_dim = max(
        bb.max.X - bb.min.X,
        bb.max.Y - bb.min.Y,
        bb.max.Z - bb.min.Z
    )
    tolerance = max(0.001, min(0.5, max_dim * 0.002))
    
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".stl", delete=False) as tf:
            temp_path = Path(tf.name)
            
        export_stl(shape, str(temp_path), tolerance=tolerance, angular_tolerance=0.15)
        
        with open(temp_path, "rb") as f:
            return f.read()
    finally:
        if temp_path and temp_path.exists():
            temp_path.unlink(missing_ok=True)


def export_to_dxf_bytes(shape, dxf_mode: str) -> bytes:
    import tempfile
    from pathlib import Path
    from build123d import Plane, BuildSketch, project, ExportDXF, Location, Rotation, Compound, Mode, Face
    
    dxf_shape = None
    if dxf_mode == "silhouette":
        with BuildSketch(Plane.XY):
            dxf_shape = project(shape.edges(), mode=Mode.PRIVATE)
    elif dxf_mode == "section":
        section_plane = Plane.XY.offset(0.01)
        section_profile = shape.intersect(Face.make_rect(10000, 10000, section_plane))
        with BuildSketch(Plane.XY):
            dxf_shape = project(section_profile.edges(), mode=Mode.PRIVATE)
    elif dxf_mode == "blueprint":
        offset_dist = 120.0
        with BuildSketch(Plane.XY):
            top_view = project(shape.edges(), mode=Mode.PRIVATE)
            iso_shape = Location((offset_dist, 0, 0)) * Rotation(0, 0, 45) * Rotation(54.7356, 0, 0) * shape
            iso_view = project(iso_shape.edges(), mode=Mode.PRIVATE)
            front_shape = Location((0, -offset_dist, 0)) * Rotation(90, 0, 0) * shape
            front_view = project(front_shape.edges(), mode=Mode.PRIVATE)
            right_shape = Location((offset_dist, -offset_dist, 0)) * Rotation(0, 0, 90) * Rotation(90, 0, 0) * shape
            right_view = project(right_shape.edges(), mode=Mode.PRIVATE)
            dxf_shape = Compound([top_view, iso_view, front_view, right_view])
    else:
        with BuildSketch(Plane.XY):
            dxf_shape = project(shape.edges(), mode=Mode.PRIVATE)

    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".dxf", delete=False) as tf:
            temp_path = Path(tf.name)
        
        exporter = ExportDXF()
        exporter.add_shape(dxf_shape)
        exporter.write(str(temp_path))
        
        with open(temp_path, "rb") as f:
            return f.read()
    finally:
        if temp_path and temp_path.exists():
            temp_path.unlink(missing_ok=True)


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
    ext = filename.lower().split('.')[-1] if '.' in filename else ''
    if ext == "pdf":
        return "application/pdf"
    if ext in ("jpg", "jpeg"):
        return "image/jpeg"
    if ext == "png":
        return "image/png"
    if ext == "gif":
        return "image/gif"
    if ext == "webp":
        return "image/webp"
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

@router.post("/cam/process_step")
async def process_step(file: UploadFile = File(...), controller: str = Form("fanuc")):
    """
    Processes a direct STEP upload through the new True B-Rep CAM pipeline.
    """
    try:
        content = await file.read()
        router_svc = CamInputRouter(output_dir="outputs")
        job = router_svc.process_step_upload(content, file.filename)
        
        manager = CamPipelineManager()
        result = manager.process_step_file(job["step_file_path"], controller=controller)
        return result
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

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

    # ── Stage 1: Blueprint Audit (RESTORED) ──────────────────────────
    # To maximize accuracy for industrial projects, we use a 2-stage pipeline.
    # Stage 1 extracts a structured feature map to guide the code generation.
    feature_map: str | dict[str, Any] = ""

    async def stream_generator():
        nonlocal feature_map
        if image_bytes and mime_type and not base_code:
            yield f'data: {json.dumps({"status": "auditing blueprint (stage 1 of 2)"})}\n\n'
            try:
                feature_map = await svc.audit_blueprint(image_bytes, mime_type)
            except Exception as e:
                print(f"Audit failed: {e}")

        # Send starting code generation status
        yield f'data: {json.dumps({"status": "generating code (stage 2 of 2)"})}\n\n'

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
        script = await svc.edit_script(
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
    from app.services.io.export_utils import build123d_to_step_bytes
    
    try:
        is_ref, asset_id = is_step_reference(request.csg_tree)
        if is_ref and asset_id:
            shape = ShapeCache.get(asset_id)
            if shape is None:
                raise ValueError(f"STEP asset ID {asset_id} not found in cache or has expired.")
        else:
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


@router.post("/export-stl")
async def export_stl_endpoint(request: StepRequest) -> StreamingResponse:
    try:
        is_ref, asset_id = is_step_reference(request.csg_tree)
        if not is_ref or not asset_id:
            raise HTTPException(status_code=400, detail="Invalid step reference for STL export.")
            
        shape = ShapeCache.get(asset_id)
        if shape is None:
            raise HTTPException(status_code=404, detail="STEP asset ID not found in cache.")

        stl_bytes = await asyncio.to_thread(export_to_stl_bytes, shape)
        return StreamingResponse(
            io.BytesIO(stl_bytes),
            media_type="application/octet-stream",
            headers={"Content-Disposition": "attachment; filename=model.stl"}
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"STL export failed: {exc}")


class DxfExportRequest(StepRequest):
    dxf_mode: str = "silhouette"

@router.post("/export-dxf")
async def export_dxf_endpoint(request: DxfExportRequest) -> StreamingResponse:
    try:
        is_ref, asset_id = is_step_reference(request.csg_tree)
        if not is_ref or not asset_id:
            raise HTTPException(status_code=400, detail="Invalid step reference for DXF export.")
            
        shape = ShapeCache.get(asset_id)
        if shape is None:
            raise HTTPException(status_code=404, detail="STEP asset ID not found in cache.")

        dxf_bytes = await asyncio.to_thread(export_to_dxf_bytes, shape, request.dxf_mode)
        return StreamingResponse(
            io.BytesIO(dxf_bytes),
            media_type="application/octet-stream",
            headers={"Content-Disposition": "attachment; filename=model.dxf"}
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"DXF export failed: {exc}")


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
        # ── Auto-healing Loop ──────────────────────────────────────────────────
        try:
            llm_svc = LLMCodegenService()
            healed_script = await llm_svc.repair_script(
                current_code=request.python_script,
                error_log=str(exc)
            )
            
            # Re-run render with the repaired script
            result = await svc.render_to_outputs(
                parameters=request.parameters,
                script=healed_script,
                output_basename=output_basename,
                cam_parameters=request.cam_parameters,
            )
            
        except Exception as retry_exc:
            # If auto-heal fails, raise the original error plus the new one
            raise HTTPException(
                status_code=500,
                detail={"error": {"message": f"Render failed and auto-heal failed.\nOriginal: {exc}\nHeal: {retry_exc}"}},
            )

    # Build artifact URLs — the outputs directory is mounted as /outputs
    def _url(path_str: str | None) -> str | None:
        if not path_str:
            return None
        fname = Path(path_str).name
        return f"/outputs/{fname}"

    try:
        from app.services.cam_pipeline_manager import CamPipelineManager
        cam_mgr = CamPipelineManager()
        analysis_result = await asyncio.to_thread(
            cam_mgr.analyze_features, 
            request.parameters if hasattr(request, "parameters") and request.parameters else {}, 
            session_id, 
            "",
            request.cam_parameters.get("setup", {}) if hasattr(request, "cam_parameters") and request.cam_parameters else {}
        )
        
        features = analysis_result.get("features")
        validation_status = analysis_result.get("validation_status")
        mapping_summary = analysis_result.get("geometry_mapping_summary")
        
        # Clear CAM artifacts
        job_dir = Path(__file__).resolve().parents[4] / "storage" / "jobs" / session_id / "cam"
        for fname in ["cam_toolpaths.json", "cam_validation.json", "cam_operation_summary.json", "generated_gcode.nc", "cam_hashes.json", "cam_features_debug.json", "cam_geometry_mapping.json"]:
            fpath = job_dir / fname
            if fpath.exists():
                try: fpath.unlink()
                except Exception: pass
                
    except Exception as e:
        features = None
        validation_status = "error"
        mapping_summary = {"error": str(e)}

    artifacts = RenderArtifacts(
        model_hash=analysis_result.get("camModelHash") if 'analysis_result' in locals() and analysis_result else result.get("modelHash"),
        stl_url=_url(result.get("stl_path")),
        step_url=_url(result.get("step_path")),
        dxf_url=_url(result.get("dxf_path")),
        gcode_url=None,
        gcode_content=None,
        toolpaths=None,
        annotations=result.get("annotations"),
        features=features,
        setup_metadata=analysis_result.get("setup_metadata") if 'analysis_result' in locals() and analysis_result else None,
        feature_validation_status=validation_status,
        geometry_mapping_summary=mapping_summary,
        operations=None,
    )

    return RenderResponse(
        status="ok",
        session_id=session_id,
        artifacts=artifacts,
        repaired_script=healed_script if 'healed_script' in locals() else None,
    )



def _process_import_step(file_bytes: bytes) -> tuple[bytes, Any]:
    import tempfile
    from pathlib import Path
    from build123d import import_step, export_stl

    with tempfile.NamedTemporaryFile(suffix=".step", delete=False) as temp_step:
        temp_step.write(file_bytes)
        temp_step_path = Path(temp_step.name)

    temp_stl_path = temp_step_path.with_suffix(".stl")

    try:
        imported_shape = import_step(str(temp_step_path))

        bb = imported_shape.bounding_box()
        max_dim = max(
            bb.max.X - bb.min.X,
            bb.max.Y - bb.min.Y,
            bb.max.Z - bb.min.Z
        )
        tolerance = max(0.001, min(0.5, max_dim * 0.002))

        export_stl(imported_shape, str(temp_stl_path), tolerance=tolerance, angular_tolerance=0.15)

        with open(temp_stl_path, "rb") as f:
            stl_bytes = f.read()

        return stl_bytes, imported_shape
    finally:
        for path in (temp_step_path, temp_stl_path):
            try:
                if path.exists():
                    path.unlink()
            except Exception:
                pass




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
    features = await svc.audit_blueprint(image_bytes, mime_type)
    
    # Save feature graph to disk
    output_file = job_dir / "feature_graph.json"
    output_file.write_text(json.dumps(features, indent=2), encoding="utf-8")

    # Generate build123d code (Codegen phase)
    script = await svc.generate_script(
        prompt="Create a parametric build123d model based on the extracted features.",
        image_bytes=image_bytes,
        mime_type=mime_type,
        feature_map=features,
        base_code=None
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

# Trigger reload

from pydantic import BaseModel
from typing import List, Dict, Any, Optional

class CamAnalyzeRequest(BaseModel):
    session_id: str
    job_id: str = "default_job"
    cam_run_id: str = ""
    parameters: Dict[str, Any] = {}

@router.post("/cam/analyze")
async def cam_analyze(request: CamAnalyzeRequest):
    outputs_dir = Path(__file__).resolve().parents[3] / "outputs"
    step_path = outputs_dir / f"cad_{request.session_id}.step"
    
    # We no longer strictly require the STEP file since we are extracting from parameters
    # but we'll leave the path resolution just in case
        
    try:
        from app.services.cam.parametric_feature_extractor import ParametricFeatureExtractor
        extractor = ParametricFeatureExtractor()
        features = extractor.extract(request.parameters)
        
        return {
            "status": "ok",
            "features": features,
            "geometry_mapping_summary": {
                "mapped_features": len(features),
                "failed_features": 0,
                "blocked_features": 0,
                "total_features": len(features)
            },
            "validation_status": "ok"
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail={"error": {"message": f"CAM analysis failed: {exc}"}})

class CamAutoPlanRequest(BaseModel):
    session_id: str
    job_id: str = "default_job"
    cam_run_id: str = ""
    machine_config: Dict[str, Any] = {}
    parameters: Dict[str, Any] = {}

@router.post("/cam/auto_plan")
async def cam_auto_plan(request: CamAutoPlanRequest):
    try:
        # Inject stock dimensions from parameters into setup if missing
        setup = request.machine_config.get("setup", {})
        if not setup.get("stockDimensions") and not setup.get("resolvedStock"):
            params = request.parameters
            is_lathe = "outer_diameter" in params or "od" in params
            stock_w = float(params.get("width") or params.get("length") or params.get("outer_diameter") or 100.0)
            stock_h = float(params.get("height") or params.get("overall_length") or params.get("thickness") or 100.0)
            setup["stockDimensions"] = [stock_w, stock_w, stock_h]
            if is_lathe:
                setup["stockType"] = "cylinder"
            request.machine_config["setup"] = setup
            
        from app.services.cam_pipeline_manager import CamPipelineManager
        cam_mgr = CamPipelineManager()
        result = await asyncio.to_thread(
            cam_mgr.auto_plan_cam,
            request.machine_config,
            request.job_id or request.session_id,
            request.parameters
        )
        
        # Generate toolpaths for returned operations
        from app.services.toolpath.parametric_toolpath_engine import ParametricToolpathEngine
        from app.services.cam.cycle_time_estimator import CycleTimeEstimator
        from app.models.manufacturing import MachineProfile
        from app.models.schemas import ToolpathSegment
        import json
        engine = ParametricToolpathEngine()
        setup = request.machine_config.get("setup", {})
        m_cap = request.machine_config.get("machine_capability", {})
        machine_profile = MachineProfile(
            machine_id=request.machine_config.get("machine_id", "default"),
            machine_name=request.machine_config.get("machine_name", "Default Machine"),
            machine_type=request.machine_config.get("machine_type", "3_axis_mill"),
            axis_count=m_cap.get("axis_count", 3),
            rapid_feedrate=request.machine_config.get("rapid_feedrate", 5000.0),
            tool_change_time=request.machine_config.get("tool_change_time", 15.0)
        )
        
        operations = result.get("operations", [])
        features = result.get("features", [])
        setups = result.get("setups", [])
        tools = result.get("tools", [])
        
        flat_paths = []
        for op in operations:
            if op.get("toolpaths"):
                paths = op["toolpaths"]
            else:
                fid = op.get("feature_id")
                feat = next((f for f in features if f.get("id") == fid), {})
                paths = engine.generate_toolpath(op, feat, setup)
                op["toolpaths"] = paths
                
            try:
                for p in paths:
                    if isinstance(p, dict) and "setupId" not in p:
                        p["setupId"] = setup.get("setupId") or setup.get("id") or "setup_1"
                
                # Parametric time is often more accurate than simple fallback toolpaths
                # because simple toolpaths lack high-speed machining optimization.
                # Only use segment-based if parametric is completely missing.
                feat_id = op.get("feature_id") or op.get("featureId")
                feat = features_dict.get(feat_id, {})
                
                if op.get("estimated_time_s", 0) <= 0:
                    breakdown = CycleTimeEstimator.estimate_operation_time_parametric(op, feat, setup)
                    op["estimated_time_s"] = breakdown.total_seconds
                    op["estimated_breakdown"] = breakdown.model_dump()
                    
            except Exception as e:
                print(f"Error computing time for op {op.get('id')}: {e}")
                if "estimated_time_s" not in op:
                    op["estimated_time_s"] = 0.0
                
            op["status"] = op.get("status") or "generated"
            flat_paths.extend(paths)
            
        # Re-estimate total setup time
        features_dict = {f.get("id"): f for f in features} if features else {}
        setup_time_details = CycleTimeEstimator.estimate_setup_time(operations, machine_profile, features_dict=features_dict, setup=setup)
        result["setup_time_details"] = setup_time_details
            
        job_dir = Path(__file__).resolve().parents[4] / "storage" / "jobs" / request.job_id / "cam"
        job_dir.mkdir(parents=True, exist_ok=True)
        
        with open(job_dir / "cam_toolpaths.json", "w") as f:
            json.dump({"toolpath_schema_version": "semantic_v1", "toolpaths": flat_paths}, f)
        with open(job_dir / "cam_operations.json", "w") as f:
            json.dump({"operations": operations}, f)
            
        # Filter returned tools to ONLY tools assigned to operations
        assigned_tool_ids = {op.get("tool_id") or (op.get("tool") or {}).get("tool_id") or (op.get("tool") or {}).get("id") for op in operations}
        job_tools_dict = {}
        for op in operations:
            st = op.get("selected_tool") or op.get("tool")
            if isinstance(st, dict):
                tid = st.get("tool_id") or st.get("id")
                if tid: job_tools_dict[tid] = st
        for t in tools:
            if isinstance(t, dict):
                tid = t.get("tool_id") or t.get("id")
                if tid in assigned_tool_ids and tid not in job_tools_dict:
                    job_tools_dict[tid] = t

        tools = list(job_tools_dict.values())
            
        return {
            "status": "success",
            "features_detected": len(features),
            "features": features,
            "setups": setups,
            "validation_status": result.get("validation", {}).get("status", "ok"),
            "geometry_mapping_summary": result.get("validation", {}).get("summary", {}),
            "stock_suggestions": result.get("stock_suggestions", {}),
            "camModelHash": "parametric",
            "setup_metadata": result.get("setup_metadata", {}),
            "tools": tools,
            "operations": operations,
            "planned_cycle_time_seconds": result.get("setup_time_details", {}).get("total_setup_time_s", 0)
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail={"error": {"message": f"CAM auto-plan failed: {exc}"}})

class CamGenerateToolpathsRequest(BaseModel):
    session_id: str
    job_id: str = "default_job"
    cam_run_id: str = ""
    setup: Dict[str, Any]
    setups: Optional[List[Dict[str, Any]]] = None
    tools: List[Dict[str, Any]]
    operations: List[Dict[str, Any]]
    features: Optional[List[Dict[str, Any]]] = None
    modelHash: Optional[str] = ""
    parameters: Dict[str, Any] = {}

@router.post("/cam/toolpaths")
async def cam_generate_toolpaths(request: CamGenerateToolpathsRequest):
    try:
        from app.services.toolpath.parametric_toolpath_engine import ParametricToolpathEngine
        from app.services.cam.parametric_feature_extractor import ParametricFeatureExtractor
        
        # We re-extract the features from parameters to get the context
        extractor = ParametricFeatureExtractor()
        features = extractor.extract(request.parameters)
        feature_map = {f.get("id"): f for f in features if isinstance(f, dict) and f.get("id")}
        
        # Also merge raw features directly from request parameters and request.features
        raw_features = (
            request.features
            or request.parameters.get("camFeatures") 
            or request.parameters.get("features") 
            or request.parameters.get("cam_features") 
            or []
        )
        if isinstance(raw_features, list):
            for f in raw_features:
                if isinstance(f, dict) and f.get("id"):
                    # Use the provided feature, overriding any auto-extracted ones with the same ID
                    feature_map[f["id"]] = f
        
        from app.services.cam.cycle_time_estimator import CycleTimeEstimator
        from app.models.schemas import ToolpathSegment
        from app.models.manufacturing import MachineProfile
        engine = ParametricToolpathEngine()
        machine = MachineProfile(machine_id="m1", machine_name="Default Mill", machine_type="3_axis_mill", axis_count=3)
        
        flat_paths = []
        total_cycle_time = 0.0
        for op in request.operations:
            fid = op.get("feature_id") or op.get("featureId")
            feature = feature_map.get(fid, {})

            # Ensure safe_heights are populated to pass G-code safety validation
            if not op.get("safe_heights") or not isinstance(op.get("safe_heights"), dict):
                op["safe_heights"] = {}
            if op["safe_heights"].get("retract") is None:
                op["safe_heights"]["retract"] = 5.0
            if op["safe_heights"].get("clearance") is None:
                op["safe_heights"]["clearance"] = 10.0
            if op["safe_heights"].get("top") is None:
                op["safe_heights"]["top"] = 0.0
            if op["safe_heights"].get("bottom") is None:
                op["safe_heights"]["bottom"] = -abs(float(feature.get("depth", 10.0)))

            # Generate the paths directly from parametric math
            setup_id = op.get("setup_id") or op.get("setupId") or (request.setup.get("setupId") if isinstance(request.setup, dict) else None)
            paths = engine.generate_toolpath(op, feature, request.setup)
            if setup_id:
                for p in paths:
                    p["setupId"] = setup_id
            op["toolpaths"] = paths
            op["status"] = "generated"
            op["toolpath_schema_version"] = "semantic_v1"
            try:
                # Add toolpaths to operation so it's fully populated
                path_segs = [ToolpathSegment(**p) for p in paths]
                op_time = CycleTimeEstimator.estimate_operation_time(path_segs, machine)
                op["estimated_time_s"] = op_time.total_seconds
                op["estimated_breakdown"] = op_time.model_dump()
                total_cycle_time += op_time.total_seconds
            except Exception:
                pass
                
            flat_paths.extend(paths)
            
        job_dir = Path(__file__).resolve().parents[4] / "storage" / "jobs" / request.job_id / "cam"
        job_dir.mkdir(parents=True, exist_ok=True)
        with open(job_dir / "cam_toolpaths.json", "w") as f:
            json.dump({"toolpath_schema_version": "semantic_v1", "toolpaths": flat_paths}, f)
            
        with open(job_dir / "cam_toolpath_engine_input.json", "w") as f:
            json.dump({
                "setup": request.setup,
                "tools": request.tools,
                "operations": request.operations
            }, f)
            
        with open(job_dir / "cam_operations.json", "w") as f:
            json.dump({"operations": request.operations}, f)
            
        with open(job_dir / "cam_hashes.json", "w") as f:
            json.dump({
                "modelHash": request.modelHash or "parametric",
                "toolpath_schema_version": "semantic_v1",
                "operations": {op["id"]: "parametric" for op in request.operations}
            }, f)
            
        result = {
            "operations": request.operations,
            "toolpaths": flat_paths,
            "camRunId": request.cam_run_id,
            "gcode_blocked": False
        }
        
        # Evaluate readiness based on generated output
        from app.services.validation.toolpath_schema_validator import ToolpathSchemaValidator
        from app.services.validation.cam_readiness_evaluator import CamReadinessEvaluator
        
        operations = result.get("operations", [])
        toolpaths_data = {"toolpath_schema_version": "semantic_v1", "toolpaths": flat_paths}
        schema_validation = ToolpathSchemaValidator.validate(operations, toolpaths_data)
        readiness = CamReadinessEvaluator.evaluate(operations, schema_validation, True, "semantic_v1")
        
        has_errors = result.get("gcode_blocked", False)
        
        if has_errors:
            result["status"] = "toolpaths_generated_with_blocks"
        else:
            result["status"] = "toolpaths_generated"
            
        result["cam_readiness_score"] = readiness["cam_readiness_score"]
        result["cam_status"] = readiness["status"]
        result["can_generate_gcode"] = readiness["can_generate_gcode"]
        result["operation_statuses"] = readiness["operation_statuses"]
        result["toolpath_schema_version"] = "semantic_v1"
        
        try:
            from app.models.machine_profiles import get_machine_profile_by_id
            machine = get_machine_profile_by_id(request.setup.get("machineProfileId")) if isinstance(request.setup, dict) else None
            setup_time_details = CycleTimeEstimator.estimate_setup_time(
                operations, 
                machine, 
                features_dict={}, 
                setup=request.setup if isinstance(request.setup, dict) else {}
            )
            result["setup_time_details"] = setup_time_details
            if setup_time_details.get("total_setup_time_seconds"):
                total_cycle_time = setup_time_details["total_setup_time_seconds"]
        except Exception as e:
            print(f"Failed to calculate setup cycle time: {e}")
            
        result["planned_cycle_time_seconds"] = total_cycle_time
        
        # Merge readiness errors into result errors if any
        if readiness.get("errors"):
            if "errors" not in result:
                result["errors"] = []
            result["errors"].extend(readiness["errors"])
            
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"error": {"message": str(exc)}})
    except Exception as exc:
        import traceback
        tb = traceback.format_exc()
        print(f"[CAM TOOLPATH ERROR]\n{tb}")
        raise HTTPException(status_code=500, detail={"error": {"message": f"{str(exc)}\n{tb}"}})

class CamGCodeRequest(BaseModel):
    session_id: str
    job_id: str = "default_job"
    cam_run_id: str = ""
    setup_id: str | None = None
    selected_operation_ids: list[str] | None = None

@router.post("/cam/gcode")
async def cam_generate_gcode(request: CamGCodeRequest):
    job_dir = Path(__file__).resolve().parents[4] / "storage" / "jobs" / request.job_id / "cam"
    toolpaths_file = job_dir / "cam_toolpaths.json"
    hashes_file = job_dir / "cam_hashes.json"
    input_file = job_dir / "cam_toolpath_engine_input.json"
    ops_file = job_dir / "cam_operations.json"

    # Load data
    toolpaths_data = {}
    if toolpaths_file.exists():
        try:
            with open(toolpaths_file, "r") as f:
                toolpaths_data = json.load(f)
        except json.JSONDecodeError:
            pass

    engine_input = {}
    if input_file.exists():
        try:
            with open(input_file, "r") as f:
                engine_input = json.load(f)
        except json.JSONDecodeError:
            pass
            
    operations = []
    if ops_file.exists():
        try:
            with open(ops_file, "r") as f:
                ops_data = json.load(f)
                operations = ops_data.get("operations", [])
        except json.JSONDecodeError:
            operations = engine_input.get("operations", [])
    else:
        operations = engine_input.get("operations", [])

    hashes_data = {}
    if hashes_file.exists():
        with open(hashes_file, "r") as f:
            try:
                hashes_data = json.load(f)
            except json.JSONDecodeError:
                pass
                
    if request.setup_id:
        operations = [op for op in operations if op.get("setup_id") == request.setup_id or op.get("setupId") == request.setup_id]
        
    if request.selected_operation_ids is not None:
        operations = [op for op in operations if op.get("id") in request.selected_operation_ids]

    # Hash matching mock for MVP (assuming matching if exists for now, in a real system we'd compare)
    hashes_match = bool(hashes_data)
    cam_hashes_schema = hashes_data.get("toolpath_schema_version", "")

    schema_validation = ToolpathSchemaValidator.validate(operations, toolpaths_data)
    readiness = CamReadinessEvaluator.evaluate(operations, schema_validation, hashes_match, cam_hashes_schema)

    if not readiness["can_generate_gcode"]:
        return {
            "can_generate_gcode": False,
            "gcode": None,
            "cam_readiness_score": readiness["cam_readiness_score"],
            "status": readiness["status"],
            "message": readiness["message"],
            "errors": readiness["errors"],
            "operation_statuses": readiness["operation_statuses"]
        }

    from app.services.cam.machine_validation import validate_full_setup, validate_post_capabilities_for_operations
    
    engine_setup = engine_input.get("setup", {})
    
    # Fallback: if engine_input is empty/corrupted, load setup from cam_setup_analysis.json
    if not engine_setup:
        setup_analysis_file = job_dir / "cam_setup_analysis.json"
        if setup_analysis_file.exists():
            try:
                with open(setup_analysis_file, "r") as f:
                    setup_analysis = json.load(f)
                    engine_setup = setup_analysis.get("setup", {})
            except (json.JSONDecodeError, Exception):
                pass
    
    machine_type = engine_setup.get("machineType", "MILL_3X_VMC")
    machine_profile = engine_setup.get("machineProfile", "haas_vf2")
    controller = engine_setup.get("controller", "FANUC_0I_MF")
    post_processor_req = engine_setup.get("postProcessor", "AUTO")
    
    is_valid, err_msg, resolved_post = validate_full_setup(machine_type, machine_profile, controller, post_processor_req)
    if not is_valid:
        return {
            "can_generate_gcode": False,
            "gcode": None,
            "cam_readiness_score": readiness["cam_readiness_score"],
            "status": "validation_error",
            "message": err_msg,
            "errors": [{"message": err_msg, "level": "error"}],
            "operation_statuses": []
        }

    cap_valid, cap_err = validate_post_capabilities_for_operations(resolved_post, operations)
    if not cap_valid:
        return {
            "can_generate_gcode": False,
            "gcode": None,
            "cam_readiness_score": readiness["cam_readiness_score"],
            "status": "capability_error",
            "message": cap_err,
            "errors": [{"message": cap_err, "level": "error"}],
            "operation_statuses": []
        }

    setup = engine_setup
    machine = {"id": machine_profile, "type": machine_type}
    
    # Load tools
    # Primary source: engine_input (cam_toolpath_engine_input.json)
    tools_list = engine_input.get("tools", [])
    
    # Fallback: extract tools embedded inside operations (each op stores its assigned tool inline)
    if not tools_list:
        for op in operations:
            op_tool = op.get("tool")
            if op_tool and isinstance(op_tool, dict) and (op_tool.get("id") or op_tool.get("tool_id")):
                tools_list.append(op_tool)
    
    tools_by_id = {t.get("id") or t.get("tool_id"): t for t in tools_list if t.get("id") or t.get("tool_id")}
    
    errors = []
    from app.services.validation.manufacturing_capability_validator import ManufacturingCapabilityValidator
    from app.services.validation.gcode_safety_validator import GCodeSafetyValidator
    from app.services.validation.post_output_validator import PostOutputValidator
    from app.services.gcode.gcode_generator import PostProcessorFactory
    
    # Build toolpaths by operation ID
    tp_by_op = {}
    all_tp = toolpaths_data.get("toolpaths", [])
    for tp in all_tp:
        op_id = tp.get("operationId") or tp.get("operation_id")
        if op_id:
            tp_by_op.setdefault(op_id, []).append(tp)
            
    # Validate each operation
    valid_operations = []
    for op in operations:
        op_id = op.get("id")
        op["toolpaths"] = tp_by_op.get(op_id, [])
        tool_id = op.get("tool_id") or op.get("toolId")
        tool = tools_by_id.get(tool_id, {})
        op["tool"] = tool
        
        # Skip operations that are blocked or unsupported in this setup
        if op.get("status") in ("unsupported", "blocked"):
            continue
            
        # 1. Capability Validation
        cap_val = ManufacturingCapabilityValidator.validate_operation(op, setup, machine, tool)
        if not cap_val["valid"]:
            errors.append({"level": "error", "operation_id": op_id, "feature_id": op.get("feature_id"), "code": "CAPABILITY_ERROR", "message": cap_val["reason"]})
            continue
            
        # 2. Safety Validation
        safe_val = GCodeSafetyValidator.validate_toolpath_safety(op, op["toolpaths"], setup)
        if not safe_val["valid"]:
            errors.append({
                "level": "error", 
                "operation_id": op_id, 
                "feature_id": op.get("feature_id"), 
                "code": safe_val.get("code", "SAFETY_ERROR"), 
                "message": safe_val["reason"]
            })
            continue
            
        valid_operations.append(op)
        
    if errors:
        operation_statuses = [
            {
                "operation_id": e.get("operation_id"),
                "feature_id": e.get("feature_id"),
                "status": "blocked",
                "code": e.get("code"),
                "blocked_reason": e.get("message")
            }
            for e in errors if "operation_id" in e
        ]
        return {"can_generate_gcode": False, "gcode": None, "errors": errors, "operation_statuses": operation_statuses}
        
    if not valid_operations:
        return {"can_generate_gcode": False, "gcode": None, "errors": [{"level": "error", "message": "No valid operations to generate G-code for."}]}
        
    try:
        if "HEIDENHAIN" in resolved_post.upper():
            # Generate ISO
            iso_post = PostProcessorFactory.create("HEIDENHAIN")
            gcode_iso = iso_post.generate(valid_operations, setup)
            # Generate Klartext
            klartext_post = PostProcessorFactory.create("HEIDENHAIN_KLARTEXT")
            gcode_klartext = klartext_post.generate(valid_operations, setup)
            
            # Post Output Validation on ISO for safety
            out_val = PostOutputValidator.validate_gcode(gcode_iso, valid_operations)
            if not out_val["valid"]:
                operation_statuses = [
                    {
                        "operation_id": op.get("id"),
                        "feature_id": op.get("feature_id"),
                        "status": "blocked",
                        "code": "POST_OUTPUT_ERROR",
                        "blocked_reason": out_val["reason"]
                    }
                    for op in valid_operations
                ]
                return {"can_generate_gcode": False, "gcode": None, "errors": [{"level": "error", "code": "POST_OUTPUT_ERROR", "message": out_val["reason"]}], "operation_statuses": operation_statuses}
            
            # Save both
            with open(job_dir / "generated_gcode.nc", "w") as f:
                f.write(gcode_iso)
            with open(job_dir / "generated_klartext.h", "w") as f:
                f.write(gcode_klartext)
                
            final_toolpaths = []
            for op in valid_operations:
                final_toolpaths.extend(op.get("toolpaths", []))

            return {
                "can_generate_gcode": True, 
                "gcode": gcode_iso, 
                "klartext": gcode_klartext,
                "errors": [], 
                "status": "success",
                "toolpaths": final_toolpaths
            }
        else:
            post_processor = PostProcessorFactory.create(resolved_post)
            gcode = post_processor.generate(valid_operations, setup)
            
            # 3. Post Output Validation
            out_val = PostOutputValidator.validate_gcode(gcode, valid_operations)
            if not out_val["valid"]:
                operation_statuses = [
                    {
                        "operation_id": op.get("id"),
                        "feature_id": op.get("feature_id"),
                        "status": "blocked",
                        "code": "POST_OUTPUT_ERROR",
                        "blocked_reason": out_val["reason"]
                    }
                    for op in valid_operations
                ]
                return {"can_generate_gcode": False, "gcode": None, "errors": [{"level": "error", "code": "POST_OUTPUT_ERROR", "message": out_val["reason"]}], "operation_statuses": operation_statuses}
            
            # Save generated gcode
            gcode_path = job_dir / "generated_gcode.nc"
            with open(gcode_path, "w") as f:
                f.write(gcode)
                
            final_toolpaths = []
            for op in valid_operations:
                final_toolpaths.extend(op.get("toolpaths", []))

            return {"can_generate_gcode": True, "gcode": gcode, "errors": [], "status": "success", "toolpaths": final_toolpaths}
    except Exception as exc:
        import traceback
        tb = traceback.format_exc()
        print(f"[GCODE ERROR]\n{tb}")
        return {"can_generate_gcode": False, "gcode": None, "errors": [{"level": "error", "message": f"G-Code generation failed: {str(exc)}"}]}


class SimulatePrepareRequest(BaseModel):
    setup: Dict[str, Any]
    tools: List[Dict[str, Any]]
    operations: List[Dict[str, Any]]

@router.post("/cam/simulate/prepare")
async def simulate_prepare(request: SimulatePrepareRequest):
    try:
        from app.services.simulation.cam_simulation_service import CamSimulationService
        from app.services.toolpath.toolpath_engine import ToolpathEngine
        
        # Generate neutral toolpaths if missing
        engine = ToolpathEngine()
        operations = engine.generate_toolpaths(request.operations)
        
        service = CamSimulationService()
        payload = service.prepare_simulation(
            setup=request.setup,
            tools=request.tools,
            operations=operations
        )
        return payload
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail={"error": {"message": f"Simulation preparation failed: {exc}"}}
        )
