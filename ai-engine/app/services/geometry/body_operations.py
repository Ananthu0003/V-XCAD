"""Body-level editing operations for VEXCAD Manual CAD.

These are the tools a user needs *after* a model has been generated (the FreeCAD
Part / Draft / Mesh-workbench equivalents): move, rotate, scale, mirror, align to
build plate, add/cut primitives, shell, offset, split by plane, patterns and heal.

Every handler follows the same contract as the face/edge operations in
``manual_cad_service``:

    handler(shape, refs, params) -> (new_shape | None, status, message, created_faces, modified_edges)
"""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Set, Tuple

import build123d as bd

from OCP.BRepAlgoAPI import BRepAlgoAPI_Defeaturing
from OCP.TopTools import TopTools_ListOfShape

from app.models.cad_modification import GeometricReference, OperationStatus
from app.services.geometry.reference_resolver import ReferenceResolver
from app.services.geometry.brep_validator import BRepValidator
from app.services.geometry.feature_service import FeatureService

OpResult = Tuple[Optional[bd.Shape], OperationStatus, str, List[str], List[str]]

_AXES: Dict[str, bd.Axis] = {"x": bd.Axis.X, "y": bd.Axis.Y, "z": bd.Axis.Z}
_PLANES: Dict[str, bd.Plane] = {"xy": bd.Plane.XY, "yz": bd.Plane.YZ, "xz": bd.Plane.XZ}

# Hard caps keep a typo (count=100000) from exhausting the worker.
MAX_PATTERN_COUNT = 100
MAX_SCALE = 1000.0
MIN_SCALE = 1e-3


def _fail(msg: str, status: OperationStatus = OperationStatus.GEOMETRY_FAILURE) -> OpResult:
    return None, status, msg, [], []


def _ok(shape: Any, msg: str, created: Optional[List[str]] = None) -> OpResult:
    # Some build123d operators return a ShapeList; normalise to a single Shape.
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
                return edge.center()
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


class BodyOperationsMixin:
    """Mixed into ``ManualCADService``; adds whole-body editing handlers."""

    # ------------------------------------------------------------------ transform

    def _apply_transform(self, shape: bd.Shape, refs: List[GeometricReference], params: Dict[str, Any]) -> OpResult:
        """Unified Transform dispatcher supporting move, rotate, and scale."""
        mode = str(params.get("mode", "move")).lower()
        if mode == "move":
            return self._apply_move(shape, refs, params)
        elif mode == "rotate":
            return self._apply_rotate(shape, refs, params)
        elif mode == "scale":
            return self._apply_scale(shape, refs, params)
        else:
            return _fail(f"Unknown transform mode '{mode}'. Use move, rotate, or scale.")

    def _apply_move(self, shape: bd.Shape, refs: List[GeometricReference], params: Dict[str, Any]) -> OpResult:
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

    def _apply_rotate(self, shape: bd.Shape, refs: List[GeometricReference], params: Dict[str, Any]) -> OpResult:
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

    def _apply_scale(self, shape: bd.Shape, refs: List[GeometricReference], params: Dict[str, Any]) -> OpResult:
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

    def _apply_mirror(self, shape: bd.Shape, refs: List[GeometricReference], params: Dict[str, Any]) -> OpResult:
        plane, err = _plane_from(shape, refs, params)
        if plane is None:
            return _fail(err or "Mirror plane could not be resolved.", OperationStatus.INVALID_REFERENCE)
        mirrored = bd.mirror(shape, plane)
        if bool(params.get("keep_original", False)):
            return _ok(shape + mirrored, "Mirrored copy added (symmetric body).")
        return _ok(mirrored, "Body mirrored.")

    def _apply_align(self, shape: bd.Shape, refs: List[GeometricReference], params: Dict[str, Any]) -> OpResult:
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

    # ------------------------------------------------------------------ primitives

    def _apply_primitive(self, shape: bd.Shape, refs: List[GeometricReference], params: Dict[str, Any]) -> OpResult:
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

        # Position is the primitive's centre, relative to the world origin; "on_face" anchors
        # it to the selected planar face centre so users can drop features onto the part.
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

    # ------------------------------------------------------------------ solid shaping

    def _apply_shell(self, shape: bd.Shape, refs: List[GeometricReference], params: Dict[str, Any]) -> OpResult:
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
        return _ok(result, f"Shelled with {thickness:g} mm wall" + (f", {len(openings)} open face(s)." if openings else " (closed cavity)."))

    def _apply_offset(self, shape: bd.Shape, refs: List[GeometricReference], params: Dict[str, Any]) -> OpResult:
        amount = _f(params, "amount", 0.2)
        if amount == 0.0:
            return _fail("Offset amount is zero.")
        bb = shape.bounding_box()
        if amount < 0 and abs(amount) * 2 >= min(bb.size.X, bb.size.Y, bb.size.Z):
            return _fail("Negative offset is larger than half the thinnest dimension.")
        return _ok(bd.offset(shape, amount=amount), f"Body offset by {amount:+g} mm (tolerance/clearance).")

    def _apply_split(self, shape: bd.Shape, refs: List[GeometricReference], params: Dict[str, Any]) -> OpResult:
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

    # ------------------------------------------------------------------ patterns

    def _apply_linear_pattern(self, shape: bd.Shape, refs: List[GeometricReference], params: Dict[str, Any]) -> OpResult:
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

    def _apply_polar_pattern(self, shape: bd.Shape, refs: List[GeometricReference], params: Dict[str, Any]) -> OpResult:
        count = int(_f(params, "count", 4))
        if not (2 <= count <= MAX_PATTERN_COUNT):
            return _fail(f"Count must be between 2 and {MAX_PATTERN_COUNT}.")
        axis_key = str(params.get("axis", "z")).lower()
        if axis_key not in _AXES:
            return _fail(f"Unknown axis '{axis_key}'. Use X, Y or Z.")
        total = _f(params, "angle", 360.0)
        # A full circle must not duplicate the first instance at 360°.
        step = total / count if abs(total) >= 360.0 else total / (count - 1)
        axis = bd.Axis(origin=(_f(params, "cx", 0.0), _f(params, "cy", 0.0), _f(params, "cz", 0.0)),
                       direction=_AXES[axis_key].direction)
        result = shape
        for i in range(1, count):
            result = result + shape.rotate(axis, step * i)
        return _ok(result, f"Polar pattern ×{count} about {axis_key.upper()}.")

    # ------------------------------------------------------------------ repair

    def _apply_heal(self, shape: bd.Shape, refs: List[GeometricReference], params: Dict[str, Any]) -> OpResult:
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

    # ------------------------------------------------------------------ direct & feature operations

    def _apply_push_pull(
        self, shape: bd.Shape, refs: List[GeometricReference], params: Dict[str, Any]
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

    def _apply_round_face_edges(
        self, shape: bd.Shape, refs: List[GeometricReference], params: Dict[str, Any]
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

    def _apply_delete_feature(
        self, shape: bd.Shape, refs: List[GeometricReference], params: Dict[str, Any]
    ) -> OpResult:
        """Remove a detected feature or face using BRepAlgoAPI_Defeaturing with compound feature clustering."""
        shape_faces = list(shape.faces())
        faces_to_remove: List[bd.Face] = []
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

        # 3. Detect features on shape and correlate with target feature
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

        # Expand specified_fids with all faces belonging to matched features
        for feat in matched_features:
            for fid in feat.face_ids:
                specified_fids.add(fid)

        # 4. Resolve all specified_fids into bd.Face objects
        for fid in specified_fids:
            if fid.startswith("face_"):
                try:
                    idx = int(fid.replace("face_", ""))
                    if 0 <= idx < len(shape_faces):
                        f = shape_faces[idx]
                        if not any(f.is_same(existing) for existing in faces_to_remove):
                            faces_to_remove.append(f)
                except Exception:
                    pass

        for f in resolved_faces:
            if not any(f.is_same(existing) for existing in faces_to_remove):
                faces_to_remove.append(f)

        if not faces_to_remove:
            return _fail("No feature faces specified for deletion.", OperationStatus.INVALID_REFERENCE)

        # 5. Attempt BRepAlgoAPI_Defeaturing
        try:
            df = BRepAlgoAPI_Defeaturing()
            df.SetShape(shape.wrapped)
            occ_list = TopTools_ListOfShape()
            for f in faces_to_remove:
                occ_list.Append(f.wrapped)
            df.AddFacesToRemove(occ_list)
            df.Build()
            if df.IsDone():
                new_shape = bd.Solid(df.Shape())
                return _ok(new_shape, f"Feature deleted ({len(faces_to_remove)} face(s) removed).")
        except Exception:
            pass

        # 6. Fallback: If defeaturing failed and a cylindrical bore is present, attempt bore plugging
        for f in faces_to_remove:
            if f.geom_type == bd.GeomType.CYLINDER:
                try:
                    cyl_ref = ReferenceResolver.extract_face_reference(f, "face_cyl")
                    plug_res, plug_status, plug_msg, _, _ = self._apply_plug_hole(shape, [cyl_ref], params)
                    if plug_status == OperationStatus.VALID and plug_res is not None:
                        return _ok(plug_res, f"Feature bore plugged ({plug_msg}).")
                except Exception:
                    pass

        return _fail("Defeaturing failed: feature boundary could not be healed.")

    def _apply_edit_feature(
        self, shape: bd.Shape, refs: List[GeometricReference], params: Dict[str, Any]
    ) -> OpResult:
        """Parametric direct feature modification with defeaturing and rebuild."""
        changes = dict(params.get("changes", params))

        # Check for batch edits
        batch_ids = params.get("batch_feature_ids") or params.get("feature_ids")
        if batch_ids and isinstance(batch_ids, list):
            current_shape = shape
            for fid in batch_ids:
                sub_params = {**params, "feature_id": fid, "batch_feature_ids": None, "feature_ids": None}
                res_shape, status, msg, _, _ = self._apply_edit_feature(current_shape, [], sub_params)
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
                    return self._apply_legacy_cylinder_edit(shape, face, changes)
                elif face and face.geom_type == bd.GeomType.PLANE:
                    return self._apply_planar_dimension_edit(shape, face, changes, refs)
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
                    return _fail(f"Ø{new_dia:.1f} hole would break through the wall (max allowable: {max_extent*0.95:.1f} mm).")

                # Build hole cutter
                if target_feat.subtype == "through":
                    cutter_h = max_extent * 2.0
                    cutter = bd.Cylinder(radius=new_dia / 2.0, height=cutter_h)
                    plane = bd.Plane(origin=center, z_dir=c_axis)
                    cutter = cutter.located(bd.Location(plane))
                elif target_feat.subtype == "counterbore":
                    cb_dia = float(changes.get("cbore_diameter", next((p.value for p in target_feat.params if p.key == "cbore_diameter"), new_dia * 1.8)))
                    cb_depth = float(changes.get("cbore_depth", next((p.value for p in target_feat.params if p.key == "cbore_depth"), 4.0)))
                    plane = bd.Plane(origin=center, z_dir=c_axis)
                    c_main = bd.Cylinder(radius=new_dia / 2.0, height=new_depth).located(bd.Location(plane) * bd.Location((0, 0, -new_depth / 2.0)))
                    c_cb = bd.Cylinder(radius=cb_dia / 2.0, height=cb_depth).located(bd.Location(plane) * bd.Location((0, 0, -cb_depth / 2.0)))
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
                new_boss = bd.Cylinder(radius=new_dia / 2.0, height=new_h).located(bd.Location(plane) * bd.Location((0, 0, new_h / 2.0)))
                new_shape = defeatured_solid + new_boss

            elif kind == "fillet":
                old_r = float(next((p.value for p in target_feat.params if p.key == "radius"), 2.0))
                new_r = float(changes.get("radius", old_r))
                # Find edge closest to center
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
                    cutter = bd.Box(new_w, new_l, new_d).located(bd.Location(plane) * bd.Location((0, 0, -new_d / 2.0)))
                new_shape = defeatured_solid - cutter

            elif kind == "pad":
                old_w = float(next((p.value for p in target_feat.params if p.key == "width"), 20.0))
                old_l = float(next((p.value for p in target_feat.params if p.key == "length"), 20.0))
                old_h = float(next((p.value for p in target_feat.params if p.key == "height"), 5.0))
                new_w = float(changes.get("width", old_w))
                new_l = float(changes.get("length", old_l))
                new_h = float(changes.get("height", old_h))
                plane = bd.Plane(origin=center, z_dir=c_axis)
                pad_box = bd.Box(new_w, new_l, new_h).located(bd.Location(plane) * bd.Location((0, 0, new_h / 2.0)))
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

    def _apply_planar_dimension_edit(
        self, shape: bd.Shape, face: bd.Face, params: Dict[str, Any], refs: List[GeometricReference]
    ) -> OpResult:
        """Direct dimension / push-pull editing on a planar face."""
        dist = _f(params, "distance", 0.0)
        if dist == 0.0 and "depth" in params:
            dist = -_f(params, "depth", 0.0)
        elif dist == 0.0 and "height" in params:
            dist = _f(params, "height", 0.0)

        if dist != 0.0:
            return self._apply_push_pull(shape, refs, {"distance": dist})

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

    def _apply_legacy_cylinder_edit(self, shape: bd.Shape, face: bd.Face, params: Dict[str, Any]) -> OpResult:
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
        
        # Exact axial extent from UV bounds (no axis-aligned bbox or ±0.1mm nub)
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

    def _apply_move_feature(
        self, shape: bd.Shape, refs: List[GeometricReference], params: Dict[str, Any]
    ) -> OpResult:
        """Re-position a hole/boss/pocket within its face by dx/dy/dz."""
        dx, dy, dz = _f(params, "dx", 0.0), _f(params, "dy", 0.0), _f(params, "dz", 0.0)
        if dx == dy == dz == 0.0:
            return _fail("Move offset is zero.")

        # Re-use edit_feature defeaturing and shift the center
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
        del_res, status, msg, _, _ = self._apply_delete_feature(shape, [], {"face_ids": target_feat.face_ids})
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
                cutter = bd.Cylinder(radius=dia / 2.0, height=depth).located(bd.Location(plane) * bd.Location((0, 0, -depth / 2.0)))
            new_shape = del_res - cutter
            return _ok(new_shape, f"Feature moved by ({dx:+.1f}, {dy:+.1f}, {dz:+.1f}) mm.")

        return _fail(f"Move feature for kind '{target_feat.kind}' not implemented yet.")

    def _apply_pattern_feature(
        self, shape: bd.Shape, refs: List[GeometricReference], params: Dict[str, Any]
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

        pattern_type = str(params.get("pattern_type", "linear")).lower()
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
                    cutter = bd.Cylinder(radius=dia / 2.0, height=depth).located(bd.Location(plane) * bd.Location((0, 0, -depth / 2.0)))
                result = result - cutter

            return _ok(result, f"Feature patterned ×{count}.")

        return _fail(f"Pattern feature for kind '{target_feat.kind}' not implemented yet.")
