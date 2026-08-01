from typing import Dict, Any, List
from app.models.evidence import EvidenceGraph

class BlueprintValidator:
    """
    Validates features extracted from the blueprint against the Evidence Graph.
    Detects conflicts, missing parameters, and blocks CAD if unvalidated.
    """
    
    def validate_features(self, feature_map: Dict[str, Any], evidences: List[EvidenceGraph]) -> Dict[str, Any]:
        validation_errors = []
        validation_warnings = []
        
        # Organize evidence by feature
        feature_evidence = {}
        for ev in evidences:
            if ev.feature_id not in feature_evidence:
                feature_evidence[ev.feature_id] = []
            feature_evidence[ev.feature_id].append(ev)
            
        validated_features = []
        
        for feature in feature_map.get("features", []):
            fid = feature.get("id")
            f_evidences = feature_evidence.get(fid, [])
            
            # Check for ambiguous statuses
            ambiguous = [e for e in f_evidences if e.status in ("ambiguous", "requires_user_confirmation")]
            if ambiguous:
                validation_errors.append(f"Feature {fid} has ambiguous parameters: {[e.name for e in ambiguous]}")
                feature["status"] = "blocked"
                validated_features.append(feature)
                continue
                
            # Check missing mandatory parameters
            ftype = feature.get("type", "").lower()
            if ftype == "hole":
                has_dia = any(e.name.lower() == "diameter" for e in f_evidences)
                has_depth = any(e.name.lower() == "depth" for e in f_evidences)
                is_through = feature.get("parameters", {}).get("depth_type") == "through"
                
                if not has_dia:
                    validation_errors.append(f"Hole {fid} is missing mandatory diameter.")
                if not has_depth and not is_through:
                    validation_warnings.append(f"Hole {fid} is missing depth. Assuming through hole.")
                    
            if any(f"Feature {fid}" in err or f"Hole {fid}" in err for err in validation_errors):
                feature["status"] = "blocked"
            else:
                feature["status"] = "confirmed"
                
            validated_features.append(feature)
            
        return {
            "is_valid": len(validation_errors) == 0,
            "errors": validation_errors,
            "warnings": validation_warnings,
            "features": validated_features
        }
