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
        "facing_turning": 5,
        "facing": 10,
        "od_turning": 15,
        "boss_clearing": 20,
        "pocket_milling": 30,
        "slot_milling": 40,
        "drilling": 50,
        "peck_drilling": 52,
        "helical_bore_milling": 55,
        "id_boring": 60,
        "od_finish_turning": 65,
        "2d_contour": 70,
        "2d_contour_outer": 75,
        "grooving": 80,
        "tapping": 90,
        "chamfer_milling": 95,
        "rotary_milling": 100,
        "multi_axis_surface_milling": 105,
        "indexed_4axis_milling": 110,
        "parting_off": 120,
        "turning_required": 999,
        "unsupported_feature": 1000,
        "unknown_strategy": 1001,
    }

    OPERATION_DISPLAY_NAMES = {
        "facing_turning": "Facing (Lathe)",
        "facing": "Facing",
        "od_turning": "OD Turning (Roughing)",
        "od_finish_turning": "OD Finish Turning",
        "id_boring": "ID Boring",
        "grooving": "Grooving",
        "parting_off": "Parting Off",
        "boss_clearing": "Boss Clearing",
        "pocket_milling": "Pocket Milling",
        "2d_contour": "2D Contour",
        "2d_contour_outer": "2D Contour (Outer)",
        "slot_milling": "Slot Milling",
        "drilling": "Drilling",
        "peck_drilling": "Peck Drilling",
        "helical_bore_milling": "Helical Bore Milling",
        "tapping": "Tapping",
        "chamfer_milling": "Chamfer Milling",
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
            
            # Dynamically set machining strategy if available
            if decision.manufacturing_strategy:
                op.machining_strategy = decision.manufacturing_strategy
                
            # Dynamically set safe heights based on local feature coordinates
            local_feat = decision.parameters.get("setup_local_feature", {})
            if isinstance(local_feat, dict) and "localTopZ" in local_feat:
                top_z = float(local_feat.get("localTopZ", 0.0))
                depth_val = local_feat.get("depth")
                if depth_val is not None and float(depth_val) > 0:
                    bottom_z = top_z - float(depth_val)
                elif "localBottomZ" in local_feat and local_feat["localBottomZ"] is not None:
                    bottom_z = float(local_feat["localBottomZ"])
                else:
                    bottom_z = None

                if bottom_z is not None:
                    op.safe_heights["top"] = top_z
                    op.safe_heights["bottom"] = bottom_z
                    op.safe_heights["clearance"] = top_z + 15.0
                    op.safe_heights["retract"] = top_z + 5.0
                    op.safe_heights["feed"] = top_z + 2.0
                else:
                    op.status = "blocked"
                    op.parameters["error"] = "FEATURE_GEOMETRY_UNAVAILABLE: feature depth/bottomZ could not be resolved"
                
                mr = local_feat.get("machiningRegion")
                if mr and isinstance(mr, dict):
                    op.geometry = mr
            
            # Human-readable operation name
            display_name = self.OPERATION_DISPLAY_NAMES.get(
                decision.operation_type or "",
                decision.manufacturing_strategy or decision.operation_type or "Operation"
            )
            op.name = f"{display_name} — {(decision.feature_type or 'unknown').replace('_', ' ').title()}"
            op.status = decision.status
            if decision.status != "ready":
                op.parameters["error"] = decision.reason
                op.parameters["errorReason"] = decision.reason
            
            if decision.recommended_machine:
                op.parameters["recommended_machine"] = decision.recommended_machine
                
            if decision.selected_tool:
                op.tool_id = decision.selected_tool.get("tool_id", "")
                op.parameters["tool_selection_reason"] = decision.tool_selection_reason
                op.parameters["tool_diameter"] = decision.selected_tool.get("diameter", 0.0)
                # Attach the full tool dict so downstream toolpath engines can read
                # operation["tool"]["diameter"] (ParametricToolpathEngine contract) and
                # the response serialiser can resolve the assigned tool.
                op.tool = decision.selected_tool
                op.selected_tool = decision.selected_tool
                
            if decision.feeds_and_speeds:
                fs = decision.feeds_and_speeds
                op.parameters["feeds_and_speeds"] = fs
                rpm_val = fs.get("spindle_rpm") or fs.get("spindleSpeed")
                feed_val = fs.get("feedrate_mm_min") or fs.get("feedRate")
                plunge_val = fs.get("plunge_feedrate") or fs.get("plungeRate")
                if rpm_val:
                    op.parameters["spindleSpeed"] = rpm_val
                    op.parameters["spindle_rpm"] = rpm_val
                if feed_val:
                    op.parameters["feedRate"] = feed_val
                    op.parameters["feed_rate"] = feed_val
                if plunge_val:
                    op.parameters["plungeRate"] = plunge_val
                    op.parameters["plunge_rate"] = plunge_val
                if "max_stepdown" in fs or "maxStepdown" in fs:
                    stepdown_val = fs.get("max_stepdown") or fs.get("maxStepdown")
                    op.parameters["maxStepdown"] = stepdown_val
                    op.parameters["max_stepdown"] = stepdown_val
                
            # If not ready or warning, no toolpaths
            if decision.status in ("blocked", "unsupported", "error"):
                op.parameters["segmentCount"] = 0
                op.toolpaths = []
                
            operations.append(op)
            
        # Sort operations deterministically based on standard CAM priorities and hierarchical geometry
        def _get_sort_key(op: CamOperation) -> tuple:
            strat = next((d.manufacturing_strategy for d in decisions if d.feature_id == op.feature_id), None)
            priority = self.ORDERING_PRIORITY.get(strat, self.ORDERING_PRIORITY.get(op.type, 999))
            top_z = float(op.safe_heights.get("top", 0.0))
            tool_dia = float(op.parameters.get("tool_diameter", 0.0) or 0.0)
            geom = op.geometry or {}
            feat_dia = float(geom.get("diameter") or (geom.get("radius", 0.0) * 2.0) or tool_dia or 0.0)
            depth = abs(float(op.safe_heights.get("bottom", 0.0)) - top_z) if "bottom" in op.safe_heights else 0.0
            return (priority, -round(top_z, 2), -round(feat_dia, 2), round(depth, 2), str(op.id or op.feature_id or ""))

        operations.sort(key=_get_sort_key)
        
        # Determine dependencies
        for i in range(1, len(operations)):
            operations[i].parameters["depends_on_operation"] = operations[i-1].id
            
        return operations
