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
    available_tool_ids: List[str] = Field(default_factory=list)

class MaterialProfile(BaseModel):
    material_id: str
    material_name: str
    machinability: str = "average"
    tool_materials: List[str] = Field(default_factory=list)
    coatings: List[str] = Field(default_factory=list)
    cutting_speed: float = 100.0  # m/min or surface feet per min
    feed_per_tooth: float = 0.05  # mm/tooth
    coolant_requirement: str = "flood"

class ToolProfile(BaseModel):
    tool_id: str
    name: str
    type: str
    diameter: float
    flute_count: int
    cutting_length: float
    stickout: float
    holder: str = "standard"
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
