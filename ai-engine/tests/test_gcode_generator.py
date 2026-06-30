import pytest
from app.services.gcode.gcode_generator import PostProcessorFactory
from app.services.validation.gcode_safety_validator import GCodeSafetyValidator
from app.services.validation.post_output_validator import PostOutputValidator
from app.services.validation.manufacturing_capability_validator import ManufacturingCapabilityValidator
from app.services.toolpath.toolpath_engine import ToolpathEngine

def test_legacy_path_blocked_in_engine():
    engine = ToolpathEngine()
    op = {"type": "legacy_path"}
    # Pass empty command just to trigger type block
    res = engine.generate_toolpaths_from_commands(op, [])
    assert len(res) == 0
    assert op.get("status") == "blocked"

def test_legacy_path_blocked_in_validator():
    op = {"type": "legacy_path"}
    res = ManufacturingCapabilityValidator.validate_operation(op, {}, {}, {})
    assert not res["valid"]

def test_missing_tool_blocked():
    op = {"type": "2d_contour"}
    res = ManufacturingCapabilityValidator.validate_operation(op, {}, {"axes": 3}, {})
    assert not res["valid"]
    assert "No tool selected" in res["reason"]

def test_safe_z_logic():
    op = {
        "type": "drilling", 
        "safe_heights": {"clearance": 50, "retract": 5, "top": 0, "bottom": -10}
    }
    segments = [{"moveType": "rapid", "end": {"z": 2}}] # Z=2 is below retract=5
    res = GCodeSafetyValidator.validate_toolpath_safety(op, segments, {})
    assert not res["valid"]
    assert "First motion must be at or above safe retract Z." in res["reason"] or "below retract_z" in res["reason"]

def test_post_processor_output_validation():
    # Provide bad G-code missing M06
    bad_gcode = "G0 X0 Y0\nG1 Z-1 F100\nM30"
    res = PostOutputValidator.validate_gcode(bad_gcode, [])
    assert not res["valid"]
    assert "M06" in res["reason"]

def test_good_gcode_output():
    good_gcode = """%
O1001
T1 M06
S6000 M03
G43 H1 Z50
G0 X0 Y0 Z50
G1 Z-5 F300
M05
M30
%"""
    res = PostOutputValidator.validate_gcode(good_gcode, [])
    assert res["valid"]
