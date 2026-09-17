import pytest
from typing import Dict, Any
from app.services.cam.parametric_feature_extractor import ParametricFeatureExtractor
from app.services.planning.machine_recommendation_engine import MachineRecommendationEngine
from app.services.planning.operation_strategy_planner import OperationStrategyPlanner
from app.services.planning.operation_planner import CamOperation
from app.models.manufacturing import FeatureDecision
from app.services.gcode.gcode_generator import GCodeGenerator


def test_asymmetric_part_recommends_milling_not_turning():
    """Verify that an asymmetric bracket with an external cylindrical boss is NOT classified as a lathe/mill-turn part."""
    rec_engine = MachineRecommendationEngine()
    features = [
        {"id": "feat_boss", "type": "boss", "subtype": "cylindrical_boss", "dimensions": {"diameter": 75.0, "height": 75.0}, "axis": [0.0, 0.0, 1.0]},
        {"id": "feat_bore", "type": "hole", "dimensions": {"diameter": 38.0, "depth": 55.0}, "axis": [0.0, 0.0, 1.0]},
        {"id": "feat_slot", "type": "pocket", "dimensions": {"width": 19.0, "length": 28.0, "depth": 25.0}, "axis": [0.0, 0.0, 1.0]}
    ]
    # Asymmetric bounds: X is 150.5mm, Y is 75mm, Z is 75mm
    topology_info = {
        "bounds": {"min": [-37.5, -37.5, 0.0], "max": [113.0, 37.5, 75.0], "width": 150.5, "length": 75.0, "height": 75.0},
        "is_axisymmetric": False
    }
    rec = rec_engine.recommend_machine(features=features, topology_info=topology_info)
    assert rec.detectedPartType in ("prismatic", "2_sided_prismatic", "multi_sided_prismatic")
    assert rec.detectedPartType != "turned"
    assert rec.detectedPartType != "mill_turn"
    rec_type = getattr(rec, "recommended_machine_type", getattr(rec, "recommendedMachineType", ""))
    assert "LATHE" not in str(rec_type)


def test_asymmetric_extractor_omits_turned_od():
    """Verify that ParametricFeatureExtractor does NOT synthesize a turned_od operation on asymmetric parts."""
    extractor = ParametricFeatureExtractor()
    params = {
        "body_diameter": 75.0,
        "overall_length": 150.5,
        "part_width": 75.0,
        "bore_dia": 38.0,
        "slot_width": 19.0,
        "slot_depth": 25.0
    }
    brep_data = {
        "status": "success",
        "bounds": {"min": [-37.5, -37.5, 0.0], "max": [113.0, 37.5, 75.0], "width": 150.5, "length": 75.0, "height": 75.0}
    }
    feats = extractor.extract(params, brep_data=brep_data)
    turned_ops = [f for f in feats if f.get("recommendedOperation") == "od_turning" or f.get("subtype") == "turned_od"]
    assert len(turned_ops) == 0, f"Found unexpected turned_od features on asymmetric part: {turned_ops}"


def test_slot_position_on_upright_arm():
    """Verify that a U-slot on an upright flange is positioned on the arm, not at [0, 0, 0]."""
    extractor = ParametricFeatureExtractor()
    params = {
        "upright_slot_width": 19.0,
        "upright_slot_length": 28.0,
        "upright_slot_depth": 25.0
    }
    brep_data = {
        "status": "success",
        "bounds": {"min": [-37.5, -37.5, 0.0], "max": [113.0, 37.5, 75.0], "width": 150.5, "length": 75.0, "height": 75.0},
        "cylinders": [{
            "face_id": 10,
            "type": "hole",
            "center": [99.0, 0.0, 50.0],
            "radius": 9.5,
            "diameter": 19.0,
            "depth": 28.0
        }]
    }
    feats = extractor.extract(params, brep_data=brep_data)
    slot_feat = next((f for f in feats if "slot" in f.get("name", "")), None)
    assert slot_feat is not None
    assert slot_feat["center"][0] > 50.0, f"Slot center X {slot_feat['center'][0]} collapsed to origin!"


def test_operation_strategy_orders_counterbore_before_bore():
    """Verify that shallow counterbore pocketing precedes deep through-bore helical milling."""
    planner = OperationStrategyPlanner()
    decisions = [
        FeatureDecision(
            feature_id="feat_through_bore",
            feature_type="hole",
            status="ready",
            setup_assignment="setup-1",
            operation_type="helical_bore_milling",
            manufacturing_strategy="helical_bore_milling",
            parameters={"setup_local_feature": {"localTopZ": 75.0, "depth": 75.0, "diameter": 38.0}}
        ),
        FeatureDecision(
            feature_id="feat_top_cbore",
            feature_type="pocket",
            status="ready",
            setup_assignment="setup-1",
            operation_type="pocket_milling",
            manufacturing_strategy="pocket_milling",
            parameters={"setup_local_feature": {"localTopZ": 75.0, "depth": 10.0, "diameter": 56.0}}
        )
    ]
    ops = planner.plan_operations(decisions, setup_id="setup-1")
    assert len(ops) == 2
    assert ops[0].feature_id == "feat_top_cbore", "Top counterbore must execute before through-bore!"
    assert ops[1].feature_id == "feat_through_bore"


def test_empty_operation_suppresses_gcode_emission():
    """Verify that an operation with zero toolpaths does not emit dead G-code blocks."""
    gen = GCodeGenerator()
    ops = [
        {
            "id": "op_empty",
            "name": "Empty Boss Clearing",
            "type": "boss_clearing",
            "status": "ready",
            "tool": {"tool_id": "T02", "number": 2, "name": "End Mill"},
            "parameters": {"spindleSpeed": 1500},
            "safe_heights": {"clearance": 15.0, "retract": 5.0, "top": 0.0, "bottom": -10.0},
            "toolpaths": []  # Empty
        }
    ]
    res = gen.generate(ops, {"postProcessor": "FANUC_0I_MF", "machineType": "MILL_3X_VMC"})
    gcode = res.get("gcode", "")
    assert "T02" not in gcode
    assert "M103" not in gcode
