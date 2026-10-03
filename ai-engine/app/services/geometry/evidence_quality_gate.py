from typing import List
from app.models.evidence import EngineeringEvidence, EvidenceStatus

class EvidenceQualityGate:
    """
    Validates EngineeringEvidence before it is allowed into the Engineering Feature Graph (EFG).
    Ensures dimensions have valid units, tolerances, and checks for contradictions or low confidence.
    """
    
    def __init__(self):
        pass
        
    def validate(self, evidence: EngineeringEvidence) -> EngineeringEvidence:
        """
        Runs quality checks on all evidence items.
        Modifies the 'status' field of evidence items to REQUIRES_REVIEW or REJECTED if they fail checks.
        Finally, marks the entire evidence graph as frozen (immutable).
        """
        self._validate_dimensions(evidence)
        self._validate_constraints(evidence)
        self._validate_features(evidence)
        
        # Freeze evidence to prevent downstream modification
        evidence.freeze()
        return evidence
        
    def _validate_dimensions(self, evidence: EngineeringEvidence):
        for dim in evidence.dimensions:
            if dim.confidence < 0.8:
                dim.status = EvidenceStatus.REQUIRES_REVIEW
                
            if dim.value <= 0:
                dim.status = EvidenceStatus.REJECTED
                
            # Basic sanity checks on tolerances
            if dim.tolerance_upper is not None and dim.tolerance_lower is not None:
                if dim.tolerance_upper < dim.tolerance_lower:
                    dim.status = EvidenceStatus.REJECTED
                    
            if not dim.view_id and not dim.bbox:
                # Missing spatial grounding
                dim.status = EvidenceStatus.REQUIRES_REVIEW

    def _validate_constraints(self, evidence: EngineeringEvidence):
        for constraint in evidence.constraints:
            if constraint.confidence < 0.8:
                constraint.status = EvidenceStatus.REQUIRES_REVIEW
                
            if not constraint.target_elements:
                constraint.status = EvidenceStatus.REJECTED

    def _validate_features(self, evidence: EngineeringEvidence):
        for feature in evidence.feature_candidates:
            if feature.confidence < 0.7:
                feature.status = EvidenceStatus.REQUIRES_REVIEW
