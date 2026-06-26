import uuid
import math
from typing import List, Dict, Any, Tuple
from app.models.schemas import MotionCommand, ToolpathSegmentType, Point3D

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
    end_idx = len(points) - 1

    for i in range(1, end_idx):
        d = point_line_distance(points[i], points[0], points[end_idx])
        if d > dmax:
            index = i
            dmax = d

    if dmax > epsilon:
        rec_results1 = _douglas_peucker(points[:index + 1], epsilon)
        rec_results2 = _douglas_peucker(points[index:], epsilon)
        return rec_results1[:-1] + rec_results2
    else:
        return [points[0], points[end_idx]]

class MotionPlanner:
    """
    Translates MachiningRegion boundaries into raw machine MotionCommands.
    This layer does NOT output ToolpathSegments directly, it only outputs 
    MotionCommands, keeping geometry calculation separated from toolpath rendering.
    """
    def __init__(self):
        pass

    def generate_commands(self, op: Dict[str, Any], machiningRegion: Dict[str, Any], tool: Dict[str, Any], setup: Dict[str, Any]) -> List[MotionCommand]:
        if not machiningRegion or not machiningRegion.get("valid"):
            op["status"] = "error"
            op.setdefault("parameters", {})["error"] = "Invalid machining region"
            return []

        op_type = op.get("type")
        tool_radius = (tool.get("diameter", 0.0) / 2.0) if tool else 1.0
        if tool_radius <= 0:
            tool_radius = 1.0

        commands: List[MotionCommand] = []

        safe_heights = op.get("safe_heights", {})
        clearance = safe_heights.get("clearance", 15.0)
        feed_z = safe_heights.get("feed", 2.0)
        top = safe_heights.get("top", 0.0)
        bottom = safe_heights.get("bottom", -10.0)

        if machiningRegion.get("topZ") is not None: top = machiningRegion["topZ"]
        if machiningRegion.get("bottomZ") is not None: bottom = machiningRegion["bottomZ"]

        op_source = "contour"
        if op_type == "drilling": op_source = "drill"
        elif op_type in ("2d_contour", "step"): op_source = "contour"
        elif op_type == "pocketing": op_source = "pocket"
        elif op_type == "boss_clearing": op_source = "boss"
        elif op_type == "facing": op_source = "face"

        def add_cmd(cmd_type: ToolpathSegmentType, start_pt: Point3D, end_pt: Point3D):
            commands.append(
                MotionCommand(
                    commandId=str(uuid.uuid4()),
                    commandType=cmd_type,
                    start=start_pt,
                    end=end_pt,
                    toolId=op.get("toolId", op.get("tool_id", "unknown_tool")),
                    operationId=op.get("id", "unknown_op"),
                    featureId=op.get("featureId", op.get("feature_id", "unknown_feat")),
                    setupId=op.get("setupId", op.get("setup_id", "setup_1")),
                    source=op_source
                )
            )

        if op_type == "drilling":
            self._generate_drilling_path(op, machiningRegion, clearance, feed_z, top, bottom, add_cmd)
        elif op_type in ("2d_contour", "step"):
            self._generate_contour_path(op, machiningRegion, tool_radius, clearance, feed_z, top, bottom, add_cmd)
        elif op_type == "boss_clearing":
            self._generate_boss_path(op, machiningRegion, tool_radius, clearance, feed_z, top, bottom, add_cmd)
        elif op_type == "pocketing":
            self._generate_pocket_path(op, machiningRegion, tool_radius, clearance, feed_z, top, bottom, add_cmd)
        elif op_type == "facing":
            self._generate_facing_path(op, machiningRegion, tool_radius, clearance, feed_z, top, bottom, add_cmd)
        else:
            raise NotImplementedError(f"Motion generation not implemented for {op_type}")

        return commands

    def _generate_drilling_path(self, op, machiningRegion, clearance, feed_z, top, bottom, add_cmd):
        center = machiningRegion.get("center")
        axis = machiningRegion.get("axis")
        
        if not center or not axis:
            raise ValueError("Drilling geometry missing center or axis")

        cx, cy, cz = center
        ax, ay, az = axis

        if az > 0:
            ax, ay, az = -ax, -ay, -az

        start_pt = Point3D(x=cx, y=cy, z=clearance)
        feed_pt = Point3D(x=cx, y=cy, z=feed_z)
        add_cmd(ToolpathSegmentType.RAPID, start_pt, feed_pt)

        def get_axis_pt(z_level):
            if abs(az) > 0.999 or abs(az) < 1e-6:
                return Point3D(x=cx, y=cy, z=z_level)
            t = (z_level - cz) / az
            return Point3D(x=cx + t * ax, y=cy + t * ay, z=z_level)

        cycle_type = op.get("parameters", {}).get("cycle_type", "G81")

        if cycle_type == "G83":
            peck_depth = 2.0
            curr_z = top
            while curr_z > bottom:
                next_z = max(bottom, curr_z - peck_depth)
                pt_curr = get_axis_pt(curr_z)
                pt_next = get_axis_pt(next_z)
                pt_feed = get_axis_pt(feed_z)

                add_cmd(ToolpathSegmentType.PLUNGE, pt_curr, pt_next)
                add_cmd(ToolpathSegmentType.RETRACT, pt_next, pt_feed)
                add_cmd(ToolpathSegmentType.RAPID, pt_feed, pt_next)
                
                curr_z = next_z
        else:
            pt_top = get_axis_pt(top)
            pt_bottom = get_axis_pt(bottom)
            if feed_z > top:
                add_cmd(ToolpathSegmentType.PLUNGE, feed_pt, pt_top)
            add_cmd(ToolpathSegmentType.PLUNGE, pt_top, pt_bottom)

        pt_bottom = get_axis_pt(bottom)
        retract_pt = Point3D(x=cx, y=cy, z=clearance)
        add_cmd(ToolpathSegmentType.RETRACT, pt_bottom, retract_pt)

    def _generate_contour_path(self, op, machiningRegion, tool_radius, clearance, feed_z, top, bottom, add_cmd):
        try:
            from shapely.geometry import Polygon, LineString
        except ImportError:
            raise RuntimeError("Shapely required for toolpath offset generation")

        raw_pts = machiningRegion.get("boundary")
        if not raw_pts or len(raw_pts) < 3:
            raise ValueError("Contour missing valid boundary")

        source = machiningRegion.get("source", "")
        if source in ("bbox", "silhouette", "fallback"):
            raise ValueError(f"Contour operation cannot use fallback source: {source}")

        pts_2d = [(p[0], p[1]) for p in raw_pts]
        poly = Polygon(pts_2d)
        if not poly.is_valid:
            poly = poly.buffer(0)

        # Single offset, no expanding XY loops
        current_poly = poly.buffer(tool_radius, join_style=2)
        if current_poly.is_empty:
            raise ValueError("Tool radius too large for contour")

        paths_2d = []
        if current_poly.geom_type == "Polygon":
            paths_2d.append(list(current_poly.exterior.coords))
        elif current_poly.geom_type == "MultiPolygon":
            for p in current_poly.geoms:
                paths_2d.append(list(p.exterior.coords))

        self._apply_z_stepdowns_to_paths(paths_2d, clearance, top, bottom, op, add_cmd)

    def _generate_pocket_path(self, op, machiningRegion, tool_radius, clearance, feed_z, top, bottom, add_cmd):
        try:
            from shapely.geometry import Polygon
        except ImportError:
            raise RuntimeError("Shapely required for toolpath offset generation")

        raw_pts = machiningRegion.get("boundary")
        if not raw_pts or len(raw_pts) < 3:
            raise ValueError("Pocket missing valid boundary")

        pts_2d = [(p[0], p[1]) for p in raw_pts]
        poly = Polygon(pts_2d)
        if not poly.is_valid:
            poly = poly.buffer(0)

        stepover = tool_radius * 1.5
        all_paths_2d = []

        current_poly = poly.buffer(-tool_radius, join_style=2)
        while not current_poly.is_empty:
            if current_poly.geom_type == "Polygon":
                all_paths_2d.append(list(current_poly.exterior.coords))
            elif current_poly.geom_type == "MultiPolygon":
                for p in current_poly.geoms:
                    all_paths_2d.append(list(p.exterior.coords))
            current_poly = current_poly.buffer(-stepover, join_style=2)
            
        all_paths_2d.reverse()
        self._apply_z_stepdowns_to_paths(all_paths_2d, clearance, top, bottom, op, add_cmd)

    def _generate_boss_path(self, op, machiningRegion, tool_radius, clearance, feed_z, top, bottom, add_cmd):
        """
        Uses raster/zigzag strategy instead of nested offsets to prevent segment explosion.
        """
        try:
            from shapely.geometry import Polygon, LineString
            import numpy as np
        except ImportError:
            raise RuntimeError("Shapely/Numpy required for toolpath generation")

        boss_pts = machiningRegion.get("islands", [[]])[0]
        containing_pts = machiningRegion.get("boundary")
        
        if not boss_pts or not containing_pts:
            raise ValueError("Boss geometry missing inner island or outer boundary")

        pts_ext = [(p[0], p[1]) for p in containing_pts]
        pts_int = [(p[0], p[1]) for p in boss_pts]
        poly = Polygon(pts_ext, [pts_int])
        if not poly.is_valid:
            poly = poly.buffer(0)

        # Buffer the boss out by tool radius, and bounding box in by tool radius
        safe_area = poly.buffer(-tool_radius, join_style=2)
        if safe_area.is_empty:
            return # Tool can't fit

        bounds = safe_area.bounds # minx, miny, maxx, maxy
        if not bounds:
            return
            
        minx, miny, maxx, maxy = bounds
        stepover = tool_radius * 1.5
        
        raster_lines = []
        y = miny + stepover / 2.0
        direction = 1
        
        while y < maxy:
            line = LineString([(minx - 10, y), (maxx + 10, y)])
            intersection = safe_area.intersection(line)
            
            segs = []
            if intersection.geom_type == "LineString":
                segs = [list(intersection.coords)]
            elif intersection.geom_type == "MultiLineString":
                segs = [list(ls.coords) for ls in intersection.geoms]
                
            for seg in segs:
                if len(seg) >= 2:
                    if direction == -1:
                        seg.reverse()
                    raster_lines.append(seg)
            
            y += stepover
            direction *= -1

        # Profile pass around the boss
        profile_area = Polygon(pts_int).buffer(tool_radius, join_style=2)
        if profile_area.geom_type == "Polygon":
            raster_lines.append(list(profile_area.exterior.coords))
            
        # Simplify geometry heavily for boss
        simplified_lines = []
        for line in raster_lines:
            simped = _douglas_peucker(line, 0.05)
            simplified_lines.append(simped)

        total_segs = sum(len(ln)-1 for ln in simplified_lines)
        if total_segs > 2000:
            raise ValueError(f"Boss segment budget exceeded (generated {total_segs}, limit 2000). Try a larger tool.")

        self._apply_z_stepdowns_to_paths(simplified_lines, clearance, top, bottom, op, add_cmd)

    def _generate_facing_path(self, op, machiningRegion, tool_radius, clearance, feed_z, top, bottom, add_cmd):
        try:
            from shapely.geometry import Polygon, LineString
        except ImportError:
            raise RuntimeError("Shapely required for toolpath generation")
            
        raw_pts = machiningRegion.get("boundary")
        if not raw_pts or len(raw_pts) < 3:
            raise ValueError("Face missing valid boundary")
            
        pts_2d = [(p[0], p[1]) for p in raw_pts]
        poly = Polygon(pts_2d)
        if not poly.is_valid:
            poly = poly.buffer(0)
            
        bounds = poly.bounds
        if not bounds:
            return
            
        minx, miny, maxx, maxy = bounds
        stepover = tool_radius * 1.5
        
        raster_lines = []
        y = miny
        direction = 1
        
        while y <= maxy + stepover:
            line = LineString([(minx - 10, y), (maxx + 10, y)])
            intersection = poly.intersection(line)
            
            segs = []
            if intersection.geom_type == "LineString":
                segs = [list(intersection.coords)]
            elif intersection.geom_type == "MultiLineString":
                segs = [list(ls.coords) for ls in intersection.geoms]
                
            for seg in segs:
                if len(seg) >= 2:
                    if direction == -1:
                        seg.reverse()
                    raster_lines.append(seg)
                    
            y += stepover
            direction *= -1

        self._apply_z_stepdowns_to_paths(raster_lines, clearance, top, bottom, op, add_cmd)

    def _apply_z_stepdowns_to_paths(self, paths_2d, clearance, top, bottom, op, add_cmd):
        if not paths_2d:
            return
            
        params = op.get("parameters", {})
        stepdown = params.get("maxStepdown", params.get("stepdown", 1.0))
        if stepdown <= 0:
            stepdown = 1.0

        total_depth = top - bottom
        passes = max(1, math.ceil(total_depth / stepdown))
        actual_step = total_depth / passes

        for i in range(passes):
            z = top - (i + 1) * actual_step
            
            for path in paths_2d:
                if not path or len(path) < 2:
                    continue

                start_pt_2d = path[0]
                pt_clearance = Point3D(x=start_pt_2d[0], y=start_pt_2d[1], z=clearance)
                pt_z = Point3D(x=start_pt_2d[0], y=start_pt_2d[1], z=z)

                add_cmd(ToolpathSegmentType.RAPID, pt_clearance, pt_z)

                for j in range(1, len(path)):
                    p1 = path[j-1]
                    p2 = path[j]
                    add_cmd(ToolpathSegmentType.FEED, Point3D(x=p1[0], y=p1[1], z=z), Point3D(x=p2[0], y=p2[1], z=z))

                end_pt_2d = path[-1]
                pt_end = Point3D(x=end_pt_2d[0], y=end_pt_2d[1], z=z)
                pt_retract = Point3D(x=end_pt_2d[0], y=end_pt_2d[1], z=clearance)
                add_cmd(ToolpathSegmentType.RETRACT, pt_end, pt_retract)
