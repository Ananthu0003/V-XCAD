import logging
from typing import Dict, Any, List

logger = logging.getLogger(__name__)

class GCodeSafetyValidator:
    """
    Validates if a planned operation and its toolpaths are safe to post-process.
    Runs right before G-Code generation.
    """
    
    @staticmethod
    def validate_toolpath_safety(operation: Dict[str, Any], segments: List[Dict[str, Any]], setup: Dict[str, Any]) -> Dict[str, Any]:
        """
        Returns a dict with {"valid": bool, "reason": str}
        """
        op_type = operation.get('type', 'unknown')
        if op_type in ['legacy_path', 'mock_path', 'fallback_path', 'silhouette_path', 'generic_path', 'unknown', 'blocked']:
            return {"valid": False, "reason": f"Operation type '{op_type}' is unsupported or blocked.", "code": "UNSUPPORTED_OPERATION_TYPE"}
            
        schema_version = operation.get('toolpath_schema_version')
        if schema_version != 'semantic_v1':
            return {"valid": False, "reason": "Operation toolpaths are using an outdated or missing schema. Please regenerate toolpaths.", "code": "OUTDATED_TOOLPATH_SCHEMA"}
            
        if not segments:
            return {"valid": False, "reason": "Operation has no toolpath segments to generate.", "code": "NO_TOOLPATH_SEGMENTS"}
            
        safe_heights = operation.get('safe_heights', {})
        retract_z = safe_heights.get('retract')
        clearance_z = safe_heights.get('clearance')
        top_z = safe_heights.get('top')
        bottom_z = safe_heights.get('bottom')
        
        if retract_z is None or clearance_z is None:
            return {"valid": False, "reason": "Missing safe Z heights (retract_z or clearance_z).", "code": "MISSING_SAFE_HEIGHTS"}
            
        if top_z is not None and bottom_z is not None:
            if bottom_z > top_z:
                return {"valid": False, "reason": f"Bottom Z ({bottom_z}) is higher than Top Z ({top_z}).", "code": "BOTTOM_ABOVE_TOP"}
                
        if top_z is not None and retract_z < top_z:
            return {"valid": False, "reason": f"Retract Z ({retract_z}) is below Top Z ({top_z}).", "code": "RETRACT_BELOW_TOP"}
            
        # Sanitize segment safety defensively: decompose any vertical rapid_xy moves
        clearance_z_val = float(clearance_z) if clearance_z is not None else 15.0
        segments = GCodeSafetyValidator.sanitize_toolpath_segments(segments, clearance_z_val)
        if isinstance(operation, dict):
            operation["toolpaths"] = segments

        # Check segment safety
        first_move = True
        min_allowed_clearance = min(float(clearance_z), float(top_z or 0.0) + 5.0) if top_z is not None else float(clearance_z)
        for seg in segments:
            move_type = seg.get('moveType', 'unknown')
            end_z = seg.get('end', {}).get('z')
            
            if end_z is not None:
                if move_type == 'rapid_clearance':
                    if end_z < min_allowed_clearance - 0.001:
                        return {"valid": False, "reason": f"rapid_clearance target Z ({end_z}) is below clearance_z ({clearance_z}).", "code": "RAPID_CLEARANCE_BELOW_CLEARANCE"}
                elif move_type == 'rapid_xy':
                    start_z = seg.get('start', {}).get('z')
                    if start_z is not None and abs(start_z - end_z) > 0.001:
                        return {"valid": False, "reason": f"rapid_xy changes Z from {start_z} to {end_z}.", "code": "RAPID_XY_CHANGES_Z"}
                    if end_z < retract_z:
                        return {"valid": False, "reason": f"rapid_xy is below retract_z ({end_z} < {retract_z}).", "code": "RAPID_XY_BELOW_RETRACT"}
                elif move_type == 'approach_retract':
                    if end_z < top_z:
                        return {"valid": False, "reason": f"approach_retract end Z ({end_z}) is below top_z ({top_z}).", "code": "APPROACH_RETRACT_BELOW_TOP"}
                elif move_type == 'retract_clearance':
                    if end_z < min_allowed_clearance - 0.001:
                        return {"valid": False, "reason": f"retract_clearance target Z ({end_z}) is below clearance_z ({clearance_z}).", "code": "RETRACT_CLEARANCE_BELOW_CLEARANCE"}
                    
                if first_move:
                    # First move MUST be at least at retract_z (ideally clearance)
                    if end_z < retract_z:
                        return {"valid": False, "reason": f"First motion must be at or above safe retract Z (end_z={end_z}, retract_z={retract_z}).", "code": "FIRST_MOTION_BELOW_RETRACT_Z"}
                    first_move = False
                    
            # Check travel limits if machine is provided in setup
            # (In a real system, you'd check X/Y/Z limits against machine envelope)
            
        return {"valid": True, "reason": None, "code": "SUCCESS"}

    @staticmethod
    def sanitize_toolpath_segments(segments: List[Dict[str, Any]], clearance_z: float = 15.0) -> List[Dict[str, Any]]:
        """
        Normalizes toolpath segments to guarantee CAM safety invariants.
        Specifically, if any 'rapid_xy' segment has a vertical delta (start_z != end_z),
        it decomposes it into a vertical transition (retract/approach) and a pure planar rapid.
        """
        if not segments:
            return segments
        sanitized = []
        for seg in segments:
            if not isinstance(seg, dict):
                sanitized.append(seg)
                continue
            move_type = seg.get("moveType") or seg.get("type")
            start = seg.get("start")
            end = seg.get("end")
            
            if move_type == "rapid_xy" and isinstance(start, dict) and isinstance(end, dict):
                sz = start.get("z")
                ez = end.get("z")
                if sz is not None and ez is not None and abs(sz - ez) > 0.001:
                    sx = start.get("x", 0.0)
                    sy = start.get("y", 0.0)
                    ex = end.get("x", 0.0)
                    ey = end.get("y", 0.0)
                    
                    if ez > sz:
                        # Upward motion: retract vertically to ez first
                        retract_type = "retract_clearance" if ez >= clearance_z - 0.001 else "approach_retract"
                        seg_v = dict(seg)
                        seg_v["moveType"] = retract_type
                        seg_v["type"] = retract_type
                        seg_v["start"] = dict(start)
                        seg_v["end"] = {"x": sx, "y": sy, "z": ez}
                        seg_v["x"] = sx
                        seg_v["y"] = sy
                        seg_v["z"] = ez
                        sanitized.append(seg_v)
                        
                        # Planar rapid at ez if XY changes
                        if abs(sx - ex) > 0.0001 or abs(sy - ey) > 0.0001:
                            seg_h = dict(seg)
                            seg_h["moveType"] = "rapid_xy"
                            seg_h["type"] = "rapid_xy"
                            seg_h["start"] = {"x": sx, "y": sy, "z": ez}
                            seg_h["end"] = dict(end)
                            seg_h["x"] = ex
                            seg_h["y"] = ey
                            seg_h["z"] = ez
                            sanitized.append(seg_h)
                        continue
                    else:
                        # Downward motion: planar rapid at safe higher sz first
                        if abs(sx - ex) > 0.0001 or abs(sy - ey) > 0.0001:
                            seg_h = dict(seg)
                            seg_h["moveType"] = "rapid_xy"
                            seg_h["type"] = "rapid_xy"
                            seg_h["start"] = dict(start)
                            seg_h["end"] = {"x": ex, "y": ey, "z": sz}
                            seg_h["x"] = ex
                            seg_h["y"] = ey
                            seg_h["z"] = sz
                            sanitized.append(seg_h)
                            
                        # Vertical approach down to ez
                        seg_v = dict(seg)
                        seg_v["moveType"] = "approach_retract"
                        seg_v["type"] = "approach_retract"
                        seg_v["start"] = {"x": ex, "y": ey, "z": sz}
                        seg_v["end"] = dict(end)
                        seg_v["x"] = ex
                        seg_v["y"] = ey
                        seg_v["z"] = ez
                        sanitized.append(seg_v)
                        continue
            sanitized.append(seg)
        return sanitized

