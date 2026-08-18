from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field
from enum import Enum

class ConstraintType(str, Enum):
    DIMENSIONAL = "DIMENSIONAL"
    POSITIONAL = "POSITIONAL"
    CONCENTRIC = "CONCENTRIC"
    COAXIAL = "COAXIAL"
    SYMMETRIC = "SYMMETRIC"
    TANGENT = "TANGENT"
    EQUALITY = "EQUALITY"
    ORDERING = "ORDERING"

class ConstraintNode(BaseModel):
    id: str
    constraint_type: ConstraintType
    target_feature_ids: List[str]
    parameters: Dict[str, Any] = Field(default_factory=dict)
    source_evidence: List[str] = Field(default_factory=list)

class ConstraintGraph(BaseModel):
    """
    Deterministic representation of geometric relationships.
    """
    version: int = 1
    constraints: List[ConstraintNode] = Field(default_factory=list)
