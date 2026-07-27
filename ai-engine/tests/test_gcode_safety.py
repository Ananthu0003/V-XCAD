import pytest
from app.services.gcode.gcode_generator import GCodeGenerator, PostProcessorFactory
from app.models.schemas import ToolpathSegment, Point3D, ToolpathSegmentType

def test_no_raw_model_z_values_in_posted_gcode():
    gen = GCodeGenerator()
    operations = [
        {
            "name": "2d_contour",
            "type": "2d_contour",
            "tool": {"number": 1, "diameter": 10},
            "toolpaths": [
                {
                    "moveType": "rapid_clearance",
                    "end": {"x": 0, "y": 0, "z": 10.0}
                },
                {
                    "moveType": "plunge",
                    "end": {"x": 0, "y": 0, "z": -5.0} # setup local z
                }
            ],
            "safe_heights": {"clearance": 10.0, "retract": 5.0}
        }
    ]
    res = gen.generate(operations)
    assert res["validation"]["status"] == "passed"
    gcode = res["gcode"]
    assert "Z-5.0" in gcode
    assert "Z128" not in gcode

def test_drill_r_plane_above_surface():
    gen = GCodeGenerator()
    operations = [
        {
            "name": "drilling",
            "type": "drilling",
            "tool": {"number": 1},
            "parameters": {"cycle_type": "G81"},
            "toolpaths": [
                {
                    "moveType": "drill_cycle",
                    "end": {"x": 10, "y": 10, "z": -15.0}
                }
            ],
            "safe_heights": {"clearance": 50.0, "retract": 5.0}
        }
    ]
    res = gen.generate(operations)
    assert res["validation"]["status"] == "passed"
    assert "R5.0" in res["gcode"]

def test_heidenhain_cycle_depth_validation():
    gen = GCodeGenerator()
    operations = [
        {
            "name": "drilling",
            "type": "drilling",
            "tool": {"number": 1},
            "toolpaths": [
                {
                    "moveType": "drill_cycle",
                    "end": {"x": 10, "y": 10, "z": -15.0}
                }
            ],
            "safe_heights": {"clearance": 50.0, "retract": 5.0}
        }
    ]
    res = gen.generate(operations, setup_plan={"postProcessor": "HEIDENHAIN_KLARTEXT", "controller": "HEIDENHAIN_TNC"})
    assert res["validation"]["status"] == "passed"
    assert "Q201=-15.0" in res["gcode"]

def test_g43_before_work_z_move():
    gen = GCodeGenerator()
    operations = [
        {
            "name": "2d_contour",
            "type": "2d_contour",
            "tool": {"number": 1, "diameter": 10},
            "toolpaths": [
                {"moveType": "rapid_clearance", "end": {"x": 0, "y": 0, "z": 10.0}}
            ],
            "safe_heights": {"clearance": 50.0, "retract": 5.0}
        }
    ]
    res = gen.generate(operations)
    assert "G43 H1 Z50.0" in res["gcode"]

def test_rapid_validator_fails_on_negative_z():
    gen = GCodeGenerator()
    operations = [
        {
            "name": "2d_contour",
            "type": "2d_contour",
            "tool": {"number": 1, "diameter": 10},
            "toolpaths": [
                {"moveType": "rapid_clearance", "end": {"x": 0, "y": 0, "z": -1.0}}
            ],
            "safe_heights": {"clearance": 50.0, "retract": 5.0}
        }
    ]
    res = gen.generate(operations)
    assert res["validation"]["status"] == "error"
    assert any(i["type"] == "unsafe_rapid" for i in res["validation"]["issues"])



def test_g53_xy_home_disabled_by_default():
    gen = GCodeGenerator()
    res = gen.generate([{"tool": {"number": 1}, "toolpaths": [], "safe_heights": {}}])
    assert "G53 G0 X0. Y0." in res["gcode"]

def test_duplicate_drilling_cycles_are_merged():
    from app.services.cam_pipeline_manager import CamPipelineManager
    manager = CamPipelineManager()
    
    op1 = {
        "id": "op1",
        "type": "drilling",
        "setup_id": "setup1",
        "tool_id": "tool1",
        "feature_id": "feat1",
        "tool": {"geometry": {"DC": 10.0}},
        "parameters": {
            "setup_local_feature": {
                "localCenter": [0, 0, -5],
                "localBottomZ": -15
            }
        }
    }
    op2 = {
        "id": "op2",
        "type": "drilling",
        "setup_id": "setup1",
        "tool_id": "tool1",
        "feature_id": "feat2",
        "tool": {"geometry": {"DC": 10.0}},
        "parameters": {
            "setup_local_feature": {
                "localCenter": [0, 0, -5],
                "localBottomZ": -15
            }
        }
    }
    
    features = [
        {"id": "feat1", "center": [0, 0, 10]},
        {"id": "feat2", "center": [0, 0, 5]}
    ]
    
    deduped = manager._deduplicate_drilling_operations([op1, op2], features)
    assert len(deduped) == 1
    assert deduped[0]["parameters"]["dedupedFromCount"] == 2

def test_drill_centers_preserved_after_setup_transform():
    # If the localCenter has X/Y, it should be used in the deduplication, meaning non-zero XY are preserved
    from app.services.cam_pipeline_manager import CamPipelineManager
    manager = CamPipelineManager()
    op1 = {
        "id": "op1", "type": "drilling", "setup_id": "s1", "tool_id": "t1",
        "tool": {"geometry": {"DC": 5.0}},
        "parameters": {"setup_local_feature": {"localCenter": [12.5, 34.0, 0], "localBottomZ": -10}}
    }
    op2 = {
        "id": "op2", "type": "drilling", "setup_id": "s1", "tool_id": "t1",
        "tool": {"geometry": {"DC": 5.0}},
        "parameters": {"setup_local_feature": {"localCenter": [12.5, 34.0, 0], "localBottomZ": -10}}
    }
    features = [{"id": "feat1", "center": [12.5, 34.0, 0]}, {"id": "feat2", "center": [12.5, 34.0, 0]}]
    deduped = manager._deduplicate_drilling_operations([op1, op2], features)
    assert len(deduped) == 1

def test_all_drilling_centers_not_collapsed_to_origin():
    from app.services.cam_pipeline_manager import CamPipelineManager
    manager = CamPipelineManager()
    # Identical localCenter but different original centers = mapping failed
    op1 = {
        "id": "op1", "type": "drilling", "feature_id": "f1",
        "parameters": {"setup_local_feature": {"localCenter": [0, 0, 0]}}
    }
    op2 = {
        "id": "op2", "type": "drilling", "feature_id": "f2",
        "parameters": {"setup_local_feature": {"localCenter": [0, 0, 0]}}
    }
    features = [{"id": "f1", "center": [10, 10, 0]}, {"id": "f2", "center": [-10, -10, 0]}]
    deduped = manager._deduplicate_drilling_operations([op1, op2], features)
    assert any(op.get("status") == "error" for op in deduped)
    assert any("Drill center mapping failed" in op.get("parameters", {}).get("error", "") for op in deduped)

def test_contour_has_lead_in_and_lead_out():
    from app.services.toolpath.toolpath_engine import ToolpathEngine
    from app.models.schemas import ToolpathSegment, ToolpathSegmentType, Point3D
    engine = ToolpathEngine()
    
    op = {"type": "2d_contour", "tool": {"geometry": {"DC": 10.0}}}
    segments = [
        ToolpathSegment(
            segmentId="1", moveType=ToolpathSegmentType.PLUNGE, toolId="t1", operationId="o1", featureId="f1", setupId="s1",
            start=Point3D(x=0, y=0, z=5), end=Point3D(x=0, y=0, z=-5)
        ),
        ToolpathSegment(
            segmentId="2", moveType=ToolpathSegmentType.CUT, toolId="t1", operationId="o1", featureId="f1", setupId="s1",
            start=Point3D(x=0, y=0, z=-5), end=Point3D(x=0, y=-10, z=-5)
        )
    ]
    out = engine._apply_lead_in_out(op, segments, 10.0)
    # PLUNGE -> LEAD_IN CUT -> MAIN CUT -> LEAD_OUT CUT
    assert any(s.moveType == ToolpathSegmentType.CUT and "leadin" in getattr(s, "segmentId", "") for s in out)
    assert any(s.moveType == ToolpathSegmentType.CUT and "leadout" in getattr(s, "segmentId", "") for s in out)

def test_contour_toolpath_is_radius_compensated():
    from app.services.toolpath.toolpath_engine import ToolpathEngine
    from app.models.schemas import MotionCommand, ToolpathSegmentType, Point3D
    engine = ToolpathEngine()
    
    op = {"type": "2d_contour", "tool": {"geometry": {"DC": 10.0}}}
    cmds = [
        MotionCommand(commandId="1", toolId="t1", operationId="o1", featureId="f1", setupId="s1",
            commandType=ToolpathSegmentType.CUT, start=Point3D(x=0,y=0,z=0), end=Point3D(x=10,y=0,z=0), source="contour")
    ]
    segments = engine.generate_toolpaths_from_commands(op, cmds)
    assert len(segments) > 0
    assert segments[0].toolRadiusCompensated == True
    assert segments[0].toolpathType == "tool_centerline"
    assert segments[0].toolDiameterMm == 10.0

def test_missing_tool_diameter_blocks_contour_generation():
    from app.services.toolpath.toolpath_engine import ToolpathEngine
    from app.models.schemas import MotionCommand, ToolpathSegmentType, Point3D
    engine = ToolpathEngine()
    
    op = {"type": "2d_contour", "tool": {}}
    cmds = [
        MotionCommand(commandId="1", toolId="t1", operationId="o1", featureId="f1", setupId="s1",
            commandType=ToolpathSegmentType.CUT, start=Point3D(x=0,y=0,z=0), end=Point3D(x=10,y=0,z=0), source="contour")
    ]
    segments = engine.generate_toolpaths_from_commands(op, cmds)
    assert len(segments) == 0
    assert op.get("status") == "error"
    assert "Missing tool diameter" in op.get("parameters", {}).get("error", "")
    
def test_g53_xy_home_disabled_by_default():
    from app.services.gcode.gcode_generator import FanucPostProcessor
    post = FanucPostProcessor()
    post.output = []
    post.program_end(setup_plan={"allowMachineXYHomeAtEnd": False})
    out = "\n".join(post.output)
    assert "G53 G0 X0. Y0." not in out
    
    post.output = []
    post.program_end(setup_plan={"allowMachineXYHomeAtEnd": True})
    out2 = "\n".join(post.output)
    assert "G53 G0 X0. Y0." in out2

def test_contour_lead_out_moves_away_from_wall():
    from app.services.toolpath.toolpath_engine import ToolpathEngine
    from app.models.schemas import MotionCommand, Point3D
    engine = ToolpathEngine()
    op = {"type": "2d_contour_outer", "tool": {"diameter": 10.0}}
    cmds = [
        MotionCommand(commandId="1", commandType="plunge", start=Point3D(x=0,y=0,z=5), end=Point3D(x=0,y=0,z=-5), toolId="T1", operationId="O1", featureId="F1", setupId="S1", source="contour"),
        MotionCommand(commandId="2", commandType="cut", start=Point3D(x=0,y=0,z=-5), end=Point3D(x=0,y=10,z=-5), toolId="T1", operationId="O1", featureId="F1", setupId="S1", source="contour"),
        MotionCommand(commandId="3", commandType="cut", start=Point3D(x=0,y=10,z=-5), end=Point3D(x=10,y=10,z=-5), toolId="T1", operationId="O1", featureId="F1", setupId="S1", source="contour"),
        MotionCommand(commandId="4", commandType="cut", start=Point3D(x=10,y=10,z=-5), end=Point3D(x=10,y=0,z=-5), toolId="T1", operationId="O1", featureId="F1", setupId="S1", source="contour"),
        MotionCommand(commandId="5", commandType="cut", start=Point3D(x=10,y=0,z=-5), end=Point3D(x=0,y=0,z=-5), toolId="T1", operationId="O1", featureId="F1", setupId="S1", source="contour"),
    ]
    segs = engine.generate_toolpaths_from_commands(op, cmds)
    lead_in = next((s for s in segs if getattr(s, "segmentRole", None) == "lead_in"), None)
    assert lead_in is not None
    assert lead_in.start.x < 0
    assert lead_in.start.y == 0
    
    lead_out = next((s for s in segs if getattr(s, "segmentRole", None) == "lead_out"), None)
    assert lead_out is not None
    assert lead_out.end.y < 0

def test_lead_out_does_not_follow_finished_contour_edge():
    from app.services.toolpath.toolpath_engine import ToolpathEngine
    from app.models.schemas import MotionCommand, Point3D
    engine = ToolpathEngine()
    op = {"type": "2d_contour_outer", "tool": {"diameter": 10.0}}
    cmds = [
        MotionCommand(commandId="1", commandType="plunge", start=Point3D(x=0,y=0,z=5), end=Point3D(x=0,y=0,z=-5), toolId="T1", operationId="O1", featureId="F1", setupId="S1", source="contour"),
        MotionCommand(commandId="2", commandType="cut", start=Point3D(x=0,y=0,z=-5), end=Point3D(x=0,y=10,z=-5), toolId="T1", operationId="O1", featureId="F1", setupId="S1", source="contour"),
        MotionCommand(commandId="3", commandType="cut", start=Point3D(x=0,y=10,z=-5), end=Point3D(x=10,y=10,z=-5), toolId="T1", operationId="O1", featureId="F1", setupId="S1", source="contour"),
        MotionCommand(commandId="4", commandType="cut", start=Point3D(x=10,y=10,z=-5), end=Point3D(x=10,y=0,z=-5), toolId="T1", operationId="O1", featureId="F1", setupId="S1", source="contour"),
        MotionCommand(commandId="5", commandType="cut", start=Point3D(x=10,y=0,z=-5), end=Point3D(x=0,y=0,z=-5), toolId="T1", operationId="O1", featureId="F1", setupId="S1", source="contour"),
    ]
    segs = engine.generate_toolpaths_from_commands(op, cmds)
    lead_out = next((s for s in segs if getattr(s, "segmentRole", None) == "lead_out"), None)
    assert lead_out.end.y < 0
    assert lead_out.end.x == 0

def test_contour_computer_compensation_allows_g40():
    from app.services.validation.toolpath_validator import ToolpathValidator
    v = ToolpathValidator()
    op = {"type": "2d_contour_outer", "geometry": {"axis": [0,0,1]}}
    toolpaths = [{
        "moveType": "cut",
        "segmentRole": "cut",
        "toolpathType": "tool_centerline",
        "toolRadiusCompensated": True,
        "toolDiameterMm": 10.0,
        "compensationMode": "computer",
        "start": {"x":0,"y":0,"z":0},
        "end": {"x":10,"y":0,"z":0}
    }]
    res = {"errors": [], "status": "passed"}
    v._validate_compensation(op, toolpaths, "op1", "f1", res)
    assert res["status"] == "passed"
    assert len(res["errors"]) == 0

def test_unknown_compensation_blocks_gcode():
    from app.services.validation.toolpath_validator import ToolpathValidator
    v = ToolpathValidator()
    op = {"type": "2d_contour_outer", "geometry": {"axis": [0,0,1]}}
    toolpaths = [{
        "moveType": "cut",
        "segmentRole": "cut",
        "toolpathType": "tool_centerline",
        "toolRadiusCompensated": True,
        "toolDiameterMm": 10.0,
        "compensationMode": "unknown_mode"
    }]
    res = {"errors": [], "status": "passed"}
    v._validate_compensation(op, toolpaths, "op1", "f1", res)
    assert res["status"] == "error"
    assert "Only computer compensation with R0 is currently supported for Klartext" in res["errors"][0]

def test_missing_tool_diameter_blocks_contour_generation():
    from app.services.toolpath.toolpath_engine import ToolpathEngine
    from app.models.schemas import MotionCommand, Point3D
    engine = ToolpathEngine()
    op = {"type": "2d_contour_outer", "tool": {}}
    cmds = [
        MotionCommand(commandId="1", commandType="plunge", start=Point3D(x=0,y=0,z=5), end=Point3D(x=0,y=0,z=-5), toolId="T1", operationId="O1", featureId="F1", setupId="S1", source="contour"),
        MotionCommand(commandId="2", commandType="cut", start=Point3D(x=0,y=0,z=-5), end=Point3D(x=0,y=10,z=-5), toolId="T1", operationId="O1", featureId="F1", setupId="S1", source="contour")
    ]
    segs = engine.generate_toolpaths_from_commands(op, cmds)
    assert len(segs) == 0
    assert op["status"] == "error"
    assert "Missing tool diameter for contour generation" in op.get("parameters", {}).get("error", "")

def test_klartext_q204_uses_safe_clearance():
    from app.services.gcode.gcode_generator import HeidenhainKlartextPostProcessor
    post = HeidenhainKlartextPostProcessor()
    post.generate([
        {
            "type": "drill",
            "tool": {"number": "4", "diameter": 10.0},
            "parameters": {"cycle_type": "G81"},
            "safe_heights": {"clearance": 15.0, "retract": 5.0},
            "toolpaths": [
                {"moveType": "drill_cycle", "end": {"x": 0, "y": 0, "z": -10.0}, "feedrate": 300}
            ]
        }
    ])
    gcode = "\n".join(post.output)
    assert "Q204=15.000 ; 2ND SET-UP CLEARANCE" in gcode

def test_klartext_q202_uses_safe_peck_depth():
    from app.services.gcode.gcode_generator import HeidenhainKlartextPostProcessor
    post = HeidenhainKlartextPostProcessor()
    post.generate([
        {
            "type": "drill",
            "tool": {"number": "4", "diameter": 10.0},
            "parameters": {"cycle_type": "G81"},
            "safe_heights": {"clearance": 15.0, "retract": 5.0},
            "toolpaths": [
                {"moveType": "drill_cycle", "end": {"x": 0, "y": 0, "z": -10.0}, "feedrate": 300}
            ]
        }
    ])
    gcode = "\n".join(post.output)
    assert "Q202=5.000 ; PLUNGING DEPTH" in gcode

def test_klartext_warns_when_lead_move_outside_blk_form():
    from app.services.validation.toolpath_validator import ToolpathValidator
    validator = ToolpathValidator()
    result = {"errors": [], "warnings": [], "status": "valid"}
    validator._validate_compensation(
        {"type": "2d_contour_outer"},
        [
            {
                "moveType": "cut", 
                "segmentRole": "lead_in", 
                "toolpathType": "tool_centerline",
                "toolRadiusCompensated": True,
                "toolDiameterMm": 10.0,
                "compensationMode": "computer",
                "start": {"x": 101.750, "y": 43.500}, 
                "end": {"x": 89.750, "y": 43.500}
            }
        ],
        "feature_1", "f1", result
    )
    
    assert any(isinstance(w, dict) and w.get("code") == "LEAD_MOVE_OUTSIDE_BLK_FORM" for w in result["warnings"])

def test_klartext_blocks_missing_compensation_metadata():
    from app.services.validation.toolpath_validator import ToolpathValidator
    validator = ToolpathValidator()
    
    res1 = {"errors": [], "status": "valid"}
    validator._validate_compensation(
        {"type": "2d_contour_outer"},
        [{"moveType": "cut", "toolpathType": "geometry_boundary"}],
        "feature_1", "f1", res1
    )
    assert "Contour toolpath must be tool-centerline compensated when using R0" in res1["errors"][0]
    
    res2 = {"errors": [], "status": "valid"}
    validator._validate_compensation(
        {"type": "2d_contour_outer"},
        [{"moveType": "cut", "toolpathType": "tool_centerline"}],
        "feature_1", "f1", res2
    )
    assert "Tool radius compensation metadata missing" in res2["errors"][0]
    
    res3 = {"errors": [], "status": "valid"}
    validator._validate_compensation(
        {"type": "2d_contour_outer"},
        [{"moveType": "cut", "toolpathType": "tool_centerline", "toolRadiusCompensated": True}],
        "feature_1", "f1", res3
    )
    assert "Tool diameter missing; cannot validate radius compensation" in res3["errors"][0]
    
    res4 = {"errors": [], "status": "valid"}
    validator._validate_compensation(
        {"type": "2d_contour_outer"},
        [{"moveType": "cut", "toolpathType": "tool_centerline", "toolRadiusCompensated": True, "toolDiameterMm": 12.0, "compensationMode": "controller"}],
        "feature_1", "f1", res4
    )
    assert "Only computer compensation with R0 is currently supported for Klartext" in res4["errors"][0]

def test_klartext_allows_r0_when_computer_compensated():
    from app.services.validation.toolpath_validator import ToolpathValidator
    validator = ToolpathValidator()
    result = {"errors": [], "warnings": [], "status": "valid"}
    validator._validate_compensation(
        {"type": "2d_contour_outer"},
        [
            {
                "moveType": "cut", 
                "toolpathType": "tool_centerline", 
                "toolRadiusCompensated": True, 
                "toolDiameterMm": 12.0, 
                "compensationMode": "computer"
            }
        ],
        "feature_1", "f1", result
    )
    assert len(result["errors"]) == 0
    assert result["status"] == "valid"

def test_klartext_strict_mode_keeps_lead_inside_blk_form():
    from app.services.toolpath.toolpath_engine import ToolpathEngine
    from app.models.schemas import ToolpathSegment, ToolpathSegmentType, Point3D
    engine = ToolpathEngine()
    
    op = {
        "type": "2d_contour_outer",
        "parameters": {"allowLeadOutsideBlank": False}
    }
    
    segments = [
        ToolpathSegment(
            segmentId="1", moveType=ToolpathSegmentType.PLUNGE, 
            start=Point3D(x=100.0, y=95.0, z=5.0), end=Point3D(x=100.0, y=95.0, z=-5.0), 
            source="contour", toolId="t1", operationId="o1", featureId="f1", setupId="s1"
        ),
        ToolpathSegment(
            segmentId="2", moveType=ToolpathSegmentType.CUT, 
            start=Point3D(x=100.0, y=95.0, z=-5.0), end=Point3D(x=100.0, y=0.0, z=-5.0), 
            source="contour", toolId="t1", operationId="o1", featureId="f1", setupId="s1"
        )
    ]
    
    # tool diameter = 10, lead = 10
    # since it's at x=100, going down to x=100, y=0. Plunge is at (100, 95).
    # Normal would be x=1 (outside). Lead-in would go to x=110.
    out_segs = engine._apply_lead_in_out(op, segments, 10.0)
    
    lead_in_cut = next((s for s in out_segs if getattr(s, "segmentRole", None) == "lead_in"), None)
    assert lead_in_cut is not None
    assert lead_in_cut.start.x <= 100.0
    assert lead_in_cut.start.y <= 100.0

def test_klartext_header_contains_setup_preset_note():
    from app.services.gcode.gcode_generator import HeidenhainKlartextPostProcessor
    post = HeidenhainKlartextPostProcessor()
    post.program_start()
    gcode = "\n".join(post.output)
    
    assert "; SETUP NOTE:" in gcode
    assert "; Z0 = STOCK TOP" in gcode
    assert "; XY ZERO = SETUP ORIGIN FROM VEXCAD" in gcode
    assert "; OPERATOR MUST CONFIRM ACTIVE HEIDENHAIN PRESET BEFORE RUNNING" in gcode

def test_blocked_export_for_incompatible_post_processor():
    gen = GCodeGenerator()
    operations = [
        {
            "name": "drilling",
            "type": "drilling",
            "tool": {"number": 1},
            "toolpaths": [
                {"moveType": "drill_cycle", "end": {"x": 10, "y": 10, "z": -15.0}}
            ],
            "safe_heights": {"clearance": 50.0, "retract": 5.0}
        }
    ]
    # Requesting a Heidenhain post on a Fanuc controller should be blocked
    res = gen.generate(operations, setup_plan={"postProcessor": "HEIDENHAIN_KLARTEXT", "controller": "FANUC_0I_MF"})
    assert res["validation"]["status"] == "error"
    assert res["gcode"] == ""
    assert any(i["type"] == "incompatible_post_processor" for i in res["validation"]["issues"])

def test_unsupported_controller_raises_error():
    from app.cam.posts import get_post_processor
    with pytest.raises(ValueError, match="NC export is blocked for unvalidated machine configurations"):
        get_post_processor("UNKNOWN_UNVERIFIED_CNC", {})
