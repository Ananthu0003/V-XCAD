"""Unit tests for AiGeometryPlanner — fast-path rule-based and fallback planning."""
import pytest
from app.models.cad_modification import AiPlanRequest
from app.services.agents.ai_geometry_planner import AiGeometryPlanner


@pytest.fixture
def planner():
    return AiGeometryPlanner()


def test_offset_face_outward(planner):
    req = AiPlanRequest(
        session_id="test_sess",
        command="offset this face outward by 2 mm",
        selected_entity_ids=["face_1"],
    )
    res = planner.plan(req)
    assert res.error is None
    assert res.plan is not None
    assert res.plan.operation_type == "offset_face"
    assert res.plan.target_entity_ids == ["face_1"]
    assert res.plan.parameters["distance"] == 2.0


def test_offset_face_inward(planner):
    req = AiPlanRequest(
        session_id="test_sess",
        command="push face inward by 1.5mm",
        selected_entity_ids=["face_4"],
    )
    res = planner.plan(req)
    assert res.error is None
    assert res.plan is not None
    assert res.plan.operation_type == "offset_face"
    assert res.plan.parameters["distance"] == -1.5


def test_snap_to_plane(planner):
    req = AiPlanRequest(
        session_id="test_sess",
        command="align face to global Z=0",
        selected_entity_ids=["face_base"],
    )
    res = planner.plan(req)
    assert res.error is None
    assert res.plan is not None
    assert res.plan.operation_type == "snap_to_plane"
    assert res.plan.parameters["plane"] == "XY"
    assert res.plan.parameters["target_coordinate"] == 0.0


def test_plug_hole(planner):
    req = AiPlanRequest(
        session_id="test_sess",
        command="plug this bore",
        selected_entity_ids=["face_cyl_2"],
    )
    res = planner.plan(req)
    assert res.error is None
    assert res.plan is not None
    assert res.plan.operation_type == "plug_hole"
    assert res.plan.target_entity_ids == ["face_cyl_2"]


def test_select_coplanar(planner):
    req = AiPlanRequest(
        session_id="test_sess",
        command="select all coplanar faces",
        selected_entity_ids=["face_1"],
    )
    res = planner.plan(req)
    assert res.error is None
    assert res.plan is not None
    assert res.plan.operation_type == "select_coplanar"


def test_select_similar(planner):
    req = AiPlanRequest(
        session_id="test_sess",
        command="find matching bores",
        selected_entity_ids=["face_cyl_1"],
    )
    res = planner.plan(req)
    assert res.error is None
    assert res.plan is not None
    assert res.plan.operation_type == "select_similar"


def test_fillet(planner):
    req = AiPlanRequest(
        session_id="test_sess",
        command="fillet 2.5 mm",
        selected_entity_ids=["edge_1"],
    )
    res = planner.plan(req)
    assert res.error is None
    assert res.plan is not None
    assert res.plan.operation_type == "fillet"
    assert res.plan.parameters["radius"] == 2.5


def test_chamfer(planner):
    req = AiPlanRequest(
        session_id="test_sess",
        command="apply 1.0 mm chamfer",
        selected_entity_ids=["edge_2"],
    )
    res = planner.plan(req)
    assert res.error is None
    assert res.plan is not None
    assert res.plan.operation_type == "chamfer"
    assert res.plan.parameters["distance"] == 1.0


def test_edit_feature_metric_clearance(planner):
    req = AiPlanRequest(
        session_id="test_sess",
        command="increase these holes to M6 clearance",
        selected_entity_ids=["face_cyl_3"],
    )
    res = planner.plan(req)
    assert res.error is None
    assert res.plan is not None
    assert res.plan.operation_type == "edit_feature"
    assert res.plan.parameters["diameter"] == 6.6
