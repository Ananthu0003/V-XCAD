from __future__ import annotations
from typing import Literal, Optional, List, Dict, Any
from pydantic import BaseModel, Field

class ResolvedTimingParameter(BaseModel):
    parameter: str
    value: Optional[float] = None
    unit: str = "seconds"
    source: Literal[
        "machine_timing_profile", "controller_timing_profile",
        "setup_override", "workholding_profile", "automation_profile",
        "user_input", "measured_calibration", "manufacturer_specification",
        "generic_machine_family_default", "inferred", "missing"
    ]
    confidence: Literal["high", "medium", "low"]
    profile_id: Optional[str] = None
    profile_version: Optional[str] = None

class ToolChangeTiming(BaseModel):
    timing_mode: Literal["tool_to_tool", "chip_to_chip", "exchange_only"]
    duration_seconds: Optional[float] = None
    includes_spindle_stop: bool = False
    includes_spindle_orientation: bool = False
    includes_axis_positioning: bool = False
    includes_spindle_restart: bool = False
    includes_return_positioning: bool = False

class MachineTimingProfile(BaseModel):
    profile_id: str
    profile_version: str = "1.0"
    rapid_rate_x_mm_min: Optional[float] = None
    rapid_rate_y_mm_min: Optional[float] = None
    rapid_rate_z_mm_min: Optional[float] = None
    acceleration_x_mm_s2: Optional[float] = None
    acceleration_y_mm_s2: Optional[float] = None
    acceleration_z_mm_s2: Optional[float] = None
    spindle_accel_rpm_per_sec: Optional[float] = None
    spindle_decel_rpm_per_sec: Optional[float] = None
    coolant_on_delay_sec: Optional[float] = None
    coolant_off_delay_sec: Optional[float] = None
    tool_change: Optional[ToolChangeTiming] = None
    # Phase 2+
    rotary_rate_a_deg_min: Optional[float] = None
    rotary_rate_b_deg_min: Optional[float] = None
    rotary_acceleration_deg_s2: Optional[float] = None
    axis_clamp_seconds: Optional[float] = None
    axis_unclamp_seconds: Optional[float] = None
    rotary_settling_seconds: Optional[float] = None
    # Phase 3+
    chuck_open_seconds: Optional[float] = None
    chuck_close_seconds: Optional[float] = None
    bar_feed_seconds: Optional[float] = None
    sub_spindle_transfer_seconds: Optional[float] = None
    pallet_change_seconds: Optional[float] = None

class ControllerTimingProfile(BaseModel):
    controller_id: str
    minimum_block_time_seconds: Optional[float] = None
    look_ahead_blocks: Optional[int] = None
    corner_deceleration_model: str = "none"
    feed_acceleration_mm_s2: Optional[float] = None

class SetupHandlingProfile(BaseModel):
    load_time_seconds: Optional[float] = None
    unload_time_seconds: Optional[float] = None
    reorientation_time_seconds: Optional[float] = None
    inspection_time_seconds: Optional[float] = None
