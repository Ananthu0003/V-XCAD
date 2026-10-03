import logging
from typing import Dict, Any, List

logger = logging.getLogger(__name__)

class ManufacturingCapabilityValidator:
    """
    Validates if a machine/tool/setup can physically perform a given operation.
    Runs before any toolpaths are generated.
    """
    
    @staticmethod
    def validate_operation(operation: Dict[str, Any], setup: Dict[str, Any], machine: Dict[str, Any], tool: Dict[str, Any]) -> Dict[str, Any]:
        """
        Returns a dict with {"valid": bool, "reason": str}
        """
        op_type = operation.get('type', 'unknown')
        
        # 1. Block legacy or unknown types immediately
        if op_type in ['legacy_path', 'mock_path', 'fallback_path', 'silhouette_path', 'generic_path', 'unknown', 'blocked']:
            return {"valid": False, "reason": f"Operation type '{op_type}' is unsupported or blocked."}
            
        # 2. Check for missing critical data
        if not machine:
            return {"valid": False, "reason": "No machine selected for operation."}
        if not tool:
            return {"valid": False, "reason": "No tool selected for operation."}
            
        # 3. Setup orientation validation (e.g. side holes on 3-axis)
        axes = machine.get('axes', 3)
        if axes == 3:
            # Simple check: if feature orientation isn't Z, it's a side hole
            tool_axis = operation.get('tool_axis', [0, 0, 1])
            # If Z component is not dominant, it's likely a side feature
            if abs(tool_axis[2]) < 0.99:
                return {"valid": False, "reason": "Hole or feature axis is not aligned with current setup Z-axis. Requires secondary setup or indexed 4-axis/5-axis machining."}
                
        # 4. Spindle RPM limits
        rpm = operation.get('parameters', {}).get('spindle_rpm')
        if rpm is not None:
            max_rpm = machine.get('max_spindle_rpm', 100000) # Default high if not set
            if rpm > max_rpm:
                return {"valid": False, "reason": f"Requested spindle speed ({rpm} RPM) exceeds machine maximum ({max_rpm} RPM)."}
                
        # 5. Phase 8 Stage 3: Kinematics Validation
        # Check if operation requires simultaneous 5-axis
        if operation.get("requires_continuous_5axis", False) or op_type in ["5x_swarf", "5x_contour"]:
            return {"valid": False, "reason": "Simultaneous 5-axis output is blocked unless a verified inverse-kinematics solution is available."}
            
        # Check Indexed Rotary Machining (3+2)
        if operation.get("requires_4axis_indexing", False) or operation.get("requires_5axis_indexing", False):
            # E.g. requiredSetupAxis = [0, 1, 0] instead of [0, 0, 1]
            req_axis = operation.get("requiredSetupAxis")
            if req_axis:
                kinematics = machine.get("kinematics", {})
                rotary_axes = kinematics.get("rotary_axes", [])
                if not rotary_axes:
                    return {"valid": False, "reason": "Indexed machining requires machine kinematics with defined rotary axes."}
                
                # Simplified check: just ensuring they don't request a non-Z axis if the machine has no rotary capability
                # Full validation would compute the Euler angles and compare against min/max limits
                # For this stage, we verify they have defined axes
                has_a = any(r.get("axis") == "A" for r in rotary_axes)
                has_b = any(r.get("axis") == "B" for r in rotary_axes)
                has_c = any(r.get("axis") == "C" for r in rotary_axes)
                
                if abs(req_axis[2]) < 0.99: # Not Z
                    # We need at least one rotary axis to reposition
                    if not (has_a or has_b or has_c):
                        return {"valid": False, "reason": "Machine lacks rotary kinematics to achieve the required indexed setup axis."}

        return {"valid": True, "reason": None}
