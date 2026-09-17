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
        planning_context = planning_context or (machine_config.get("planning_context") if isinstance(machine_config, dict) else None)
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
        
        # Tool parameters — resolve diameter from operation or library with safe fallback
        tool = operation.get("tool", {}) or operation.get("selected_tool", {})
        raw_tool_dia = (
            tool.get("diameter")
            or tool.get("geometry", {}).get("diameter")
            or tool.get("diameter_mm")
            or operation.get("parameters", {}).get("tool_diameter")
            or operation.get("parameters", {}).get("toolDiameter")
        )
        if raw_tool_dia is None or float(raw_tool_dia) <= 0:
            tools_lib = machine_config.get("tools") or machine_config.get("tool_library") or []
            t_id = operation.get("tool_id") or operation.get("toolId")
            if t_id and tools_lib:
                match_t = next((t for t in tools_lib if (t.get("id") == t_id or t.get("tool_id") == t_id)), None)
                if match_t:
                    raw_tool_dia = match_t.get("diameter") or match_t.get("diameter_mm")
        if raw_tool_dia is None or float(raw_tool_dia) <= 0:
            raw_tool_dia = 6.0  # safe default fallback
        tool_dia = float(raw_tool_dia)
        tool_radius = tool_dia / 2.0

        # Determine strategy early so depth resolution can use it
        op_strat = str(operation.get("machining_strategy") or operation.get("strategy") or "").lower()
        src = "contour"
        if (
            feat_type in ("hole", "blind_hole", "through_hole", "bore")
            or op_type in ("drilling", "peck_drilling", "peck_drill", "drill", "boring", "id_boring", "reaming", "tapping", "tap", "helical_bore_milling", "hole")
            or op_strat in ("drilling", "peck_drilling", "boring", "tapping", "helical_bore_milling")
        ):
            src = "drill"
        elif (
            feat_type in ("pocket", "pocketing", "slot", "cavity", "recess", "keyway")
            or op_type in ("pocketing", "pocket_milling", "pocket", "slot_milling", "slot")
            or op_strat in ("pocketing", "pocket_milling", "slot_milling")
        ):
            src = "pocket"
        elif (
            feat_type in ("face", "facing")
            or op_type in ("facing", "face_milling", "face", "facing_turning", "lathe_facing")
            or op_strat in ("facing", "face_milling", "facing_turning", "zigzag", "one_way", "spiral")
        ):
            src = "face"
        elif (
            feat_type in ("boss", "cylinder", "external_cylinder")
            or op_type in ("boss_clearing", "od_turning", "turning", "od_finish_turning", "id_boring", "grooving", "parting_off", "parting", "boss")
            or op_strat in ("boss_clearing", "od_turning", "turning", "od_finish_turning")
        ):
            src = "boss"
        elif (
            feat_type in ("contour", "step", "side_protrusion")
            or op_type in ("2d_contour", "contour", "step", "2d_contour_outer", "chamfer_milling", "chamfer", "rotary_milling", "indexed_4axis_milling", "multi_axis_surface_milling")
            or op_strat in ("2d_contour", "contour", "2d_contour_outer", "chamfer_milling")
        ):
            src = "contour"

        # Feature geometry — resolve depth from the most precise source available.
        # Priority: setup_local_feature > feature dimensions > feature top-level
        #           > stock depth > centralized default.
        local_feat = operation.get("parameters", {}).get("setup_local_feature", {})
        feat_dims = feature.get("dimensions", {})
        mr = feature.get("machiningRegion", {}) if isinstance(feature.get("machiningRegion"), dict) else {}
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
            or feat_dims.get("height")
            or feature.get("depth")
            or feature.get("height")
        )
        if not resolved_depth or float(resolved_depth) <= 0:
            if local_feat.get("localTopZ") is not None and local_feat.get("localBottomZ") is not None:
                resolved_depth = abs(float(local_feat["localTopZ"]) - float(local_feat["localBottomZ"]))
            else:
                safe_h = operation.get("safe_heights", {})
                if safe_h.get("top") is not None and safe_h.get("bottom") is not None:
                    st, sb = float(safe_h["top"]), float(safe_h["bottom"])
                    if st != sb:
                        resolved_depth = abs(st - sb)
                elif src == "face":
                    resolved_depth = float(operation.get("parameters", {}).get("facingDepth") or 1.0)

        if resolved_depth is None or float(resolved_depth) <= 0:
            if stock_depth and float(stock_depth) > 0:
                resolved_depth = float(stock_depth)
            elif feat_dims.get("z_top") is not None and feat_dims.get("z_bottom") is not None:
                resolved_depth = abs(float(feat_dims["z_top"]) - float(feat_dims["z_bottom"]))
            elif mr.get("topZ") is not None and mr.get("bottomZ") is not None:
                resolved_depth = abs(float(mr["topZ"]) - float(mr["bottomZ"]))
            else:
                resolved_depth = 5.0
        depth = abs(float(resolved_depth))
        
        # Compute bottom_z from the feature's own depth, NOT from safe_heights.bottom.
        # safe_heights.bottom is the stock floor (safety limit), not the drill/pocket target.
        feature_bottom_z = top_z - depth
        
        # If setup_local_feature provides explicit localTopZ / localBottomZ, prefer those
        if local_feat.get("localTopZ") is not None and local_feat.get("localBottomZ") is not None:
            top_z = float(local_feat["localTopZ"])
            bottom_z = float(local_feat["localBottomZ"])
            depth = abs(top_z - bottom_z)
        elif safe_h.get("top") is not None and safe_h.get("bottom") is not None:
            top_z = float(safe_h["top"])
            bottom_z = float(safe_h["bottom"])
            depth = abs(top_z - bottom_z)
        else:
            feature_bottom_z = top_z - depth
            bottom_z = feature_bottom_z

        planning_ctx = planning_context or (machine_config.get("planning_context") if isinstance(machine_config, dict) else None)
        feat_id = feature.get("id", "")
        res_geom = planning_ctx.get_resolved_geometry(feat_id) if (planning_ctx and hasattr(planning_ctx, "get_resolved_geometry")) else None
        
        if res_geom and res_geom.center_3d:
            cx = float(res_geom.center_3d[0])
            cy = float(res_geom.center_3d[1])
            cz = float(res_geom.center_3d[2])
        else:
            center = feature.get("center", [0.0, 0.0, 0.0])
            cx = float(center[0]) if len(center) >= 1 else 0.0
            cy = float(center[1]) if len(center) >= 2 else 0.0
            cz = float(center[2]) if len(center) >= 3 else 0.0

        # Adjust top_z and bottom_z if authoritative resolved geometry in setup space is present
        if res_geom and res_geom.top_z_setup is not None and res_geom.bottom_z_setup is not None:
            rg_top = float(res_geom.top_z_setup)
            rg_bot = float(res_geom.bottom_z_setup)
            if rg_top <= 2.0:  # Valid setup-space coordinate (at or below setup top datum)
                top_z = rg_top
                bottom_z = rg_bot
        
        # Clamp: never cut below the stock floor or into the workpiece clamping/grip zone
        setup_dict = machine_config.get("setup", {}) if isinstance(machine_config, dict) else {}
        clamping_allowance = float(
            setup_dict.get("clampingAllowance")
            or setup_dict.get("stockOffsetBottom")
            or setup_dict.get("axialOffsetBottom")
            or (setup_dict.get("workholding", {}) if isinstance(setup_dict.get("workholding"), dict) else {}).get("clampingGrip")
            or 0.0
        )
        
        if clamping_allowance > 0 and (feat_type in ("contour", "step", "boss", "cylinder") or op_type in ("2d_contour", "2d_contour_outer", "contour", "boss_clearing", "od_turning")):
            res_stock = setup_dict.get("resolvedStock", {})
            if res_stock and "bounds" in res_stock and "min" in res_stock["bounds"]:
                stock_bot = float(res_stock["bounds"]["min"][2])
                safe_grip_floor = stock_bot + clamping_allowance
                bottom_z = max(bottom_z, safe_grip_floor)
                
        if bottom_z >= top_z:
            bottom_z = top_z - depth
            
        req_clearance = float(safe_h.get("clearance") or 15.0)
        clearance = max(req_clearance, top_z + 15.0)
        retract_z = max(float(safe_h.get("retract") or (top_z + 5.0)), top_z + 5.0)
        
        # Keep operation safe_heights in exact sync with generated toolpath heights
        safe_h["clearance"] = clearance
        safe_h["retract"] = retract_z
        safe_h["top"] = top_z
        safe_h["bottom"] = bottom_z
        operation["safe_heights"] = safe_h

        cursor = {"x": cx, "y": cy, "z": clearance}
        op_setup_id = operation.get("setup_id") or operation.get("setupId") or (machine_config.get("setup", {}).get("setupId") if isinstance(machine_config, dict) else None) or "setup_1"
        
        def add_move(move_type, x=None, y=None, z=None, source="contour", segmentRole=None):
            nonlocal cursor
            target_x = round(x if x is not None else cursor["x"], 4)
            target_y = round(y if y is not None else cursor["y"], 4)
            target_z = round(z if z is not None else cursor["z"], 4)

            # Defensive CAM safety invariant: rapid_xy is strictly a 2D planar motion (constant Z).
            # If a caller requests rapid_xy with a target Z differing from the current cursor Z,
            # safely decompose into vertical transition + planar rapid to prevent collisions.
            if move_type == "rapid_xy" and abs(target_z - cursor["z"]) > 0.001:
                if target_z > cursor["z"]:
                    retract_type = "retract_clearance" if target_z >= clearance - 0.001 else "approach_retract"
                    add_move(retract_type, z=target_z, source=source)
                    if abs(target_x - cursor["x"]) > 0.0001 or abs(target_y - cursor["y"]) > 0.0001:
                        add_move("rapid_xy", x=target_x, y=target_y, z=target_z, source=source, segmentRole=segmentRole)
                    return
                else:
                    if abs(target_x - cursor["x"]) > 0.0001 or abs(target_y - cursor["y"]) > 0.0001:
                        add_move("rapid_xy", x=target_x, y=target_y, z=cursor["z"], source=source, segmentRole=segmentRole)
                    add_move("approach_retract", x=target_x, y=target_y, z=target_z, source=source)
                    return

            new_pos = {
                "x": target_x,
                "y": target_y,
                "z": target_z
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
                    "setupId": op_setup_id,
                    "source": source,
                    "coordinateSpace": "SETUP",
                    "units": "mm",
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

        def add_arc_move(center_x, center_y, end_x, end_y, z, clockwise=True, source="contour", segmentRole=None, plane="XY", center_z=None, radius_val=None):
            nonlocal cursor
            new_pos = {"x": round(end_x, 4), "y": round(end_y, 4), "z": round(z, 4)}
            if len(toolpaths) == 0 or (new_pos["x"] != cursor["x"] or new_pos["y"] != cursor["y"] or new_pos["z"] != cursor["z"]):
                if radius_val is not None and float(radius_val) > 0:
                    radius = float(radius_val)
                elif plane == "XZ" and center_z is not None:
                    radius = math.hypot(end_x - center_x, z - center_z)
                else:
                    radius = math.hypot(end_x - center_x, end_y - center_y)
                
                # Guard against zero-radius arcs (degenerate geometry)
                if radius < 1e-6:
                    return
                    
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
                    "setupId": op_setup_id,
                    "source": source,
                    "coordinateSpace": "SETUP",
                    "units": "mm",
                    "start": cursor.copy(),
                    "end": new_pos.copy(),
                    "x": new_pos["x"],
                    "y": new_pos["y"],
                    "z": new_pos["z"],
                    "center": {"x": round(center_x, 4), "y": round(center_y, 4), "z": round(center_z if center_z is not None else cursor["z"], 4)},
                    "radius": round(radius, 4),
                    "clockwise": clockwise,
                    "plane": plane,
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
                
        if feat_type in ("hole", "blind_hole", "through_hole") or op_type in ("drilling", "peck_drilling"):
            rough_stepdown = tool_dia * 1.5
        elif op_type in ("helical_bore_milling", "boring") or feat_type == "bore":
            rough_stepdown = min(tool_dia * 0.5, 2.0)
            
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

                # Helical spiral down using 4 quadrant circular arcs per turn with continuous Z pitch
                orbit_circ = 2.0 * math.pi * max(bore_radius, 0.5)
                max_helical_pitch = min(rough_stepdown, max(orbit_circ * math.tan(math.radians(2.5)), 1.5))
                num_turns = max(1, math.ceil(depth / max_helical_pitch))
                z_per_turn = depth / num_turns

                for turn in range(num_turns):
                    turn_start_z = top_z - (turn * z_per_turn)
                    turn_end_z = max(bottom_z, top_z - ((turn + 1) * z_per_turn))
                    z_step = (turn_end_z - turn_start_z) / 4.0

                    # 4 Quadrants (CW): (cx, cy - R) -> (cx - R, cy) -> (cx, cy + R) -> (cx + R, cy)
                    add_arc_move(cx, cy, cx, cy - bore_radius, turn_start_z + z_step, clockwise=True, source=src, plane="XY")
                    add_arc_move(cx, cy, cx - bore_radius, cy, turn_start_z + 2 * z_step, clockwise=True, source=src, plane="XY")
                    add_arc_move(cx, cy, cx, cy + bore_radius, turn_start_z + 3 * z_step, clockwise=True, source=src, plane="XY")
                    add_arc_move(cx, cy, cx + bore_radius, cy, turn_end_z, clockwise=True, source=src, plane="XY")

                # Full 360-degree flat finish pass at bottom
                _add_arc_segment(add_move, cx, cy, bore_radius, bottom_z, source=src)

                # Lead-out to center
                add_move("cut", x=cx, y=cy, z=bottom_z, source=src, segmentRole="lead_out")
                add_move("retract_clearance", z=clearance, source=src)

        # ----------------------------------------------------
        # 2. FACING STRATEGY (Multi-Pass Raster or Circular)
        # ----------------------------------------------------
        elif src == "face":
            ctx_machine = getattr(planning_context, "machine_profile", {}) or {} if planning_context else {}
            machine_type_str = ""
            if isinstance(ctx_machine, dict):
                machine_type_str = str(ctx_machine.get("machine_type", "")).lower()
            elif hasattr(ctx_machine, "machine_type"):
                machine_type_str = str(ctx_machine.machine_type).lower()
            if not machine_type_str and isinstance(machine_config, dict):
                machine_type_str = str(machine_config.get("machine_type") or machine_config.get("setup", {}).get("machineType") or "").lower()

            is_lathe_machine = (
                op_type in ("od_turning", "od_finish_turning", "facing_turning", "id_boring", "grooving", "parting_off")
                or any(kw in machine_type_str for kw in ("lathe", "turning", "swiss"))
            )

            if not is_lathe_machine and not planning_context:
                validation_result["valid"] = False
                validation_result["errors"].append("Facing Planning Error: PlanningContext is required for Face Milling.")
                return [], validation_result

            stock_geom = planning_context.get_stock_geometry() if planning_context else {}
            bounds = stock_geom.get("bounds", [])
            if not bounds or len(bounds) < 4:
                # Fallback to machine_config stock dimensions or feature dimensions
                s_dims = (machine_config.get("stockDimensions") or [20.0, 20.0, 20.0]) if isinstance(machine_config, dict) else [20.0, 20.0, 20.0]
                min_x, min_y, max_x, max_y = -s_dims[0]/2.0, -s_dims[1]/2.0, s_dims[0]/2.0, s_dims[1]/2.0
            else:
                min_x, min_y, max_x, max_y = bounds[0], bounds[1], bounds[2], bounds[3]

            stock_w = max_x - min_x
            stock_l = max_y - min_y
            cx = min_x + (stock_w / 2.0)
            cy = min_y + (stock_l / 2.0)

            # Identify if we need circular facing
            ctx_setup = getattr(planning_context, "setup", {}) or {} if planning_context else {}
            is_cylindrical_face = (
                stock_geom.get("provenance", {}).get("derived_from", "") in CYLINDRICAL_STOCK_TYPES
                or (isinstance(ctx_setup, dict) and str(ctx_setup.get("stockType", "")).lower() in CYLINDRICAL_STOCK_TYPES)
                or is_lathe_machine
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
                "stepdown": round(rough_stepdown, 3),
                "validation_result": "pending"
            })

            add_move("rapid_clearance", z=clearance, source=src)
            
            if is_lathe_machine:
                # 2-Axis CNC Lathe Facing: Tool approaches at stock radius in X and cuts across front face to X <= 0
                face_z = bottom_z if bottom_z < top_z else top_z
                stock_r = (stock_dia / 2.0) if stock_dia > 0 else (tool_dia + 2.0)
                add_move("rapid_xy", x=stock_r + 2.0, y=0.0, z=clearance, source=src)
                add_move("approach_retract", x=stock_r + 1.0, y=0.0, z=face_z + 1.0, source=src)
                add_move("plunge", x=stock_r + 1.0, y=0.0, z=face_z, source=src)
                add_move("cut", x=-0.8, y=0.0, z=face_z, source=src) # cut past center
                add_move("approach_retract", x=-0.8, y=0.0, z=face_z + 2.0, source=src)
                add_move("retract_clearance", x=stock_r + 2.0, y=0.0, z=clearance, source=src)

            elif is_cylindrical_face and stock_dia > 0:
                # Circular milling facing: raster across the circular cross-section
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
            planning_ctx = planning_context or (machine_config.get("planning_context") if isinstance(machine_config, dict) else None)
            feat_id = feature.get("id", "")
            pocket_poly = planning_ctx.get_feature_polygon(feat_id) if (planning_ctx and hasattr(planning_ctx, "get_feature_polygon")) else None

            dims = feature.get("dimensions") if isinstance(feature.get("dimensions"), dict) else {}
            mr = feature.get("machiningRegion") if isinstance(feature.get("machiningRegion"), dict) else {}

            is_circular = (
                feat_type in CIRCULAR_FEATURE_TYPES
                or "cylinder" in feat_type or "shaft" in feat_type or "circle" in feat_type
                or ("cylinder" in str(feature.get("subtype", "")).lower())
                or ("circular" in str(feature.get("subtype", "")).lower())
                or ("shaft" in str(feature.get("name", "")).lower())
                or bool(feature.get("is_circular"))
                or (feature.get("diameter") is not None and float(feature.get("diameter") or 0) > 0)
                or (dims.get("diameter") is not None and float(dims.get("diameter") or 0) > 0)
            )

            width = float(feature.get("width") or dims.get("width") or mr.get("width") or 0.0)
            dia = float(feature.get("diameter") or dims.get("diameter") or mr.get("diameter") or 0.0)
            if width <= 0 and dia > 0:
                width = dia
            length = float(feature.get("length") or dims.get("length") or mr.get("length") or width or 0.0)
            if length <= 0 and width > 0:
                length = width

            if pocket_poly is not None and not pocket_poly.is_empty:
                b = pocket_poly.bounds
                if width <= 0: width = b[2] - b[0]
                if length <= 0: length = b[3] - b[1]
            else:
                mr_boundary = mr.get("boundary") or feature.get("boundaryPoints")
                if mr_boundary and len(mr_boundary) >= 3:
                    try:
                        xs = [p[0] for p in mr_boundary if isinstance(p, (list, tuple)) and len(p) >= 2]
                        ys = [p[1] for p in mr_boundary if isinstance(p, (list, tuple)) and len(p) >= 2]
                        if xs and ys:
                            width = max(xs) - min(xs)
                            length = max(ys) - min(ys)
                            pocket_poly = ShapelyPolygon([(xs[i], ys[i]) for i in range(len(xs))])
                    except Exception:
                        pass

                if width <= 0 and length <= 0 and (pocket_poly is None or pocket_poly.is_empty):
                    raise ValueError(f"FEATURE_GEOMETRY_UNAVAILABLE: Pocket feature '{feat_id}' lacks resolved 2D/3D polygon and explicit dimensions")

                if width <= 0: width = 20.0
                if length <= 0: length = 20.0

                pocket_radius = max(width, length) / 2.0
                if pocket_poly is None or pocket_poly.is_empty:
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

            finish_allowance = float(operation.get("parameters", {}).get("finishAllowance", 0.0) or 0.0)
            add_move("rapid_clearance", z=clearance, source=src)

            num_rough_passes = len(z_passes) - finish_cuts if finish_cuts > 0 else len(z_passes)

            for pass_idx, curr_z in enumerate(z_passes):
                # For roughing passes, erode pocket by finish_allowance to leave stock
                # For finishing passes, cut to final geometry
                is_roughing = pass_idx < num_rough_passes
                effective_poly = pocket_poly
                if is_roughing and finish_allowance > 0:
                    effective_poly = pocket_poly.buffer(-finish_allowance, join_style=2)

                machining_area = effective_poly.buffer(-tool_radius, join_style=2)
                if machining_area.is_empty:
                    return toolpaths, {
                        "valid": False,
                        "error": f"TOOL_TOO_LARGE_FOR_GEOMETRY: Tool diameter ({round(tool_dia, 2)}mm) cannot fit inside pocket region '{feat_id}'"
                    }

                # Generate concentric erosion rings from outside inward
                rings_2d = []
                current = machining_area
                max_erosions = 200
                while not current.is_empty and max_erosions > 0:
                    max_erosions -= 1
                    if current.geom_type == "Polygon":
                        rings_2d.append(list(current.exterior.coords))
                        for interior in current.interiors:
                            rings_2d.append(list(interior.coords))
                    elif current.geom_type == "MultiPolygon":
                        for p in current.geoms:
                            rings_2d.append(list(p.exterior.coords))
                            for interior in p.interiors:
                                rings_2d.append(list(interior.coords))
                    current = current.buffer(-stepover_val, join_style=2)

                if not rings_2d:
                    return toolpaths, {
                        "valid": False,
                        "error": f"TOOL_TOO_LARGE_FOR_GEOMETRY: Tool diameter ({round(tool_dia, 2)}mm) cannot clear pocket region '{feat_id}'"
                    }

                # Cut from outermost ring inward toward center
                rings_2d.reverse()

                # Plunge safely at the first point of the outer cutting ring
                start_pt = rings_2d[0][0]
                add_move("retract_clearance", z=clearance, source=src)
                add_move("rapid_xy", x=start_pt[0], y=start_pt[1], z=clearance, source=src)
                approach_z = max(top_z + 1.0, curr_z + 1.0)
                if approach_z < clearance:
                    add_move("approach_retract", z=approach_z, source=src, segmentRole="approach")
                add_move("plunge", z=curr_z, source=src)

                for ring in rings_2d:
                    if len(ring) < 2:
                        continue
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
            finish_allowance = operation.get("parameters", {}).get("finishAllowance", 0.5)

            # Robust multi-source diameter derivation for boss features
            feat_dia = 0.0
            if feature.get("diameter") is not None and float(feature.get("diameter") or 0.0) > 0:
                feat_dia = float(feature["diameter"])
            elif (feature.get("dimensions") or {}).get("diameter") is not None and float((feature.get("dimensions") or {}).get("diameter") or 0.0) > 0:
                feat_dia = float(feature["dimensions"]["diameter"])
            elif feature.get("radius") is not None and float(feature.get("radius") or 0.0) > 0:
                feat_dia = float(feature["radius"]) * 2.0
            elif (feature.get("dimensions") or {}).get("radius") is not None and float((feature.get("dimensions") or {}).get("radius") or 0.0) > 0:
                feat_dia = float(feature["dimensions"]["radius"]) * 2.0
            elif (feature.get("machiningRegion") or {}).get("diameter") is not None and float((feature.get("machiningRegion") or {}).get("diameter") or 0.0) > 0:
                feat_dia = float(feature["machiningRegion"]["diameter"])
            elif (feature.get("machiningRegion") or {}).get("radius") is not None and float((feature.get("machiningRegion") or {}).get("radius") or 0.0) > 0:
                feat_dia = float(feature["machiningRegion"]["radius"]) * 2.0
            elif feature.get("width") is not None and float(feature.get("width") or 0.0) > 0:
                feat_dia = float(feature["width"])
            elif (feature.get("dimensions") or {}).get("width") is not None and float((feature.get("dimensions") or {}).get("width") or 0.0) > 0:
                feat_dia = float(feature["dimensions"]["width"])

            # If diameter is still not resolved, try deriving from islands / boundary contours
            if feat_dia <= 0:
                islands = (feature.get("machiningRegion") or {}).get("islands") or []
                if islands and len(islands) > 0 and len(islands[0]) >= 3:
                    pts = islands[0]
                    xs = [p[0] for p in pts if isinstance(p, (list, tuple)) and len(p) >= 2]
                    ys = [p[1] for p in pts if isinstance(p, (list, tuple)) and len(p) >= 2]
                    if xs and ys:
                        feat_dia = max(max(xs) - min(xs), max(ys) - min(ys))

            # Bound the maximum stock radius so it tightly matches the workpiece diameter
            raw_stock_dia = float(
                stock.get("diameter")
                or stock.get("width")
                or (stock_dims[0] if stock_dims and len(stock_dims) > 0 and float(stock_dims[0]) > 0 else 0.0)
                or 0.0
            )

            # Final safe fallback if workpiece has no geometric diameter metadata
            if feat_dia <= 0:
                if raw_stock_dia > 0:
                    feat_dia = raw_stock_dia * 0.8
                else:
                    feat_dia = 20.0

            feat_r = feat_dia / 2.0
            if raw_stock_dia <= 0:
                raw_stock_dia = feat_dia + 0.3

            turning_radial_allowance = min(1.0, max(0.15, feat_r * 0.25))
            stock_r = feat_r + turning_radial_allowance
            if raw_stock_dia > feat_dia and (raw_stock_dia / 2.0) < (feat_r + 2.0):
                stock_r = min(raw_stock_dia / 2.0, stock_r)

            ctx_machine = getattr(planning_context, "machine_profile", {}) or {}
            machine_type_str = ""
            if isinstance(ctx_machine, dict):
                machine_type_str = str(ctx_machine.get("machine_type", "")).lower()
            elif hasattr(ctx_machine, "machine_type"):
                machine_type_str = str(ctx_machine.machine_type).lower()
            if not machine_type_str and isinstance(machine_config, dict):
                machine_type_str = str(machine_config.get("machine_type") or machine_config.get("setup", {}).get("machineType") or "").lower()

            is_lathe_op = op_type in ("od_turning", "od_finish_turning", "facing_turning", "id_boring", "grooving", "parting_off")
            is_lathe_machine = is_lathe_op

            is_turning_or_round = (
                is_lathe_op
                or feat_type in ("external_cylinder", "cylinder")
                or str(feature.get("subtype", "")).lower() in ("turned_od", "cylinder")
            )

            if not is_lathe_machine and not is_turning_or_round:
                if not planning_context:
                    validation_result["valid"] = False
                    validation_result["errors"].append("Boss Clearing Planning Error: PlanningContext is required for Boss Clearing.")
                    return [], validation_result

                region = planning_context.get_machining_region(feature.get("id", ""), tool_radius, "boss_clearing")
                safe_area = region.get("polygon")
                keepout_poly = region.get("keepout_polygon")
                machining_area = region.get("extended_machining_area")
                stock_poly = planning_context.get_stock_geometry()["polygon"]
            else:
                region, safe_area, keepout_poly, machining_area, stock_poly = {}, None, None, None, None
            
            if is_lathe_machine:
                # ----------------------------------------------------
                # 2-AXIS CNC LATHE OD TURNING (XZ Plane)
                # ----------------------------------------------------
                corner_r = float(feature.get("corner_radius") or feature.get("dimensions", {}).get("corner_radius") or 0.0)
                fillet_r = float(feature.get("fillet_radius") or feature.get("dimensions", {}).get("fillet_radius") or 0.0)
                
                is_finishing = (op_type == "od_finish_turning" or "finish" in str(operation.get("machining_strategy", "")).lower())
                
                if is_finishing:
                    # Profile Finishing Pass in XZ Plane
                    start_x = max(0.0, feat_r - corner_r)
                    add_move("rapid_clearance", z=clearance, source=src)
                    add_move("rapid_xy", x=start_x, y=0.0, z=clearance, source=src)
                    add_move("approach_retract", x=start_x, y=0.0, z=top_z + 1.0, source=src)
                    add_move("plunge", x=start_x, y=0.0, z=top_z, source=src)
                    
                    # 1. Nose radius / tip blend
                    if corner_r > 0:
                        add_arc_move(center_x=start_x, center_y=0.0, end_x=feat_r, end_y=0.0, z=top_z - corner_r, clockwise=False, source=src, segmentRole="lead_in", plane="XZ", center_z=top_z, radius_val=corner_r)
                    else:
                        add_move("cut", x=feat_r, y=0.0, z=top_z, source=src)
                        
                    # 2. Cylindrical body cut
                    turn_end_z = bottom_z + fillet_r if fillet_r > 0 else bottom_z
                    add_move("cut", x=feat_r, y=0.0, z=turn_end_z, source=src)
                    
                    # 3. Shoulder fillet transition
                    if fillet_r > 0:
                        add_arc_move(center_x=feat_r + fillet_r, center_y=0.0, end_x=feat_r + fillet_r, end_y=0.0, z=bottom_z, clockwise=True, source=src, plane="XZ", center_z=turn_end_z, radius_val=fillet_r)
                        add_move("cut", x=feat_r + fillet_r + 0.8, y=0.0, z=bottom_z, source=src)
                    else:
                        # 45 deg pull-off
                        add_move("cut", x=feat_r + 0.8, y=0.0, z=bottom_z + 0.8, source=src)
                        
                    add_move("retract_clearance", x=stock_r + 2.0, y=0.0, z=clearance, source=src)
                else:
                    # Stepped OD Roughing Passes in XZ Plane (strictly bounded within [top_z, bottom_z])
                    r_start = stock_r
                    r_target = feat_r + (finish_allowance if finish_allowance > 0 else 0.2)
                    doc = rough_stepdown if rough_stepdown > 0 and rough_stepdown < (r_start - r_target) else min(1.0, max(0.2, (r_start - r_target) * 0.5))
                    
                    add_move("rapid_clearance", z=clearance, source=src)
                    curr_r = r_start
                    while curr_r > r_target + 0.001:
                        curr_r = max(r_target, curr_r - doc)
                        # Retract to clearance along Z before traversing in X
                        add_move("retract_clearance", z=clearance, source=src)
                        # Rapid approach in X at clearance
                        add_move("rapid_xy", x=curr_r + 1.0, y=0.0, z=clearance, source=src)
                        add_move("approach_retract", x=curr_r, y=0.0, z=top_z + 0.5, source=src)
                        add_move("plunge", x=curr_r, y=0.0, z=top_z, source=src)
                        # Linear turning cut to feature step depth
                        add_move("cut", x=curr_r, y=0.0, z=bottom_z, source=src)
                        # 45-degree pull-off chamfer
                        add_move("cut", x=curr_r + 0.5, y=0.0, z=bottom_z + 0.5, source=src)
                        # Pull off radially in X to clear stock shoulder before axial rapid
                        add_move("cut", x=stock_r + 1.0, y=0.0, z=bottom_z + 0.5, source=src, segmentRole="lead_out")
                        # Rapid traverse along Z back to clearance
                        add_move("retract_clearance", x=stock_r + 1.0, y=0.0, z=clearance, source=src)
                    add_move("retract_clearance", x=stock_r + 2.0, y=0.0, z=clearance, source=src)

            elif is_turning_or_round:
                # Direct circular milling passes strictly bounded from top_z to bottom_z
                add_move("rapid_clearance", z=clearance, source=src)
                for curr_z in z_passes:
                    curr_r = stock_r
                    while True:
                        add_move("retract_clearance", z=clearance, source=src)
                        add_move("rapid_xy", x=cx + curr_r, y=cy, z=clearance, source=src)
                        # Rapid approach close to cutting level before plunge to avoid air-cutting
                        add_move("approach_retract", x=cx + curr_r, y=cy, z=min(clearance, curr_z + 1.0), source=src)
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
                            approach_z = max(top_z + 1.0, curr_z + 1.0)
                            if approach_z < clearance:
                                add_move("approach_retract", x=start_x, y=start_y, z=approach_z, source=src, segmentRole="approach")
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
            planning_ctx = planning_context or (machine_config.get("planning_context") if isinstance(machine_config, dict) else None)
            feat_id = feature.get("id", "")
            contour_poly = planning_ctx.get_feature_polygon(feat_id) if (planning_ctx and hasattr(planning_ctx, "get_feature_polygon")) else None
            if (contour_poly is None or contour_poly.is_empty) and (planning_ctx and hasattr(planning_ctx, "get_outer_contour_polygon")):
                contour_poly = planning_ctx.get_outer_contour_polygon()

            width = float(feature.get("width") or feat_dims.get("width") or feat_diameter or 0.0)
            length = float(feature.get("length") or feat_dims.get("length") or feat_diameter or width or 0.0)
            
            if (contour_poly is None or contour_poly.is_empty) and (width <= 0 or length <= 0):
                mr_boundary = (feature.get("machiningRegion") or {}).get("boundary") or feature.get("boundaryPoints")
                if mr_boundary and len(mr_boundary) >= 3:
                    try:
                        from shapely.geometry import Polygon as ShapelyPolygon
                        xs = [p[0] for p in mr_boundary if isinstance(p, (list, tuple)) and len(p) >= 2]
                        ys = [p[1] for p in mr_boundary if isinstance(p, (list, tuple)) and len(p) >= 2]
                        if xs and ys:
                            width = max(xs) - min(xs)
                            length = max(ys) - min(ys)
                            contour_poly = ShapelyPolygon([(xs[i], ys[i]) for i in range(len(xs))])
                    except Exception:
                        pass
                if (contour_poly is None or contour_poly.is_empty) and (width <= 0 or length <= 0):
                    # Check if stock dimensions can bound outer contour
                    if stock_dims and len(stock_dims) >= 2 and stock_dims[0] > 0 and stock_dims[1] > 0:
                        width = float(stock_dims[1])
                        length = float(stock_dims[0])
                    elif stock.get("width") and stock.get("length"):
                        width = float(stock["width"])
                        length = float(stock["length"])
                    else:
                        width = 50.0
                        length = 50.0
            
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

                elif contour_poly and not contour_poly.is_empty:
                    # Generic Cutter radius compensation for arbitrary topological profile
                    poly_cut = contour_poly.buffer(tool_radius - fa, join_style=2)
                    if poly_cut.is_valid and not poly_cut.is_empty:
                        coords = list(poly_cut.exterior.coords) if poly_cut.geom_type == "Polygon" else list(poly_cut.geoms[0].exterior.coords)
                        if len(coords) >= 3:
                            p0 = coords[0]
                            # Standoff entry
                            dx = p0[0] - cx
                            dy = p0[1] - cy
                            d_mag = math.sqrt(dx*dx + dy*dy) or 1.0
                            standoff = tool_radius * 1.5
                            start_x = p0[0] + (dx / d_mag) * standoff
                            start_y = p0[1] + (dy / d_mag) * standoff

                            add_move("retract_clearance", z=clearance, source=src)
                            add_move("rapid_xy", x=start_x, y=start_y, z=clearance, source=src)
                            approach_z = max(top_z + 1.0, curr_z + 1.0)
                            if approach_z < clearance:
                                add_move("approach_retract", z=approach_z, source=src, segmentRole="approach")
                            add_move("plunge", z=curr_z, source=src)

                            # Lead-in
                            add_move("cut", x=p0[0], y=p0[1], z=curr_z, source=src, segmentRole="lead_in")

                            # Trace actual profile contour
                            for pt in coords[1:]:
                                add_move("cut", x=pt[0], y=pt[1], z=curr_z, source=src)

                            # Lead-out
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
                    approach_z = max(top_z + 1.0, curr_z + 1.0)
                    if approach_z < clearance:
                        add_move("approach_retract", z=approach_z, source=src, segmentRole="approach")
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

        from app.services.validation.gcode_safety_validator import GCodeSafetyValidator
        toolpaths = GCodeSafetyValidator.sanitize_toolpath_segments(toolpaths, clearance)

        return toolpaths, validation_result
