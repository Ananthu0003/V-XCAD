from typing import List, Dict, Any, Optional, Literal
from pydantic import BaseModel, Field

class MachineProfile(BaseModel):
    machine_id: str
    machine_name: str
    machine_type: Literal["3_axis_mill", "4_axis_mill", "5_axis_mill", "lathe", "turning_center", "mill_turn"]
    axis_count: int
    spindle_axis: List[float] = Field(default_factory=lambda: [0.0, 0.0, 1.0])
    supported_operations: List[str] = Field(default_factory=list)
    unsupported_operations: List[str] = Field(default_factory=list)
    work_envelope: Dict[str, float] = Field(default_factory=lambda: {"x_min": 0, "x_max": 0, "y_min": 0, "y_max": 0, "z_min": 0, "z_max": 0})
    spindle_limits: Dict[str, float] = Field(default_factory=lambda: {"min_rpm": 0, "max_rpm": 10000})
    feed_limits: Dict[str, float] = Field(default_factory=lambda: {"max_feed": 5000})
    rotary_axis_availability: bool = False
    live_tooling: bool = False
    post_processor: str = "default_post"
    spindle_taper: Optional[str] = None  # e.g. "CAT40", "BT40", "HSK63A"
    available_tool_ids: List[str] = Field(default_factory=list)
    tool_change_time: float = 15.0  # seconds
    rapid_feedrate: float = 5000.0  # mm/min
    
    # ATC specifics
    atc_type: Literal["carousel", "chain", "linear", "random_pocket", "manual"] = "carousel"
    atc_capacity: int = 20
    magazine_indexing_time: float = 0.5
    tool_search_time: float = 2.0
    spindle_orient_time: float = 1.0
    spindle_stop_time: float = 2.0
    clamp_unclamp_time: float = 1.5

    # Controller / Kinematics
    rapid_acceleration: float = 1000.0
    cutting_acceleration: float = 500.0
    controller_block_time: float = 0.002
    max_simultaneous_axes: int = 3

    # Spindle specs
    spindle_power_kw: float = 15.0
    spindle_torque_nm: float = 100.0
    hourly_rate: float = 8400.0
    setup_rate: float = 6720.0
    currency: str = "INR"

class MaterialProfile(BaseModel):
    material_id: str
    material_name: str
    category: str = "aluminum"
    category_label: str = "Aluminum Alloys"
    machinability: str = "average"
    machinability_rating: float = 100.0  # percentage
    tool_materials: List[str] = Field(default_factory=list)
    coatings: List[str] = Field(default_factory=list)
    cutting_speed: float = 100.0  # m/min or surface feet per min
    feed_per_tooth: float = 0.05  # mm/tooth
    coolant_requirement: str = "flood"
    density_gcm3: float = 2.70
    hardness: str = "95 HB"
    description: str = ""
    cost_per_kg: float = 420.0
    currency: str = "INR"

class ToolProfile(BaseModel):
    tool_id: str
    name: str
    type: str
    diameter: float
    flute_count: int
    cutting_length: float
    stickout: float
    holder: str = "standard"
    holder_taper: Optional[str] = None  # e.g. "CAT40", "BT40", "HSK63A"
    material: str = "carbide"
    coating: Optional[str] = None
    compatible_materials: List[str] = Field(default_factory=lambda: ["aluminum", "steel", "plastic"])
    compatible_operations: List[str] = Field(default_factory=list)
    supported_machines: List[str] = Field(default_factory=lambda: ["all"])
    max_depth: float = 50.0
    minimum_hole_diameter: Optional[float] = None

class FeatureDecision(BaseModel):
    feature_id: str
    feature_type: str
    manufacturing_strategy: Optional[str] = None
    machine_capability_result: bool = False
    setup_assignment: Optional[str] = None
    selected_tool: Optional[Dict[str, Any]] = None
    status: Literal["ready", "warning", "blocked", "unsupported"] = "blocked"
    reason: str = "Not evaluated"
    recommended_machine: Optional[str] = None
    tool_selection_reason: Optional[str] = None
    feeds_and_speeds: Optional[Dict[str, float]] = None
    operation_type: Optional[str] = None
    parameters: Dict[str, Any] = Field(default_factory=dict)
    
    # Provenance and Confidence (Hybrid 2D->3D)
    source: str = "VALIDATED"  # OBSERVED, DETERMINISTIC_INFERRED, AI_INFERRED, AI_GENERATED, VALIDATED
    confidence: float = 1.0
    evidence_refs: List[str] = Field(default_factory=list)
    validation_status: str = "VALIDATED"  # PENDING, PASS, FAIL, REQUIRES_REFINEMENT

