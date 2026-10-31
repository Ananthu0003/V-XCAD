"""Pad / Additive extrusion operations builder."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

import build123d as bd

from app.models.cad_modification import GeometricReference, OperationStatus
from app.services.geometry.geometry_context import get_planar_face_frame
from app.services.geometry.reference_resolver import ReferenceResolver
from app.services.geometry.manual_cad.common import OpResult


def apply_pad(
    shape: bd.Shape,
    refs: List[GeometricReference],
    params: Dict[str, Any],
) -> OpResult:
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

    # Deterministic workplane based on selected face frame
    origin_l, u_l, v_l, n_l = get_planar_face_frame(face)
    workplane = bd.Plane(
        origin=bd.Vector(*origin_l),
        x_dir=bd.Vector(*u_l),
        z_dir=bd.Vector(*n_l),
    )

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
        return (
            new_shape,
            OperationStatus.VALID,
            f"Pad boss ({profile_shape.capitalize()}, height {height_val:.1f}mm) union succeeded.",
            ["face_new_pad"],
            [],
        )
    except Exception as e:
        return None, OperationStatus.GEOMETRY_FAILURE, f"Pad boolean union failed: {e}", [], []

