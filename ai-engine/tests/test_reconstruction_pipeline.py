import pytest
from app.services.geometry.refinement_controller import RefinementController
from app.services.geometry.inference_provider import LLMInferenceProvider

def test_refinement_controller_initialization():
    provider = LLMInferenceProvider()
    controller = RefinementController(provider=provider)
    assert controller.max_iterations == 3
