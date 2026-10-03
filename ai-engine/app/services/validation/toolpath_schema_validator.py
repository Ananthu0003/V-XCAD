from typing import Dict, Any, List

SEMANTIC_V1_TYPES = {
    "rapid_clearance",
    "rapid_xy",
    "approach_retract",
    "plunge",
    "cut",
    "arc_cw",
    "arc_ccw",
    "retract_clearance",
    "drill_cycle",
    "dwell"
}

class ToolpathSchemaValidator:
    """
    Validates toolpath payloads to ensure they strictly follow the semantic_v1 schema.
    Rejects any legacy or raw schemas (e.g., rapid, feed, linear).
    """
    
    @staticmethod
    def validate(operations: List[Dict[str, Any]], toolpaths_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Validates the schema of actual toolpaths.
        Returns detailed validation result.
        """
        result = {
            "is_valid": True,
            "stale_operations": set(),
            "global_schema_valid": True,
            "detected_root_schema": None,
            "required_schema": "semantic_v1",
            "operation_details": {}
        }
        
        # 1. Root schema validation
        root_schema = toolpaths_data.get("toolpath_schema_version")
        result["detected_root_schema"] = root_schema
        if root_schema != "semantic_v1":
            result["is_valid"] = False
            result["global_schema_valid"] = False
            
        all_tp = toolpaths_data.get("toolpaths", [])
        tp_by_op = {}
        for tp in all_tp:
            op_id = tp.get("operationId")
            if op_id:
                tp_by_op.setdefault(op_id, []).append(tp)
                
        # 2. Operation and Segment level validation
        for op in operations:
            op_id = op.get("id")
            
            op_schema = op.get("toolpath_schema_version")
            op_valid = True
            invalid_reason = None
            
            if op_schema != "semantic_v1":
                op_valid = False
                invalid_reason = f"Missing or invalid operation schema. Detected: {op_schema}"
                
            # If operation claims to be valid, inspect actual segments
            if op_valid:
                op_tps = tp_by_op.get(op_id, [])
                for tp in op_tps:
                    tp_type = (tp.get("type") or tp.get("moveType") or tp.get("commandType") or "").lower()
                    if tp_type not in SEMANTIC_V1_TYPES:
                        op_valid = False
                        invalid_reason = f"Invalid segment type detected: '{tp_type}'"
                        break
                        
            if not op_valid:
                result["is_valid"] = False
                result["stale_operations"].add(op_id)
                
            result["operation_details"][op_id] = {
                "operation_id": op_id,
                "detected_schema_version": op_schema,
                "required_schema_version": "semantic_v1",
                "is_valid": op_valid,
                "invalid_reason": invalid_reason
            }
            
        return result
