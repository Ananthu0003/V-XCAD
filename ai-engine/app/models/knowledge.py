from pydantic import BaseModel, Field
from typing import List, Optional, Any, Dict

class KnowledgeSource(BaseModel):
    document_id: str
    topic: str
    version: str

class EngineeringConcept(BaseModel):
    id: str = Field(..., description="Unique identifier for the concept")
    category: str = Field(..., description="Category of the concept (e.g. projection, dimension, feature)")
    concept: str = Field(..., description="The concept name")
    description: str = Field(..., description="Detailed engineering description")
    source_document: Optional[KnowledgeSource] = None

class ProjectionRule(EngineeringConcept):
    layout_type: str = Field(..., description="e.g. First-Angle, Third-Angle")
    prerequisites: List[str] = Field(default_factory=list, description="Visual markers required (e.g. ['projection_symbol_first_angle'])")

class ViewRelationship(EngineeringConcept):
    primary_view_role: str
    secondary_view_role: str
    relationship_type: str = Field(..., description="e.g. adjacent, auxiliary, section")
    correspondence_rules: List[str] = Field(default_factory=list, description="Rules for matching geometry between these views")

class DrawingConvention(EngineeringConcept):
    line_type: str = Field(..., description="e.g. Hidden, Center, Phantom, Visible")
    meaning: str
    confidence_impact: float = 1.0

class GeometryConstraint(EngineeringConcept):
    constraint_type: str = Field(..., description="e.g. Tangent, Concentric, Horizontal")
    dof_removed: int = Field(..., description="Degrees of freedom removed by this constraint")

class ProjectionValidationRule(EngineeringConcept):
    validation_logic: str = Field(..., description="Deterministic logic/formula to check validity")
    error_message: str
