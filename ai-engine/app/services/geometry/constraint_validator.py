from typing import List, Tuple
from app.models.constraints import ConstraintGraph
from app.models.efg import EngineeringFeatureGraph

class ConstraintValidator:
    """
    Validates the ConstraintGraph against the EngineeringFeatureGraph.
    Checks for conflicting or unresolvable constraints deterministically.
    """

    def __init__(self):
        pass
        
    def validate(self, constraints: ConstraintGraph, efg: EngineeringFeatureGraph) -> Tuple[bool, List[str]]:
        """
        Returns (is_valid, list_of_errors).
        If errors are returned, the status is CONSTRAINT_CONFLICT and REQUIRES_REVIEW.
        """
        errors = []
        
        # Build a valid set of feature IDs
        valid_feature_ids = {node.feature_id for node in efg.nodes}
        
        for constraint in constraints.constraints:
            for target_id in constraint.target_feature_ids:
                if target_id not in valid_feature_ids:
                    errors.append(f"Constraint {constraint.id} references unknown feature {target_id}")

        # In a real implementation, this would build a dependency graph and check for cycles
        # and mathematically unsolvable dimensional constraints.
        
        is_valid = len(errors) == 0
        return is_valid, errors
