import pytest
from app.services.cam.material_validation import get_material_profile
from app.services.cam.parametric_feature_extractor import ParametricFeatureExtractor
from app.services.planning.operation_strategy_planner import OperationStrategyPlanner
from app.services.tooling.tool_recommendation_engine import ToolRecommendationEngine
from app.services.toolpath.parametric_toolpath_engine import ParametricToolpathEngine
from app.services.gcode.gcode_generator import GCodeGenerator, FanucLathePostProcessor, PostProcessorFactory


def test_blueprint_punch_cam_generation_end_to_end():
    # 1. Blueprint Drawing Parameters (VI/44-2R Chamfering Punch Punch: HSS / HRC 58-60)
    parameters = {
        "material": "HSS / HRC 58-60",
        "stock_od": 8.0,
        "overall_length": 22.7,
        "base_dia": 8.0,
        "base_length": 3.5,
        "shank_dia": 6.0,
        "shank_length": 17.0,
        "shank_fillet_radius": 0.5,
        "tip_dia": 4.74,
        "tip_length": 2.2,
        "tip_nose_radius": 1.0,
    }

    # 2. Material Validation Matrix Matching
    mat_profile = get_material_profile("HSS / HRC 58-60")
    assert mat_profile.material_id in ("hss_m2", "tool_steel_d2")
    assert mat_profile.cutting_speed <= 45.0  # Safe cutting speed for hardened HSS/tool steel (not 300 m/min aluminum default)

    # 3. Parametric Feature Extraction
    extractor = ParametricFeatureExtractor()
    features = extractor.extract(parameters=parameters)
    
    # Check that facing is the first feature in the setup
    assert features[0]["type"] == "face"
    assert features[0]["name"] == "Top Face (Setup 1)"
    
    # Check stepped features exist with proper sequential topZ and bottomZ
    tip_feat = next((f for f in features if "tip" in f.get("name", "").lower()), None)
    shank_feat = next((f for f in features if "shank" in f.get("name", "").lower()), None)
    
    assert tip_feat is not None
    assert tip_feat["machiningRegion"]["topZ"] == 0.0
    assert tip_feat["machiningRegion"]["bottomZ"] == -2.2
    assert tip_feat["corner_radius"] == 1.0
    
    assert shank_feat is not None
    assert shank_feat["machiningRegion"]["topZ"] == -2.2
    assert shank_feat["machiningRegion"]["bottomZ"] == -19.2
    assert shank_feat["fillet_radius"] == 0.5

    # 4. Tool Recommendation & Feeds/Speeds
    from app.models.manufacturing import MachineProfile, ToolProfile
    
    turning_tool = ToolProfile(
        tool_id="T1",
        name="Carbide Turning Tool",
        type="turning_tool",
        diameter=6.0,
        flute_count=1,
        cutting_length=25.0,
        stickout=35.0,
        compatible_materials=["steel", "hardened_steel", "tool_steel"],
        compatible_operations=["od_turning", "od_finish_turning", "facing_turning"]
    )
    machine = MachineProfile(
        machine_id="lathe_2axis",
        machine_name="2-Axis CNC Lathe",
        machine_type="lathe",
        axis_count=2,
        spindle_limits={"min_rpm": 50, "max_rpm": 5000},
        feed_limits={"max_feed": 3000}
    )
    tool_engine = ToolRecommendationEngine(tool_library=[turning_tool])
    tool_p, status, reason, fs = tool_engine.recommend_tool(
        feature=tip_feat,
        operation_type="od_turning",
        machine=machine,
        material=mat_profile,
        setup={"resolvedStock": {"bounds": {"min": [0, 0, 0], "max": [8.0, 8.0, 22.7]}}}
    )
    assert status == "ready"
    assert fs["spindle_rpm"] < 5000  # Lathe RPM safely calculated for workpiece diameter and HSS material

    # 5. Lathe Toolpath Generation
    engine = ParametricToolpathEngine()
    
    # Test Lathe Facing
    face_op = {
        "id": "op_face_1",
        "type": "facing_turning",
        "tool_id": "T1",
        "tool": {"diameter": 6.0, "tool_number": 1, "name": "Carbide Turning Tool"},
        "machining_strategy": "lathe_facing",
        "parameters": {"feed_rate": fs["feedrate_mm_min"], "plunge_rate": fs["plunge_feedrate"], "spindleSpeed": fs["spindle_rpm"]}
    }
    face_paths, _ = engine.generate_toolpath(face_op, features[0], machine_config={"machine_type": "lathe", "stockDimensions": [8.0, 8.0, 22.7]})
    assert len(face_paths) > 0
    assert any(p.get("moveType") == "cut" and p.get("x", 0.0) <= 0.0 for p in face_paths)

    # Test Lathe OD Finishing (with R1.0 nose radius arc blend and R0.5 shoulder fillet)
    finish_op = {
        "id": "op_finish_1",
        "type": "od_finish_turning",
        "tool_id": "T1",
        "tool": {"diameter": 6.0, "tool_number": 1, "name": "Carbide Turning Tool"},
        "machining_strategy": "profile_finishing",
        "parameters": {"feed_rate": fs["feedrate_mm_min"], "plunge_rate": fs["plunge_feedrate"], "spindleSpeed": fs["spindle_rpm"]}
    }
    tip_paths, _ = engine.generate_toolpath(finish_op, tip_feat, machine_config={"machine_type": "lathe", "stockDimensions": [8.0, 8.0, 22.7]})
    assert len(tip_paths) > 0
    # Must have nose radius arc move in XZ plane
    assert any(p.get("moveType") in ("arc_cw", "arc_ccw") and p.get("plane") == "XZ" for p in tip_paths)

    # 6. G-Code Generation with FanucLathePostProcessor
    gcode_gen = GCodeGenerator()
    ops_payload = [
        {
            "id": "op_face_1",
            "type": "facing_turning",
            "name": "Facing (Lathe)",
            "tool": {"tool_number": 1, "name": "Carbide Turning Tool", "offset_number": 1},
            "parameters": {"spindleSpeed": fs["spindle_rpm"], "feed_rate": fs["feedrate_mm_min"]},
            "toolpaths": face_paths
        },
        {
            "id": "op_finish_1",
            "type": "od_finish_turning",
            "name": "OD Finish Turning",
            "tool": {"tool_number": 1, "name": "Carbide Turning Tool", "offset_number": 1},
            "parameters": {"spindleSpeed": fs["spindle_rpm"], "feed_rate": fs["feedrate_mm_min"]},
            "toolpaths": tip_paths
        }
    ]
    setup_plan = {
        "machineType": "lathe",
        "postProcessor": "AUTO"
    }
    result = gcode_gen.generate(ops_payload, setup_plan=setup_plan)
    assert result["validation"]["status"] == "passed", f"Validation failed: {result['validation'].get('issues')}"
    gcode = result["gcode"]
    
    # Validate G-Code properties:
    assert "G18" in gcode  # XZ plane for turning
    assert "G90" in gcode  # Absolute programming
    assert "G97" in gcode  # Safe constant RPM
    assert "T0101" in gcode  # Lathe tool format
    assert "G2" in gcode or "G3" in gcode  # True circular interpolation for nose radius
    assert "G0 X" in gcode  # Initial approach coordinates emitted before cut
