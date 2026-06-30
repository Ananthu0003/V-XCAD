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
                
        return {"valid": True, "reason": None}
