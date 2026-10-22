"""VEXCAD Manual CAD Refinement Router — /api/v1/cad/modify."""
from __future__ import annotations

import os
import re
import shutil
from pathlib import Path
from typing import Optional, Dict, Any, List, Union
from fastapi import APIRouter, HTTPException, Query, Request, UploadFile, File, Form
from fastapi.responses import FileResponse

from app.models.cad_modification import (
    CADOperation,
    CommitRequest,
    CommitResult,
    MeasureRequest,
    MeasureResult,
    PreviewRequest,
    PreviewResult,
    RecomputeRequest,
    RecomputeResult,
    RollbackRequest,
    RollbackResult,
    TopologyDataResponse,
    GeometryContext,
)
from app.services.geometry.manual_cad_service import BASE_STORAGE_DIR, ManualCADService

_SAFE_ID_RE = re.compile(r"^[A-Za-z0-9_-]+$")


def _validate_session_id(session_id: str) -> str:
    """Ensure session_id contains only alphanumeric chars, hyphens, and underscores."""
    if not isinstance(session_id, str) or not _SAFE_ID_RE.match(session_id):
        raise HTTPException(
            status_code=400,
            detail={"error": {"message": "Invalid session identifier format.", "code": "INVALID_ID"}},
        )
    return session_id


router = APIRouter(prefix="/cad/modify", tags=["manual-cad"])
cad_service = ManualCADService()


@router.post("/recompute", response_model=RecomputeResult)
async def recompute_history(request: RecomputeRequest) -> RecomputeResult:
    """Parametric recomputation of downstream operations after modifying or deleting an upstream feature."""
    try:
        _validate_session_id(request.session_id)
        cad_service.initialize_session_if_needed(request.session_id)
        return cad_service.recompute_history(request)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Parametric recompute failed: {exc}")


@router.get("/topology/{session_id}", response_model=TopologyDataResponse)
async def get_topology(
    session_id: str,
    revision_id: str = Query("rev_000", description="Target revision ID"),
    source_step: str = Query(None, description="Optional path to source STEP model"),
    force_sync: bool = Query(False, description="Force re-syncing from source STEP")
) -> TopologyDataResponse:
    """Retrieve geometric references and topology map for 3D viewport raycast selection."""
    try:
        _validate_session_id(session_id)
        base_step = None
        if source_step:
            p = Path(source_step)
            if p.exists():
                base_step = p
            else:
                filename = p.name
                for candidate_dir in [
                    Path(__file__).resolve().parents[3] / "outputs",
                    Path(__file__).resolve().parents[2] / "outputs",
                    Path("outputs"),
                ]:
                    cand = candidate_dir / filename
                    if cand.exists():
                        base_step = cand
                        break

        cad_service.initialize_session_if_needed(session_id, base_step_path=base_step, force_sync=force_sync)
        return cad_service.get_topology(session_id, revision_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to extract topology: {exc}")


@router.post("/preview", response_model=PreviewResult)
async def preview_operation(request: PreviewRequest) -> PreviewResult:
    """Non-destructive preview of a manual CAD operation."""
    try:
        _validate_session_id(request.session_id)
        cad_service.initialize_session_if_needed(request.session_id)
        return cad_service.preview_operation(request)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Preview generation failed: {exc}")


@router.post("/commit", response_model=CommitResult)
async def commit_operation(request: CommitRequest) -> CommitResult:
    """Commit a validated manual CAD operation as a new immutable revision."""
    try:
        _validate_session_id(request.session_id)
        cad_service.initialize_session_if_needed(request.session_id)
        return cad_service.commit_operation(request)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Commit failed: {exc}")


@router.post("/rollback", response_model=RollbackResult)
async def rollback_revision(request: RollbackRequest) -> RollbackResult:
    """Rollback active revision pointer without destroying history."""
    try:
        _validate_session_id(request.session_id)
        return cad_service.rollback_revision(request)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Rollback failed: {exc}")


@router.post("/measure", response_model=MeasureResult)
async def measure_geometry(request: MeasureRequest) -> MeasureResult:
    """Measure exact analytical distances, angles, and areas on B-Rep."""
    try:
        _validate_session_id(request.session_id)
        cad_service.initialize_session_if_needed(request.session_id)
        return cad_service.measure(request)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Measurement failed: {exc}")


@router.get("/context/{session_id}", response_model=GeometryContext)
async def get_geometry_context(
    session_id: str,
    revision: str = Query(..., description="Target revision ID"),
    ref: str = Query(..., description="Transient reference ID"),
    u: Optional[float] = Query(None, description="U parameter coordinate"),
    v: Optional[float] = Query(None, description="V parameter coordinate")
) -> GeometryContext:
    """Measure exact B-rep context around a selected entity."""
    try:
        _validate_session_id(session_id)
        from app.services.geometry.geometry_context import get_geometry_context as get_context
        cad_service.initialize_session_if_needed(session_id)
        return get_context(session_id, revision, ref, u, v)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Context measurement failed: {exc}")


@router.get("/history/{session_id}", response_model=list[CADOperation])
async def get_history(session_id: str) -> list[CADOperation]:
    """Retrieve the full sequence of CAD operations and their provenance."""
    try:
        _validate_session_id(session_id)
        cad_service.initialize_session_if_needed(session_id)
        return cad_service.get_history(session_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch history: {exc}")


@router.get("/file/{session_id}/{path:path}")
async def get_session_file(session_id: str, path: str):
    """Serve session artifacts (STEP / STL / DXF) securely with path traversal guards."""
    _validate_session_id(session_id)
    if ".." in path or path.startswith("/") or path.startswith("\\"):
        raise HTTPException(status_code=400, detail="Invalid file path format.")

    base_session_dir = (BASE_STORAGE_DIR / session_id).resolve()
    target_file = (base_session_dir / path).resolve()

    # Enforce strict path containment within the session's allocated directory
    if not str(target_file).startswith(str(base_session_dir)):
        raise HTTPException(status_code=403, detail="Access denied.")

    if not target_file.exists() or not target_file.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    media_types = {
        ".stl": "model/stl",
        ".step": "application/step",
        ".stp": "application/step",
        ".dxf": "application/dxf",
        ".json": "application/json",
    }
    media_type = media_types.get(target_file.suffix.lower(), "application/octet-stream")
    return FileResponse(target_file, media_type=media_type)


from pydantic import BaseModel


class ImportStepRequest(BaseModel):
    session_id: str
    filename: Optional[str] = None
    step_content_b64: Optional[str] = None


@router.post("/import-step")
async def import_step_model(request: Request):
    """
    Initializes a session from an imported STEP model, generates STL for 3D viewport,
    and caches B-Rep topology metadata.
    Supports both direct multipart/form-data file uploads and JSON requests.
    """
    try:
        content_type = request.headers.get("content-type", "")
        session_id: Optional[str] = None
        filename: Optional[str] = None
        file_bytes: Optional[bytes] = None

        if "multipart/form-data" in content_type:
            form = await request.form()
            session_id = str(form.get("session_id", ""))
            form_file = form.get("file")
            if form_file and hasattr(form_file, "read"):
                file_bytes = await form_file.read()
                filename = getattr(form_file, "filename", None) or str(form.get("filename", ""))
            elif form.get("filename"):
                filename = str(form.get("filename"))
        elif "application/json" in content_type:
            body = await request.json()
            session_id = body.get("session_id")
            filename = body.get("filename")
            if "step_content_b64" in body and body["step_content_b64"]:
                import base64
                file_bytes = base64.b64decode(body["step_content_b64"])
        else:
            try:
                body = await request.json()
                session_id = body.get("session_id")
                filename = body.get("filename")
            except Exception:
                pass

        if not session_id:
            raise HTTPException(status_code=400, detail="session_id is required")

        _validate_session_id(session_id)

        sdir = cad_service._get_session_dir(session_id)
        rev_dir = sdir / "revisions"
        rev_dir.mkdir(parents=True, exist_ok=True)
        rev0_step = rev_dir / "rev_000.step"

        possible_outputs_dirs = [
            Path(__file__).resolve().parents[3] / "outputs",
            Path(__file__).resolve().parents[2] / "outputs",
            Path("outputs"),
            Path("/app/outputs"),
        ]
        valid_outputs_dirs: list[Path] = []
        for od in possible_outputs_dirs:
            try:
                od.mkdir(parents=True, exist_ok=True)
                if od.exists() and od not in valid_outputs_dirs:
                    valid_outputs_dirs.append(od)
            except Exception:
                pass

        base_step: Optional[Path] = None

        if file_bytes and len(file_bytes) > 0:
            rev0_step.write_bytes(file_bytes)
            base_step = rev0_step
            for od in valid_outputs_dirs:
                try:
                    (od / f"cad_{session_id}.step").write_bytes(file_bytes)
                except Exception:
                    pass
        else:
            candidate_paths = [
                rev0_step,
                BASE_STORAGE_DIR / session_id / f"{session_id}.step",
            ]
            for od in valid_outputs_dirs:
                candidate_paths.append(od / f"cad_{session_id}.step")
                candidate_paths.append(od / f"{session_id}.step")

            for p in candidate_paths:
                if p.exists() and p.stat().st_size > 0:
                    base_step = p
                    break

        rev = cad_service.initialize_session_if_needed(session_id, base_step_path=base_step, force_sync=True)
        rev0_stl = rev_dir / f"{rev}.stl"

        for od in valid_outputs_dirs:
            target_stl = od / f"cad_{session_id}.stl"
            target_step = od / f"cad_{session_id}.step"
            if rev0_stl.exists():
                try:
                    shutil.copy2(rev0_stl, target_stl)
                except Exception:
                    pass
            if rev0_step.exists() and not target_step.exists():
                try:
                    shutil.copy2(rev0_step, target_step)
                except Exception:
                    pass

        return {
            "success": True,
            "session_id": session_id,
            "revision": rev,
            "step_url": f"/api/outputs/cad_{session_id}.step",
            "stl_url": f"/api/outputs/cad_{session_id}.stl",
            "preview_stl_url": f"/api/cad/modify/file/{session_id}/revisions/{rev}.stl",
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to process imported STEP model: {exc}")

