from __future__ import annotations
from typing import Literal, Optional, Union, List, Dict, Any
from pydantic import BaseModel, Field

class Position(BaseModel):
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0
    a: Optional[float] = None
    b: Optional[float] = None
    c: Optional[float] = None

class MotionBlock(BaseModel):
    block_type: Literal["motion"] = "motion"
    block_id: str
    motion_type: Literal["rapid", "linear", "arc_cw", "arc_ccw"]
    start_position: Position
    end_position: Position
    feed_rate: Optional[float] = None          # mm/min, None for rapid
    feed_per_rev: Optional[float] = None       # mm/rev or in/rev
    inverse_time_feed: Optional[float] = None  # G93 inverse time mode (1/min)
    spindle_rpm: Optional[float] = None
    is_css: bool = False                       # Constant Surface Speed mode
    surface_speed_m_min: Optional[float] = None
    tool_id: Optional[str] = None
    operation_id: Optional[str] = None
    setup_id: Optional[str] = None
    # Arc-specific
    arc_center: Optional[Position] = None
    arc_radius: Optional[float] = None
    sweep_angle_radians: Optional[float] = None
    arc_plane: Optional[Literal["XY", "XZ", "YZ"]] = None
    # Computed by timeline builder, not by segment creator
    computed_distance_mm: Optional[float] = None
    source_segment_id: Optional[str] = None

class CannedCycleBlock(BaseModel):
    block_type: Literal["canned_cycle"] = "canned_cycle"
    block_id: str
    cycle_type: Literal["G81", "G82", "G83", "G73"]
    holes: List[Position]
    r_plane: float
    final_depth: float
    feed_rate: float
    spindle_rpm: Optional[float] = None
    tool_id: Optional[str] = None
    operation_id: Optional[str] = None
    setup_id: Optional[str] = None
    peck_depth: Optional[float] = None          # G83/G73
    dwell_seconds: Optional[float] = None       # G82
    retract_mode: Optional[Literal["G98", "G99"]] = None
    chip_break_retract_mm: Optional[float] = None  # G73

class MachineEventBlock(BaseModel):
    block_type: Literal["machine_event"] = "machine_event"
    block_id: str
    event_type: Literal[
        "tool_change",
        "spindle_start",
        "spindle_stop",
        "spindle_speed_change",
        "coolant_on",
        "coolant_off",
        "dwell",
        "clamp",
        "unclamp",
        "probe",
        "pallet_change",
        "part_transfer",
        "chuck_open",
        "chuck_close",
        "bar_feed",
        "sync_wait",
        "optional_stop"
    ]
    operation_id: Optional[str] = None
    setup_id: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    # Examples of metadata:
    # tool_change: {"from_tool": "T1", "to_tool": "T2"}
    # spindle_start: {"target_rpm": 12000, "direction": "CW"}
    # dwell: {"duration_seconds": 0.5}

class SetupTransitionBlock(BaseModel):
    block_type: Literal["setup_transition"] = "setup_transition"
    block_id: str
    transition_type: Literal[
        "manual_reorientation",
        "automatic_index",
        "pallet_change",
        "fixture_change",
    ]
    setup_from: Optional[str] = None
    setup_to: str
    duration_seconds: Optional[float] = None    # None = unknown, reduce confidence
    operation_id: Optional[str] = None

ProgramBlock = Union[MotionBlock, CannedCycleBlock, MachineEventBlock, SetupTransitionBlock]

class ProgramExecutionModel(BaseModel):
    schema_version: Literal["execution_v1"] = "execution_v1"
    estimation_level: Literal["planned_operations", "final_toolpath"]
    blocks: List[ProgramBlock]
    source_toolpath_hash: Optional[str] = None
    machine_profile_id: Optional[str] = None
    setup_ids: List[str] = Field(default_factory=list)
