import pytest
from typing import Dict, Any

from app.models.execution import (
    ProgramExecutionModel, MotionBlock, MachineEventBlock, CannedCycleBlock,
    Position
)
from app.models.timeline import MachineStateSnapshot
from app.models.timing_profiles import (
    MachineTimingProfile, ControllerTimingProfile, SetupHandlingProfile, ToolChangeTiming
)
from app.services.cam.cycle_time_engine import CycleTimeEngine
from app.services.cam.execution_timeline_builder import ExecutionTimelineBuilder


@pytest.fixture
def mock_profiles():
    m_timing = MachineTimingProfile(
        profile_id="test_machine",
        rapid_rate_x_mm_min=10000,
        rapid_rate_y_mm_min=10000,
        rapid_rate_z_mm_min=10000,
        acceleration_x_mm_s2=1000,
        acceleration_y_mm_s2=1000,
        acceleration_z_mm_s2=500,
        spindle_accel_rpm_per_sec=2500,  # 5000 rpm / 2500 = 2.0s
        spindle_decel_rpm_per_sec=3333.333, # 5000 / 1.5s = ~3333
        tool_change=ToolChangeTiming(
            timing_mode="tool_to_tool",
            duration_seconds=5.0,
            includes_spindle_stop=True
        )
    )
    
    c_timing = ControllerTimingProfile(
        controller_id="test_controller",
        controller_family="TEST",
        block_processing_time=0.001,
        lookahead_blocks=100,
        smoothing_factor=0.9
    )
    
    h_profile = SetupHandlingProfile(
        profile_id="test_handling",
        handling_complexity="LOW",
        base_setup_time=300,
        part_load_unload_time=30
    )
    
    defaults = {
        "max_feed_rate": 5000,
        "max_rapid_rate": 10000,
        "acceleration_xy": 1000,
        "acceleration_z": 500,
        "tool_change_time": 5.0
    }
    
    return m_timing, c_timing, h_profile, defaults

@pytest.fixture
def cycle_time_engine(mock_profiles):
    m_timing, c_timing, h_profile, defaults = mock_profiles
    return CycleTimeEngine(m_timing, c_timing, h_profile, defaults)


def test_calculate_linear_move_rapid(cycle_time_engine):
    block = MotionBlock(
        block_id="b1",
        motion_type="rapid",
        start_position=Position(x=0, y=0, z=0),
        end_position=Position(x=100, y=0, z=0)
    )
    time_s, conf = cycle_time_engine.estimate_rapid_time(block)
    print(f"RAPID time: {time_s}")
    assert time_s > 0

def test_calculate_linear_move_feed(cycle_time_engine):
    block = MotionBlock(
        block_id="b1",
        motion_type="linear",
        start_position=Position(x=0, y=0, z=0),
        end_position=Position(x=100, y=0, z=0),
        feed_rate=1200
    )
    time_s, conf = cycle_time_engine.estimate_feed_time(block)
    print(f"FEED time: {time_s}")
    assert time_s > 0

def test_calculate_spindle_event(cycle_time_engine):
    # Starting spindle
    block = MachineEventBlock(
        block_id="e1",
        event_type="spindle_start",
        value="5000",
        metadata={"target_rpm": 5000}
    )
    time_s, conf = cycle_time_engine.estimate_machine_event_time(block)
    print(f"SPINDLE START time: {time_s}")
    assert time_s > 0
    
    # Stopping spindle
    block = MachineEventBlock(
        block_id="e2",
        event_type="spindle_stop"
    )
    time_s, conf = cycle_time_engine.estimate_machine_event_time(block)
    print(f"SPINDLE STOP time: {time_s}")
    assert time_s > 0

def test_calculate_tool_change(cycle_time_engine):
    block = MachineEventBlock(
        block_id="tc1",
        event_type="tool_change",
        value="T2"
    )
    time_s, conf = cycle_time_engine.estimate_machine_event_time(block)
    print(f"TOOL CHANGE time: {time_s}")
    assert time_s > 0

def test_execution_timeline_builder(cycle_time_engine):
    builder = ExecutionTimelineBuilder(cycle_time_engine)
    
    b1 = MachineEventBlock(
        block_id="b1",
        event_type="tool_change",
        value="T1",
        tool_id="T1"
    )
    b2 = MachineEventBlock(
        block_id="b2",
        event_type="spindle_start",
        value="5000",
        tool_id="T1",
        metadata={"target_rpm": 5000}
    )
    b3 = MotionBlock(
        block_id="b3",
        motion_type="rapid",
        start_position=Position(x=0, y=0, z=0),
        end_position=Position(x=100, y=0, z=0),
        tool_id="T1"
    )
    b4 = MotionBlock(
        block_id="b4",
        motion_type="linear",
        start_position=Position(x=100, y=0, z=0),
        end_position=Position(x=100, y=100, z=0),
        feed_rate=1200,
        tool_id="T1"
    )
    
    model = ProgramExecutionModel(setup_id="setup1", blocks=[b1, b2, b3, b4], estimation_level="planned_operations")
    
    timeline = builder.build(model)
    
    assert len(timeline.entries) == 4
    
    # Tool change
    assert timeline.entries[0].time_category == "tool_change"
    assert timeline.entries[0].duration_seconds == 5.0
    
    # Spindle on
    assert timeline.entries[1].time_category == "spindle"
    assert timeline.entries[1].duration_seconds == 2.0
    
    # Rapid move (100mm -> ~0.765s)
    assert timeline.entries[2].time_category == "rapid"
    assert timeline.entries[2].duration_seconds > 0
    
    # Feed move
    assert timeline.entries[3].time_category == "cutting"
    assert timeline.entries[3].duration_seconds > 0.0

    total = sum(e.duration_seconds for e in timeline.entries)
    assert abs(timeline.total_duration_seconds - total) < 0.001
