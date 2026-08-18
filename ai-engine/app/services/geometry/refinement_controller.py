import build123d as b3d
from typing import Tuple, Optional
from app.models.evidence import EngineeringEvidence
from app.models.hypothesis import GeometryHypothesis
from app.services.geometry.inference_provider import GeometryInferenceProvider
from app.services.geometry.deterministic_builder import DeterministicGeometryBuilder
from app.services.geometry.constraint_solver import ConstraintSolver
from app.services.validation.geometry_critic import GeometryCritic, ValidationStatus

class RefinementController:
    """
    State machine that orchestrates the bounded refinement loop:
    Hypothesis -> Builder -> Critic -> Constraints -> (Loop if needed) -> Validated B-Rep.
    """
    def __init__(self, provider: GeometryInferenceProvider, max_iterations: int = 3):
        self.provider = provider
        self.builder = DeterministicGeometryBuilder()
        self.critic = GeometryCritic()
        self.solver = ConstraintSolver()
        self.max_iterations = max_iterations

    def run_reconstruction(self, evidence: EngineeringEvidence) -> b3d.Shape:
        """
        Runs the full reconstruction loop.
        Returns the validated B-Rep Shape.
        Raises ValueError if validation fails after max iterations.
        """
        hypothesis = self.provider.infer_geometry(evidence)
        
        for iteration in range(self.max_iterations):
            # 1. Deterministic Geometry Construction
            shape = self.builder.build_geometry(hypothesis, evidence)
            
            # 2. Geometry Critic
            validation_result = self.critic.validate(shape, hypothesis, evidence)
            
            if validation_result.status == ValidationStatus.PASS:
                # 3. Constraint Validation (Hard constraints)
                hypothesis, conflicts = self.solver.resolve_conflicts(hypothesis, evidence)
                if conflicts:
                    # If solver found unresolvable hard constraints, it might fail here,
                    # but typically solver forces the hypothesis to comply and we rebuild.
                    shape = self.builder.apply_constraints(shape, hypothesis, evidence)
                return shape
                
            elif validation_result.status == ValidationStatus.REQUIRES_REFINEMENT:
                # 4. Refinement Strategy
                hypothesis = self.provider.infer_geometry(evidence, previous_hypothesis=hypothesis, feedback=validation_result)
                continue
                
            elif validation_result.status == ValidationStatus.FAIL:
                raise ValueError(f"GEOMETRY_VALIDATION_FAILED: {validation_result.errors}")
                
        raise ValueError("GEOMETRY_VALIDATION_FAILED: Exceeded maximum refinement iterations.")
