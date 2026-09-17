import os
import math
from typing import Dict, Any, List, Optional, Tuple

try:
    import build123d as bd
    from OCP.BRep import BRep_Tool
    from OCP.BRepAdaptor import BRepAdaptor_Surface, BRepAdaptor_Curve
    from OCP.GeomAbs import GeomAbs_Cylinder, GeomAbs_Plane, GeomAbs_Circle
    from OCP.TopAbs import TopAbs_REVERSED
    HAS_OCP = True
except ImportError:
    bd = None
    HAS_OCP = False


def _sample_wire_3d(wire, num_pts_curve: int = 16) -> List[List[float]]:
    """Sample a build123d Wire into an ordered list of 3D [X, Y, Z] points."""
    pts: List[List[float]] = []
    for e in wire.edges():
        if e.geom_type == bd.GeomType.LINE:
            p0 = e.position_at(0)
            pts.append([round(float(p0.X), 4), round(float(p0.Y), 4), round(float(p0.Z), 4)])
        else:
            for i in range(num_pts_curve):
                t = i / float(num_pts_curve)
                p = e.position_at(t)
                pts.append([round(float(p.X), 4), round(float(p.Y), 4), round(float(p.Z), 4)])
    return pts


def _compute_face_basis(normal: List[float]) -> Tuple[List[float], List[float]]:
    """Given a 3D unit normal vector, compute two orthonormal tangent vectors (U, V)."""
    nx, ny, nz = normal
    mag = math.sqrt(nx * nx + ny * ny + nz * nz)
    if mag > 1e-6:
        nx, ny, nz = nx / mag, ny / mag, nz / mag

    if abs(nz) < 0.9:
        # Cross with [0, 0, 1]
        ux = -ny
        uy = nx
        uz = 0.0
    else:
        # Cross with [1, 0, 0]
        ux = 0.0
        uy = -nz
        uz = ny

    u_mag = math.sqrt(ux * ux + uy * uy + uz * uz)
    if u_mag > 1e-6:
        ux, uy, uz = ux / u_mag, uy / u_mag, uz / u_mag

    # V = N x U
    vx = ny * uz - nz * uy
    vy = nz * ux - nx * uz
    vz = nx * uy - ny * ux
    v_mag = math.sqrt(vx * vx + vy * vy + vz * vz)
    if v_mag > 1e-6:
        vx, vy, vz = vx / v_mag, vy / v_mag, vz / v_mag

    return [round(ux, 4), round(uy, 4), round(uz, 4)], [round(vx, 4), round(vy, 4), round(vz, 4)]


class BRepFeatureExtractor:
    """
    Parses a STEP file using build123d / OpenCascade to extract true topological
    coordinates for holes, cylindrical surfaces, complete planar face regions (with islands/inner wires),
    and the solid's bounding box and outer profile.
    """

    def __init__(self, step_path: str = ""):
        self.step_path = step_path
        self.solid = None
        self.holes: List[Dict[str, Any]] = []
        self.cylinders: List[Dict[str, Any]] = []
        self.pockets: List[Dict[str, Any]] = []
        self.planar_regions: List[Dict[str, Any]] = []
        self.silhouette: Optional[Dict[str, Any]] = None
        self.bounds: Optional[Dict[str, Any]] = None

    def analyze(self) -> Dict[str, Any]:
        if not bd or not os.path.exists(self.step_path):
            return {"status": "skipped", "reason": "No build123d or missing step file"}

        try:
            self.solid = bd.import_step(self.step_path)
            bb = self.solid.bounding_box()
            self.bounds = {
                "min": [bb.min.X, bb.min.Y, bb.min.Z],
                "max": [bb.max.X, bb.max.Y, bb.max.Z],
                "center": [
                    (bb.min.X + bb.max.X) / 2,
                    (bb.min.Y + bb.max.Y) / 2,
                    (bb.min.Z + bb.max.Z) / 2,
                ],
                "width": bb.max.X - bb.min.X,
                "length": bb.max.Y - bb.min.Y,
                "height": bb.max.Z - bb.min.Z,
            }

            self._extract_cylinders_and_holes()
            self._extract_planar_regions()
            self._extract_external_silhouette()

            return {
                "status": "success",
                "bounds": self.bounds,
                "holes": self.holes,
                "cylinders": self.cylinders,
                "pockets": self.pockets,
                "planar_regions": self.planar_regions,
                "silhouette": self.silhouette,
            }
        except Exception as e:
            import traceback
            traceback.print_exc()
            return {"status": "error", "message": str(e)}

    # ------------------------------------------------------------------
    # Cylinder & Hole extraction
    # ------------------------------------------------------------------

    def _extract_cylinders_and_holes(self) -> None:
        """
        Walk every CYLINDER face of the solid. Extract exact 3D axis location,
        direction, radius, height, through-hole status, and topological hole orientation (internal vs external).
        """
        cylinders = self.solid.faces().filter_by(bd.GeomType.CYLINDER)

        for idx, face in enumerate(cylinders):
            is_internal = self._is_internal_cylinder(face)
            center = face.center()
            fbb = face.bounding_box()

            axis_loc = [center.X, center.Y, center.Z]
            axis_dir = [0.0, 0.0, 1.0]

            if HAS_OCP:
                try:
                    surf = BRepAdaptor_Surface(face.wrapped)
                    if surf.GetType() == GeomAbs_Cylinder:
                        ocp_cyl = surf.Cylinder()
                        ax = ocp_cyl.Axis()
                        loc = ax.Location()
                        d = ax.Direction()
                        axis_loc = [round(loc.X(), 4), round(loc.Y(), 4), round(loc.Z(), 4)]
                        axis_dir = [round(d.X(), 4), round(d.Y(), 4), round(d.Z(), 4)]
                except Exception:
                    pass

            radius = face.radius
            dia = radius * 2.0
            
            # Universal 3D axial length along cylinder direction
            t_vals = [(v.X * axis_dir[0] + v.Y * axis_dir[1] + v.Z * axis_dir[2]) for v in face.vertices()]
            if t_vals:
                t_min = min(t_vals)
                t_max = max(t_vals)
                cyl_depth = round(abs(t_max - t_min), 4)
            else:
                cyl_depth = round(fbb.max.Z - fbb.min.Z, 4)

            # Topological through-hole classification:
            # Internal cylinder having circular boundary edges with distinct axial positions
            is_through = False
            if is_internal:
                circle_edges = [e for e in face.edges() if e.geom_type == bd.GeomType.CIRCLE]
                if len(circle_edges) >= 2:
                    edge_t = [(e.center().X * axis_dir[0] + e.center().Y * axis_dir[1] + e.center().Z * axis_dir[2]) for e in circle_edges]
                    if abs(max(edge_t) - min(edge_t)) > 0.5:
                        is_through = True

            mid_t = (t_min + t_max) / 2.0 if t_vals else center.Z
            ax_proj = axis_loc[0] * axis_dir[0] + axis_loc[1] * axis_dir[1] + axis_loc[2] * axis_dir[2]
            cyl_center = [
                round(axis_loc[0] + (mid_t - ax_proj) * axis_dir[0], 4),
                round(axis_loc[1] + (mid_t - ax_proj) * axis_dir[1], 4),
                round(axis_loc[2] + (mid_t - ax_proj) * axis_dir[2], 4)
            ]

            cyl_entry = {
                "face_id": idx,
                "type": "hole" if is_internal else "external_cylinder",
                "center": cyl_center,
                "axis_location": axis_loc,
                "axis": axis_dir,
                "radius": round(radius, 4),
                "diameter": round(dia, 4),
                "depth": round(cyl_depth, 4),
                "is_through": is_through,
                "bb_min": [fbb.min.X, fbb.min.Y, fbb.min.Z],
                "bb_max": [fbb.max.X, fbb.max.Y, fbb.max.Z],
                "is_internal": is_internal,
            }

            if is_internal:
                self.holes.append(cyl_entry)
            else:
                self.cylinders.append(cyl_entry)

    # ------------------------------------------------------------------
    # Planar face & pocket region detection
    # ------------------------------------------------------------------

    def _extract_planar_regions(self) -> None:
        """
        Extract all planar faces with their complete outer and inner wire loops,
        normal vectors, orthonormal basis, projected 2D (U, V) coordinates,
        and circular loop recognition.
        """
        if self.bounds is None:
            return

        top_z = self.bounds["max"][2]
        bottom_z = self.bounds["min"][2]
        top_area = self.bounds["width"] * self.bounds["length"]

        planes = self.solid.faces().filter_by(bd.GeomType.PLANE)

        for idx, face in enumerate(planes):
            try:
                center = face.center()
                norm = face.normal_at(center)
                area = face.area
                fbb = face.bounding_box()

                normal_vec = [round(norm.X, 4), round(norm.Y, 4), round(norm.Z, 4)]
                u_axis, v_axis = _compute_face_basis(normal_vec)

                # Plane classification
                if abs(norm.Z) > 0.8:
                    plane_type = "XY"
                elif abs(norm.Y) > 0.8:
                    plane_type = "XZ"
                elif abs(norm.X) > 0.8:
                    plane_type = "YZ"
                else:
                    plane_type = "INCLINED"

                # Check if outer wire is circular (single circle or closed circular arc)
                ow = face.outer_wire()
                ow_edges = ow.edges()
                is_circular = False
                circle_radius = None
                circle_center = None
                
                if len(ow_edges) == 1 and ow_edges[0].geom_type == bd.GeomType.CIRCLE:
                    is_circular = True
                    circle_radius = round(float(ow_edges[0].radius), 4)
                    if HAS_OCP:
                        try:
                            cadapt = BRepAdaptor_Curve(ow_edges[0].wrapped)
                            if cadapt.GetType() == GeomAbs_Circle:
                                cloc = cadapt.Circle().Location()
                                circle_center = [round(cloc.X(), 4), round(cloc.Y(), 4), round(cloc.Z(), 4)]
                        except Exception:
                            pass
                    if not circle_center:
                        circle_center = [round(center.X, 4), round(center.Y, 4), round(center.Z, 4)]

                # Sample outer wire and inner wires (islands/holes)
                outer_wire_3d = _sample_wire_3d(face.outer_wire())
                inner_wires_3d = [_sample_wire_3d(w) for w in face.inner_wires()]

                # Project 3D points onto face local (U, V) coordinates
                c_vec = circle_center if circle_center else [center.X, center.Y, center.Z]
                outer_wire_uv = []
                for pt in outer_wire_3d:
                    rel = [pt[0] - c_vec[0], pt[1] - c_vec[1], pt[2] - c_vec[2]]
                    u_val = rel[0] * u_axis[0] + rel[1] * u_axis[1] + rel[2] * u_axis[2]
                    v_val = rel[0] * v_axis[0] + rel[1] * v_axis[1] + rel[2] * v_axis[2]
                    outer_wire_uv.append([round(u_val, 4), round(v_val, 4)])

                inner_wires_uv = []
                for loop in inner_wires_3d:
                    loop_uv = []
                    for pt in loop:
                        rel = [pt[0] - c_vec[0], pt[1] - c_vec[1], pt[2] - c_vec[2]]
                        u_val = rel[0] * u_axis[0] + rel[1] * u_axis[1] + rel[2] * u_axis[2]
                        v_val = rel[0] * v_axis[0] + rel[1] * v_axis[1] + rel[2] * v_axis[2]
                        loop_uv.append([round(u_val, 4), round(v_val, 4)])
                    inner_wires_uv.append(loop_uv)

                face_width = fbb.max.X - fbb.min.X
                face_length = fbb.max.Y - fbb.min.Y
                face_z = center.Z
                depth_from_top = abs(top_z - face_z)

                # Directional depth along face normal from the corresponding outer bounding surface
                if norm.Z > 0.5:
                    depth_from_entry = abs(top_z - face_z)
                elif norm.Z < -0.5:
                    depth_from_entry = abs(face_z - bottom_z)
                elif norm.X > 0.5:
                    depth_from_entry = abs(bb.max.X - center.X)
                elif norm.X < -0.5:
                    depth_from_entry = abs(center.X - bb.min.X)
                elif norm.Y > 0.5:
                    depth_from_entry = abs(bb.max.Y - center.Y)
                elif norm.Y < -0.5:
                    depth_from_entry = abs(center.Y - bb.min.Y)
                else:
                    depth_from_entry = depth_from_top

                region_entry = {
                    "face_id": idx,
                    "plane_type": plane_type,
                    "center": [round(c_vec[0], 4), round(c_vec[1], 4), round(c_vec[2], 4)],
                    "normal": normal_vec,
                    "u_axis": u_axis,
                    "v_axis": v_axis,
                    "is_circular": is_circular,
                    "circle_radius": circle_radius,
                    "diameter": round(circle_radius * 2.0, 4) if circle_radius else None,
                    "outer_wire_3d": outer_wire_3d,
                    "inner_wires_3d": inner_wires_3d,
                    "outer_wire_uv": outer_wire_uv,
                    "inner_wires_uv": inner_wires_uv,
                    "area": round(area, 4),
                    "width": round(face_width, 4),
                    "length": round(face_length, 4),
                    "z": round(face_z, 4),
                    "depth_from_top": round(depth_from_top, 4),
                    "depth_from_entry": round(depth_from_entry, 4),
                    "bb_min": [fbb.min.X, fbb.min.Y, fbb.min.Z],
                    "bb_max": [fbb.max.X, fbb.max.Y, fbb.max.Z],
                }

                self.planar_regions.append(region_entry)

                # If sitting below top_z/bottom_z or representing an internal pocket floor
                is_internal_z = (abs(face_z - top_z) >= 0.1 and abs(face_z - bottom_z) >= 0.1)
                is_side_pocket = plane_type in ("XZ", "YZ") and area < max(face_width, face_length) * max(face_width, face_length) * 0.95
                if (is_internal_z or is_side_pocket) and area >= 1.0:
                    pocket_entry = dict(region_entry)
                    pocket_entry["type"] = "pocket_floor"
                    pocket_entry["normal_z"] = norm.Z
                    self.pockets.append(pocket_entry)

            except Exception:
                continue

    def _extract_external_silhouette(self) -> None:
        """
        Extract the 2D projected exterior silhouette boundary of the solid
        along primary axes (XY, XZ, YZ) using unary_union of planar face outer wires.
        """
        if not self.solid:
            return
        
        try:
            from shapely.geometry import Polygon
            from shapely.ops import unary_union
            
            # For XY projection (tool along Z):
            planes_z = [f for f in self.solid.faces().filter_by(bd.GeomType.PLANE) if abs(f.normal_at(f.center()).Z) > 0.7]
            polys = []
            for f in planes_z:
                pts = _sample_wire_3d(f.outer_wire())
                if len(pts) >= 3:
                    p2d = [(round(p[0], 4), round(p[1], 4)) for p in pts]
                    poly = Polygon(p2d)
                    if poly.is_valid and poly.area > 1.0:
                        polys.append(poly)
                        
            if polys:
                u_poly = unary_union(polys)
                if u_poly.is_valid and not u_poly.is_empty:
                    ext_coords_2d = [[round(c[0], 4), round(c[1], 4)] for c in list(u_poly.exterior.coords)]
                    ext_coords_3d = [[round(c[0], 4), round(c[1], 4), round(self.bounds["min"][2], 4)] for c in list(u_poly.exterior.coords)]
                    self.silhouette = {
                        "plane": "XY",
                        "polygon_2d": ext_coords_2d,
                        "wire_3d": ext_coords_3d
                    }
        except Exception:
            pass

    def _is_internal_cylinder(self, face) -> bool:
        """
        Returns True if *face* is an internal (concave) cylinder (hole/bore).
        Returns False for external cylinders (OD/boss).
        """
        try:
            if HAS_OCP and hasattr(face, 'wrapped'):
                orientation = face.wrapped.Orientation()
                return orientation == TopAbs_REVERSED

            center = face.center()
            norm = face.normal_at(center)
            fbb = face.bounding_box()
            ax = (fbb.min.X + fbb.max.X) / 2
            ay = (fbb.min.Y + fbb.max.Y) / 2
            radial_x = center.X - ax
            radial_y = center.Y - ay
            radial_len = math.sqrt(radial_x**2 + radial_y**2)
            if radial_len < 1e-6:
                return False
            radial_x /= radial_len
            radial_y /= radial_len
            dot = norm.X * radial_x + norm.Y * radial_y
            return dot < 0
        except Exception:
            return False
