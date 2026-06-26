import uuid
from typing import List, Dict, Any
from app.models.schemas import CamFeatureSchema, CamOperationSchema
from app.services.operation_planner import CamOperation

class OperationStrategyPlanner:
    """
    Determines the multi-operation strategy for a given feature.
    For example, a single 'hole' feature might require a Center Drill,
    then a Peck Drill, then a Tap operation.
    """
    
    def __init__(self):
        pass

    def plan_strategies(self, features: List[Dict[str, Any]], setup_plan: Dict[str, Any]) -> List[CamOperation]:
        """
        Takes a list of features and a specific setup plan, and generates
        the ordered list of operations for features assigned to this setup.
        
        Each feature produces operations ONLY under its assignedSetupId.
        No duplicate/pending operations are created in other setups.
        """
        setup_id = setup_plan.get("setupId", "setup_1")
        setup_type = setup_plan.get("setupType", "milling_3axis")
        operations: List[CamOperation] = []
        
        for feature in features:
            feat_id = feature.get("id")
            if not feat_id:
                continue
                
            machining_info = feature.get("machining_info", {})
            status = machining_info.get("status")
            feat_setup_id = machining_info.get("setupId")
            
            # Only generate operations for features assigned to THIS setup
            if feat_setup_id != setup_id:
                continue
                
            ops_for_feature = self._generate_strategy_for_feature(feature, setup_id, setup_type)
            
            # Set operation status based on feature status
            if status == "machinable_in_active_setup":
                # Normal — operations keep their default "planned" status
                pass
            elif status == "machinable_in_secondary_setup":
                # Feature is in a secondary setup — its ops are planned for that setup
                # They will be "planned" status when viewed under the correct setup
                pass
            elif status in ("requires_turning", "requires_4axis_indexing"):
                for op in ops_for_feature:
                    op.status = "pending_secondary_setup"
                    op.toolpaths = []
            elif status == "unsupported":
                for op in ops_for_feature:
                    op.status = "error"
                    op.parameters["error"] = machining_info.get("reason", "Feature is unsupported")
                    op.toolpaths = []
            else:
                for op in ops_for_feature:
                    op.status = "error"
                    op.parameters["error"] = f"Invalid status: {status}"
                    op.toolpaths = []
            
            # If region is invalid, mark all generated operations as error with diagnostics
            machining_region = feature.get("machiningRegion", {})
            if not machining_region.get("valid", True):
                error_reason = machining_region.get("errorReason", "Invalid machining region")
                for op in ops_for_feature:
                    op.status = "error"
                    op.parameters["error"] = error_reason
                    op.parameters["errorReason"] = error_reason
                    op.parameters["segmentCount"] = 0
                    op.toolpaths = []
            
            operations.extend(ops_for_feature)
            
        return operations
        
    def _generate_strategy_for_feature(self, feature: Dict[str, Any], setup_id: str, setup_type: str = "milling_3axis") -> List[CamOperation]:
        feat_type = feature.get("type", "")
        feat_subtype = feature.get("subtype", "")
        ops = []
        
        # Simple strategy generation based on feature type
        if feat_type in ("hole", "blind_hole", "through_hole"):
            # Drill strategy: Center drill (optional, we'll skip for now unless requested), then Drill
            op = CamOperation(operation_type="drilling", feature_id=feature.get("id"), setup_id=setup_id)
            op.name = f"Drill {feature.get('name', feat_type)}"
            ops.append(op)
            
            # If the feature has threads (e.g. subtype='threaded_hole'), we could add a Tap op here:
            if feature.get("subtype") == "threaded_hole":
                tap_op = CamOperation(operation_type="tapping", feature_id=feature.get("id"), setup_id=setup_id)
                tap_op.name = f"Tap {feature.get('name', feat_type)}"
                ops.append(tap_op)
                
        elif feat_type == "boss":
            machining_region = feature.get("machiningRegion", {})
            region_type = machining_region.get("regionType", "")
            if region_type == "boss_clearing_region":
                op = CamOperation(operation_type="boss_clearing", feature_id=feature.get("id"), setup_id=setup_id)
                op.name = f"Boss Clear {feature.get('name', feat_type)}"
                ops.append(op)
            else:
                op = CamOperation(operation_type="boss_clearing", feature_id=feature.get("id"), setup_id=setup_id)
                op.name = f"Boss Clear {feature.get('name', feat_type)}"
                op.status = "error"
                op.parameters["error"] = f"Boss requires boss_clearing_region, got: {region_type or 'none'}"
                op.parameters["segmentCount"] = 0
                op.toolpaths = []
                ops.append(op)
            
        elif feat_type in ("external_cylinder", "shaft") or feat_subtype in ("shaft", "external_cylinder"):
            if setup_type in ("turning", "mill_turn"):
                op = CamOperation(operation_type="od_turning", feature_id=feature.get("id"), setup_id=setup_id)
                op.status = "planned"
                op.machining_strategy = "turning_profile"
                op.name = f"External Turning {feature.get('name', feat_type)}"
                ops.append(op)
            elif setup_type == "indexed_4axis":
                op = CamOperation(operation_type="rotary_milling", feature_id=feature.get("id"), setup_id=setup_id)
                op.status = "planned"
                op.machining_strategy = "rotary_contour"
                op.name = f"Rotary Milling {feature.get('name', feat_type)}"
                ops.append(op)
            else:
                op = CamOperation(operation_type="external_cylinder_unsupported", feature_id=feature.get("id"), setup_id=setup_id)
                op.name = f"Blocked: External Cylinder {feature.get('name', feat_type)}"
                op.status = "blocked"
                op.parameters["error"] = "External cylinder / shaft requires turning, mill-turn, or 4-axis rotary setup. Current setup is 3-axis milling."
                op.parameters["errorReason"] = "External cylinder / shaft requires turning, mill-turn, or 4-axis rotary setup. Current setup is 3-axis milling."
                op.parameters["segmentCount"] = 0
                op.toolpaths = []
                ops.append(op)
                
        elif feat_type == "side_protrusion" or feat_subtype == "side_protrusion":
            if setup_type == "indexed_4axis":
                op = CamOperation(operation_type="rotary_milling", feature_id=feature.get("id"), setup_id=setup_id)
                op.machining_strategy = "rotary_contour"
                op.name = f"Rotary Milling {feature.get('name', feat_type)}"
                ops.append(op)
            else:
                op = CamOperation(operation_type="side_feature", feature_id=feature.get("id"), setup_id=setup_id)
                op.name = f"Blocked: Side Protrusion {feature.get('name', feat_type)}"
                op.status = "blocked"
                op.parameters["error"] = "Side protrusion requires secondary setup or 4-axis indexing."
                op.parameters["errorReason"] = "Side protrusion requires secondary setup or 4-axis indexing."
                op.parameters["segmentCount"] = 0
                op.toolpaths = []
                ops.append(op)
                
        elif feat_type == "pocket":
            op = CamOperation(operation_type="pocketing", feature_id=feature.get("id"), setup_id=setup_id)
            op.name = f"Pocket Clear {feature.get('name', feat_type)}"
            ops.append(op)
            
        elif feat_type in ("contour", "step"):
            op = CamOperation(operation_type="2d_contour", feature_id=feature.get("id"), setup_id=setup_id)
            op.name = f"Contour {feature.get('name', feat_type)}"
            ops.append(op)
            
        elif feat_type == "face":
            op = CamOperation(operation_type="facing", feature_id=feature.get("id"), setup_id=setup_id)
            op.name = f"Face {feature.get('name', feat_type)}"
            ops.append(op)
            
        else:
            # Catch-all: never silently skip a recognized feature
            op = CamOperation(operation_type="unknown", feature_id=feature.get("id"), setup_id=setup_id)
            op.name = f"Unsupported: {feat_type or 'unknown'}"
            op.status = "error"
            op.parameters["error"] = f"No operation strategy for feature type: {feat_type}"
            op.parameters["segmentCount"] = 0
            op.toolpaths = []
            ops.append(op)
            
        return ops

