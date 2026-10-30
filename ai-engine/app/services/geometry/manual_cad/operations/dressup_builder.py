"""Dressup operations builder (Fillet, Chamfer, Round Face Edges)."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

import build123d as bd

from app.models.cad_modification import GeometricReference, OperationStatus
from app.services.geometry.reference_resolver import ReferenceResolver
from app.services.geometry.manual_cad.common import OpResult, _fail, _f, _ok


def apply_fillet(
    shape: bd.Shape,
    refs: List[GeometricReference],
    params: Dict[str, Any],
) -> OpResult:
    radius = float(params.get("radius", 2.0))
    if radius <= 0.0:
        return None, OperationStatus.GEOMETRY_FAILURE, "Fillet radius must be strictly positive.", [], []

    resolved_edges: List[bd.Edge] = []
    mod_edges: List[str] = []

    for r in refs:
        edge, status, msg = ReferenceResolver.resolve_edge(shape, r)
        if status != OperationStatus.VALID or edge is None:
            return None, status, msg, [], []

        resolved_edges.append(edge)
        mod_edges.append(r.transient_id)

    if not resolved_edges:
        return None, OperationStatus.INVALID_REFERENCE, "No valid edges found for fillet operation.", [], []

    try:
        new_shape = bd.fillet(resolved_edges, radius=radius)
        return (
            new_shape,
            OperationStatus.VALID,
            f"Fillet (R{radius:.2f}mm) applied successfully on {len(resolved_edges)} edge(s).",
            [],
            mod_edges,
        )
    except Exception as e:
        try:
            from OCP.BRepFilletAPI import BRepFilletAPI_MakeFillet

            mf = BRepFilletAPI_MakeFillet(shape.wrapped)
            for ed in resolved_edges:
                mf.Add(radius, ed.wrapped)
            mf.Build()
            if mf.IsDone():
                return (
                    bd.Solid(mf.Shape()),
                    OperationStatus.VALID,
                    f"Fillet (R{radius:.2f}mm) applied successfully on {len(resolved_edges)} edge(s).",
                    [],
                    mod_edges,
                )
        except Exception:
            pass
        diag = f"Fillet blending failed: radius {radius:.2f}mm creates non-manifold self-intersection or topology clash: {e}"
        return None, OperationStatus.GEOMETRY_FAILURE, diag, [], []


def apply_chamfer(
    shape: bd.Shape,
    refs: List[GeometricReference],
    params: Dict[str, Any],
) -> OpResult:
    distance = float(params.get("distance", 1.0))
    if distance <= 0.0:
        return None, OperationStatus.GEOMETRY_FAILURE, "Chamfer distance must be strictly positive.", [], []

    resolved_edges: List[bd.Edge] = []
    mod_edges: List[str] = []

    for r in refs:
        edge, status, msg = ReferenceResolver.resolve_edge(shape, r)
        if status != OperationStatus.VALID or edge is None:
            return None, status, msg, [], []

        resolved_edges.append(edge)
        mod_edges.append(r.transient_id)

    if not resolved_edges:
        return None, OperationStatus.INVALID_REFERENCE, "No valid edges found for chamfer operation.", [], []

    dist2 = params.get("distance2")
    use_asym = dist2 is not None and float(dist2) > 0 and float(dist2) != distance
    try:
        if use_asym:
            new_shape = bd.chamfer(resolved_edges, length=distance, length2=float(dist2))
        else:
            new_shape = bd.chamfer(resolved_edges, length=distance)
        return (
            new_shape,
            OperationStatus.VALID,
            f"Chamfer ({distance:.2f}mm) applied successfully on {len(resolved_edges)} edge(s).",
            [],
            mod_edges,
        )
    except Exception as e:
        try:
            from OCP.BRepFilletAPI import BRepFilletAPI_MakeChamfer

            mc = BRepFilletAPI_MakeChamfer(shape.wrapped)
            for ed in resolved_edges:
                mc.Add(distance, ed.wrapped)
            mc.Build()
            if mc.IsDone():
                return (
                    bd.Solid(mc.Shape()),
                    OperationStatus.VALID,
                    f"Chamfer ({distance:.2f}mm) applied successfully on {len(resolved_edges)} edge(s).",
                    [],
                    mod_edges,
                )
        except Exception:
            pass
        diag = f"Chamfer bevel failed: distance {distance:.2f}mm creates topology conflict: {e}"
        return None, OperationStatus.GEOMETRY_FAILURE, diag, [], []


def apply_round_face_edges(
    shape: bd.Shape,
    refs: List[GeometricReference],
    params: Dict[str, Any],
) -> OpResult:
    """Fillet or chamfer every edge of the selected face."""
    if not refs or refs[0].entity_type != "face":
        return _fail("round_face_edges requires a face reference.", OperationStatus.INVALID_REFERENCE)
    face, status, msg = ReferenceResolver.resolve_face(shape, refs[0])
    if status != OperationStatus.VALID or face is None:
        return _fail(msg, status)

    mode = str(params.get("mode", "fillet")).lower()
    val = max(0.01, _f(params, "radius" if mode == "fillet" else "distance", 1.0))
    edges = list(face.edges())
    if not edges:
        return _fail("Selected face has no outer edges.")

    try:
        if mode == "chamfer":
            result = bd.chamfer(edges, length=val)
            action_str = f"Chamfer ({val:.2f}mm)"
        else:
            result = bd.fillet(edges, radius=val)
            action_str = f"Fillet (R{val:.2f}mm)"
        return _ok(result, f"{action_str} applied to {len(edges)} edge(s) of the face.")
    except Exception as e:
        return _fail(f"Rounding face edges failed: {e}")

