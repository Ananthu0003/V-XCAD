"""VEXCAD Manual CAD Refinement Router — /api/v1/cad/modify."""
from __future__ import annotations

import asyncio
import base64
import os
from pathlib import Path
import shutil
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

from app.models.cad_modification import (
    AiPlanRequest,
    AiPlanResult,
    CADOperation,
    CommitRequest,
    CommitResult,
    CoplanarQueryRequest,
    CoplanarQueryResult,
    DetectedFeature,
    DfmAnalysisRequest,
    DfmAnalysisResult,
    MeasureRequest,
    MeasureResult,
    ModelParametersResponse,
    PreviewRequest,
    PreviewResult,
    RecomputeRequest,
    RecomputeResult,
    RollbackRequest,
    RollbackResult,
    SelectMoreRequest,
    SelectMoreResponse,
    SimilarQueryRequest,
    SimilarQueryResult,
    TopologyDataResponse,
    GeometryContext,
)
from app.services.geometry.manual_cad_service import BASE_STORAGE_DIR, ManualCADService


class ImportStepRequest(BaseModel):
    session_id: str
    filename: Optional[str] = None
    step_base64: Optional[str] = None
    source_step: Optional[str] = None


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
    source_step: Optional[str] = Query(None, description="Optional path to source STEP model"),
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
                    Path("/app/outputs"),
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
        from app.services.geometry.geometry_context import get_geometry_context as get_context
        cad_service.initialize_session_if_needed(session_id)
        # Note: In a real system we would pass the shape or the session to get_context.
        # But this function only needs to return a valid GeometryContext instance.
        return get_context(session_id, revision, ref, u, v)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Context measurement failed: {exc}")


@router.get("/history/{session_id}", response_model=list[CADOperation])
async def get_history(session_id: str) -> list[CADOperation]:
    """Retrieve the full sequence of CAD operations and their provenance."""
    try:
        cad_service.initialize_session_if_needed(session_id)
        return cad_service.get_history(session_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch history: {exc}")


@router.get("/export/{session_id}")
async def export_model(
    session_id: str,
    fmt: str = Query("stl", description="stl | step | obj | 3mf"),
    revision_id: Optional[str] = Query(None, description="Defaults to the active revision"),
) -> Response:
    """Download the current (or a chosen) revision as STL, STEP, OBJ or 3MF."""
    try:
        data, media_type, filename = await asyncio.to_thread(
            cad_service.export_revision, session_id, revision_id, fmt
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Export failed: {exc}")
    return Response(
        content=data,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/file/{session_id}/{path:path}")
async def get_session_file(session_id: str, path: str):
    """Serve session artifacts (STEP / STL / DXF)."""
    session_root = (BASE_STORAGE_DIR / session_id).resolve()
    file_path = (session_root / path).resolve()
    # Block path traversal ("../") out of the session directory.
    if session_root not in file_path.parents or not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    media_type = "model/stl" if file_path.suffix == ".stl" else "application/octet-stream"
    return FileResponse(file_path, media_type=media_type)


@router.post("/import-step")
async def import_step_model(request: ImportStepRequest):
    """
    Initializes a session from an imported STEP model, generates STL for 3D viewport,
    and caches B-Rep topology metadata.
    """
    try:
        session_id = request.session_id
        outputs_dir = Path("/app/outputs")
        if not outputs_dir.exists():
            outputs_dir = Path(__file__).resolve().parents[3] / "outputs"
        if not outputs_dir.exists():
            outputs_dir = Path("outputs")
        outputs_dir.mkdir(parents=True, exist_ok=True)

        sdir = cad_service._get_session_dir(session_id)
        sdir.mkdir(parents=True, exist_ok=True)
        revs_dir = sdir / "revisions"
        revs_dir.mkdir(parents=True, exist_ok=True)
        rev0_step = revs_dir / "rev_000.step"

        base_step = None
        if request.step_base64:
            step_bytes = base64.b64decode(request.step_base64)
            rev0_step.write_bytes(step_bytes)
            dest_step = outputs_dir / f"cad_{session_id}.step"
            try:
                dest_step.write_bytes(step_bytes)
                dest_step.chmod(0o666)
            except Exception:
                pass
            base_step = rev0_step
        else:
            candidate_paths = []
            if request.source_step:
                candidate_paths.append(Path(request.source_step))
            candidate_paths.extend([
                Path("/app/outputs") / f"cad_{session_id}.step",
                Path("/app/outputs") / f"cad_{session_id}.stp",
                outputs_dir / f"cad_{session_id}.step",
                Path(__file__).resolve().parents[3] / "outputs" / f"cad_{session_id}.step",
                Path(__file__).resolve().parents[2] / "outputs" / f"cad_{session_id}.step",
                Path("outputs") / f"cad_{session_id}.step",
                rev0_step,
            ])
            for p in candidate_paths:
                if p.exists():
                    base_step = p
                    break

        rev = cad_service.initialize_session_if_needed(session_id, base_step_path=base_step, force_sync=True)
        rev0_stl = revs_dir / f"{rev}.stl"

        target_stl = outputs_dir / f"cad_{session_id}.stl"
        if rev0_stl.exists():
            if rev0_stl.resolve() != target_stl.resolve():
                shutil.copy2(rev0_stl, target_stl)
            try:
                target_stl.chmod(0o666)
            except Exception:
                pass

        topo = cad_service.get_topology(session_id, rev)

        return {
            "success": True,
            "session_id": session_id,
            "revision": rev,
            "step_url": f"/api/outputs/cad_{session_id}.step",
            "stl_url": f"/api/outputs/cad_{session_id}.stl",
            "preview_stl_url": f"/api/cad/modify/file/{session_id}/revisions/{rev}.stl",
            "parameters": topo.parameters,
            "parameter_metadata": topo.parameter_metadata,
            "features": [f.model_dump() for f in topo.features],
            "topology": topo.model_dump(),
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to process imported STEP model: {exc}")


# ---------------------------------------------------------------------------
# AI Geometry Planner
# ---------------------------------------------------------------------------

@router.post("/ai-plan", response_model=AiPlanResult)
async def ai_geometry_plan(request: AiPlanRequest) -> AiPlanResult:
    """
    Convert a natural-language CAD editing command into a structured, validated CADOperationPlan.
    The plan can then be used with /preview and /commit.
    Never modifies geometry directly — returns a plan for user review.
    """
    try:
        from app.services.agents.ai_geometry_planner import AiGeometryPlanner
        planner = AiGeometryPlanner()
        return planner.plan(request)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"AI geometry planning failed: {exc}")


# ---------------------------------------------------------------------------
# Non-mutating geometry query endpoints
# ---------------------------------------------------------------------------

@router.post("/coplanar", response_model=CoplanarQueryResult)
async def select_coplanar_faces(request: CoplanarQueryRequest) -> CoplanarQueryResult:
    """
    Find all faces coplanar with the reference face within a geometric tolerance.
    Returns a list of transient face IDs. Does NOT modify the model.
    """
    try:
        cad_service.initialize_session_if_needed(request.session_id)
        return cad_service.coplanar_faces(request)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Coplanar query failed: {exc}")


@router.post("/similar", response_model=SimilarQueryResult)
async def select_similar_entities(request: SimilarQueryRequest) -> SimilarQueryResult:
    """
    Find geometrically similar entities (bores, faces, edges) relative to a reference entity.
    For cylindrical bores: matches by radius ± tolerance and axis direction.
    For planar faces: matches by normal direction and area.
    Returns a list of transient entity IDs. Does NOT modify the model.
    """
    try:
        cad_service.initialize_session_if_needed(request.session_id)
        return cad_service.similar_entities(request)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Similar entity query failed: {exc}")


@router.post("/dfm", response_model=DfmAnalysisResult)
async def dfm_analysis(request: DfmAnalysisRequest) -> DfmAnalysisResult:
    """
    Generate Design for Manufacturing suggestions from measured geometry.
    Checks bore diameters against ISO metric clearance hole standards,
    detects inconsistent features, and identifies non-standard dimensions.
    Returns actionable DFM suggestions with proposed operations.
    Does NOT modify geometry.
    """
    try:
        cad_service.initialize_session_if_needed(request.session_id)
        return cad_service.dfm_analysis(request)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"DFM analysis failed: {exc}")


@router.post("/measure", response_model=MeasureResult)
async def measure_entity(request: MeasureRequest) -> MeasureResult:
    """
    Measure entity dimensions or distance between entities, returning constituent shape
    parameters and AI CAD feature naming.
    """
    try:
        cad_service.initialize_session_if_needed(request.session_id)
        return cad_service.measure(request)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Measure query failed: {exc}")


@router.get("/features/{session_id}", response_model=List[DetectedFeature])
async def get_detected_features(
    session_id: str,
    revision_id: str = Query("rev_000", description="Target revision ID"),
) -> List[DetectedFeature]:
    """
    Detect B-Rep features (holes, bosses, pockets, slots, fillets, chamfers)
    with editable parameter schemas.
    """
    try:
        cad_service.initialize_session_if_needed(session_id)
        return await asyncio.to_thread(cad_service.get_detected_features, session_id, revision_id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Feature extraction failed: {exc}")


@router.post("/select-more", response_model=SelectMoreResponse)
async def select_more_entities(request: SelectMoreRequest) -> SelectMoreResponse:
    """
    Topological selection expansion: adjacent, coplanar, tangent chain, edge loop, same type/size, invert, clear.
    """
    try:
        cad_service.initialize_session_if_needed(request.session_id)
        return await asyncio.to_thread(cad_service.select_more, request)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Selection expansion failed: {exc}")


@router.get("/parameters/{session_id}", response_model=ModelParametersResponse)
async def get_parameters(
    session_id: str,
    revision: Optional[str] = Query(None, description="Target revision ID (defaults to active)"),
) -> ModelParametersResponse:
    """
    Extract base solid classification, parametric feature tree, and mass properties.
    """
    try:
        cad_service.initialize_session_if_needed(session_id)
        return await asyncio.to_thread(cad_service.get_parameters, session_id, revision)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to extract parameters: {exc}")

