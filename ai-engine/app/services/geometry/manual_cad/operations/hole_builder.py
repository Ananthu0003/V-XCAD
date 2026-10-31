"""Hole and Plug operations builder."""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Tuple

import build123d as bd
from OCP.Bnd import Bnd_Box
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps

from app.models.cad_modification import GeometricReference, OperationStatus
from app.services.geometry.geometry_context import get_planar_face_frame
from app.services.geometry.reference_resolver import ReferenceResolver
from app.services.geometry.manual_cad.common import OpResult


def apply_hole(
    shape: bd.Shape,
    refs: List[GeometricReference],
    params: Dict[str, Any],
) -> OpResult:
    """Data-driven Hole Wizard (Blind, Through, Counterbore, Countersink)."""
    if not refs or refs[0].entity_type != "face":
        return None, OperationStatus.INVALID_REFERENCE, "Hole operation requires a planar target face reference.", [], []

    face, status, msg = ReferenceResolver.resolve_face(shape, refs[0])
    if status != OperationStatus.VALID or face is None:
        return None, status, msg, [], []

    diameter = max(0.1, float(params.get("diameter", 6.0)))
    depth = max(0.1, float(params.get("depth", 10.0)))
    hole_type = str(params.get("hole_type", "blind")).lower()

    pos_x = float(params.get("pos_x", params.get("position", [0.0, 0.0])[0]))
    pos_y = float(
        params.get(
            "pos_y",
            params.get("position", [0.0, 0.0])[1] if len(params.get("position", [0.0, 0.0])) > 1 else 0.0,
        )
    )

    # Deterministic workplane based on selected face frame
    origin_l, u_l, v_l, n_l = get_planar_face_frame(face)
    workplane = bd.Plane(
        origin=bd.Vector(*origin_l),
        x_dir=bd.Vector(*u_l),
        z_dir=bd.Vector(*n_l),
    )

    # Part bounding box for through hole depth calculation
    bnd = Bnd_Box()
    BRepBndLib.Add_s(shape.wrapped, bnd)
    xmin, ymin, zmin, xmax, ymax, zmax = bnd.Get()
    max_dim = max(xmax - xmin, ymax - ymin, zmax - zmin) * 1.5

    if hole_type == "through":
        overshoot = 2.0
        cutter_depth = max_dim + overshoot * 2.0
        c_main = bd.Cylinder(radius=diameter / 2.0, height=cutter_depth)
        loc = workplane.location * bd.Location(bd.Vector(pos_x, pos_y, -max_dim / 2.0))
        cutter = c_main.located(loc)

    elif hole_type == "counterbore":
        cbore_dia = max(diameter + 0.5, float(params.get("cbore_diameter", diameter * 1.8)))
        cbore_depth = max(0.1, float(params.get("cbore_depth", 4.0)))

        overshoot = 0.5
        c_body = bd.Cylinder(radius=diameter / 2.0, height=depth + overshoot)
        c_cbore = bd.Cylinder(radius=cbore_dia / 2.0, height=cbore_depth + overshoot)

        loc_body = workplane.location * bd.Location(bd.Vector(pos_x, pos_y, (-depth + overshoot) / 2.0))
        loc_cbore = workplane.location * bd.Location(bd.Vector(pos_x, pos_y, (-cbore_depth + overshoot) / 2.0))
        cutter = c_body.located(loc_body) + c_cbore.located(loc_cbore)

    elif hole_type == "countersink":
        csink_dia = max(diameter + 0.5, float(params.get("csink_diameter", diameter * 1.8)))
        csink_angle = float(params.get("csink_angle", 90.0))
        half_angle_rad = math.radians(max(10.0, min(160.0, csink_angle)) / 2.0)
        cs_depth = max(0.1, (csink_dia - diameter) / 2.0 / math.tan(half_angle_rad))

        overshoot = 0.5
        c_body = bd.Cylinder(radius=diameter / 2.0, height=depth + overshoot)
        c_cone = bd.Cone(bottom_radius=diameter / 2.0, top_radius=csink_dia / 2.0, height=cs_depth)
        c_lip = bd.Cylinder(radius=csink_dia / 2.0, height=overshoot)

        loc_body = workplane.location * bd.Location(bd.Vector(pos_x, pos_y, (-depth + overshoot) / 2.0))
        loc_cone = workplane.location * bd.Location(bd.Vector(pos_x, pos_y, -cs_depth / 2.0))
        loc_lip = workplane.location * bd.Location(bd.Vector(pos_x, pos_y, overshoot / 2.0))
        cutter = c_body.located(loc_body) + c_cone.located(loc_cone) + c_lip.located(loc_lip)

    else:  # Standard blind hole
        overshoot = 0.5
        c_main = bd.Cylinder(radius=diameter / 2.0, height=depth + overshoot)
        loc = workplane.location * bd.Location(bd.Vector(pos_x, pos_y, (-depth + overshoot) / 2.0))
        cutter = c_main.located(loc)

    try:
        new_shape = shape - cutter
        return (
            new_shape,
            OperationStatus.VALID,
            f"Hole ({hole_type.capitalize()}, Dia {diameter:.2f}mm) created successfully.",
            ["face_new_hole"],
            [],
        )
    except Exception as e:
        return None, OperationStatus.GEOMETRY_FAILURE, f"Hole boolean subtraction failed: {e}", [], []


def apply_plug_hole(
    shape: bd.Shape,
    refs: List[GeometricReference],
    params: Dict[str, Any],
) -> OpResult:
    """
    Bore defeaturing: remove a cylindrical bore and reconstruct the parent surface.
    Uses boolean union with a cylinder matching the bore geometry.
    """
    from OCP.BRepAdaptor import BRepAdaptor_Surface
    from OCP.GeomAbs import GeomAbs_Cylinder

    if not refs or refs[0].entity_type != "face":
        return None, OperationStatus.INVALID_REFERENCE, "plug_hole requires a cylindrical face reference.", [], []

    face, status, msg = ReferenceResolver.resolve_face(shape, refs[0])
    if status != OperationStatus.VALID or face is None:
        return None, status, msg, [], []

    surf = BRepAdaptor_Surface(face.wrapped)
    if surf.GetType() != GeomAbs_Cylinder:
        return None, OperationStatus.INVALID_REFERENCE, "plug_hole only works on cylindrical bore faces.", [], []

    cyl = surf.Cylinder()
    radius = cyl.Radius()
    loc = cyl.Location()
    axis = cyl.Axis().Direction()

    # Determine bore extent from UV bounds
    try:
        from OCP.BRepTools import BRepTools

        _, _, vmin, vmax = BRepTools.UVBounds_s(face.wrapped)
        bore_len = abs(vmax - vmin)
        v_mid = (vmin + vmax) / 2.0
        plug_origin = bd.Vector(loc.X(), loc.Y(), loc.Z()) + bd.Vector(axis.X(), axis.Y(), axis.Z()) * v_mid
    except Exception:
        bnd = Bnd_Box()
        BRepBndLib.Add_s(face.wrapped, bnd)
        xmin, ymin, zmin, xmax, ymax, zmax = bnd.Get()
        bore_len = max(xmax - xmin, ymax - ymin, zmax - zmin)
        plug_origin = face.center()

    z_dir = bd.Vector(axis.X(), axis.Y(), axis.Z())
    workplane = bd.Plane(origin=plug_origin, z_dir=z_dir)

    try:
        plug = bd.Cylinder(radius=radius + 1e-4, height=bore_len)
        plug = plug.located(workplane.location)

        result = shape + plug

        props = GProp_GProps()
        BRepGProp.VolumeProperties_s(result.wrapped, props)
        new_vol = float(props.Mass())
        if new_vol <= 0:
            return (
                None,
                OperationStatus.GEOMETRY_FAILURE,
                "plug_hole produced zero-volume solid — bore may be through complex topology.",
                [],
                [],
            )

        return (
            result,
            OperationStatus.VALID,
            f"Bore plugged (R={radius:.2f}mm, length={bore_len:.1f}mm).",
            [],
            ["edge_bore_rim"],
        )
    except Exception as exc:
        return None, OperationStatus.GEOMETRY_FAILURE, f"plug_hole boolean union failed: {exc}", [], []

