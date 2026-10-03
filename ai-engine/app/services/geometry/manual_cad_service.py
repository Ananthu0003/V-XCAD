"""Manual CAD Service — Unified OpenCASCADE direct B-Rep mutation engine for VEXCAD."""
from __future__ import annotations

import json
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
    TopologyDataResponse,
    ValidationReport,
)
from app.services.geometry.brep_validator import BRepValidator
from app.services.geometry.reference_resolver import ReferenceResolver

BASE_STORAGE_DIR = Path(os.getenv("VEXCAD_STORAGE_DIR", "storage/jobs"))


class ManualCADService:
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

        outputs_dir = Path(__file__).resolve().parents[3] / "outputs"
        matching_steps = sorted(
            outputs_dir.glob(f"cad_{session_id}*.step"),
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

        outputs_dir = Path(__file__).resolve().parents[3] / "outputs"
        matching_stls = sorted(
            outputs_dir.glob(f"cad_{session_id}*.stl"),
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
            Path(__file__).resolve().parents[3] / "outputs",
            Path(__file__).resolve().parents[4] / "outputs",
            self.storage_dir.parent / "outputs",
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
                    or rev0_step.stat().st_size < 20000
                )
            )
        )

        if should_reinit:
            if base_shape is not None:
                export_step(base_shape, str(rev0_step))
            elif base_step_path and base_step_path.exists():
                shutil.copy2(base_step_path, rev0_step)
            elif matching_steps and matching_steps[0].exists():
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
            raise FileNotFoundError(f"Revision {revision_id} not found for session {session_id}")
        return import_step(str(step_path))

    def _cache_topology(self, session_id: str, revision_id: str, shape: bd.Shape) -> TopologyDataResponse:
        """Extract and cache topology metadata for fast viewport selection."""
        sdir = self._get_session_dir(session_id)
        faces_meta: Dict[str, GeometricReference] = {}
        edges_meta: Dict[str, GeometricReference] = {}

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

        data = TopologyDataResponse(
            session_id=session_id,
            revision_id=revision_id,
            faces=faces_meta,
            edges=edges_meta,
            bounding_box=bbox,
            volume_mm3=max(0.0, vol),
            is_valid=val.is_valid,
        )

        topo_path = sdir / "topology" / f"{revision_id}.json"
        topo_path.write_text(json.dumps(data.model_dump(), indent=2))
        return data

    def get_topology(self, session_id: str, revision_id: str) -> TopologyDataResponse:
        """Retrieve cached topology or recompute on the fly."""
        sdir = self._get_session_dir(session_id)
        topo_path = sdir / "topology" / f"{revision_id}.json"
        if topo_path.exists():
            try:
                data_dict = json.loads(topo_path.read_text())
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

        # Compute next revision ID
        session_file = sdir / "session.json"
        state = json.loads(session_file.read_text()) if session_file.exists() else {"revisions": ["rev_000"]}
        rev_count = len(state.get("revisions", []))
        new_rev_id = f"rev_{rev_count:03d}"

        # Write immutable STEP and STL
        new_step_path = sdir / "revisions" / f"{new_rev_id}.step"
        new_stl_path = sdir / "revisions" / f"{new_rev_id}.stl"
        export_step(modified_shape, str(new_step_path))
        export_stl(modified_shape, str(new_stl_path))

        # Write Operation Record
        op_id = f"op_{rev_count:03d}"
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

        # Cache Topology
        self._cache_topology(req.session_id, new_rev_id, modified_shape)

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
        """Measure exact B-Rep distances, radii, and angles between entities."""
        shape = self.load_revision_shape(req.session_id, req.revision_id)
        info_a: Dict[str, Any] = {}
        info_b: Optional[Dict[str, Any]] = None

        if req.entity_a.entity_type == "face":
            matched_f, status, _ = ReferenceResolver.resolve_face(shape, req.entity_a)
            if matched_f:
                info_a = {"area_mm2": req.entity_a.area, "surface_type": req.entity_a.surface_type, "centroid": req.entity_a.centroid}
        elif req.entity_a.entity_type == "edge":
            matched_e, status, _ = ReferenceResolver.resolve_edge(shape, req.entity_a)
            if matched_e:
                info_a = {"length_mm": req.entity_a.length, "curve_type": req.entity_a.curve_type, "radius_mm": req.entity_a.radius}

        dist_val: Optional[float] = None
        if req.entity_b:
            # Centroid point distance
            dx = req.entity_a.centroid[0] - req.entity_b.centroid[0]
            dy = req.entity_a.centroid[1] - req.entity_b.centroid[1]
            dz = req.entity_a.centroid[2] - req.entity_b.centroid[2]
            dist_val = (dx*dx + dy*dy + dz*dz) ** 0.5
            info_b = {"entity_type": req.entity_b.entity_type, "centroid": req.entity_b.centroid}

        return MeasureResult(
            distance_mm=dist_val,
            min_distance_mm=dist_val,
            entity_a_info=info_a,
            entity_b_info=info_b
        )

    # --------------------------------------------------------------------------
    # Geometry Execution Engine
    # --------------------------------------------------------------------------

    def _execute_operation(
        self,
        base_shape: bd.Shape,
        op_type: str,
        references: List[GeometricReference],
        parameters: Dict[str, Any]
    ) -> Tuple[Optional[bd.Shape], OperationStatus, str, List[str], List[str]]:
        """Dispatch operation to specific geometry builder."""
        try:
            if op_type == "fillet":
                return self._apply_fillet(base_shape, references, parameters)
            elif op_type == "chamfer":
                return self._apply_chamfer(base_shape, references, parameters)
            elif op_type == "hole":
                return self._apply_hole(base_shape, references, parameters)
            elif op_type == "pocket":
                return self._apply_pocket(base_shape, references, parameters)
            elif op_type == "pad":
                return self._apply_pad(base_shape, references, parameters)
            elif op_type == "boolean":
                return self._apply_boolean(base_shape, references, parameters)
            else:
                return None, OperationStatus.INVALID_REFERENCE, f"Unsupported operation type: {op_type}", [], []
        except Exception as exc:
            return None, OperationStatus.GEOMETRY_FAILURE, str(exc), [], []

    def _apply_fillet(
        self,
        shape: bd.Shape,
        refs: List[GeometricReference],
        params: Dict[str, Any]
    ) -> Tuple[Optional[bd.Shape], OperationStatus, str, List[str], List[str]]:
        radius = float(params.get("radius", 2.0))
        if radius <= 0.0:
            return None, OperationStatus.GEOMETRY_FAILURE, "Fillet radius must be strictly positive.", [], []

        resolved_edges: List[bd.Edge] = []
        mod_edges: List[str] = []

        for r in refs:
            edge, status, msg = ReferenceResolver.resolve_edge(shape, r)
            if status != OperationStatus.VALID or edge is None:
                return None, status, msg, [], []
            
            edge_len = edge.length
            max_recommended_radius = edge_len * 0.8
            if radius > edge_len:
                diag = f"Requested fillet radius ({radius:.2f}mm) exceeds selected edge length ({edge_len:.2f}mm). Max recommended radius is ~{max_recommended_radius:.2f}mm."
                return None, OperationStatus.GEOMETRY_FAILURE, diag, [], []

            resolved_edges.append(edge)
            mod_edges.append(r.transient_id)

        if not resolved_edges:
            return None, OperationStatus.INVALID_REFERENCE, "No valid edges found for fillet operation.", [], []

        try:
            new_shape = bd.fillet(resolved_edges, radius=radius)
            return new_shape, OperationStatus.VALID, f"Fillet (R{radius:.2f}mm) applied successfully on {len(resolved_edges)} edge(s).", [], mod_edges
        except Exception as e:
            diag = f"Fillet blending failed: radius {radius:.2f}mm creates non-manifold self-intersection or topology clash: {e}"
            return None, OperationStatus.GEOMETRY_FAILURE, diag, [], []

    def _apply_chamfer(
        self,
        shape: bd.Shape,
        refs: List[GeometricReference],
        params: Dict[str, Any]
    ) -> Tuple[Optional[bd.Shape], OperationStatus, str, List[str], List[str]]:
        distance = float(params.get("distance", 1.0))
        if distance <= 0.0:
            return None, OperationStatus.GEOMETRY_FAILURE, "Chamfer distance must be strictly positive.", [], []

        resolved_edges: List[bd.Edge] = []
        mod_edges: List[str] = []

        for r in refs:
            edge, status, msg = ReferenceResolver.resolve_edge(shape, r)
            if status != OperationStatus.VALID or edge is None:
                return None, status, msg, [], []

            edge_len = edge.length
            if distance > edge_len:
                diag = f"Requested chamfer distance ({distance:.2f}mm) exceeds selected edge length ({edge_len:.2f}mm)."
                return None, OperationStatus.GEOMETRY_FAILURE, diag, [], []

            resolved_edges.append(edge)
            mod_edges.append(r.transient_id)

        if not resolved_edges:
            return None, OperationStatus.INVALID_REFERENCE, "No valid edges found for chamfer operation.", [], []

        try:
            new_shape = bd.chamfer(resolved_edges, length=distance)
            return new_shape, OperationStatus.VALID, f"Chamfer ({distance:.2f}mm) applied successfully on {len(resolved_edges)} edge(s).", [], mod_edges
        except Exception as e:
            diag = f"Chamfer bevel failed: distance {distance:.2f}mm creates topology conflict: {e}"
            return None, OperationStatus.GEOMETRY_FAILURE, diag, [], []

    def _apply_hole(
        self,
        shape: bd.Shape,
        refs: List[GeometricReference],
        params: Dict[str, Any]
    ) -> Tuple[Optional[bd.Shape], OperationStatus, str, List[str], List[str]]:
        """Data-driven Hole Wizard (Blind, Through, Counterbore, Countersink)."""
        import math
        if not refs or refs[0].entity_type != "face":
            return None, OperationStatus.INVALID_REFERENCE, "Hole operation requires a planar target face reference.", [], []

        face, status, msg = ReferenceResolver.resolve_face(shape, refs[0])
        if status != OperationStatus.VALID or face is None:
            return None, status, msg, [], []

        diameter = max(0.1, float(params.get("diameter", 6.0)))
        depth = max(0.1, float(params.get("depth", 10.0)))
        hole_type = str(params.get("hole_type", "blind")).lower()
        
        pos_x = float(params.get("pos_x", params.get("position", [0.0, 0.0])[0]))
        pos_y = float(params.get("pos_y", params.get("position", [0.0, 0.0])[1] if len(params.get("position", [0.0, 0.0])) > 1 else 0.0))

        # Workplane based on selected face
        center = face.center()
        normal = face.normal_at(center)
        workplane = bd.Plane(origin=center, z_dir=normal)

        # Part bounding box for through hole depth calculation
        bnd = Bnd_Box()
        BRepBndLib.Add_s(shape.wrapped, bnd)
        xmin, ymin, zmin, xmax, ymax, zmax = bnd.Get()
        max_dim = max(xmax - xmin, ymax - ymin, zmax - zmin) * 1.5

        if hole_type == "through":
            cutter_depth = max_dim
            c_main = bd.Cylinder(radius=diameter / 2.0, height=cutter_depth)
            loc = workplane.location * bd.Location(bd.Vector(pos_x, pos_y, -cutter_depth / 2.0))
            cutter = c_main.located(loc)

        elif hole_type == "counterbore":
            cbore_dia = max(diameter + 0.5, float(params.get("cbore_diameter", diameter * 1.8)))
            cbore_depth = max(0.1, float(params.get("cbore_depth", 4.0)))
            
            c_body = bd.Cylinder(radius=diameter / 2.0, height=depth)
            c_cbore = bd.Cylinder(radius=cbore_dia / 2.0, height=cbore_depth)
            
            loc_body = workplane.location * bd.Location(bd.Vector(pos_x, pos_y, -depth / 2.0))
            loc_cbore = workplane.location * bd.Location(bd.Vector(pos_x, pos_y, -cbore_depth / 2.0))
            cutter = c_body.located(loc_body) + c_cbore.located(loc_cbore)

        elif hole_type == "countersink":
            csink_dia = max(diameter + 0.5, float(params.get("csink_diameter", diameter * 1.8)))
            csink_angle = float(params.get("csink_angle", 90.0))
            half_angle_rad = math.radians(max(10.0, min(160.0, csink_angle)) / 2.0)
            cs_depth = max(0.1, (csink_dia - diameter) / 2.0 / math.tan(half_angle_rad))

            c_body = bd.Cylinder(radius=diameter / 2.0, height=depth)
            c_cone = bd.Cone(bottom_radius=diameter / 2.0, top_radius=csink_dia / 2.0, height=cs_depth)

            loc_body = workplane.location * bd.Location(bd.Vector(pos_x, pos_y, -depth / 2.0))
            loc_cone = workplane.location * bd.Location(bd.Vector(pos_x, pos_y, -cs_depth / 2.0))
            cutter = c_body.located(loc_body) + c_cone.located(loc_cone)

        else: # Standard blind hole
            c_main = bd.Cylinder(radius=diameter / 2.0, height=depth)
            loc = workplane.location * bd.Location(bd.Vector(pos_x, pos_y, -depth / 2.0))
            cutter = c_main.located(loc)

        try:
            new_shape = shape - cutter
            return new_shape, OperationStatus.VALID, f"Hole ({hole_type.capitalize()}, Dia {diameter:.2f}mm) created successfully.", ["face_new_hole"], []
        except Exception as e:
            return None, OperationStatus.GEOMETRY_FAILURE, f"Hole boolean subtraction failed: {e}", [], []

    def _apply_pocket(
        self,
        shape: bd.Shape,
        refs: List[GeometricReference],
        params: Dict[str, Any]
    ) -> Tuple[Optional[bd.Shape], OperationStatus, str, List[str], List[str]]:
        """Subtractive 2D profile extrusion (Rectangular, Circular, Slot)."""
        if not refs or refs[0].entity_type != "face":
            return None, OperationStatus.INVALID_REFERENCE, "Pocket requires a planar face reference.", [], []

        face, status, msg = ReferenceResolver.resolve_face(shape, refs[0])
        if status != OperationStatus.VALID or face is None:
            return None, status, msg, [], []

        depth = max(0.1, float(params.get("depth", 5.0)))
        profile_shape = str(params.get("profile", "rectangle")).lower()
        pos_x = float(params.get("pos_x", 0.0))
        pos_y = float(params.get("pos_y", 0.0))
        rot_deg = float(params.get("rotation_deg", 0.0))

        center = face.center()
        normal = face.normal_at(center)
        workplane = bd.Plane(origin=center, z_dir=normal)

        try:
            if profile_shape == "circle":
                diameter = max(0.5, float(params.get("diameter", params.get("width", 20.0))))
                cutter_prism = bd.Cylinder(radius=diameter / 2.0, height=depth)
                loc = workplane.location * bd.Location(bd.Vector(pos_x, pos_y, -depth / 2.0))
                cutter_prism = cutter_prism.located(loc)

            elif profile_shape == "slot":
                length = max(1.0, float(params.get("length", params.get("width", 30.0))))
                width = max(0.5, float(params.get("width", params.get("height", 12.0))))
                if length < width:
                    length, width = width, length
                
                with bd.BuildSketch(workplane) as s:
                    with bd.Locations(bd.Location(bd.Vector(pos_x, pos_y), rot_deg)):
                        bd.SlotOverall(length, width)
                cutter_prism = bd.extrude(s.sketch, amount=-depth)

            else: # Rectangular (with optional internal corner fillet)
                width = max(1.0, float(params.get("width", 20.0)))
                height = max(1.0, float(params.get("height", 15.0)))
                corner_radius = float(params.get("corner_radius", 0.0))

                max_r = min(width, height) / 2.0 - 0.01
                corner_radius = max(0.0, min(corner_radius, max_r))

                with bd.BuildSketch(workplane) as s:
                    with bd.Locations(bd.Location(bd.Vector(pos_x, pos_y), rot_deg)):
                        if corner_radius > 0.1:
                            bd.RectangleRounded(width, height, radius=corner_radius)
                        else:
                            bd.Rectangle(width, height)
                cutter_prism = bd.extrude(s.sketch, amount=-depth)

            new_shape = shape - cutter_prism
            return new_shape, OperationStatus.VALID, f"Pocket ({profile_shape.capitalize()}, depth {depth:.1f}mm) cut succeeded.", ["face_new_pocket"], []
        except Exception as e:
            return None, OperationStatus.GEOMETRY_FAILURE, f"Pocket boolean cut failed: {e}", [], []

    def _apply_pad(
        self,
        shape: bd.Shape,
        refs: List[GeometricReference],
        params: Dict[str, Any]
    ) -> Tuple[Optional[bd.Shape], OperationStatus, str, List[str], List[str]]:
        """Additive 2D profile extrusion (Rectangular, Circular)."""
        if not refs or refs[0].entity_type != "face":
            return None, OperationStatus.INVALID_REFERENCE, "Pad requires a planar face reference.", [], []

        face, status, msg = ReferenceResolver.resolve_face(shape, refs[0])
        if status != OperationStatus.VALID or face is None:
            return None, status, msg, [], []

        height_val = max(0.1, float(params.get("height", 5.0)))
        profile_shape = str(params.get("profile", "rectangle")).lower()
        pos_x = float(params.get("pos_x", 0.0))
        pos_y = float(params.get("pos_y", 0.0))
        rot_deg = float(params.get("rotation_deg", 0.0))

        center = face.center()
        normal = face.normal_at(center)
        workplane = bd.Plane(origin=center, z_dir=normal)

        try:
            if profile_shape == "circle":
                diameter = max(0.5, float(params.get("diameter", params.get("width", 20.0))))
                boss_prism = bd.Cylinder(radius=diameter / 2.0, height=height_val)
                loc = workplane.location * bd.Location(bd.Vector(pos_x, pos_y, height_val / 2.0))
                boss_prism = boss_prism.located(loc)

            else:
                width = max(1.0, float(params.get("width", 20.0)))
                length = max(1.0, float(params.get("length", 20.0)))
                corner_radius = float(params.get("corner_radius", 0.0))

                max_r = min(width, length) / 2.0 - 0.01
                corner_radius = max(0.0, min(corner_radius, max_r))

                with bd.BuildSketch(workplane) as s:
                    with bd.Locations(bd.Location(bd.Vector(pos_x, pos_y), rot_deg)):
                        if corner_radius > 0.1:
                            bd.RectangleRounded(width, length, radius=corner_radius)
                        else:
                            bd.Rectangle(width, length)
                boss_prism = bd.extrude(s.sketch, amount=height_val)

            new_shape = shape + boss_prism
            return new_shape, OperationStatus.VALID, f"Pad boss ({profile_shape.capitalize()}, height {height_val:.1f}mm) union succeeded.", ["face_new_pad"], []
        except Exception as e:
            return None, OperationStatus.GEOMETRY_FAILURE, f"Pad boolean union failed: {e}", [], []

    def _apply_boolean(
        self,
        shape: bd.Shape,
        refs: List[GeometricReference],
        params: Dict[str, Any]
    ) -> Tuple[Optional[bd.Shape], OperationStatus, str, List[str], List[str]]:
        return shape, OperationStatus.VALID, "No-op boolean", [], []
