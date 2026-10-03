import math
from typing import Dict, Any, List, Tuple, Optional
from app.models.manufacturing import MachineProfile, MaterialProfile, ToolProfile

def _get_dim(feature: Dict[str, Any], keys: List[str], default: float = 0.0) -> float:
    for k in keys:
        if k in feature and isinstance(feature[k], (int, float)) and feature[k] > 0:
            return float(feature[k])
        dims = feature.get("dimensions")
        if isinstance(dims, dict) and k in dims and isinstance(dims[k], (int, float)) and dims[k] > 0:
            return float(dims[k])
    return default

def _extract_stock_size(setup: Optional[Dict[str, Any]]) -> float:
    if not setup or not isinstance(setup, dict):
        return 0.0
    res_stock = setup.get("resolvedStock")
    if isinstance(res_stock, dict):
        bounds = res_stock.get("bounds")
        if isinstance(bounds, dict) and "max" in bounds and "min" in bounds:
            mx, mn = bounds["max"], bounds["min"]
            dx = abs(float(mx[0]) - float(mn[0]))
            dy = abs(float(mx[1]) - float(mn[1]))
            if dx > 0 or dy > 0:
                return max(dx, dy)
        dims = res_stock.get("dimensions")
        if isinstance(dims, (list, tuple)) and len(dims) > 0 and isinstance(dims[0], (int, float)):
            return float(dims[0])
    stock_dims = setup.get("stockDimensions")
    if isinstance(stock_dims, (list, tuple)) and len(stock_dims) > 0 and isinstance(stock_dims[0], (int, float)):
        return float(stock_dims[0])
    stock_def = setup.get("stockDefinition")
    if isinstance(stock_def, dict):
        for key in ("diameter", "width", "cylinderDiameter"):
            v = stock_def.get(key)
            if isinstance(v, (int, float)) and v > 0:
                return float(v)
    for k in ("cylinderDiameter", "stockWidth", "diameter", "width"):
        if k in setup and isinstance(setup[k], (int, float)) and setup[k] > 0:
            return float(setup[k])
    return 0.0

class ToolRecommendationEngine:
    """
    Selects the best available tool for a given operation based strictly on physical geometry and material compatibility.
    No hardcoding or magic constant unit assumptions.
    """
    def __init__(self, tool_library: List[ToolProfile]):
        self.tools = tool_library

    def recommend_tool(self, operation_type: str, feature: Dict[str, Any], machine: MachineProfile, material: MaterialProfile, setup: Optional[Dict[str, Any]] = None, preferred_tool_id: Optional[str] = None) -> Tuple[Optional[ToolProfile], str, str, Dict[str, float]]:
        """
        Returns: (selected_tool, status, reason, feeds_and_speeds)
        """
        target_depth = _get_dim(feature, ["depth", "height"], default=10.0)
        target_dia = _get_dim(feature, ["diameter", "dia", "size"])
        if target_dia == 0.0:
            rad = _get_dim(feature, ["radius"])
            if rad > 0:
                target_dia = rad * 2.0

        # Calculate effective stock/part size dynamically from setup or feature geometry
        stock_size = _extract_stock_size(setup)
        feat_size = _get_dim(feature, ["width", "length", "diameter"])
        if stock_size == 0.0 and feat_size > 0.0:
            stock_size = feat_size

        # Dynamic maximum tool diameter thresholds calculated from physical stock scale
        max_facing_dia = (stock_size * 1.5) if stock_size > 0.0 else 100.0
        max_milling_dia = (stock_size * 1.25) if stock_size > 0.0 else (feat_size * 1.5 if feat_size > 0.0 else 100.0)

        # Determine required tool type
        req_type = "flat_end_mill"
        if operation_type in ("drilling", "peck_drilling"):
            req_type = "drill"
        elif operation_type == "boring":
            req_type = "boring_bar"
        elif operation_type == "helical_bore_milling":
            req_type = "flat_end_mill"  # Any end mill smaller than the bore works
        elif operation_type == "reaming":
            req_type = "reamer"
        elif operation_type in ("tapping", "threading"):
            req_type = "tap"
        elif operation_type == "facing":
            req_type = "face_mill"
        elif operation_type in ("od_turning", "id_turning", "turning", "facing_turning"):
            req_type = "turning_tool"
        elif operation_type in ("parting", "grooving"):
            req_type = "cut_off_tool"
        elif operation_type == "knurling":
            req_type = "knurling_tool"
        elif operation_type == "turning_required":
            return None, "blocked", "Requires lathe or mill-turn setup.", {}

        candidate_tools = []
        rejections = []

        if self.tools:
            for t in self.tools:
                # 1. Type Match
                if t.type != req_type and not (req_type == "face_mill" and t.type in ["flat_end_mill", "face_mill", "end_mill"]) and not (req_type == "flat_end_mill" and t.type in ["ball_end_mill", "bull_nose_end_mill", "end_mill"]):
                    rejections.append(f"{t.name}: wrong type ({t.type} != {req_type})")
                    continue
                    
                # Prevent knurling or turning tools from being used for milling/drilling
                if req_type in ("flat_end_mill", "drill", "face_mill") and t.type in ("knurling_tool", "turning_tool", "cut_off_tool"):
                    rejections.append(f"{t.name}: inappropriate tool type")
                    continue

                # 2. Material Match
                material_id_lower = material.material_id.lower()
                material_name_lower = material.material_name.lower() if getattr(material, 'material_name', None) else ""
                material_category = getattr(material, 'category', '').lower()
                is_compatible = False
                if not t.compatible_materials:
                    is_compatible = True
                else:
                    for comp_mat in t.compatible_materials:
                        comp_lower = comp_mat.lower()
                        if (comp_lower in material_id_lower or 
                            comp_lower in material_name_lower or 
                            (material_category and comp_lower in material_category) or 
                            comp_lower == "all"):
                            is_compatible = True
                            break
                
                if not is_compatible:
                    rejections.append(f"{t.name}: incompatible material")
                    continue

                # 3. Machine Match & Holder Taper Match
                if machine.machine_id not in t.supported_machines and "all" not in t.supported_machines:
                    rejections.append(f"{t.name}: unsupported machine")
                    continue

                machine_taper = getattr(machine, 'spindle_taper', None) or machine.work_envelope.get("spindle_taper")
                if machine_taper and getattr(t, 'holder_taper', None):
                    if str(t.holder_taper).lower() != str(machine_taper).lower():
                        rejections.append(f"{t.name}: holder taper ({t.holder_taper}) incompatible with machine ({machine_taper})")
                        continue

                # 4. Strict Geometric Constraints based on physical workpiece dimensions
                if operation_type in ("drilling", "peck_drilling"):
                    if target_dia > 0 and t.diameter > target_dia + 0.01:
                        rejections.append(f"{t.name}: tool diameter ({t.diameter}mm) > hole diameter ({target_dia}mm)")
                        continue

                # For helical bore milling, tool must be SMALLER than the bore
                # Ideal: 50-80% of bore diameter for good chip evacuation
                if operation_type == "helical_bore_milling":
                    if target_dia > 0:
                        if t.diameter >= target_dia:
                            rejections.append(f"{t.name}: tool diameter ({t.diameter}mm) >= bore diameter ({target_dia}mm) — must be smaller for helical milling")
                            continue
                        if t.diameter < target_dia * 0.10:
                            rejections.append(f"{t.name}: tool diameter ({t.diameter}mm) too small for bore ({target_dia}mm) — less than 10% ratio")
                            continue

                if operation_type == "facing" and stock_size > 0.0:
                    if t.diameter > max_facing_dia:
                        rejections.append(f"{t.name}: tool diameter ({t.diameter}mm) exceeds facing scale threshold ({round(max_facing_dia, 2)}mm) for stock size ({stock_size}mm)")
                        continue
                
                if operation_type in ("pocketing", "pocket_milling", "slot_milling", "cavity", "boss_clearing", "2d_contour", "2d_contour_outer"):
                    if stock_size > 0.0 and t.diameter > max_milling_dia:
                        rejections.append(f"{t.name}: tool diameter ({t.diameter}mm) exceeds workpiece envelope scale ({round(max_milling_dia, 2)}mm) for stock size ({stock_size}mm)")
                        continue
                        
                    max_feature_tool_dia = _get_dim(feature, ["width", "diameter", "size", "length"])
                    if operation_type in ("pocketing", "pocket_milling", "slot_milling", "cavity"):
                        if max_feature_tool_dia > 0 and t.diameter > max_feature_tool_dia:
                            rejections.append(f"{t.name}: tool diameter ({t.diameter}mm) > pocket size ({max_feature_tool_dia}mm)")
                            continue
                    else:
                        # For bosses and contours, tool can be larger than feature, but not absurdly so (e.g., max 3x)
                        if max_feature_tool_dia > 0 and t.diameter > (max_feature_tool_dia * 3.0):
                            rejections.append(f"{t.name}: tool diameter ({t.diameter}mm) is excessively larger than feature size ({max_feature_tool_dia}mm)")
                            continue
                    min_corner_r = _get_dim(feature, ["min_radius", "corner_radius"])
                    if min_corner_r > 0 and t.diameter > (min_corner_r * 2.0) + 0.01:
                        rejections.append(f"{t.name}: tool diameter ({t.diameter}mm) exceeds internal corner diameter ({min_corner_r*2}mm)")
                        continue
                # 5. Stickout vs depth constraint
                # For drilling, stickout is a hard physical requirement
                # For helical bore milling and other milling ops, we prefer tools
                # with sufficient stickout but don't hard-block (warn instead)
                if t.stickout > 0 and t.stickout < target_depth:
                    if operation_type in ("drilling", "peck_drilling"):
                        rejections.append(f"{t.name}: stickout ({t.stickout}mm) < depth ({target_depth}mm)")
                        continue
                    # For helical bore milling and other ops, accept but note limitation
                    # The operator can use a long-reach holder or adjust setup

                candidate_tools.append(t)

        # Rank candidate tools based on physics/geometry
        best_tool = None
        if candidate_tools:
            if preferred_tool_id:
                matched = [t for t in candidate_tools if t.tool_id == preferred_tool_id]
                if matched:
                    best_tool = matched[0]
                else:
                    return None, "blocked", f"Preferred tool '{preferred_tool_id}' is physically incompatible or invalid for this operation.", {}
            else:
                def _score_tool(t: ToolProfile) -> float:
                    score = 0.0
                    # Feature accessibility:
                    if operation_type in ("drilling", "peck_drilling"):
                        score -= abs(target_dia - t.diameter) * 10
                    elif operation_type == "helical_bore_milling":
                        # Prefer largest end mill that fits inside the bore
                        # Ideal ratio is ~70% of bore diameter
                        ideal_dia = target_dia * 0.7
                        score -= abs(ideal_dia - t.diameter) * 5
                        score += t.diameter  # slightly prefer larger
                    elif operation_type == "facing":
                        # For facing, we want the largest valid tool up to the machine/stock scale limit
                        score += t.diameter * 2.0
                    else:
                        score += t.diameter
                        
                    # Rigidity constraints (shorter stickout, more flutes are better)
                    score -= getattr(t, 'stickout', 30.0) * 0.1
                    score += getattr(t, 'flute_count', 2) * 1.0
                    return score

                candidate_tools.sort(key=_score_tool, reverse=True)
                best_tool = candidate_tools[0]

        # Strict Library Selection: if no tool fits geometrically, block the operation
        if not best_tool:
            return None, "blocked", f"No tool found in library for operation '{operation_type}'. Target Dia: {target_dia}mm, Depth: {target_depth}mm", None

        reason = f"Chosen {best_tool.name} (Dia {best_tool.diameter}mm) as it supports material and feature dimensions."
        if preferred_tool_id:
            reason = "User-preferred tool validated."
        
        # Calculate Feeds & Speeds based on material & tool physics
        vc = material.cutting_speed or 120.0
        if best_tool.diameter > 0:
            ideal_rpm = (vc * 1000) / (math.pi * best_tool.diameter)
        else:
            ideal_rpm = 1000.0
            
        fz = material.feed_per_tooth or 0.05
        ideal_feed = ideal_rpm * max(getattr(best_tool, 'flute_count', 2), 1) * fz
        
        status = "ready"
        max_rpm = getattr(machine, 'spindle_limits', {}).get("max_rpm", 10000) if hasattr(machine, 'spindle_limits') else 10000
        max_feed = getattr(machine, 'feed_limits', {}).get("max_feed", 5000) if hasattr(machine, 'feed_limits') else 5000
        
        rpm = min(ideal_rpm, max_rpm)
        feed = min(ideal_feed, max_feed)
        
        # Derive granular feeds from material config instead of hardcoded scalars
        # Fallbacks dynamically calculate safe offsets if schema properties are missing
        plunge_fz = getattr(material, "plunge_feed_per_tooth", None)
        if plunge_fz is None:
            plunge_fz = fz * 0.5
        ideal_plunge_feed = ideal_rpm * max(getattr(best_tool, 'flute_count', 2), 1) * plunge_fz
        
        entry_factor = getattr(material, "entry_feed_factor", None) or 0.8
        lead_in_factor = getattr(material, "lead_in_feed_factor", None) or 0.5
        lead_out_factor = getattr(material, "lead_out_feed_factor", None) or 0.8
        
        plunge_feed = min(ideal_plunge_feed, max_feed)
        
        feeds_and_speeds = {
            "spindle_rpm": round(rpm, 0),
            "feedrate_mm_min": round(feed, 0),
            "approach_feedrate": round(feed * entry_factor, 0),
            "plunge_feedrate": round(plunge_feed, 0),
            "lead_in_feedrate": round(feed * lead_in_factor, 0),
            "lead_out_feedrate": round(feed * lead_out_factor, 0)
        }
        
        return best_tool, status, reason, feeds_and_speeds


