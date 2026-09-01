import math
from typing import Dict, Any, List
from app.constants import (
    CYLINDRICAL_STOCK_TYPES,
    CIRCULAR_FEATURE_TYPES,
    DEFAULT_CIRCLE_SEGMENTS,
    POCKET_CIRCLE_SEGMENTS,
    DEFAULT_CAM_PARAMS,
)

class ParametricToolpathEngine:
    """
    Generates physically accurate, production-grade CAM toolpaths from parametric features:
    - Multi-pass facing rasters with 70% tool stepover and stock overhang.
    - Concentric spiral / raster pocket clearing (center outward to walls) without unmachined islands.
    - 2D contour & boss clearing with cutter radius compensation, standoff lead-in/lead-out, and multi-depth stepdown passes.
    - Drilling cycles with peck-drilling (G83) for deep holes and helical interpolation for larger bores.
    """
    def generate_toolpath(self, operation: Dict[str, Any], feature: Dict[str, Any], machine_config: Dict[str, Any], planning_context: Any = None) -> tuple[List[Dict[str, Any]], Dict[str, Any]]:
        toolpaths = []
        validation_result = {"valid": True, "errors": [], "warnings": []}
        op_type = str(operation.get("type") or operation.get("operation_type") or "").lower()
        op_id = operation.get("id", "")
        feat_type = str(feature.get("type", "")).lower()
        
        # Safe height parameters (fall back to centralized config, not literals)
        safe_h = operation.get("safe_heights", {})
        clearance = float(safe_h.get("clearance") or DEFAULT_CAM_PARAMS["safe_clearance_mm"])
        retract_z = float(safe_h.get("retract") or (clearance - DEFAULT_CAM_PARAMS["retract_offset_mm"]))
        top_z = float(safe_h.get("top") or 0.0)
        
        # Tool parameters — a tool diameter MUST be known for a valid toolpath.
        # (Same safety contract as the MotionPlanner: do not silently assume a
        # diameter, which would produce wrong, potentially dangerous toolpaths.)
        tool = operation.get("tool", {})
        raw_tool_dia = (tool.get("diameter") or tool.get("geometry", {}).get("diameter") or tool.get("diameter_mm"))
        if raw_tool_dia is None or float(raw_tool_dia) <= 0:
            raise ValueError("Tool diameter is missing or invalid; cannot generate parametric toolpath")
        tool_dia = float(raw_tool_dia)
        tool_radius = tool_dia / 2.0

        # Feature geometry — resolve depth from the most precise source available.
        # Priority: setup_local_feature > feature dimensions > feature top-level
        #           > stock depth > centralized default (no bare magic numbers).
        local_feat = operation.get("parameters", {}).get("setup_local_feature", {})
        feat_dims = feature.get("dimensions", {})
        stock_depth = None
        try:
            stock_depth = float(
                machine_config.get("setup", {}).get("resolvedStock", {}).get("depth")
                or (machine_config.get("stockDimensions") or [None, None, None])[2]
                or feature.get("stockDepth")
            )
        except Exception:
            stock_depth = None

        resolved_depth = (
            local_feat.get("depth")
            or feat_dims.get("depth")
            or feat_dims.get("length")
            or feat_dims.get("height")
            or feature.get("depth")
            or feature.get("length")
            or feature.get("height")
            or stock_depth
            or DEFAULT_CAM_PARAMS["default_depth_mm"]
        )
        # If we still have no numeric depth, that is a real configuration error.
        if resolved_depth is None:
            raise ValueError("Feature depth could not be resolved from feature or stock; cannot generate toolpath")
        depth = abs(float(resolved_depth))
        
        # Compute bottom_z from the feature's own depth, NOT from safe_heights.bottom.
        # safe_heights.bottom is the stock floor (safety limit), not the drill/pocket target.
        feature_bottom_z = top_z - depth
        
        # If setup_local_feature provides explicit localTopZ / localBottomZ, prefer those
        if local_feat.get("localTopZ") is not None and local_feat.get("localBottomZ") is not None:
            feature_bottom_z = float(local_feat["localBottomZ"])
            local_top = float(local_feat["localTopZ"])
            depth = abs(local_top - feature_bottom_z)
        
        # Clamp: never cut below the stock floor (safety)
        stock_floor = float(safe_h.get("bottom", feature_bottom_z - 1.0))
        bottom_z = max(feature_bottom_z, stock_floor)
        if bottom_z >= top_z:
            bottom_z = top_z - depth
        
        center = feature.get("center", [0.0, 0.0, 0.0])
        cx = float(center[0]) if len(center) >= 1 else 0.0
        cy = float(center[1]) if len(center) >= 2 else 0.0
        cz = float(center[2]) if len(center) >= 3 else 0.0

        # Adjust top_z if cz is valid and safe_h wasn't explicitly set
        if "top" not in safe_h and len(center) >= 3 and abs(cz) > 0.001:
            top_z = cz
            bottom_z = top_z - depth
            clearance = top_z + DEFAULT_CAM_PARAMS["safe_clearance_mm"]
            retract_z = top_z + DEFAULT_CAM_PARAMS["retract_offset_mm"]

        cursor = {"x": cx, "y": cy, "z": clearance}
        
        def add_move(move_type, x=None, y=None, z=None, source="contour", segmentRole=None):
            nonlocal cursor
            new_pos = {
                "x": round(x if x is not None else cursor["x"], 4),
                "y": round(y if y is not None else cursor["y"], 4),
                "z": round(z if z is not None else cursor["z"], 4)
            }
            if len(toolpaths) == 0 or (new_pos["x"] != cursor["x"] or new_pos["y"] != cursor["y"] or new_pos["z"] != cursor["z"]):
                # Determine feedrate based on move type
                feedrate = 0.0
                fs = operation.get("parameters", {}).get("feeds_and_speeds") or operation.get("feeds_and_speeds") or {}
                
                if move_type in ("cut", "drill_cycle"):
                    if segmentRole == "lead_in":
                        feedrate = float(fs.get("lead_in_feedrate") or fs.get("feedrate_mm_min") or DEFAULT_CAM_PARAMS["default_feedrate_mm_min"])
                    elif segmentRole == "lead_out":
                        feedrate = float(fs.get("lead_out_feedrate") or fs.get("feedrate_mm_min") or DEFAULT_CAM_PARAMS["default_feedrate_mm_min"])
                    elif segmentRole == "approach":
                        feedrate = float(fs.get("approach_feedrate") or fs.get("feedrate_mm_min") or DEFAULT_CAM_PARAMS["default_feedrate_mm_min"])
                    else:
                        feedrate = float(fs.get("feedrate_mm_min") or fs.get("feed_rate") or operation.get("parameters", {}).get("feedRate") or DEFAULT_CAM_PARAMS["default_feedrate_mm_min"])
                elif move_type == "plunge":
                    feedrate = float(fs.get("plunge_feedrate") or operation.get("parameters", {}).get("plungeRate") or DEFAULT_CAM_PARAMS["default_plunge_feedrate_mm_min"])
                    
                toolpaths.append({
                    "type": move_type,
                    "moveType": move_type,
                    "segmentRole": segmentRole,
                    "operationId": op_id,
                    "featureId": feature.get("id", ""),
                    "toolId": operation.get("tool_id") or operation.get("toolId") or "t1",
                    "source": source,
                    "start": cursor.copy(),
                    "end": new_pos.copy(),
                    "x": new_pos["x"],
                    "y": new_pos["y"],
                    "z": new_pos["z"],
                    "feedrate": feedrate,
                    "spindle_rpm": float(
                        (operation.get("parameters", {}).get("feeds_and_speeds") or operation.get("feeds_and_speeds") or {}).get("spindle_rpm")
                        or operation.get("parameters", {}).get("spindleSpeed")
                        or DEFAULT_CAM_PARAMS["default_spindle_rpm"]
                    )
                })
                cursor = new_pos

        def add_arc_move(center_x, center_y, end_x, end_y, z, clockwise=True, source="contour", segmentRole=None):
            nonlocal cursor
            new_pos = {"x": round(end_x, 4), "y": round(end_y, 4), "z": round(z, 4)}
            if len(toolpaths) == 0 or (new_pos["x"] != cursor["x"] or new_pos["y"] != cursor["y"] or new_pos["z"] != cursor["z"]):
                radius = math.hypot(end_x - center_x, end_y - center_y)
                fs = operation.get("parameters", {}).get("feeds_and_speeds") or operation.get("feeds_and_speeds") or {}
                feedrate = float(fs.get("feedrate_mm_min") or fs.get("feed_rate") or operation.get("parameters", {}).get("feedRate") or DEFAULT_CAM_PARAMS["default_feedrate_mm_min"])
                if segmentRole in ("lead_in", "lead_out"):
                    feedrate = float(fs.get("lead_in_feedrate") or fs.get("lead_out_feedrate") or feedrate)
                toolpaths.append({
                    "type": "arc_cw" if clockwise else "arc_ccw",
                    "moveType": "arc_cw" if clockwise else "arc_ccw",
                    "segmentRole": segmentRole,
                    "operationId": op_id,
                    "featureId": feature.get("id", ""),
                    "toolId": operation.get("tool_id") or operation.get("toolId") or "t1",
                    "source": source,
                    "start": cursor.copy(),
                    "end": new_pos.copy(),
                    "x": new_pos["x"],
                    "y": new_pos["y"],
                    "z": new_pos["z"],
                    "center": {"x": round(center_x, 4), "y": round(center_y, 4), "z": round(z, 4)},
                    "radius": round(radius, 4),
                    "clockwise": clockwise,
                    "plane": "XY",
                    "feedrate": feedrate,
                    "spindle_rpm": float(
                        (operation.get("parameters", {}).get("feeds_and_speeds") or operation.get("feeds_and_speeds") or {}).get("spindle_rpm")
                        or operation.get("parameters", {}).get("spindleSpeed")
                        or DEFAULT_CAM_PARAMS["default_spindle_rpm"]
                    )
                })
                cursor = new_pos

        def _add_arc_segment(add_fn, center_x, center_y, radius, z, source="contour"):
            """Add a full 360-degree circular pass as 4 quarter-arcs."""
            import math as _m
            cur_angle = _m.atan2(cursor["y"] - center_y, cursor["x"] - center_x)
            num_quads = 4
            for qi in range(num_quads):
                a_end = cur_angle - (qi + 1) * (_m.pi * 2.0 / num_quads)
                ex = center_x + radius * _m.cos(a_end)
                ey = center_y + radius * _m.sin(a_end)
                add_arc_move(center_x, center_y, ex, ey, z, clockwise=True, source=source)

        # Stepover parameter
        stepover_pct = operation.get("parameters", {}).get("stepoverPercentage", 40.0)
        stepover_abs = operation.get("parameters", {}).get("stepover")
        if stepover_abs is None or float(stepover_abs) <= 0:
            stepover_val = tool_dia * (float(stepover_pct) / 100.0)
        else:
            stepover_val = float(stepover_abs)
            
        # Depth cuts parameters
        depth_cuts_enabled = operation.get("parameters", {}).get("depthCutsEnabled", True)
        rough_stepdown = operation.get("parameters", {}).get("maxStepdown")
        finish_stepdown = operation.get("parameters", {}).get("finishStepdown")
        finish_cuts = int(operation.get("parameters", {}).get("finishCuts", 0))

        if not depth_cuts_enabled:
            rough_stepdown = depth
            finish_stepdown = depth
            finish_cuts = 0
        else:
            if rough_stepdown is None or float(rough_stepdown) <= 0:
                rough_stepdown = min(
                    DEFAULT_CAM_PARAMS["max_stepdown_cap_mm"],
                    max(tool_dia * 0.5, DEFAULT_CAM_PARAMS["min_stepdown_mm"]),
                )
            else:
                rough_stepdown = float(rough_stepdown)
                
            if finish_stepdown is None or float(finish_stepdown) <= 0:
                finish_stepdown = rough_stepdown
            else:
                finish_stepdown = float(finish_stepdown)
                
        if feat_type in ("hole", "blind_hole", "through_hole", "bore") or op_type in ("drilling", "peck_drilling", "boring", "helical_bore_milling"):
            rough_stepdown = tool_dia * 1.5
            
        stepdown = rough_stepdown # For helical drill fallback
        
        # Pre-calculate Z passes
        z_passes = []
        if depth_cuts_enabled:
            target_rough_z = bottom_z
            if finish_cuts > 0:
                target_rough_z = bottom_z + (finish_cuts * finish_stepdown)
                
            if target_rough_z < top_z:
                curr_z = top_z
                while curr_z > target_rough_z + 0.001:
                    curr_z -= rough_stepdown
                    if curr_z < target_rough_z: curr_z = target_rough_z
                    z_passes.append(curr_z)
            
            if finish_cuts > 0:
                curr_z = target_rough_z
                for _ in range(finish_cuts):
                    curr_z -= finish_stepdown
                    if curr_z < bottom_z: curr_z = bottom_z
                    z_passes.append(curr_z)
        else:
            z_passes = [bottom_z]
            
        if not z_passes:
            z_passes = [bottom_z]

        # Determine strategy
        src = "contour"
        if feat_type in ("hole", "blind_hole", "through_hole", "bore") or op_type in ("drilling", "peck_drilling", "boring", "reaming", "tapping", "helical_bore_milling"):
            src = "drill"
        elif feat_type in ("pocket", "pocketing") or op_type in ("pocketing", "slot_milling"):
            src = "pocket"
        elif feat_type in ("face", "facing") or op_type in ("facing", "face_milling"):
            src = "face"
        elif feat_type in ("boss", "cylinder", "external_cylinder") or op_type in ("boss_clearing", "od_turning", "turning", "od_finish_turning"):
            src = "boss"
        elif feat_type == "contour" or op_type in ("2d_contour", "contour", "step"):
            src = "contour"

        # ----------------------------------------------------
        # 1. DRILLING & BORING STRATEGY
        # ----------------------------------------------------
        if src == "drill":
            hole_dia = float(feature.get("diameter") or feature.get("width") or tool_dia)
            
            add_move("rapid_clearance", z=clearance, source=src)
            add_move("rapid_xy", x=cx, y=cy, z=clearance, source=src)
            add_move("approach_retract", z=retract_z, source=src)

            # Case A: Hole <= Tool Diameter -> Canned Drill Cycle (G81/G83)
            if hole_dia <= tool_dia * 1.1:
                # Emit a drill_cycle move so the post-processor can output
                # the correct canned cycle (G81 for shallow, G83 peck for deep).
                # The post-processor uses the L/D ratio to decide.
                add_move("drill_cycle", x=cx, y=cy, z=bottom_z, source=src)
                add_move("retract_clearance", z=clearance, source=src)

            # Case B: Hole > Tool Diameter -> Helical Interpolation Boring
            else:
                bore_radius = (hole_dia - tool_dia) / 2.0
                if bore_radius < DEFAULT_CAM_PARAMS["min_feature_radius_mm"]:
                    bore_radius = DEFAULT_CAM_PARAMS["min_feature_radius_mm"]

                # Lead-in to bore radius
                add_move("plunge", z=top_z, source=src)
                add_move("cut", x=cx + bore_radius, y=cy, z=top_z, source=src, segmentRole="lead_in")

                # Helical spiral down with sufficient points per revolution
                # for smooth tool motion (24 points/rev minimum)
                pts_per_revolution = max(24, POCKET_CIRCLE_SEGMENTS)
                num_turns = max(1, math.ceil(depth / stepdown))
                z_per_turn = depth / num_turns
                total_pts = num_turns * pts_per_revolution

                curr_z = top_z
                for p in range(1, total_pts + 1):
                    turn_idx = p / pts_per_revolution
                    frac_in_turn = (p % pts_per_revolution) / pts_per_revolution
                    angle = -2.0 * math.pi * frac_in_turn
                    z_interp = top_z - (turn_idx / num_turns) * depth
                    px = cx + bore_radius * math.cos(angle)
                    py = cy + bore_radius * math.sin(angle)
                    add_move("cut", x=px, y=py, z=z_interp, source=src)

                # Full 360-degree flat finish pass at bottom
                _add_arc_segment(add_move, cx, cy, bore_radius, bottom_z, source=src)

                # Lead-out to center
                add_move("cut", x=cx, y=cy, z=bottom_z, source=src, segmentRole="lead_out")
                add_move("retract_clearance", z=clearance, source=src)

        # ----------------------------------------------------
        # 2. FACING STRATEGY (Multi-Pass Raster or Circular)
        # ----------------------------------------------------
        elif src == "face":
            if not planning_context:
                validation_result["valid"] = False
                validation_result["errors"].append("Facing Planning Error: PlanningContext is required.")
                return [], validation_result

            stock_geom = planning_context.get_stock_geometry()
            bounds = stock_geom["bounds"]
            if not bounds or len(bounds) < 4:
                validation_result["valid"] = False
                validation_result["errors"].append("Facing Planning Error: Stock bounds are empty.")
                return [], validation_result

            min_x, min_y, max_x, max_y = bounds[0], bounds[1], bounds[2], bounds[3]
            stock_w = max_x - min_x
            stock_l = max_y - min_y
            cx = min_x + (stock_w / 2.0)
            cy = min_y + (stock_l / 2.0)
            
            # Identify if we need circular facing
            ctx_setup = getattr(planning_context, "setup", {}) or {}
            ctx_machine = getattr(planning_context, "machine_profile", {}) or {}
            is_cylindrical_face = (
                stock_geom.get("provenance", {}).get("derived_from", "") in CYLINDRICAL_STOCK_TYPES
                or (isinstance(ctx_setup, dict) and str(ctx_setup.get("stockType", "")).lower() in CYLINDRICAL_STOCK_TYPES)
                or (isinstance(ctx_machine, dict) and any(kw in str(ctx_machine.get("machine_type", "")).lower() for kw in ("lathe", "turning", "mill_turn", "swiss")))
            )
            stock_dia = max(stock_w, stock_l) if is_cylindrical_face else 0.0
            
            overhang = min(
                tool_dia * DEFAULT_CAM_PARAMS["facing_overhang_factor"],
                DEFAULT_CAM_PARAMS["facing_overhang_cap_mm"],
            )  # Tightly clear tool center outside stock
            stepover = stepover_val

            # Inject traceability for facing
            operation["traceability"] = feature.get("traceability", {}).copy()
            tool_info = operation.get("tool", {})
            operation["traceability"].update({
                "selected_tool_id": tool_info.get("tool_id") or operation.get("tool_id") or operation.get("toolId", ""),
                "tool_selection_reason": operation.get("parameters", {}).get("errorReason", "Automatic selection"),
                "facing_strategy": operation.get("machining_strategy", "zigzag"),
                "feeds_and_speeds": operation.get("parameters", {}).get("feeds_and_speeds") or operation.get("feeds_and_speeds", {}),
                "stepover": round(stepover_val, 3),
                "stepdown": round(rough_stepdown, 3), # Facing typically does it in one pass for now or uses max_stepdown
                "validation_result": "pending"
            })

            add_move("rapid_clearance", z=clearance, source=src)
            
            if is_cylindrical_face and stock_dia > 0:
                # Circular facing: raster across the circular cross-section
                face_radius = stock_dia / 2.0
                min_y = cy - face_radius
                max_y = cy + face_radius
                
                num_passes = max(1, math.ceil((max_y - min_y) / stepover))
                
                # Start at first Y position
                curr_y = min_y + (stepover / 2.0)
                add_move("approach_retract", x=cx - face_radius - overhang, y=curr_y, z=clearance, source=src)
                add_move("plunge", z=top_z, source=src)
                add_move("cut", x=cx - face_radius, y=curr_y, z=top_z, source=src, segmentRole="lead_in")
                
                direction = 1
                for i in range(num_passes):
                    # Compute X extent at this Y (circle intersection)
                    dy = curr_y - cy
                    if abs(dy) < face_radius:
                        x_extent = math.sqrt(face_radius**2 - dy**2)
                    else:
                        x_extent = 0.0
                    
                    if x_extent > 0:
                        if direction == 1:
                            add_move("cut", x=cx + x_extent + overhang, y=curr_y, z=top_z, source=src)
                        else:
                            add_move("cut", x=cx - x_extent - overhang, y=curr_y, z=top_z, source=src)
                    
                    if i < num_passes - 1:
                        curr_y += stepover
                        if curr_y > max_y - (stepover / 4.0):
                            curr_y = max_y - (stepover / 4.0)
                        direction *= -1
                        # Step to next Y
                        dy = curr_y - cy
                        if abs(dy) < face_radius:
                            x_extent = math.sqrt(face_radius**2 - dy**2)
                        else:
                            x_extent = 0.0
                        if x_extent > 0:
                            if direction == 1:
                                add_move("cut", x=cx - x_extent - overhang, y=curr_y, z=top_z, source=src)
                            else:
                                add_move("cut", x=cx + x_extent + overhang, y=curr_y, z=top_z, source=src)
                    
                    if i == num_passes - 1:
                        last_x_extent = x_extent if x_extent > 0 else face_radius
                        if direction == 1:
                            add_move("cut", x=cx + last_x_extent + overhang, y=curr_y, z=top_z, source=src, segmentRole="lead_out")
                        else:
                            add_move("cut", x=cx - last_x_extent - overhang, y=curr_y, z=top_z, source=src, segmentRole="lead_out")
                            
            else:
                # Rectangular facing: standard zigzag raster tightly fitting stock bounds
                min_x = cx - (stock_w / 2.0)
                max_x = cx + (stock_w / 2.0)
                min_y = cy - (stock_l / 2.0)
                max_y = cy + (stock_l / 2.0)

                num_passes = max(1, math.ceil((max_y - min_y) / stepover))

                curr_y = min_y + (stepover / 2.0)
                add_move("approach_retract", x=min_x - overhang, y=curr_y, z=clearance, source=src)
                add_move("plunge", z=top_z, source=src)
                add_move("cut", x=min_x, y=curr_y, z=top_z, source=src, segmentRole="lead_in")

                direction = 1
                for i in range(num_passes):
                    if direction == 1:
                        add_move("cut", x=max_x + overhang, y=curr_y, z=top_z, source=src)
                    else:
                        add_move("cut", x=min_x - overhang, y=curr_y, z=top_z, source=src)
                    
                    if i < num_passes - 1:
                        curr_y += stepover
                        direction *= -1
                        if direction == 1:
                            add_move("cut", x=min_x - overhang, y=curr_y, z=top_z, source=src)
                        else:
                            add_move("cut", x=max_x + overhang, y=curr_y, z=top_z, source=src)
                            
                last_x = (max_x + overhang) if direction == 1 else (min_x - overhang)
                add_move("cut", x=last_x, y=curr_y, z=top_z, source=src, segmentRole="lead_out")

            add_move("retract_clearance", z=clearance, source=src)

        # ----------------------------------------------------
        # 3. POCKET CLEARING STRATEGY (Shapely-based Inward Erosion)
        #    Uses iterative polygon erosion to guarantee 100% area
        #    coverage regardless of pocket shape.
        # ----------------------------------------------------
        elif src == "pocket":
            from shapely.geometry import Polygon as ShapelyPolygon

            stock = machine_config.get("setup", {}).get("resolvedStock", {}) if isinstance(machine_config, dict) else {}
            stock_dims = machine_config.get("stockDimensions") or machine_config.get("setup", {}).get("stockDimensions") if isinstance(machine_config, dict) else None
            width = float(feature.get("width") or feature.get("diameter") or stock.get("width") or stock.get("diameter") or (stock_dims[1] if stock_dims else DEFAULT_CAM_PARAMS["default_feature_width_mm"]))
            length = float(feature.get("length") or feature.get("diameter") or stock.get("length") or stock.get("diameter") or (stock_dims[0] if stock_dims else DEFAULT_CAM_PARAMS["default_feature_length_mm"]))

            is_circular = (
                feat_type in CIRCULAR_FEATURE_TYPES
                or "cylinder" in feat_type or "shaft" in feat_type or "circle" in feat_type
                or ("cylinder" in str(feature.get("subtype", "")).lower())
                or ("shaft" in str(feature.get("name", "")).lower())
                or (feature.get("diameter") is not None and not feature.get("width"))
            )

            # Build the pocket boundary polygon from feature dimensions
            pocket_radius = max(width, length) / 2.0
            finish_allowance = float(operation.get("parameters", {}).get("finishAllowance", 0.0) or 0.0)
            if is_circular:
                from shapely.geometry import Point as ShapelyPoint
                pocket_poly = ShapelyPoint(cx, cy).buffer(pocket_radius, resolution=64)
            else:
                pocket_poly = ShapelyPolygon([
                    (cx - width / 2.0, cy - length / 2.0),
                    (cx + width / 2.0, cy - length / 2.0),
                    (cx + width / 2.0, cy + length / 2.0),
                    (cx - width / 2.0, cy + length / 2.0),
                ])

            add_move("rapid_clearance", z=clearance, source=src)

            num_rough_passes = len(z_passes) - finish_cuts if finish_cuts > 0 else len(z_passes)

            for pass_idx, curr_z in enumerate(z_passes):
                # Plunge at pocket center
                add_move("retract_clearance", z=clearance, source=src)
                add_move("rapid_xy", x=cx, y=cy, z=clearance, source=src)
                add_move("plunge", z=curr_z, source=src)

                # For roughing passes, erode pocket by finish_allowance to leave stock
                # For finishing passes, cut to final geometry
                is_roughing = pass_idx < num_rough_passes
                effective_poly = pocket_poly
                if is_roughing and finish_allowance > 0:
                    effective_poly = pocket_poly.buffer(-finish_allowance, join_style=2)

                # Erode inward from pocket wall by tool_radius to get max tool-center area
                machining_area = effective_poly.buffer(-tool_radius, join_style=2)
                if machining_area.is_empty:
                    # Tool is too large for pocket — single pass at center
                    if is_circular:
                        _add_arc_segment(add_move, cx, cy, 0.0, curr_z, src)
                    else:
                        add_move("cut", x=cx, y=cy, z=curr_z, source=src)
                else:
                    # Generate concentric erosion rings from outside inward
                    rings_2d = []
                    current = machining_area
                    erosion = 0.0
                    max_erosions = 200
                    while not current.is_empty and max_erosions > 0:
                        max_erosions -= 1
                        if current.geom_type == "Polygon":
                            rings_2d.append(list(current.exterior.coords))
                        elif current.geom_type == "MultiPolygon":
                            for p in current.geoms:
                                rings_2d.append(list(p.exterior.coords))
                        erosion += stepover_val
                        current = current.buffer(-stepover_val, join_style=2)

                    # Reverse: cut from outermost ring inward toward center
                    rings_2d.reverse()

                    for ring in rings_2d:
                        if len(ring) < 2:
                            continue
                        # Move to first point of ring
                        add_move("cut", x=ring[0][0], y=ring[0][1], z=curr_z, source=src)
                        for px, py in ring[1:]:
                            add_move("cut", x=px, y=py, z=curr_z, source=src)

                add_move("retract_clearance", z=clearance, source=src)

            add_move("retract_clearance", z=clearance, source=src)

        # ----------------------------------------------------
        # 4. BOSS CLEARING STRATEGY (Offset Area Clearance)
        # ----------------------------------------------------
        elif src == "boss":
            stock = machine_config.get("setup", {}).get("resolvedStock", {}) if isinstance(machine_config, dict) else {}
            stock_dims = machine_config.get("stockDimensions") or machine_config.get("setup", {}).get("stockDimensions") if isinstance(machine_config, dict) else None
            
            machining_region = feature.get("machiningRegion", {})
            if not planning_context:
                validation_result["valid"] = False
                validation_result["errors"].append("Boss Clearing Planning Error: PlanningContext is required for Boss Clearing.")
                return [], validation_result

            region = planning_context.get_machining_region(feature.get("id", ""), tool_radius, "boss_clearing")
            safe_area = region.get("polygon")
            keepout_poly = region.get("keepout_polygon")
            machining_area = region.get("extended_machining_area")
            stock_poly = planning_context.get_stock_geometry()["polygon"]
            finish_allowance = operation.get("parameters", {}).get("finishAllowance", 0.5)

            feat_dia = float(
                feature.get("diameter")
                or (feature.get("dimensions") or {}).get("diameter")
                or feature.get("width")
                or 0.0
            )
            feat_r = feat_dia / 2.0 if feat_dia > 0 else 10.0
            
            # Bound the maximum stock radius so it tightly matches the workpiece diameter
            raw_stock_dia = float(
                stock.get("diameter")
                or stock.get("width")
                or (stock_dims[0] if stock_dims and len(stock_dims) > 0 and float(stock_dims[0]) > 0 else 0.0)
                or (feat_dia + 0.3 if feat_dia > 0 else 20.0)
            )
            turning_radial_allowance = min(1.0, max(0.15, feat_r * 0.25))
            stock_r = feat_r + turning_radial_allowance
            if raw_stock_dia > feat_dia and (raw_stock_dia / 2.0) < (feat_r + 2.0):
                stock_r = min(raw_stock_dia / 2.0, stock_r)

            is_turning_or_round = (
                op_type in ("od_turning", "turning", "od_finish_turning")
                or feat_type in ("external_cylinder", "cylinder")
                or str(feature.get("subtype", "")).lower() in ("turned_od", "cylinder")
            )
            
            if is_turning_or_round:
                # Direct circular passes starting tightly from stock_r down to feat_r
                add_move("rapid_clearance", z=clearance, source=src)
                for curr_z in z_passes:
                    curr_r = stock_r
                    while True:
                        add_move("retract_clearance", z=clearance, source=src)
                        add_move("rapid_xy", x=cx + curr_r, y=cy, z=clearance, source=src)
                        add_move("plunge", z=curr_z, source=src)
                        # Full circular pass as 4 true arc segments
                        _add_arc_segment(add_move, cx, cy, curr_r, curr_z, source=src)
                        add_move("retract_clearance", z=clearance, source=src)
                        if curr_r <= feat_r + 0.001:
                            break
                        curr_r = max(feat_r, curr_r - stepover_val)
            elif not region.get("is_valid", False) or safe_area is None or safe_area.is_empty or keepout_poly is None:
                # Robust Fallback: Shapely-based annular area clearance
                from shapely.geometry import Polygon as ShapelyPolygon, Point as ShapelyPoint

                # Build stock boundary polygon from feature dimensions
                stock_poly_fb = ShapelyPoint(cx, cy).buffer(stock_r, resolution=64)
                # Build boss keepout polygon from feature dimensions
                boss_poly_fb = ShapelyPoint(cx, cy).buffer(feat_r + tool_radius, resolution=64)
                # Annular machining region = stock - boss
                annular = stock_poly_fb.difference(boss_poly_fb)

                add_move("rapid_clearance", z=clearance, source=src)
                for curr_z in z_passes:
                    if annular.is_empty:
                        continue

                    # Generate concentric erosion rings within the annular region
                    rings_2d = []
                    current = annular
                    erosion = 0.0
                    max_erosions = 200
                    while not current.is_empty and max_erosions > 0:
                        max_erosions -= 1
                        if current.geom_type == "Polygon":
                            rings_2d.append(list(current.exterior.coords))
                        elif current.geom_type == "MultiPolygon":
                            for p in current.geoms:
                                rings_2d.append(list(p.exterior.coords))
                        erosion += stepover_val
                        current = current.buffer(-stepover_val, join_style=2)

                    rings_2d.reverse()

                    for ring in rings_2d:
                        if len(ring) < 2:
                            continue
                        add_move("retract_clearance", z=clearance, source=src)
                        add_move("approach_retract", x=ring[0][0], y=ring[0][1], z=clearance, source=src, segmentRole="approach")
                        add_move("plunge", z=curr_z, source=src)
                        add_move("cut", x=ring[0][0], y=ring[0][1], z=curr_z, source=src, segmentRole="lead_in")
                        for px, py in ring[1:]:
                            add_move("cut", x=px, y=py, z=curr_z, source=src)
                        add_move("cut", x=ring[0][0], y=ring[0][1], z=curr_z, source=src, segmentRole="lead_out")
                        add_move("retract_clearance", z=clearance, source=src)
            else:
                # Stage Validation 2: Manufacturing Strategy
                strategy = operation.get("machining_strategy", "offset_clearing")
                if strategy == "boss_clearing":
                    strategy = "offset_clearing"
                
                if strategy not in ("offset_clearing", "adaptive_clearing", "indexed_4axis_milling"):
                    strategy = "offset_clearing"

                # Traceability injection
                operation["traceability"] = feature.get("traceability", {}).copy()
                tool_info = operation.get("tool", {})
                operation["traceability"].update({
                    "selected_tool_id": tool_info.get("tool_id") or operation.get("tool_id") or operation.get("toolId", ""),
                    "tool_selection_reason": operation.get("parameters", {}).get("errorReason", "Automatic selection"),
                    "machining_strategy": strategy,
                    "feeds_and_speeds": operation.get("parameters", {}).get("feeds_and_speeds") or operation.get("feeds_and_speeds", {}),
                    "stepover": round(stepover_val, 3),
                    "stepdown": round(rough_stepdown, 3),
                    "finish_allowance": finish_allowance,
                    "machining_region_area": round(safe_area.area, 3),
                    "keepout_area": round(keepout_poly.area, 3),
                    "validation_result": "pending"
                })

                add_move("rapid_clearance", z=clearance, source=src)

                # Generate outward offsets from keepout
                rings = []
                current_offset = stepover_val
                max_iterations = 200
                while max_iterations > 0:
                    max_iterations -= 1
                    poly = keepout_poly.buffer(current_offset, join_style=2)
                    if poly.contains(stock_poly):
                        break
                    
                    # Robust Intersection: Use machining_area instead of safe_area to avoid precision dropping at boundary
                    boundary = poly.exterior.intersection(machining_area)
                    if boundary.is_empty:
                        pass
                    elif boundary.geom_type == "LineString":
                        rings.append([list(boundary.coords)])
                    elif boundary.geom_type == "MultiLineString":
                        rings.append([list(ls.coords) for ls in boundary.geoms])
                    else:
                        if hasattr(boundary, "coords"):
                            rings.append([list(boundary.coords)])
                            
                    current_offset += stepover_val

                # Reverse so we cut outside-in (from open air toward boss)
                rings.reverse()
                
                # Add the final profile pass along the keepout zone
                final_boundary = keepout_poly.exterior.intersection(machining_area)
                if final_boundary.geom_type == "LineString":
                    rings.append([list(final_boundary.coords)])
                elif final_boundary.geom_type == "MultiLineString":
                    rings.append([list(ls.coords) for ls in final_boundary.geoms])
                elif hasattr(final_boundary, "coords"):
                    rings.append([list(final_boundary.coords)])

                for curr_z in z_passes:
                    for ring_group in rings:
                        for seg in ring_group:
                            if len(seg) < 2: continue
                            
                            start_x, start_y = seg[0]
                            # Entry Strategy: Plunge outside stock safely (approach)
                            add_move("retract_clearance", z=clearance, source=src)
                            add_move("approach_retract", x=start_x, y=start_y, z=clearance, source=src, segmentRole="approach")
                            add_move("plunge", z=curr_z, source=src, segmentRole="plunge")
                            
                            for i, (px, py) in enumerate(seg[1:]):
                                role = "lead_in" if i == 0 else "cut"
                                if i == len(seg) - 2: role = "lead_out"
                                add_move("cut", x=px, y=py, z=curr_z, source=src, segmentRole=role)

                    add_move("retract_clearance", z=clearance, source=src)

                # Update traceability with final stats
                cutting_segments = [seg for seg in toolpaths if seg.get("source") == "boss" and seg.get("segmentRole") in ("cut", "lead_in", "lead_out")]
                cut_dist = 0.0
                for seg in cutting_segments:
                    s = seg.get("start", {})
                    e = seg.get("end", {})
                    dx = e.get("x", 0) - s.get("x", 0)
                    dy = e.get("y", 0) - s.get("y", 0)
                    cut_dist += math.sqrt(dx*dx + dy*dy)
                        
                operation["traceability"].update({
                    "num_offset_regions": len(rings),
                    "num_cutting_segments": len(cutting_segments),
                    "total_cutting_length": round(cut_dist, 3)
                })

        # ----------------------------------------------------
        # 5. 2D CONTOUR STRATEGY (Cutter Radius Compensated + Standoff)
        # ----------------------------------------------------
        elif src == "contour":
            stock = machine_config.get("setup", {}).get("resolvedStock", {}) if isinstance(machine_config, dict) else {}
            stock_def = machine_config.get("stockDefinition", {}) if isinstance(machine_config, dict) else {}
            stock_dims = machine_config.get("stockDimensions") or machine_config.get("setup", {}).get("stockDimensions") if isinstance(machine_config, dict) else None
            
            # Resolve feature diameter from multiple sources dynamically
            feat_diameter = float(
                feature.get("diameter") or feat_dims.get("diameter") or
                stock.get("diameter") or stock_def.get("diameter") or
                stock_def.get("cylinderDiameter") or 0.0
            )
            width = float(
                feature.get("width") or feat_diameter or
                stock.get("width") or
                (stock_dims[1] if stock_dims and len(stock_dims) > 1 else 0.0) or
                tool_dia * DEFAULT_CAM_PARAMS["contour_width_factor"]
            )
            length = float(
                feature.get("length") or feat_diameter or
                stock.get("length") or
                (stock_dims[0] if stock_dims and len(stock_dims) > 0 else 0.0) or
                tool_dia * DEFAULT_CAM_PARAMS["contour_width_factor"]
            )
            
            op_str = (
                str(operation.get("strategy", "")) + " " +
                str(operation.get("description", "")) + " " +
                str(operation.get("name", "")) + " " +
                str(operation.get("type", ""))
            ).lower()

            stock_type_str = str(machine_config.get("setup", {}).get("stockType", "")).lower() if isinstance(machine_config, dict) else ""
            stock_is_cylindrical = any(kw in stock_type_str for kw in ("cylinder", "round", "bar", "rod"))
            
            is_circular = (
                feat_type in CIRCULAR_FEATURE_TYPES
                or "cylinder" in feat_type or "shaft" in feat_type or "circle" in feat_type
                or ("cylinder" in str(feature.get("subtype", "")).lower())
                or ("shaft" in str(feature.get("name", "")).lower())
                or ("cylinder" in op_str or "shaft" in op_str or "external_cylinder" in op_str)
                or (feat_diameter > 0 and not feature.get("width"))
                or (stock_is_cylindrical and "rough" in str(feature.get("name", "")).lower())
            )

            add_move("rapid_clearance", z=clearance, source=src)

            finish_allowance = float(operation.get("parameters", {}).get("finishAllowance", 0.0) or 0.0)
            num_rough_contour_passes = len(z_passes) - finish_cuts if finish_cuts > 0 else len(z_passes)

            for pass_idx, curr_z in enumerate(z_passes):
                is_roughing_contour = pass_idx < num_rough_contour_passes
                fa = finish_allowance if is_roughing_contour else 0.0

                if is_circular:
                    feat_r = (float(feat_diameter or width) / 2.0)
                    r_cut = feat_r + tool_radius - fa
                    standoff_r = r_cut + (tool_radius * 1.5)
                    start_x = cx - standoff_r
                    start_y = cy

                    # Safe standoff entry point at clearance
                    add_move("retract_clearance", z=clearance, source=src)
                    add_move("rapid_xy", x=start_x, y=start_y, z=clearance, source=src)
                    add_move("plunge", z=curr_z, source=src)

                    # Tangent lead-in to cut radius
                    add_move("cut", x=cx - r_cut, y=cy, z=curr_z, source=src, segmentRole="lead_in")

                    # Full 360-degree circular contour as 4 true arc segments
                    _add_arc_segment(add_move, cx, cy, r_cut, curr_z, source=src)

                    # Tangent lead-out to standoff point
                    add_move("cut", x=start_x, y=start_y, z=curr_z, source=src, segmentRole="lead_out")
                    add_move("retract_clearance", z=clearance, source=src)

                else:
                    # Cutter radius compensation: Offset tool center OUTSIDE rectangular feature boundary
                    half_w = (width / 2.0) + tool_radius - fa
                    half_l = (length / 2.0) + tool_radius - fa

                    standoff = tool_radius * 1.5
                    start_x = cx - half_w - standoff
                    start_y = cy - half_l - standoff

                    # Safe standoff entry point at clearance
                    add_move("retract_clearance", z=clearance, source=src)
                    add_move("rapid_xy", x=start_x, y=start_y, z=clearance, source=src)
                    add_move("plunge", z=curr_z, source=src)

                    # Tangent lead-in to cut boundary
                    add_move("cut", x=cx - half_w, y=cy - half_l, z=curr_z, source=src)

                    # Clockwise contour loop around feature
                    add_move("cut", x=cx + half_w, y=cy - half_l, z=curr_z, source=src)
                    add_move("cut", x=cx + half_w, y=cy + half_l, z=curr_z, source=src)
                    add_move("cut", x=cx - half_w, y=cy + half_l, z=curr_z, source=src)
                    add_move("cut", x=cx - half_w, y=cy - half_l, z=curr_z, source=src)

                    # Tangent lead-out to standoff point
                    add_move("cut", x=start_x, y=start_y, z=curr_z, source=src)
                    add_move("retract_clearance", z=clearance, source=src)

            add_move("retract_clearance", z=clearance, source=src)

        # Fallback to guarantee toolpaths exist for any operation type
        if len(toolpaths) == 0:
            add_move("rapid_clearance", z=clearance, source="contour")
            add_move("rapid_xy", x=cx, y=cy, z=clearance, source="contour")
            add_move("plunge", z=bottom_z, source="contour")
            add_move("retract_clearance", z=clearance, source="contour")

        return toolpaths, validation_result
