from __future__ import annotations
from typing import Literal, Optional, List, Dict, Any
from pydantic import BaseModel, Field
from app.models.timing_profiles import ResolvedTimingParameter

class OperationTimeBreakdown(BaseModel):
    operation_id: str
    operation_type: str
    cutting_time_seconds: float = 0.0
    rapid_time_seconds: float = 0.0
    air_cutting_time_seconds: float = 0.0
    feed_accel_time_seconds: float = 0.0
    spindle_time_seconds: float = 0.0
    coolant_delay_seconds: float = 0.0
    probe_time_seconds: float = 0.0
    optional_stop_seconds: float = 0.0
    overhead_time_seconds: float = 0.0
    total_seconds: float = 0.0
    tool_id: Optional[str] = None
    warnings: List[str] = Field(default_factory=list)

class SetupTimeBreakdown(BaseModel):
    setup_id: str
    machine_cycle_seconds: float = 0.0
    handling_time_seconds: float = 0.0
    total_seconds: float = 0.0
    tool_change_count: int = 0
    warnings: List[str] = Field(default_factory=list)

class CycleTimeCategoryPercentages(BaseModel):
    cutting_percent: float = 0.0
    rapid_percent: float = 0.0
    air_cutting_percent: float = 0.0
    tool_change_percent: float = 0.0
    probe_percent: float = 0.0
    coolant_delay_percent: float = 0.0
    handling_percent: float = 0.0
    setup_percent: float = 0.0

class CycleTimeEstimate(BaseModel):
    status: Literal["complete", "partial", "outdated", "error"]
    machine_type: str
    machine_profile_id: str
    machine_profile_version: str
    estimation_level: Literal["final_toolpath", "planned_operations", "feature_approximation"]
    confidence: Literal["high", "medium", "low"]
    
    # Detailed Breakdown
    cutting_time_seconds: float = 0.0
    rapid_time_seconds: float = 0.0
    air_cutting_time_seconds: float = 0.0
    tool_change_time_seconds: float = 0.0
    probe_time_seconds: float = 0.0
    coolant_delay_seconds: float = 0.0
    handling_time_seconds: float = 0.0
    setup_time_seconds: float = 0.0
    spindle_time_seconds: float = 0.0
    dwell_time_seconds: float = 0.0
    machine_action_time_seconds: float = 0.0
    
    total_cycle_time_seconds: float = 0.0
    percentages: Optional[CycleTimeCategoryPercentages] = None

    automatic_machine_cycle_seconds: float = 0.0
    production_cycle_seconds: Optional[float] = None
    one_time_setup_time_seconds: Optional[float] = None

    expected_minimum_seconds: Optional[float] = None
    expected_maximum_seconds: Optional[float] = None

    operations: List[OperationTimeBreakdown] = Field(default_factory=list)
    setups: List[SetupTimeBreakdown] = Field(default_factory=list)

    warnings: List[str] = Field(default_factory=list)
    assumptions: List[str] = Field(default_factory=list)
    parameter_sources: List[ResolvedTimingParameter] = Field(default_factory=list)

    cycle_time_input_hash: str = ""
    estimator_schema_version: str = "2.0"
    execution_schema_version: str = "execution_v1"
