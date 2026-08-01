import math
from typing import Dict, Any, List

class ParametricToolpathEngine:
    """
    Generates physically accurate, production-grade CAM toolpaths from parametric features:
    - Multi-pass facing rasters with 70% tool stepover and stock overhang.
    - Concentric spiral / raster pocket clearing (center outward to walls) without unmachined islands.
    - 2D contour & boss clearing with cutter radius compensation, standoff lead-in/lead-out, and multi-depth stepdown passes.
    - Drilling cycles with peck-drilling (G83) for deep holes and helical interpolation for larger bores.
    """
    def generate_toolpath(self, operation: Dict[str, Any], feature: Dict[str, Any], machine_config: Dict[str, Any]) -> List[Dict[str, Any]]:
        toolpaths = []
        op_type = str(operation.get("type") or operation.get("operation_type") or "").lower()
        op_id = operation.get("id", "")
        feat_type = str(feature.get("type", "")).lower()

        # -----------------------------------------------------------------
        # Unified Stock Resolution
        # The machine_config may arrive in different shapes depending on
        # whether it was forwarded from camSetup (top-level keys) or from
        # cam_pipeline_manager (nested resolvedStock / setup sub-object).
        # We normalize everything into a single _stock dict once.
        # -----------------------------------------------------------------
        mc = machine_config if isinstance(machine_config, dict) else {}
        _nested_setup = mc.get("setup", {}) if isinstance(mc.get("setup"), dict) else {}
        _resolved = mc.get("resolvedStock") or _nested_setup.get("resolvedStock") or {}

        # Stock type
        _stock_type = str(
            mc.get("stockType") or _nested_setup.get("stockType") or
            _resolved.get("stockType") or _resolved.get("type") or ""
        ).lower()
        _stock_is_cyl = any(kw in _stock_type for kw in ("cylinder", "round", "bar", "rod"))

        # Stock dimensions array — camSetup sends this at the top level
        _stock_dims = mc.get("stockDimensions") or _nested_setup.get("stockDimensions")
        if _stock_dims and not isinstance(_stock_dims, (list, tuple)):
            _stock_dims = None

        # Stock definition (for explicit diameter keys)
        _stock_def = mc.get("stockDefinition", {}) if isinstance(mc.get("stockDefinition"), dict) else {}

        # Resolve cylinder diameter from multiple sources
        _cyl_dia = float(
            mc.get("cylinderDiameter") or _nested_setup.get("cylinderDiameter") or
            _resolved.get("diameter") or _stock_def.get("diameter") or
            _stock_def.get("cylinderDiameter") or
            (_stock_dims[0] if _stock_is_cyl and _stock_dims and len(_stock_dims) > 0 else 0.0) or
            0.0
        )

        # Resolve width, length from resolvedStock → stockDimensions → 0
        _stock_w = float(
            _resolved.get("width") or
            (_stock_dims[0] if _stock_dims and len(_stock_dims) > 0 else 0.0) or
            0.0
        )
        _stock_l = float(
            _resolved.get("length") or
            (_stock_dims[1] if _stock_dims and len(_stock_dims) > 1 else 0.0) or
            0.0
        )
        _stock_h = float(
            _resolved.get("height") or
            (_stock_dims[2] if _stock_dims and len(_stock_dims) > 2 else 0.0) or
            0.0
        )
        
        # Stock center
        _stock_center = mc.get("stockCenter") or _nested_setup.get("stockCenter")
        if not _stock_center and _resolved.get("bounds"):
            bmin = _resolved["bounds"].get("min")
            bmax = _resolved["bounds"].get("max")
            if bmin and bmax and len(bmin) >= 3 and len(bmax) >= 3:
                _stock_center = [
                    (bmin[0] + bmax[0]) / 2.0,
                    (bmin[1] + bmax[1]) / 2.0,
                    (bmin[2] + bmax[2]) / 2.0
                ]
        if not _stock_center or not isinstance(_stock_center, (list, tuple)) or len(_stock_center) < 3:
            _stock_center = [0.0, 0.0, 0.0]

        # Build a canonical stock dict that every strategy can reference
        _stock = {
            "type": _stock_type,
            "is_cylindrical": _stock_is_cyl,
            "diameter": _cyl_dia,
            "width": _stock_w,
            "length": _stock_l,
            "height": _stock_h,
            "dims": _stock_dims,
            "center": _stock_center,
        }
        
        # Safe height parameters
        safe_h = operation.get("safe_heights", {})
        clearance = float(safe_h.get("clearance") or 10.0)
        retract_z = float(safe_h.get("retract") or (clearance - 5.0))
        top_z = float(safe_h.get("top") or 0.0)
        
        # Tool parameters
        tool = operation.get("tool", {})
        tool_dia = float(tool.get("diameter") or tool.get("diameter_mm") or 6.35)
        if tool_dia <= 0: tool_dia = 6.35
        tool_radius = tool_dia / 2.0
        
        # Feature geometry — resolve depth from the most precise source available
        # Priority: setup_local_feature > feature dimensions > feature top-level > fallback
        local_feat = operation.get("parameters", {}).get("setup_local_feature", {})
        feat_dims = feature.get("dimensions", {})
        
        depth = abs(float(
            local_feat.get("depth") or
            feat_dims.get("depth") or
            feature.get("depth") or
            feature.get("height") or
            10.0
        ))
        
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

        # Determine strategy early so we can adjust center for facing if needed
        src = "contour"
        if feat_type in ("hole", "blind_hole", "through_hole", "bore") or op_type in ("drilling", "peck_drilling", "boring", "reaming", "tapping"):
            src = "drill"
        elif feat_type in ("pocket", "pocketing") or op_type in ("pocketing", "pocket_milling", "slot_milling"):
            src = "pocket"
        elif feat_type in ("face", "facing") or op_type in ("facing", "face_milling"):
            src = "face"
        elif feat_type in ("boss", "cylinder", "contour", "external_cylinder") or op_type in ("2d_contour", "2d_contour_outer", "contour", "boss_clearing", "chamfer_milling"):
            src = "contour"

        if src == "face":
            feat_has_diameter = bool(feat_dims.get("diameter") or feature.get("diameter"))
            feat_has_width = bool(feat_dims.get("width") or feature.get("width"))
            # If the feature has no width/diameter, we are facing the entire stock.
            # In this case, align the facing center to the stock center, not the CAD origin.
            if not feat_has_diameter and not feat_has_width and _stock.get("center"):
                cx = float(_stock["center"][0])
                cy = float(_stock["center"][1])

        # Adjust top_z if cz is valid and safe_h wasn't explicitly set
        if "top" not in safe_h and len(center) >= 3 and abs(cz) > 0.001:
            top_z = cz
            bottom_z = top_z - depth
            clearance = top_z + 10.0
            retract_z = top_z + 3.0

        cursor = {"x": cx, "y": cy, "z": clearance}
        
        def add_move(move_type, x=None, y=None, z=None, source="contour"):
            nonlocal cursor
            new_pos = {
                "x": round(x if x is not None else cursor["x"], 4),
                "y": round(y if y is not None else cursor["y"], 4),
                "z": round(z if z is not None else cursor["z"], 4)
            }
            if len(toolpaths) == 0 or (new_pos["x"] != cursor["x"] or new_pos["y"] != cursor["y"] or new_pos["z"] != cursor["z"]):
                # Determine feedrate based on move type
                feedrate = 0.0
                if move_type in ("cut", "drill_cycle"):
                    fs = operation.get("parameters", {}).get("feeds_and_speeds", {})
                    feedrate = float(fs.get("feedrate_mm_min") or fs.get("feed_rate") or operation.get("parameters", {}).get("feedRate", 1000))
                elif move_type == "plunge":
                    fs = operation.get("parameters", {}).get("feeds_and_speeds", {})
                    feedrate = float(fs.get("plunge_feedrate") or operation.get("parameters", {}).get("plungeRate", 300))
                    
                toolpaths.append({
                    "type": move_type,
                    "moveType": move_type,
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
                    "spindle_rpm": float(operation.get("parameters", {}).get("spindleSpeed", 10000))
                })
                cursor = new_pos

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
                rough_stepdown = min(10.0, max(tool_dia * 0.5, 2.0))
            else:
                rough_stepdown = float(rough_stepdown)
                
            if finish_stepdown is None or float(finish_stepdown) <= 0:
                finish_stepdown = rough_stepdown
            else:
                finish_stepdown = float(finish_stepdown)
                
        if feat_type in ("hole", "blind_hole", "through_hole", "bore") or op_type in ("drilling", "peck_drilling", "boring"):
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

        # (Strategy determined earlier)

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
                if bore_radius < 0.1: bore_radius = 0.1

                # Lead-in to bore radius
                add_move("plunge", z=top_z, source=src)
                add_move("cut", x=cx + bore_radius, y=cy, z=top_z, source=src)

                # Helical spiral down
                num_turns = max(1, math.ceil(depth / stepdown))
                z_per_turn = depth / num_turns
                curr_z = top_z
                
                num_pts = 32

                for _ in range(num_turns):
                    for i in range(1, num_pts + 1):
                        angle = 2.0 * math.pi * (i / float(num_pts))
                        px = cx + bore_radius * math.cos(angle)
                        py = cy + bore_radius * math.sin(angle)
                        pz = curr_z - z_per_turn * (i / float(num_pts))
                        add_move("cut", x=px, y=py, z=pz, source=src)
                    curr_z -= z_per_turn

                # Full 360-degree flat finish pass at bottom
                for i in range(1, num_pts + 1):
                    angle = 2.0 * math.pi * (i / float(num_pts))
                    px = cx + bore_radius * math.cos(angle)
                    py = cy + bore_radius * math.sin(angle)
                    add_move("cut", x=px, y=py, z=bottom_z, source=src)

                # Lead-out to center
                add_move("cut", x=cx, y=cy, z=bottom_z, source=src)
                add_move("retract_clearance", z=clearance, source=src)

        # ----------------------------------------------------
        # 2. FACING STRATEGY (Multi-Pass Raster or Circular)
        # ----------------------------------------------------
        elif src == "face":
            # Use centralized stock data, with feature overrides
            feat_has_diameter = bool(feat_dims.get("diameter") or feature.get("diameter"))
            is_cylindrical_face = _stock["is_cylindrical"] or feat_has_diameter
            
            stock_dia = float(
                feat_dims.get("diameter") or feature.get("diameter") or
                _stock["diameter"] or 0.0
            )
            stock_w = float(
                feat_dims.get("width") or feature.get("width") or
                _stock["width"] or stock_dia or tool_dia * 5.0
            )
            stock_l = float(
                feat_dims.get("length") or feature.get("length") or
                _stock["length"] or stock_dia or tool_dia * 5.0
            )
            
            overhang = tool_dia * 0.6  # Extend tool outside stock by 60% tool dia
            stepover = stepover_val

            add_move("rapid_clearance", z=clearance, source=src)
            
            if is_cylindrical_face and stock_dia > 0:
                # Circular facing: raster across the circular cross-section
                face_radius = (stock_dia / 2.0) + overhang
                min_y = cy - face_radius
                max_y = cy + face_radius
                
                num_passes = max(1, math.ceil((max_y - min_y) / stepover))
                
                # Start at first Y position
                curr_y = min_y + (stepover / 2.0)
                add_move("rapid_xy", x=cx - face_radius, y=curr_y, z=clearance, source=src)
                add_move("plunge", z=top_z, source=src)
                
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
                            add_move("cut", x=cx + x_extent, y=curr_y, z=top_z, source=src)
                        else:
                            add_move("cut", x=cx - x_extent, y=curr_y, z=top_z, source=src)
                    
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
                                add_move("cut", x=cx - x_extent, y=curr_y, z=top_z, source=src)
                            else:
                                add_move("cut", x=cx + x_extent, y=curr_y, z=top_z, source=src)
            else:
                # Rectangular facing: standard zigzag raster
                half_w = (stock_w / 2.0) + overhang
                half_l = (stock_l / 2.0) + overhang

                min_x = cx - half_w
                max_x = cx + half_w
                min_y = cy - half_l
                max_y = cy + half_l

                # Smart Raster Direction: Raster along the longest dimension
                if stock_w >= stock_l:
                    # Raster along X
                    num_passes = max(1, math.ceil((max_y - min_y) / stepover))
                    curr_y = min_y + (stepover / 2.0)
                    
                    add_move("rapid_xy", x=min_x, y=curr_y, z=clearance, source=src)
                    add_move("plunge", z=top_z, source=src)

                    direction = 1
                    for i in range(num_passes):
                        if direction == 1:
                            add_move("cut", x=max_x, y=curr_y, z=top_z, source=src)
                        else:
                            add_move("cut", x=min_x, y=curr_y, z=top_z, source=src)
                        
                        if i < num_passes - 1:
                            curr_y += stepover
                            direction *= -1
                            if direction == 1:
                                add_move("cut", x=min_x, y=curr_y, z=top_z, source=src)
                            else:
                                add_move("cut", x=max_x, y=curr_y, z=top_z, source=src)
                else:
                    # Raster along Y
                    num_passes = max(1, math.ceil((max_x - min_x) / stepover))
                    curr_x = min_x + (stepover / 2.0)
                    
                    add_move("rapid_xy", x=curr_x, y=min_y, z=clearance, source=src)
                    add_move("plunge", z=top_z, source=src)
                    
                    direction = 1
                    for i in range(num_passes):
                        if direction == 1:
                            add_move("cut", x=curr_x, y=max_y, z=top_z, source=src)
                        else:
                            add_move("cut", x=curr_x, y=min_y, z=top_z, source=src)
                            
                        if i < num_passes - 1:
                            curr_x += stepover
                            direction *= -1
                            if direction == 1:
                                add_move("cut", x=curr_x, y=min_y, z=top_z, source=src)
                            else:
                                add_move("cut", x=curr_x, y=max_y, z=top_z, source=src)

            add_move("retract_clearance", z=clearance, source=src)

        # ----------------------------------------------------
        # 3. POCKET CLEARING STRATEGY (Concentric Outward Steps)
        # ----------------------------------------------------
        elif src == "pocket":
            # Use centralized stock data for pocket fallbacks
            width = float(feat_dims.get("width") or feature.get("width") or feature.get("diameter") or _stock["width"] or _stock["diameter"] or 20.0)
            length = float(feat_dims.get("length") or feature.get("length") or feature.get("diameter") or _stock["length"] or _stock["diameter"] or 20.0)
            
            is_circular = (
                feat_type in ("cylinder", "external_cylinder", "shaft", "boss", "circular_boss", "round_boss", "hole", "bore", "circle")
                or "cylinder" in feat_type or "shaft" in feat_type or "circle" in feat_type
                or ("cylinder" in str(feature.get("subtype", "")).lower())
                or ("shaft" in str(feature.get("name", "")).lower())
                or (feature.get("diameter") is not None and not feature.get("width"))
            )

            add_move("rapid_clearance", z=clearance, source=src)

            for curr_z in z_passes:

                # Center entry at clearance
                add_move("retract_clearance", z=clearance, source=src)
                add_move("rapid_xy", x=cx, y=cy, z=clearance, source=src)
                add_move("plunge", z=curr_z, source=src)

                if is_circular:
                    max_r = max((width / 2.0) - tool_radius, 0.1)
                    stepover = stepover_val
                    num_shells = max(1, math.ceil(max_r / stepover))

                    for s in range(1, num_shells + 1):
                        r_s = (s / float(num_shells)) * max_r
                        num_pts = 16
                        for i in range(num_pts + 1):
                            angle = -2.0 * math.pi * (i / float(num_pts))
                            px = cx + r_s * math.cos(angle)
                            py = cy + r_s * math.sin(angle)
                            add_move("cut", x=px, y=py, z=curr_z, source=src)
                else:
                    max_offset_w = max((width - tool_dia) / 2.0, 0.1)
                    max_offset_l = max((length - tool_dia) / 2.0, 0.1)
                    stepover = stepover_val
                    num_shells = max(1, math.ceil(max(max_offset_w, max_offset_l) / stepover))

                    # Expand concentrically from center outward to pocket wall
                    for s in range(1, num_shells + 1):
                        ratio = s / float(num_shells)
                        w_s = max_offset_w * ratio
                        l_s = max_offset_l * ratio

                        add_move("cut", x=cx - w_s, y=cy - l_s, z=curr_z, source=src)
                        add_move("cut", x=cx + w_s, y=cy - l_s, z=curr_z, source=src)
                        add_move("cut", x=cx + w_s, y=cy + l_s, z=curr_z, source=src)
                        add_move("cut", x=cx - w_s, y=cy + l_s, z=curr_z, source=src)
                        add_move("cut", x=cx - w_s, y=cy - l_s, z=curr_z, source=src)

                add_move("retract_clearance", z=clearance, source=src)

            add_move("retract_clearance", z=clearance, source=src)

        # ----------------------------------------------------
        # 4. 2D CONTOUR & BOSS CLEARING STRATEGY (Cutter Radius Compensated + Standoff)
        # ----------------------------------------------------
        elif src == "contour":
            # Use centralized stock data for contour
            feat_diameter = float(
                feature.get("diameter") or feat_dims.get("diameter") or
                _stock["diameter"] or 0.0
            )
            op_str = (
                str(operation.get("strategy", "")) + " " +
                str(operation.get("description", "")) + " " +
                str(operation.get("name", "")) + " " +
                str(operation.get("type", ""))
            ).lower()
            
            is_outer = ("outer" in op_str or "boundary" in op_str or 
                       "outer" in str(feature.get("name", "")).lower() or 
                       "boundary" in str(feature.get("name", "")).lower())

            if is_outer and _stock["width"] > 0 and _stock["length"] > 0:
                width = _stock["width"]
                length = _stock["length"]
            else:
                width = float(
                    feat_dims.get("width") or feature.get("width") or feat_diameter or
                    _stock["width"] or tool_dia * 5.0
                )
                length = float(
                    feat_dims.get("length") or feature.get("length") or feat_diameter or
                    _stock["length"] or tool_dia * 5.0
                )

            is_circular = (
                feat_type in ("cylinder", "external_cylinder", "shaft", "boss", "circular_boss", "round_boss", "hole", "bore", "circle")
                or "cylinder" in feat_type or "shaft" in feat_type or "circle" in feat_type
                or ("cylinder" in str(feature.get("subtype", "")).lower())
                or ("shaft" in str(feature.get("name", "")).lower())
                or ("cylinder" in op_str or "shaft" in op_str or "external_cylinder" in op_str)
                or (feat_diameter > 0 and not feature.get("width"))
                or (_stock["is_cylindrical"] and "rough" in str(feature.get("name", "")).lower())
            )

            add_move("rapid_clearance", z=clearance, source=src)

            for curr_z in z_passes:

                if is_circular:
                    feat_r = (float(feat_diameter or width) / 2.0)
                    r_cut = feat_r + tool_radius
                    standoff_r = r_cut + (tool_radius * 1.5)
                    start_x = cx - standoff_r
                    start_y = cy

                    # Safe standoff entry point at clearance
                    add_move("retract_clearance", z=clearance, source=src)
                    add_move("rapid_xy", x=start_x, y=start_y, z=clearance, source=src)
                    add_move("plunge", z=curr_z, source=src)

                    # Tangent lead-in to cut radius
                    add_move("cut", x=cx - r_cut, y=cy, z=curr_z, source=src)

                    # Smooth 24-point circular arc loop around cylinder/shaft
                    num_pts = 24
                    for i in range(1, num_pts + 1):
                        angle = math.pi - 2.0 * math.pi * (i / float(num_pts))
                        px = cx + r_cut * math.cos(angle)
                        py = cy + r_cut * math.sin(angle)
                        add_move("cut", x=px, y=py, z=curr_z, source=src)

                    # Tangent lead-out to standoff point
                    add_move("cut", x=start_x, y=start_y, z=curr_z, source=src)
                    add_move("retract_clearance", z=clearance, source=src)

                else:
                    # Cutter radius compensation: Offset tool center OUTSIDE rectangular feature boundary
                    half_w = (width / 2.0) + tool_radius
                    half_l = (length / 2.0) + tool_radius

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

        return toolpaths
