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
        retract_z = safe_heights.get("retract", clearance)

        if machiningRegion.get("topZ") is not None: top = machiningRegion["topZ"]
        if machiningRegion.get("bottomZ") is not None: bottom = machiningRegion["bottomZ"]

        # Override with setup-local coordinates if available
        local_feat = op.get("parameters", {}).get("setup_local_feature")
        if local_feat:
            top = local_feat.get("localTopZ", top)
            bottom = local_feat.get("localBottomZ", bottom)
            clearance = top + 15.0
            retract_z = top + 5.0
            feed_z = top + 2.0
            # Update safe_heights so downstream functions (like _generate_drilling_path) use them
            op["safe_heights"] = {
                "clearance": clearance,
                "retract": retract_z,
                "feed": feed_z,
                "top": top,
                "bottom": bottom
            }

        op_source = "contour"
        if op_type == "drilling": op_source = "drill"
        elif op_type in ("2d_contour", "2d_contour_outer", "step"): op_source = "contour"
        elif op_type == "pocketing": op_source = "pocket"
        elif op_type == "boss_clearing": op_source = "boss"
        elif op_type == "facing": op_source = "face"
        elif op_type in ("od_turning", "turning"): op_source = "turning"
        elif op_type in ("indexed_4axis_milling", "rotary_milling", "multi_axis_surface_milling"): op_source = "contour"

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
            self._generate_drilling_path(op, machiningRegion, clearance, feed_z, top, bottom, add_cmd, setup)
        elif op_type in ("2d_contour", "2d_contour_outer", "step"):
            self._generate_contour_path(op, machiningRegion, tool_radius, clearance, feed_z, top, bottom, add_cmd)
        elif op_type == "boss_clearing":
            self._generate_boss_path(op, machiningRegion, tool_radius, clearance, feed_z, top, bottom, add_cmd)
        elif op_type == "pocketing":
            self._generate_pocket_path(op, machiningRegion, tool_radius, clearance, feed_z, top, bottom, add_cmd)
        elif op_type == "facing":
            self._generate_facing_path(op, machiningRegion, tool_radius, clearance, feed_z, top, bottom, add_cmd)
        elif op_type == "od_turning":
            self._generate_od_turning_path(op, machiningRegion, tool_radius, clearance, feed_z, top, bottom, add_cmd)
        elif op_type in ("indexed_4axis_milling", "rotary_milling", "multi_axis_surface_milling"):
            self._generate_indexed_4axis_path(op, machiningRegion, tool_radius, clearance, feed_z, top, bottom, add_cmd)
        else:
            raise NotImplementedError(f"Motion generation not implemented for {op_type}")

        return commands

    def _generate_drilling_path(self, op, machiningRegion, clearance, feed_z, top, bottom, add_cmd, setup):
        # Attempt to use setup-local center first, fallback to raw geometry center
        local_feat_dict = op.get("parameters", {}).get("setup_local_feature")
        
        if local_feat_dict and "localCenter" in local_feat_dict:
            center = local_feat_dict["localCenter"]
        else:
            center = machiningRegion.get("center")
            
        axis = machiningRegion.get("axis")

        if not center or not axis:
            raise ValueError("Drilling geometry missing center or axis")

        import math
        cx, cy, cz = center
        if not math.isfinite(cx) or not math.isfinite(cy):
            raise ValueError("Invalid drill center: X or Y is not finite")
        
        retract_z = op.get("safe_heights", {}).get("retract", clearance)
        
        # Calculate correct bottom Z
        if machiningRegion.get("bottomZ") is None:
            depth = machiningRegion.get("depth", op.get("parameters", {}).get("depth", 10.0))
            bottom = top - depth

        # Output safe approach segments for the hole
        add_cmd(ToolpathSegmentType.RAPID_CLEARANCE,
                Point3D(x=cx, y=cy, z=clearance),
                Point3D(x=cx, y=cy, z=clearance))
        add_cmd(ToolpathSegmentType.RAPID_XY,
                Point3D(x=cx, y=cy, z=clearance),
                Point3D(x=cx, y=cy, z=clearance))
        add_cmd(ToolpathSegmentType.APPROACH_RETRACT,
                Point3D(x=cx, y=cy, z=clearance),
                Point3D(x=cx, y=cy, z=retract_z))
        
        # The post-processor will handle G81/G83 logic safely.
        add_cmd(ToolpathSegmentType.DRILL_CYCLE, 
                Point3D(x=cx, y=cy, z=feed_z), 
                Point3D(x=cx, y=cy, z=bottom))

        add_cmd(ToolpathSegmentType.RETRACT_CLEARANCE,
                Point3D(x=cx, y=cy, z=bottom),
                Point3D(x=cx, y=cy, z=clearance))

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
            raise ValueError(f"Tool radius ({tool_radius}mm) too large to fit in boss clearance area")

        bounds = safe_area.bounds # minx, miny, maxx, maxy
        if not bounds:
            raise ValueError("Failed to compute valid boundaries for boss clearing")
            
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

        params = (op.get("parameters") or {})
        feeds = params.get("feeds_and_speeds") or {}
        
        tool = op.get("tool") or {}
        tool_diameter = tool.get("geometry", {}).get("DC", 10.0)
        default_stepdown = tool_diameter * 0.5  # 50% of tool diameter
        
        stepdown = params.get("maxStepdown", params.get("stepdown", feeds.get("stepdown", default_stepdown)))
        if stepdown <= 0:
            stepdown = default_stepdown

        total_depth = top - bottom
        passes = max(1, math.ceil(total_depth / stepdown))
        actual_step = total_depth / passes
        
        safe_heights = op.get("safe_heights", {})
        retract = safe_heights.get("retract", clearance)

        for path in paths_2d:
            if not path or len(path) < 2:
                continue

            for i in range(passes):
                z = top - (i + 1) * actual_step

                start_pt_2d = path[0]
                pt_retract = Point3D(x=start_pt_2d[0], y=start_pt_2d[1], z=retract)
                pt_z = Point3D(x=start_pt_2d[0], y=start_pt_2d[1], z=z)

                pt_lead_in_retract = Point3D(x=start_pt_2d[0], y=start_pt_2d[1], z=retract)
                pt_lead_in_z = Point3D(x=start_pt_2d[0], y=start_pt_2d[1], z=z)

                if i == 0:
                    pt_clearance = Point3D(x=start_pt_2d[0], y=start_pt_2d[1], z=clearance)
                    add_cmd(ToolpathSegmentType.APPROACH_RETRACT, pt_clearance, pt_lead_in_retract)
                else:
                    add_cmd(ToolpathSegmentType.RAPID_XY, pt_end_retract, pt_lead_in_retract)
                    
                add_cmd(ToolpathSegmentType.PLUNGE, pt_lead_in_retract, pt_lead_in_z)

                for j in range(1, len(path)):
                    p1 = path[j-1]
                    p2 = path[j]
                    add_cmd(ToolpathSegmentType.CUT, Point3D(x=p1[0], y=p1[1], z=z), Point3D(x=p2[0], y=p2[1], z=z))

                end_pt_2d = path[-1]
                pt_end = Point3D(x=end_pt_2d[0], y=end_pt_2d[1], z=z)
                pt_end_retract = Point3D(x=end_pt_2d[0], y=end_pt_2d[1], z=retract)
                
                if i == passes - 1:
                    pt_end_clearance = Point3D(x=end_pt_2d[0], y=end_pt_2d[1], z=clearance)
                    add_cmd(ToolpathSegmentType.RETRACT_CLEARANCE, pt_end, pt_end_clearance)
                else:
                    add_cmd(ToolpathSegmentType.APPROACH_RETRACT, pt_end, pt_end_retract)

    def _generate_od_turning_path(self, op, machiningRegion, tool_radius, clearance, feed_z, top, bottom, add_cmd):
        # Simplified turning profile (Z = spindle axis, X = radius, Y = 0)
        # OD Turning runs along the Z-axis while varying X to match the cylinder profile.
        length = machiningRegion.get("length", 50.0)
        radius = machiningRegion.get("radius", 20.0)

        # Start away from part
        start_pt = Point3D(x=radius + clearance, y=0, z=length + clearance)
        feed_pt = Point3D(x=radius + clearance, y=0, z=length)

        add_cmd(ToolpathSegmentType.RAPID_CLEARANCE, start_pt, feed_pt)

        stepdown = (op.get("parameters") or {}).get("stepdown", 2.0)
        current_radius = radius + stepdown * 3  # Start from stock radius roughly

        while current_radius > radius:
            next_radius = max(radius, current_radius - stepdown)

            # Plunge to next pass diameter
            add_cmd(ToolpathSegmentType.PLUNGE,
                    Point3D(x=current_radius, y=0, z=length),
                    Point3D(x=next_radius, y=0, z=length))

            # Cut along Z
            add_cmd(ToolpathSegmentType.CUT,
                    Point3D(x=next_radius, y=0, z=length),
                    Point3D(x=next_radius, y=0, z=0))

            # Retract X
            add_cmd(ToolpathSegmentType.RETRACT_CLEARANCE,
                    Point3D(x=next_radius, y=0, z=0),
                    Point3D(x=next_radius + 1.0, y=0, z=0))

            # Rapid back to start Z
            add_cmd(ToolpathSegmentType.RAPID_XY,
                    Point3D(x=next_radius + 1.0, y=0, z=0),
                    Point3D(x=next_radius + 1.0, y=0, z=length))

            current_radius = next_radius

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
            raise ValueError(f"Tool radius ({tool_radius}mm) too large to fit in boss clearance area")

        bounds = safe_area.bounds # minx, miny, maxx, maxy
        if not bounds:
            raise ValueError("Failed to compute valid boundaries for boss clearing")
            
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

        params = (op.get("parameters") or {})
        feeds = params.get("feeds_and_speeds") or {}
        
        tool = op.get("tool") or {}
        tool_diameter = tool.get("geometry", {}).get("DC", 10.0)
        default_stepdown = tool_diameter * 0.5  # 50% of tool diameter
        
        stepdown = params.get("maxStepdown", params.get("stepdown", feeds.get("stepdown", default_stepdown)))
        if stepdown <= 0:
            stepdown = default_stepdown

        total_depth = top - bottom
        passes = max(1, math.ceil(total_depth / stepdown))
        actual_step = total_depth / passes
        
        safe_heights = op.get("safe_heights", {})
        retract = safe_heights.get("retract", clearance)

        for path in paths_2d:
            if not path or len(path) < 2:
                continue

            for i in range(passes):
                z = top - (i + 1) * actual_step

                start_pt_2d = path[0]
                pt_retract = Point3D(x=start_pt_2d[0], y=start_pt_2d[1], z=retract)
                pt_z = Point3D(x=start_pt_2d[0], y=start_pt_2d[1], z=z)

                if i == 0:
                    pt_clearance = Point3D(x=start_pt_2d[0], y=start_pt_2d[1], z=clearance)
                    add_cmd(ToolpathSegmentType.APPROACH_RETRACT, pt_clearance, pt_retract)
                else:
                    add_cmd(ToolpathSegmentType.RAPID_XY, pt_end_retract, pt_retract)
                    
                add_cmd(ToolpathSegmentType.PLUNGE, pt_retract, pt_z)

                for j in range(1, len(path)):
                    p1 = path[j-1]
                    p2 = path[j]
                    add_cmd(ToolpathSegmentType.CUT, Point3D(x=p1[0], y=p1[1], z=z), Point3D(x=p2[0], y=p2[1], z=z))

                end_pt_2d = path[-1]
                pt_end = Point3D(x=end_pt_2d[0], y=end_pt_2d[1], z=z)
                pt_end_retract = Point3D(x=end_pt_2d[0], y=end_pt_2d[1], z=retract)
                
                if i == passes - 1:
                    pt_end_clearance = Point3D(x=end_pt_2d[0], y=end_pt_2d[1], z=clearance)
                    add_cmd(ToolpathSegmentType.RETRACT_CLEARANCE, pt_end, pt_end_clearance)
                else:
                    add_cmd(ToolpathSegmentType.APPROACH_RETRACT, pt_end, pt_end_retract)

    def _generate_od_turning_path(self, op, machiningRegion, tool_radius, clearance, feed_z, top, bottom, add_cmd):
        # Simplified turning profile (Z = spindle axis, X = radius, Y = 0)
        # OD Turning runs along the Z-axis while varying X to match the cylinder profile.
        length = machiningRegion.get("length", 50.0)
        radius = machiningRegion.get("radius", 20.0)

        # Start away from part
        start_pt = Point3D(x=radius + clearance, y=0, z=length + clearance)
        feed_pt = Point3D(x=radius + clearance, y=0, z=length)

        add_cmd(ToolpathSegmentType.RAPID_CLEARANCE, start_pt, feed_pt)

        stepdown = (op.get("parameters") or {}).get("stepdown", 2.0)
        current_radius = radius + stepdown * 3  # Start from stock radius roughly

        while current_radius > radius:
            next_radius = max(radius, current_radius - stepdown)

            # Plunge to next pass diameter
            add_cmd(ToolpathSegmentType.PLUNGE,
                    Point3D(x=current_radius, y=0, z=length),
                    Point3D(x=next_radius, y=0, z=length))

            # Cut along Z
            add_cmd(ToolpathSegmentType.CUT,
                    Point3D(x=next_radius, y=0, z=length),
                    Point3D(x=next_radius, y=0, z=0))

            # Retract X
            add_cmd(ToolpathSegmentType.RETRACT_CLEARANCE,
                    Point3D(x=next_radius, y=0, z=0),
                    Point3D(x=next_radius + 1.0, y=0, z=0))

            # Rapid back to start Z
            add_cmd(ToolpathSegmentType.RAPID_XY,
                    Point3D(x=next_radius + 1.0, y=0, z=0),
                    Point3D(x=next_radius + 1.0, y=0, z=length))

            current_radius = next_radius

        # Final retract
        add_cmd(ToolpathSegmentType.RAPID_CLEARANCE,
                Point3D(x=radius + 1.0, y=0, z=length),
                Point3D(x=radius + clearance, y=0, z=length + clearance))

    def _generate_indexed_4axis_path(self, op, machiningRegion, tool_radius, clearance, feed_z, top, bottom, add_cmd):
        # Treat as a 2D contour on a rotary axis.
        # Typically the CAM generates index (A/B) command, then runs 3-axis motion.
        # For simplicity, we just generate a wrapped contour path.
        radius = machiningRegion.get("radius", 20.0)
        length = machiningRegion.get("length", 50.0)
        retract_z = op.get("safe_heights", {}).get("retract", clearance)

        # Start above the cylinder
        add_cmd(ToolpathSegmentType.APPROACH_RETRACT,
                Point3D(x=0, y=radius + clearance, z=length + clearance),
                Point3D(x=0, y=radius + retract_z, z=length))

        add_cmd(ToolpathSegmentType.PLUNGE,
                Point3D(x=0, y=radius + retract_z, z=length),
                Point3D(x=0, y=radius, z=length))

        # Basic linear cut across the length
        add_cmd(ToolpathSegmentType.CUT,
                Point3D(x=0, y=radius, z=length),
                Point3D(x=0, y=radius, z=0))

        add_cmd(ToolpathSegmentType.RETRACT_CLEARANCE,
                Point3D(x=0, y=radius, z=0),
                Point3D(x=0, y=radius + clearance, z=0))

        # Move back to safe
        add_cmd(ToolpathSegmentType.RAPID_CLEARANCE,
                Point3D(x=0, y=radius + clearance, z=0),
                Point3D(x=0, y=radius + clearance, z=length + clearance))
