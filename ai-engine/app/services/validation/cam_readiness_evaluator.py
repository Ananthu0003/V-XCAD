from typing import Dict, Any, List

class CamReadinessEvaluator:
    """
    Computes final readiness score and CAM status by prioritizing schema staleness,
    operation readiness, safety validation, etc.
    """
    
    @staticmethod
    def evaluate(
        operations: List[Dict[str, Any]], 
        schema_validation: Dict[str, Any], 
        hashes_match: bool,
        cam_hashes_schema: str
    ) -> Dict[str, Any]:
        
        status = "ready_for_postprocessing"
        score = 100
        can_generate_gcode = True
        blocking_reasons = []
        errors = []
        operation_statuses = []
        
        # Determine global staleness from hashes and root schemas
        global_stale = not hashes_match or cam_hashes_schema != "semantic_v1" or not schema_validation.get("global_schema_valid", True)
        
        stale_ops = schema_validation.get("stale_operations", set())
        
        if global_stale:
            status = "toolpaths_outdated"
            can_generate_gcode = False
            score = 40
            blocking_reasons.append("Toolpaths are globally outdated or missing. Regenerate toolpaths.")
            errors.append({
                "level": "error",
                "code": "OUTDATED_TOOLPATH_SCHEMA",
                "message": "Toolpaths are outdated. Regenerate toolpaths before G-code generation.",
                "required_toolpath_schema_version": "semantic_v1",
                "detected_toolpath_schema_version": schema_validation.get("detected_root_schema")
            })
            
        elif len(stale_ops) > 0:
            status = "toolpaths_outdated"
            can_generate_gcode = False
            score = 40
            blocking_reasons.append("Some operation toolpaths use outdated schema. Regenerate toolpaths.")
            
        # Prioritize operation statuses (blocked > warning > ok)
        for op in operations:
            op_id = op.get("id")
            feat_id = op.get("feature_id") or op.get("featureId")
            
            is_op_stale = global_stale or op_id in stale_ops
            
            if is_op_stale:
                op_schema_details = schema_validation.get("operation_details", {}).get(op_id, {})
                errors.append({
                    "level": "error",
                    "operation_id": op_id,
                    "feature_id": feat_id,
                    "code": "OUTDATED_TOOLPATH_SCHEMA",
                    "message": "Operation toolpath uses outdated or missing schema. Regenerate toolpaths."
                })
                operation_statuses.append({
                    "operation_id": op_id,
                    "feature_id": feat_id,
                    "status": "blocked",
                    "code": "OUTDATED_TOOLPATH_SCHEMA",
                    "blocked_reason": "Operation toolpath uses outdated or missing schema. Regenerate toolpaths.",
                    "detected_schema_version": op_schema_details.get("detected_schema_version"),
                    "required_schema_version": "semantic_v1"
                })
                can_generate_gcode = False
            else:
                op_status = op.get("status", "planned")
                
                op_code = None
                op_blocked_reason = None
                if op_status in ["error", "blocked", "blocked_requires_reorientation", "missing_tool"]:
                    can_generate_gcode = False
                    if status != "toolpaths_outdated":
                        status = "operations_blocked"
                        score = min(score, 60)
                        
                    # Extract reason from op parameters
                    params = op.get("parameters", {})
                    op_blocked_reason = params.get("error") or params.get("errorReason") or op.get("reason")
                    op_code = "OPERATION_ERROR"
                    
                    if not op_blocked_reason:
                        op_blocked_reason = f"Operation is {op_status} but no specific reason was provided."
                        
                    errors.append({
                        "level": "error",
                        "operation_id": op_id,
                        "feature_id": feat_id,
                        "code": op_code,
                        "message": op_blocked_reason
                    })
                elif op_status == "unsupported":
                    # Unsupported features (like turning on a mill) shouldn't block the rest of the G-Code
                    score = min(score, 80)
                    params = op.get("parameters", {})
                    op_blocked_reason = params.get("error") or params.get("errorReason") or op.get("reason") or "Requires different machine"
                    op_code = "UNSUPPORTED_OPERATION"
                    
                    errors.append({
                        "level": "warning",
                        "operation_id": op_id,
                        "feature_id": feat_id,
                        "code": op_code,
                        "message": f"Feature is unsupported in current setup and will be skipped in G-Code: {op_blocked_reason}"
                    })
                        
                operation_statuses.append({
                    "operation_id": op_id,
                    "feature_id": feat_id,
                    "status": op_status,
                    "code": op_code,
                    "blocked_reason": op_blocked_reason,
                    "toolpath_schema_version": "semantic_v1" if not is_op_stale else op_schema_details.get("detected_schema_version")
                })
                
        if not operations:
            status = "missing_toolpaths"
            score = 20
            can_generate_gcode = False
            blocking_reasons.append("No operations found.")
            errors.append({"level": "error", "code": "NO_OPERATIONS", "message": "No operations found. Please plan operations before generating G-Code."})

        msg = ""
        if not can_generate_gcode and status == "toolpaths_outdated":
            msg = "Toolpaths are outdated. Regenerate toolpaths before G-code generation."
        elif not can_generate_gcode and status == "operations_blocked":
            msg = "Some operations are blocked. Resolve errors before G-code generation."

        return {
            "cam_readiness_score": score,
            "status": status,
            "can_generate_gcode": can_generate_gcode,
            "blocking_reasons": blocking_reasons,
            "errors": errors,
            "operation_statuses": operation_statuses,
            "message": msg
        }
