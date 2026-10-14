"""Pydantic schemas and contracts for VEXCAD Manual CAD Refinement."""
from __future__ import annotations

from enum import Enum
from typing import Any, Dict, List, Literal, Optional, Union
from pydantic import BaseModel, Field


# Operation ids are validated by the service registry (unknown ids return a structured
# INVALID_REFERENCE result) so new tools never need a schema change.
OperationType = str


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
    triangles: Optional[List[float]] = Field(
        None, 
        description="Flattened 3D triangle coordinates [x1, y1, z1, x2, y2, z2, x3, y3, z3, ...] for viewport face surface rendering & picking"
    )
    boundary_points: Optional[List[List[float]]] = Field(
        default_factory=list,
        description="Sampled points along boundary wires of the face"
    )


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


# Operation ids are validated by the service registry (unknown ids return a structured
# INVALID_REFERENCE result) so new tools never need a schema change.
OperationType = str


class CADOperation(BaseModel):
    """Unified contract for any manual CAD operation."""
    operation_id: str
    operation_type: OperationType
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
    operation_type: OperationType
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
    operation_type: OperationType
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


class RecognizedShapeFeature(BaseModel):
    feature_id: str
    part_name: str
    feature_type: str = "body"  # 'hole', 'pocket', 'boss', 'slot', 'flange', 'fillet', 'chamfer', 'body'
    category: str = "Component Geometry"
    parameters: Dict[str, Any] = Field(default_factory=dict)
    face_ids: List[str] = Field(default_factory=list)
    edge_ids: List[str] = Field(default_factory=list)
    center: Optional[List[float]] = None
    bounding_box: Optional[Dict[str, List[float]]] = None
    axis: Optional[List[float]] = None
    description: Optional[str] = None


class MeasureResult(BaseModel):
    distance_mm: Optional[float] = None
    min_distance_mm: Optional[float] = None
    angle_degrees: Optional[float] = None
    entity_a_info: Dict[str, Any] = Field(default_factory=dict)
    entity_b_info: Optional[Dict[str, Any]] = None
    part_name: Optional[str] = None
    feature_type: Optional[str] = None
    parameters: Dict[str, Any] = Field(default_factory=dict)
    parameter_metadata: Dict[str, Any] = Field(default_factory=dict)
    shape_feature: Optional[RecognizedShapeFeature] = None


class TopologyDataResponse(BaseModel):
    session_id: str
    revision_id: str
    faces: Dict[str, GeometricReference]
    edges: Dict[str, GeometricReference]
    bounding_box: Dict[str, List[float]]
    volume_mm3: float
    is_valid: bool
    features: List[RecognizedShapeFeature] = Field(default_factory=list)
    parameters: Dict[str, Any] = Field(default_factory=dict)
    parameter_metadata: Dict[str, Any] = Field(default_factory=dict)


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


class FeatureOnFace(BaseModel):
    kind: Optional[str] = None
    diameter: Optional[float] = None
    depth: Optional[float] = None
    uv: Optional[list[float]] = None
    face_id: Optional[str] = None

class PlanarFaceContext(BaseModel):
    origin: Optional[list[float]] = None
    normal: Optional[list[float]] = None
    u_axis: Optional[list[float]] = None
    v_axis: Optional[list[float]] = None
    extents_u: Optional[float] = None
    extents_v: Optional[float] = None
    is_rectangular: Optional[bool] = None
    is_circular: Optional[bool] = None
    circle_diameter: Optional[float] = None
    center_uv: Optional[list[float]] = None
    max_diameter: Optional[float] = None
    material_depth: Optional[float] = None
    is_through_clear: Optional[bool] = None
    existing_features: list[FeatureOnFace] = []

class CylFaceContext(BaseModel):
    radius: Optional[float] = None
    diameter: Optional[float] = None
    length: Optional[float] = None
    axis_origin: Optional[list[float]] = None
    axis_dir: Optional[list[float]] = None
    kind: Optional[Literal["hole", "boss"]] = None
    is_through: Optional[bool] = None
    bottom_depth: Optional[float] = None
    parent_face_id: Optional[str] = None
    stacked: Optional[bool] = None

class EdgeContext(BaseModel):
    length: Optional[float] = None
    radius: Optional[float] = None
    dihedral_deg: Optional[float] = None
    max_radius_hint: Optional[float] = None
    edge_type: Optional[Literal["line", "circle", "other"]] = None
    adjacent_face_ids: list[str] = []

class BodyContext(BaseModel):
    extents: Optional[list[float]] = None
    volume: Optional[float] = None
    solid_count: Optional[int] = None
    is_valid: Optional[bool] = None

class GeometryContext(BaseModel):
    status: Literal["ok", "partial", "unsupported", "error"] = "ok"
    entity_class: Literal[
        "face.planar", "face.cylindrical", "face.conical", "face.other",
        "edge.linear", "edge.circular", "edge.other", "body"
    ] = Field(..., alias="class")
    ref: str
    revision: str
    warnings: list[str] = []
    message: Optional[str] = None
    area: Optional[float] = None
    planar: Optional[PlanarFaceContext] = None
    cylindrical: Optional[CylFaceContext] = None
    edge: Optional[EdgeContext] = None
    body: Optional[BodyContext] = None


# ---------------------------------------------------------------------------
# AI Geometry Planner models
# ---------------------------------------------------------------------------

class CADOperationPlan(BaseModel):
    """Structured plan produced by the AI geometry planner from a natural-language command."""
    operation_type: str = Field(..., description="One of the supported backend operation types")
    target_entity_ids: List[str] = Field(default_factory=list, description="Transient IDs of target entities")
    parameters: Dict[str, Any] = Field(default_factory=dict, description="Operation parameters")
    description: str = Field("", description="Human-readable description of the planned operation")
    preconditions: List[str] = Field(default_factory=list, description="Requirements that must be satisfied")
    requires_confirmation: bool = Field(False, description="Whether the planner requests user confirmation")
    clarification_needed: Optional[str] = Field(None, description="Question to ask the user when command is ambiguous")
    confidence: float = Field(1.0, ge=0.0, le=1.0)


class AiPlanRequest(BaseModel):
    """Request to convert a natural-language CAD command into a structured operation plan."""
    session_id: str
    revision_id: str = "rev_000"
    command: str = Field(..., description="Natural-language editing command")
    selected_entity_ids: List[str] = Field(default_factory=list)
    geometry_context: Optional[Dict[str, Any]] = Field(None, description="Serialized GeometryContext for selected entities")
    operation_history: List[str] = Field(default_factory=list, description="Recent operation descriptions for follow-up context")


class AiPlanResult(BaseModel):
    """Result of the AI geometry planning step."""
    plan: Optional[CADOperationPlan] = None
    raw_command: str = ""
    error: Optional[str] = None
    suggestions: List[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Coplanar & Similar selection query models
# ---------------------------------------------------------------------------

class CoplanarQueryRequest(BaseModel):
    """Find all faces coplanar with a reference face within a geometric tolerance."""
    session_id: str
    revision_id: str = "rev_000"
    reference_face_id: str = Field(..., description="Transient ID of the reference face")
    tolerance_mm: float = Field(0.01, ge=0.0, description="Planar distance tolerance in mm")
    angle_tolerance_deg: float = Field(1.0, ge=0.0, description="Normal angle tolerance in degrees")


class CoplanarQueryResult(BaseModel):
    coplanar_face_ids: List[str] = Field(default_factory=list)
    reference_face_id: str
    plane_normal: Optional[List[float]] = None
    plane_d: Optional[float] = None
    count: int = 0


class SimilarQueryRequest(BaseModel):
    """Find geometrically similar entities (bores, faces) within a tolerance."""
    session_id: str
    revision_id: str = "rev_000"
    reference_entity_id: str = Field(..., description="Transient ID of the reference entity")
    entity_type: Literal["face", "edge"] = "face"
    radius_tolerance_mm: float = Field(0.1, ge=0.0)
    angle_tolerance_deg: float = Field(5.0, ge=0.0)
    depth_tolerance_mm: float = Field(0.5, ge=0.0)


class SimilarQueryResult(BaseModel):
    similar_entity_ids: List[str] = Field(default_factory=list)
    reference_entity_id: str
    similarity_basis: str = ""
    count: int = 0


# ---------------------------------------------------------------------------
# DFM analysis models
# ---------------------------------------------------------------------------

class DfmSuggestion(BaseModel):
    """A single Design for Manufacturing suggestion."""
    suggestion_id: str
    category: Literal["hole_diameter", "hole_depth", "face_alignment", "corner_radius", "inconsistent_features", "general"]
    severity: Literal["info", "warning", "critical"]
    title: str
    description: str
    affected_entity_ids: List[str] = Field(default_factory=list)
    proposed_operation: Optional[CADOperationPlan] = None
    standard_reference: Optional[str] = None
    measured_value: Optional[float] = None
    suggested_value: Optional[float] = None
    unit: Optional[str] = None


class DfmAnalysisRequest(BaseModel):
    session_id: str
    revision_id: str = "rev_000"
    selected_entity_ids: List[str] = Field(default_factory=list, description="If empty, analyzes whole model")
    standards: List[str] = Field(default_factory=lambda: ["ISO_metric"], description="Engineering standards to check against")


class DfmAnalysisResult(BaseModel):
    suggestions: List[DfmSuggestion] = Field(default_factory=list)
    analyzed_entity_count: int = 0
    session_id: str
    revision_id: str


# ---------------------------------------------------------------------------
# Detected Features & Parameter Extraction models
# ---------------------------------------------------------------------------

class FeatureParam(BaseModel):
    key: str
    label: str
    unit: Optional[str] = None
    value: Union[float, str, bool]
    type: Literal["number", "select", "toggle"]
    min: Optional[float] = None
    max: Optional[float] = None
    step: Optional[float] = None
    options: Optional[List[str]] = None


class DetectedFeature(BaseModel):
    feature_id: str = Field(..., description="Stable per revision (hash of kind + sorted face ids)")
    kind: Literal["hole", "boss", "pocket", "slot", "fillet", "chamfer"]
    subtype: str = Field(..., description="blind | through | counterbore | countersink | closed | open | rect | circle | obround")
    name: str = Field(..., description="Human-readable name, e.g. Hole Ø6 × 10")
    face_ids: List[str] = Field(default_factory=list, description="Transient ids used by the viewport: face_12")
    edge_ids: List[str] = Field(default_factory=list)
    center: List[float] = Field(default_factory=lambda: [0.0, 0.0, 0.0])
    axis: Optional[List[float]] = None
    bounding_box: Dict[str, List[float]] = Field(default_factory=dict)
    params: List[FeatureParam] = Field(default_factory=list)
    editable: bool = True
    not_editable_reason: Optional[str] = None
    confidence: float = 1.0


class SelectMoreRequest(BaseModel):
    session_id: str
    revision_id: str = "rev_000"
    seed_ids: List[str] = Field(default_factory=list)
    mode: Literal["adjacent", "coplanar", "tangent_chain", "edge_loop", "same_type", "same_size", "invert", "clear"]


class SelectMoreResponse(BaseModel):
    transient_ids: List[str] = Field(default_factory=list)

