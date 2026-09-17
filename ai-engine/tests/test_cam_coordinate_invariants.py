import math
import pytest
import build123d as bd
from app.services.geometry.setup_coordinate_resolver import SetupCoordinateResolver
from app.services.planning.planning_context import PlanningContext, _apply_transform_3d
from app.services.validation.coordinate_validator import CoordinateValidator
from app.models.schemas import CoordinateSpaceEnum, ResolvedFeatureGeometry, ToolpathSegmentType


def _mat_mult(m1: list, m2: list) -> list:
    """Multiplies two 16-element row-major 4x4 matrices."""
    res = [0.0] * 16
    for r in range(4):
        for c in range(4):
            val = 0.0
            for k in range(4):
                val += m1[r * 4 + k] * m2[k * 4 + c]
            res[r * 4 + c] = round(val, 6)
    return res


def test_matrix_inversion_round_trip_arbitrary_origins():
    """Verify M_setup_to_model * M_model_to_setup == Identity for arbitrary origins."""
    shape = bd.Solid.make_box(80, 50, 40)
    # Shift shape to arbitrary CAD space
    shape = shape.moved(bd.Location(bd.Vector(123.45, -67.89, 250.0)))

    for origin_pos in ["top_center", "bottom_center", "model_center", "front_left_top"]:
        setup_cfg = {
            "stockType": "box",
            "stockOffset": 2.0,
            "originPosition": origin_pos
        }
        resolver = SetupCoordinateResolver(shape, setup_cfg)
        m_fwd = resolver.get_transform_matrix()
        m_inv = resolver.get_inverse_transform_matrix()

        prod = _mat_mult(m_fwd, m_inv)
        expected_identity = [
            1.0, 0.0, 0.0, 0.0,
            0.0, 1.0, 0.0, 0.0,
            0.0, 0.0, 1.0, 0.0,
            0.0, 0.0, 0.0, 1.0
        ]
        assert prod == expected_identity, f"Round-trip failed for origin {origin_pos}: {prod}"


def test_physical_point_alignment_top_center():
    """Verify that CAD vertices mapped via modelToSetupTransform match Setup bounds."""
    # Box from (0,0,0) to (100, 60, 50) in CAD space
    shape = bd.Solid.make_box(100, 60, 50)
    setup_cfg = {
        "stockType": "box",
        "stockOffset": 0.0,
        "originPosition": "top_center"
    }
    resolver = SetupCoordinateResolver(shape, setup_cfg)
    m_fwd = resolver.get_transform_matrix()
    
    # Top face center in CAD space is (50, 30, 50)
    top_cad = [50.0, 30.0, 50.0]
    top_setup = _apply_transform_3d(top_cad, m_fwd)
    
    # For top_center origin with 0 offset, top center in Setup Space must be (0, 0, 0)
    assert top_setup == [0.0, 0.0, 0.0]
    
    # Bottom face center in CAD space is (50, 30, 0)
    bot_cad = [50.0, 30.0, 0.0]
    bot_setup = _apply_transform_3d(bot_cad, m_fwd)
    assert bot_setup == [0.0, 0.0, -50.0]


def test_cylindrical_stock_setup_diagnostics():
    """Verify that cylindrical/turned stock exposes authoritative Setup Space bounds."""
    shape = bd.Solid.make_cylinder(25, 100) # radius 25 (dia 50), height 100
    setup_cfg = {
        "stockType": "cylinder",
        "stockOffset": 5.0,
        "originPosition": "top_center",
        "stockAxis": "z"
    }
    resolver = SetupCoordinateResolver(shape, setup_cfg)
    diag = resolver.get_coordinate_diagnostics()

    assert diag["coordinateSpace"] == "SETUP"
    assert diag["units"] == "mm"
    assert "stockBoundsSetup" in diag
    assert "modelBoundsSetup" in diag
    assert diag["stockBoundsSetup"]["max"][2] >= 0.0


def test_planning_context_preserves_setup_coordinate_space():
    """Verify PlanningContext transforms feature centroids into Setup Space and tags coordinate_space."""
    shape = bd.Solid.make_box(100, 50, 40)
    setup_cfg = {
        "stockType": "box",
        "stockOffset": 2.0,
        "originPosition": "top_center"
    }
    resolver = SetupCoordinateResolver(shape, setup_cfg)
    setup_meta = resolver.get_setup_metadata()

    features = [
        {
            "id": "feat_pocket_1",
            "type": "pocket",
            "center": [50.0, 25.0, 30.0],
            "dimensions": {"width": 30.0, "length": 40.0, "depth": 10.0}
        }
    ]

    p_ctx = PlanningContext(
        setup=setup_meta,
        machine_profile={"milling_3axis": True},
        material="aluminum_6061",
        features=features
    )
    val = p_ctx.validate()
    assert val["valid"] is True

    geom = p_ctx.get_resolved_geometry("feat_pocket_1")
    assert geom is not None
    assert geom.coordinate_space == CoordinateSpaceEnum.SETUP
    assert geom.units == "mm"
    # The centroid X and Y in setup space should be centered at 0
    assert abs(geom.center_3d[0]) < 0.01
    assert abs(geom.center_3d[1]) < 0.01


def test_coordinate_validator_detects_physical_envelope_violations():
    """Verify CoordinateValidator detects out-of-bounds cutting moves without heuristic centering."""
    validator = CoordinateValidator()

    model_bbox = {"min": [-50.0, -25.0, -50.0], "max": [50.0, 25.0, 0.0]}
    stock_bbox = {"min": [-52.0, -27.0, -52.0], "max": [52.0, 27.0, 2.0]}

    # Valid cutting moves within stock
    valid_segments = [
        {"move_type": "rapid_clearance", "start": {"x": 0, "y": 0, "z": 15}, "end": {"x": 0, "y": 0, "z": 5}},
        {"move_type": "cut", "start": {"x": -20, "y": -10, "z": -5}, "end": {"x": 20, "y": 10, "z": -5}}
    ]
    res = validator.validate_toolpath_in_model_frame(valid_segments, model_bbox, stock_bbox)
    assert res["status"] == "ok"

    # Offending cutting move plunging below stock bottom
    violating_segments = [
        {"move_type": "cut", "start": {"x": 0, "y": 0, "z": -10}, "end": {"x": 0, "y": 0, "z": -75.0}}
    ]
    res_violating = validator.validate_toolpath_in_model_frame(violating_segments, model_bbox, stock_bbox)
    assert res_violating["status"] == "error"
    assert len(res_violating["errors"]) > 0
