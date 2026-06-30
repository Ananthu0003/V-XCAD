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
            return {"valid": False, "reason": f"Operation type '{op_type}' is unsupported or blocked."}
            
        if not segments:
            return {"valid": False, "reason": "Operation has no toolpath segments to generate."}
            
        safe_heights = operation.get('safe_heights', {})
        retract_z = safe_heights.get('retract')
        clearance_z = safe_heights.get('clearance')
        top_z = safe_heights.get('top')
        bottom_z = safe_heights.get('bottom')
        
        if retract_z is None or clearance_z is None:
            return {"valid": False, "reason": "Missing safe Z heights (retract_z or clearance_z)."}
            
        if top_z is not None and bottom_z is not None:
            if bottom_z > top_z:
                return {"valid": False, "reason": f"Bottom Z ({bottom_z}) is higher than Top Z ({top_z})."}
                
        if top_z is not None and retract_z < top_z:
            return {"valid": False, "reason": f"Retract Z ({retract_z}) is below Top Z ({top_z})."}
            
        # Check segment safety
        first_move = True
        for seg in segments:
            move_type = seg.get('moveType', 'unknown')
            end_z = seg.get('end', {}).get('z')
            
            if end_z is not None:
                if move_type == 'rapid_clearance':
                    if end_z < clearance_z:
                        return {"valid": False, "reason": f"rapid_clearance target Z ({end_z}) is below clearance_z ({clearance_z})."}
                elif move_type == 'rapid_xy':
                    start_z = seg.get('start', {}).get('z')
                    if start_z is not None and abs(start_z - end_z) > 0.001:
                        return {"valid": False, "reason": f"rapid_xy changes Z from {start_z} to {end_z}."}
                    if end_z < retract_z:
                        return {"valid": False, "reason": f"rapid_xy is below retract_z ({end_z} < {retract_z})."}
                elif move_type == 'approach_retract':
                    if end_z < retract_z:
                        return {"valid": False, "reason": f"approach_retract is below retract_z ({end_z} < {retract_z})."}
                elif move_type == 'retract_clearance':
                    if end_z < clearance_z:
                        return {"valid": False, "reason": f"retract_clearance target Z ({end_z}) is below clearance_z ({clearance_z})."}
                    
                if first_move:
                    # First move MUST be at least at retract_z (ideally clearance)
                    if end_z < retract_z:
                        return {"valid": False, "reason": "First motion must be at or above safe retract Z."}
                    first_move = False
                    
            # Check travel limits if machine is provided in setup
            # (In a real system, you'd check X/Y/Z limits against machine envelope)
            
        return {"valid": True, "reason": None}
