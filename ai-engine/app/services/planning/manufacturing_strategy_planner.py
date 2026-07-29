from typing import Dict, Any, Tuple

class ManufacturingStrategyPlanner:
    """
    Maps a recognized feature into a specific Manufacturing Strategy (e.g., 'OD Turning', 'Pocket Milling').
    """
    
    @staticmethod
    def determine_strategy(feature: Dict[str, Any], machine_type: str, setup_axis: list[float] = None) -> str:
        feat_type = feature.get("type", "")
        feat_subtype = feature.get("subtype", "")
        
        mtype_str = str(machine_type).lower() if machine_type else ""
        is_turning = any(t in mtype_str for t in ("lathe", "turning", "mill_turn", "swiss", "cnc_lathe"))

        if feat_type in ("external_cylinder", "shaft") or feat_subtype in ("shaft", "external_cylinder"):
            feature_axis = feature.get("axis", [0, 0, 1])
            dot = sum(a*b for a, b in zip(feature_axis, setup_axis)) if setup_axis else 0
            
            if is_turning:
                return "od_turning"
            elif machine_type in ("4_axis_mill", "5_axis_mill"):
                return "indexed_4axis_milling"
            elif machine_type == "3_axis_mill" and abs(dot) > 0.98:
                return "boss_clearing"
            else:
                return "turning_required"
                
        elif feat_type == "pocket":
            return "pocket_milling"
            
        elif feat_type in ("contour", "step"):
            if is_turning:
                if feat_subtype == "outer_profile":
                    return "od_turning"
            
            if feat_subtype == "outer_profile":
                return "2d_contour_outer"
            return "2d_contour"
            
        elif feat_type == "face":
            if is_turning:
                return "facing_turning"
            return "facing"
            
        elif feat_type == "boss":
            if is_turning:
                feature_axis = feature.get("axis", [0, 0, 1])
                dot = sum(a*b for a, b in zip(feature_axis, setup_axis)) if setup_axis else 1.0
                if abs(dot) > 0.98:
                    return "od_turning"
            return "boss_clearing"
            
        elif feat_type == "slot":
            return "slot_milling"
            
        elif feat_type in ("hole", "blind_hole", "through_hole"):
            if feat_subtype == "threaded_hole":
                return "tapping"  # or thread_milling
            return "drilling"
            
        elif feat_type == "chamfer":
            return "chamfer_milling"
            
        return "unknown_strategy"
