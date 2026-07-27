import pytest
from app.models.execution import MotionBlock, Position, MachineEventBlock
from app.models.timing_profiles import MachineTimingProfile
from app.services.cam.cycle_time_engine import CycleTimeEngine
from app.services.cam.program_state_interpreter import ProgramStateInterpreter

@pytest.fixture
def rotary_machine():
    return MachineTimingProfile(
        profile_id="test_5ax",
        machine_type="5-axis-mill",
        rapid_rate_x_mm_min=10000,
        rapid_rate_y_mm_min=10000,
        rapid_rate_z_mm_min=10000,
        acceleration_x_mm_s2=2000,
        acceleration_y_mm_s2=2000,
        acceleration_z_mm_s2=2000,
        rotary_rate_a_deg_min=3600, # 10 deg / sec
        rotary_rate_b_deg_min=7200, # 20 deg / sec
        rotary_acceleration_deg_s2=500,
        axis_clamp_seconds=1.5,
        axis_unclamp_seconds=1.5
    )

def test_rotary_rapid_estimation(rotary_machine):
    engine = CycleTimeEngine(rotary_machine, None, None, {})
    
    # 90 degree move on A axis, 0 on linear
    block = MotionBlock(
        block_id="r1",
        motion_type="rapid",
        start_position=Position(x=0, y=0, z=0, a=0, b=0),
        end_position=Position(x=0, y=0, z=0, a=90, b=0)
    )
    
    dur, conf = engine.estimate_rapid_time(block)
    # v_max = 3600/60 = 60 deg/s
    # accel_d = 60^2 / (2*500) = 3600 / 1000 = 3.6 deg
    # distance is 90, so it reaches top speed.
    # time = (2 * 60 / 500) + (90 - 7.2) / 60
    # time = 0.24 + 82.8 / 60 = 0.24 + 1.38 = 1.62 seconds
    assert abs(dur - 1.62) < 0.05
    assert conf == "high"

def test_inverse_time_feed(rotary_machine):
    engine = CycleTimeEngine(rotary_machine, None, None, {})
    
    # G93 F2.0 means the move should take 1/2 minute = 30 seconds
    block = MotionBlock(
        block_id="r2",
        motion_type="linear",
        start_position=Position(x=0, y=0, z=0, a=0, b=0),
        end_position=Position(x=10, y=10, z=10, a=10, b=10),
        inverse_time_feed=2.0
    )
    
    dur, conf = engine.estimate_feed_time(block)
    assert dur == 30.0
    assert conf == "high"

def test_interpreter_emits_clamps():
    interpreter = ProgramStateInterpreter()
    
    # Rotary rapid
    block = MotionBlock(
        block_id="r3",
        motion_type="rapid",
        start_position=Position(x=0, y=0, z=0, a=0, b=0),
        end_position=Position(x=0, y=0, z=0, a=90, b=0)
    )
    
    emitted = interpreter.process_block(block)
    
    # Should emit: unclamp, the rapid block, clamp
    assert len(emitted) == 3
    assert emitted[0].event_type == "unclamp"
    assert emitted[1] == block
    assert emitted[2].event_type == "clamp"
    
    # State should track that it's clamped
    assert interpreter.state.clamp_state == "clamped"
