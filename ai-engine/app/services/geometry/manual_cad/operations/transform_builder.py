"""Transform operations builder (Move, Rotate, Scale, Mirror, Align, Move Feature)."""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional

import build123d as bd
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.GeomAbs import GeomAbs_Cylinder

from app.models.cad_modification import GeometricReference, OperationStatus
from app.services.geometry.brep_validator import BRepValidator
from app.services.geometry.feature_service import FeatureService
from app.services.geometry.reference_resolver import ReferenceResolver
from app.services.geometry.manual_cad.common import (
    OpResult,
    _AXES,
    _center,
    _f,
    _fail,
    _ok,
    _pivot,
    _plane_from,
    MAX_SCALE,
    MIN_SCALE,
)
from app.services.geometry.manual_cad.operations.direct_builder import apply_delete_feature


def apply_move(
    shape: bd.Shape,
    refs: List[GeometricReference],
    params: Dict[str, Any],
) -> OpResult:
    dx, dy, dz = _f(params, "dx", 0.0), _f(params, "dy", 0.0), _f(params, "dz", 0.0)
    dist = _f(params, "distance", 0.0)
    dir_mode = str(params.get("direction", "xyz")).lower()

    if dir_mode == "normal" and refs and refs[0].entity_type == "face":
        face, status, _ = ReferenceResolver.resolve_face(shape, refs[0])
        if face:
            n = face.normal_at(face.center())
            dx, dy, dz = n.X * dist, n.Y * dist, n.Z * dist
    elif dir_mode == "edge" and refs and refs[0].entity_type == "edge":
        edge, status, _ = ReferenceResolver.resolve_edge(shape, refs[0])
        if edge:
            verts = list(edge.vertices())
            if len(verts) >= 2:
                ev = (verts[-1].center() - verts[0].center()).normalized()
                dx, dy, dz = ev.X * dist, ev.Y * dist, ev.Z * dist

    if dx == dy == dz == 0.0:
        return _fail("Move distance is zero on all axes.")
    try:
        moved = shape.moved(bd.Location((dx, dy, dz)))
        val = BRepValidator.validate_shape(moved)
        if not val.is_valid:
            return _fail(f"Move produced invalid solid: {val.error_message}")
        return _ok(moved, f"Moved by ({dx:g}, {dy:g}, {dz:g}) mm.")
    except Exception as exc:
        return _fail(f"Move failed: {exc}")


def apply_rotate(
    shape: bd.Shape,
    refs: List[GeometricReference],
    params: Dict[str, Any],
) -> OpResult:
    axis_key = str(params.get("axis", "z")).lower()
    angle = _f(params, "angle", 90.0)
    if angle % 360.0 == 0.0:
        return _fail("Rotation angle is a multiple of 360°; nothing to do.")
    p = _pivot(shape, params, refs)

    axis_dir = None
    if axis_key in _AXES:
        axis_dir = _AXES[axis_key].direction
    elif axis_key == "face_normal" and refs and refs[0].entity_type == "face":
        face, status, _ = ReferenceResolver.resolve_face(shape, refs[0])
        if face:
            n = face.normal_at(face.center())
            axis_dir = (n.X, n.Y, n.Z)
            p = face.center()
    elif axis_key == "cylinder_axis" and refs and refs[0].entity_type == "face":
        face, status, _ = ReferenceResolver.resolve_face(shape, refs[0])
        if face:
            surf = BRepAdaptor_Surface(face.wrapped)
            if surf.GetType() == GeomAbs_Cylinder:
                cyl = surf.Cylinder()
                d = cyl.Axis().Direction()
                loc = cyl.Location()
                axis_dir = (d.X(), d.Y(), d.Z())
                p = bd.Vector(loc.X(), loc.Y(), loc.Z())
    elif axis_key == "edge" and refs and refs[0].entity_type == "edge":
        edge, status, _ = ReferenceResolver.resolve_edge(shape, refs[0])
        if edge:
            verts = list(edge.vertices())
            if len(verts) >= 2:
                ev = (verts[-1].center() - verts[0].center()).normalized()
                axis_dir = (ev.X, ev.Y, ev.Z)
                p = edge.center()

    if axis_dir is None:
        axis_dir = _AXES.get(axis_key, _AXES["z"]).direction

    axis = bd.Axis(origin=p, direction=axis_dir)
    try:
        rotated = shape.rotate(axis, angle)
        val = BRepValidator.validate_shape(rotated)
        if not val.is_valid:
            return _fail(f"Rotation produced invalid solid: {val.error_message}")
        return _ok(rotated, f"Rotated {angle:g}° about {axis_key.upper()}.")
    except Exception as exc:
        return _fail(f"Rotation failed: {exc}")


def apply_scale(
    shape: bd.Shape,
    refs: List[GeometricReference],
    params: Dict[str, Any],
) -> OpResult:
    scale_type = str(params.get("scale_type", params.get("mode", "uniform"))).lower()
    if scale_type in ("uniform", "scale") or "factor" in params:
        fx = fy = fz = _f(params, "factor", 1.0)
    else:
        fx, fy, fz = _f(params, "sx", 1.0), _f(params, "sy", 1.0), _f(params, "sz", 1.0)
    for f in (fx, fy, fz):
        if not (MIN_SCALE <= f <= MAX_SCALE):
            return _fail(f"Scale factors must be between {MIN_SCALE:g} and {MAX_SCALE:g}.")
    if fx == fy == fz == 1.0:
        return _fail("Scale factor is 1; nothing to do.")
    p = _pivot(shape, params, refs)
    try:
        centred = shape.moved(bd.Location(-p))
        scaled = bd.scale(centred, by=(fx, fy, fz)) if not (fx == fy == fz) else bd.scale(centred, by=fx)
        result = scaled.moved(bd.Location(p))
        val = BRepValidator.validate_shape(result)
        if not val.is_valid:
            return _fail(f"Scale produced invalid solid: {val.error_message}")
        return _ok(result, f"Scaled ×({fx:g}, {fy:g}, {fz:g}).")
    except Exception as exc:
        return _fail(f"Scale failed: {exc}")


def apply_mirror(
    shape: bd.Shape,
    refs: List[GeometricReference],
    params: Dict[str, Any],
) -> OpResult:
    plane, err = _plane_from(shape, refs, params)
    if plane is None:
        return _fail(err or "Mirror plane could not be resolved.", OperationStatus.INVALID_REFERENCE)
    mirrored = bd.mirror(shape, plane)
    if bool(params.get("keep_original", False)):
        return _ok(shape + mirrored, "Mirrored copy added (symmetric body).")
    return _ok(mirrored, "Body mirrored.")


def apply_align(
    shape: bd.Shape,
    refs: List[GeometricReference],
    params: Dict[str, Any],
) -> OpResult:
    """Orient/position for printing or CAM: face-down, drop to bed, centre."""
    mode = str(params.get("mode", "drop_to_bed")).lower()
    out = shape
    notes: List[str] = []

    if mode == "face_down":
        if not refs or refs[0].entity_type != "face":
            return _fail("Face-down needs a selected planar face.", OperationStatus.INVALID_REFERENCE)
        face, status, msg = ReferenceResolver.resolve_face(shape, refs[0])
        if status != OperationStatus.VALID or face is None:
            return _fail(msg, status)
        n = face.normal_at(face.center())
        target = bd.Vector(0, 0, -1)
        dot = max(-1.0, min(1.0, n.X * target.X + n.Y * target.Y + n.Z * target.Z))
        if dot < 0.999999:
            if dot < -0.999999:
                rot_axis = bd.Axis(origin=_center(out), direction=(1, 0, 0))
                out = out.rotate(rot_axis, 180.0)
            else:
                cross = n.cross(target)
                rot_axis = bd.Axis(origin=_center(out), direction=(cross.X, cross.Y, cross.Z))
                out = out.rotate(rot_axis, math.degrees(math.acos(dot)))
        notes.append("face placed down")

    if mode in ("center_xy", "center_origin"):
        c = _center(out)
        out = out.moved(bd.Location((-c.X, -c.Y, -c.Z if mode == "center_origin" else 0.0)))
        notes.append("centred on origin" if mode == "center_origin" else "centred in XY")

    if mode in ("drop_to_bed", "face_down"):
        bb = out.bounding_box()
        out = out.moved(bd.Location((0, 0, -bb.min.Z)))
        notes.append("dropped to Z=0")

    if not notes:
        return _fail(f"Unknown align mode '{mode}'.")
    return _ok(out, "Aligned: " + ", ".join(notes) + ".")


def apply_transform(
    shape: bd.Shape,
    refs: List[GeometricReference],
    params: Dict[str, Any],
) -> OpResult:
    """Unified Transform dispatcher supporting move, rotate, and scale."""
    mode = str(params.get("mode", "move")).lower()
    if mode == "move":
        return apply_move(shape, refs, params)
    elif mode == "rotate":
        return apply_rotate(shape, refs, params)
    elif mode == "scale":
        return apply_scale(shape, refs, params)
    else:
        return _fail(f"Unknown transform mode '{mode}'. Use move, rotate, or scale.")


def apply_move_feature(
    shape: bd.Shape,
    refs: List[GeometricReference],
    params: Dict[str, Any],
) -> OpResult:
    """Re-position a hole/boss/pocket within its face by dx/dy/dz."""
    dx, dy, dz = _f(params, "dx", 0.0), _f(params, "dy", 0.0), _f(params, "dz", 0.0)
    if dx == dy == dz == 0.0:
        return _fail("Move offset is zero.")

    detected_features = FeatureService.detect_features(shape)
    feat_id = params.get("feature_id")
    target_feat = None
    if feat_id:
        for feat in detected_features:
            if feat.feature_id == feat_id:
                target_feat = feat
                break
    if not target_feat and refs:
        for feat in detected_features:
            if refs[0].transient_id in feat.face_ids:
                target_feat = feat
                break

    if not target_feat:
        return _fail("Feature to move not found.", OperationStatus.INVALID_REFERENCE)

    # Defeature old feature
    del_res, status, msg, _, _ = apply_delete_feature(shape, [], {"face_ids": target_feat.face_ids})
    if status != OperationStatus.VALID or del_res is None:
        return _fail(f"Could not remove feature for move: {msg}", status)

    # Rebuild shifted
    old_center = target_feat.center
    new_center = [old_center[0] + dx, old_center[1] + dy, old_center[2] + dz]
    c_axis = bd.Vector(*(target_feat.axis or [0, 0, 1])).normalized()

    if target_feat.kind == "hole":
        dia = float(next((p.value for p in target_feat.params if p.key == "diameter"), 6.0))
        depth = float(next((p.value for p in target_feat.params if p.key == "depth"), 10.0))
        if target_feat.subtype == "through":
            bb = shape.bounding_box()
            h = max(bb.max.X - bb.min.X, bb.max.Y - bb.min.Y, bb.max.Z - bb.min.Z) * 2.0
            plane = bd.Plane(origin=new_center, z_dir=c_axis)
            cutter = bd.Cylinder(radius=dia / 2.0, height=h).located(bd.Location(plane))
        else:
            plane = bd.Plane(origin=new_center, z_dir=c_axis)
            cutter = bd.Cylinder(radius=dia / 2.0, height=depth).located(
                bd.Location(plane) * bd.Location((0, 0, -depth / 2.0))
            )
        new_shape = del_res - cutter
        return _ok(new_shape, f"Feature moved by ({dx:+.1f}, {dy:+.1f}, {dz:+.1f}) mm.")

    return _fail(f"Move feature for kind '{target_feat.kind}' not implemented yet.")

