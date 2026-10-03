from typing import Dict, Any, Tuple
from app.constants import TURNING_FEATURE_TYPES

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

        if feat_type in TURNING_FEATURE_TYPES or feat_subtype in TURNING_FEATURE_TYPES or any(kw in str(feat_type).lower() for kw in ("dia", "od", "shaft", "cylinder", "turn", "bore", "id", "groove")):
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
            
            # Determine strategy based on hole geometry
            dims = feature.get("dimensions", {})
            hole_dia = dims.get("diameter", feature.get("diameter", 0))
            hole_depth = dims.get("depth", feature.get("depth", 0))
            
            # For large bores (dia > 6mm), use helical bore milling with a smaller end mill
            # instead of requiring an exact-diameter drill bit
            if hole_dia > 6.0:
                return "helical_bore_milling"
            
            # For deep holes (depth:diameter > 5), use peck drilling
            if hole_dia > 0 and hole_depth > 0 and (hole_depth / hole_dia) > 5.0:
                return "peck_drilling"
            
            return "drilling"
            
        elif feat_type == "chamfer":
            return "chamfer_milling"
            
        return "unknown_strategy"
