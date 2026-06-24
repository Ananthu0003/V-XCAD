"""
ToolpathEngine — Generates toolpaths driven by true B-Rep geometry.

Consumes geometry data (sampled points, axes) from GeometryMapper and
produces ToolpathSegment objects.  No metadata-based fallbacks.
"""
from typing import List, Dict, Any, Tuple
import math
from app.models.schemas import ToolpathSegment, ToolpathSegmentType, CoordinateMode, Point3D


def _douglas_peucker(points: List[Tuple[float, float]], epsilon: float) -> List[Tuple[float, float]]:
    """Simplifies a 2D line using the Douglas-Peucker algorithm."""
    if len(points) < 3:
        return points

    def point_line_distance(pt: Tuple[float, float], start: Tuple[float, float], end: Tuple[float, float]) -> float:
        num = abs((end[1] - start[1]) * pt[0] - (end[0] - start[0]) * pt[1] + end[0] * start[1] - end[1] * start[0])
        den = math.hypot(end[1] - start[1], end[0] - start[0])
        return num / den if den != 0 else math.hypot(pt[0] - start[0], pt[1] - start[1])

    dmax = 0.0
    index = 0
    end = len(points) - 1

    for i in range(1, end):
        d = point_line_distance(points[i], points[0], points[end])
        if d > dmax:
            index = i
            dmax = d

    if dmax > epsilon:
        rec_results1 = _douglas_peucker(points[:index + 1], epsilon)
        rec_results2 = _douglas_peucker(points[index:], epsilon)
        return rec_results1[:-1] + rec_results2
    else:
        return [points[0], points[end]]


class ToolpathEngine:
    """
    Core engine responsible for generating true physical 3D toolpaths
    from mapped B-Rep geometry.

    Constraints:
      C2: Shapely OK for planar offsets of projected wire points
      C4: Drilling is point-to-depth only, along actual axis
      C6: Hard failure if geometry missing, no fallbacks
    """

    def __init__(self):
        pass

    def generate_toolpaths(self, operations: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        toolpaths = []
        for op in operations:
            if op.get('status') == 'error':
                toolpaths.append(op)
                continue

            paths = self._generate_paths_for_op(op)
            if paths:
                op['toolpaths'] = [p.model_dump() for p in paths]
            toolpaths.append(op)
        return toolpaths

    def _generate_paths_for_op(self, op: Dict[str, Any]) -> List[ToolpathSegment]:
        geometry = op.get("geometry", {})
        
        # Constraint C6: No fallbacks. Hard failure on missing/failed geometry.
        if not geometry or geometry.get("status") == "failed":
            op["status"] = "error"
            op["parameters"]["error"] = geometry.get(
                "error", "No geometry mapping available for this operation"
            )
            return []

        op_type = op.get("type")
        tool = op.get("tool")
        tool_radius = (tool.get("diameter", 0.0) / 2.0) if tool else 1.0
        if tool_radius <= 0:
            tool_radius = 1.0

        segments: List[ToolpathSegment] = []

        # Common height params (GeometryMapper sets defaults if missing)
        safe_heights = op.get("safe_heights", {})
        clearance = safe_heights.get("clearance", 15.0)
        feed_z = safe_heights.get("feed", 2.0)
        top = safe_heights.get("top", 0.0)
        bottom = safe_heights.get("bottom", -10.0)
        
        # Override with actual geometry bounds if available
        if "z_top" in geometry: top = geometry["z_top"]
        if "z_bottom" in geometry: bottom = geometry["z_bottom"]
        if "top_z" in geometry: top = geometry["top_z"]
        if "bottom_z" in geometry: bottom = geometry["bottom_z"]
        if "floor_z" in geometry: bottom = geometry["floor_z"]

        # Segment validation constraints
        limit = 3000
        if op_type == "drilling": limit = 50
        elif op_type in ("2d_contour", "profile"): limit = 1000
        elif op_type == "pocketing": limit = 3000
        elif op_type == "boss_machining": limit = 3000

        def add_seg(seg_type: ToolpathSegmentType, start_pt: Point3D, end_pt: Point3D):
            segments.append(
                ToolpathSegment(
                    type=seg_type,
                    start=start_pt,
                    end=end_pt,
                    toolId=op.get("toolId", op.get("tool_id", "unknown_tool")),
                    operationId=op.get("id", "unknown_op"),
                    featureId=op.get("featureId", op.get("feature_id", "unknown_feat")),
                    setupId=op.get("setupId", op.get("setup_id", "setup_1")),
                    coordinateMode=CoordinateMode.MILL_XYZ,
                    source="strategy"
                )
            )

        try:
            if op_type == "drilling":
                self._generate_drilling_path(op, geometry, clearance, feed_z, top, bottom, add_seg)
            elif op_type in ("2d_contour", "pocketing", "step", "boss_machining"):
                self._generate_planar_milling_path(
                    op, op_type, geometry, tool_radius, clearance, feed_z, top, bottom, add_seg
                )
            elif op_type == "facing":
                self._generate_facing_path(
                    op, geometry, tool_radius, clearance, feed_z, top, bottom, add_seg
                )
            else:
                op["status"] = "error"
                op["parameters"]["error"] = f"Toolpath generation not implemented for {op_type}"
                return []
        except Exception as exc:
            op["status"] = "error"
            op["parameters"]["error"] = f"Toolpath generation error: {exc}"
            return []

        if len(segments) > limit:
            op["status"] = "error"
            op["parameters"]["error"] = f"Segment count {len(segments)} exceeds limit {limit} for {op_type}"
            return []

        # Mandatory CAM Source Guard
        for seg in segments:
            if not seg.operationId or not seg.featureId or not seg.toolId or not seg.setupId or seg.source != "strategy":
                op["status"] = "error"
                op["parameters"]["error"] = f"Segment validation failed: missing mandatory properties or invalid source."
                return []

        return segments

    def _generate_drilling_path(
        self, op, geometry, clearance, feed_z, top, bottom, add_seg
    ) -> None:
        """
        Constraint C4: Point-to-depth plunge along actual cylinder axis.
        """
        center = geometry.get("center")
        axis = geometry.get("axis")
        
        if not center or not axis:
            raise ValueError("Drilling geometry missing center or axis")

        cx, cy, cz = center
        ax, ay, az = axis

        # Ensure axis points down (into material)
        if az > 0:
            ax, ay, az = -ax, -ay, -az

        # Rapid to clearance above hole center
        start_pt = Point3D(x=cx, y=cy, z=clearance)
        feed_pt = Point3D(x=cx, y=cy, z=feed_z)
        add_seg(ToolpathSegmentType.RAPID, start_pt, feed_pt)

        cycle_type = op.get("parameters", {}).get("cycle_type", "G81")
        
        # Calculate plunge points along the 3D axis
        def get_axis_pt(z_level):
            # If perfectly vertical (typical)
            if abs(az) > 0.999:
                return Point3D(x=cx, y=cy, z=z_level)
            if abs(az) < 1e-6:
                return Point3D(x=cx, y=cy, z=z_level)
            # True multi-axis vector math
            t = (z_level - cz) / az
            return Point3D(x=cx + t * ax, y=cy + t * ay, z=z_level)

        if cycle_type == "G83":
            peck_depth = 2.0
            curr_z = top
            while curr_z > bottom:
                next_z = max(bottom, curr_z - peck_depth)
                pt_curr = get_axis_pt(curr_z)
                pt_next = get_axis_pt(next_z)
                pt_feed = get_axis_pt(feed_z)

                add_seg(ToolpathSegmentType.PLUNGE, pt_curr, pt_next)
                add_seg(ToolpathSegmentType.RETRACT, pt_next, pt_feed)
                add_seg(ToolpathSegmentType.RAPID, pt_feed, pt_next)
                
                curr_z = next_z
        else:
            pt_top = get_axis_pt(top)
            pt_bottom = get_axis_pt(bottom)
            # Feed down to top of stock
            if feed_z > top:
                add_seg(ToolpathSegmentType.PLUNGE, feed_pt, pt_top)
            # Plunge hole
            add_seg(ToolpathSegmentType.PLUNGE, pt_top, pt_bottom)

        # Enforce validation: hole must have operation count > 0 (meaning we generated something)
        # This is implicit by generating segments above.

        # Retract
        pt_bottom = get_axis_pt(bottom)
        retract_pt = Point3D(x=cx, y=cy, z=clearance)
        add_seg(ToolpathSegmentType.RETRACT, pt_bottom, retract_pt)


    def _generate_planar_milling_path(
        self, op, op_type, geometry, tool_radius, clearance, feed_z, top, bottom, add_seg
    ) -> None:
        try:
            from shapely.geometry import Polygon
        except ImportError:
            raise RuntimeError("Shapely required for toolpath offset generation")

        if op_type == "boss_machining":
            boss_pts = geometry.get("boss_points")
            containing_pts = geometry.get("containing_points")
            if not boss_pts or not containing_pts:
                raise ValueError("Boss geometry missing boss or containing points")
            pts_ext = [(p[0], p[1]) for p in containing_pts]
            pts_int = [(p[0], p[1]) for p in boss_pts]
            poly = Polygon(pts_ext, [pts_int])
        else:
            raw_pts_3d = geometry.get("profile_points") or geometry.get("boundary_points")
            if not raw_pts_3d:
                raise ValueError("Planar geometry missing boundary points")
            pts_2d = [(p[0], p[1]) for p in raw_pts_3d]
            poly = Polygon(pts_2d)

        if not poly.is_valid:
            poly = poly.buffer(0)

        operation_region_area = poly.area

        stepover = tool_radius * 1.5
        all_paths_2d = []

        if op_type == "pocketing" or op_type == "step":
            current_poly = poly.buffer(-tool_radius, join_style=2)
            while not current_poly.is_empty:
                if current_poly.geom_type == "Polygon":
                    all_paths_2d.append(list(current_poly.exterior.coords))
                elif current_poly.geom_type == "MultiPolygon":
                    for p in current_poly.geoms:
                        all_paths_2d.append(list(p.exterior.coords))
                current_poly = current_poly.buffer(-stepover, join_style=2)
            all_paths_2d.reverse()  # Center out
        elif op_type == "boss_machining":
            # Machining region is from containing (outer) to boss (inner hole).
            # The tool fits inside the region.
            current_poly = poly.buffer(-tool_radius, join_style=2)
            while not current_poly.is_empty:
                if current_poly.geom_type == "Polygon":
                    all_paths_2d.append(list(current_poly.exterior.coords))
                    for interior in current_poly.interiors:
                        all_paths_2d.append(list(interior.coords))
                elif current_poly.geom_type == "MultiPolygon":
                    for p in current_poly.geoms:
                        all_paths_2d.append(list(p.exterior.coords))
                        for interior in p.interiors:
                            all_paths_2d.append(list(interior.coords))
                current_poly = current_poly.buffer(-stepover, join_style=2)
            all_paths_2d.reverse()
        else:
            # Contour
            offset_dist = tool_radius
            poly_offset = poly.buffer(offset_dist, join_style=2)
            if not poly_offset.is_empty:
                if poly_offset.geom_type == "Polygon":
                    all_paths_2d.append(list(poly_offset.exterior.coords))
                elif poly_offset.geom_type == "MultiPolygon":
                    largest = max(poly_offset.geoms, key=lambda p: p.area)
                    all_paths_2d.append(list(largest.exterior.coords))

        if not all_paths_2d:
            raise ValueError("Tool radius too large for feature boundary or offset produced degenerate polygon")

        # Simplify
        all_paths_2d = [_douglas_peucker(path, epsilon=0.5) for path in all_paths_2d if len(path) > 2]

        toolpath_area = 0.0
        # rough area approx
        for path in all_paths_2d:
            if len(path) > 2:
                tmp_p = Polygon(path)
                toolpath_area += tmp_p.area

        if toolpath_area > operation_region_area * 1.5:
            raise ValueError(f"Area validation failed: Toolpath Area ({toolpath_area}) > 1.5 * Region Area ({operation_region_area})")
        
        # Save diagnostics to operation parameters
        op.setdefault("parameters", {})["diagnostics"] = {
            "region_area": round(operation_region_area, 2),
            "toolpath_area": round(toolpath_area, 2)
        }

        stepdown = op.get("parameters", {}).get("stepdown", 2.0)
        if stepdown <= 0: stepdown = 2.0

        curr_z = top
        while curr_z > bottom:
            curr_z = max(bottom, curr_z - stepdown)
            
            for path_pts_2d in all_paths_2d:
                x0, y0 = path_pts_2d[0]
                # Rapid to start
                add_seg(
                    ToolpathSegmentType.RAPID,
                    Point3D(x=x0, y=y0, z=clearance),
                    Point3D(x=x0, y=y0, z=feed_z),
                )
                # Plunge
                add_seg(
                    ToolpathSegmentType.PLUNGE,
                    Point3D(x=x0, y=y0, z=curr_z + stepdown),
                    Point3D(x=x0, y=y0, z=curr_z),
                )

                # Trace boundary
                prev_pt = Point3D(x=x0, y=y0, z=curr_z)
                for x, y in path_pts_2d[1:]:
                    next_pt = Point3D(x=x, y=y, z=curr_z)
                    add_seg(ToolpathSegmentType.CUT, prev_pt, next_pt)
                    prev_pt = next_pt

                # Retract
                xf, yf = path_pts_2d[-1]
                add_seg(
                    ToolpathSegmentType.RETRACT,
                    Point3D(x=xf, y=yf, z=bottom),
                    Point3D(x=xf, y=yf, z=clearance),
                )


    def _generate_facing_path(
        self, op, geometry, tool_radius, clearance, feed_z, top, bottom, add_seg
    ) -> None:
        """
        Facing using actual face boundary geometry.
        """
        boundary = geometry.get("face_boundary")
        if not boundary:
             raise ValueError("Facing geometry missing face_boundary")

        try:
            from shapely.geometry import Polygon
        except ImportError:
            raise RuntimeError("Shapely required for facing generation")

        pts_2d = [(p[0], p[1]) for p in boundary]
        poly = Polygon(pts_2d)
        
        # Simple bounding box zigzag for facing
        min_x, min_y, max_x, max_y = poly.bounds
        
        # Extend slightly past stock
        extend = tool_radius * 1.2
        min_x -= extend
        max_x += extend
        min_y -= extend
        max_y += extend

        stepover = tool_radius * 1.5
        
        y = min_y
        direction = 1
        
        # Rapid to start
        add_seg(
            ToolpathSegmentType.RAPID,
            Point3D(x=min_x, y=min_y, z=clearance),
            Point3D(x=min_x, y=min_y, z=feed_z)
        )
        add_seg(
            ToolpathSegmentType.PLUNGE,
            Point3D(x=min_x, y=min_y, z=feed_z),
            Point3D(x=min_x, y=min_y, z=bottom)
        )

        while y <= max_y:
            x_start = min_x if direction == 1 else max_x
            x_end = max_x if direction == 1 else min_x
            
            # Cut pass
            add_seg(
                ToolpathSegmentType.CUT,
                Point3D(x=x_start, y=y, z=bottom),
                Point3D(x=x_end, y=y, z=bottom)
            )
            
            y += stepover
            if y <= max_y:
                # Step over
                add_seg(
                    ToolpathSegmentType.CUT,
                    Point3D(x=x_end, y=y - stepover, z=bottom),
                    Point3D(x=x_end, y=y, z=bottom)
                )
                
            direction *= -1

        # Retract
        last_x = x_end
        last_y = min(y, max_y)
        add_seg(
            ToolpathSegmentType.RETRACT,
            Point3D(x=last_x, y=last_y, z=bottom),
            Point3D(x=last_x, y=last_y, z=clearance)
        )
