"""VEXCAD Manual CAD Refinement Router — /api/v1/cad/modify."""
from __future__ import annotations

import asyncio
import os
import re
import shutil
from pathlib import Path
from typing import Optional, Dict, Any, List, Union
from fastapi import APIRouter, HTTPException, Query, Request, UploadFile, File, Form
from fastapi.responses import FileResponse

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
import base64


class ImportStepRequest(BaseModel):
    session_id: str
    filename: Optional[str] = None
    step_base64: Optional[str] = None
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
            b64_str = body.get("step_content_b64") or body.get("step_base64")
            if b64_str:
                file_bytes = base64.b64decode(b64_str)
        else:
            try:
                body = await request.json()
                session_id = body.get("session_id")
                filename = body.get("filename")
                b64_str = body.get("step_content_b64") or body.get("step_base64")
                if b64_str:
                    file_bytes = base64.b64decode(b64_str)
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

        topo = None
        try:
            topo = cad_service.get_topology(session_id, rev)
        except Exception:
            pass

        return {
            "success": True,
            "session_id": session_id,
            "revision": rev,
            "step_url": f"/api/outputs/cad_{session_id}.step",
            "stl_url": f"/api/outputs/cad_{session_id}.stl",
            "preview_stl_url": f"/api/cad/modify/file/{session_id}/revisions/{rev}.stl",
            "parameters": topo.parameters if topo else {},
            "parameter_metadata": topo.parameter_metadata if topo else {},
            "features": [f.model_dump() for f in topo.features] if topo else [],
        }
    except HTTPException:
        raise
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

