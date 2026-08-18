from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field
from enum import Enum

class FeatureType(str, Enum):
    COORDINATE_SYSTEM = "COORDINATE_SYSTEM"
    BASE_FEATURE = "BASE_FEATURE"
    ADDITIVE_FEATURE = "ADDITIVE_FEATURE"
    SUBTRACTIVE_FEATURE = "SUBTRACTIVE_FEATURE"
    TURNING_FEATURE = "TURNING_FEATURE"
    HOLE = "HOLE"
    GROOVE = "GROOVE"
    SHOULDER = "SHOULDER"
    STEP = "STEP"
    CHAMFER = "CHAMFER"
    FILLET = "FILLET"
    THREAD = "THREAD"
    TAPER = "TAPER"
    INTERNAL_FEATURE = "INTERNAL_FEATURE"

class EFGNode(BaseModel):
    feature_id: str
    feature_type: FeatureType
    parameters: Dict[str, Any] = Field(default_factory=dict)
    location: Dict[str, Any] = Field(default_factory=dict) # e.g. {'axis': 'X', 'position': 18.25}
    tolerance: Dict[str, Any] = Field(default_factory=dict)
    source_evidence: List[str] = Field(default_factory=list) # Links to ExtractedDimension, TextAnnotation IDs
    characteristic_ids: List[str] = Field(default_factory=list)
    confidence: float = Field(..., ge=0.0, le=1.0)
    dependencies: List[str] = Field(default_factory=list) # IDs of parent features

class EngineeringFeatureGraph(BaseModel):
    """
    An independent representation of engineering intent, completely decoupled from Python/CAD code.
    Features trace back to source evidence and declare their own dimensional limits.
    """
    version: int = 1
    nodes: List[EFGNode] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    
    def get_node(self, feature_id: str) -> Optional[EFGNode]:
        for node in self.nodes:
            if node.feature_id == feature_id:
                return node
        return None
