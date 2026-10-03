import os
import math
from typing import Dict, Any, List, Optional

try:
    import build123d as bd
    from OCP.BRep import BRep_Tool
    from OCP.BRepAdaptor import BRepAdaptor_Surface
    from OCP.GeomAbs import GeomAbs_Cylinder
    from OCP.TopAbs import TopAbs_REVERSED
    HAS_OCP = True
except ImportError:
    bd = None
    HAS_OCP = False


class BRepFeatureExtractor:
    """
    Parses a STEP file using build123d / OpenCascade to extract true topological
    coordinates for holes, cylindrical surfaces, planar pockets, and the solid's
    bounding box.

    Hole detection logic:
      - Filter faces by GeomType.CYLINDER.
      - A cylinder face whose surface normal points *inward* (TopAbs_REVERSED
        orientation on a solid) is an internal bore / hole.
      - A cylinder face whose normal points *outward* is part of the external
        profile (e.g. the outer diameter of the part, or scallop radii).
      - We de-duplicate holes that share the same (X, Y) center and radius
        (e.g. counterbore + through-bore at the same XY but different Z).
      - Each unique (X, Y, radius) group is reported once, with the full Z
        extent (min Z to max Z) so the toolpath engine knows the complete depth.
    
    Planar pocket detection:
      - Find horizontal planar faces (normal along Z) that sit below the top Z.
      - These represent pocket floors, slot bottoms, and counterbore ledges.
      - Each is reported with its center, bounding-box dimensions, and depth
        from the stock top.
    """

    def __init__(self, step_path: str):
        self.step_path = step_path
        self.solid = None
        self.holes: List[Dict[str, Any]] = []
        self.pockets: List[Dict[str, Any]] = []
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

            self._extract_holes()
            self._extract_planar_pockets()

            return {
                "status": "success",
                "bounds": self.bounds,
                "holes": self.holes,
                "pockets": self.pockets,
            }
        except Exception as e:
            import traceback
            traceback.print_exc()
            return {"status": "error", "message": str(e)}

    # ------------------------------------------------------------------
    # Hole extraction
    # ------------------------------------------------------------------

    def _extract_holes(self) -> None:
        """
        Walk every CYLINDER face of the solid.  Use face orientation to
        decide internal-vs-external, then group by (X, Y, radius).
        """
        cylinders = self.solid.faces().filter_by(bd.GeomType.CYLINDER)
        raw_internal: List[Dict[str, Any]] = []

        for face in cylinders:
            # Determine if the cylinder face is concave (internal hole) by
            # checking if the face orientation is REVERSED with respect to
            # the underlying surface.  On a solid, REVERSED means the
            # outward-pointing surface normal has been flipped → hole.
            is_internal = self._is_internal_cylinder(face)
            if not is_internal:
                continue

            center = face.center()
            fbb = face.bounding_box()
            raw_internal.append({
                "cx": center.X,
                "cy": center.Y,
                "radius": face.radius,
                "z_min": fbb.min.Z,
                "z_max": fbb.max.Z,
            })

        # Group by (cx, cy, radius) with a tolerance of 0.5 mm
        groups: List[Dict[str, Any]] = []
        for item in raw_internal:
            merged = False
            for g in groups:
                if (
                    abs(g["cx"] - item["cx"]) < 0.5
                    and abs(g["cy"] - item["cy"]) < 0.5
                    and abs(g["radius"] - item["radius"]) < 0.5
                ):
                    g["z_min"] = min(g["z_min"], item["z_min"])
                    g["z_max"] = max(g["z_max"], item["z_max"])
                    merged = True
                    break
            if not merged:
                groups.append(dict(item))

        # Also group holes that share the same (cx, cy) but have DIFFERENT
        # radii (e.g. counterbore + through-bore).  We keep them as separate
        # entries so the parametric extractor can match by diameter, but we
        # set a common "hole_group_xy" key so the engine knows they overlap.
        xy_groups: Dict[str, List[int]] = {}
        for idx, g in enumerate(groups):
            key = f"{g['cx']:.1f}_{g['cy']:.1f}"
            xy_groups.setdefault(key, []).append(idx)

        for key, indices in xy_groups.items():
            # Find the overall Z extent for this XY location
            overall_z_min = min(groups[i]["z_min"] for i in indices)
            overall_z_max = max(groups[i]["z_max"] for i in indices)
            for i in indices:
                g = groups[i]
                self.holes.append({
                    "type": "hole",
                    "center": [g["cx"], g["cy"], (g["z_min"] + g["z_max"]) / 2],
                    "radius": g["radius"],
                    "diameter": g["radius"] * 2,
                    "z_min": g["z_min"],
                    "z_max": g["z_max"],
                    "overall_z_min": overall_z_min,
                    "overall_z_max": overall_z_max,
                    "depth": abs(g["z_max"] - g["z_min"]),
                })

    # ------------------------------------------------------------------
    # Planar pocket / slot detection
    # ------------------------------------------------------------------

    def _extract_planar_pockets(self) -> None:
        """
        Find horizontal planar faces (normal along +Z or -Z) that sit below
        the top Z of the solid.  These represent pocket floors, slot bottoms,
        and counterbore ledges.

        A "pocket floor" is a planar face with:
          - Normal pointing in +Z (upward-facing floor) or -Z (downward-facing ceiling)
          - Z coordinate below the solid's top surface
          - Area significantly smaller than the full top face (not the stock top)
        
        Each pocket is reported with its center, bounding-box width/length, and
        depth measured from the solid's top Z.
        """
        if self.bounds is None:
            return
        
        top_z = self.bounds["max"][2]  # Top of the solid
        bottom_z = self.bounds["min"][2]  # Bottom of the solid
        top_area = self.bounds["width"] * self.bounds["length"]  # Approximate top face area
        
        planes = self.solid.faces().filter_by(bd.GeomType.PLANE)
        
        for face in planes:
            try:
                center = face.center()
                norm = face.normal_at(center)
                area = face.area
                fbb = face.bounding_box()
                
                # Only consider horizontal faces (normal along Z-axis)
                if abs(abs(norm.Z) - 1.0) > 0.01:
                    continue
                
                face_z = center.Z
                face_width = fbb.max.X - fbb.min.X
                face_length = fbb.max.Y - fbb.min.Y
                
                # Skip the top face itself and the bottom face
                if abs(face_z - top_z) < 0.1:
                    continue
                if abs(face_z - bottom_z) < 0.1:
                    continue
                
                # Skip faces that are nearly as large as the full top 
                # (these are typically the main top/bottom surfaces of the stock)
                if area > top_area * 0.9:
                    continue
                
                # Skip very tiny faces (e.g. fillet landings, chamfer faces)
                if area < 1.0:
                    continue
                
                # This is a pocket floor / slot bottom / counterbore ledge
                depth_from_top = abs(top_z - face_z)
                
                self.pockets.append({
                    "type": "pocket_floor",
                    "center": [center.X, center.Y, face_z],
                    "width": face_width,
                    "length": face_length,
                    "area": area,
                    "z": face_z,
                    "depth_from_top": depth_from_top,
                    "normal_z": norm.Z,
                    "bb_min": [fbb.min.X, fbb.min.Y],
                    "bb_max": [fbb.max.X, fbb.max.Y],
                })
            except Exception:
                continue

    def _is_internal_cylinder(self, face) -> bool:
        """
        Returns True if *face* is an internal (concave) cylinder — i.e. a hole,
        bore, or counterbore.  Returns False for external cylinders (OD, scallops).

        Strategy: sample the surface normal at the face center and compare it
        with the vector from the cylinder axis to the sample point.  If they
        point in opposite directions (dot product < 0) the face is internal.
        """
        try:
            center = face.center()
            norm = face.normal_at(center)

            # The cylinder axis passes through a point on the axis.
            # For a cylinder whose axis is along Z, the radial direction at
            # the center of the face is simply (center - axis_point) projected
            # onto XY.  We can approximate the axis point by the face center
            # projected onto the axis.
            # 
            # A simpler and more robust approach: the outward surface normal
            # of an *external* cylinder points *away* from the axis (same
            # direction as the radial vector), while for an *internal* cylinder
            # the face orientation is reversed so the normal points *toward*
            # the axis (opposite to the radial vector).
            #
            # We use the OCP face orientation when available.
            if HAS_OCP and hasattr(face, 'wrapped'):
                orientation = face.wrapped.Orientation()
                # TopAbs_REVERSED means the face normal is flipped relative to
                # the geometric surface normal → internal (hole).
                return orientation == TopAbs_REVERSED
            
            # Fallback: heuristic using normal direction
            # For a Z-axis cylinder at (ax, ay), the outward radial at the
            # sample point is (px - ax, py - ay, 0) normalized.  If the face
            # normal dot radial < 0, it's internal.
            # We approximate the axis center as the geometric center of the
            # bounding box in XY.
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


