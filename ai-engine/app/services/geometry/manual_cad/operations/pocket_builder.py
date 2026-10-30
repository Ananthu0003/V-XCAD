"""Pocket operations builder."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

import build123d as bd
from OCP.Bnd import Bnd_Box
from OCP.BRepBndLib import BRepBndLib

from app.models.cad_modification import GeometricReference, OperationStatus
from app.services.geometry.geometry_context import get_planar_face_frame
from app.services.geometry.reference_resolver import ReferenceResolver
from app.services.geometry.manual_cad.common import OpResult


def apply_pocket(
    shape: bd.Shape,
    refs: List[GeometricReference],
    params: Dict[str, Any],
) -> OpResult:
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

    # Deterministic workplane based on selected face frame
    origin_l, u_l, v_l, n_l = get_planar_face_frame(face)
    workplane = bd.Plane(
        origin=bd.Vector(*origin_l),
        x_dir=bd.Vector(*u_l),
        z_dir=bd.Vector(*n_l),
    )

    # Part bounding box for through-all pocket depth calculation
    bnd = Bnd_Box()
    BRepBndLib.Add_s(shape.wrapped, bnd)
    xmin, ymin, zmin, xmax, ymax, zmax = bnd.Get()
    max_dim = max(xmax - xmin, ymax - ymin, zmax - zmin) * 1.5
    if params.get("through_all") or params.get("pocket_type") == "through":
        depth = max_dim

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

        else:  # Rectangular (with optional internal corner fillet)
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
        return (
            new_shape,
            OperationStatus.VALID,
            f"Pocket ({profile_shape.capitalize()}, depth {depth:.1f}mm) cut succeeded.",
            ["face_new_pocket"],
            [],
        )
    except Exception as e:
        return None, OperationStatus.GEOMETRY_FAILURE, f"Pocket boolean cut failed: {e}", [], []

