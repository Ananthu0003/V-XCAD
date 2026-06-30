import pytest
from app.services.validation.gcode_safety_validator import GCodeSafetyValidator
from app.services.validation.post_output_validator import PostOutputValidator

def test_legacy_path_rejection():
    # Semantic segment validator rejects legacy types
    op = {"type": "drilling", "safe_heights": {"clearance": 50, "retract": 5, "top": 0, "bottom": -10}}
    segments = [{"moveType": "legacy_path", "end": {"x": 0, "y": 0, "z": -5}}]
    res = GCodeSafetyValidator.validate_toolpath_safety(op, segments, {})
    assert not res["valid"]

def test_missing_z_clearance():
    op = {"type": "drilling", "safe_heights": {"retract": 5}} # missing clearance
    segments = [{"moveType": "rapid_clearance", "end": {"z": 50}}]
    res = GCodeSafetyValidator.validate_toolpath_safety(op, segments, {})
    assert not res["valid"]
    assert "Missing safe Z heights" in res["reason"]

def test_first_move_below_retract():
    op = {"type": "drilling", "safe_heights": {"clearance": 50, "retract": 5}}
    segments = [{"moveType": "rapid_xy", "end": {"x": 0, "y": 0, "z": 0}}] # End Z is 0 < retract (5)
    res = GCodeSafetyValidator.validate_toolpath_safety(op, segments, {})
    assert not res["valid"]
    assert "below retract_z" in res["reason"] or "First motion must be at or above" in res["reason"]

def test_rapid_clearance_below_clearance():
    op = {"type": "drilling", "safe_heights": {"clearance": 50, "retract": 5}}
    # First move is safe
    # Second move rapid_clearance below clearance
    segments = [
        {"moveType": "approach_retract", "end": {"x": 0, "y": 0, "z": 10}}, 
        {"moveType": "rapid_clearance", "end": {"x": 0, "y": 0, "z": 20}} # 20 < 50
    ]
    res = GCodeSafetyValidator.validate_toolpath_safety(op, segments, {})
    assert not res["valid"]
    assert "below clearance_z" in res["reason"]

def test_rapid_xy_with_z_change():
    op = {"type": "drilling", "safe_heights": {"clearance": 50, "retract": 5}}
    segments = [
        {"moveType": "approach_retract", "end": {"x": 0, "y": 0, "z": 10}}, 
        {"moveType": "rapid_xy", "start": {"z": 10}, "end": {"x": 10, "y": 10, "z": 5}} # Z changed
    ]
    res = GCodeSafetyValidator.validate_toolpath_safety(op, segments, {})
    assert not res["valid"]
    assert "changes Z" in res["reason"]

def test_post_validator_legacy_marker():
    res = PostOutputValidator.validate_gcode("G0 X0\nLEGACY_PATH\nZ-5", [])
    assert not res["valid"]
    assert "legacy" in res["reason"].lower()

def test_post_validator_unsafe_g0_plunge():
    operations = [{"safe_heights": {"clearance": 50, "retract": 5}}]
    gcode = "M06\nM03\nG43\nG0 X0 Y0 Z-2.0\nM05\nM30"
    res = PostOutputValidator.validate_gcode(gcode, operations)
    assert not res["valid"]
    assert "below retract_z" in res["reason"]

def test_post_validator_safe_g0_then_g1():
    operations = [{"safe_heights": {"clearance": 50, "retract": 5}}]
    gcode = "M06\nM03\nG43\nG0 X0 Y0 Z10.0\nG1 Z-2.0 F100\nM05\nM30"
    res = PostOutputValidator.validate_gcode(gcode, operations)
    assert res["valid"]

def test_post_validator_cut_without_spindle():
    operations = [{"safe_heights": {"clearance": 50, "retract": 5}}]
    gcode = "M06\nG43\nG0 Z10.0\nG1 Z-2.0 F100\nM05\nM30"
    res = PostOutputValidator.validate_gcode(gcode, operations)
    assert not res["valid"]
    assert "before spindle start" in res["reason"]

def test_post_validator_empty_code():
    res = PostOutputValidator.validate_gcode("", [])
    assert not res["valid"]
    assert "empty" in res["reason"].lower()
