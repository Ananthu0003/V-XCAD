"""Parametric feature editing builder (Edit Feature, Planar Dimension Edit, Legacy Cylinder Edit)."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

import build123d as bd
from OCP.BRepAlgoAPI import BRepAlgoAPI_Defeaturing
from OCP.TopTools import TopTools_ListOfShape

from app.models.cad_modification import GeometricReference, OperationStatus
from app.services.geometry.brep_validator import BRepValidator
from app.services.geometry.feature_service import FeatureService
from app.services.geometry.reference_resolver import ReferenceResolver
from app.services.geometry.manual_cad.common import (
    OpResult,
    _f,
    _fail,
    _ok,
)
from app.services.geometry.manual_cad.operations.direct_builder import apply_push_pull


def apply_legacy_cylinder_edit(
    shape: bd.Shape,
    face: bd.Face,
    params: Dict[str, Any],
) -> OpResult:
    from OCP.BRepAdaptor import BRepAdaptor_Surface
    from OCP.GeomAbs import GeomAbs_Cylinder
    from OCP.BRepTools import BRepTools

    surf = BRepAdaptor_Surface(face.wrapped)
    if surf.GetType() != GeomAbs_Cylinder:
        return _fail("Face is not cylindrical.")

    cyl = surf.Cylinder()
    old_radius = cyl.Radius()
    loc = cyl.Location()
    axis = cyl.Axis().Direction()
    new_dia = float(params.get("diameter", old_radius * 2.0))
    new_radius = new_dia / 2.0

    # Hole vs Boss: outward normal vs radial vector
    pt = face.center()
    n = face.normal_at(pt)
    v_to_pt = bd.Vector(pt.X - loc.X(), pt.Y - loc.Y(), pt.Z - loc.Z())
    ax_dir = bd.Vector(axis.X(), axis.Y(), axis.Z()).normalized()
    v_radial = v_to_pt - ax_dir * v_to_pt.dot(ax_dir)
    is_hole = (n.X * v_radial.X + n.Y * v_radial.Y + n.Z * v_radial.Z) < 0

    try:
        _, _, vmin, vmax = BRepTools.UVBounds_s(face.wrapped)
        bore_len = abs(vmax - vmin)
        v_mid = (vmin + vmax) / 2.0
        center_pt = bd.Vector(loc.X(), loc.Y(), loc.Z()) + ax_dir * v_mid
    except Exception:
        bore_len = 10.0
        center_pt = bd.Vector(pt.X, pt.Y, pt.Z)

    new_depth = float(params.get("depth", bore_len))

    # 1. Defeaturing attempt
    try:
        df = BRepAlgoAPI_Defeaturing()
        df.SetShape(shape.wrapped)
        lst = TopTools_ListOfShape()
        lst.Append(face.wrapped)
        df.AddFacesToRemove(lst)
        df.Build()
        if df.IsDone():
            base_sol = bd.Solid(df.Shape())
            plane = bd.Plane(origin=center_pt, z_dir=ax_dir)
            if is_hole:
                cutter = bd.Cylinder(radius=new_radius, height=new_depth).located(bd.Location(plane))
                new_shape = base_sol - cutter
            else:
                boss = bd.Cylinder(radius=new_radius, height=new_depth).located(bd.Location(plane))
                new_shape = base_sol + boss
            val = BRepValidator.validate_shape(new_shape)
            if val.is_valid:
                return _ok(new_shape, f"Cylinder updated to Ø{new_dia:.1f}mm.")
    except Exception:
        pass

    # 2. Exact CSG fallback (plug and cut/add)
    try:
        plane = bd.Plane(origin=center_pt, z_dir=ax_dir)
        if is_hole:
            plug = bd.Cylinder(radius=old_radius + 1e-4, height=bore_len).located(bd.Location(plane))
            filled = shape + plug
            cutter = bd.Cylinder(radius=new_radius, height=new_depth).located(bd.Location(plane))
            new_shape = filled - cutter
            val = BRepValidator.validate_shape(new_shape)
            if val.is_valid:
                return _ok(new_shape, f"Hole updated to Ø{new_dia:.1f}mm.")
        else:
            old_boss = bd.Cylinder(radius=old_radius + 1e-4, height=bore_len).located(bd.Location(plane))
            removed = shape - old_boss
            new_boss = bd.Cylinder(radius=new_radius, height=new_depth).located(bd.Location(plane))
            new_shape = removed + new_boss
            val = BRepValidator.validate_shape(new_shape)
            if val.is_valid:
                return _ok(new_shape, f"Boss updated to Ø{new_dia:.1f}mm.")
    except Exception as e:
        return _fail(f"Cylinder edit failed: {e}")
    return _fail("Legacy cylinder edit could not be applied.")


def apply_planar_dimension_edit(
    shape: bd.Shape,
    face: bd.Face,
    params: Dict[str, Any],
    refs: List[GeometricReference],
) -> OpResult:
    """Direct dimension / push-pull editing on a planar face."""
    dist = _f(params, "distance", 0.0)
    if dist == 0.0 and "depth" in params:
        dist = -_f(params, "depth", 0.0)
    elif dist == 0.0 and "height" in params:
        dist = _f(params, "height", 0.0)

    if dist != 0.0:
        return apply_push_pull(shape, refs, {"distance": dist})

    new_len = params.get("length") or params.get("rect_length")
    new_w = params.get("width") or params.get("rect_width")
    if new_len is not None or new_w is not None:
        bb = shape.bounding_box()
        old_dx = max(1e-3, bb.max.X - bb.min.X)
        old_dy = max(1e-3, bb.max.Y - bb.min.Y)
        fx = float(new_w) / old_dx if new_w is not None else 1.0
        fy = float(new_len) / old_dy if new_len is not None else 1.0
        p = face.center()
        centred = shape.moved(bd.Location(-p))
        scaled = bd.scale(centred, by=(fx, fy, 1.0))
        result = scaled.moved(bd.Location(p))
        val = BRepValidator.validate_shape(result)
        if val.is_valid:
            return _ok(result, f"Dimensions updated to L={new_len or old_dy:.1f}mm, W={new_w or old_dx:.1f}mm.")

    return _fail("No valid dimension changes specified for planar face.")


def apply_edit_feature(
    shape: bd.Shape,
    refs: List[GeometricReference],
    params: Dict[str, Any],
) -> OpResult:
    """Parametric direct feature modification with defeaturing and rebuild."""
    changes = dict(params.get("changes", params))

    # Check for batch edits
    batch_ids = params.get("batch_feature_ids") or params.get("feature_ids")
    if batch_ids and isinstance(batch_ids, list):
        current_shape = shape
        for fid in batch_ids:
            sub_params = {**params, "feature_id": fid, "batch_feature_ids": None, "feature_ids": None}
            res_shape, status, msg, _, _ = apply_edit_feature(current_shape, [], sub_params)
            if status != OperationStatus.VALID or res_shape is None:
                return _fail(f"Batch edit failed on feature '{fid}': {msg}", status)
            current_shape = res_shape
        return _ok(current_shape, f"Batch edit applied to {len(batch_ids)} features.")

    # Detect features on current shape
    detected_features = FeatureService.detect_features(shape)
    feat_id = params.get("feature_id")
    target_feat = None

    if feat_id:
        for feat in detected_features:
            if feat.feature_id == feat_id:
                target_feat = feat
                break

    if not target_feat and refs and refs[0].entity_type == "face":
        ref_tid = refs[0].transient_id
        for feat in detected_features:
            if ref_tid in feat.face_ids:
                target_feat = feat
                break

    # Fallback to single cylinder edit or planar dimension edit if no compound feature detected
    if not target_feat:
        if refs and refs[0].entity_type == "face":
            face, status, _ = ReferenceResolver.resolve_face(shape, refs[0])
            if face and face.geom_type == bd.GeomType.CYLINDER:
                return apply_legacy_cylinder_edit(shape, face, changes)
            elif face and face.geom_type == bd.GeomType.PLANE:
                return apply_planar_dimension_edit(shape, face, changes, refs)
        return _fail("Target feature could not be found on the model.", OperationStatus.INVALID_REFERENCE)

    # Defeature old feature faces
    shape_faces = list(shape.faces())
    faces_to_remove: List[bd.Face] = []
    for fid in target_feat.face_ids:
        if fid.startswith("face_"):
            try:
                idx = int(fid.replace("face_", ""))
                if 0 <= idx < len(shape_faces):
                    faces_to_remove.append(shape_faces[idx])
            except Exception:
                pass

    if not faces_to_remove:
        return _fail("Feature faces could not be located for editing.", OperationStatus.INVALID_REFERENCE)

    try:
        df = BRepAlgoAPI_Defeaturing()
        df.SetShape(shape.wrapped)
        occ_list = TopTools_ListOfShape()
        for f in faces_to_remove:
            occ_list.Append(f.wrapped)
        df.AddFacesToRemove(occ_list)
        df.Build()
        if not df.IsDone():
            return _fail("Defeaturing failed: could not restore parent solid.")
        defeatured_solid = bd.Solid(df.Shape())
    except Exception as e:
        return _fail(f"Defeaturing feature failed: {e}")

    # Rebuild feature with new parameters
    kind = target_feat.kind
    center = target_feat.center
    axis = target_feat.axis or [0.0, 0.0, 1.0]
    c_axis = bd.Vector(axis[0], axis[1], axis[2]).normalized()

    try:
        if kind == "hole":
            old_dia = float(next((p.value for p in target_feat.params if p.key == "diameter"), 6.0))
            old_depth = float(next((p.value for p in target_feat.params if p.key == "depth"), 10.0))
            new_dia = float(changes.get("diameter", old_dia))
            new_depth = float(changes.get("depth", old_depth))

            # Wall thickness safety check
            bb = shape.bounding_box()
            max_extent = max(bb.max.X - bb.min.X, bb.max.Y - bb.min.Y, bb.max.Z - bb.min.Z)
            if new_dia > max_extent * 0.95:
                return _fail(
                    f"Ø{new_dia:.1f} hole would break through the wall (max allowable: {max_extent*0.95:.1f} mm)."
                )

            # Build hole cutter
            if target_feat.subtype == "through":
                cutter_h = max_extent * 2.0
                cutter = bd.Cylinder(radius=new_dia / 2.0, height=cutter_h)
                plane = bd.Plane(origin=center, z_dir=c_axis)
                cutter = cutter.located(bd.Location(plane))
            elif target_feat.subtype == "counterbore":
                cb_dia = float(
                    changes.get(
                        "cbore_diameter",
                        next((p.value for p in target_feat.params if p.key == "cbore_diameter"), new_dia * 1.8),
                    )
                )
                cb_depth = float(
                    changes.get(
                        "cbore_depth",
                        next((p.value for p in target_feat.params if p.key == "cbore_depth"), 4.0),
                    )
                )
                plane = bd.Plane(origin=center, z_dir=c_axis)
                c_main = bd.Cylinder(radius=new_dia / 2.0, height=new_depth).located(
                    bd.Location(plane) * bd.Location((0, 0, -new_depth / 2.0))
                )
                c_cb = bd.Cylinder(radius=cb_dia / 2.0, height=cb_depth).located(
                    bd.Location(plane) * bd.Location((0, 0, -cb_depth / 2.0))
                )
                cutter = c_main + c_cb
            else:  # blind
                cutter_h = new_depth
                cutter = bd.Cylinder(radius=new_dia / 2.0, height=cutter_h)
                plane = bd.Plane(origin=center, z_dir=c_axis)
                cutter = cutter.located(bd.Location(plane) * bd.Location((0, 0, -cutter_h / 2.0)))

            new_shape = defeatured_solid - cutter

        elif kind == "boss":
            old_dia = float(next((p.value for p in target_feat.params if p.key == "diameter"), 20.0))
            old_h = float(next((p.value for p in target_feat.params if p.key == "height"), 8.0))
            new_dia = float(changes.get("diameter", old_dia))
            new_h = float(changes.get("height", old_h))

            plane = bd.Plane(origin=center, z_dir=c_axis)
            new_boss = bd.Cylinder(radius=new_dia / 2.0, height=new_h).located(
                bd.Location(plane) * bd.Location((0, 0, new_h / 2.0))
            )
            new_shape = defeatured_solid + new_boss

        elif kind == "fillet":
            old_r = float(next((p.value for p in target_feat.params if p.key == "radius"), 2.0))
            new_r = float(changes.get("radius", old_r))
            edges = defeatured_solid.edges()
            best_edge = min(edges, key=lambda e: (e.center() - bd.Vector(center)).length)
            new_shape = bd.fillet([best_edge], new_r)

        elif kind == "chamfer":
            old_d = float(next((p.value for p in target_feat.params if p.key == "distance"), 1.0))
            new_d = float(changes.get("distance", old_d))
            edges = defeatured_solid.edges()
            best_edge = min(edges, key=lambda e: (e.center() - bd.Vector(center)).length)
            new_shape = bd.chamfer([best_edge], new_d)

        elif kind in ("pocket", "slot"):
            old_w = float(next((p.value for p in target_feat.params if p.key == "width"), 20.0))
            old_l = float(next((p.value for p in target_feat.params if p.key == "length"), 30.0))
            old_d = float(next((p.value for p in target_feat.params if p.key == "depth"), 5.0))
            new_w = float(changes.get("width", old_w))
            new_l = float(changes.get("length", old_l))
            new_d = float(changes.get("depth", old_d))
            plane = bd.Plane(origin=center, z_dir=c_axis)
            if kind == "slot":
                with bd.BuildSketch(plane) as s:
                    bd.SlotOverall(max(new_w, new_l), min(new_w, new_l))
                cutter = bd.extrude(s.sketch, amount=-new_d)
            else:
                cutter = bd.Box(new_w, new_l, new_d).located(
                    bd.Location(plane) * bd.Location((0, 0, -new_d / 2.0))
                )
            new_shape = defeatured_solid - cutter

        elif kind == "pad":
            old_w = float(next((p.value for p in target_feat.params if p.key == "width"), 20.0))
            old_l = float(next((p.value for p in target_feat.params if p.key == "length"), 20.0))
            old_h = float(next((p.value for p in target_feat.params if p.key == "height"), 5.0))
            new_w = float(changes.get("width", old_w))
            new_l = float(changes.get("length", old_l))
            new_h = float(changes.get("height", old_h))
            plane = bd.Plane(origin=center, z_dir=c_axis)
            pad_box = bd.Box(new_w, new_l, new_h).located(
                bd.Location(plane) * bd.Location((0, 0, new_h / 2.0))
            )
            new_shape = defeatured_solid + pad_box

        else:
            return _fail(f"Direct parameter editing for '{kind}' is not supported yet.")

        # Validate
        report = BRepValidator.validate_shape(new_shape)
        if not report.is_valid or new_shape.volume < 1e-6:
            return _fail(f"Edit feature creates geometry failure: {report.error_message or 'Invalid topology'}")

        return _ok(new_shape, f"Feature '{target_feat.name}' updated successfully.")
    except Exception as e:
        return _fail(f"Edit feature rebuild failed: {e}")

