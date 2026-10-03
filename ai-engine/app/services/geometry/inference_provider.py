from abc import ABC, abstractmethod
from typing import Optional, Dict, Any
from app.models.evidence import EngineeringEvidence
from app.models.hypothesis import GeometryHypothesis
from app.services.validation.geometry_critic import GeometryValidationResult

class GeometryInferenceProvider(ABC):
    """
    Abstract interface for providers that generate a GeometryHypothesis
    from EngineeringEvidence.
    """

    @abstractmethod
    def infer_geometry(self, evidence: EngineeringEvidence, previous_hypothesis: Optional[GeometryHypothesis] = None, feedback: Optional[GeometryValidationResult] = None) -> GeometryHypothesis:
        """
        Generates or refines a GeometryHypothesis.
        If previous_hypothesis and feedback are provided, it acts as a refinement step.
        """
        pass

class LLMInferenceProvider(GeometryInferenceProvider):
    """
    Implementation of InferenceProvider that uses an LLM (e.g. LLMCodegenService)
    to output structured GeometryHypothesis objects rather than raw executable code.
    """
    def __init__(self):
        # self.llm_service = LLMCodegenService()
        pass

    def infer_geometry(self, evidence: EngineeringEvidence, previous_hypothesis: Optional[GeometryHypothesis] = None, feedback: Optional[GeometryValidationResult] = None) -> GeometryHypothesis:
        # 1. Serialize evidence into prompt
        # 2. Add refinement hints if feedback is present
        # 3. Call LLM with JSON schema enforcement for GeometryHypothesis
        # 4. Parse response into GeometryHypothesis
        raise NotImplementedError("LLM inference implementation pending.")
