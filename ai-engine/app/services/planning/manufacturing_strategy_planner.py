from typing import Dict, Any, Tuple
from app.constants import TURNING_FEATURE_TYPES

class ManufacturingStrategyPlanner:
    """
    Maps a recognized feature into a specific Manufacturing Strategy (e.g., 'OD Turning', 'Pocket Milling').
    """
    
    @staticmethod
    def determine_strategy(feature: Dict[str, Any], machine_type: str, setup_axis: list[float] = None) -> str:
        explicit_op = feature.get("recommendedOperation") or feature.get("machining_strategy")
        if explicit_op and explicit_op in (
            "facing", "facing_turning", "boss_clearing", "pocket_milling", "slot_milling",
            "2d_contour", "2d_contour_outer", "helical_bore_milling", "peck_drilling",
            "drilling", "tapping", "chamfer_milling", "od_turning", "od_finish_turning"
        ):
            return explicit_op

        feat_type = feature.get("type", "")
        feat_subtype = feature.get("subtype", "")
        feat_lower = str(feat_type).lower()
        sub_lower = str(feat_subtype).lower()

        mtype_str = str(machine_type).lower() if machine_type else ""
        is_turning = any(t in mtype_str for t in ("lathe", "turning", "mill_turn", "swiss", "cnc_lathe"))

        # Handle internal bores and ID features first so they don't get misclassified as OD/Boss
        if feat_type in ("bore", "counterbore") or any(kw in feat_lower for kw in ("bore", "id_hole", "id_bore", "counterbore")):
            if is_turning:
                return "id_boring"
            dia = float(feature.get("diameter") or feature.get("dimensions", {}).get("diameter") or 0.0)
            return "helical_bore_milling" if dia > 6.0 else "drilling"

        if feat_type in TURNING_FEATURE_TYPES or feat_subtype in TURNING_FEATURE_TYPES or any(kw in feat_lower for kw in ("dia", "od", "shaft", "cylinder", "turn")):
            feature_axis = feature.get("axis", [0, 0, 1])
            dot = sum(a*b for a, b in zip(feature_axis, setup_axis)) if setup_axis else 0
            
            if is_turning and (feat_subtype in ("turned_od", "external_cylinder") or "od" in feat_lower or "turn" in feat_lower):
                return "od_turning"
            elif machine_type in ("4_axis_mill", "5_axis_mill"):
                return "indexed_4axis_milling"
            elif (machine_type == "3_axis_mill" or is_turning) and abs(dot) > 0.98:
                return "boss_clearing"
            else:
                return "turning_required"
                
        elif feat_type in ("pocket", "pocketing", "cavity", "recess", "keyway"):
            return "pocket_milling"
            
        elif feat_type in ("contour", "step"):
            dia = float(feature.get("diameter") or feature.get("dimensions", {}).get("diameter") or 0.0)
            is_cyl = dia > 0 and feat_subtype in ("turned_od", "cylinder")
            if is_turning and is_cyl:
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
            dia = float(feature.get("diameter") or feature.get("dimensions", {}).get("diameter") or 0.0)
            is_cylindrical = dia > 0 and feat_subtype != "rectangular_boss"
            if is_turning and is_cylindrical:
                feature_axis = feature.get("axis", [0, 0, 1])
                dot = sum(a*b for a, b in zip(feature_axis, setup_axis)) if setup_axis else 1.0
                if abs(dot) > 0.98:
                    return "od_turning"
            if feat_subtype == "outer_profile":
                return "2d_contour_outer"
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
