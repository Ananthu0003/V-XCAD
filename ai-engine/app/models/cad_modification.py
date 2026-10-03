"""Pydantic schemas and contracts for VEXCAD Manual CAD Refinement."""
from __future__ import annotations

from enum import Enum
from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field


class OperationSource(str, Enum):
    AI_GENERATED = "ai_generated"
    MANUAL = "manual"
    AI_ASSISTED = "ai_assisted"


class OperationStatus(str, Enum):
    VALID = "valid"
    PREVIEW = "preview"
    COMMITTED = "committed"
    INVALID_REFERENCE = "invalid_reference"
    AMBIGUOUS_REFERENCE = "ambiguous_reference"
    GEOMETRY_FAILURE = "geometry_failure"
    RECOMPUTE_REQUIRED = "recompute_required"


class GeometricReference(BaseModel):
    """
    Multi-stage persistent geometric reference.
    Decoupled from transient viewport IDs (e.g. face_12).
    """
    ref_id: str = Field(..., description="Stable reference identifier")
    transient_id: str = Field(..., description="Transient display ID, e.g. face_4, edge_12")
    entity_type: Literal["face", "edge", "vertex"]
    surface_type: Optional[str] = Field(None, description="Plane, Cylinder, Cone, Sphere, Torus, BSpline, etc.")
    curve_type: Optional[str] = Field(None, description="Line, Circle, Ellipse, BSpline, etc.")
    normal: Optional[List[float]] = Field(None, description="Unit normal vector [nx, ny, nz] for planar surfaces")
    axis: Optional[List[float]] = Field(None, description="Revolution axis vector for cylindrical/conical surfaces")
    plane_d: Optional[float] = Field(None, description="Plane equation distance offset Ax + By + Cz + D = 0")
    centroid: List[float] = Field(..., description="3D center point [x, y, z]")
    bounding_box: Dict[str, List[float]] = Field(
        default_factory=dict, 
        description="{'min': [x,y,z], 'max': [x,y,z]}"
    )
    area: Optional[float] = Field(None, description="Surface area in mm^2")
    length: Optional[float] = Field(None, description="Curve length in mm")
    radius: Optional[float] = Field(None, description="Analytic radius in mm for cylinders, spheres, circles")
    adjacent_edge_ids: List[str] = Field(default_factory=list)
    adjacent_face_ids: List[str] = Field(default_factory=list)
    confidence: float = Field(1.0, description="Match confidence score between 0.0 and 1.0")


class ValidationReport(BaseModel):
    is_valid: bool
    is_manifold: bool = True
    is_closed: bool = True
    self_intersections: int = 0
    volume_mm3: float = 0.0
    warnings: List[str] = Field(default_factory=list)
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    suggestions: List[str] = Field(default_factory=list)


class CADOperation(BaseModel):
    """Unified contract for any manual CAD operation."""
    operation_id: str
    operation_type: Literal["fillet", "chamfer", "hole", "pocket", "pad", "boolean", "transform"]
    source: OperationSource = OperationSource.MANUAL
    input_revision: str
    output_revision: Optional[str] = None
    references: List[GeometricReference] = Field(default_factory=list)
    parameters: Dict[str, Any] = Field(default_factory=dict)
    status: OperationStatus = OperationStatus.VALID
    created_at: str
    user_metadata: Dict[str, Any] = Field(default_factory=dict)


class PreviewRequest(BaseModel):
    session_id: str
    base_revision: str = "rev_000"
    operation_type: Literal["fillet", "chamfer", "hole", "pocket", "pad", "boolean", "transform"]
    references: List[GeometricReference]
    parameters: Dict[str, Any] = Field(default_factory=dict)


class PreviewResult(BaseModel):
    valid: bool
    preview_stl_url: Optional[str] = None
    affected_faces: List[str] = Field(default_factory=list)
    created_faces: List[str] = Field(default_factory=list)
    removed_faces: List[str] = Field(default_factory=list)
    modified_edges: List[str] = Field(default_factory=list)
    bounding_box: Optional[Dict[str, List[float]]] = None
    volume_delta_mm3: Optional[float] = None
    validation: ValidationReport
    status: OperationStatus = OperationStatus.PREVIEW
    error_diagnostic: Optional[Dict[str, Any]] = None


class CommitRequest(BaseModel):
    session_id: str
    base_revision: str = "rev_000"
    operation_type: Literal["fillet", "chamfer", "hole", "pocket", "pad", "boolean", "transform"]
    references: List[GeometricReference]
    parameters: Dict[str, Any] = Field(default_factory=dict)
    user_note: Optional[str] = None


class CommitResult(BaseModel):
    success: bool
    new_revision: str
    stl_url: str
    step_url: str
    operation: CADOperation
    validation: ValidationReport


class RollbackRequest(BaseModel):
    session_id: str
    target_revision: str


class RollbackResult(BaseModel):
    success: bool
    active_revision: str
    stl_url: str
    step_url: str
    history: List[CADOperation]


class MeasureRequest(BaseModel):
    session_id: str
    revision_id: str = "rev_000"
    entity_a: GeometricReference
    entity_b: Optional[GeometricReference] = None


class MeasureResult(BaseModel):
    distance_mm: Optional[float] = None
    min_distance_mm: Optional[float] = None
    angle_degrees: Optional[float] = None
    entity_a_info: Dict[str, Any] = Field(default_factory=dict)
    entity_b_info: Optional[Dict[str, Any]] = None


class TopologyDataResponse(BaseModel):
    session_id: str
    revision_id: str
    faces: Dict[str, GeometricReference]
    edges: Dict[str, GeometricReference]
    bounding_box: Dict[str, List[float]]
    volume_mm3: float
    is_valid: bool


class RecomputeRequest(BaseModel):
    session_id: str
    target_op_id: Optional[str] = None
    action: Literal["edit_params", "delete_op", "replay_all"] = "edit_params"
    updated_parameters: Optional[Dict[str, Any]] = None


class RecomputedOperationStatus(BaseModel):
    op_id: str
    operation_type: str
    status: OperationStatus
    message: str
    confidence: float = 1.0


class RecomputeResult(BaseModel):
    success: bool
    active_revision: str
    stl_url: str
    step_url: str
    history: List[CADOperation]
    replayed_operations: List[RecomputedOperationStatus] = Field(default_factory=list)
    broken_references: List[str] = Field(default_factory=list)
    validation: ValidationReport

