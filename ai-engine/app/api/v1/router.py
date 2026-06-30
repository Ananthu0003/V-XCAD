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
from app.services.cam_pipeline_manager import CamPipelineManager
from app.services.cam_input_router import CamInputRouter
from fastapi.responses import FileResponse, StreamingResponse
from app.models.schemas import GenerateResponse, EditRequest, StepRequest, RenderRequest, RenderResponse, RenderArtifacts, GCodeResponse, CAMJobRequest
from app.services.geometry.csg_parser import CSGParser, export_to_step
from app.services.llm.llm_codegen import LLMCodegenService
from app.services.llm.parameter_render import ParameterRenderService

router = APIRouter(tags=["cad"])

_ALLOWED_MIME_PREFIXES = ("image/",)
_ALLOWED_MIME_EXACT   = {"application/pdf"}
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
                feature_map = await asyncio.to_thread(svc.audit_blueprint, image_bytes, mime_type)
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

    try:
        from app.services.cam_pipeline_manager import CamPipelineManager
        cam_mgr = CamPipelineManager()
        analysis_result = await asyncio.to_thread(
            cam_mgr.analyze_features, 
            result.get("step_path"), 
            session_id, 
            "",
            request.cam_parameters.get("setup", {}) if request.cam_parameters else {}
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
        feature_validation_status=validation_status,
        geometry_mapping_summary=mapping_summary,
        operations=None,
    )

    return RenderResponse(
        status="ok",
        session_id=session_id,
        artifacts=artifacts,
    )


def _process_gcode(cam_request_dict: dict, step_file_path: str | None, temp_path_str: str | None) -> dict:
    from app.models.schemas import CAMJobRequest
    from app.services.gcode.gcode_generator import GCodeGenerator
    from app.services.geometry.csg_parser import CSGParser, export_to_step

    cam_request = CAMJobRequest(**cam_request_dict)

    is_ref, asset_id = is_step_reference(cam_request.csg_tree)
    if is_ref and asset_id:
        shape = ShapeCache.get(asset_id)
        if shape is None:
            raise ValueError(f"STEP asset ID {asset_id} not found in cache or has expired.")
        generator = GCodeGenerator(
            controller=cam_request.machine_configuration.controller,
            safe_z=cam_request.machine_configuration.safe_z,
            resolution=cam_request.machine_configuration.resolution
        )
        return generator.generate(cam_request, step_path=shape)

    if not cam_request.csg_tree and step_file_path:
        shape = ShapeCache.get(step_file_path)
        if shape is not None:
            generator = GCodeGenerator(
                controller=cam_request.machine_configuration.controller,
                safe_z=cam_request.machine_configuration.safe_z,
                resolution=cam_request.machine_configuration.resolution
            )
            return generator.generate(cam_request, step_path=shape)

        generator = GCodeGenerator(
            controller=cam_request.machine_configuration.controller,
            safe_z=cam_request.machine_configuration.safe_z,
            resolution=cam_request.machine_configuration.resolution
        )
        return generator.generate(cam_request, step_path=step_file_path)

    if not cam_request.csg_tree:
        raise ValueError("Either 'csg_tree' or 'step_file_path' must be provided.")

    shape = CSGParser.parse(cam_request.csg_tree)
    if temp_path_str:
        export_to_step(shape, temp_path_str)

    generator = GCodeGenerator(
        controller=cam_request.machine_configuration.controller,
        safe_z=cam_request.machine_configuration.safe_z,
        resolution=cam_request.machine_configuration.resolution
    )
    return generator.generate(cam_request, step_path=temp_path_str)


from fastapi import Request

@router.post("/gcode", response_model=GCodeResponse)
async def generate_gcode(
    request: Request,
    file: UploadFile | None = File(None),
    job_request: str | None = Form(None)
) -> GCodeResponse:
    import tempfile
    import pathlib

    content_type = request.headers.get("content-type", "")
    temp_path = None

    if "multipart/form-data" in content_type:
        if not file or not job_request:
            raise HTTPException(
                status_code=400,
                detail={"error": {"message": "Form data must include 'file' and 'job_request'."}}
            )
        try:
            job_request_data = json.loads(job_request)
            cam_request = CAMJobRequest(**job_request_data)
        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail={"error": {"message": f"Invalid CAMJobRequest JSON payload: {exc}"}}
            )

        file_bytes = await file.read()
        filename = file.filename or ""

        is_step = False
        if filename.endswith((".step", ".stp")):
            is_step = True
        elif file_bytes.startswith(b"ISO-10303-21") or b"HEADER;" in file_bytes[:500]:
            is_step = True

        if is_step:
            with tempfile.NamedTemporaryFile(suffix=".step", delete=False) as tf:
                tf.write(file_bytes)
                temp_path = pathlib.Path(tf.name)
            cam_request.step_file_path = str(temp_path)
        else:
            try:
                cam_request.csg_tree = file_bytes.decode("utf-8")
            except Exception:
                with tempfile.NamedTemporaryFile(suffix=".step", delete=False) as tf:
                    tf.write(file_bytes)
                    temp_path = pathlib.Path(tf.name)
                cam_request.step_file_path = str(temp_path)
    else:
        try:
            body_bytes = await request.body()
            body_json = json.loads(body_bytes)
            cam_request = CAMJobRequest(**body_json)
        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail={"error": {"message": f"Invalid JSON body: {exc}"}}
            )
    try:
        if not cam_request.csg_tree and cam_request.step_file_path:
            pass
        else:
            if not cam_request.csg_tree:
                raise HTTPException(
                    status_code=400,
                    detail={"error": {"message": "Either 'csg_tree' or 'step_file_path' must be provided."}}
                )
            if not temp_path:
                with tempfile.NamedTemporaryFile(suffix=".step", delete=False) as tf:
                    temp_path = pathlib.Path(tf.name)

        result = await asyncio.to_thread(
            _process_gcode,
            cam_request.model_dump(),
            cam_request.step_file_path,
            str(temp_path) if temp_path else None
        )

        gcode_content = result.get("gcode", "")
        if gcode_content.startswith("; ERROR:"):
            raise HTTPException(
                status_code=400,
                detail={"error": {"message": gcode_content[8:].strip()}}
            )

        return GCodeResponse(
            gcode=gcode_content,
            toolpaths=result.get("toolpaths", [])
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail={"error": {"message": f"G-code generation failed: {exc}"}}
        )
    finally:
        if temp_path and temp_path.exists():
            try:
                temp_path.unlink()
            except Exception:
                pass


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


@router.post("/import_step")
@router.post("/import/step")
async def import_step_endpoint(file: UploadFile = File(...)):
    if not file.filename.lower().endswith((".step", ".stp")):
        raise HTTPException(
            status_code=400,
            detail={"error": {"message": "Invalid file format. Only .step or .stp files are accepted."}}
        )

    try:
        file_bytes = await file.read()
        
        session_id = uuid.uuid4().hex
        outputs_dir = Path(__file__).resolve().parents[3] / "outputs"
        outputs_dir.mkdir(parents=True, exist_ok=True)
        
        step_filename = f"cad_{session_id}.step"
        stl_filename = f"cad_{session_id}.stl"
        
        step_path = outputs_dir / step_filename
        stl_path = outputs_dir / stl_filename
        
        with open(step_path, "wb") as f:
            f.write(file_bytes)
            
        from build123d import import_step, export_stl
        imported_shape = await asyncio.to_thread(import_step, str(step_path))
        
        bb = imported_shape.bounding_box()
        max_dim = max(
            bb.max.X - bb.min.X,
            bb.max.Y - bb.min.Y,
            bb.max.Z - bb.min.Z
        )
        tolerance = max(0.001, min(0.5, max_dim * 0.002))
        
        await asyncio.to_thread(export_stl, imported_shape, str(stl_path), tolerance, 0.15)
        
        asset_id = str(uuid.uuid4())
        ShapeCache.set(asset_id, imported_shape)
        
        features = None
        validation_status = None
        mapping_summary = None
        
        try:
            from app.services.cam_pipeline_manager import CamPipelineManager
            cam_mgr = CamPipelineManager()
            analysis_result = await asyncio.to_thread(
                cam_mgr.analyze_features, 
                str(step_path), 
                session_id, 
                "",
                {}
            )
            features = analysis_result.get("features")
            validation_status = analysis_result.get("validation_status")
            mapping_summary = analysis_result.get("geometry_mapping_summary")
        except Exception as e:
            print(f"Error analyzing features on import: {e}")
        
        return {
            "script": f"# Direct STEP Import: {file.filename}\n",
            "session_id": session_id,
            "artifacts": {
                "stl_url": f"/outputs/{stl_filename}",
                "step_url": f"/outputs/{step_filename}",
                "features": features,
                "feature_validation_status": validation_status,
                "geometry_mapping_summary": mapping_summary,
            }
        }
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail={"error": {"message": f"STEP Import failed: {str(exc)}"}}
        )


@router.post("/import/teardown/{asset_id}")
async def import_teardown_endpoint(asset_id: str):
    ShapeCache.evict(asset_id)
    return {"status": "evicted"}


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

# Trigger reload

from pydantic import BaseModel
from typing import List, Dict, Any, Optional

class CamAnalyzeRequest(BaseModel):
    session_id: str
    job_id: str = "default_job"
    cam_run_id: str = ""

@router.post("/cam/analyze")
async def cam_analyze(request: CamAnalyzeRequest):
    outputs_dir = Path(__file__).resolve().parents[3] / "outputs"
    step_path = outputs_dir / f"cad_{request.session_id}.step"
    if not step_path.exists():
        raise HTTPException(status_code=404, detail="STEP file not found for session")
        
    try:
        from app.services.cam_pipeline_manager import CamPipelineManager
        cam_mgr = CamPipelineManager()
        result = await asyncio.to_thread(cam_mgr.analyze_features, str(step_path), request.job_id, request.cam_run_id, {})
        return result
    except Exception as exc:
        raise HTTPException(status_code=500, detail={"error": {"message": f"CAM analysis failed: {exc}"}})

class CamAutoPlanRequest(BaseModel):
    session_id: str
    job_id: str = "default_job"
    cam_run_id: str = ""
    machine_config: Dict[str, Any] = {}

@router.post("/cam/auto_plan")
async def cam_auto_plan(request: CamAutoPlanRequest):
    outputs_dir = Path(__file__).resolve().parents[3] / "outputs"
    step_path = outputs_dir / f"cad_{request.session_id}.step"
    if not step_path.exists():
        raise HTTPException(status_code=404, detail="STEP file not found for session")
        
    try:
        from app.services.cam_pipeline_manager import CamPipelineManager
        cam_mgr = CamPipelineManager()
        result = await asyncio.to_thread(cam_mgr.auto_plan_cam, str(step_path), request.machine_config, request.job_id)
        return result
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
    modelHash: Optional[str] = ""

@router.post("/cam/toolpaths")
async def cam_generate_toolpaths(request: CamGenerateToolpathsRequest):
    outputs_dir = Path(__file__).resolve().parents[3] / "outputs"
    step_path = outputs_dir / f"cad_{request.session_id}.step"
    if not step_path.exists():
        raise HTTPException(status_code=404, detail="STEP file not found for session")
        
    import hashlib
    with open(step_path, "rb") as f:
        current_hash = hashlib.sha256(f.read()).hexdigest()
        
    if request.modelHash and request.modelHash != current_hash:
        raise HTTPException(status_code=400, detail={"error": {"message": "Model hash mismatch - generate CAD again."}})
        
    try:
        from app.services.cam_pipeline_manager import CamPipelineManager
        cam_mgr = CamPipelineManager()
        result = await asyncio.to_thread(
            cam_mgr.generate_toolpaths, 
            str(step_path),
            request.job_id,
            request.cam_run_id,
            request.setup,
            request.setups,
            request.tools,
            request.operations
        )
        
        flat_paths = []
        for op in result.get("operations", []):
            flat_paths.extend(op.get("toolpaths", []))
            
        result["toolpaths"] = flat_paths
        result["camRunId"] = request.cam_run_id
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

@router.post("/cam/gcode")
async def cam_generate_gcode(request: CamGCodeRequest):
    job_dir = Path(__file__).resolve().parents[4] / "storage" / "jobs" / request.job_id / "cam"
    toolpaths_file = job_dir / "cam_toolpaths.json"
    validation_file = job_dir / "cam_validation.json"
    operation_summary_file = job_dir / "cam_operation_summary.json"
    
    if not toolpaths_file.exists() or not validation_file.exists() or not operation_summary_file.exists():
        raise HTTPException(status_code=400, detail={"error": {"message": "Valid toolpaths not found. Generate toolpaths first."}})
        
    with open(validation_file, "r") as f:
        validation_data = json.load(f)
        # Allow generation even if there are some errors, as long as some toolpaths exist.
        if validation_data.get("status") != "success" and validation_data.get("readyOperations", 1) == 0:
            raise HTTPException(status_code=400, detail={"error": {"message": "Cannot generate G-Code. No valid operations exist."}})

    # Check for legacy toolpath schema
    hashes_file = job_dir / "cam_hashes.json"
    if hashes_file.exists():
        with open(hashes_file, "r") as f:
            try:
                hashes = json.load(f)
                if hashes.get("toolpath_schema_version") != "semantic_v1":
                    raise HTTPException(status_code=400, detail={"error": {"message": "Stale CAM data detected. Please regenerate toolpaths."}})
            except json.JSONDecodeError:
                pass
            
    # Load original operations which have the tool and parameter data
    input_file = job_dir / "cam_toolpath_engine_input.json"
    if input_file.exists():
        with open(input_file, "r") as f:
            engine_input = json.load(f)
            operations = engine_input.get("operations", [])
    else:
        operations = []
        
    # Read toolpaths and attach them to operations
    with open(toolpaths_file, "r") as f:
        tp_data = json.load(f)
        all_tp = tp_data.get("toolpaths", [])
        
    # Group toolpaths by operationId
    tp_by_op = {}
    for tp in all_tp:
        op_id = tp.get("operationId")
        if op_id:
            tp_by_op.setdefault(op_id, []).append(tp)
            
    # Mock setups/machines for MVP (should be loaded from project)
    setup = {"id": "setup_1", "material": "aluminum"}
    machine = {"id": "machine_1", "axes": 3, "max_spindle_rpm": 10000}
    
    # Load tools
    # Assuming tools are in engine_input, or we mock them if not present.
    tools_list = engine_input.get("tools", [])
    tools_by_id = {t.get("id"): t for t in tools_list}
    
    errors = []
    from app.services.validation.manufacturing_capability_validator import ManufacturingCapabilityValidator
    from app.services.validation.gcode_safety_validator import GCodeSafetyValidator
    from app.services.validation.post_output_validator import PostOutputValidator
    from app.services.gcode.gcode_generator import PostProcessorFactory
    
    # Validate each operation
    valid_operations = []
    for op in operations:
        op_id = op.get("id")
        op["toolpaths"] = tp_by_op.get(op_id, [])
        tool_id = op.get("tool_id") or op.get("toolId")
        tool = tools_by_id.get(tool_id, {})
        op["tool"] = tool
        
        # 1. Capability Validation
        cap_val = ManufacturingCapabilityValidator.validate_operation(op, setup, machine, tool)
        if not cap_val["valid"]:
            errors.append({"level": "error", "operation_id": op_id, "feature_id": op.get("feature_id"), "code": "CAPABILITY_ERROR", "message": cap_val["reason"]})
            continue
            
        # 2. Safety Validation
        safe_val = GCodeSafetyValidator.validate_toolpath_safety(op, op["toolpaths"], setup)
        if not safe_val["valid"]:
            errors.append({"level": "error", "operation_id": op_id, "feature_id": op.get("feature_id"), "code": "SAFETY_ERROR", "message": safe_val["reason"]})
            continue
            
        valid_operations.append(op)
        
    if errors:
        operation_statuses = {e.get("operation_id"): "blocked" for e in errors if "operation_id" in e}
        return {"can_generate_gcode": False, "gcode": None, "errors": errors, "operation_statuses": operation_statuses}
        
    if not valid_operations:
        return {"can_generate_gcode": False, "gcode": None, "errors": [{"level": "error", "message": "No valid operations to generate G-code for."}]}
        
    try:
        controller = "fanuc"
        post_processor = PostProcessorFactory.create(controller)
        gcode = post_processor.generate(valid_operations)
        
        # 3. Post Output Validation
        out_val = PostOutputValidator.validate_gcode(gcode, valid_operations)
        if not out_val["valid"]:
            operation_statuses = {op.get("id"): "blocked" for op in valid_operations}
            return {"can_generate_gcode": False, "gcode": None, "errors": [{"level": "error", "code": "POST_OUTPUT_ERROR", "message": out_val["reason"]}], "operation_statuses": operation_statuses}
        
        # Save generated gcode
        gcode_path = job_dir / "generated_gcode.nc"
        with open(gcode_path, "w") as f:
            f.write(gcode)
            
        return {"can_generate_gcode": True, "gcode": gcode, "errors": [], "status": "success"}
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
