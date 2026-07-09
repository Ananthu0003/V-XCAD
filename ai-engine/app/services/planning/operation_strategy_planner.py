from typing import List, Dict, Any
from app.models.manufacturing import FeatureDecision
from app.services.planning.operation_planner import CamOperation

class OperationStrategyPlanner:
    """
    Consumes FeatureDecision objects to generate the final CamOperations, ensuring
    strict ordering (Facing -> Roughing -> Drilling -> Finishing).
    """
    
    # Standard CAM operation priority
    ORDERING_PRIORITY = {
        "facing": 10,
        "boss_clearing": 20,
        "pocket_milling": 30,
        "2d_contour": 40,
        "2d_contour_outer": 45,
        "slot_milling": 50,
        "drilling": 60,
        "tapping": 70,
        "chamfer_milling": 80,
        "od_turning": 90,
        "rotary_milling": 95,
        "multi_axis_surface_milling": 97,
        "indexed_4axis_milling": 98,
        "turning_required": 999,
        "unsupported_feature": 1000,
        "unknown_strategy": 1001,
    }

    OPERATION_DISPLAY_NAMES = {
        "facing": "Facing",
        "boss_clearing": "Boss Clearing",
        "pocket_milling": "Pocket Milling",
        "2d_contour": "2D Contour",
        "2d_contour_outer": "2D Contour (Outer)",
        "slot_milling": "Slot Milling",
        "drilling": "Drilling",
        "tapping": "Tapping",
        "chamfer_milling": "Chamfer Milling",
        "od_turning": "OD Turning",
        "rotary_milling": "Rotary Milling",
        "multi_axis_surface_milling": "Multi-Axis Surface Milling",
        "indexed_4axis_milling": "4-Axis Indexed Milling",
        "turning_required": "Turning Required",
        "unsupported_feature": "Unsupported",
        "unknown_strategy": "Unknown",
    }

    def __init__(self):
        pass

    def plan_operations(self, decisions: List[FeatureDecision], setup_id: str) -> List[CamOperation]:
        """
        Converts deterministic FeatureDecisions into the actual Operations array.
        Orders them professionally.
        """
        operations: List[CamOperation] = []
        
        for decision in decisions:
            # Skip features assigned to other setups (unless they are global errors that need showing)
            if decision.setup_assignment != setup_id and decision.status not in ("blocked", "unsupported"):
                continue
                
            op = CamOperation(operation_type=decision.operation_type or "unknown", feature_id=decision.feature_id, setup_id=setup_id)
            
            # Human-readable operation name
            display_name = self.OPERATION_DISPLAY_NAMES.get(
                decision.operation_type or "",
                decision.manufacturing_strategy or decision.operation_type or "Operation"
            )
            op.name = f"{display_name} — {decision.feature_type.replace('_', ' ').title()}"
            op.status = decision.status
            op.parameters["error"] = decision.reason
            op.parameters["errorReason"] = decision.reason
            
            if decision.recommended_machine:
                op.parameters["recommended_machine"] = decision.recommended_machine
                
            if decision.selected_tool:
                op.tool_id = decision.selected_tool.get("tool_id", "")
                op.parameters["tool_selection_reason"] = decision.tool_selection_reason
                op.parameters["tool_diameter"] = decision.selected_tool.get("diameter", 0.0)
                
            if decision.feeds_and_speeds:
                op.parameters["feeds_and_speeds"] = decision.feeds_and_speeds
                
            # If not ready or warning, no toolpaths
            if decision.status in ("blocked", "unsupported", "error"):
                op.parameters["segmentCount"] = 0
                op.toolpaths = []
                
            operations.append(op)
            
        # Sort operations deterministically based on standard CAM priorities
        operations.sort(key=lambda op: self.ORDERING_PRIORITY.get(
            next((d.manufacturing_strategy for d in decisions if d.feature_id == op.feature_id), "unknown_strategy"), 
            999
        ))
        
        # Determine dependencies
        for i in range(1, len(operations)):
            operations[i].parameters["depends_on_operation"] = operations[i-1].id
            
        return operations
