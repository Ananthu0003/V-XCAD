import pytest
import math
from app.models.execution import MotionBlock, Position, MachineEventBlock
from app.models.timing_profiles import MachineTimingProfile
from app.services.cam.cycle_time_engine import CycleTimeEngine
from app.services.cam.program_state_interpreter import ProgramStateInterpreter

@pytest.fixture
def lathe_machine():
    return MachineTimingProfile(
        profile_id="test_lathe",
        machine_type="lathe",
        rapid_rate_x_mm_min=15000,
        rapid_rate_z_mm_min=20000,
        acceleration_x_mm_s2=2500,
        acceleration_z_mm_s2=3000,
        chuck_open_seconds=2.0,
        chuck_close_seconds=2.0,
        bar_feed_seconds=5.0,
        sub_spindle_transfer_seconds=12.0
    )

def test_css_time_estimation(lathe_machine):
    engine = CycleTimeEngine(lathe_machine, None, None, {})
    
    # CSS cut from X=100 (Dia 200) to X=20 (Dia 40)
    # Average X = 60 -> Average Dia = 120
    # Surface speed = 150 m/min
    # Avg RPM = (150 * 1000) / (pi * 120) = ~397.88
    # Feed = 0.25 mm/rev
    # Avg Feed mm/min = 0.25 * 397.88 = 99.47 mm/min
    # Distance = 80mm
    # Time = 80 / (99.47 / 60) = ~48.25 seconds
    
    block = MotionBlock(
        block_id="l1",
        motion_type="linear",
        start_position=Position(x=100, y=0, z=0),
        end_position=Position(x=20, y=0, z=0),
        is_css=True,
        surface_speed_m_min=150.0,
        feed_per_rev=0.25
    )
    
    dur, conf = engine.estimate_feed_time(block)
    assert abs(dur - 48.25) < 0.5
    assert conf == "medium"

def test_feed_per_rev_estimation(lathe_machine):
    engine = CycleTimeEngine(lathe_machine, None, None, {})
    
    # RPM = 1000, Feed = 0.5 mm/rev -> Feed = 500 mm/min
    # Distance = 100mm -> 100 / (500/60) = 12 seconds
    block = MotionBlock(
        block_id="l2",
        motion_type="linear",
        start_position=Position(x=50, y=0, z=0),
        end_position=Position(x=50, y=0, z=-100),
        is_css=False,
        spindle_rpm=1000.0,
        feed_per_rev=0.5
    )
    
    dur, conf = engine.estimate_feed_time(block)
    assert abs(dur - 12.0) < 0.1
    
def test_interpreter_css_tracking():
    interpreter = ProgramStateInterpreter()
    
    block = MotionBlock(
        block_id="l3",
        motion_type="linear",
        start_position=Position(x=50, y=0, z=0),
        end_position=Position(x=50, y=0, z=-100),
        is_css=True,
        surface_speed_m_min=150.0,
        feed_per_rev=0.25
    )
    
    interpreter.process_block(block)
    
    assert interpreter.state.is_css_active is True
    assert interpreter.state.feed_mode == "per_revolution"

def test_machine_events(lathe_machine):
    engine = CycleTimeEngine(lathe_machine, None, None, {})
    
    block_chuck = MachineEventBlock(
        block_id="e1",
        event_type="chuck_open"
    )
    
    dur, conf = engine.estimate_machine_event_time(block_chuck)
    assert dur == 2.0
    
    block_transfer = MachineEventBlock(
        block_id="e2",
        event_type="part_transfer"
    )
    
    dur2, conf2 = engine.estimate_machine_event_time(block_transfer)
    assert dur2 == 12.0
