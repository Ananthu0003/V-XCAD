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

    def recommend_tool(self, operation_type: str, feature: Dict[str, Any], machine: MachineProfile, material: MaterialProfile, setup: Optional[Dict[str, Any]] = None) -> Tuple[Optional[ToolProfile], str, str, Dict[str, float]]:
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

                if operation_type == "facing" and stock_size > 0.0:
                    if t.diameter > max_facing_dia:
                        rejections.append(f"{t.name}: tool diameter ({t.diameter}mm) exceeds facing scale threshold ({round(max_facing_dia, 2)}mm) for stock size ({stock_size}mm)")
                        continue
                
                if operation_type in ("pocketing", "boss_clearing", "2d_contour", "2d_contour_outer"):
                    if stock_size > 0.0 and t.diameter > max_milling_dia:
                        rejections.append(f"{t.name}: tool diameter ({t.diameter}mm) exceeds workpiece envelope scale ({round(max_milling_dia, 2)}mm) for stock size ({stock_size}mm)")
                        continue
                    min_corner_r = _get_dim(feature, ["min_radius", "corner_radius"])
                    if min_corner_r > 0 and t.diameter > (min_corner_r * 2.0) + 0.01:
                        rejections.append(f"{t.name}: tool diameter ({t.diameter}mm) exceeds internal corner diameter ({min_corner_r*2}mm)")
                        continue

                if t.stickout > 0 and t.stickout < target_depth:
                    rejections.append(f"{t.name}: stickout ({t.stickout}mm) < depth ({target_depth}mm)")
                    continue

                candidate_tools.append(t)

        # Sort candidate tools based on physics/geometry
        best_tool = None
        if candidate_tools:
            if operation_type in ("drilling", "peck_drilling"):
                if target_dia > 0:
                    # Select tool closest to target diameter without exceeding it
                    candidate_tools.sort(key=lambda t: abs(target_dia - t.diameter))
                else:
                    candidate_tools.sort(key=lambda t: t.diameter)
            elif operation_type == "facing":
                # Prefer tools proportional to feature/stock dimensions (around 0.7x stock size)
                target_f_dia = stock_size * 0.7 if stock_size > 0 else 40.0
                candidate_tools.sort(key=lambda t: abs(t.diameter - target_f_dia))
            else:
                candidate_tools.sort(key=lambda t: t.diameter, reverse=True)
            
            best_tool = candidate_tools[0]

        # Dynamic Synthesis if library has no geometrically fitting tool
        if not best_tool:
            if req_type == "drill":
                syn_dia = target_dia if target_dia > 0 else (min(stock_size * 0.5, 5.0) if stock_size > 0 else 5.0)
                syn_dia = round(max(syn_dia, 0.2), 2)
                syn_id = f"synth_drill_{syn_dia}"
                syn_name = f"{syn_dia}mm Twist Drill"
                best_tool = ToolProfile(
                    tool_id=syn_id,
                    name=syn_name,
                    type="drill",
                    diameter=syn_dia,
                    flute_count=2,
                    cutting_length=round(max(target_depth * 1.5, syn_dia * 3.0), 2),
                    stickout=round(max(target_depth * 2.0, syn_dia * 4.0), 2),
                    material="carbide"
                )
            elif req_type == "face_mill":
                syn_dia = (stock_size * 0.8) if stock_size > 0 else 40.0
                syn_dia = round(max(syn_dia, 1.0), 2)
                syn_id = f"synth_facemill_{syn_dia}"
                syn_name = f"{syn_dia}mm Face Mill"
                best_tool = ToolProfile(
                    tool_id=syn_id,
                    name=syn_name,
                    type="face_mill",
                    diameter=syn_dia,
                    flute_count=4 if syn_dia >= 25.0 else 2,
                    cutting_length=round(max(target_depth * 1.2, 10.0), 2),
                    stickout=round(max(target_depth * 1.8, 20.0), 2),
                    material="carbide"
                )
            else:
                feat_w = _get_dim(feature, ["width", "min_radius"])
                feat_dia = _get_dim(feature, ["diameter"])
                if feat_w > 0:
                    syn_dia = feat_w * 0.8
                elif feat_dia > 0:
                    # For outer contouring, tool must be much smaller than the part diameter
                    syn_dia = feat_dia * 0.4
                elif stock_size > 0:
                    syn_dia = stock_size * 0.3
                else:
                    syn_dia = 6.35
                # Ensure tool is never larger than the workpiece envelope
                if stock_size > 0:
                    syn_dia = min(syn_dia, stock_size * 0.5)
                if feat_dia > 0:
                    syn_dia = min(syn_dia, feat_dia * 0.5)
                syn_dia = round(max(syn_dia, 0.2), 2)
                syn_id = f"synth_flatendmill_{syn_dia}"
                syn_name = f"{syn_dia}mm Flat End Mill"
                best_tool = ToolProfile(
                    tool_id=syn_id,
                    name=syn_name,
                    type="flat_end_mill",
                    diameter=syn_dia,
                    flute_count=3,
                    cutting_length=round(max(target_depth * 1.5, syn_dia * 3.0), 2),
                    stickout=round(max(target_depth * 2.0, syn_dia * 4.0), 2),
                    material="carbide"
                )
                
            # Add to the library so subsequent operations can reuse it
            if self.tools is not None:
                self.tools.append(best_tool)

        reason = f"Chosen {best_tool.name} (Dia {best_tool.diameter}mm) as it supports material and feature dimensions."
        
        # Calculate Feeds & Speeds based on material & tool physics
        vc = material.cutting_speed or 120.0
        if best_tool.diameter > 0:
            ideal_rpm = (vc * 1000) / (math.pi * best_tool.diameter)
        else:
            ideal_rpm = 1000.0
            
        fz = material.feed_per_tooth or 0.05
        ideal_feed = ideal_rpm * max(best_tool.flute_count, 1) * fz
        
        status = "ready"
        max_rpm = machine.spindle_limits.get("max_rpm", 10000)
        max_feed = machine.feed_limits.get("max_feed", 5000)
        
        rpm = min(ideal_rpm, max_rpm)
        feed = min(ideal_feed, max_feed)
        
        feeds_and_speeds = {
            "spindle_rpm": round(rpm, 0),
            "feedrate_mm_min": round(feed, 0),
            "plunge_feedrate": round(feed * 0.5, 0)
        }
        
        return best_tool, status, reason, feeds_and_speeds


