import math
from typing import Dict, Any, List, Tuple, Optional
from app.models.manufacturing import MachineProfile, MaterialProfile, ToolProfile

class ToolRecommendationEngine:
    """
    Selects the best available tool for a given operation, and computes optimal Feeds & Speeds
    clamped to the machine limits.
    """
    def __init__(self, tool_library: List[ToolProfile]):
        self.tools = tool_library

    def recommend_tool(self, operation_type: str, feature: Dict[str, Any], machine: MachineProfile, material: MaterialProfile) -> Tuple[Optional[ToolProfile], str, str, Dict[str, float]]:
        """
        Returns: (selected_tool, status, reason, feeds_and_speeds)
        """
        if not self.tools:
            return None, "blocked", "Tool library is empty", {}
            
        candidate_tools = []
        
        # Determine tool type requirement based on operation_type
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
        elif operation_type in ("od_turning", "id_turning", "turning"):
            req_type = "turning_tool"
        elif operation_type in ("parting", "grooving"):
            req_type = "cut_off_tool"
        elif operation_type == "knurling":
            req_type = "knurling_tool"
        elif operation_type == "turning_required":
            # 3-axis mill cannot turn — return blocked immediately, no tool search needed
            return None, "blocked", "Requires lathe, mill-turn, or rotary 4/5-axis setup. No tool will be selected.", {}
        elif operation_type in ("rotary_milling", "indexed_4axis_milling", "multi_axis_surface_milling", "pocketing", "boss_clearing", "2d_contour"):
            req_type = "flat_end_mill"
        rejections = []
        target_depth = feature.get("dimensions", {}).get("depth", feature.get("height", 10.0))
        
        for t in self.tools:
            # 1. Type Match
            if t.type != req_type and not (req_type == "face_mill" and t.type == "flat_end_mill") and not (req_type == "flat_end_mill" and t.type in ["ball_end_mill", "bull_nose_end_mill", "end_mill"]):
                rejections.append(f"{t.name}: wrong type")
                continue
                
            # Prevent fly cutters/face mills from being used as standard end mills
            if req_type == "flat_end_mill" and ("fly cutter" in t.name.lower() or "face mill" in t.name.lower() or t.type == "face_mill"):
                rejections.append(f"{t.name}: inappropriate for {operation_type}")
                continue
                
            # 2. Material Match
            material_id_lower = material.material_id.lower()
            material_name_lower = material.material_name.lower() if getattr(material, 'material_name', None) else ""
            is_compatible = False
            for comp_mat in t.compatible_materials:
                if comp_mat.lower() in material_id_lower or comp_mat.lower() in material_name_lower or comp_mat.lower() == "all":
                    is_compatible = True
                    break
            
            if not is_compatible:
                rejections.append(f"{t.name}: incompatible material")
                continue
                
            # 3. Machine Available
            if machine.machine_id not in t.supported_machines and "all" not in t.supported_machines:
                rejections.append(f"{t.name}: unsupported machine")
                continue
                
            # 4. Geometry constraints
            if operation_type == "drilling":
                target_dia = feature.get("radius", 0) * 2
                if target_dia == 0 and "dimensions" in feature:
                    target_dia = feature["dimensions"].get("diameter", 0)
                    if target_dia == 0 and "radius" in feature["dimensions"]:
                        target_dia = feature["dimensions"]["radius"] * 2
                        
                if target_dia > 0 and t.diameter > target_dia + 0.001:
                    rejections.append(f"{t.name}: too large ({t.diameter}mm > {target_dia}mm)")
                    continue  # Too big
            
            if t.stickout < target_depth:
                rejections.append(f"{t.name}: stickout too short ({t.stickout}mm < {target_depth}mm)")
                continue # Can't reach
            
            candidate_tools.append(t)
            
        if not candidate_tools:
            reason = (
                f"No compatible {req_type} found. "
                f"Required: type={req_type}, min_depth={target_depth}mm, material={material.material_name}. "
                f"Rejections: {'; '.join(rejections[:5])}"
            )
            print(f"DEBUG: tool rec blocked for {feature.get('name')}: {reason}")
            return None, "blocked", reason, {}
            
        print(f"DEBUG: candidate tools for {feature.get('name')} (depth {target_depth}): {[t.name for t in candidate_tools]}")
            
        # Sort candidates
        if operation_type == "drilling":
            target_dia = feature.get("radius", 0) * 2
            if target_dia == 0 and "dimensions" in feature:
                target_dia = feature["dimensions"].get("diameter", 0)
                if target_dia == 0 and "radius" in feature["dimensions"]:
                    target_dia = feature["dimensions"]["radius"] * 2
                    
            if target_dia > 0:
                # Filter out tools that are too large
                fitting_tools = [t for t in candidate_tools if t.diameter <= target_dia + 0.1]
                if fitting_tools:
                    candidate_tools = fitting_tools
                else:
                    rejections.append(f"All remaining tools are larger than {target_dia}mm")
                    return None, "blocked", f"No drill found smaller than or equal to {target_dia}mm", {}
                    
                # Closest diameter under target
                candidate_tools.sort(key=lambda t: abs(target_dia - t.diameter))
            else:
                candidate_tools.sort(key=lambda t: t.diameter, reverse=True)
        elif "contour" in operation_type.lower() or "profile" in operation_type.lower():
            # For 2D contours, huge tools (like 40mm) will gouge the part geometry boundaries.
            # Prefer standard end mills around 6mm - 12mm. Sort by closeness to 10mm.
            candidate_tools.sort(key=lambda t: abs(t.diameter - 10.0))
        elif operation_type == "facing":
            # For facing, we actively want the largest tool possible (e.g. Face Mill, Fly Cutter)
            candidate_tools.sort(key=lambda t: t.diameter, reverse=True)
        else:
            # Pocketing / other: Use the largest diameter that fits within the feature's minimum corner radius
            min_radius = feature.get("dimensions", {}).get("min_radius", 0)
            if min_radius > 0:
                fitting_tools = [t for t in candidate_tools if t.diameter <= (min_radius * 2) + 0.1]
                if fitting_tools:
                    candidate_tools = fitting_tools
            # Sort by largest diameter to clear material fastest
            candidate_tools.sort(key=lambda t: t.diameter, reverse=True)
            
        best_tool = candidate_tools[0]
        reason = f"Chosen {best_tool.name} (Dia {best_tool.diameter}mm) as it supports material and depth."
        
        # Calculate Feeds and Speeds
        # RPM = (Vc * 1000) / (pi * D)
        vc = material.cutting_speed
        if best_tool.diameter > 0:
            ideal_rpm = (vc * 1000) / (math.pi * best_tool.diameter)
        else:
            ideal_rpm = 1000
            
        fz = material.feed_per_tooth
        ideal_feed = ideal_rpm * best_tool.flute_count * fz
        
        status = "ready"
        
        # Clamp to machine limits
        max_rpm = machine.spindle_limits.get("max_rpm", 10000)
        max_feed = machine.feed_limits.get("max_feed", 5000)
        
        rpm = ideal_rpm
        feed = ideal_feed
        
        if rpm > max_rpm:
            rpm = max_rpm
            status = "warning"
            reason += f" RPM clamped from {int(ideal_rpm)} to {max_rpm}."
            
        if feed > max_feed:
            feed = max_feed
            status = "warning"
            reason += f" Feed clamped from {int(ideal_feed)} to {max_feed}."
            
        feeds_and_speeds = {
            "spindle_rpm": round(rpm, 0),
            "feedrate_mm_min": round(feed, 0),
            "plunge_feedrate": round(feed * 0.5, 0)
        }
        
        return best_tool, status, reason, feeds_and_speeds
