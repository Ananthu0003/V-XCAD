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
    atc_type: Literal["carousel", "chain", "linear", "random_pocket", "manual"] = "carousel"
    atc_capacity: int = 20
    magazine_indexing_time_per_pocket: float = 0.5
    tool_search_time: float = 2.0
    spindle_orient_time: float = 1.0
    spindle_stop_time: float = 2.0
    clamp_unclamp_time: float = 1.5
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
    initial_setup_time_seconds: Optional[float] = 180.0
    fixture_change_time_seconds: Optional[float] = 120.0
    load_time_seconds: Optional[float] = 15.0
    unload_time_seconds: Optional[float] = 10.0
    reorientation_time_seconds: Optional[float] = 20.0
    inspection_time_seconds: Optional[float] = 30.0

class OperationPenaltyProfile(BaseModel):
    modifiers: Dict[str, float] = Field(
        default_factory=lambda: {
            "facing": 1.10,
            "pocket": 1.25,
            "adaptive_pocket": 1.05,
            "contour": 1.15,
            "drilling": 1.05,
            "deep_drilling": 1.30,
            "helical_milling": 1.10,
            "boring": 1.05,
            "chamfering": 1.10,
            "thread_milling": 1.20
        }
    )
    parametric_cutting_split: float = 0.8
    parametric_rapid_split: float = 0.1
    parametric_aircut_split: float = 0.1

class MaterialMachiningProfile(BaseModel):
    material_category: str
    tool_material: str = "carbide"
    surface_speed_m_min: float = 100.0
    chip_load_mm: float = 0.05
    recommended_stepdown_pct: float = 50.0  # Percentage of tool diameter
    recommended_stepover_pct: float = 40.0  # Percentage of tool diameter
    coolant_requirement: Literal["flood", "mist", "air", "through_tool", "none"] = "flood"
    peck_multiplier: float = 1.0
    tool_wear_factor: float = 1.0
    machinability_rating: float = 100.0
    max_engagement_angle: float = 180.0
    specific_cutting_force_n_mm2: float = 700.0  # Approx 0.7 kW/cm3/min for aluminum

class ToolPerformanceProfile(BaseModel):
    max_recommended_mrr_cm3_min: float = 50.0
    max_axial_doc_mm: float = 25.0
    max_radial_woc_mm: float = 10.0
    max_feed_mm_min: float = 10000.0
    performance_modifier: float = 1.0

class CoolantTimingProfile(BaseModel):
    coolant_start_delay_seconds: float = 2.0
    coolant_stop_delay_seconds: float = 1.0
    chip_evacuation_pause_seconds: float = 3.0

class ProbeTimingProfile(BaseModel):
    tool_probe_cycle_seconds: float = 25.0
    workpiece_probe_cycle_seconds: float = 35.0
