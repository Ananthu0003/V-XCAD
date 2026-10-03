from typing import List, Tuple
from app.models.efg import EngineeringFeatureGraph

class CapabilityRegistry:
    """
    Verifies if the deterministic CAD compiler actually supports every feature in the EFG.
    Prevents silent fallback approximation by rejecting unsupported geometry.
    """
    
    def __init__(self):
        # The list of feature types currently implemented in the CAD Compiler
        self.supported_features = {
            "COORDINATE_SYSTEM",
            "BASE_FEATURE",
            "ADDITIVE_FEATURE",
            "SUBTRACTIVE_FEATURE",
            "HOLE",
            "GROOVE",
            "SHOULDER",
            "CHAMFER",
            "FILLET",
            "THREAD",
            "TAPER",
            "STEP",
            "INTERNAL_FEATURE"
        }

    def verify_capabilities(self, efg: EngineeringFeatureGraph) -> Tuple[bool, List[str]]:
        """
        Returns (is_supported, list_of_unsupported_reasons).
        """
        unsupported = []
        for node in efg.nodes:
            if node.feature_type.value not in self.supported_features:
                unsupported.append(f"Feature {node.feature_id} of type {node.feature_type} is not supported by the CAD compiler.")
                
        is_supported = len(unsupported) == 0
        return is_supported, unsupported
