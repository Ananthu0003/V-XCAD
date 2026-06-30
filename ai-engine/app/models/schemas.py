"""Pydantic schemas for the CAD Copilot API."""
from __future__ import annotations
from typing import Any, Optional, Literal
from pydantic import BaseModel, ConfigDict, Field
from enum import Enum

class ToolpathSegmentType(str, Enum):
    RAPID_CLEARANCE = "rapid_clearance"
    RAPID_XY = "rapid_xy"
    APPROACH_RETRACT = "approach_retract"
    PLUNGE = "plunge"
    CUT = "cut"
    ARC_CW = "arc_cw"
    ARC_CCW = "arc_ccw"
    RETRACT_CLEARANCE = "retract_clearance"
    DRILL_CYCLE = "drill_cycle"

class MachineCapability(BaseModel):
    milling_3axis: bool = True
    indexed_4axis: bool = False
    continuous_4axis: bool = False
    milling_5axis: bool = False
    turning: bool = False
    mill_turn: bool = False
    drilling: bool = True
    pocketing: bool = True
    contouring: bool = True
    thread_milling: bool = False
    tapping: bool = False

class FeatureMachiningInfo(BaseModel):
    featureId: str
    featureType: str
    manufacturing_class: Optional[Literal["2.5D Milling", "3D Milling", "Drilling", "Turning", "Mill-Turn", "Inspection"]] = None
    featureAxis: Optional[list[float]] = None
    preferredToolAxis: Optional[list[float]] = None
    machinableInCurrentSetup: bool = True
    requiredSetupAxis: Optional[list[float]] = None
    requiresSecondarySetup: bool = False
    requires4Axis: bool = False
    requiresTurning: bool = False
    status: Literal[
        "machinable_in_active_setup",
        "machinable_in_secondary_setup",
        "requires_turning",
        "requires_4axis_indexing",
        "unsupported"
    ] = "machinable_in_active_setup"
    reason: Optional[str] = None
    setupId: Optional[str] = None

class CamSetupPlan(BaseModel):
    setupId: str
    setupName: str
    setupType: str = "milling_3axis"
    toolAxis: list[float] = [0.0, 0.0, 1.0]
    workCoordinateSystem: str = "G54"
    modelToSetupTransform: Optional[list[float]] = None
    assignedFeatureIds: list[str] = Field(default_factory=list)
    unassignedFeatureIds: list[str] = Field(default_factory=list)
    allFeatureIds: list[str] = Field(default_factory=list)
    requiredRotation: Optional[list[float]] = None
    requiresManualReclamp: bool = False
    requires4AxisIndexing: bool = False
    machinableFeatures: list[str] = Field(default_factory=list)
    deferredFeatures: list[str] = Field(default_factory=list)
    unsupportedFeatures: list[str] = Field(default_factory=list)

class CoordinateMode(str, Enum):
    MILL_XYZ = "mill_xyz"
    LATHE_XZ = "lathe_xz"

class Point3D(BaseModel):
    x: float
    y: float
    z: float

class ToolpathSegment(BaseModel):
    segmentId: str = ""
    moveType: ToolpathSegmentType = ToolpathSegmentType.RAPID_CLEARANCE
    start: Point3D
    end: Point3D
    coordinateMode: CoordinateMode = CoordinateMode.MILL_XYZ
    feedrate: Optional[float] = None
    spindle: Optional[float] = None
    toolId: str
    operationId: str
    featureId: str
    setupId: str
    center: Optional[Point3D] = None
    radius: Optional[float] = None
    clockwise: Optional[bool] = None
    plane: Optional[str] = None
    source: str = "strategy"
    gcodeLineStart: Optional[int] = None
    gcodeLineEnd: Optional[int] = None

class MotionCommand(BaseModel):
    commandId: str = ""
    commandType: ToolpathSegmentType = ToolpathSegmentType.RAPID_CLEARANCE
    start: Point3D
    end: Point3D
    feedrate: Optional[float] = None
    spindle: Optional[float] = None
    toolId: str
    operationId: str
    featureId: str
    setupId: str
    source: str = "strategy"
    center: Optional[Point3D] = None
    radius: Optional[float] = None
    clockwise: Optional[bool] = None
    plane: Optional[str] = None

class RegionType(str, Enum):
    DRILL = "drill_region"
    CONTOUR = "contour_region"
    POCKET = "pocket_region"
    BOSS_CLEARING = "boss_clearing_region"
    FACE = "face_region"
    TURNING = "turning_region"
    NONE = "none"

class RegionSource(str, Enum):
    HOLE_CENTER = "hole_center"
    OUTER_WIRE = "outer_wire"
    FACE_BOUNDARY = "face_boundary"
    POCKET_BOUNDARY = "pocket_boundary"
    BOSS_FLOOR_MINUS_ISLAND = "boss_floor_minus_island"
    TURNING_PROFILE = "turning_profile"
    NONE = "none"

class MachiningRegion(BaseModel):
    regionId: str
    regionType: RegionType
    source: RegionSource
    boundary: Optional[list[list[float]]] = None
    islands: Optional[list[list[list[float]]]] = None
    center: Optional[list[float]] = None
    axis: Optional[list[float]] = None
    topZ: Optional[float] = None
    bottomZ: Optional[float] = None
    depth: Optional[float] = None
    area: Optional[float] = None
    bbox: Optional[dict[str, list[float]]] = None
    closedBoundary: Optional[bool] = None
    valid: bool
    errorReason: Optional[str] = None

class CamFeatureSchema(BaseModel):
    id: str
    type: str
    subtype: str = "generic"
    name: str = ""
    center: Optional[list[float]] = None
    axis: Optional[list[float]] = None
    dimensions: dict[str, Any] = Field(default_factory=dict)
    confidence: float = 1.0
    requiredMachining: bool = True
    recommendedToolType: str = ""
    recommendedOperation: str = ""
    # Topology references
    parentFaceId: Optional[str] = None
    floorFaceId: Optional[str] = None
    # Machining region status: "valid", "missing", "error"
    machining_region: Optional[str] = None
    
    # Setup-aware machinability
    machining_info: Optional[FeatureMachiningInfo] = None
    
    # Legacy fields (to be deprecated in favor of machining_info)
    machinable_in_current_setup: bool = True
    requires_reorientation: bool = False
    requires_4axis_or_secondary_setup: bool = False
    blocked_reason: Optional[str] = None
    
    # New metadata fields
    featureGroupId: Optional[str] = None
    centerline: Optional[list[float]] = None
    radius: Optional[float] = None
    length: Optional[float] = None
    machiningStatus: str = "valid"


class CamOperationSchema(BaseModel):
    id: str
    type: str
    feature_id: Optional[str] = Field(default=None, alias="featureId")
    setup_id: str = "setup_1"
    tool_id: Optional[str] = None
    material_id: Optional[str] = None
    status: Literal["planned", "ready", "warning", "blocked", "unsupported", "pending_secondary_setup", "error"] = "planned"
    reason: Optional[str] = None
    recommended_machine: Optional[str] = None
    tool_selection_reason: Optional[str] = None
    depends_on_setup: Optional[str] = None
    depends_on_operation: Optional[str] = None
    machining_strategy: str = "default"
    safe_heights: dict[str, float] = Field(default_factory=dict)
    parameters: dict[str, Any] = Field(default_factory=dict)
    toolpaths: Optional[list[ToolpathSegment]] = None

class CamSetup(BaseModel):
    machineType: str = "3-Axis"
    machineModel: str = "Generic 3-Axis"
    controller: str = "fanuc"
    material: str = "aluminum_6061"
    stockType: str = "box"
    stockDimensions: list[float] = [100.0, 100.0, 20.0]
    wcs: str = "G54"
    originPosition: str = "top_center"
    tolerance: float = 0.01
    
    # Phase 2: Enforce Setup-Based CAM
    setupType: str = "milling_3axis"
    toolAxis: list[float] = [0.0, 0.0, 1.0]
    stockOrientation: str = "top_z"
    modelToSetupTransform: Optional[list[float]] = None

class CamTool(BaseModel):
    id: str
    number: str
    type: str
    diameter: float
    flutes: int
    stickout: float
    material: str

class CamValidationStatus(BaseModel):
    status: str = "unknown"
    warnings: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)

class ToolpathResult(BaseModel):
    toolpaths: list[ToolpathSegment] = Field(default_factory=list)
    validation: CamValidationStatus = Field(default_factory=CamValidationStatus)


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class GenerateResponse(StrictModel):
    """Payload returned after a successful two-stage generation run."""
    openscad_script: str
    parameters: dict[str, Any] = Field(default_factory=dict)


class EditRequest(StrictModel):
    """Payload sent to request surgical editing of existing code."""
    prompt: str
    current_code: str
    target_point: list[float] | None = None
    model: str = "gemini-3.5-flash"


class StepRequest(StrictModel):
    """Payload containing compiled CSG tree to convert to STEP."""
    csg_tree: str


class RenderRequest(BaseModel):
    """Payload sent to /api/v1/render to execute and export a CAD script."""
    python_script: str
    parameters: dict[str, Any] = Field(default_factory=dict)
    session_id: Optional[str] = None
    cam_parameters: Optional[dict[str, Any]] = None
    generate_cam: bool = False


class RenderArtifacts(BaseModel):
    """URLs and inline data for all exported artifacts."""
    model_hash: Optional[str] = Field(default=None, alias="modelHash")
    stl_url: Optional[str] = None
    step_url: Optional[str] = None
    dxf_url: Optional[str] = None
    gcode_url: Optional[str] = None
    gcode_content: Optional[str] = None
    toolpaths: Optional[list[ToolpathSegment]] = None
    annotations: Optional[dict[str, Any]] = None
    features: Optional[list[CamFeatureSchema]] = None
    feature_validation_status: Optional[str] = None
    geometry_mapping_summary: Optional[dict[str, Any]] = None
    operations: Optional[list[CamOperationSchema]] = None


class RenderResponse(BaseModel):
    """Payload returned after a successful /api/v1/render call."""
    status: str = "ok"
    session_id: str
    artifacts: RenderArtifacts

class MachineConfig(BaseModel):
    controller: str = "fanuc"
    safe_z: float = 10.0
    resolution: float = 0.1

class CAMJobRequest(BaseModel):
    csg_tree: Optional[str] = None
    step_file_path: Optional[str] = None
    machine_configuration: MachineConfig = Field(default_factory=MachineConfig)

class GCodeResponse(BaseModel):
    gcode: str
    toolpaths: list[ToolpathSegment] = Field(default_factory=list)

