"""VEXCAD Manual CAD Refinement Router — /api/v1/cad/modify."""
from __future__ import annotations

import os
from pathlib import Path
from fastapi import APIRouter, HTTPException, Query
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
)
from app.services.geometry.manual_cad_service import BASE_STORAGE_DIR, ManualCADService

router = APIRouter(prefix="/cad/modify", tags=["manual-cad"])
cad_service = ManualCADService()


@router.post("/recompute", response_model=RecomputeResult)
async def recompute_history(request: RecomputeRequest) -> RecomputeResult:
    """Parametric recomputation of downstream operations after modifying or deleting an upstream feature."""
    try:
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
        cad_service.initialize_session_if_needed(request.session_id)
        return cad_service.preview_operation(request)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Preview generation failed: {exc}")


@router.post("/commit", response_model=CommitResult)
async def commit_operation(request: CommitRequest) -> CommitResult:
    """Commit a validated manual CAD operation as a new immutable revision."""
    try:
        cad_service.initialize_session_if_needed(request.session_id)
        return cad_service.commit_operation(request)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Commit failed: {exc}")


@router.post("/rollback", response_model=RollbackResult)
async def rollback_revision(request: RollbackRequest) -> RollbackResult:
    """Rollback active revision pointer without destroying history."""
    try:
        return cad_service.rollback_revision(request)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Rollback failed: {exc}")


@router.post("/measure", response_model=MeasureResult)
async def measure_geometry(request: MeasureRequest) -> MeasureResult:
    """Measure exact analytical distances, angles, and areas on B-Rep."""
    try:
        cad_service.initialize_session_if_needed(request.session_id)
        return cad_service.measure(request)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Measurement failed: {exc}")


@router.get("/history/{session_id}", response_model=list[CADOperation])
async def get_history(session_id: str) -> list[CADOperation]:
    """Retrieve the full sequence of CAD operations and their provenance."""
    try:
        cad_service.initialize_session_if_needed(session_id)
        return cad_service.get_history(session_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch history: {exc}")


@router.get("/file/{session_id}/{path:path}")
async def get_session_file(session_id: str, path: str):
    """Serve session artifacts (STEP / STL / DXF)."""
    file_path = BASE_STORAGE_DIR / session_id / path
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    media_type = "model/stl" if file_path.suffix == ".stl" else "application/octet-stream"
    return FileResponse(file_path, media_type=media_type)
