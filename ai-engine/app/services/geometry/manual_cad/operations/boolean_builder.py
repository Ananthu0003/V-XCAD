"""Boolean & Solid Shaping operations builder (Primitive, Shell, Offset, Split, Heal)."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

import build123d as bd

from app.models.cad_modification import GeometricReference, OperationStatus
from app.services.geometry.reference_resolver import ReferenceResolver
from app.services.geometry.manual_cad.common import (
    OpResult,
    _f,
    _fail,
    _ok,
    _plane_from,
)


def apply_primitive(
    shape: bd.Shape,
    refs: List[GeometricReference],
    params: Dict[str, Any],
) -> OpResult:
    kind = str(params.get("shape", "box")).lower()
    mode = str(params.get("mode", "add")).lower()
    if mode not in ("add", "subtract", "intersect"):
        return _fail(f"Unknown boolean mode '{mode}'.")
    px, py, pz = _f(params, "x", 0.0), _f(params, "y", 0.0), _f(params, "z", 0.0)

    if kind == "box":
        tool: bd.Shape = bd.Box(
            max(0.01, _f(params, "length", 10.0)),
            max(0.01, _f(params, "width", 10.0)),
            max(0.01, _f(params, "height", 10.0)),
        )
    elif kind == "cylinder":
        tool = bd.Cylinder(max(0.01, _f(params, "diameter", 10.0) / 2.0), max(0.01, _f(params, "height", 10.0)))
    elif kind == "sphere":
        tool = bd.Sphere(max(0.01, _f(params, "diameter", 10.0) / 2.0))
    elif kind == "cone":
        d1 = max(0.0, _f(params, "diameter", 10.0) / 2.0)
        d2 = max(0.0, _f(params, "top_diameter", 0.0) / 2.0)
        if d1 == 0.0 and d2 == 0.0:
            return _fail("Cone needs a non-zero base or top diameter.")
        tool = bd.Cone(d1, d2, max(0.01, _f(params, "height", 10.0)))
    else:
        return _fail(f"Unknown primitive '{kind}'. Use box, cylinder, sphere or cone.")

    origin = bd.Vector(px, py, pz)
    if refs and refs[0].entity_type == "face":
        face, status, msg = ReferenceResolver.resolve_face(shape, refs[0])
        if status != OperationStatus.VALID or face is None:
            return _fail(msg, status)
        origin = face.center() + bd.Vector(px, py, pz)
    tool = tool.moved(bd.Location(origin))

    if mode == "add":
        result, label = shape + tool, "added"
    elif mode == "subtract":
        result, label = shape - tool, "subtracted"
    else:
        result, label = shape & tool, "intersected"
    return _ok(result, f"{kind.capitalize()} {label}.", ["face_new_primitive"])


def apply_shell(
    shape: bd.Shape,
    refs: List[GeometricReference],
    params: Dict[str, Any],
) -> OpResult:
    thickness = _f(params, "thickness", 2.0)
    if thickness <= 0:
        return _fail("Wall thickness must be positive.")
    bb = shape.bounding_box()
    if thickness * 2 >= min(bb.size.X, bb.size.Y, bb.size.Z):
        return _fail("Wall thickness is too large for this body; it would consume the part.")
    openings: List[bd.Face] = []
    for r in refs:
        if r.entity_type != "face":
            continue
        face, status, msg = ReferenceResolver.resolve_face(shape, r)
        if status != OperationStatus.VALID or face is None:
            return _fail(msg, status)
        openings.append(face)
    amount = thickness if str(params.get("direction", "inside")).lower() == "outside" else -thickness
    result = bd.offset(shape, amount=amount, openings=openings or None)
    return _ok(
        result,
        f"Shelled with {thickness:g} mm wall"
        + (f", {len(openings)} open face(s)." if openings else " (closed cavity)."),
    )


def apply_offset(
    shape: bd.Shape,
    refs: List[GeometricReference],
    params: Dict[str, Any],
) -> OpResult:
    amount = _f(params, "amount", 0.2)
    if amount == 0.0:
        return _fail("Offset amount is zero.")
    bb = shape.bounding_box()
    if amount < 0 and abs(amount) * 2 >= min(bb.size.X, bb.size.Y, bb.size.Z):
        return _fail("Negative offset is larger than half the thinnest dimension.")
    return _ok(bd.offset(shape, amount=amount), f"Body offset by {amount:+g} mm (tolerance/clearance).")


def apply_split(
    shape: bd.Shape,
    refs: List[GeometricReference],
    params: Dict[str, Any],
) -> OpResult:
    plane, err = _plane_from(shape, refs, params)
    if plane is None:
        return _fail(err or "Cut plane could not be resolved.", OperationStatus.INVALID_REFERENCE)
    keep = str(params.get("keep", "top")).lower()
    keep_enum = {"top": bd.Keep.TOP, "bottom": bd.Keep.BOTTOM, "both": bd.Keep.BOTH}.get(keep)
    if keep_enum is None:
        return _fail("keep must be top, bottom or both.")
    result = bd.split(shape, plane, keep=keep_enum)
    if result is None or result.volume < 1e-6:
        return _fail("The plane does not intersect the body (nothing remains).")
    return _ok(result, f"Cut by plane, kept {keep}.")


def apply_heal(
    shape: bd.Shape,
    refs: List[GeometricReference],
    params: Dict[str, Any],
) -> OpResult:
    """Clean-up for generated geometry: fix, merge co-planar faces, drop loose debris."""
    result: bd.Shape = shape
    notes: List[str] = []
    if bool(params.get("fix", True)):
        fixed = result.fix() if hasattr(result, "fix") else result
        result = fixed or result
        notes.append("shape fixed")
    if bool(params.get("clean", True)):
        result = result.clean()
        notes.append("co-planar faces merged")
    if bool(params.get("keep_largest", True)):
        solids = list(result.solids())
        if len(solids) > 1:
            result = max(solids, key=lambda s: s.volume)
            notes.append(f"removed {len(solids) - 1} loose solid(s)")
    return _ok(result, "Heal: " + ", ".join(notes) + ".")

