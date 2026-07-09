"""
ToolpathValidator — Validates the CAM pipeline including geometry bounds.
"""
from typing import List, Dict, Any
import math

class ToolpathValidator:
    """
    Validates the entire CAM pipeline: Feature -> Operation -> Toolpath -> GCode.
    """
    def __init__(self):
        pass

    def validate_pipeline(self, features: List[Dict[str, Any]], operations: List[Dict[str, Any]]) -> Dict[str, Any]:
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
        
        # 2. Check each required feature
        required_features = [f for f in features if f.get('requiredMachining', True)]
        
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
                    
                # 3. Geometry Validation
                self._validate_geometry(op, toolpaths, f_name, f_id, result)
                
                # 4. Compensation Validation
                self._validate_compensation(op, toolpaths, f_name, f_id, result)
                    
        return result

    def _validate_geometry(self, op: Dict[str, Any], toolpaths: List[Dict[str, Any]], f_name: str, f_id: str, result: Dict[str, Any]) -> None:
        """Constraint C4 / C6: Check geometry adherence."""
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

        # Connectivity check
        for i in range(len(toolpaths) - 1):
            curr_end = toolpaths[i].get("end", {})
            next_start = toolpaths[i+1].get("start", {})
            
            dx = curr_end.get("x", 0) - next_start.get("x", 0)
            dy = curr_end.get("y", 0) - next_start.get("y", 0)
            dz = curr_end.get("z", 0) - next_start.get("z", 0)
            
            dist = math.sqrt(dx*dx + dy*dy + dz*dz)
            if dist > 0.01:
                result["errors"].append(f"Geometry validation failed: {f_name} toolpath segments are disconnected by {dist:.3f}mm.")
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
