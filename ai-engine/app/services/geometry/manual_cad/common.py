"""Common types, helpers, and constants for Manual CAD backend operations."""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

import build123d as bd

from app.models.cad_modification import GeometricReference, OperationStatus
from app.services.geometry.reference_resolver import ReferenceResolver

OpResult = Tuple[Optional[bd.Shape], OperationStatus, str, List[str], List[str]]

_AXES: Dict[str, bd.Axis] = {"x": bd.Axis.X, "y": bd.Axis.Y, "z": bd.Axis.Z}
_PLANES: Dict[str, bd.Plane] = {"xy": bd.Plane.XY, "yz": bd.Plane.YZ, "xz": bd.Plane.XZ}

MAX_PATTERN_COUNT = 100
MAX_SCALE = 1000.0
MIN_SCALE = 1e-3


def _fail(msg: str, status: OperationStatus = OperationStatus.GEOMETRY_FAILURE) -> OpResult:
    return None, status, msg, [], []


def _ok(shape: Any, msg: str, created: Optional[List[str]] = None) -> OpResult:
    if isinstance(shape, (list, bd.ShapeList)):
        items = list(shape)
        if not items:
            return _fail("Operation produced no geometry.")
        shape = items[0] if len(items) == 1 else bd.Compound(items)
    return shape, OperationStatus.VALID, msg, created or [], []


def _f(params: Dict[str, Any], key: str, default: float) -> float:
    try:
        return float(params.get(key, default))
    except (TypeError, ValueError):
        return float(default)


def _center(shape: bd.Shape) -> bd.Vector:
    return shape.bounding_box().center()


def _pivot(shape: bd.Shape, params: Dict[str, Any], refs: Optional[List[GeometricReference]] = None) -> bd.Vector:
    """Pivot for rotate/scale: 'center' of bounding box (default), world 'origin', or entity center."""
    mode = str(params.get("pivot", "center")).lower()
    if mode == "origin":
        return bd.Vector(0, 0, 0)
    if (mode == "entity" or mode == "selection") and refs:
        if refs[0].entity_type == "face":
            face, status, _ = ReferenceResolver.resolve_face(shape, refs[0])
            if face:
                return face.center()
        elif refs[0].entity_type == "edge":
            edge, status, _ = ReferenceResolver.resolve_edge(shape, refs[0])
            if edge:
                edge_center = edge.center()
                return edge_center
        elif refs[0].centroid:
            return bd.Vector(*refs[0].centroid)
    return _center(shape)


def _plane_from(
    shape: bd.Shape, refs: List[GeometricReference], params: Dict[str, Any]
) -> Tuple[Optional[bd.Plane], Optional[str]]:
    """A cutting/mirror plane: a selected planar face wins, else a named world plane + offset."""
    offset = _f(params, "offset", 0.0)
    if refs and refs[0].entity_type == "face":
        face, status, msg = ReferenceResolver.resolve_face(shape, refs[0])
        if status != OperationStatus.VALID or face is None:
            return None, msg
        if refs[0].surface_type and refs[0].surface_type.lower() != "plane":
            return None, "Selected face is not planar."
        c = face.center()
        return bd.Plane(origin=c, z_dir=face.normal_at(c)).offset(offset), None
    name = str(params.get("plane", "xy")).lower()
    base = _PLANES.get(name)
    if base is None:
        return None, f"Unknown plane '{name}'. Use XY, YZ or XZ."
    return base.offset(offset), None

