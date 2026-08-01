import pytest
from app.models.evidence import EvidenceGraph
from app.services.validation.blueprint_validator import BlueprintValidator

def test_blueprint_validator_missing_mandatory():
    validator = BlueprintValidator()
    
    # Hole missing depth
    features = {
        "features": [
            {
                "id": "hole_1",
                "type": "hole"
            }
        ]
    }
    
    evidences = [
        EvidenceGraph(parameter_id="p1", name="Diameter", value=10.0, feature_id="hole_1", status="confirmed")
    ]
    
    result = validator.validate_features(features, evidences)
    assert result["is_valid"] is True # Only a warning for depth (assumed through)
    assert len(result["warnings"]) == 1
    assert result["features"][0]["status"] == "confirmed"
    
def test_blueprint_validator_missing_diameter():
    validator = BlueprintValidator()
    
    # Hole missing diameter
    features = {
        "features": [
            {
                "id": "hole_1",
                "type": "hole"
            }
        ]
    }
    
    evidences = [
        EvidenceGraph(parameter_id="p1", name="Depth", value=10.0, feature_id="hole_1", status="confirmed")
    ]
    
    result = validator.validate_features(features, evidences)
    assert result["is_valid"] is False
    assert len(result["errors"]) == 1
    assert result["features"][0]["status"] == "blocked"

def test_blueprint_validator_ambiguous_evidence():
    validator = BlueprintValidator()
    
    features = {
        "features": [
            {
                "id": "hole_1",
                "type": "hole"
            }
        ]
    }
    
    evidences = [
        EvidenceGraph(parameter_id="p1", name="Diameter", value=10.0, feature_id="hole_1", status="ambiguous")
    ]
    
    result = validator.validate_features(features, evidences)
    assert result["is_valid"] is False
    assert result["features"][0]["status"] == "blocked"
