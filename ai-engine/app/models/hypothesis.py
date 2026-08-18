from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
from enum import Enum

class HypothesisSource(str, Enum):
    OBSERVED = "OBSERVED"
    DETERMINISTIC_INFERRED = "DETERMINISTIC_INFERRED"
    AI_INFERRED = "AI_INFERRED"
    AI_GENERATED = "AI_GENERATED"

class GeometricPrimitive(BaseModel):
    id: str
    primitive_type: str # block, cylinder, cone, sphere, torus, etc.
    parameters: Dict[str, Any] # e.g. length, width, height, radius
    transform: List[float] = Field(default_factory=lambda: [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]) # 4x4 matrix
    evidence_refs: List[str] = []

class MachiningFeature(BaseModel):
    id: str
    feature_type: str # hole, pocket, slot, etc.
    parameters: Dict[str, Any]
    target_primitive_id: Optional[str] = None
    evidence_refs: List[str] = []

class HypothesisDimension(BaseModel):
    id: str
    target_elements: List[str] # IDs of primitives/features
    dimension_type: str # length, radius, angle, etc.
    value: float
    evidence_refs: List[str] = []

class GeometryRelationship(BaseModel):
    id: str
    relationship_type: str # e.g. concentric, coincident, tangent
    source_element_id: str
    target_element_id: str
    evidence_refs: List[str] = []

class HypothesisConstraint(BaseModel):
    id: str
    constraint_type: str
    is_hard_constraint: bool = False
    parameters: Dict[str, Any]
    evidence_refs: List[str] = []

class CandidateSurface(BaseModel):
    id: str
    surface_type: str # plane, cylinder, etc.
    parameters: Dict[str, Any]
    evidence_refs: List[str] = []

class TopologyHypothesis(BaseModel):
    id: str
    topology_description: str
    elements: List[str]
    evidence_refs: List[str] = []

class GeometryHypothesis(BaseModel):
    primitives: List[GeometricPrimitive] = []
    features: List[MachiningFeature] = []
    dimensions: List[HypothesisDimension] = []
    relationships: List[GeometryRelationship] = []
    constraints: List[HypothesisConstraint] = []
    candidate_surfaces: List[CandidateSurface] = []
    candidate_topology: List[TopologyHypothesis] = []
    source: HypothesisSource
    confidence: float = Field(..., ge=0.0, le=1.0)
    evidence_refs: List[str] = []
