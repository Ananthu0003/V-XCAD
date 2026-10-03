from __future__ import annotations
from typing import Literal, Optional, List, Dict, Any
from pydantic import BaseModel, Field
from app.models.execution import Position

class MachineStateSnapshot(BaseModel):
    position: Position = Field(default_factory=Position)
    active_tool_id: Optional[str] = None
    active_tool_offset: Optional[int] = None
    active_work_offset: Optional[str] = None
    units: Literal["mm", "in"] = "mm"
    absolute_mode: bool = True
    active_plane: Literal["XY", "XZ", "YZ"] = "XY"
    feed_mode: Literal["per_minute", "per_revolution", "inverse_time"] = "per_minute"
    is_css_active: bool = False
    current_feed_rate: Optional[float] = None
    spindle_rpm: float = 0.0
    spindle_running: bool = False
    spindle_direction: Optional[Literal["CW", "CCW"]] = None
    coolant_active: bool = False
    active_setup_id: Optional[str] = None
    clamp_state: Optional[Literal["clamped", "unclamped"]] = None
    # Phase 3+
    active_channel: Optional[str] = None
    sub_spindle_state: Optional[str] = None
    turret_position: Optional[int] = None

class TimelineEntry(BaseModel):
    entry_id: str
    block_id: str
    block_type: str
    start_time_seconds: float
    end_time_seconds: float
    duration_seconds: float
    operation_id: Optional[str] = None
    setup_id: Optional[str] = None
    tool_id: Optional[str] = None
    state_before: MachineStateSnapshot
    state_after: MachineStateSnapshot
    time_category: Literal[
        "cutting", "rapid", "tool_change", "spindle",
        "dwell", "machine_action", "handling",
        "probe", "optional_stop", "air_cutting"
    ]
    overlaps_with: Optional[str] = None
    timing_source: Optional[str] = None
    timing_confidence: Literal["high", "medium", "low"] = "high"

class ExecutionTimeline(BaseModel):
    schema_version: str = "timeline_v1"
    estimation_level: Literal["planned_operations", "final_toolpath"]
    entries: List[TimelineEntry] = Field(default_factory=list)
    total_duration_seconds: float = 0.0
    source_execution_hash: Optional[str] = None
