from typing import Dict, Any, Tuple
from app.models.manufacturing import MachineProfile
from app.constants import TURNING_FEATURE_TYPES

class ManufacturingCapabilityMatrix:
    """
    Centralized validation logic for determining if a feature can be manufactured
    on a given machine in a given setup.
    """
    
    @staticmethod
    def evaluate_capability(feature: Dict[str, Any], machine: MachineProfile, setup_axis: list[float]) -> Tuple[bool, str, str]:
        """
        Returns (is_capable, reason, recommended_machine_type)
        """
        feat_type = feature.get("type", "")
        feat_subtype = feature.get("subtype", "")
        
        mtype_str = str(machine.machine_type).lower() if machine and machine.machine_type else ""
        is_turning_machine = any(t in mtype_str for t in ("lathe", "turning", "mill_turn", "swiss", "cnc_lathe"))

        # 1. Turning features (external cylinder, shaft)
        if feat_type in TURNING_FEATURE_TYPES or feat_subtype in TURNING_FEATURE_TYPES:
            feature_axis = feature.get("axis", [0, 0, 1])
            dot = sum(a*b for a, b in zip(feature_axis, setup_axis)) if setup_axis else 0
            
            if is_turning_machine:
                return True, "Turning center supports external cylinder", ""
            elif machine.machine_type in ("4_axis_mill", "5_axis_mill") and machine.rotary_axis_availability:
                return True, "Multi-axis mill supports rotary milling for cylinder", ""
            elif machine.machine_type == "3_axis_mill" and abs(dot) > 0.98:
                return True, "3-axis mill supports aligned cylindrical boss", ""
            else:
                return False, "External cylinder requires turning or 4-axis indexing (unless aligned with tool axis)", "turning_center"
                
        # 2. Multi-axis features (side protrusion, angled holes)
        if feat_type == "side_protrusion":
            if machine.machine_type in ("4_axis_mill", "5_axis_mill", "mill_turn") or is_turning_machine:
                return True, "Machine supports multi-axis/indexing", ""
            else:
                return False, "Side protrusion requires 4-axis indexing or mill-turn", "4_axis_mill"
                
        # 3. Drilling & Boring
        if feat_type in ("hole", "blind_hole", "through_hole", "bore"):
            if "drilling" not in machine.supported_operations and not is_turning_machine:
                return False, "Machine does not support drilling", "3_axis_mill"
                
            # Basic setup axis check: if the hole is on the side, we need 4-axis or turning
            feature_axis = feature.get("axis", [0, 0, 1])
            dot = sum(a*b for a, b in zip(feature_axis, setup_axis)) if setup_axis else 0
            
            # If hole axis is not parallel to spindle axis, it's a side hole.
            if abs(dot) < 0.98:
                if machine.machine_type == "3_axis_mill":
                    return False, "Side holes cannot be drilled on a standard 3-axis mill without a secondary setup.", "4_axis_mill"
            
            return True, "Machine supports drilling in this orientation", ""
            
        # 4. Standard 2.5D Milling (pocket, contour, face, slot, boss, step)
        if feat_type == "face":
            return True, "Machine supports facing", ""

        if feat_type in ("pocket", "contour", "slot", "boss", "step"):
            if is_turning_machine and not machine.live_tooling and not any(t in mtype_str for t in ("mill_turn", "swiss", "live")):
                return False, "Standard lathe cannot perform milling operations without live tooling", "mill_turn"
            return True, "Machine supports standard 2.5D milling", ""
            
        # Catch all
        return False, f"Unsupported feature type: {feat_type}", "mill_turn"
