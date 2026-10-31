"""Manual CAD Service — Unified OpenCASCADE direct B-Rep mutation engine for VEXCAD."""
from __future__ import annotations

import json
import math
import os
import shutil
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import build123d as bd
from build123d import export_step, export_stl, import_step
from OCP.Bnd import Bnd_Box
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepExtrema import BRepExtrema_DistShapeShape
from OCP.BRepFilletAPI import BRepFilletAPI_MakeChamfer, BRepFilletAPI_MakeFillet
from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps
from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE
from OCP.TopoDS import TopoDS

from app.models.cad_modification import (
    CADOperation,
    CommitRequest,
    CommitResult,
    CoplanarQueryRequest,
    CoplanarQueryResult,
    DfmAnalysisRequest,
    DfmAnalysisResult,
    DfmSuggestion,
    GeometricReference,
    MeasureRequest,
    MeasureResult,
    OperationSource,
    OperationStatus,
    PreviewRequest,
    PreviewResult,
    RecomputeRequest,
    RecomputeResult,
    RecomputedOperationStatus,
    RollbackRequest,
    RollbackResult,
    SimilarQueryRequest,
    SimilarQueryResult,
    TopologyDataResponse,
    ValidationReport,
    DetectedFeature,
    SelectMoreRequest,
    SelectMoreResponse,
    BaseSolidClassification,
    ExtractedFeature,
    MassProperties,
    ModelParametersResponse,
)
from app.services.geometry.body_operations import BodyOperationsMixin
from app.services.geometry.brep_validator import BRepValidator
from app.services.geometry.reference_resolver import ReferenceResolver
from app.services.geometry.feature_service import FeatureService
from app.services.geometry.topology_extractor import TopologyExtractor
from app.services.geometry.geometry_context import get_planar_face_frame
from app.services.geometry.manual_cad.dispatcher import dispatch_operation
from app.services.geometry.manual_cad.operations import (
    apply_hole,
    apply_plug_hole,
    apply_pocket,
    apply_pad,
    apply_fillet,
    apply_chamfer,
    apply_offset_face,
    apply_snap_to_plane,
)

BASE_STORAGE_DIR = Path(os.getenv("VEXCAD_STORAGE_DIR", "storage/jobs"))


class ManualCADService(BodyOperationsMixin):
    """
    Manages session storage, multi-stage reference resolution, parametric B-Rep operations,
    preview generation, non-destructive revisions, and CAM handoff.
    """

    def __init__(self, storage_dir: Optional[Path] = None):
        self.storage_dir = storage_dir or BASE_STORAGE_DIR

    def _get_session_dir(self, session_id: str) -> Path:
        sdir = self.storage_dir / session_id
        sdir.mkdir(parents=True, exist_ok=True)
        (sdir / "revisions").mkdir(exist_ok=True)
        (sdir / "operations").mkdir(exist_ok=True)
        (sdir / "topology").mkdir(exist_ok=True)
        (sdir / "features").mkdir(exist_ok=True)
        (sdir / "previews").mkdir(exist_ok=True)
        return sdir

    def get_active_step_path(self, session_id: str) -> Optional[Path]:
        """
        Locates the authoritative active revision STEP model for CAM and simulation.
        Prioritizes manual revision history if available, falling back to AI outputs.
        """
        sdir = self.storage_dir / session_id
        session_file = sdir / "session.json"
        if session_file.exists():
            try:
                state = json.loads(session_file.read_text())
                active_rev = state.get("active_revision", "rev_000")
                step_file = sdir / "revisions" / f"{active_rev}.step"
                if step_file.exists():
                    return step_file
            except Exception:
                pass

        rev0 = sdir / "revisions" / "rev_000.step"
        if rev0.exists():
            return rev0

        for out_dir in [
            Path("/app/outputs"),
            Path(__file__).resolve().parents[3] / "outputs",
            Path(__file__).resolve().parents[4] / "outputs",
            Path("outputs"),
        ]:
            if out_dir.exists():
                matching_steps = sorted(
                    out_dir.glob(f"cad_{session_id}*.step"),
                    key=lambda p: p.stat().st_mtime,
                    reverse=True
                )
                if matching_steps and matching_steps[0].exists():
                    return matching_steps[0]

        return None

    def get_active_stl_path(self, session_id: str) -> Optional[Path]:
        """Locates the active revision STL model."""
        sdir = self.storage_dir / session_id
        session_file = sdir / "session.json"
        if session_file.exists():
            try:
                state = json.loads(session_file.read_text())
                active_rev = state.get("active_revision", "rev_000")
                stl_file = sdir / "revisions" / f"{active_rev}.stl"
                if stl_file.exists():
                    return stl_file
            except Exception:
                pass

        rev0_stl = sdir / "revisions" / "rev_000.stl"
        if rev0_stl.exists():
            return rev0_stl

        for out_dir in [
            Path("/app/outputs"),
            Path(__file__).resolve().parents[3] / "outputs",
            Path(__file__).resolve().parents[4] / "outputs",
            Path("outputs"),
        ]:
            if out_dir.exists():
                matching_stls = sorted(
                    out_dir.glob(f"cad_{session_id}*.stl"),
                    key=lambda p: p.stat().st_mtime,
                    reverse=True
                )
                if matching_stls and matching_stls[0].exists():
                    return matching_stls[0]

        return None

    def initialize_session_if_needed(
        self,
        session_id: str,
        base_step_path: Optional[Path] = None,
        base_shape: Optional[bd.Shape] = None,
        force_sync: bool = False
    ) -> str:
        """Initialize or synchronize rev_000 for a session from a STEP file or shape."""
        sdir = self._get_session_dir(session_id)
        rev0_step = sdir / "revisions" / "rev_000.step"

        # Check if human operations exist in this session
        has_human_ops = False
        ops_dir = sdir / "operations"
        if ops_dir.exists():
            for op_file in ops_dir.glob("op_*.json"):
                if op_file.name != "op_000.json":
                    has_human_ops = True
                    break

        # Search possible outputs directories for latest AI generated step
        possible_output_dirs = [
            Path("/app/outputs"),
            Path(__file__).resolve().parents[3] / "outputs",
            Path(__file__).resolve().parents[4] / "outputs",
            self.storage_dir.parent / "outputs",
            Path("outputs"),
        ]
        matching_steps: list[Path] = []
        for out_dir in possible_output_dirs:
            if out_dir.exists():
                matching_steps.extend(list(out_dir.glob(f"cad_{session_id}*.step")))
        matching_steps = sorted(matching_steps, key=lambda p: p.stat().st_mtime, reverse=True)

        should_reinit = (
            not rev0_step.exists()
            or force_sync
            or (
                not has_human_ops
                and matching_steps
                and matching_steps[0].exists()
                and (
                    matching_steps[0].stat().st_mtime > rev0_step.stat().st_mtime
                )
            )
        )

        if should_reinit:
            # Purge stale topology and feature caches for this session
            topo_dir = sdir / "topology"
            if topo_dir.exists():
                for f in topo_dir.glob("*.json"):
                    try:
                        f.unlink(missing_ok=True)
                    except Exception:
                        pass

            feat_dir = sdir / "features"
            if feat_dir.exists():
                for f in feat_dir.glob("*.json"):
                    try:
                        f.unlink(missing_ok=True)
                    except Exception:
                        pass

            if base_shape is not None:
                export_step(base_shape, str(rev0_step))
            elif base_step_path and base_step_path.exists():
                if base_step_path.resolve() != rev0_step.resolve():
                    shutil.copy2(base_step_path, rev0_step)
            elif matching_steps and matching_steps[0].exists():
                if matching_steps[0].resolve() != rev0_step.resolve():
                    shutil.copy2(matching_steps[0], rev0_step)
            elif not rev0_step.exists():
                # Default unit stock only if nothing found anywhere
                box = bd.Box(50, 50, 20)
                export_step(box, str(rev0_step))

            # Base operation record
            op0 = CADOperation(
                operation_id="op_000",
                operation_type="boolean",
                source=OperationSource.AI_GENERATED,
                input_revision="rev_000",
                output_revision="rev_000",
                references=[],
                parameters={"description": "Base AI Generated Model"},
                status=OperationStatus.COMMITTED,
                created_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            )
            (sdir / "operations" / "op_000.json").write_text(json.dumps(op0.model_dump(), indent=2))

            # Session pointer
            session_state = {
                "session_id": session_id,
                "active_revision": "rev_000",
                "revisions": ["rev_000"],
                "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
            (sdir / "session.json").write_text(json.dumps(session_state, indent=2))

            # Generate base STL & topology cache
            shape = self.load_revision_shape(session_id, "rev_000")
            stl_path = sdir / "revisions" / "rev_000.stl"
            export_stl(shape, str(stl_path))
            self._cache_topology(session_id, "rev_000", shape)

        return "rev_000"

    def load_revision_shape(self, session_id: str, revision_id: str) -> bd.Shape:
        """Load OpenCASCADE B-Rep shape for a given revision."""
        sdir = self._get_session_dir(session_id)
        step_path = sdir / "revisions" / f"{revision_id}.step"
        if not step_path.exists():
            session_file = sdir / "session.json"
            if session_file.exists():
                try:
                    state = json.loads(session_file.read_text())
                    active_rev = state.get("active_revision", "rev_000")
                    step_file = sdir / "revisions" / f"{active_rev}.step"
                    if step_file.exists():
                        return import_step(str(step_file))
                except Exception:
                    pass
            rev0 = sdir / "revisions" / "rev_000.step"
            if rev0.exists():
                return import_step(str(rev0))
            active_step = self.get_active_step_path(session_id)
            if active_step and active_step.exists():
                return import_step(str(active_step))
            raise FileNotFoundError(f"Revision {revision_id} not found for session {session_id}")
        return import_step(str(step_path))

    def _cache_topology(self, session_id: str, revision_id: str, shape: bd.Shape) -> TopologyDataResponse:
        """Extract and cache topology metadata for fast viewport selection."""
        sdir = self._get_session_dir(session_id)
        faces_meta: Dict[str, GeometricReference] = {}
        edges_meta: Dict[str, GeometricReference] = {}

        # Conformal high-precision meshing across the entire solid B-Rep shape
        from OCP.BRepMesh import BRepMesh_IncrementalMesh
        try:
            BRepMesh_IncrementalMesh(shape.wrapped, 0.05, False, 0.2, True)
        except Exception:
            pass

        for idx, f in enumerate(shape.faces()):
            tid = f"face_{idx}"
            faces_meta[tid] = ReferenceResolver.extract_face_reference(f, tid)

        for idx, e in enumerate(shape.edges()):
            tid = f"edge_{idx}"
            edges_meta[tid] = ReferenceResolver.extract_edge_reference(e, tid)

        bnd = Bnd_Box()
        BRepBndLib.Add_s(shape.wrapped, bnd)
        xmin, ymin, zmin, xmax, ymax, zmax = bnd.Get()
        bbox = {
            "min": [float(xmin), float(ymin), float(zmin)],
            "max": [float(xmax), float(ymax), float(zmax)],
        }

        props = GProp_GProps()
        BRepGProp.VolumeProperties_s(shape.wrapped, props)
        vol = float(props.Mass())

        val = BRepValidator.validate_shape(shape)

        # Recognize constituent features, parts, and extract parametric dimensions
        from app.services.geometry.shape_feature_recognizer import ShapeFeatureRecognizer
        rec_features, rec_params, rec_metadata = ShapeFeatureRecognizer.recognize_features(
            shape, faces_meta=faces_meta, edges_meta=edges_meta
        )

        data = TopologyDataResponse(
            session_id=session_id,
            revision_id=revision_id,
            faces=faces_meta,
            edges=edges_meta,
            bounding_box=bbox,
            volume_mm3=max(0.0, vol),
            is_valid=val.is_valid,
            features=rec_features,
            parameters=rec_params,
            parameter_metadata=rec_metadata,
        )

        topo_path = sdir / "topology" / f"{revision_id}.json"
        topo_path.write_text(json.dumps(data.model_dump(), indent=2))
        return data

    def get_topology(self, session_id: str, revision_id: str) -> TopologyDataResponse:
        """Retrieve cached topology or recompute on the fly for the exact revision."""
        sdir = self._get_session_dir(session_id)
        topo_path = sdir / "topology" / f"{revision_id}.json"
        step_path = sdir / "revisions" / f"{revision_id}.step"

        # Invalidate cache if STEP file is newer than cached topology JSON
        is_cache_stale = False
        if topo_path.exists() and step_path.exists():
            try:
                if step_path.stat().st_mtime > topo_path.stat().st_mtime:
                    is_cache_stale = True
            except Exception:
                pass

        if topo_path.exists() and not is_cache_stale:
            try:
                data_dict = json.loads(topo_path.read_text())
                faces_dict = data_dict.get("faces", {})
                first_face = next(iter(faces_dict.values()), None)
                if first_face and first_face.get("triangles") and "features" in data_dict and data_dict["features"]:
                    return TopologyDataResponse(**data_dict)
            except Exception:
                pass
        shape = self.load_revision_shape(session_id, revision_id)
        return self._cache_topology(session_id, revision_id, shape)

    # --------------------------------------------------------------------------
    # Preview & Commit Operations
    # --------------------------------------------------------------------------

    def preview_operation(self, req: PreviewRequest) -> PreviewResult:
        """Execute a non-destructive B-Rep modification in memory and return rich diagnostics."""
        sdir = self._get_session_dir(req.session_id)
        base_shape = self.load_revision_shape(req.session_id, req.base_revision)

        modified_shape, status, diag_msg, created_f, mod_e = self._execute_operation(
            base_shape, req.operation_type, req.references, req.parameters
        )

        if status != OperationStatus.VALID or modified_shape is None:
            return PreviewResult(
                valid=False,
                status=status,
                validation=ValidationReport(
                    is_valid=False,
                    error_code=status.value.upper(),
                    error_message=diag_msg,
                    suggestions=["Check reference geometry, radius limits, or profile boundaries."]
                ),
                error_diagnostic={"code": status.value, "message": diag_msg}
            )

        val_report = BRepValidator.validate_shape(modified_shape)
        if not val_report.is_valid:
            return PreviewResult(
                valid=False,
                status=OperationStatus.GEOMETRY_FAILURE,
                validation=val_report,
                error_diagnostic={"code": val_report.error_code, "message": val_report.error_message}
            )

        # Export temporary preview STL
        preview_id = uuid.uuid4().hex[:8]
        preview_stl_path = sdir / "previews" / f"prev_{preview_id}.stl"
        export_stl(modified_shape, str(preview_stl_path))
        self._cleanup_previews(sdir / "previews", keep_last=10)

        # Volume Delta
        props_base = GProp_GProps()
        BRepGProp.VolumeProperties_s(base_shape.wrapped, props_base)
        base_vol = float(props_base.Mass())
        vol_delta = val_report.volume_mm3 - base_vol

        bnd = Bnd_Box()
        BRepBndLib.Add_s(modified_shape.wrapped, bnd)
        xmin, ymin, zmin, xmax, ymax, zmax = bnd.Get()

        return PreviewResult(
            valid=True,
            status=OperationStatus.PREVIEW,
            preview_stl_url=f"/api/cad/modify/file/{req.session_id}/previews/prev_{preview_id}.stl",
            affected_faces=[r.transient_id for r in req.references if r.entity_type == "face"],
            created_faces=created_f,
            modified_edges=mod_e,
            bounding_box={"min": [float(xmin), float(ymin), float(zmin)], "max": [float(xmax), float(ymax), float(zmax)]},
            volume_delta_mm3=vol_delta,
            validation=val_report
        )

    def _cleanup_previews(self, previews_dir: Path, keep_last: int = 10) -> None:
        """Keep only latest N preview STL files to prevent disk leaks."""
        try:
            if not previews_dir.exists():
                return
            stls = sorted(previews_dir.glob("prev_*.stl"), key=lambda f: f.stat().st_mtime)
            if len(stls) > keep_last:
                for f in stls[:-keep_last]:
                    try:
                        f.unlink(missing_ok=True)
                    except Exception:
                        pass
        except Exception:
            pass

    def commit_operation(self, req: CommitRequest) -> CommitResult:
        """Apply and persist validated modification as a new immutable revision."""
        sdir = self._get_session_dir(req.session_id)
        base_shape = self.load_revision_shape(req.session_id, req.base_revision)

        modified_shape, status, diag_msg, created_f, mod_e = self._execute_operation(
            base_shape, req.operation_type, req.references, req.parameters
        )

        if status != OperationStatus.VALID or modified_shape is None:
            raise ValueError(f"Commit failed ({status.value}): {diag_msg}")

        val_report = BRepValidator.validate_shape(modified_shape)
        if not val_report.is_valid:
            raise ValueError(f"Geometry validation failed: {val_report.error_message}")

        # Compute next revision ID monotonically (prevent collision after rollback)
        session_file = sdir / "session.json"
        state = json.loads(session_file.read_text()) if session_file.exists() else {"revisions": ["rev_000"]}
        existing_rev_nums = [
            int(p.stem.replace("rev_", ""))
            for p in (sdir / "revisions").glob("rev_*.step")
            if p.stem.replace("rev_", "").isdigit()
        ]
        next_rev_num = max(existing_rev_nums) + 1 if existing_rev_nums else len(state.get("revisions", []))
        new_rev_id = f"rev_{next_rev_num:03d}"

        # Write immutable STEP and STL
        new_step_path = sdir / "revisions" / f"{new_rev_id}.step"
        new_stl_path = sdir / "revisions" / f"{new_rev_id}.stl"
        export_step(modified_shape, str(new_step_path))
        export_stl(modified_shape, str(new_stl_path))

        # Write Operation Record
        op_id = f"op_{next_rev_num:03d}"
        operation = CADOperation(
            operation_id=op_id,
            operation_type=req.operation_type,
            source=OperationSource.MANUAL,
            input_revision=req.base_revision,
            output_revision=new_rev_id,
            references=req.references,
            parameters=req.parameters,
            status=OperationStatus.COMMITTED,
            created_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            user_metadata={"note": req.user_note or ""}
        )
        (sdir / "operations" / f"{op_id}.json").write_text(json.dumps(operation.model_dump(), indent=2))

        # Update Session Pointer
        state["active_revision"] = new_rev_id
        if new_rev_id not in state["revisions"]:
            state["revisions"].append(new_rev_id)
        session_file.write_text(json.dumps(state, indent=2))

        # Cache Topology & Invalidate Caches
        self._cache_topology(req.session_id, new_rev_id, modified_shape)
        self.invalidate_features_cache(req.session_id)
        self.invalidate_parameters_cache(req.session_id)
        self._cleanup_previews(sdir / "previews", keep_last=2)

        return CommitResult(
            success=True,
            new_revision=new_rev_id,
            stl_url=f"/api/cad/modify/file/{req.session_id}/revisions/{new_rev_id}.stl",
            step_url=f"/api/cad/modify/file/{req.session_id}/revisions/{new_rev_id}.step",
            operation=operation,
            validation=val_report
        )

    def rollback_revision(self, req: RollbackRequest) -> RollbackResult:
        """Rollback active revision pointer without destroying history."""
        sdir = self._get_session_dir(req.session_id)
        step_path = sdir / "revisions" / f"{req.target_revision}.step"
        if not step_path.exists():
            raise FileNotFoundError(f"Target revision {req.target_revision} does not exist.")

        session_file = sdir / "session.json"
        state = json.loads(session_file.read_text())
        state["active_revision"] = req.target_revision
        session_file.write_text(json.dumps(state, indent=2))
        self.invalidate_features_cache(req.session_id)

        history = self.get_history(req.session_id)

        return RollbackResult(
            success=True,
            active_revision=req.target_revision,
            stl_url=f"/api/cad/modify/file/{req.session_id}/revisions/{req.target_revision}.stl",
            step_url=f"/api/cad/modify/file/{req.session_id}/revisions/{req.target_revision}.step",
            history=history
        )

    def get_history(self, session_id: str) -> List[CADOperation]:
        """List all operation history in order."""
        sdir = self._get_session_dir(session_id)
        op_dir = sdir / "operations"
        ops: List[CADOperation] = []
        for op_file in sorted(op_dir.glob("op_*.json")):
            try:
                ops.append(CADOperation(**json.loads(op_file.read_text())))
            except Exception:
                pass
        return ops

    def recompute_history(self, req: RecomputeRequest) -> RecomputeResult:
        """
        Recompute downstream parametric operations when an upstream feature is modified or removed.
        Uses Multi-stage Reference Resolver to track topological persistence across shape changes.
        """
        sdir = self._get_session_dir(req.session_id)
        current_ops = self.get_history(req.session_id)

        # 1. Modify operational recipe
        new_op_plan: List[CADOperation] = []
        for op in current_ops:
            if op.operation_id == "op_000":
                continue  # base AI-generated model: it is rev_000 itself, never replayed
            if req.action == "delete_op" and op.operation_id == req.target_op_id:
                continue # Skip / delete this operation
            elif req.action == "edit_params" and op.operation_id == req.target_op_id and req.updated_parameters:
                op.parameters = {**op.parameters, **req.updated_parameters}
                new_op_plan.append(op)
            else:
                new_op_plan.append(op)

        # 2. Reset from pristine base revision (rev_000)
        base_shape = self.load_revision_shape(req.session_id, "rev_000")
        current_shape = base_shape
        active_rev = "rev_000"

        # Clear existing operation records to write clean history
        op_dir = sdir / "operations"
        for f in op_dir.glob("op_*.json"):
            if f.name == "op_000.json":
                continue  # keep the base-model record so history still starts with it
            try:
                f.unlink()
            except Exception:
                pass

        replayed_statuses: List[RecomputedOperationStatus] = []
        broken_refs: List[str] = []
        valid_revisions: List[str] = ["rev_000"]

        # 3. Sequential Replay Pipeline
        for idx, op in enumerate(new_op_plan):
            op_num = idx + 1
            new_op_id = f"op_{op_num:03d}"
            new_rev_id = f"rev_{op_num:03d}"

            # Attempt geometry modification on latest current_shape
            mod_shape, status, msg, created_f, mod_e = self._execute_operation(
                current_shape, op.operation_type, op.references, op.parameters
            )

            if status != OperationStatus.VALID or mod_shape is None:
                broken_refs.append(f"Operation {op.operation_id} ({op.operation_type}) failed replay: {msg}")
                replayed_statuses.append(RecomputedOperationStatus(
                    op_id=new_op_id,
                    operation_type=op.operation_type,
                    status=status,
                    message=msg,
                    confidence=0.0
                ))
                break # Cannot proceed with downstream operations if shape creation broke

            val_report = BRepValidator.validate_shape(mod_shape)
            if not val_report.is_valid:
                broken_refs.append(f"Operation {op.operation_id} produced invalid geometry: {val_report.error_message}")
                replayed_statuses.append(RecomputedOperationStatus(
                    op_id=new_op_id,
                    operation_type=op.operation_type,
                    status=OperationStatus.GEOMETRY_FAILURE,
                    message=val_report.error_message or "Validation failed",
                    confidence=0.0
                ))
                break

            # Persist recomputed revision files
            new_step_path = sdir / "revisions" / f"{new_rev_id}.step"
            new_stl_path = sdir / "revisions" / f"{new_rev_id}.stl"
            export_step(mod_shape, str(new_step_path))
            export_stl(mod_shape, str(new_stl_path))

            # Save updated operation record
            recomputed_op = CADOperation(
                operation_id=new_op_id,
                operation_type=op.operation_type,
                source=op.source,
                input_revision=active_rev,
                output_revision=new_rev_id,
                references=op.references,
                parameters=op.parameters,
                status=OperationStatus.COMMITTED,
                created_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                user_metadata=op.user_metadata
            )
            (op_dir / f"{new_op_id}.json").write_text(json.dumps(recomputed_op.model_dump(), indent=2))

            # Cache Topology for fast raycasting
            self._cache_topology(req.session_id, new_rev_id, mod_shape)

            valid_revisions.append(new_rev_id)
            active_rev = new_rev_id
            current_shape = mod_shape

            replayed_statuses.append(RecomputedOperationStatus(
                op_id=new_op_id,
                operation_type=op.operation_type,
                status=OperationStatus.VALID,
                message=msg,
                confidence=1.0
            ))

        # 4. Update session metadata
        session_file = sdir / "session.json"
        state = {
            "session_id": req.session_id,
            "active_revision": active_rev,
            "revisions": valid_revisions
        }
        session_file.write_text(json.dumps(state, indent=2))
        self.invalidate_features_cache(req.session_id)

        final_val = BRepValidator.validate_shape(current_shape)
        history = self.get_history(req.session_id)

        return RecomputeResult(
            success=len(broken_refs) == 0,
            active_revision=active_rev,
            stl_url=f"/api/cad/modify/file/{req.session_id}/revisions/{active_rev}.stl",
            step_url=f"/api/cad/modify/file/{req.session_id}/revisions/{active_rev}.step",
            history=history,
            replayed_operations=replayed_statuses,
            broken_references=broken_refs,
            validation=final_val
        )

    # --------------------------------------------------------------------------
    # Measurement Service
    # --------------------------------------------------------------------------

    def measure(self, req: MeasureRequest) -> MeasureResult:
        """Measure exact B-Rep distances, radii, and angles between entities, with parameter fetching."""
        shape = self.load_revision_shape(req.session_id, req.revision_id)
        info_a: Dict[str, Any] = {}
        info_b: Optional[Dict[str, Any]] = None

        if req.entity_a.entity_type == "face":
            matched_f, status, _ = ReferenceResolver.resolve_face(shape, req.entity_a)
            if matched_f:
                info_a = {
                    "transient_id": req.entity_a.transient_id,
                    "area_mm2": req.entity_a.area,
                    "surface_type": req.entity_a.surface_type,
                    "centroid": req.entity_a.centroid,
                    "normal": req.entity_a.normal,
                    "radius_mm": req.entity_a.radius,
                }
        elif req.entity_a.entity_type == "edge":
            matched_e, status, _ = ReferenceResolver.resolve_edge(shape, req.entity_a)
            if matched_e:
                info_a = {
                    "transient_id": req.entity_a.transient_id,
                    "length_mm": req.entity_a.length,
                    "curve_type": req.entity_a.curve_type,
                    "radius_mm": req.entity_a.radius,
                    "centroid": req.entity_a.centroid,
                }
        elif req.entity_a.entity_type == "body":
            bb = shape.bounding_box()
            info_a = {
                "transient_id": req.entity_a.transient_id,
                "entity_type": "body",
                "width_mm": max(0.1, bb.max.X - bb.min.X),
                "length_mm": max(0.1, bb.max.Y - bb.min.Y),
                "height_mm": max(0.1, bb.max.Z - bb.min.Z),
                "volume_mm3": shape.volume if hasattr(shape, "volume") else 0.0,
            }

        dist_val: Optional[float] = None
        min_dist: Optional[float] = None
        angle_val: Optional[float] = None
        if req.entity_b and req.entity_a.centroid and req.entity_b.centroid:
            dx = req.entity_a.centroid[0] - req.entity_b.centroid[0]
            dy = req.entity_a.centroid[1] - req.entity_b.centroid[1]
            dz = req.entity_a.centroid[2] - req.entity_b.centroid[2]
            dist_val = round((dx*dx + dy*dy + dz*dz) ** 0.5, 3)
            info_b = {
                "transient_id": req.entity_b.transient_id,
                "entity_type": req.entity_b.entity_type,
                "centroid": req.entity_b.centroid
            }

            ent_a = None
            ent_b = None
            if req.entity_a.entity_type == "face":
                ent_a, _, _ = ReferenceResolver.resolve_face(shape, req.entity_a)
            elif req.entity_a.entity_type == "edge":
                ent_a, _, _ = ReferenceResolver.resolve_edge(shape, req.entity_a)
            if req.entity_b.entity_type == "face":
                ent_b, _, _ = ReferenceResolver.resolve_face(shape, req.entity_b)
            elif req.entity_b.entity_type == "edge":
                ent_b, _, _ = ReferenceResolver.resolve_edge(shape, req.entity_b)
            if ent_a is not None and ent_b is not None:
                ext = BRepExtrema_DistShapeShape(ent_a.wrapped, ent_b.wrapped)
                if ext.IsDone():
                    min_dist = round(float(ext.Value()), 3)

            if req.entity_a.normal and req.entity_b.normal:
                na = req.entity_a.normal
                nb = req.entity_b.normal
                dot = na[0]*nb[0] + na[1]*nb[1] + na[2]*nb[2]
                dot_clamped = max(-1.0, min(1.0, dot))
                angle_val = round(math.degrees(math.acos(dot_clamped)), 2)

        # Feature recognition & parameter fetching
        topo = self.get_topology(req.session_id, req.revision_id)
        matched_feature = None
        target_tid = req.entity_a.transient_id

        if topo.features:
            for feat in topo.features:
                if target_tid and (target_tid in feat.face_ids or target_tid in feat.edge_ids):
                    matched_feature = feat
                    break
                if req.entity_a.entity_type == "body" and feat.feature_type == "body":
                    matched_feature = feat
                    break

        part_name = matched_feature.part_name if matched_feature else "Unclassified Feature"
        feature_type = matched_feature.feature_type if matched_feature else (req.entity_a.entity_type or "shape")
        extracted_params = matched_feature.parameters if matched_feature else {}
        extracted_meta = {k: topo.parameter_metadata.get(k, {}) for k in extracted_params} if topo.parameter_metadata else {}

        return MeasureResult(
            distance_mm=dist_val,
            min_distance_mm=min_dist if min_dist is not None else dist_val,
            angle_degrees=angle_val,
            entity_a_info=info_a,
            entity_b_info=info_b,
            part_name=part_name,
            feature_type=feature_type,
            parameters=extracted_params,
            parameter_metadata=extracted_meta,
            shape_feature=matched_feature
        )

    # --------------------------------------------------------------------------
    # Export
    # --------------------------------------------------------------------------

    EXPORT_FORMATS = {
        "stl": ("model/stl", "stl"),
        "step": ("application/step", "step"),
        "obj": ("text/plain", "obj"),
        "3mf": ("application/vnd.ms-package.3dmanufacturing-3dmodel+xml", "3mf"),
    }

    def export_revision(self, session_id: str, revision_id: Optional[str], fmt: str) -> Tuple[bytes, str, str]:
        """Export a revision as STL / STEP / OBJ / 3MF. Returns (bytes, media_type, filename).

        Files are produced in a throw-away temp directory and streamed back from memory.
        """
        import tempfile

        fmt = fmt.lower()
        if fmt not in self.EXPORT_FORMATS:
            raise ValueError(f"Unsupported export format '{fmt}'. Use one of: {', '.join(self.EXPORT_FORMATS)}.")
        if not revision_id:
            state_file = self._get_session_dir(session_id) / "session.json"
            revision_id = json.loads(state_file.read_text()).get("active_revision", "rev_000") if state_file.exists() else "rev_000"

        shape = self.load_revision_shape(session_id, revision_id)
        media_type, ext = self.EXPORT_FORMATS[fmt]
        filename = f"{session_id}_{revision_id}.{ext}"

        if fmt == "obj":
            verts, tris = shape.tessellate(0.05, 0.3)
            lines = ["# VEXCAD export"] + [f"v {v.X:.6f} {v.Y:.6f} {v.Z:.6f}" for v in verts]
            lines += [f"f {a + 1} {b + 1} {c + 1}" for a, b, c in tris]
            return ("\n".join(lines) + "\n").encode(), media_type, filename

        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / filename
            if fmt == "stl":
                export_stl(shape, str(out))
            elif fmt == "step":
                export_step(shape, str(out))
            else:  # 3mf
                mesher = bd.Mesher()
                mesher.add_shape(shape)
                mesher.write(str(out))
            return out.read_bytes(), media_type, filename

    # --------------------------------------------------------------------------
    # Geometry Execution Engine
    # --------------------------------------------------------------------------

    @property
    def _operation_registry(self):
        """Registry of supported CAD operations."""
        return {
            "fillet": self._apply_fillet,
            "chamfer": self._apply_chamfer,
            "hole": self._apply_hole,
            "pocket": self._apply_pocket,
            "pad": self._apply_pad,
            "edit_feature": self._apply_edit_feature,
            "offset_face": self._apply_offset_face,
            "snap_to_plane": self._apply_snap_to_plane,
            "plug_hole": self._apply_plug_hole,
            "transform": self._apply_transform,
            # Body-level editing (BodyOperationsMixin)
            "move": self._apply_move,
            "rotate": self._apply_rotate,
            "scale": self._apply_scale,
            "mirror": self._apply_mirror,
            "align": self._apply_align,
            "primitive": self._apply_primitive,
            "shell": self._apply_shell,
            "offset": self._apply_offset,
            "split": self._apply_split,
            "linear_pattern": self._apply_linear_pattern,
            "polar_pattern": self._apply_polar_pattern,
            "heal": self._apply_heal,
            # Direct edit & feature operations
            "push_pull": self._apply_push_pull,
            "round_face_edges": self._apply_round_face_edges,
            "delete_feature": self._apply_delete_feature,
            "move_feature": self._apply_move_feature,
            "pattern_feature": self._apply_pattern_feature,
        }

    def _execute_operation(
        self,
        base_shape: bd.Shape,
        op_type: str,
        references: List[GeometricReference],
        parameters: Dict[str, Any]
    ) -> Tuple[Optional[bd.Shape], OperationStatus, str, List[str], List[str]]:
        """Dispatch operation to specific geometry builder."""
        return dispatch_operation(base_shape, op_type, references, parameters)

    def _apply_fillet(
        self,
        shape: bd.Shape,
        refs: List[GeometricReference],
        params: Dict[str, Any]
    ) -> Tuple[Optional[bd.Shape], OperationStatus, str, List[str], List[str]]:
        return apply_fillet(shape, refs, params)

    def _apply_chamfer(
        self,
        shape: bd.Shape,
        refs: List[GeometricReference],
        params: Dict[str, Any]
    ) -> Tuple[Optional[bd.Shape], OperationStatus, str, List[str], List[str]]:
        return apply_chamfer(shape, refs, params)

    def _apply_hole(
        self,
        shape: bd.Shape,
        refs: List[GeometricReference],
        params: Dict[str, Any]
    ) -> Tuple[Optional[bd.Shape], OperationStatus, str, List[str], List[str]]:
        return apply_hole(shape, refs, params)

    def _apply_pocket(
        self,
        shape: bd.Shape,
        refs: List[GeometricReference],
        params: Dict[str, Any]
    ) -> Tuple[Optional[bd.Shape], OperationStatus, str, List[str], List[str]]:
        return apply_pocket(shape, refs, params)

    def _apply_pad(
        self,
        shape: bd.Shape,
        refs: List[GeometricReference],
        params: Dict[str, Any]
    ) -> Tuple[Optional[bd.Shape], OperationStatus, str, List[str], List[str]]:
        return apply_pad(shape, refs, params)

    def _apply_offset_face(
        self,
        shape: bd.Shape,
        refs: List[GeometricReference],
        params: Dict[str, Any]
    ) -> Tuple[Optional[bd.Shape], OperationStatus, str, List[str], List[str]]:
        return apply_offset_face(shape, refs, params)

    def _apply_snap_to_plane(
        self,
        shape: bd.Shape,
        refs: List[GeometricReference],
        params: Dict[str, Any]
    ) -> Tuple[Optional[bd.Shape], OperationStatus, str, List[str], List[str]]:
        return apply_snap_to_plane(shape, refs, params)

    def _apply_plug_hole(
        self,
        shape: bd.Shape,
        refs: List[GeometricReference],
        params: Dict[str, Any]
    ) -> Tuple[Optional[bd.Shape], OperationStatus, str, List[str], List[str]]:
        return apply_plug_hole(shape, refs, params)

    # --------------------------------------------------------------------------
    # Non-mutating geometry query methods
    # --------------------------------------------------------------------------

    def coplanar_faces(
        self,
        req: "CoplanarQueryRequest",
    ) -> "CoplanarQueryResult":
        """
        Detect all faces in the revision that share the same plane as the reference face,
        within the specified distance and angular tolerance.
        """
        import math
        from app.models.cad_modification import CoplanarQueryRequest, CoplanarQueryResult
        from OCP.BRepAdaptor import BRepAdaptor_Surface
        from OCP.GeomAbs import GeomAbs_Plane

        topo = self.get_topology(req.session_id, req.revision_id)
        ref_face_data = topo.faces.get(req.reference_face_id)
        if ref_face_data is None:
            return CoplanarQueryResult(
                coplanar_face_ids=[],
                reference_face_id=req.reference_face_id,
                count=0,
            )

        ref_normal = ref_face_data.normal or [0.0, 0.0, 1.0]
        ref_centroid = ref_face_data.centroid
        plane_d = ref_face_data.plane_d

        # If plane_d not stored, compute it from normal and centroid
        if plane_d is None:
            plane_d = -(ref_normal[0] * ref_centroid[0] + ref_normal[1] * ref_centroid[1] + ref_normal[2] * ref_centroid[2])

        angle_tol_rad = math.radians(req.angle_tolerance_deg)
        coplanar_ids: List[str] = []

        for face_id, face_data in topo.faces.items():
            if face_id == req.reference_face_id:
                continue
            if face_data.surface_type and face_data.surface_type.lower() != "plane":
                continue
            if face_data.normal is None or face_data.centroid is None:
                continue

            # Angular check: dot product of normals (allow anti-parallel)
            fn = face_data.normal
            dot = abs(fn[0] * ref_normal[0] + fn[1] * ref_normal[1] + fn[2] * ref_normal[2])
            angle = math.acos(max(-1.0, min(1.0, dot)))
            if angle > angle_tol_rad:
                continue

            # Distance check: signed distance of face centroid from reference plane
            fc = face_data.centroid
            dist = abs(ref_normal[0] * fc[0] + ref_normal[1] * fc[1] + ref_normal[2] * fc[2] + plane_d)
            if dist <= req.tolerance_mm:
                coplanar_ids.append(face_id)

        return CoplanarQueryResult(
            coplanar_face_ids=coplanar_ids,
            reference_face_id=req.reference_face_id,
            plane_normal=ref_normal,
            plane_d=plane_d,
            count=len(coplanar_ids),
        )

    def similar_entities(
        self,
        req: "SimilarQueryRequest",
    ) -> "SimilarQueryResult":
        """
        Find faces geometrically similar to the reference entity.
        For cylindrical faces: matches by radius ± tolerance and axis direction ± angle_tolerance.
        For planar faces: matches by normal direction and plane position.
        """
        import math
        from app.models.cad_modification import SimilarQueryRequest, SimilarQueryResult

        topo = self.get_topology(req.session_id, req.revision_id)
        faces = topo.faces
        edges = topo.edges

        similar_ids: List[str] = []
        basis = ""

        if req.entity_type == "face":
            ref_face = faces.get(req.reference_entity_id)
            if ref_face is None:
                return SimilarQueryResult(
                    similar_entity_ids=[],
                    reference_entity_id=req.reference_entity_id,
                    count=0,
                )

            ref_surf = (ref_face.surface_type or "").lower()
            angle_tol_rad = math.radians(req.angle_tolerance_deg)

            if ref_surf == "cylinder":
                ref_radius = ref_face.radius
                if ref_radius is None:
                    return SimilarQueryResult(
                        similar_entity_ids=[],
                        reference_entity_id=req.reference_entity_id,
                        similarity_basis="cylindrical — no radius data",
                        count=0,
                    )
                ref_axis = ref_face.axis or [0.0, 0.0, 1.0]
                basis = f"cylindrical: R={ref_radius:.3f}mm ± {req.radius_tolerance_mm:.3f}mm"

                for face_id, face in faces.items():
                    if face_id == req.reference_entity_id:
                        continue
                    if (face.surface_type or "").lower() != "cylinder":
                        continue
                    if face.radius is None:
                        continue
                    if abs(face.radius - ref_radius) > req.radius_tolerance_mm:
                        continue
                    # Axis direction check
                    if face.axis is not None:
                        fa = face.axis
                        dot = abs(fa[0] * ref_axis[0] + fa[1] * ref_axis[1] + fa[2] * ref_axis[2])
                        angle = math.acos(max(-1.0, min(1.0, dot)))
                        if angle > angle_tol_rad:
                            continue
                    similar_ids.append(face_id)

            elif ref_surf == "plane":
                ref_normal = ref_face.normal
                if ref_normal is None:
                    return SimilarQueryResult(
                        similar_entity_ids=[],
                        reference_entity_id=req.reference_entity_id,
                        similarity_basis="planar — no normal data",
                        count=0,
                    )
                ref_centroid = ref_face.centroid
                plane_d = -(ref_normal[0] * ref_centroid[0] + ref_normal[1] * ref_centroid[1] + ref_normal[2] * ref_centroid[2])
                basis = f"planar: normal={ref_normal}, area≈{ref_face.area:.1f}mm²" if ref_face.area else "planar"

                for face_id, face in faces.items():
                    if face_id == req.reference_entity_id:
                        continue
                    if (face.surface_type or "").lower() != "plane":
                        continue
                    if face.normal is None:
                        continue
                    # Normal direction
                    fn = face.normal
                    dot = abs(fn[0] * ref_normal[0] + fn[1] * ref_normal[1] + fn[2] * ref_normal[2])
                    angle = math.acos(max(-1.0, min(1.0, dot)))
                    if angle > angle_tol_rad:
                        continue
                    # Area similarity (within 20%)
                    if ref_face.area and face.area:
                        if abs(face.area - ref_face.area) / max(ref_face.area, 0.001) > 0.2:
                            continue
                    similar_ids.append(face_id)
            else:
                basis = f"{ref_surf} — no similarity logic implemented for this surface type"

        elif req.entity_type == "edge":
            ref_edge = edges.get(req.reference_entity_id)
            if ref_edge is None:
                return SimilarQueryResult(
                    similar_entity_ids=[],
                    reference_entity_id=req.reference_entity_id,
                    count=0,
                )
            ref_curve = (ref_edge.curve_type or "").lower()
            if ref_curve in ("circle", "circular") and ref_edge.radius is not None:
                ref_r = ref_edge.radius
                basis = f"circular edge: R={ref_r:.3f}mm"
                for eid, edge in edges.items():
                    if eid == req.reference_entity_id:
                        continue
                    if (edge.curve_type or "").lower() not in ("circle", "circular"):
                        continue
                    if edge.radius is None:
                        continue
                    if abs(edge.radius - ref_r) <= req.radius_tolerance_mm:
                        similar_ids.append(eid)

        return SimilarQueryResult(
            similar_entity_ids=similar_ids,
            reference_entity_id=req.reference_entity_id,
            similarity_basis=basis,
            count=len(similar_ids),
        )

    def dfm_analysis(
        self,
        req: "DfmAnalysisRequest",
    ) -> "DfmAnalysisResult":
        """
        Generate Design for Manufacturing suggestions from measured geometry.
        Checks bore diameters against ISO metric clearance hole standards,
        detects depth inconsistencies among similar bores, identifies non-standard dimensions.
        """
        import math
        import uuid as _uuid
        from app.models.cad_modification import (
            DfmAnalysisRequest, DfmAnalysisResult, DfmSuggestion, CADOperationPlan
        )

        # ISO metric clearance hole close-fit diameters (mm) for M2–M20
        ISO_METRIC_CLEARANCE = {
            2.0: 2.2, 2.5: 2.7, 3.0: 3.4, 4.0: 4.5, 5.0: 5.5,
            6.0: 6.6, 8.0: 9.0, 10.0: 11.0, 12.0: 13.5, 14.0: 15.5,
            16.0: 17.5, 20.0: 22.0,
        }
        ISO_NOMINAL = sorted(ISO_METRIC_CLEARANCE.keys())

        topo = self.get_topology(req.session_id, req.revision_id)
        faces = topo.faces

        # Filter to requested entities or all faces
        target_ids = req.selected_entity_ids if req.selected_entity_ids else list(faces.keys())
        target_faces = {fid: faces[fid] for fid in target_ids if fid in faces}

        suggestions: List[DfmSuggestion] = []
        analyzed = len(target_faces)

        # 1. Collect all cylindrical (bore) faces
        bore_faces = [
            (fid, f) for fid, f in target_faces.items()
            if (f.surface_type or "").lower() == "cylinder" and f.radius is not None
        ]

        # 2. Check bore diameters against ISO standard clearance diameters
        for fid, face in bore_faces:
            dia = (face.radius or 0.0) * 2.0
            # Find nearest ISO nominal
            nearest_nominal = min(ISO_NOMINAL, key=lambda n: abs(ISO_METRIC_CLEARANCE[n] - dia))
            nearest_clearance = ISO_METRIC_CLEARANCE[nearest_nominal]
            if abs(dia - nearest_clearance) > 0.15 and abs(dia - nearest_clearance) < 3.0:
                suggestions.append(DfmSuggestion(
                    suggestion_id=str(_uuid.uuid4())[:8],
                    category="hole_diameter",
                    severity="warning",
                    title=f"Non-standard bore diameter ⌀{dia:.2f} mm",
                    description=(
                        f"Bore ⌀{dia:.2f} mm does not match an ISO metric clearance diameter. "
                        f"Nearest match is M{nearest_nominal:.0f} clearance ⌀{nearest_clearance:.2f} mm. "
                        f"Review and standardize if this is an intended fastener clearance hole."
                    ),
                    affected_entity_ids=[fid],
                    measured_value=dia,
                    suggested_value=nearest_clearance,
                    unit="mm",
                    standard_reference=f"ISO 286-1 M{nearest_nominal:.0f} clearance",
                    proposed_operation=CADOperationPlan(
                        operation_type="edit_feature",
                        target_entity_ids=[fid],
                        parameters={"diameter": nearest_clearance},
                        description=f"Update bore to ISO M{nearest_nominal:.0f} clearance ⌀{nearest_clearance:.2f} mm",
                        confidence=0.85,
                    ),
                ))

        # 3. Detect inconsistent bore diameters among similar-looking bores
        if len(bore_faces) >= 2:
            radii = [(fid, (f.radius or 0.0) * 2.0) for fid, f in bore_faces]
            median_dia = sorted([r for _, r in radii])[len(radii) // 2]
            outliers = [(fid, d) for fid, d in radii if abs(d - median_dia) > 0.25]
            if outliers and len(outliers) < len(radii):
                for fid, dia in outliers:
                    suggestions.append(DfmSuggestion(
                        suggestion_id=str(_uuid.uuid4())[:8],
                        category="inconsistent_features",
                        severity="warning",
                        title=f"Inconsistent bore diameter ⌀{dia:.2f} mm",
                        description=(
                            f"This bore ⌀{dia:.2f} mm differs from the median bore diameter ⌀{median_dia:.2f} mm "
                            f"among {len(bore_faces)} cylindrical faces. Verify that this is intentional."
                        ),
                        affected_entity_ids=[fid],
                        measured_value=dia,
                        suggested_value=median_dia,
                        unit="mm",
                    ))

        # 4. Detect planar faces not aligned to principal planes (Z-normal ≈ 0)
        for fid, face in target_faces.items():
            if (face.surface_type or "").lower() != "plane":
                continue
            if face.normal is None:
                continue
            n = face.normal
            # Check if normal is not approximately aligned to X, Y, or Z
            alignments = [abs(n[0]), abs(n[1]), abs(n[2])]
            max_alignment = max(alignments)
            if max_alignment < 0.95:  # Not within 18° of any principal axis
                suggestions.append(DfmSuggestion(
                    suggestion_id=str(_uuid.uuid4())[:8],
                    category="face_alignment",
                    severity="info",
                    title="Non-principal face normal",
                    description=(
                        f"Face normal [{n[0]:.2f}, {n[1]:.2f}, {n[2]:.2f}] is not aligned to a principal axis. "
                        f"Verify this is an intentional drafted or angled surface, not a modeling error."
                    ),
                    affected_entity_ids=[fid],
                ))

        return DfmAnalysisResult(
            suggestions=suggestions,
            analyzed_entity_count=analyzed,
            session_id=req.session_id,
            revision_id=req.revision_id,
        )

    # --------------------------------------------------------------------------
    # Detected Features & Selection Expansion
    # --------------------------------------------------------------------------

    def get_detected_features(self, session_id: str, revision_id: str) -> List[DetectedFeature]:
        """Retrieve cached detected features or extract directly from active B-Rep revision."""
        sdir = self._get_session_dir(session_id)
        feat_path = sdir / "features" / f"{revision_id}.json"
        if feat_path.exists():
            try:
                data = json.loads(feat_path.read_text())
                return [DetectedFeature(**item) for item in data]
            except Exception:
                pass

        shape = self.load_revision_shape(session_id, revision_id)
        features = FeatureService.detect_features(shape)
        try:
            feat_path.parent.mkdir(parents=True, exist_ok=True)
            feat_path.write_text(json.dumps([f.model_dump() for f in features], indent=2))
        except Exception:
            pass
        return features

    def invalidate_features_cache(self, session_id: str, revision_id: Optional[str] = None) -> None:
        """Invalidate detected features cache when shape revisions change."""
        sdir = self._get_session_dir(session_id)
        feat_dir = sdir / "features"
        if not feat_dir.exists():
            return
        if revision_id:
            (feat_dir / f"{revision_id}.json").unlink(missing_ok=True)
        else:
            for f in feat_dir.glob("*.json"):
                try:
                    f.unlink(missing_ok=True)
                except Exception:
                    pass

    def get_parameters(self, session_id: str, revision_id: Optional[str] = None) -> ModelParametersResponse:
        """
        Analyze active solid revision to extract primitive classification,
        mass properties, and detected parametric feature tree.
        Cached per (session_id, revision_id).
        """
        sdir = self._get_session_dir(session_id)
        if not revision_id:
            topo = self.get_topology(session_id, None)
            revision_id = topo.active_revision_id

        param_cache_path = sdir / "params_cache" / f"{revision_id}.json"
        if param_cache_path.exists():
            try:
                data = json.loads(param_cache_path.read_text())
                return ModelParametersResponse(**data)
            except Exception:
                pass

        shape = self.load_revision_shape(session_id, revision_id)

        # 1. Mass properties & B-Rep counts
        val_report = BRepValidator.validate_shape(shape)
        bb = shape.bounding_box()
        extents = [round(bb.max.X - bb.min.X, 3), round(bb.max.Y - bb.min.Y, 3), round(bb.max.Z - bb.min.Z, 3)]

        props_v = GProp_GProps()
        BRepGProp.VolumeProperties_s(shape.wrapped, props_v)
        vol = max(0.0, float(props_v.Mass()))
        cm = props_v.CentreOfMass()
        com = [round(cm.X(), 3), round(cm.Y(), 3), round(cm.Z(), 3)]

        props_s = GProp_GProps()
        BRepGProp.SurfaceProperties_s(shape.wrapped, props_s)
        surf_area = max(0.0, float(props_s.Mass()))

        mass_props = MassProperties(
            volume=round(vol, 3),
            surface_area=round(surf_area, 3),
            center_of_mass=com,
            bbox_extents=extents,
            solid_count=len(shape.solids()),
            face_count=len(shape.faces()),
            edge_count=len(shape.edges()),
            is_valid=val_report.is_valid,
        )

        # 2. Primitive classification
        base_solid = self._classify_base_solid(shape, extents, vol)

        # 3. Parametric features
        detected = FeatureService.detect_features(shape)
        extracted: List[ExtractedFeature] = []
        for feat in detected:
            params_dict = {p.key: p.value for p in feat.params}
            pos_uv = [round(feat.center[0], 2), round(feat.center[1], 2)] if feat.center else None
            extracted.append(ExtractedFeature(
                feature_id=feat.feature_id,
                kind=feat.kind,
                subtype=feat.subtype,
                parameters=params_dict,
                position_uv=pos_uv,
                parent_face_id=feat.face_ids[0] if feat.face_ids else None,
                face_ids=feat.face_ids,
                confidence=feat.confidence,
            ))

        resp = ModelParametersResponse(
            session_id=session_id,
            revision_id=revision_id,
            base_solid=base_solid,
            features=extracted,
            mass_properties=mass_props,
        )

        try:
            param_cache_path.parent.mkdir(parents=True, exist_ok=True)
            param_cache_path.write_text(resp.model_dump_json(indent=2))
        except Exception:
            pass

        return resp

    def _classify_base_solid(self, shape: bd.Shape, extents: List[float], volume: float) -> BaseSolidClassification:
        dx, dy, dz = extents[0], extents[1], extents[2]
        bbox_vol = max(1e-6, dx * dy * dz)
        faces = list(shape.faces())
        num_faces = len(faces)

        # Check Box: 6 planar faces, volume fills bbox >= 0.95
        if num_faces == 6:
            all_planar = all(f.geom_type == bd.GeomType.PLANE for f in faces)
            if all_planar and (volume / bbox_vol) > 0.95:
                return BaseSolidClassification(
                    primitive="box",
                    parameters={"length": dx, "width": dy, "height": dz},
                    confidence=0.98,
                )

        # Check Cylinder: 1 or 2 cylinder faces + 2 planar caps
        cyl_faces = [f for f in faces if f.geom_type == bd.GeomType.CYLINDER]
        plane_faces = [f for f in faces if f.geom_type == bd.GeomType.PLANE]
        if (len(cyl_faces) in (1, 2)) and len(plane_faces) == 2:
            from OCP.BRepAdaptor import BRepAdaptor_Surface
            surf = BRepAdaptor_Surface(cyl_faces[0].wrapped)
            r = surf.Cylinder().Radius()
            return BaseSolidClassification(
                primitive="cylinder",
                parameters={"diameter": round(2 * r, 3), "height": dz if abs(dz - 2 * r) > 1e-2 else min(dx, dy, dz)},
                confidence=0.95,
            )

        # Check Sphere: 1 or 2 sphere faces
        sphere_faces = [f for f in faces if f.geom_type == bd.GeomType.SPHERE]
        if len(sphere_faces) in (1, 2) and len(plane_faces) == 0:
            from OCP.BRepAdaptor import BRepAdaptor_Surface
            surf = BRepAdaptor_Surface(sphere_faces[0].wrapped)
            r = surf.Sphere().Radius()
            return BaseSolidClassification(
                primitive="sphere",
                parameters={"diameter": round(2 * r, 3)},
                confidence=0.95,
            )

        # Check Cone
        cone_faces = [f for f in faces if f.geom_type == bd.GeomType.CONE]
        if cone_faces and len(plane_faces) in (1, 2):
            return BaseSolidClassification(
                primitive="cone",
                parameters={"height": dz, "base_diameter": max(dx, dy)},
                confidence=0.9,
            )

        # Check Prism (all planar)
        if all(f.geom_type == bd.GeomType.PLANE for f in faces):
            return BaseSolidClassification(
                primitive="prism",
                parameters={"length": dx, "width": dy, "height": dz, "faces": num_faces},
                confidence=0.85,
            )

        return BaseSolidClassification(
            primitive="freeform",
            parameters={"bbox_length": dx, "bbox_width": dy, "bbox_height": dz},
            confidence=0.7,
        )

    def invalidate_parameters_cache(self, session_id: str, revision_id: Optional[str] = None) -> None:
        """Invalidate extracted model parameters cache when shape revisions change."""
        sdir = self._get_session_dir(session_id)
        pdir = sdir / "params_cache"
        if not pdir.exists():
            return
        if revision_id:
            (pdir / f"{revision_id}.json").unlink(missing_ok=True)
        else:
            for f in pdir.glob("*.json"):
                try:
                    f.unlink(missing_ok=True)
                except Exception:
                    pass

    def select_more(self, req: SelectMoreRequest) -> SelectMoreResponse:
        """Topological selection expansion: adjacent, coplanar, tangent chain, edge loop, same type/size, invert, clear."""
        topo = self.get_topology(req.session_id, req.revision_id)
        mode = req.mode
        seed_ids = set(req.seed_ids)

        if mode == "clear":
            return SelectMoreResponse(transient_ids=[])

        if mode == "invert":
            is_face_mode = any(s.startswith("face_") for s in seed_ids)
            if is_face_mode or not seed_ids:
                all_ids = set(topo.faces.keys())
            else:
                all_ids = set(topo.edges.keys())
            return SelectMoreResponse(transient_ids=sorted(list(all_ids - seed_ids)))

        if mode == "adjacent":
            res_ids = set(seed_ids)
            for sid in seed_ids:
                if sid in topo.faces:
                    res_ids.update(topo.faces[sid].adjacent_face_ids)
                elif sid in topo.edges:
                    res_ids.update(topo.edges[sid].adjacent_edge_ids)
            return SelectMoreResponse(transient_ids=sorted(list(res_ids)))

        if mode == "coplanar":
            res_ids = set(seed_ids)
            for sid in seed_ids:
                if sid in topo.faces and topo.faces[sid].surface_type == "plane":
                    c_res = self.coplanar_faces(CoplanarQueryRequest(
                        session_id=req.session_id,
                        revision_id=req.revision_id,
                        reference_face_id=sid,
                    ))
                    res_ids.update(c_res.coplanar_face_ids)
            return SelectMoreResponse(transient_ids=sorted(list(res_ids)))

        if mode == "tangent_chain":
            shape = self.load_revision_shape(req.session_id, req.revision_id)
            extractor = TopologyExtractor(shape)
            extractor.extract_all()
            res_ids = set(seed_ids)
            for sid in seed_ids:
                adj = extractor.adjacency.get(sid, [])
                for a in adj:
                    if a.get("transition") in ("tangent", "smooth"):
                        res_ids.add(a["adjacent_face"])
            return SelectMoreResponse(transient_ids=sorted(list(res_ids)))

        if mode == "edge_loop":
            res_ids = set()
            for sid in seed_ids:
                if sid in topo.faces:
                    res_ids.update(topo.faces[sid].adjacent_edge_ids)
            return SelectMoreResponse(transient_ids=sorted(list(res_ids)))

        if mode == "same_type":
            res_ids = set(seed_ids)
            for sid in seed_ids:
                if sid in topo.faces:
                    stype = topo.faces[sid].surface_type
                    for fid, f in topo.faces.items():
                        if f.surface_type == stype:
                            res_ids.add(fid)
                elif sid in topo.edges:
                    ctype = topo.edges[sid].curve_type
                    for eid, e in topo.edges.items():
                        if e.curve_type == ctype:
                            res_ids.add(eid)
            return SelectMoreResponse(transient_ids=sorted(list(res_ids)))

        if mode == "same_size":
            res_ids = set(seed_ids)
            for sid in seed_ids:
                if sid in topo.faces:
                    r = topo.faces[sid].radius
                    area = topo.faces[sid].area
                    for fid, f in topo.faces.items():
                        if r is not None and f.radius is not None and abs(f.radius - r) < 1e-2:
                            res_ids.add(fid)
                        elif r is None and area is not None and f.area is not None and abs(f.area - area) < 1e-2:
                            res_ids.add(fid)
                elif sid in topo.edges:
                    l = topo.edges[sid].length
                    for eid, e in topo.edges.items():
                        if l is not None and e.length is not None and abs(e.length - l) < 1e-2:
                            res_ids.add(eid)
            return SelectMoreResponse(transient_ids=sorted(list(res_ids)))

        return SelectMoreResponse(transient_ids=sorted(list(seed_ids)))
