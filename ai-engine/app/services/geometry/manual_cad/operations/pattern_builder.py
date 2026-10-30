"""Pattern operations builder (Linear Pattern, Polar Pattern, Pattern Feature)."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

import build123d as bd

from app.models.cad_modification import GeometricReference, OperationStatus
from app.services.geometry.feature_service import FeatureService
from app.services.geometry.reference_resolver import ReferenceResolver
from app.services.geometry.manual_cad.common import (
    OpResult,
    _AXES,
    _f,
    _fail,
    _ok,
    MAX_PATTERN_COUNT,
)


def apply_linear_pattern(
    shape: bd.Shape,
    refs: List[GeometricReference],
    params: Dict[str, Any],
) -> OpResult:
    count = int(_f(params, "count", 3))
    if not (2 <= count <= MAX_PATTERN_COUNT):
        return _fail(f"Count must be between 2 and {MAX_PATTERN_COUNT}.")
    dx, dy, dz = _f(params, "dx", 20.0), _f(params, "dy", 0.0), _f(params, "dz", 0.0)
    if dx == dy == dz == 0.0:
        return _fail("Pattern spacing is zero.")
    result = shape
    for i in range(1, count):
        result = result + shape.moved(bd.Location((dx * i, dy * i, dz * i)))
    return _ok(result, f"Linear pattern ×{count}.")


def apply_polar_pattern(
    shape: bd.Shape,
    refs: List[GeometricReference],
    params: Dict[str, Any],
) -> OpResult:
    count = int(_f(params, "count", 4))
    if not (2 <= count <= MAX_PATTERN_COUNT):
        return _fail(f"Count must be between 2 and {MAX_PATTERN_COUNT}.")
    axis_raw = params.get("axis", "z")
    axis_dir = None
    axis_label = str(axis_raw)
    if isinstance(axis_raw, (list, tuple)) and len(axis_raw) == 3:
        axis_dir = (float(axis_raw[0]), float(axis_raw[1]), float(axis_raw[2]))
    else:
        axis_key = str(axis_raw).lower()
        if axis_key in _AXES:
            axis_dir = _AXES[axis_key].direction
            axis_label = axis_key.upper()
        elif axis_key == "face_normal" and refs and refs[0].entity_type == "face":
            face, status, _ = ReferenceResolver.resolve_face(shape, refs[0])
            if face:
                n = face.normal_at(face.center())
                axis_dir = (n.X, n.Y, n.Z)
                axis_label = "Face Normal"
    if not axis_dir:
        return _fail(f"Unknown axis '{axis_raw}'. Use X, Y, Z, or [dx, dy, dz].")
    total = _f(params, "angle", 360.0)
    # A full circle must not duplicate the first instance at 360°.
    step = total / count if abs(total) >= 360.0 else total / (count - 1)
    axis = bd.Axis(
        origin=(_f(params, "cx", 0.0), _f(params, "cy", 0.0), _f(params, "cz", 0.0)),
        direction=axis_dir,
    )
    result = shape
    for i in range(1, count):
        result = result + shape.rotate(axis, step * i)
    return _ok(result, f"Polar pattern ×{count} about {axis_label}.")


def apply_pattern_feature(
    shape: bd.Shape,
    refs: List[GeometricReference],
    params: Dict[str, Any],
) -> OpResult:
    """Linear or polar pattern of one feature."""
    count = int(_f(params, "count", 3))
    if not (2 <= count <= MAX_PATTERN_COUNT):
        return _fail(f"Pattern count must be between 2 and {MAX_PATTERN_COUNT}.")

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
        return _fail("Feature to pattern not found.", OperationStatus.INVALID_REFERENCE)

    center = target_feat.center
    axis = target_feat.axis or [0, 0, 1]
    c_axis = bd.Vector(*axis).normalized()

    if target_feat.kind == "hole":
        dia = float(next((p.value for p in target_feat.params if p.key == "diameter"), 6.0))
        depth = float(next((p.value for p in target_feat.params if p.key == "depth"), 10.0))
        bb = shape.bounding_box()
        h = max(bb.max.X - bb.min.X, bb.max.Y - bb.min.Y, bb.max.Z - bb.min.Z) * 2.0

        result = shape
        dx, dy, dz = _f(params, "dx", 20.0), _f(params, "dy", 0.0), _f(params, "dz", 0.0)

        for i in range(1, count):
            offset = (dx * i, dy * i, dz * i)
            new_center = [center[0] + offset[0], center[1] + offset[1], center[2] + offset[2]]
            plane = bd.Plane(origin=new_center, z_dir=c_axis)
            if target_feat.subtype == "through":
                cutter = bd.Cylinder(radius=dia / 2.0, height=h).located(bd.Location(plane))
            else:
                cutter = bd.Cylinder(radius=dia / 2.0, height=depth).located(
                    bd.Location(plane) * bd.Location((0, 0, -depth / 2.0))
                )
            result = result - cutter

        return _ok(result, f"Feature patterned ×{count}.")

    return _fail(f"Pattern feature for kind '{target_feat.kind}' not implemented yet.")

