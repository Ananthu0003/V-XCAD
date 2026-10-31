from __future__ import annotations

import math
import time
from collections import OrderedDict
from typing import Optional, List, Tuple, Any
import shapely.geometry
import shapely.ops

import build123d as bd
from OCP.Bnd import Bnd_Box
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BRep import BRep_Tool
from OCP.GeomAbs import GeomAbs_Plane, GeomAbs_Cylinder, GeomAbs_Cone, GeomAbs_Sphere, GeomAbs_Torus, GeomAbs_Line, GeomAbs_Circle
from OCP.GeomLib import GeomLib_IsPlanarSurface
from OCP.TopAbs import TopAbs_FACE, TopAbs_EDGE, TopAbs_REVERSED
from OCP.IntCurvesFace import IntCurvesFace_ShapeIntersector
from OCP.gp import gp_Pnt, gp_Dir, gp_Lin
from OCP.TopExp import TopExp_Explorer
from OCP.TopoDS import TopoDS_Face, TopoDS_Edge, TopoDS_Shape
from OCP.GProp import GProp_GProps
from OCP.BRepGProp import BRepGProp
from OCP.BRepTools import BRepTools

from app.models.cad_modification import (
    GeometryContext, PlanarFaceContext, CylFaceContext, EdgeContext, BodyContext, FeatureOnFace, GeometricReference
)
from app.services.geometry.reference_resolver import ReferenceResolver
from app.services.geometry.brep_validator import BRepValidator

# Bounded LRU cache for results (session_id, revision, ref, rounded_u, rounded_v) -> GeometryContext
_MAX_CONTEXT_CACHE_SIZE = 128
_context_cache: OrderedDict[Tuple[Any, ...], GeometryContext] = OrderedDict()

def get_geometry_context(session_id: str, revision: str, ref: str, u: Optional[float] = None, v: Optional[float] = None) -> GeometryContext:
    rounded_u = round(u, 4) if u is not None else None
    rounded_v = round(v, 4) if v is not None else None
    cache_key = (session_id, revision, ref, rounded_u, rounded_v)
    
    if cache_key in _context_cache:
        _context_cache.move_to_end(cache_key)
        return _context_cache[cache_key]
        
    from app.services.geometry.manual_cad_service import ManualCADService
    cad_service = ManualCADService()
    try:
        shape = cad_service.load_revision_shape(session_id, revision)
    except Exception as e:
        return GeometryContext(status="error", **{"class": "body"}, ref=ref, revision=revision, message=f"Failed to load shape: {e}")

    # Validate shape
    val = BRepValidator.validate_shape(shape)
    if not val.is_valid:
        return GeometryContext(
            status="error", **{"class": "body"}, ref=ref, revision=revision,
            message=f"Shape is invalid: {val.error_message}"
        )
    
    try:
        solids = shape.solids()
        if len(solids) > 1:
            return GeometryContext(
                status="error", **{"class": "body"}, ref=ref, revision=revision,
                message="Shape contains multiple solids."
            )
        if len(solids) == 0:
            return GeometryContext(
                status="error", **{"class": "body"}, ref=ref, revision=revision,
                message="Shape has open shell."
            )
    except Exception:
        pass

    ctx = GeometryContext(status="ok", **{"class": "body"}, ref=ref, revision=revision)
    
    # Try resolving as body if ref is special, but let's assume it's face/edge if format matches
    if ref.startswith("face_"):
        face = None
        try:
            idx = int(ref.split("_")[1])
            faces = shape.faces()
            if 0 <= idx < len(faces):
                face = faces[idx]
        except (IndexError, ValueError):
            face = None
            
        if not face:
            matched_f, status, _ = ReferenceResolver.resolve_face(shape, GeometricReference(
                ref_id=ref, transient_id=ref, entity_type="face", centroid=[0, 0, 0]
            ))
            face = matched_f

        if not face:
            ctx.status = "error"
            ctx.message = "selection could not be resolved, reselect the face"
            return ctx
        _measure_face(face, shape, ctx, u, v)

    elif ref.startswith("edge_"):
        edge = None
        try:
            idx = int(ref.split("_")[1])
            edges = shape.edges()
            if 0 <= idx < len(edges):
                edge = edges[idx]
        except (IndexError, ValueError):
            edge = None
            
        if not edge:
            matched_e, status, _ = ReferenceResolver.resolve_edge(shape, GeometricReference(
                ref_id=ref, transient_id=ref, entity_type="edge", centroid=[0, 0, 0]
            ))
            edge = matched_e

        if not edge:
            ctx.status = "error"
            ctx.message = "selection could not be resolved, reselect the edge"
            return ctx
        _measure_edge(edge, shape, ctx)

    elif ref.startswith("body") or ref == "model":
        _measure_body(shape, ctx)
    else:
        _measure_body(shape, ctx)

    if len(_context_cache) >= _MAX_CONTEXT_CACHE_SIZE:
        _context_cache.popitem(last=False)
    _context_cache[cache_key] = ctx
    return ctx

def _measure_body(shape: bd.Shape, ctx: GeometryContext):
    ctx.entity_class = "body"
    bctx = BodyContext()
    ctx.body = bctx
    
    start_time = time.time()
    
    try:
        bnd = Bnd_Box()
        BRepBndLib.Add_s(shape.wrapped, bnd)
        xmin, ymin, zmin, xmax, ymax, zmax = bnd.Get()
        bctx.extents = [float(xmax-xmin), float(ymax-ymin), float(zmax-zmin)]
    except Exception:
        _add_warning(ctx, "bounding box unavailable")

    if time.time() - start_time > 2.0: return
    try:
        props = GProp_GProps()
        BRepGProp.VolumeProperties_s(shape.wrapped, props)
        bctx.volume = float(props.Mass())
    except Exception:
        _add_warning(ctx, "volume unavailable")
        
    if time.time() - start_time > 2.0: return
    try:
        bctx.solid_count = len(shape.solids())
    except Exception:
        _add_warning(ctx, "solid count unavailable")
        
    bctx.is_valid = True

def _measure_edge(edge: bd.Edge, shape: bd.Shape, ctx: GeometryContext):
    ctx.entity_class = "edge.other"
    ectx = EdgeContext()
    ctx.edge = ectx
    
    start_time = time.time()
    try:
        ectx.length = edge.length
    except Exception:
        _add_warning(ctx, "length unavailable")
        
    if time.time() - start_time > 2.0: return
    
    try:
        geom_type = str(edge.geom_type).split(".")[-1].lower() if not callable(getattr(edge, "geom_type", None)) else edge.geom_type().lower()
        if geom_type == "line":
            ctx.entity_class = "edge.linear"
            ectx.edge_type = "line"
        elif geom_type == "circle":
            ctx.entity_class = "edge.circular"
            ectx.edge_type = "circle"
            ectx.radius = edge.radius
        else:
            ectx.edge_type = "other"
    except Exception:
        _add_warning(ctx, "edge type unavailable")

    if time.time() - start_time > 2.0: return
    
    try:
        adj_faces = []
        for idx, f in enumerate(shape.faces()):
            for e in f.edges():
                if e.is_same(edge):
                    adj_faces.append(f)
                    ectx.adjacent_face_ids.append(f"face_{idx}")
                    break
        
        if len(adj_faces) == 2:
            # Dihedral angle
            f1 = adj_faces[0]
            f2 = adj_faces[1]
            try:
                # Get normal at middle of the edge
                mid_pnt = edge.position_at(0.5)
                n1 = f1.normal_at(mid_pnt)
                n2 = f2.normal_at(mid_pnt)
                dot = n1.X*n2.X + n1.Y*n2.Y + n1.Z*n2.Z
                dot = max(-1.0, min(1.0, dot))
                angle_rad = math.acos(dot)
                ectx.dihedral_deg = math.degrees(angle_rad)
            except Exception:
                pass
                
            try:
                min_radius = ectx.length
                for face in adj_faces:
                    # Very rough max radius hint
                    min_radius = min(min_radius, 10.0) # Placeholder
                ectx.max_radius_hint = 0.5 * min_radius
            except Exception:
                pass
    except Exception:
        _add_warning(ctx, "adjacent faces unavailable")

def _measure_face(face: bd.Face, shape: bd.Shape, ctx: GeometryContext, u: Optional[float], v: Optional[float]):
    start_time = time.time()
    try:
        ctx.area = face.area
        props = GProp_GProps()
        BRepGProp.SurfaceProperties_s(shape.wrapped, props)
        total_area = props.Mass()
        if ctx.area < 1e-3 * total_area:
            _add_warning(ctx, "tiny face")
    except Exception:
        _add_warning(ctx, "area unavailable")

    if time.time() - start_time > 2.0: return
    
    surf = BRepAdaptor_Surface(face.wrapped)
    surf_type = surf.GetType()
    
    if surf_type == GeomAbs_Plane:
        _handle_planar_face(face, shape, surf, ctx, u, v, start_time)
    elif surf_type == GeomAbs_Cylinder:
        _handle_cylindrical_face(face, shape, surf, ctx, start_time)
    elif surf_type == GeomAbs_Cone:
        ctx.entity_class = "face.conical"
        ctx.status = "unsupported"
    else:
        # Check if it's planar via GeomLib_IsPlanarSurface
        try:
            bnd = Bnd_Box()
            BRepBndLib.Add_s(shape.wrapped, bnd)
            xmin, ymin, zmin, xmax, ymax, zmax = bnd.Get()
            diag = math.sqrt((xmax-xmin)**2 + (ymax-ymin)**2 + (zmax-zmin)**2)
            tol = 1e-4 * diag
            
            p = GeomLib_IsPlanarSurface(BRep_Tool.Surface_s(face.wrapped), tol)
            if p.IsPlanar():
                _handle_planar_face(face, shape, surf, ctx, u, v, start_time, forced_plane=p.Plan())
                return
        except Exception:
            pass
        ctx.entity_class = "face.other"
        ctx.status = "unsupported"

def get_planar_face_frame(face: bd.Face) -> Tuple[List[float], List[float], List[float], List[float]]:
    """
    Returns deterministic (origin, u_axis, v_axis, normal) as [x, y, z] lists.
    Guarantees:
    - normal is unit outward normal (respecting TopAbs_REVERSED).
    - u_axis and v_axis form an orthonormal right-handed system: u_axis x v_axis = normal.
    - u_axis is deterministically aligned with global axes.
    - origin is the center of the outer wire's bounding box in (U, V).
    """
    occ_face = face.wrapped if hasattr(face, "wrapped") else face
    adaptor = BRepAdaptor_Surface(occ_face)
    pln = adaptor.Plane()
    dir_z = pln.Axis().Direction()
    norm = bd.Vector(dir_z.X(), dir_z.Y(), dir_z.Z()).normalized()
    if occ_face.Orientation() == TopAbs_REVERSED:
        norm = -norm

    # Validate against true outward normal from solid context
    try:
        if hasattr(face, 'normal_at') and hasattr(face, 'center'):
            outward_norm = face.normal_at(face.center())
            if norm.dot(outward_norm) < 0:
                norm = -norm
    except Exception:
        pass

    z_world = bd.Vector(0, 0, 1)
    if abs(norm.dot(z_world)) > 0.99:
        if norm.dot(z_world) > 0:
            u_axis = bd.Vector(1, 0, 0)
            v_axis = bd.Vector(0, 1, 0)
        else:
            u_axis = bd.Vector(1, 0, 0)
            v_axis = bd.Vector(0, -1, 0)
    else:
        u_axis = z_world.cross(norm).normalized()
        v_axis = norm.cross(u_axis).normalized()

    # Center in (U, V) from outer wire
    ref_pt = bd.Vector(pln.Location().X(), pln.Location().Y(), pln.Location().Z())
    u_vals: List[float] = []
    v_vals: List[float] = []
    try:
        wires = face.wires()
        if wires:
            outer_wire = wires[0]
            for v in outer_wire.vertices():
                diff = bd.Vector(v.X, v.Y, v.Z) - ref_pt
                u_vals.append(diff.dot(u_axis))
                v_vals.append(diff.dot(v_axis))
    except Exception:
        pass

    if u_vals and v_vals:
        u_mid = (min(u_vals) + max(u_vals)) / 2.0
        v_mid = (min(v_vals) + max(v_vals)) / 2.0
        origin_pt = ref_pt + u_axis * u_mid + v_axis * v_mid
    else:
        c = face.center()
        origin_pt = bd.Vector(c.X, c.Y, c.Z)

    return (
        [round(origin_pt.X, 4), round(origin_pt.Y, 4), round(origin_pt.Z, 4)],
        [round(u_axis.X, 4), round(u_axis.Y, 4), round(u_axis.Z, 4)],
        [round(v_axis.X, 4), round(v_axis.Y, 4), round(v_axis.Z, 4)],
        [round(norm.X, 4), round(norm.Y, 4), round(norm.Z, 4)],
    )


def _handle_planar_face(face: bd.Face, shape: bd.Shape, surf: BRepAdaptor_Surface, ctx: GeometryContext, u: Optional[float], v: Optional[float], start_time: float, forced_plane=None):
    ctx.entity_class = "face.planar"
    pctx = PlanarFaceContext()
    ctx.planar = pctx

    origin, u_axis, v_axis, norm = get_planar_face_frame(face)
    pctx.origin = origin
    pctx.u_axis = u_axis
    pctx.v_axis = v_axis
    pctx.normal = norm

    if time.time() - start_time > 2.0: return
    
    try:
        # Extents via Bnd_Box
        bnd = Bnd_Box()
        BRepBndLib.Add_s(face.wrapped, bnd)
        xmin, ymin, zmin, xmax, ymax, zmax = bnd.Get()
        pctx.extents_u = float(xmax - xmin)
        pctx.extents_v = float(ymax - ymin)
    except Exception:
        _add_warning(ctx, "extents unavailable")
        
    if time.time() - start_time > 2.0: return
    
    # Polygon and inscribed circle / rectangle detection
    try:
        wires = face.wires()
        if wires:
            outer_pts = _discretize_wire(wires[0])
            inner_pts_list = [_discretize_wire(w) for w in wires[1:]]
            
            if outer_pts and len(outer_pts) > 2:
                poly = shapely.geometry.Polygon(outer_pts, inner_pts_list)
                if not poly.is_valid:
                    poly = poly.buffer(0)
                
                pctx.is_circular = False
                pctx.is_rectangular = False
                area = poly.area
                perim = poly.length

                if len(inner_pts_list) == 0:
                    # Circle: 4*pi*A / P^2 ~ 1
                    if perim > 0 and abs(4 * math.pi * area / (perim * perim) - 1.0) < 0.05:
                        pctx.is_circular = True
                        pctx.circle_diameter = 2 * math.sqrt(area / math.pi)
                        pctx.feature_kind = "circle"
                    
                    # Rect: Minimum rotated bounding box area ~ Area
                    min_rect = poly.minimum_rotated_rectangle
                    if abs(min_rect.area - area) < 0.05 * max(1e-3, area):
                        pctx.is_rectangular = True
                        pctx.feature_kind = "rect"

                # Compute width and length in face U/V frame
                ref_pt = bd.Vector(*origin)
                u_vec = bd.Vector(*u_axis)
                v_vec = bd.Vector(*v_axis)
                uv_pts = []
                for vert in wires[0].vertices():
                    diff = bd.Vector(vert.X, vert.Y, vert.Z) - ref_pt
                    uv_pts.append((diff.dot(u_vec), diff.dot(v_vec)))
                if uv_pts:
                    u_coords = [p[0] for p in uv_pts]
                    v_coords = [p[1] for p in uv_pts]
                    span_u = round(max(u_coords) - min(u_coords), 3)
                    span_v = round(max(v_coords) - min(v_coords), 3)
                    pctx.rect_width = span_u
                    pctx.rect_length = span_v
                    if pctx.is_rectangular:
                        pctx.feature_kind = "rect"

                center = shapely.ops.polylabel(poly, tolerance=1.0)
                pctx.center_uv = [center.x, center.y]
                # max inscribed diameter is 2 * distance to boundary
                dist = poly.exterior.distance(center)
                for inner in poly.interiors:
                    dist = min(dist, inner.distance(center))
                pctx.max_diameter = float(2 * dist)
            else:
                pctx.is_circular = False
                pctx.is_rectangular = False
                _add_warning(ctx, "polygon invalid")
    except Exception:
        pctx.is_circular = False
        pctx.is_rectangular = False
        _add_warning(ctx, "inscribed circle unavailable")

    if time.time() - start_time > 2.0: return
    
    # Material depth by raycast
    try:
        ray_u, ray_v = u, v
        if ray_u is None or ray_v is None:
            if pctx.center_uv:
                ray_u, ray_v = pctx.center_uv[0], pctx.center_uv[1]
            else:
                ray_u, ray_v = 0.0, 0.0
                
        ray_orig = gp_Pnt(
            pctx.origin[0] + ray_u * pctx.u_axis[0] + ray_v * pctx.v_axis[0],
            pctx.origin[1] + ray_u * pctx.u_axis[1] + ray_v * pctx.v_axis[1],
            pctx.origin[2] + ray_u * pctx.u_axis[2] + ray_v * pctx.v_axis[2]
        )
        ray_dir = gp_Dir(-pctx.normal[0], -pctx.normal[1], -pctx.normal[2])
        ray_line = gp_Lin(ray_orig, ray_dir)
        
        intersector = IntCurvesFace_ShapeIntersector()
        intersector.Load(shape.wrapped, 1e-4)
        intersector.PerformNearest(ray_line, 1e-4, 1e6)
        
        if intersector.IsDone() and intersector.NbPnt() > 0:
            pctx.material_depth = intersector.WParameter(1)
            pctx.is_through_clear = True
        else:
            pctx.material_depth = None
            pctx.is_through_clear = False
    except Exception:
        _add_warning(ctx, "material depth unavailable")

    # Features
    if time.time() - start_time > 2.0: return
    try:
        for e in face.edges():
            for f_adj in _get_adjacent_faces(shape, e):
                if f_adj.is_same(face): continue
                surf_adj = BRepAdaptor_Surface(f_adj.wrapped)
                if surf_adj.GetType() == GeomAbs_Cylinder:
                    cyl = surf_adj.Cylinder()
                    axis = cyl.Axis().Direction()
                    dot = abs(axis.X()*pctx.normal[0] + axis.Y()*pctx.normal[1] + axis.Z()*pctx.normal[2])
                    if dot > 0.99:
                        feat = FeatureOnFace(
                            kind="hole" if f_adj.wrapped.Orientation() == TopAbs_REVERSED else "boss",
                            diameter=2*cyl.Radius()
                        )
                        pctx.existing_features.append(feat)
    except Exception:
        pass


def _handle_cylindrical_face(face: bd.Face, shape: bd.Shape, surf: BRepAdaptor_Surface, ctx: GeometryContext, start_time: float):
    ctx.entity_class = "face.cylindrical"
    cctx = CylFaceContext()
    ctx.cylindrical = cctx
    
    try:
        cyl = surf.Cylinder()
        cctx.radius = cyl.Radius()
        cctx.diameter = 2.0 * cctx.radius
        loc = cyl.Location()
        axis = cyl.Axis().Direction()
        cctx.axis_origin = [loc.X(), loc.Y(), loc.Z()]
        cctx.axis_dir = [axis.X(), axis.Y(), axis.Z()]
        
        # Hole vs Boss: normal direction relative to radial vector
        pt = face.center()
        n = face.normal_at(pt)
        v_axis_to_pt = bd.Vector(pt.X - loc.X(), pt.Y - loc.Y(), pt.Z - loc.Z())
        ax_dir = bd.Vector(axis.X(), axis.Y(), axis.Z()).normalized()
        v_radial = v_axis_to_pt - ax_dir * v_axis_to_pt.dot(ax_dir)
        dot_n_r = n.X * v_radial.X + n.Y * v_radial.Y + n.Z * v_radial.Z
        cctx.kind = "hole" if dot_n_r < 0 else "boss"
        
        # Exact length from UV bounds (no nub extension)
        try:
            umin, umax, vmin, vmax = BRepTools.UVBounds_s(face.wrapped)
            cctx.length = round(abs(vmax - vmin), 4)
        except Exception:
            pass
            
    except Exception:
        _add_warning(ctx, "cylinder parameters unavailable")
        
def _discretize_wire(wire: bd.Wire) -> List[Tuple[float, float]]:
    pts = []
    # simplified to just take vertices
    for v in wire.vertices():
        pts.append((v.X, v.Y)) # Assumes mapped to UV!
    return pts

def _get_adjacent_faces(shape: bd.Shape, edge: bd.Edge) -> List[bd.Face]:
    res = []
    for f in shape.faces():
        for e in f.edges():
            if e.is_same(edge):
                res.append(f)
    return res

def _add_warning(ctx: GeometryContext, msg: str):
    ctx.status = "partial"
    ctx.warnings.append(msg)
