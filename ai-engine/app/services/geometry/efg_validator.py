from typing import List, Tuple
from app.models.efg import EngineeringFeatureGraph, EFGNode
from app.models.evidence import EngineeringEvidence

class EFGValidator:
    """
    Validates an Engineering Feature Graph against the immutable source evidence.
    Ensures the EFG does not invent unsupported engineering requirements.
    """
    
    def __init__(self):
        pass

    def validate(self, efg: EngineeringFeatureGraph, evidence: EngineeringEvidence) -> Tuple[bool, List[str]]:
        """
        Validates the EFG. Returns (is_valid, list_of_errors).
        """
        errors = []
        
        # Build a fast lookup for evidence IDs
        valid_evidence_ids = set()
        for dim in evidence.dimensions:
            valid_evidence_ids.add(dim.id)
        for txt in evidence.text_annotations:
            valid_evidence_ids.add(txt.id)
        for sym in evidence.symbols:
            valid_evidence_ids.add(sym.id)
        for cst in evidence.constraints:
            valid_evidence_ids.add(cst.id)

        for node in efg.nodes:
            # 1. Feature must have evidence unless it's a coordinate system
            if node.feature_type != "COORDINATE_SYSTEM" and not node.source_evidence:
                errors.append(f"Feature {node.feature_id} ({node.feature_type}) has no source evidence.")
                
            # 2. Source evidence references must be valid
            for ev_id in node.source_evidence:
                if ev_id not in valid_evidence_ids:
                    errors.append(f"Feature {node.feature_id} references unknown evidence ID '{ev_id}'.")
                    
            # 3. Dependencies must be valid EFG nodes
            for dep_id in node.dependencies:
                if not efg.get_node(dep_id):
                    errors.append(f"Feature {node.feature_id} depends on unknown feature '{dep_id}'.")
                    
            # 4. Low confidence features are flagged
            if node.confidence < 0.7:
                errors.append(f"Feature {node.feature_id} has low confidence ({node.confidence}) and requires review.")

        is_valid = len(errors) == 0
        return is_valid, errors
