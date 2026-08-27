"""VEXCAD V2 - /api/v1 router."""
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
import shutil
from fastapi import APIRouter, File, Form, HTTPException, UploadFile, BackgroundTasks
from app.services.validation.toolpath_schema_validator import ToolpathSchemaValidator
from app.services.validation.cam_readiness_evaluator import CamReadinessEvaluator
from app.services.cam_pipeline_manager import CamPipelineManager
from app.services.cam_input_router import CamInputRouter
from fastapi.responses import FileResponse, StreamingResponse, Response
from app.models.schemas import (
    GenerateResponse, EditRequest, StepRequest, RenderRequest, RenderResponse, RenderArtifacts,
    GCodeResponse, CAMJobRequest, MachineRecommendationRequest, MachineRecommendationResponse,
    CADPromptAssistantRequest, CADPromptAssistantResponse
)
from app.services.geometry.csg_parser import CSGParser, export_to_step
from app.services.llm.llm_codegen import LLMCodegenService
from app.services.llm.parameter_render import ParameterRenderService

router = APIRouter(tags=["cad"])

_ALLOWED_MIME_PREFIXES = ()
_ALLOWED_MIME_EXACT   = {"application/pdf", "image/jpeg", "image/png", "image/gif", "image/webp"}
_DEFAULT_MODEL = os.getenv("GENAI_MODEL", "gemini-3.5-flash-lite")

# Geometry/rendering policy constants (env-overridable where relevant)
# Security cap on OpenSCAD tessellation resolution (resource exhaustion guard).
OPENSCAD_FN_CAP = int(os.getenv("OPENSCAD_FN_CAP", "32"))
# CGAL crash-prevention epsilon injected into CSG difference() operations.
CSG_EPS = float(os.getenv("CSG_EPS", "0.02"))
# Horizontal/vertical spacing (mm) between the four views in a blueprint DXF export.
BLUEPRINT_DXF_VIEW_SPACING = float(os.getenv("BLUEPRINT_DXF_VIEW_SPACING", "120.0"))


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
        offset_dist = BLUEPRINT_DXF_VIEW_SPACING
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

    # -- Guard 1: cap every $fn value that exceeds OPENSCAD_FN_CAP ------------
    FN_CAP = OPENSCAD_FN_CAP

    def _cap_fn(match: re.Match) -> str:
        val = int(match.group(1))
        capped = min(val, FN_CAP)
        return match.group(0).replace(match.group(1), str(capped))

    script = re.sub(r'\$fn\s*=\s*(\d+)', _cap_fn, script)

    # -- Guard 2: inject $fn = OPENSCAD_FN_CAP if entirely absent ---------------
    if "$fn" not in script:
        script = f"$fn = {OPENSCAD_FN_CAP};\n\n" + script

    # -- Guard 3: inject CSG_EPS if difference() exists but eps is absent -------
    has_difference = "difference()" in script
    has_eps        = re.search(r'\beps\s*=', script) is not None

    if has_difference and not has_eps:
        if "// PARAMETERS_START" in script:
            script = script.replace(
                "// PARAMETERS_START",
                f"// PARAMETERS_START\neps = {CSG_EPS};  // CGAL crash prevention",
                1,
            )
        else:
            # Fallback: inject before the first module or difference() block
            script = re.sub(
                r'(\bmodule\b|\bdifference\(\))',
                rf'eps = {CSG_EPS};  // CGAL crash prevention\n\n\1',
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

BLUEPRINTS_DIR = Path(__file__).resolve().parents[3] / "outputs" / "blueprints"
BLUEPRINTS_DIR.mkdir(parents=True, exist_ok=True)

@router.get("/blueprint/{session_id}")
async def get_session_blueprint(session_id: str):
    """Return the cached blueprint PNG image for a given session."""
    bp_file = BLUEPRINTS_DIR / f"{session_id}.png"
    if not bp_file.exists():
        raise HTTPException(status_code=404, detail="Blueprint not found for this session")
    return Response(content=bp_file.read_bytes(), media_type="image/png")

def _crop_blueprint_image(image_bytes: bytes, crop_box: dict[str, Any]) -> bytes:
    try:
        from PIL import Image
        import io
        img = Image.open(io.BytesIO(image_bytes))
        width, height = img.size

        x = float(crop_box.get("x", 0))
        y = float(crop_box.get("y", 0))
        w = float(crop_box.get("w", 100))
        h = float(crop_box.get("h", 100))

        # Add 5% padding margin to ensure nearby dimensions and leader lines are included
        margin_x = max(15, int(width * 0.05))
        margin_y = max(15, int(height * 0.05))

        left = max(0, int((x / 100.0) * width) - margin_x)
        top = max(0, int((y / 100.0) * height) - margin_y)
        right = min(width, int(((x + w) / 100.0) * width) + margin_x)
        bottom = min(height, int(((y + h) / 100.0) * height) + margin_y)

        if (right - left) > 20 and (bottom - top) > 20:
            cropped = img.crop((left, top, right, bottom))
            buf = io.BytesIO()
            cropped.save(buf, format="PNG")
            return buf.getvalue()
    except Exception as e:
        print(f"Failed to crop blueprint image: {e}")
    return image_bytes


def _patch_parameters_in_script(script: str, adjustments: dict[str, Any]) -> str:
    """
    Deterministically patch numeric PARAMETERS values into an existing build123d
    Python script without relying on LLM text surgery.

    For each key/value pair in `adjustments`:
    - If the key already exists in the PARAMETERS dict, update its value in-place.
    - If the key is new, append it to the PARAMETERS dict.

    Returns the patched script.  If anything goes wrong, returns the original.
    """
    if not adjustments or not script:
        return script

    patched = script
    appended_keys: list[str] = []

    for key, value in adjustments.items():
        if not isinstance(key, str) or not key.strip():
            continue

        # Format value for Python source
        if isinstance(value, bool):
            val_str = "True" if value else "False"
        elif isinstance(value, float):
            val_str = str(value) if value != int(value) else f"{value:.1f}"
        elif isinstance(value, int):
            val_str = str(value)
        elif isinstance(value, str):
            val_str = f'"{value}"'
        elif isinstance(value, list):
            val_str = json.dumps(value)
        else:
            val_str = str(value)

        # Pattern: match the key inside the PARAMETERS dict and replace its value
        # Handles   "key": 12.3,   or   "key": 12.3  (no trailing comma)
        pattern = re.compile(
            r'(PARAMETERS\s*=\s*\{[^}]*?"' + re.escape(key) + r'"\s*:\s*)([^,\n\}]+)',
            re.DOTALL,
        )
        m = pattern.search(patched)
        if m:
            patched = patched[:m.start(2)] + val_str + patched[m.end(2):]
            print(f"[param-patch] Updated '{key}' → {val_str}")
        else:
            # Key not found — queue it for appending
            appended_keys.append((key, val_str))

    # Append new keys just before the closing } of PARAMETERS
    if appended_keys:
        param_close = re.search(r'(PARAMETERS\s*=\s*\{[^}]*?)(\n\})', patched, re.DOTALL)
        if param_close:
            insert_text = ""
            for key, val_str in appended_keys:
                insert_text += f'\n    "{key}": {val_str},'
                print(f"[param-patch] Appended new key '{key}' = {val_str}")
            patched = patched[:param_close.end(1)] + insert_text + patched[param_close.start(2):]

    return patched



@router.post("/generate")
async def generate(
    prompt: str = Form(...),
    model_name: str = Form(_DEFAULT_MODEL, alias="model"),
    image: UploadFile = File(None),
    base_code: str | None = Form(None),
    selection_context: str | None = Form(None),
    session_id: str | None = Form(None),
    target_portion: str | None = Form(None),
    crop_box: str | None = Form(None),
) -> StreamingResponse:
    """
    Two-stage CAD generation & multi-iteration refinement pipeline:
      - Initial Turn: Full Blueprint Audit (Stage 1) -> build123d Codegen (Stage 2)
      - Iteration Turn: Targeted Blueprint Feature Inspection -> Surgical Script Refinement
    """
    # ── Validate & read uploaded file or retrieve cached session blueprint ───
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
        
        # OpenRouter and some vision models don't accept PDF via image payload
        if mime_type == "application/pdf":
            try:
                import fitz
                doc = fitz.open(stream=image_bytes, filetype="pdf")
                if len(doc) > 0:
                    page = doc.load_page(0)
                    pix = page.get_pixmap(dpi=150)
                    image_bytes = pix.tobytes("png")
                    mime_type = "image/png"
                doc.close()
            except Exception as e:
                print(f"Failed to rasterize PDF: {e}")

        # Persist blueprint for subsequent multi-iteration turns in this session
        if session_id and image_bytes:
            try:
                bp_file = BLUEPRINTS_DIR / f"{session_id}.png"
                bp_file.write_bytes(image_bytes)
            except Exception as e:
                print(f"Failed to cache session blueprint: {e}")
    elif session_id:
        # Check if we have a persisted blueprint from a previous turn
        bp_file = BLUEPRINTS_DIR / f"{session_id}.png"
        if bp_file.exists():
            try:
                image_bytes = bp_file.read_bytes()
                mime_type = "image/png"
            except Exception as e:
                print(f"Failed to read cached session blueprint: {e}")

    # ── Initialise service ────────────────────────────────────────────────────
    try:
        svc = LLMCodegenService(model=model_name)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail={"error": {"message": str(exc)}})

    feature_map: str | dict[str, Any] = ""
    targeted_feature: dict[str, Any] | None = None

    async def stream_generator():
        nonlocal feature_map, targeted_feature
        # Use a mutable local copy so we can patch base_code without
        # triggering Python's UnboundLocalError for the closure variable.
        effective_base_code = base_code
        
        if not effective_base_code:
            # ── Initial Generation (Stage 1: Full Blueprint Audit) ────────────
            if image_bytes and mime_type:
                yield f'data: {json.dumps({"status": "auditing blueprint (stage 1 of 2)"})}\n\n'
                try:
                    feature_map = await svc.audit_blueprint(image_bytes, mime_type)
                    # Persist the full engineering audit so iteration turns can
                    # refine with full-part context (stock, material, GD&T, ...).
                    if session_id and feature_map:
                        try:
                            fm_file = BLUEPRINTS_DIR / f"{session_id}_feature_map.json"
                            fm_file.write_text(json.dumps(feature_map), encoding="utf-8")
                        except Exception as e:
                            print(f"Failed to cache session feature map: {e}")
                except Exception as e:
                    print(f"Audit failed: {e}")
            yield f'data: {json.dumps({"status": "generating code (stage 2 of 2)"})}\n\n'
        else:  # iteration turn
            # ── Iteration Turn (Targeted Inspection & Surgical Refinement) ────
            # Restore the stage-1 engineering audit from the session cache so
            # the surgical refinement isn't blind to the full-part context.
            if not feature_map and session_id:
                fm_file = BLUEPRINTS_DIR / f"{session_id}_feature_map.json"
                if fm_file.exists():
                    try:
                        feature_map = json.loads(fm_file.read_text(encoding="utf-8"))
                    except Exception as e:
                        print(f"Failed to read cached session feature map: {e}")
                else:
                    yield f'data: {json.dumps({"warning": "Stage-1 engineering audit unavailable for this session; refinement proceeds without full-part context."})}\n\n'

            # Parse the targeted crop box (top-level form field, selection_context
            # JSON, or the "Custom Region (x%, y%)" naming convention) up front.
            target_crop_box = None
            if crop_box:
                try:
                    parsed_crop = json.loads(crop_box) if isinstance(crop_box, str) else crop_box
                    if isinstance(parsed_crop, dict) and parsed_crop.get("crop_box"):
                        parsed_crop = parsed_crop["crop_box"]
                    if isinstance(parsed_crop, dict) and all(k in parsed_crop for k in ("x", "y", "w", "h")):
                        target_crop_box = parsed_crop
                except Exception:
                    pass

            if not target_crop_box and selection_context:
                try:
                    ctx = json.loads(selection_context) if isinstance(selection_context, str) else selection_context
                    if isinstance(ctx, dict) and ctx.get("crop_box"):
                        target_crop_box = ctx["crop_box"]
                except Exception:
                    pass

            if not target_crop_box and target_portion:
                m = re.search(r'\((\d+)%,\s*(\d+)%\)', target_portion)
                if m:
                    cx, cy = float(m.group(1)), float(m.group(2))
                    target_crop_box = {"x": max(0, cx - 10), "y": max(0, cy - 10), "w": 20, "h": 20}

            # Fail loudly when the user explicitly targets a region but the
            # targeted inspection cannot run - never refine blind silently.
            if target_portion and not (image_bytes and mime_type):
                yield f'data: {json.dumps({"error": {"message": "Targeted repair requires the session blueprint image, but none is available for this session. Re-upload the blueprint or start a new generation.", "hint": "Re-attach the blueprint image and retry."}})}\n\n'
                return

            if image_bytes and mime_type and (target_portion or prompt):
                portion_label = target_portion or "target feature"
                yield f'data: {json.dumps({"status": f"inspecting blueprint for {portion_label} (targeted vision)..."})}\n\n'

                target_img_bytes = _crop_blueprint_image(image_bytes, target_crop_box) if target_crop_box else image_bytes

                try:
                    targeted_feature = await svc.audit_target_feature(
                        image_bytes=target_img_bytes,
                        mime_type=mime_type,
                        target_portion=target_portion or "feature",
                        user_prompt=prompt,
                        base_code=effective_base_code,
                        crop_box=target_crop_box,
                    )
                except Exception as e:
                    print(f"Targeted feature audit failed: {e}")
                    yield f'data: {json.dumps({"error": {"message": f"Targeted feature inspection failed: {e}", "hint": "Check API key and quota, then retry."}})}\n\n'
                    return

                # ── Deterministic Server-Side Parameter Patch ─────────────────
                # CRITICAL: Apply parameter_adjustments directly to base_code via
                # regex so they are guaranteed to survive even if the LLM rewrites
                # the script structure. This is the primary mechanism that makes
                # multi-iteration visually change the 3D model.
                if targeted_feature and effective_base_code:
                    param_adjustments = targeted_feature.get("parameter_adjustments") or {}
                    if param_adjustments:
                        patched = _patch_parameters_in_script(effective_base_code, param_adjustments)
                        n_patched = sum(
                            1 for k in param_adjustments
                            if k in patched
                        )
                        print(f"[param-patch] Applied {n_patched}/{len(param_adjustments)} parameter adjustments to base_code")
                        # Use patched copy downstream — never reassign the closure variable
                        effective_base_code = patched
                        yield f'data: {json.dumps({"status": f"applied {n_patched} parameter patches from blueprint inspection..."})}\n\n'

            yield f'data: {json.dumps({"status": "surgically refining CAD script..."})}\n\n'

        full_script = ""
        try:
            # ── Stage 2: Script Generation / Refinement ───────────────────────
            async for chunk_text in svc.generate_script_stream(
                prompt=prompt,
                image_bytes=image_bytes,
                mime_type=mime_type,
                feature_map=feature_map,
                targeted_feature=targeted_feature,
                base_code=effective_base_code,
                selection_context=selection_context,
            ):
                full_script += chunk_text
                yield f'data: {json.dumps({"chunk": chunk_text})}\n\n'

            # ── Server-side safety net ────────────────────────────────────────
            try:
                clean_script = LLMCodegenService._normalize_script(full_script)
            except Exception as norm_err:
                print(f"[generate stream] _normalize_script failed: {norm_err}. Falling back to effective_base_code.")
                if effective_base_code:
                    clean_script = effective_base_code
                else:
                    raise norm_err

            clean_script = _sanitize_script(clean_script)
            params = _extract_parameters(clean_script)
            metadata = _extract_metadata(clean_script)
            
            # Send final script and parameters
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
    version = request.version
    if version:
        output_basename = f"cad_{session_id}_v{version}"
    else:
        output_basename = f"cad_{session_id}"

    svc = ParameterRenderService()
    try:
        # 1. Strictly validate geometry to catch real B-Rep errors (e.g. self-intersections)
        # without them being silently swallowed into 2D sketches.
        is_valid, val_err = await svc.validate_script(
            script=request.python_script,
            parameters=request.parameters,
        )
        if not is_valid:
            raise RuntimeError(val_err)
            
        # 2. Render and export files (where safe wrappers are allowed to swallow minor fillet errors)
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
        # ── Bounded Auto-healing Loop ─────────────────────────────────────────
        # Each attempt feeds the LATEST traceback back to the LLM repairer so
        # successive repairs actually converge instead of repeating the same
        # mistake. Gives up loudly after RENDER_MAX_REPAIR_ATTEMPTS.
        max_repair_attempts = max(1, int(os.getenv("RENDER_MAX_REPAIR_ATTEMPTS", "3")))
        last_error = str(exc)
        active_params = request.parameters

        for attempt in range(1, max_repair_attempts + 1):
            try:
                llm_svc = LLMCodegenService()
                healed_script = await llm_svc.repair_script(
                    current_code=request.python_script,
                    error_log=last_error,
                )

                # Extract parameters directly from the healed script to avoid re-injecting broken params
                healed_params = _extract_parameters(healed_script)
                active_params = healed_params if healed_params else request.parameters

                # Strictly validate the healed script with its own parameters
                is_valid, val_err = await svc.validate_script(
                    script=healed_script,
                    parameters=active_params,
                )
                if not is_valid:
                    last_error = val_err
                    continue

                # Re-run render with the repaired script and healed parameters
                result = await svc.render_to_outputs(
                    parameters=active_params,
                    script=healed_script,
                    output_basename=output_basename,
                    cam_parameters=request.cam_parameters,
                )
                # Succeeded — stop looping
                break

            except Exception as retry_exc:
                last_error = f"{last_error}\nHeal attempt {attempt} failed: {retry_exc}"
        else:
            # If auto-heal exhausts all attempts, raise the accumulated errors
            raise HTTPException(
                status_code=500,
                detail={"error": {"message": f"Render failed after {max_repair_attempts} auto-heal attempts.\nLast error: {last_error}"}},
            )

    # If versioned, maintain alias unversioned files for backwards compatibility
    if version:
        try:
            if result.get("stl_path"):
                import shutil
                out_dir = Path(result["stl_path"]).parent
                for ext in [".stl", ".step", ".dxf", ".py.txt", "_annotations.json"]:
                    v_file = out_dir / f"cad_{session_id}_v{version}{ext}"
                    alias_file = out_dir / f"cad_{session_id}{ext}"
                    if v_file.exists():
                        shutil.copyfile(v_file, alias_file)
        except Exception:
            pass

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
        stats=analysis_result.get("stats") if 'analysis_result' in locals() and analysis_result else None,
        machine_recommendation=analysis_result.get("machine_recommendation") if 'analysis_result' in locals() and analysis_result else None,
    )


    return RenderResponse(
        status="ok",
        session_id=session_id,
        version=version,
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
    setup: Dict[str, Any] = {}

@router.post("/cam/analyze")
async def cam_analyze(request: CamAnalyzeRequest):
    outputs_dir = Path(__file__).resolve().parents[3] / "outputs"
    step_path = outputs_dir / f"cad_{request.session_id}.step"
    
    # We no longer strictly require the STEP file since we are extracting from parameters
    # but we'll leave the path resolution just in case
        
    try:
        from app.services.cam.parametric_feature_extractor import ParametricFeatureExtractor
        from app.services.cam.brep_feature_extractor import BRepFeatureExtractor
        
        brep_data = None
        if step_path.exists():
            brep_extractor = BRepFeatureExtractor(str(step_path))
            brep_data = brep_extractor.analyze()
            
        extractor = ParametricFeatureExtractor()
        features = extractor.extract(request.parameters, setup=request.setup, brep_data=brep_data)
        
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
            stock_x = float(params.get("length") or params.get("width") or params.get("outer_diameter") or 0.0)
            stock_y = float(params.get("width") or params.get("length") or params.get("outer_diameter") or 0.0)
            stock_h = float(params.get("height") or params.get("overall_length") or params.get("thickness") or 0.0)
            if not (stock_x > 0.0 and stock_y > 0.0 and stock_h > 0.0):
                raise HTTPException(
                    status_code=422,
                    detail={
                        "error": {
                            "code": "STOCK_DIMENSIONS_MISSING",
                            "message": (
                                "Stock dimensions are required. Provide setup.stockDimensions (or "
                                "setup.resolvedStock), or length/width/height (height/overall_length/"
                                "thickness) parameters so the stock can be derived. Refusing to "
                                "fabricate a default stock geometry."
                            ),
                        }
                    },
                )
            setup["stockDimensions"] = [stock_x, stock_y, stock_h]
            if is_lathe:
                setup["stockType"] = "cylinder"
        
        # Ensure resolvedStock with bounds exists to pass PlanningContext validation
        if not setup.get("resolvedStock"):
            sd = setup.get("stockDimensions")
            if not sd or len(sd) < 3 or any(float(v) <= 0.0 for v in sd):
                raise HTTPException(
                    status_code=422,
                    detail={
                        "error": {
                            "code": "STOCK_DIMENSIONS_MISSING",
                            "message": "resolvedStock is missing and stockDimensions are not usable; refusing to fabricate a default stock geometry.",
                        }
                    },
                )
            sx, sy, sz = float(sd[0]), float(sd[1]), float(sd[2])
            setup["resolvedStock"] = {
                "type": setup.get("stockType", "box"),
                "bounds": {
                    "min": [-sx/2, -sy/2, -sz],
                    "max": [sx/2, sy/2, 0.0]
                },
                "center": [0.0, 0.0, -sz/2]
            }
            request.machine_config["setup"] = setup
        elif "bounds" not in setup["resolvedStock"]:
            sd = setup.get("stockDimensions")
            if not sd or len(sd) < 3 or any(float(v) <= 0.0 for v in sd):
                raise HTTPException(
                    status_code=422,
                    detail={
                        "error": {
                            "code": "STOCK_DIMENSIONS_MISSING",
                            "message": "resolvedStock has no bounds and stockDimensions are not usable; refusing to fabricate a default stock geometry.",
                        }
                    },
                )
            sx, sy, sz = float(sd[0]), float(sd[1]), float(sd[2])
            setup["resolvedStock"]["bounds"] = {
                "min": [-sx/2, -sy/2, -sz],
                "max": [sx/2, sy/2, 0.0]
            }
            request.machine_config["setup"] = setup
            
        from app.services.cam_pipeline_manager import CamPipelineManager
        
        # Inject session_id so the pipeline can locate the STEP file for B-Rep analysis
        request.machine_config["session_id"] = request.session_id
        
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
        
        raw_mtype = str(request.machine_config.get("machine_type", "3_axis_mill")).upper()
        acount = m_cap.get("axis_count", 3)
        if "LATHE" in raw_mtype or "TURNING" in raw_mtype:
            mapped_mtype = "mill_turn" if ("LIVE" in raw_mtype or "TURN" in raw_mtype or "5X" in raw_mtype or acount >= 4) else "lathe"
        elif "TURN" in raw_mtype or "SWISS" in raw_mtype:
            mapped_mtype = "mill_turn"
        elif "5X" in raw_mtype or acount == 5:
            mapped_mtype = "5_axis_mill"
        elif "4X" in raw_mtype or acount == 4:
            mapped_mtype = "4_axis_mill"
        else:
            mapped_mtype = "3_axis_mill"

        machine_profile = MachineProfile(
            machine_id=request.machine_config.get("machine_id", "default"),
            machine_name=request.machine_config.get("machine_name", "Default Machine"),
            machine_type=mapped_mtype,
            axis_count=acount,
            rapid_feedrate=request.machine_config.get("rapid_feedrate", 5000.0),
            tool_change_time=request.machine_config.get("tool_change_time", 15.0)
        )
        
        operations = result.get("operations", [])
        features = result.get("features", [])
        setups = result.get("setups", [])
        tools = result.get("tools", [])
        features_dict = {f.get("id"): f for f in features} if features else {}
        
        from app.services.planning.planning_context import PlanningContext
        planning_context = PlanningContext(
            setup=setup,
            machine_profile=machine_profile.model_dump() if hasattr(machine_profile, "model_dump") else machine_profile,
            material=None,
            features=features
        )
        
        flat_paths = []
        for op in operations:
            if op.get("toolpaths"):
                paths = op["toolpaths"]
            else:
                fid = op.get("feature_id")
                feat = next((f for f in features if f.get("id") == fid), {})
                paths, validation_result = engine.generate_toolpath(op, feat, request.machine_config, planning_context)
                op["toolpaths"] = paths
                if not validation_result.get("valid", True):
                    op["validation_errors"] = validation_result.get("errors", [])
                    op["status"] = "blocked"
                    with open("debug_validation_errors.txt", "a") as f:
                        f.write(f"Operation {op.get('id')} blocked. Errors: {validation_result.get('errors')}\n")
                
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
                    breakdown = CycleTimeEstimator.estimate_operation_time_parametric(op, feat, setup, machine_profile)
                    op["estimated_time_s"] = breakdown.total_seconds
                    op["estimated_breakdown"] = breakdown.model_dump()
                    
            except Exception as e:
                print(f"Error computing time for op {op.get('id')}: {e}")
                if "estimated_time_s" not in op:
                    op["estimated_time_s"] = 0.0
                
            op["status"] = op.get("status") or "generated"
            op["toolpath_schema_version"] = "semantic_v1"
            flat_paths.extend(paths)
            
        # Re-estimate total setup time
        setup_time_details = CycleTimeEstimator.estimate_setup_time(operations, machine_profile, features_dict=features_dict, setup=setup)
        result["setup_time_details"] = setup_time_details
        
        # Calculate cost estimation
        try:
            from app.services.cam.cost_estimation import CostEstimationEngine, build_quote_context
            from app.services.cam.material_validation import get_material_profile
            cost_engine = CostEstimationEngine()
            total_machining_time_s = sum(op.get("estimated_time_s", 0) for op in operations)
            setup_time_s = setup_time_details.get("total_setup_time_seconds", 0)
            
            # machine_config from frontend typically has { setup: { material: "..." } }
            mat_id = setup.get("workpieceMaterialId") or setup.get("material") if isinstance(setup, dict) else None
            material_obj = get_material_profile(mat_id)
            material_profile = material_obj.model_dump() if hasattr(material_obj, 'model_dump') else {}
            
            cost_estimate_result = cost_engine.estimate(
                build_quote_context(
                    setup=setup if isinstance(setup, dict) else {},
                    material_profile=material_profile,
                    machine_profile=machine_profile.model_dump() if hasattr(machine_profile, "model_dump") else machine_profile,
                    tool_library=tools,
                    operations=operations,
                    quantity=int(setup.get("quantity", 1) or 1) if isinstance(setup, dict) else 1,
                    learning_rate=float(setup.get("learningRate", 1.0) or 1.0) if isinstance(setup, dict) else 1.0,
                    surface_area_dm2=setup.get("surfaceAreaDm2") if isinstance(setup, dict) else None,
                    feature_count=len(features) if features else None,
                    cycle_time_s=total_machining_time_s,
                    setup_time_s=setup_time_s,
                )
            )
            if "stats" not in result:
                result["stats"] = {}
            result["stats"]["costEstimate"] = cost_estimate_result.model_dump()
            
            # also update planned cycle time
            result["planned_cycle_time_seconds"] = total_machining_time_s
        except Exception as e:
            print(f"Cost estimation failed: {e}")
            if "stats" not in result:
                result["stats"] = {}
            result["stats"]["costEstimate"] = {
                "status": "error",
                "currency": "USD",
                "errors": [{"code": "ESTIMATION_FAILED", "message": str(e)}]
            }
            
        job_dir = Path(__file__).resolve().parents[4] / "storage" / "jobs" / request.job_id / "cam"
        job_dir.mkdir(parents=True, exist_ok=True)
        
        with open(job_dir / "cam_toolpaths.json", "w") as f:
            json.dump({"toolpath_schema_version": "semantic_v1", "toolpaths": flat_paths}, f)
        with open(job_dir / "cam_operations.json", "w") as f:
            json.dump({"operations": operations}, f)
        
        # Store engine input so the /cam/gcode endpoint can resolve setup, controller, and tools
        with open(job_dir / "cam_toolpath_engine_input.json", "w") as f:
            json.dump({
                "setup": request.machine_config,
                "tools": tools,
                "operations": operations
            }, f)
            
        with open(job_dir / "cam_hashes.json", "w") as f:
            json.dump({
                "modelHash": "parametric",
                "toolpath_schema_version": "semantic_v1",
                "operations": {op["id"]: "parametric" for op in operations}
            }, f)
            
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
            "planned_cycle_time_seconds": result.get("planned_cycle_time_seconds", 0),
            "stats": result.get("stats", {})
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
        from app.services.cam.brep_feature_extractor import BRepFeatureExtractor
        
        # Build feature map — prioritize frontend-sent features (which already
        # contain B-Rep-corrected centers from the /cam/analyze step).
        feature_map = {}
        
        # 1. Primary source: features sent by the frontend (already B-Rep corrected)
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
                    feature_map[f["id"]] = f
        
        # 2. Fallback: if no frontend features, re-extract with B-Rep data
        if not feature_map:
            outputs_dir = Path(__file__).resolve().parents[3] / "outputs"
            step_path = outputs_dir / f"cad_{request.session_id}.step"
            
            brep_data = None
            if step_path.exists():
                brep_extractor = BRepFeatureExtractor(str(step_path))
                brep_data = brep_extractor.analyze()
            
            extractor = ParametricFeatureExtractor()
            features = extractor.extract(request.parameters, setup=request.setup, brep_data=brep_data)
            feature_map = {f.get("id"): f for f in features if isinstance(f, dict) and f.get("id")}
        
        from app.services.cam.cycle_time_estimator import CycleTimeEstimator
        from app.models.schemas import ToolpathSegment
        from app.models.manufacturing import MachineProfile
        engine = ParametricToolpathEngine()
        machine = MachineProfile(machine_id="m1", machine_name="Default Mill", machine_type="3_axis_mill", axis_count=3)
        
        flat_paths = []
        total_cycle_time = 0.0
        
        # Wire tools to operations
        tool_map = {t.get("id"): t for t in (request.tools or []) if isinstance(t, dict)}
        
        for op in request.operations:
            fid = op.get("feature_id") or op.get("featureId")
            feature = feature_map.get(fid, {})
            
            tool_id = op.get("tool_id") or op.get("toolId")
            if tool_id and tool_id in tool_map:
                op["tool"] = tool_map[tool_id]

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
            
            from app.services.planning.planning_context import PlanningContext
            planning_context = PlanningContext(
                setup=request.setup if isinstance(request.setup, dict) else {},
                machine_profile=machine.model_dump(),
                material=None,
                features=list(feature_map.values())
            )
            paths, validation_result = engine.generate_toolpath(op, feature, request.setup, planning_context)
            if setup_id:
                for p in paths:
                    p["setupId"] = setup_id
            op["toolpaths"] = paths
            op["status"] = "generated" if validation_result.get("valid", True) else "blocked"
            if not validation_result.get("valid", True):
                op["validation_errors"] = validation_result.get("errors", [])
                if not op.get("parameters"):
                    op["parameters"] = {}
                op["parameters"]["errorReason"] = validation_result["errors"][0] if validation_result.get("errors") else "Toolpath generation failed."
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
            
        # Store enriched operations (with tool + toolpaths attached)
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


# ── Knowledge Base Management Endpoints ──────────────────────────────────────

@router.get("/knowledge/documents")
async def list_knowledge_documents():
    try:
        from app.services.knowledge.repository import KnowledgeRepository
        repo = KnowledgeRepository()
        docs = repo.list_documents()
        return {"documents": [d.model_dump() for d in docs]}
    except Exception as exc:
        print(f"[Knowledge] List documents error: {exc}")
        return {"documents": []}


@router.post("/knowledge/documents/ingest")
async def ingest_knowledge_document(file: UploadFile = File(...)):
    import tempfile
    from pathlib import Path
    try:
        from app.services.knowledge.pipeline import KnowledgeIngestionPipeline
        
        temp_dir = Path(tempfile.gettempdir()) / "vexcad_knowledge"
        temp_dir.mkdir(parents=True, exist_ok=True)
        temp_file = temp_dir / file.filename

        content = await file.read()
        temp_file.write_bytes(content)

        pipeline = KnowledgeIngestionPipeline()
        doc_schema, rules = await pipeline.process_pdf(str(temp_file))

        temp_file.unlink(missing_ok=True)
        return {
            "success": True,
            "document": doc_schema.model_dump(),
            "rules_count": len(rules)
        }
    except Exception as exc:
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail={"error": {"message": f"Knowledge ingestion failed: {exc}"}}
        )


@router.post("/knowledge/retrieve")
async def retrieve_knowledge(query: Dict[str, Any]):
    try:
        from app.services.knowledge.retriever import KnowledgeRetriever
        from app.services.knowledge.schemas import KnowledgeRetrievalQuery
        
        q = KnowledgeRetrievalQuery(
            query=query.get("query", ""),
            detected_symbols=query.get("detected_symbols", []),
            feature_candidates=query.get("feature_candidates", []),
            active_standards=query.get("active_standards", ["ISO", "DIN", "ASME"])
        )
        retriever = KnowledgeRetriever()
        res = retriever.retrieve(q)
        return res.model_dump()
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail={"error": {"message": f"Knowledge retrieval failed: {exc}"}}
        )


@router.delete("/knowledge/documents/{doc_id}")
async def delete_knowledge_document(doc_id: str):
    try:
        from app.services.knowledge.repository import KnowledgeRepository
        repo = KnowledgeRepository()
        repo.delete_document(doc_id)
        return {"success": True, "deleted": doc_id}
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail={"error": {"message": f"Failed to delete document: {exc}"}}
        )


@router.post("/cam/recommend-machine")
async def recommend_machine(req: MachineRecommendationRequest) -> Dict[str, Any]:
    """
    Intelligently recommends the best CNC machine profile based on features,
    topology, stock dimensions, and blueprint annotations.
    """
    try:
        from app.services.planning.machine_recommendation_engine import MachineRecommendationEngine
        engine = MachineRecommendationEngine()
        res = engine.recommend_machine(
            features=req.features,
            topology_info=req.topologyInfo,
            stock_dimensions=req.stockDimensions,
            blueprint_data=req.blueprintData,
            parameters=req.parameters,
            python_script=req.pythonScript
        )
        return res.model_dump()

    except Exception as exc:
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail={"error": {"message": f"Machine recommendation failed: {exc}"}}
        )


@router.post("/assistant/compare-and-prompt", response_model=CADPromptAssistantResponse)
async def assistant_compare_and_prompt(req: CADPromptAssistantRequest):
    """
    Multimodal CAD Prompt Co-Pilot: Compares reference 2D blueprint with live 3D canvas snapshot,
    pinpoints geometric discrepancies, and constructs precision build123d prompts.
    """
    try:
        from app.services.agents.cad_prompt_assistant import CADPromptAssistantService
        service = CADPromptAssistantService()
        result = await service.compare_and_suggest_prompt(
            blueprint_image=req.blueprint_image,
            model_snapshot=req.model_snapshot,
            model_snapshots=req.model_snapshots,
            user_message=req.message,
            chat_history=req.history,
            model_override=req.model,
        )
        return CADPromptAssistantResponse(
            reply=result.get("reply", ""),
            analysis=result.get("analysis"),
            suggested_prompt=result.get("suggested_prompt"),
            error=result.get("error"),
        )
    except Exception as exc:
        import traceback
        traceback.print_exc()
        return CADPromptAssistantResponse(
            reply=f"Error in prompt assistant: {exc}",
            analysis=None,
            suggested_prompt=None,
            error=str(exc),
        )


@router.get("/assistant/dictionary")
async def assistant_dictionary():
    """Returns active mechanical vocabulary taxonomy used by the Prompt Assistant."""
    try:
        from app.services.agents.cad_prompt_assistant import CADPromptAssistantService
        service = CADPromptAssistantService()
        entries = service.get_parts_dictionary()
        return {
            "count": len(entries),
            "entries": entries,
        }
    except Exception as exc:
        return {"count": 0, "entries": [], "error": str(exc)}



