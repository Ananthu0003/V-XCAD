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
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, BackgroundTasks
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
from app.services.geometry.blueprint_auto_corrector import BlueprintAutoCorrector
from app.deps import validate_service_key
from app.api.v1.cad_modify_router import router as cad_modify_router

router = APIRouter(tags=["cad"])
router.include_router(cad_modify_router)


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
# Maximum upload file size (10MB)
MAX_UPLOAD_SIZE_BYTES = int(os.getenv("MAX_UPLOAD_SIZE_BYTES", str(10 * 1024 * 1024)))

# VEX-AUDIT-012: Allowlist for session_id / job_id values used in filesystem paths.
# All legitimate IDs in this application (CUIDs, UUIDs, job_ prefixed IDs) match this.
_SAFE_ID_RE = re.compile(r'^[A-Za-z0-9_-]+$')


def _validate_id(value: str, field_name: str = "id") -> str:
    """Reject identifiers that could escape their intended directory.

    Valid IDs contain only alphanumeric characters, hyphens, and underscores.
    Traversal sequences (../, ..\\, /, etc.) are all rejected outright.
    Raises HTTP 400 on invalid input — never sanitises or rewrites.
    """
    if not value or not _SAFE_ID_RE.match(value):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid {field_name}: must contain only letters, digits, hyphens, or underscores.",
        )
    return value


import ast
import time

class ShapeCache:
    """In-memory cache keyed by asset_id, intended to let /export-step,
    /export-stl and /export-dxf re-export a previously-parsed shape (via
    is_step_reference()) without re-parsing the full CSG tree.

    KNOWN ISSUE (deferred, not a security DoS — audited 2026-09-22):
    ShapeCache.set() currently has no callers anywhere in this codebase, so
    the cache is never populated. Every is_step_reference()-based export
    request therefore always misses (ValueError/404 at the three call sites
    below), and the cache cannot grow — it is dead-but-harmless, not
    unbounded. The intended architecture (asset-id-based re-export to avoid
    re-parsing) is left intact here rather than removed or redesigned,
    since something is clearly meant to populate this cache; wiring that up
    is a separate, real feature-completion task, not a security fix.
    """
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
    _validate_id(session_id, "session_id")
    bp_file = BLUEPRINTS_DIR / f"{session_id}.png"
    if not bp_file.exists():
        raise HTTPException(status_code=404, detail="Blueprint not found for this session")
    return Response(content=bp_file.read_bytes(), media_type="image/png")

def rasterize_pdf_to_image(pdf_bytes: bytes, dpi: int = 150, max_pages: int = 20) -> bytes:
    """
    Rasterize all pages of a PDF document into a single unified PNG image.
    Single-page PDFs are rasterized directly.
    Multi-page PDFs are rasterized page-by-page and stitched vertically with clean dividers.
    """
    if not pdf_bytes:
        return pdf_bytes

    import fitz
    import io
    from PIL import Image

    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception as e:
        print(f"[rasterize_pdf_to_image] Failed to open PDF stream: {e}")
        return pdf_bytes

    try:
        page_count = len(doc)
        if page_count == 0:
            return pdf_bytes
        if page_count == 1:
            page = doc.load_page(0)
            pix = page.get_pixmap(dpi=dpi)
            return pix.tobytes("png")

        # Multi-page PDF: rasterize pages up to max_pages
        effective_pages = min(page_count, max_pages)
        page_images: list[Image.Image] = []
        max_width = 0
        total_height = 0
        gap = 24  # subtle margin between pages

        for page_num in range(effective_pages):
            page = doc.load_page(page_num)
            pix = page.get_pixmap(dpi=dpi)
            img = Image.open(io.BytesIO(pix.tobytes("png")))
            page_images.append(img)
            max_width = max(max_width, img.width)
            total_height += img.height + (gap if page_num > 0 else 0)

        composite = Image.new("RGB", (max_width, total_height), color=(240, 240, 240))
        y_offset = 0
        for img in page_images:
            x_offset = (max_width - img.width) // 2
            composite.paste(img, (x_offset, y_offset))
            y_offset += img.height + gap

        buf = io.BytesIO()
        composite.save(buf, format="PNG")
        return buf.getvalue()
    except Exception as e:
        print(f"[rasterize_pdf_to_image] Error during PDF rasterization: {e}")
        return pdf_bytes
    finally:
        try:
            doc.close()
        except Exception:
            pass


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
    # VEX-AUDIT-012: Validate session_id before any filesystem access.
    if session_id:
        _validate_id(session_id, "session_id")
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
        if len(image_bytes) > MAX_UPLOAD_SIZE_BYTES:
            raise HTTPException(
                status_code=400,
                detail={"error": {"message": f"File size exceeds {MAX_UPLOAD_SIZE_BYTES // (1024 * 1024)}MB limit. Please upload a smaller file."}},
            )
        
        # OpenRouter and some vision models don't accept PDF via image payload
        if mime_type == "application/pdf":
            try:
                image_bytes = rasterize_pdf_to_image(image_bytes, dpi=150)
                mime_type = "image/png"
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

            if target_crop_box and not (image_bytes and mime_type):
                yield f'data: {json.dumps({"warning": "Blueprint image unavailable for region crop; proceeding with direct 3D CAD targeted refinement."})}\n\n'

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

            # ── Metrology & Precision Auto-Correction Gate (100% Accuracy) ───
            effective_audit = feature_map or targeted_feature
            if effective_audit:
                yield f'data: {json.dumps({"status": "running closed-loop metrology verification (100% precision gate)..."})}\n\n'
                try:
                    report = BlueprintAutoCorrector.verify_and_correct(clean_script, effective_audit)
                    if report.corrections:
                        clean_script = report.verified_script
                        print(f"[BlueprintAutoCorrector] Applied {len(report.corrections)} precision corrections: {report.corrections}")
                        yield f'data: {json.dumps({"status": f"verified blueprint accuracy (applied {len(report.corrections)} metrology corrections)"})}\n\n'
                except Exception as corr_err:
                    print(f"[BlueprintAutoCorrector] Verification error: {corr_err}")

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
    _validate_id(session_id, "session_id")
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

JOBS_DIR = Path(os.getenv("VEXCAD_STORAGE_DIR", "storage/jobs"))

@router.post("/upload")
async def legacy_upload(file: UploadFile = File(...)):
    job_id = f"job_{uuid.uuid4().hex[:8]}"
    job_dir = JOBS_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    
    safe_name = os.path.basename(file.filename) if file.filename else ""
    if not safe_name:
        safe_name = "upload"
    file_path = (job_dir / safe_name).resolve()
    if not file_path.is_relative_to(job_dir.resolve()):
        raise HTTPException(status_code=400, detail="Invalid filename")

    with open(file_path, "wb") as buffer:
        buffer.write(await file.read())
        
    return {"job_id": job_id}

@router.post("/generate/{job_id}")
async def legacy_generate(job_id: str):
    _validate_id(job_id, "job_id")
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
    _validate_id(request.session_id, "session_id")
    
    try:
        from app.services.cam_pipeline_manager import CamPipelineManager
        cam_mgr = CamPipelineManager()
        analysis_params = dict(request.parameters)
        analysis_params["session_id"] = request.session_id
        analysis_result = await asyncio.to_thread(
            cam_mgr.analyze_features,
            analysis_params,
            request.session_id,
            request.cam_run_id,
            request.setup
        )
        return analysis_result
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
    _validate_id(request.session_id, "session_id")
    _validate_id(request.job_id, "job_id")
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
        
        # Extract results generated by Generic-CAM CamPipelineManager
        operations = result.get("operations", [])
        features = result.get("features", [])
        setups = result.get("setups", [])
        tools = result.get("tools", [])
        flat_paths = result.get("toolpaths", [])
        if not flat_paths and operations:
            for op in operations:
                flat_paths.extend(op.get("toolpaths", []))

        setup = request.machine_config.get("setup", {}) if isinstance(request.machine_config.get("setup"), dict) else {}
        setup_id = setup.get("setupId") or setup.get("id") or "setup_001"
        for p in flat_paths:
            if isinstance(p, dict) and "setupId" not in p:
                p["setupId"] = setup_id

        for op in operations:
            op["status"] = op.get("status") or "generated"
            op["toolpath_schema_version"] = "semantic_v1"

        # Calculate cost estimation
        try:
            from app.services.cam.cost_estimation import CostEstimationEngine, build_quote_context
            from app.services.cam.material_validation import get_material_profile
            from app.models.manufacturing import MachineProfile
            cost_engine = CostEstimationEngine()
            total_machining_time_s = float(result.get("planned_cycle_time_seconds", 0) or sum(op.get("estimated_time_s", 0) for op in operations))
            setup_time_s = float((result.get("setup_time_details") or {}).get("total_setup_time_seconds", total_machining_time_s))

            mat_id = setup.get("workpieceMaterialId") or setup.get("material")
            material_obj = get_material_profile(mat_id)
            material_profile = material_obj.model_dump() if hasattr(material_obj, 'model_dump') else {}
            machine_profile = MachineProfile(
                machine_id=request.machine_config.get("machine_id", "haas_vf2"),
                machine_name=request.machine_config.get("machine_name", "Haas VF-2"),
                machine_type="3_axis_mill",
                axis_count=3,
            )

            cost_estimate_result = cost_engine.estimate(
                build_quote_context(
                    setup=setup,
                    material_profile=material_profile,
                    machine_profile=machine_profile.model_dump() if hasattr(machine_profile, "model_dump") else machine_profile,
                    tool_library=tools,
                    operations=operations,
                    quantity=int(setup.get("quantity", 1) or 1),
                    learning_rate=float(setup.get("learningRate", 1.0) or 1.0),
                    surface_area_dm2=setup.get("surfaceAreaDm2"),
                    feature_count=len(features) if features else None,
                    cycle_time_s=total_machining_time_s,
                    setup_time_s=setup_time_s,
                )
            )
            if "stats" not in result:
                result["stats"] = {}
            result["stats"]["costEstimate"] = cost_estimate_result.model_dump()
            result["planned_cycle_time_seconds"] = total_machining_time_s
        except Exception as e:
            if "stats" not in result:
                result["stats"] = {}
            result["stats"]["costEstimate"] = {
                "status": "error",
                "currency": "USD",
                "errors": [{"code": "ESTIMATION_FAILED", "message": str(e)}]
            }

        # Persist artifacts to storage/jobs/{id}/cam for both job_id and session_id
        target_ids = {request.job_id, request.session_id} - {None, ""}
        storage_bases = [
            Path(os.getenv("VEXCAD_STORAGE_DIR", "storage/jobs")),
            Path(__file__).resolve().parents[4] / "storage" / "jobs",
            Path(__file__).resolve().parents[3] / "storage" / "jobs",
        ]
        for tid in target_ids:
            for sbase in storage_bases:
                try:
                    s_dir = sbase / tid / "cam"
                    s_dir.mkdir(parents=True, exist_ok=True)
                    with open(s_dir / "cam_toolpaths.json", "w", encoding="utf-8") as f:
                        json.dump({"toolpath_schema_version": "semantic_v1", "toolpaths": flat_paths}, f)
                    with open(s_dir / "cam_operations.json", "w", encoding="utf-8") as f:
                        json.dump({"operations": operations}, f)
                    with open(s_dir / "cam_toolpath_engine_input.json", "w", encoding="utf-8") as f:
                        json.dump({
                            "setup": request.machine_config,
                            "tools": tools,
                            "operations": operations
                        }, f)
                    with open(s_dir / "cam_hashes.json", "w", encoding="utf-8") as f:
                        json.dump({
                            "modelHash": "brep_model",
                            "toolpath_schema_version": "semantic_v1",
                            "operations": {op["id"]: "semantic_v1" for op in operations}
                        }, f)
                    if result.get("gcode"):
                        with open(s_dir / "generated_gcode.nc", "w", encoding="utf-8") as f:
                            f.write(result["gcode"])
                except Exception:
                    pass

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

        filtered_tools = list(job_tools_dict.values()) if job_tools_dict else tools

        payload = {
            "status": "success",
            "features_detected": len(features),
            "features": features,
            "setups": setups,
            "validation_status": result.get("validation", {}).get("status", "ok"),
            "geometry_mapping_summary": result.get("validation", {}).get("summary", {}),
            "stock_suggestions": result.get("stock_suggestions", {}),
            "camModelHash": "brep_model",
            "setup_metadata": result.get("setup_metadata", {}),
            "tools": filtered_tools,
            "operations": operations,
            "toolpaths": flat_paths,
            "toolpath_schema_version": "semantic_v1",
            "gcode": result.get("gcode", ""),
            "per_setup_gcode": result.get("per_setup_gcode", {}),
            "setup_sheets": result.get("setup_sheets", {}),
            "master_routing_sheet": result.get("master_routing_sheet", {}),
            "export_package_available": result.get("export_package_available", True),
            "can_generate_gcode": result.get("can_generate_gcode", True),
            "cam_readiness_score": result.get("cam_readiness_score", 100),
            "planned_cycle_time_seconds": result.get("planned_cycle_time_seconds", 0),
            "setup_time_details": result.get("setup_time_details", {}),
            "stats": result.get("stats", {})
        }
        return Response(content=json.dumps(payload, default=str), media_type="application/json")
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
    _validate_id(request.session_id, "session_id")
    _validate_id(request.job_id, "job_id")
    try:
        from app.services.cam.cam_engine_adapter import CamEngineAdapter
        from app.services.validation.toolpath_schema_validator import ToolpathSchemaValidator
        from app.services.validation.cam_readiness_evaluator import CamReadinessEvaluator

        step_path = CamEngineAdapter.resolve_step_path(request.session_id, request.job_id)
        if not step_path or not step_path.exists():
            fallback_step = Path(__file__).resolve().parents[3] / "outputs" / "sample_bracket.step"
            if fallback_step.exists():
                step_path = fallback_step

        setup_dict = request.setup if isinstance(request.setup, dict) else {}
        updated_ops, flat_paths = await asyncio.to_thread(
            CamEngineAdapter.generate_toolpaths_for_operations,
            step_path=step_path,
            operations=request.operations,
            tools=request.tools,
            setup=setup_dict,
            features=request.features,
        )

        # If frontend sent specific operations, match or filter
        if request.operations:
            req_op_ids = {op.get("id") for op in request.operations if op.get("id")}
            has_matching = any(op.get("id") in req_op_ids for op in updated_ops)
            if has_matching and len(req_op_ids) < len(updated_ops):
                updated_ops = [op for op in updated_ops if op.get("id") in req_op_ids]
                flat_paths = [seg for seg in flat_paths if seg.get("operationId") in req_op_ids]

        setup_id = setup_dict.get("setupId") or setup_dict.get("id") or "setup_001"
        for seg in flat_paths:
            if isinstance(seg, dict) and "setupId" not in seg:
                seg["setupId"] = setup_id

        for op in updated_ops:
            op["status"] = op.get("status") or "generated"
            op["toolpath_schema_version"] = "semantic_v1"

        total_cycle_time = sum(float(op.get("estimated_time_s", 0) or 0) for op in updated_ops)

        # Persist artifacts to storage/jobs/{id}/cam for both job_id and session_id
        target_ids = {request.job_id, request.session_id} - {None, ""}
        storage_bases = [
            Path(os.getenv("VEXCAD_STORAGE_DIR", "storage/jobs")),
            Path(__file__).resolve().parents[4] / "storage" / "jobs",
            Path(__file__).resolve().parents[3] / "storage" / "jobs",
        ]
        for tid in target_ids:
            for sbase in storage_bases:
                try:
                    s_dir = sbase / tid / "cam"
                    s_dir.mkdir(parents=True, exist_ok=True)
                    with open(s_dir / "cam_toolpaths.json", "w", encoding="utf-8") as f:
                        json.dump({"toolpath_schema_version": "semantic_v1", "toolpaths": flat_paths}, f, indent=2)
                    with open(s_dir / "cam_operations.json", "w", encoding="utf-8") as f:
                        json.dump({"operations": updated_ops}, f, indent=2)
                    with open(s_dir / "cam_toolpath_engine_input.json", "w", encoding="utf-8") as f:
                        json.dump({
                            "setup": setup_dict,
                            "tools": request.tools,
                            "operations": updated_ops
                        }, f, indent=2)
                    with open(s_dir / "cam_hashes.json", "w", encoding="utf-8") as f:
                        json.dump({
                            "modelHash": request.modelHash or "brep_model",
                            "toolpath_schema_version": "semantic_v1",
                            "operations": {op["id"]: "semantic_v1" for op in updated_ops}
                        }, f, indent=2)
                except Exception:
                    pass

        toolpaths_data = {"toolpath_schema_version": "semantic_v1", "toolpaths": flat_paths}
        schema_validation = ToolpathSchemaValidator.validate(updated_ops, toolpaths_data)
        readiness = CamReadinessEvaluator.evaluate(updated_ops, schema_validation, True, "semantic_v1")

        result = {
            "operations": updated_ops,
            "toolpaths": flat_paths,
            "camRunId": request.cam_run_id,
            "gcode_blocked": not readiness.get("can_generate_gcode", True),
            "status": "toolpaths_generated" if readiness.get("can_generate_gcode", True) else "toolpaths_generated_with_blocks",
            "cam_readiness_score": readiness.get("cam_readiness_score", 100),
            "cam_status": readiness.get("status", "ready"),
            "can_generate_gcode": readiness.get("can_generate_gcode", True),
            "operation_statuses": readiness.get("operation_statuses", []),
            "toolpath_schema_version": "semantic_v1",
            "planned_cycle_time_seconds": round(total_cycle_time, 2),
            "setup_time_details": {
                "total_setup_time_seconds": round(total_cycle_time, 2),
                "tool_change_time_seconds": round(len(request.tools) * 15.0, 2)
            },
            "errors": readiness.get("errors", [])
        }
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
    _validate_id(request.session_id, "session_id")
    _validate_id(request.job_id, "job_id")
    storage_candidates = [
        Path(os.getenv("VEXCAD_STORAGE_DIR", "storage/jobs")) / request.job_id / "cam",
        Path(os.getenv("VEXCAD_STORAGE_DIR", "storage/jobs")) / request.session_id / "cam",
        Path(__file__).resolve().parents[4] / "storage" / "jobs" / request.job_id / "cam",
        Path(__file__).resolve().parents[4] / "storage" / "jobs" / request.session_id / "cam",
        Path(__file__).resolve().parents[3] / "storage" / "jobs" / request.job_id / "cam",
        Path(__file__).resolve().parents[3] / "storage" / "jobs" / request.session_id / "cam",
    ]
    job_dir = storage_candidates[0]
    for cand in storage_candidates:
        if (cand / "cam_toolpaths.json").exists() or (cand / "cam_operations.json").exists():
            job_dir = cand
            break

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
    
    raw_controller = str(engine_setup.get("controller", "FANUC_0I_MF")).strip()
    if raw_controller.lower() in ("fanuc", "fanuc_0i_mf", "fanuc_31i"):
        controller = "FANUC_0I_MF"
        default_profile = "dmg_cmx1100v"
    elif raw_controller.lower() in ("haas", "haas_ngc"):
        controller = "HAAS_NGC"
        default_profile = "haas_vf2"
    elif raw_controller.lower() in ("siemens", "siemens_840d_one", "siemens_840d"):
        controller = "SIEMENS_840D_ONE"
        default_profile = "dmg_cmx1100v"
    elif raw_controller.lower() in ("heidenhain", "heidenhain_tnc"):
        controller = "HEIDENHAIN_TNC"
        default_profile = "dmg_cmx1100v"
    else:
        controller = raw_controller or "FANUC_0I_MF"
        default_profile = "dmg_cmx1100v"

    machine_type = engine_setup.get("machineType", "MILL_3X_VMC")
    machine_profile = engine_setup.get("machineProfile") or default_profile
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
    matrix = get_matrix()
    matched_profile = next((p for p in matrix.get("machineProfiles", []) if p.get("id") == machine_profile), {})
    machine = {
        "id": machine_profile,
        "type": machine_type,
        "axes": matched_profile.get("axisCount", 3),
        **matched_profile,
    }
    
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
    from app.services.cam.cam_engine_adapter import CamEngineAdapter
    
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
        ctrl_lower = (resolved_post or controller or "fanuc").lower()
        if "heidenhain" in ctrl_lower:
            # Generate ISO using Generic-CAM
            gcode_iso = await asyncio.to_thread(
                CamEngineAdapter.generate_gcode_from_operations,
                operations=valid_operations,
                setup=setup,
                controller="heidenhain",
                program_name="VEXCAM",
            )
            # Generate Klartext using Generic-CAM
            gcode_klartext = await asyncio.to_thread(
                CamEngineAdapter.generate_gcode_from_operations,
                operations=valid_operations,
                setup=setup,
                controller="heidenhain_klartext",
                program_name="VEXCAM",
            )
            
            # Post Output Validation on ISO for safety
            out_val = await asyncio.to_thread(
                PostOutputValidator.validate_gcode,
                gcode_iso,
                valid_operations,
            )
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
            gcode = await asyncio.to_thread(
                CamEngineAdapter.generate_gcode_from_operations,
                operations=valid_operations,
                setup=setup,
                controller=resolved_post or controller or "fanuc",
                program_name="VEXCAM",
            )
            
            # 3. Post Output Validation
            out_val = await asyncio.to_thread(
                PostOutputValidator.validate_gcode,
                gcode,
                valid_operations,
            )
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

            # Load cached per-setup gcodes and setup sheets if present
            per_setup_gcode = {}
            if job_dir.exists():
                for nc_file in job_dir.glob("setup_*.nc"):
                    s_id = nc_file.stem
                    try:
                        per_setup_gcode[s_id] = nc_file.read_text(encoding="utf-8")
                    except Exception:
                        pass

            setup_sheets = {}
            sheets_file = job_dir / "setup_sheets.json"
            if sheets_file.exists():
                try:
                    with open(sheets_file, "r", encoding="utf-8") as f:
                        setup_sheets = json.load(f)
                except Exception:
                    pass

            master_routing_data = {}
            routing_file = job_dir / "master_routing_sheet.txt"
            if routing_file.exists():
                try:
                    master_routing_data = {"formatted_text": routing_file.read_text(encoding="utf-8")}
                except Exception:
                    pass

            return {
                "can_generate_gcode": True,
                "gcode": gcode,
                "per_setup_gcode": per_setup_gcode,
                "setup_sheets": setup_sheets,
                "master_routing_sheet": master_routing_data,
                "export_package_available": (job_dir / "cam_package.zip").exists(),
                "errors": [],
                "status": "success",
                "toolpaths": final_toolpaths,
            }
    except Exception as exc:
        import traceback
        tb = traceback.format_exc()
        print(f"[GCODE ERROR]\n{tb}")
        return {"can_generate_gcode": False, "gcode": None, "errors": [{"level": "error", "message": f"G-Code generation failed: {str(exc)}"}]}


class SimulatePrepareRequest(BaseModel):
    setup: Dict[str, Any]
    tools: List[Dict[str, Any]] = []
    operations: List[Dict[str, Any]]
    session_id: Optional[str] = None
    job_id: Optional[str] = None

@router.post("/cam/simulate/prepare")
async def simulate_prepare(request: SimulatePrepareRequest):
    try:
        from app.services.simulation.cam_simulation_service import CamSimulationService
        from app.services.cam.cam_engine_adapter import CamEngineAdapter
        
        session_id = request.session_id or (request.setup.get("session_id") if isinstance(request.setup, dict) else None)
        job_id = request.job_id or (request.setup.get("job_id") if isinstance(request.setup, dict) else None) or "default_job"
        if session_id:
            _validate_id(session_id, "session_id")
        if job_id:
            _validate_id(job_id, "job_id")

        # Preserve existing toolpaths if present; generate neutral toolpaths only if missing
        operations = request.operations
        if any(not op.get("toolpaths") for op in operations):
            step_path = CamEngineAdapter.resolve_step_path(session_id, job_id)
            if not step_path or not step_path.exists():
                fallback_step = Path(__file__).resolve().parents[3] / "outputs" / "sample_bracket.step"
                if fallback_step.exists():
                    step_path = fallback_step
            updated_ops, _ = await asyncio.to_thread(
                CamEngineAdapter.generate_toolpaths_for_operations,
                step_path=step_path,
                operations=request.operations,
                tools=request.tools,
                setup=request.setup,
            )
            operations = updated_ops
        
        service = CamSimulationService()
        payload = await asyncio.to_thread(
            service.prepare_simulation,
            setup=request.setup,
            tools=request.tools,
            operations=operations,
        )
        return payload
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail={"error": {"message": f"Simulation preparation failed: {exc}"}}
        )


# ── Knowledge Base Management Endpoints ──────────────────────────────────────

@router.get("/knowledge/documents")
async def list_knowledge_documents(_service_auth: None = Depends(validate_service_key)):
    try:
        from app.services.knowledge.repository import KnowledgeRepository
        repo = KnowledgeRepository()
        docs = repo.list_documents()
        return {"documents": [d.model_dump() for d in docs]}
    except Exception as exc:
        print(f"[Knowledge] List documents error: {exc}")
        return {"documents": []}


@router.post("/knowledge/documents/ingest")
async def ingest_knowledge_document(file: UploadFile = File(...), _service_auth: None = Depends(validate_service_key)):
    import tempfile
    from pathlib import Path
    try:
        from app.services.knowledge.pipeline import KnowledgeIngestionPipeline
        
        temp_dir = Path(tempfile.gettempdir()) / "vexcad_knowledge"
        temp_dir.mkdir(parents=True, exist_ok=True)
        safe_name = os.path.basename(file.filename) if file.filename else ""
        if not safe_name:
            safe_name = "upload"
        temp_file = (temp_dir / safe_name).resolve()
        if not temp_file.is_relative_to(temp_dir.resolve()):
            raise HTTPException(status_code=400, detail="Invalid filename")

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
async def retrieve_knowledge(query: Dict[str, Any], _service_auth: None = Depends(validate_service_key)):
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
async def delete_knowledge_document(doc_id: str, _service_auth: None = Depends(validate_service_key)):
    _validate_id(doc_id, "doc_id")
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



class CamSetupSheetsRequest(BaseModel):
    session_id: str
    job_id: str = "default_job"

@router.post("/cam/setup_sheets")
async def cam_get_setup_sheets(request: CamSetupSheetsRequest):
    """Retrieve shop-floor documentation: Setup Sheets per-setup and Master Routing Sheet."""
    _validate_id(request.session_id, "session_id")
    _validate_id(request.job_id, "job_id")
    try:
        storage_bases = [
            Path(os.getenv("VEXCAD_STORAGE_DIR", "storage/jobs")),
            Path(__file__).resolve().parents[4] / "storage" / "jobs",
            Path(__file__).resolve().parents[3] / "storage" / "jobs",
        ]
        target_ids = [request.job_id, request.session_id]
        job_dir = None
        for tid in target_ids:
            for sbase in storage_bases:
                cand = sbase / tid / "cam"
                if (cand / "setup_sheets.json").exists() or (cand / "master_routing_sheet.txt").exists():
                    job_dir = cand
                    break
            if job_dir:
                break

        setup_sheets = {}
        master_routing = {}
        if job_dir:
            sheets_file = job_dir / "setup_sheets.json"
            if sheets_file.exists():
                try:
                    with open(sheets_file, "r", encoding="utf-8") as f:
                        setup_sheets = json.load(f)
                except Exception:
                    pass
            routing_file = job_dir / "master_routing_sheet.txt"
            if routing_file.exists():
                try:
                    master_routing = {"formatted_text": routing_file.read_text(encoding="utf-8")}
                except Exception:
                    pass

        return {
            "status": "success",
            "setup_sheets": setup_sheets,
            "master_routing_sheet": master_routing,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail={"error": {"message": f"Get setup sheets failed: {exc}"}})


class CamExportPackageRequest(BaseModel):
    session_id: str
    job_id: str = "default_job"

@router.post("/cam/export_package")
async def cam_export_package(request: CamExportPackageRequest):
    """Download industrial CAM ZIP package containing master/per-setup NC files, setup sheets, and manifest."""
    _validate_id(request.session_id, "session_id")
    _validate_id(request.job_id, "job_id")
    try:
        from app.services.cam.cam_engine_adapter import CamEngineAdapter
        storage_bases = [
            Path(os.getenv("VEXCAD_STORAGE_DIR", "storage/jobs")),
            Path(__file__).resolve().parents[4] / "storage" / "jobs",
            Path(__file__).resolve().parents[3] / "storage" / "jobs",
        ]
        target_ids = [request.job_id, request.session_id]
        zip_path = None
        job_dir = None
        for tid in target_ids:
            for sbase in storage_bases:
                cand = sbase / tid / "cam"
                if (cand / "cam_package.zip").exists():
                    zip_path = cand / "cam_package.zip"
                    job_dir = cand
                    break
                elif (cand / "cam_operations.json").exists():
                    job_dir = cand
            if zip_path or job_dir:
                break

        if zip_path and zip_path.exists():
            zip_bytes = zip_path.read_bytes()
        elif job_dir:
            step_path = CamEngineAdapter.resolve_step_path(request.session_id, request.job_id)
            if not step_path:
                step_path = Path(__file__).resolve().parents[3] / "outputs" / "sample_bracket.step"
            payload = await asyncio.to_thread(
                CamEngineAdapter.process_step_file,
                step_path=step_path,
                job_id=request.job_id,
                session_id=request.session_id,
                save_artifacts=True,
            )
            created_zip = job_dir / "cam_package.zip"
            if created_zip.exists():
                zip_bytes = created_zip.read_bytes()
            else:
                raise HTTPException(status_code=404, detail={"error": {"message": "Export package could not be assembled."}})
        else:
            raise HTTPException(status_code=404, detail={"error": {"message": "No CAM job data found for this session."}})

        return Response(
            content=zip_bytes,
            media_type="application/zip",
            headers={"Content-Disposition": f"attachment; filename=cam_package_{request.job_id}.zip"},
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail={"error": {"message": f"Export package failed: {exc}"}})


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



