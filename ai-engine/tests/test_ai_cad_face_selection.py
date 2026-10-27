import json
import pytest
from app.services.llm.llm_codegen import LLMCodegenService

def test_build_selection_context_parts_with_face():
    face_ctx = {
        "entity_type": "face",
        "transient_id": "face_3",
        "surface_type": "plane",
        "normal": [0.0, 1.0, 0.0],
        "centroid": [12.5, 30.0, 0.0],
        "area": 450.2,
    }
    
    parts = LLMCodegenService._build_selection_context_parts(json.dumps(face_ctx))
    assert len(parts) == 1
    content = parts[0]
    assert "TARGET_SELECTED_FACE" in content
    assert "Face #face_3" in content
    assert "plane" in content
    assert "CRITICAL INSTRUCTION" in content
    assert "ONLY to this specific selected face" in content

def test_build_selection_context_parts_with_dict():
    face_ctx = {
        "face_id": 5,
        "surface_type": "cylinder",
        "normal": [1.0, 0.0, 0.0],
        "area": 120.0,
    }
    parts = LLMCodegenService._build_selection_context_parts(face_ctx)
    assert len(parts) == 1
    assert "Face #5" in parts[0]
    assert "cylinder" in parts[0]
