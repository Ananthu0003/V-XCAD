"""
ToolpathValidator — Validates the CAM pipeline including geometry bounds.
"""
from typing import List, Dict, Any, Optional
import math
from app.models.tool_assembly import ToolAssembly

class ToolpathValidator:
    """
    Validates the entire CAM pipeline: Feature -> Operation -> Toolpath -> GCode.
    """
    def __init__(self):
        pass

    def validate_pipeline(self, features: List[Dict[str, Any]], operations: List[Dict[str, Any]], setup_metadata: Dict[str, Any] = None, engine_setup: Dict[str, Any] = None, machine_limits: Dict[str, Any] = None, tool_assemblies: Dict[str, ToolAssembly] = None) -> Dict[str, Any]:
        """
        Validates the entire job's toolpaths.
        Returns a dict with 'status' (success, error, warning), 'warnings', 'errors'
        """
        result = {
            "status": "success",
            "warnings": [],
            "errors": []
        }
        
        # 1. Map features to operations
        feat_to_op = {}
        for op in operations:
            f_id = op.get('feature_id')
            if f_id:
                if f_id not in feat_to_op:
                    feat_to_op[f_id] = []
                feat_to_op[f_id].append(op)
        
        # 2. Check each required feature that has an operation selected
        selected_feature_ids = {op.get('feature_id') or op.get('featureId') for op in operations}
        required_features = [f for f in features if f.get('requiredMachining', True) and f.get('id') in selected_feature_ids]
        
        for feat in required_features:
            f_id = feat.get('id', 'unknown_id')
            f_name = feat.get('name', 'Unknown Feature')
            
            # Check for operation
            ops_for_feat = feat_to_op.get(f_id, [])
            if not ops_for_feat:
                result["errors"].append(f"Toolpath validation failed: - {f_name} ({f_id}) has no planned operation.")
                result["status"] = "error"
                continue
                
            for op in ops_for_feat:
                if op.get('status') == 'error':
                    err_msg = (op.get("parameters") or {}).get('error', 'Unknown operation error')
                    result["errors"].append(f"Toolpath validation failed: - {f_name} ({f_id}) operation error: {err_msg}")
                    result["status"] = "error"
                    continue
                    
                toolpaths = op.get('toolpaths', [])
                if not toolpaths:
                    result["errors"].append(f"Toolpath validation failed: - {f_name} ({f_id}) operation {op.get('type')} generated no toolpaths.")
                    result["status"] = "error"
                    continue
                    
                tool = op.get('toolId', op.get('tool_id'))
                if not tool:
                    result["errors"].append(f"Toolpath validation failed: - {f_name} ({f_id}) operation has no tool assigned.")
                    result["status"] = "error"
                    continue
                    
                # 3. Geometry and Stock Validation
                self._validate_geometry(op, toolpaths, f_name, f_id, result, setup_metadata)
                
                # 4. Compensation Validation
                self._validate_compensation(op, toolpaths, f_name, f_id, result)
                
                # 4.5. Segment Safety & Logic
                self._validate_segment_safety(op, toolpaths, f_name, result)
                
                # 5. Phase 8 Stage 2: Tool Reach & Holder Collision
                if tool_assemblies and tool in tool_assemblies:
                    self._validate_tool_reach_and_holder(op, toolpaths, tool_assemblies[tool], f_name, result, setup_metadata)
                    
        # 6. Phase 8 Stage 1: Machine Limit Validation
        self._validate_machine_limits(operations, result, setup_metadata, machine_limits)
                    
        return result

    def _validate_geometry(self, op: Dict[str, Any], toolpaths: List[Dict[str, Any]], f_name: str, f_id: str, result: Dict[str, Any], setup_metadata: Dict[str, Any] = None) -> None:
        """Constraint C4 / C6: Check geometry adherence and stock boundaries."""
        geometry = op.get("geometry", {})
        op_type = op.get("type")
        
        if not geometry:
            result["errors"].append(f"Geometry validation failed: {f_name} has no geometry mapping.")
            result["status"] = "error"
            return
            
        if op_type == "drilling":
            axis = geometry.get("axis")
            if not axis: return
            
            ax, ay, az = axis
            if az > 0: ax, ay, az = -ax, -ay, -az
            
            for seg in toolpaths:
                seg_type = seg.get("type")
                if seg_type in ("plunge", "cut"):
                    s = seg.get("start", {})
                    e = seg.get("end", {})
                    
                    # Vector of the move
                    vx = e.get("x", 0) - s.get("x", 0)
                    vy = e.get("y", 0) - s.get("y", 0)
                    vz = e.get("z", 0) - s.get("z", 0)
                    
                    mag = math.sqrt(vx*vx + vy*vy + vz*vz)
                    if mag > 1e-6:
                        vx /= mag; vy /= mag; vz /= mag
                        dot = vx*ax + vy*ay + vz*az
                        if abs(abs(dot) - 1.0) > 0.05: # Not collinear within ~18 deg
                            result["errors"].append(f"Geometry validation failed: {f_name} drill path is not collinear with hole axis.")
                            result["status"] = "error"
                            return

        # Connectivity & Zero-length check
        has_cut = False
        for i in range(len(toolpaths) - 1):
            curr_seg = toolpaths[i]
            next_seg = toolpaths[i+1]
            
            curr_start = curr_seg.get("start", {})
            curr_end = curr_seg.get("end", {})
            next_start = next_seg.get("start", {})
            
            # Zero-length check
            dx_seg = curr_end.get("x", 0) - curr_start.get("x", 0)
            dy_seg = curr_end.get("y", 0) - curr_start.get("y", 0)
            dz_seg = curr_end.get("z", 0) - curr_start.get("z", 0)
            dist_seg = math.sqrt(dx_seg**2 + dy_seg**2 + dz_seg**2)
            if dist_seg < 0.001 and curr_seg.get("moveType") not in ["dwell", "delay"]:
                result["errors"].append(f"Geometry validation failed: {f_name} contains zero-length segment ({curr_seg.get('moveType')}).")
                result["status"] = "error"
                return
                
            if curr_seg.get("moveType") == "cut":
                has_cut = True
            
            dx = curr_end.get("x", 0) - next_start.get("x", 0)
            dy = curr_end.get("y", 0) - next_start.get("y", 0)
            dz = curr_end.get("z", 0) - next_start.get("z", 0)
            
            dist = math.sqrt(dx*dx + dy*dy + dz*dz)
            if dist > 0.01:
                result["errors"].append(f"Geometry validation failed: {f_name} toolpath segments are disconnected by {dist:.3f}mm.")
                result["status"] = "error"
                return
                
        # Check last segment for cut
        if toolpaths and toolpaths[-1].get("moveType") == "cut":
            has_cut = True
            
        if not has_cut and op_type != "blocked" and op_type != "unknown":
            result["errors"].append(f"Geometry validation failed: {f_name} toolpath does not contain any cutting moves.")
            result["status"] = "error"
            return

        # --- Stock Limits Validation ---
        if setup_metadata and "resolvedStock" in setup_metadata:
            stock_bounds = setup_metadata["resolvedStock"].get("bounds")
            if stock_bounds:
                s_min = stock_bounds["min"]
                s_max = stock_bounds["max"]
                
                # Safe Z can be way above stock
                z_min, z_max = s_min[2] - 1.0, s_max[2] + 50.0  
                
                for seg in toolpaths:
                    s = seg.get("start", {})
                    e = seg.get("end", {})
                    mtype = seg.get("moveType", "")
                    
                    if mtype in ("feed", "plunge"):
                        for pt in (s, e):
                            if not pt: continue
                            px, py, pz = pt.get("x", 0), pt.get("y", 0), pt.get("z", 0)
                            
                            # Valid lead-ins might start slightly outside X/Y stock.
                            if pz < z_min:
                                result["errors"].append(f"Stock validation failed: {f_name} toolpath plunges below stock bottom (Z={pz:.3f} < {z_min:.3f}).")
                                result["status"] = "error"
                                return
                            if px < s_min[0] - 25.0 or px > s_max[0] + 25.0 or py < s_min[1] - 25.0 or py > s_max[1] + 25.0:
                                # Block excessively outside stock boundaries
                                result["errors"].append(f"Stock validation failed: {f_name} toolpath is excessively outside stock boundaries.")
                                result["status"] = "error"
                                return

        # --- Keepout / Boss Geometry Validation ---
        if op_type == "boss_clearing":
            geometry = op.get("geometry", {})
            machining_region = geometry.get("machiningRegion") or op.get("machiningRegion")
            if machining_region and "islands" in machining_region and machining_region["islands"]:
                boss_pts = machining_region["islands"][0]
                if boss_pts and len(boss_pts) >= 3:
                    try:
                        from shapely.geometry import Polygon, LineString
                        boss_poly = Polygon(boss_pts)
                        if not boss_poly.is_valid:
                            boss_poly = boss_poly.buffer(0)
                        
                        tool_radius = (op.get("tool", {}).get("diameter", 6.35) or 6.35) / 2.0
                        # Validate that the cutter center never goes inside (boss_poly + tool_radius)
                        # We use 0.99 multiplier to allow for tiny floating point errors on the exact boundary
                        keepout_poly = boss_poly.buffer(tool_radius * 0.99, join_style=2)
                        
                        for seg in toolpaths:
                            mtype = seg.get("moveType", "")
                            if mtype in ("cut", "plunge", "lead_in", "lead_out"):
                                s = seg.get("start", {})
                                e = seg.get("end", {})
                                if "x" in s and "x" in e:
                                    line = LineString([(s["x"], s["y"]), (e["x"], e["y"])])
                                    if line.intersects(keepout_poly) and not line.touches(keepout_poly):
                                        intersection = line.intersection(keepout_poly)
                                        # Only error if it actually cuts INTO the keepout, not just touches the border
                                        if intersection.length > 0.001:
                                            result["errors"].append(f"Geometry validation failed: {f_name} toolpath gouges the boss keepout zone.")
                                            result["status"] = "error"
                                            return
                    except ImportError:
                        pass # Ignore if shapely is not available

    def _validate_segment_safety(self, op: Dict[str, Any], toolpaths: List[Dict[str, Any]], f_name: str, result: Dict[str, Any]) -> None:
        """Validates speeds, feeds, and safe heights at the segment level."""
        safe_heights = op.get("safe_heights", {})
        retract = safe_heights.get("retract", 5.0)
        
        for i, seg in enumerate(toolpaths):
            mtype = seg.get("moveType", "")
            s = seg.get("start", {})
            e = seg.get("end", {})
            
            z1 = s.get("z", 0)
            z2 = e.get("z", 0)
            
            if mtype in ["rapid_clearance", "rapid_xy"]:
                if z1 < retract - 0.1 or z2 < retract - 0.1:
                    result["errors"].append(f"Safety validation failed: {f_name} performs rapid move below retract height.")
                    result["status"] = "error"
                    return
                    
            if mtype == "plunge":
                if z1 < z2 - 0.001:
                    result["errors"].append(f"Safety validation failed: {f_name} contains impossible upward plunge (Z{z1:.3f} to Z{z2:.3f}).")
                    result["status"] = "error"
                    return
                    
            if mtype == "cut":
                feed = seg.get("feedrate", 0)
                if feed <= 0:
                    result["errors"].append(f"Safety validation failed: {f_name} contains cut move with invalid feedrate ({feed}).")
                    result["status"] = "error"
                    return

    def _validate_compensation(self, op: Dict[str, Any], toolpaths: List[Dict[str, Any]], f_name: str, f_id: str, result: Dict[str, Any]) -> None:
        op_type = op.get("type")
        if op_type not in ["2d_contour", "2d_contour_outer"]:
            return

        for seg in toolpaths:
            if seg.get("moveType") == "cut":
                if seg.get("toolpathType") != "tool_centerline":
                    result["errors"].append("Contour toolpath must be tool-centerline compensated when using R0")
                    result["status"] = "error"
                    return
                    
                if seg.get("toolRadiusCompensated") is not True:
                    result["errors"].append("Tool radius compensation metadata missing")
                    result["status"] = "error"
                    return
                    
                if not seg.get("toolDiameterMm"):
                    result["errors"].append("Tool diameter missing; cannot validate radius compensation")
                    result["status"] = "error"
                    return
                    
                comp_mode = seg.get("compensationMode")
                if comp_mode != "computer":
                    result["errors"].append("Only computer compensation with R0 is currently supported for Klartext")
                    result["status"] = "error"
                    return
                    
            # Safe space validation for lead out and BLK FORM bounds
            if seg.get("segmentRole") in ["lead_in", "lead_out"]:
                sx = seg.get("start", {}).get("x", 0)
                sy = seg.get("start", {}).get("y", 0)
                ex = seg.get("end", {}).get("x", 0)
                ey = seg.get("end", {}).get("y", 0)
                if max(abs(sx), abs(ex)) > 100.0 or max(abs(sy), abs(ey)) > 100.0:
                    result["warnings"].append({
                        "code": "LEAD_MOVE_OUTSIDE_BLK_FORM",
                        "severity": "warning",
                        "message": "Lead-in/lead-out move is outside declared BLK FORM. Confirm stock, fixture, and machine clearance."
                    })
                    
            if seg.get("segmentRole") == "lead_out":
                # Find the previous cut segment to check collinearity
                idx = toolpaths.index(seg)
                if idx > 0:
                    prev_seg = toolpaths[idx - 1]
                    if prev_seg.get("segmentRole") == "cut":
                        dx = seg.get("end", {}).get("x", 0) - seg.get("start", {}).get("x", 0)
                        dy = seg.get("end", {}).get("y", 0) - seg.get("start", {}).get("y", 0)
                        mag = math.hypot(dx, dy)
                        
                        pdx = prev_seg.get("end", {}).get("x", 0) - prev_seg.get("start", {}).get("x", 0)
                        pdy = prev_seg.get("end", {}).get("y", 0) - prev_seg.get("start", {}).get("y", 0)
                        pmag = math.hypot(pdx, pdy)
                        
                        if mag > 0.001 and pmag > 0.001:
                            nx, ny = dx/mag, dy/mag
                            pnx, pny = pdx/pmag, pdy/pmag
                            
                            dot = nx * pnx + ny * pny
                            if abs(dot) > 0.99:
                                result["errors"].append(f"Geometry validation failed: {f_name} lead_out vector runs along the finished profile edge.")
                                result["status"] = "error"
                                return

    def _validate_machine_limits(self, operations: List[Dict[str, Any]], result: Dict[str, Any], setup_metadata: Dict[str, Any], machine_limits: Dict[str, Any]) -> None:
        """Phase 8 Stage 1: Validate toolpaths against machine envelope limits."""
        if not machine_limits:
            return

        all_toolpaths = []
        for op in operations:
            if op.get("status") != "error":
                all_toolpaths.extend(op.get("toolpaths", []))
                
        if not all_toolpaths:
            return

        # Calculate bounding box of all paths in setup space
        min_x, max_x = float('inf'), float('-inf')
        min_y, max_y = float('inf'), float('-inf')
        min_z, max_z = float('inf'), float('-inf')
        
        for seg in all_toolpaths:
            s = seg.get("start", {})
            e = seg.get("end", {})
            for pt in (s, e):
                if not pt: continue
                x, y, z = pt.get("x", 0), pt.get("y", 0), pt.get("z", 0)
                min_x = min(min_x, x); max_x = max(max_x, x)
                min_y = min(min_y, y); max_y = max(max_y, y)
                min_z = min(min_z, z); max_z = max(max_z, z)
                
        # Are absolute limits defined via setupToMachineTransform?
        setup_to_machine = setup_metadata.get("setupToMachineTransform") if setup_metadata else None
        
        if not setup_to_machine:
            # UNKNOWN PLACEMENT: Validate only relative span
            span_x = max_x - min_x
            span_y = max_y - min_y
            span_z = max_z - min_z
            
            mach_span_x = machine_limits.get("x_max", 0) - machine_limits.get("x_min", 0)
            mach_span_y = machine_limits.get("y_max", 0) - machine_limits.get("y_min", 0)
            mach_span_z = machine_limits.get("z_max", 0) - machine_limits.get("z_min", 0)
            
            if span_x > mach_span_x or span_y > mach_span_y or span_z > mach_span_z:
                result["errors"].append("Toolpath exceeds relative machine physical travel span.")
                result["status"] = "error"
            else:
                result["warnings"].append({
                    "code": "INCOMPLETE_MACHINE_PLACEMENT",
                    "severity": "warning",
                    "message": "Absolute setup-to-machine transform unknown. Validated relative travel span only."
                })
        else:
            # KNOWN PLACEMENT: Transform bounding box and check absolute limits
            # Simplified transform application for bounds checking
            # (Assuming purely translational setup_to_machine for bounds check, or apply full matrix if rotational)
            # We would apply the 4x4 matrix here. For MVP, assuming translation is encoded in the last column.
            tx = setup_to_machine[0][3] if isinstance(setup_to_machine[0], list) else 0
            ty = setup_to_machine[1][3] if isinstance(setup_to_machine, list) and len(setup_to_machine) > 1 else 0
            tz = setup_to_machine[2][3] if isinstance(setup_to_machine, list) and len(setup_to_machine) > 2 else 0
            
            abs_min_x = min_x + tx; abs_max_x = max_x + tx
            abs_min_y = min_y + ty; abs_max_y = max_y + ty
            abs_min_z = min_z + tz; abs_max_z = max_z + tz
            
            if (abs_min_x < machine_limits.get("x_min", 0) or abs_max_x > machine_limits.get("x_max", 0) or
                abs_min_y < machine_limits.get("y_min", 0) or abs_max_y > machine_limits.get("y_max", 0) or
                abs_min_z < machine_limits.get("z_min", 0) or abs_max_z > machine_limits.get("z_max", 0)):
                
                result["errors"].append("Toolpath exceeds absolute machine envelope limits.")
                result["status"] = "error"

    def _validate_tool_reach_and_holder(self, op: Dict[str, Any], toolpaths: List[Dict[str, Any]], tool_assembly: ToolAssembly, f_name: str, result: Dict[str, Any], setup_metadata: Dict[str, Any]) -> None:
        """Phase 8 Stage 2: Validate cutting length, stickout, and holder collision."""
        
        min_z = float('inf')
        for seg in toolpaths:
            s = seg.get("start", {})
            e = seg.get("end", {})
            if s: min_z = min(min_z, s.get("z", 0))
            if e: min_z = min(min_z, e.get("z", 0))
            
        if min_z == float('inf'):
            return
            
        stock_top = 0.0
        if setup_metadata and "resolvedStock" in setup_metadata:
            stock_bounds = setup_metadata["resolvedStock"].get("bounds")
            if stock_bounds:
                stock_top = stock_bounds["max"][2]
                
        # Maximum plunge depth relative to the top of the stock
        max_plunge_depth = stock_top - min_z
        
        # Tool Reach: Is plunge deeper than usable stickout?
        if max_plunge_depth > tool_assembly.usable_stickout:
            result["errors"].append(f"Tool Reach failed: {f_name} max depth ({max_plunge_depth:.3f}mm) exceeds usable stickout ({tool_assembly.usable_stickout:.3f}mm). Holder collision eminent.")
            result["status"] = "error"
            return
            
        # Cutting Length check
        if max_plunge_depth > tool_assembly.cutting_length:
            result["warnings"].append({
                "code": "INSUFFICIENT_CUTTING_LENGTH",
                "severity": "warning",
                "message": f"{f_name} max depth ({max_plunge_depth:.3f}mm) exceeds fluted cutting length ({tool_assembly.cutting_length:.3f}mm). Ensure shank clearance."
            })
