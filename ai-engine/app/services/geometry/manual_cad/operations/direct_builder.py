"""Direct modeling operations builder (Push/Pull, Delete Feature, Offset Face, Snap to Plane)."""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Set

import build123d as bd
from OCP.BRep import BRep_Builder
from OCP.BRepAlgoAPI import BRepAlgoAPI_Defeaturing
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
from OCP.GeomAbs import GeomAbs_Plane
from OCP.gp import gp_Trsf, gp_Vec
from OCP.TopoDS import TopoDS_Shell
from OCP.TopTools import TopTools_ListOfShape

from app.models.cad_modification import GeometricReference, OperationStatus
from app.services.geometry.brep_validator import BRepValidator
from app.services.geometry.feature_service import FeatureService
from app.services.geometry.reference_resolver import ReferenceResolver
from app.services.geometry.topology_extractor import TopologyExtractor
from app.services.geometry.manual_cad.common import OpResult, _fail, _ok, _f
from app.services.geometry.manual_cad.operations.hole_builder import apply_plug_hole


def apply_push_pull(
    shape: bd.Shape,
    refs: List[GeometricReference],
    params: Dict[str, Any],
) -> OpResult:
    """Offset a planar face along its normal by ±distance (extend or cut the body)."""
    if not refs or refs[0].entity_type != "face":
        return _fail("push_pull requires a planar face reference.", OperationStatus.INVALID_REFERENCE)
    face, status, msg = ReferenceResolver.resolve_face(shape, refs[0])
    if status != OperationStatus.VALID or face is None:
        return _fail(msg, status)
    if face.geom_type != bd.GeomType.PLANE:
        return _fail("push_pull is only supported on planar faces.", OperationStatus.INVALID_REFERENCE)

    distance = _f(params, "distance", 5.0)
    if abs(distance) < 1e-4:
        return _fail("Distance must not be zero.")

    try:
        prism = bd.extrude(face, amount=distance)
        if distance > 0:
            result = shape + prism
        else:
            result = shape - prism
        if result is None or result.volume < 1e-6:
            return _fail("Push/pull operation resulted in empty or invalid solid.")
        return _ok(result, f"Push/pull {distance:+.1f}mm applied.")
    except Exception as e:
        return _fail(f"Push/pull failed: {e}")


def apply_offset_face(
    shape: bd.Shape,
    refs: List[GeometricReference],
    params: Dict[str, Any],
) -> OpResult:
    """
    Push-Pull face offset along its normal direction.
    Uses True CAD Push / Pull (Extrude):
    - Outward pull (distance > 0): Extrudes face outward into solid prism (Pad / Boss)
    - Inward push (distance < 0): Extrudes face inward into cutter prism (Pocket / Cut)
    """
    if not refs or refs[0].entity_type != "face":
        return None, OperationStatus.INVALID_REFERENCE, "offset_face requires a planar face reference.", [], []

    face_ref = refs[0]
    if face_ref.surface_type and face_ref.surface_type.lower() != "plane":
        return None, OperationStatus.INVALID_REFERENCE, "offset_face is supported on planar faces only.", [], []

    distance = float(params.get("distance", 1.0))
    if distance == 0.0:
        return None, OperationStatus.GEOMETRY_FAILURE, "Offset distance must be non-zero.", [], []

    face, status, msg = ReferenceResolver.resolve_face(shape, face_ref)
    if status != OperationStatus.VALID or face is None:
        return None, status, msg, [], []

    surf = BRepAdaptor_Surface(face.wrapped)
    if surf.GetType() != GeomAbs_Plane:
        return None, OperationStatus.INVALID_REFERENCE, "offset_face: resolved face is not planar.", [], []

    try:
        face_normal = face.normal_at(face.center())
        face_to_extrude = bd.Face(face.wrapped)

        if distance > 0:
            extruded = bd.extrude(face_to_extrude, amount=distance, dir=face_normal)
            result = shape + extruded
            op_desc = f"Extruded face +{distance:.2f}mm outward (Pad / Boss)."
        else:
            cutter = bd.extrude(face_to_extrude, amount=abs(distance), dir=-face_normal)
            result = shape - cutter
            op_desc = f"Extruded face {distance:.2f}mm inward (Cut / Pocket)."

        return result, OperationStatus.VALID, op_desc, ["face_extrude"], []
    except Exception as exc:
        return None, OperationStatus.GEOMETRY_FAILURE, f"Push/Pull extrude failed: {exc}", [], []


def apply_snap_to_plane(
    shape: bd.Shape,
    refs: List[GeometricReference],
    params: Dict[str, Any],
) -> OpResult:
    """
    Translate the entire solid so that the selected face lies on a reference global plane.
    Supported planes: XY, XZ, YZ.
    """
    if not refs or refs[0].entity_type != "face":
        return None, OperationStatus.INVALID_REFERENCE, "snap_to_plane requires a planar face reference.", [], []

    face_ref = refs[0]
    face, status, msg = ReferenceResolver.resolve_face(shape, face_ref)
    if status != OperationStatus.VALID or face is None:
        return None, status, msg, [], []

    surf = BRepAdaptor_Surface(face.wrapped)
    if surf.GetType() != GeomAbs_Plane:
        return None, OperationStatus.INVALID_REFERENCE, "snap_to_plane: selected face is not planar.", [], []

    plane = surf.Plane()
    face_origin = plane.Location()

    target_plane = str(params.get("plane", "XY")).upper()
    target_coord = float(params.get("target_coordinate", 0.0))

    if target_plane == "XY":
        delta_z = target_coord - face_origin.Z()
        trsf = gp_Trsf()
        trsf.SetTranslation(gp_Vec(0.0, 0.0, delta_z))
        desc = f"Snapped to Z={target_coord:.2f}"
    elif target_plane == "XZ":
        delta_y = target_coord - face_origin.Y()
        trsf = gp_Trsf()
        trsf.SetTranslation(gp_Vec(0.0, delta_y, 0.0))
        desc = f"Snapped to Y={target_coord:.2f}"
    elif target_plane == "YZ":
        delta_x = target_coord - face_origin.X()
        trsf = gp_Trsf()
        trsf.SetTranslation(gp_Vec(delta_x, 0.0, 0.0))
        desc = f"Snapped to X={target_coord:.2f}"
    else:
        return None, OperationStatus.INVALID_REFERENCE, f"Unknown plane '{target_plane}'. Use XY, XZ, or YZ.", [], []

    try:
        builder = BRepBuilderAPI_Transform(shape.wrapped, trsf, True)
        builder.Build()
        if not builder.IsDone():
            return None, OperationStatus.GEOMETRY_FAILURE, "snap_to_plane transform failed.", [], []
        new_shape = bd.Shape(builder.Shape())
        return new_shape, OperationStatus.VALID, desc, [], []
    except Exception as exc:
        return None, OperationStatus.GEOMETRY_FAILURE, f"snap_to_plane failed: {exc}", [], []


def cluster_subpart_faces(
    shape: bd.Shape,
    initial_fids: Set[str],
) -> List[Set[str]]:
    """
    Expand a face selection to candidate 3D subpart/feature clusters
    (both protrusion-growth and cavity-growth) using boundary transition analysis.
    """
    try:
        extractor = TopologyExtractor(shape)
        extractor.extract_all()
    except Exception:
        return [set(initial_fids)]

    # Candidate 1: Protrusion cluster (follow convex + tangent, stop at concave base)
    protrusion_cluster = set(initial_fids)
    frontier_p = list(initial_fids)
    visited_p = set(initial_fids)
    while frontier_p:
        curr = frontier_p.pop(0)
        for adj in extractor.adjacency.get(curr, []):
            nbr = adj.get("adjacent_face")
            trans = adj.get("transition", "unknown")
            if not nbr or nbr in visited_p:
                continue
            if trans in ("convex", "tangent", "unknown"):
                nbr_area = extractor.faces.get(nbr, {}).get("area", 1e9)
                curr_area = extractor.faces.get(curr, {}).get("area", 0)
                if nbr_area > max(curr_area * 5.0, 500.0) and trans == "convex":
                    continue
                visited_p.add(nbr)
                protrusion_cluster.add(nbr)
                frontier_p.append(nbr)

    # Candidate 2: Cavity cluster (follow concave + tangent, stop at convex rim)
    cavity_cluster = set(initial_fids)
    frontier_c = list(initial_fids)
    visited_c = set(initial_fids)
    while frontier_c:
        curr = frontier_c.pop(0)
        for adj in extractor.adjacency.get(curr, []):
            nbr = adj.get("adjacent_face")
            trans = adj.get("transition", "unknown")
            if not nbr or nbr in visited_c:
                continue
            if trans in ("concave", "tangent", "unknown"):
                nbr_area = extractor.faces.get(nbr, {}).get("area", 1e9)
                curr_area = extractor.faces.get(curr, {}).get("area", 0)
                if nbr_area > max(curr_area * 5.0, 500.0) and trans == "concave":
                    continue
                visited_c.add(nbr)
                cavity_cluster.add(nbr)
                frontier_c.append(nbr)

    results: List[Set[str]] = []
    if len(protrusion_cluster) > len(initial_fids):
        results.append(protrusion_cluster)
    if len(cavity_cluster) > len(initial_fids):
        results.append(cavity_cluster)
    if not results:
        results.append(set(initial_fids))
    return results


def apply_delete_feature(
    shape: bd.Shape,
    refs: List[GeometricReference],
    params: Dict[str, Any],
) -> OpResult:
    """
    Delete a 3D subpart, feature, or selected face(s) using a multi-strategy engine.
    """
    shape_faces = list(shape.faces())
    specified_fids: Set[str] = set()

    # 1. From params["face_ids"]
    face_ids = params.get("face_ids", [])
    if isinstance(face_ids, list):
        for fid in face_ids:
            if isinstance(fid, str):
                specified_fids.add(fid)
            elif isinstance(fid, int) and 0 <= fid < len(shape_faces):
                specified_fids.add(f"face_{fid}")

    # 2. From refs
    resolved_faces: List[bd.Face] = []
    for ref in refs:
        if ref.entity_type == "face":
            f, status, _ = ReferenceResolver.resolve_face(shape, ref)
            if f:
                resolved_faces.append(f)
                if ref.transient_id:
                    specified_fids.add(ref.transient_id)
                else:
                    for i, sf in enumerate(shape_faces):
                        if sf.is_same(f):
                            specified_fids.add(f"face_{i}")
                            break

    # 1. Multi-Solid Subpart Removal
    solids = list(shape.solids())
    if len(solids) > 1:
        target_faces_for_solid = list(resolved_faces)
        for fid in specified_fids:
            if fid.startswith("face_"):
                try:
                    idx = int(fid.replace("face_", ""))
                    if 0 <= idx < len(shape_faces):
                        target_faces_for_solid.append(shape_faces[idx])
                except Exception:
                    pass

        solids_to_keep: List[bd.Solid] = []
        deleted_solids_count = 0
        for sol in solids:
            sol_faces = list(sol.faces())
            has_target = any(any(tf.is_same(sf) for sf in sol_faces) for tf in target_faces_for_solid)
            if has_target:
                deleted_solids_count += 1
            else:
                solids_to_keep.append(sol)

        if deleted_solids_count > 0 and solids_to_keep:
            remaining_shape = bd.Compound(solids_to_keep) if len(solids_to_keep) > 1 else solids_to_keep[0]
            return _ok(remaining_shape, f"3D subpart deleted ({deleted_solids_count} solid(s) removed).")

    # 2. Feature Detection & Correlation
    detected_features = FeatureService.detect_features(shape)
    feat_id = params.get("feature_id")
    matched_features = []

    if feat_id:
        for feat in detected_features:
            if feat.feature_id == feat_id:
                matched_features.append(feat)

    if not matched_features and specified_fids:
        for feat in detected_features:
            if any(fid in feat.face_ids for fid in specified_fids):
                matched_features.append(feat)

    for feat in matched_features:
        for fid in feat.face_ids:
            specified_fids.add(fid)

    # 3. Build candidate face sets for removal
    candidate_fids_sets: List[Set[str]] = []
    if specified_fids:
        if not matched_features:
            clusters = cluster_subpart_faces(shape, specified_fids)
            for cl in clusters:
                if len(cl) > len(specified_fids):
                    candidate_fids_sets.append(cl)
        candidate_fids_sets.append(set(specified_fids))

    # 4. Strategy A: BRepAlgoAPI_Defeaturing with HasDeleted() validation
    for cand_fids in candidate_fids_sets:
        cand_faces: List[bd.Face] = []
        for fid in cand_fids:
            if fid.startswith("face_"):
                try:
                    idx = int(fid.replace("face_", ""))
                    if 0 <= idx < len(shape_faces):
                        f = shape_faces[idx]
                        if not any(f.is_same(existing) for existing in cand_faces):
                            cand_faces.append(f)
                except Exception:
                    pass
        for f in resolved_faces:
            if not any(f.is_same(existing) for existing in cand_faces):
                cand_faces.append(f)

        if not cand_faces:
            continue

        try:
            df = BRepAlgoAPI_Defeaturing()
            df.SetShape(shape.wrapped)
            occ_list = TopTools_ListOfShape()
            for f in cand_faces:
                occ_list.Append(f.wrapped)
            df.AddFacesToRemove(occ_list)
            df.Build()
            if df.IsDone() and df.HasDeleted():
                res_shp = df.Shape()
                try:
                    cand_shape = bd.Solid(res_shp)
                except Exception:
                    cand_shape = bd.Compound(res_shp)
                if len(cand_shape.faces()) < len(shape_faces) and cand_shape.is_valid:
                    return _ok(cand_shape, f"Feature / subpart deleted ({len(cand_faces)} face(s) removed).")
        except Exception:
            pass

    # 5. Strategy B: Cylinder / Bore Hole Plugging Fallback
    all_resolved_faces: List[bd.Face] = list(resolved_faces)
    for fid in specified_fids:
        if fid.startswith("face_"):
            try:
                idx = int(fid.replace("face_", ""))
                if 0 <= idx < len(shape_faces):
                    f = shape_faces[idx]
                    if not any(f.is_same(existing) for existing in all_resolved_faces):
                        all_resolved_faces.append(f)
            except Exception:
                pass

    for f in all_resolved_faces:
        if f.geom_type == bd.GeomType.CYLINDER:
            try:
                cyl_ref = ReferenceResolver.extract_face_reference(f, "face_cyl")
                plug_res, plug_status, plug_msg, _, _ = apply_plug_hole(shape, [cyl_ref], params)
                if plug_status == OperationStatus.VALID and plug_res is not None:
                    return _ok(plug_res, f"Feature bore plugged ({plug_msg}).")
            except Exception:
                pass

    # 6. Strategy C: Protrusion Base-Plane Split Fallback
    try:
        extractor = TopologyExtractor(shape)
        extractor.extract_all()
        base_planar_faces: List[bd.Face] = []
        for rf in all_resolved_faces:
            rf_idx = None
            for i, sf in enumerate(shape_faces):
                if sf.is_same(rf):
                    rf_idx = i
                    break
            if rf_idx is not None:
                fid = f"face_{rf_idx}"
                for adj in extractor.adjacency.get(fid, []):
                    if adj.get("transition") == "concave":
                        nbr_id = adj.get("adjacent_face")
                        if nbr_id and nbr_id not in specified_fids:
                            nbr_meta = extractor.faces.get(nbr_id, {})
                            if nbr_meta.get("type") == "plane":
                                n_obj = extractor.get_face_object(nbr_id)
                                if n_obj and not any(n_obj.is_same(bf) for bf in base_planar_faces):
                                    base_planar_faces.append(n_obj)

        for b_face in base_planar_faces:
            try:
                b_plane = bd.Plane(b_face)
                split_res = shape.split(b_plane, keep=bd.Keep.ALL)
                split_solids = list(split_res.solids()) if hasattr(split_res, "solids") else []
                if len(split_solids) > 1:
                    surviving = [
                        s
                        for s in split_solids
                        if not any(any(rf.is_same(sf) for sf in s.faces()) for rf in all_resolved_faces)
                    ]
                    if surviving:
                        new_body = bd.Compound(surviving) if len(surviving) > 1 else surviving[0]
                        if new_body.is_valid and len(new_body.faces()) < len(shape_faces):
                            return _ok(
                                new_body,
                                f"3D subpart removed via boundary cut ({len(all_resolved_faces)} face(s) removed).",
                            )
            except Exception:
                continue
    except Exception:
        pass

    # 7. Strategy D: Direct Face Removal (Shell Creation) Fallback
    if all_resolved_faces:
        try:
            builder = BRep_Builder()
            new_shell = TopoDS_Shell()
            builder.MakeShell(new_shell)
            kept_count = 0
            for sf in shape_faces:
                if not any(sf.is_same(rf) for rf in all_resolved_faces):
                    builder.Add(new_shell, sf.wrapped)
                    kept_count += 1

            if kept_count > 0 and kept_count < len(shape_faces):
                shell_shape = bd.Shell(new_shell)
                if shell_shape.is_valid:
                    return _ok(shell_shape, f"Face(s) deleted ({len(all_resolved_faces)} face(s) removed).")
        except Exception:
            pass

    return _fail("Defeaturing failed: feature boundary could not be healed.")

