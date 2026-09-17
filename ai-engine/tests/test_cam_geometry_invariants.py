import pytest
from shapely.geometry import Polygon, Point
from app.services.planning.planning_context import PlanningContext
from app.services.toolpath.parametric_toolpath_engine import ParametricToolpathEngine
from app.services.gcode.gcode_generator import PostProcessorFactory, GCodeGenerator
from app.services.cam.parametric_feature_extractor import ParametricFeatureExtractor


def test_immutable_planning_context():
    """Verify PlanningContext is strictly locked and cannot be mutated after validation."""
    setup = {
        "stockDimensions": [100.0, 100.0, 50.0],
        "modelToSetupTransform": [
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0, 1.0]
        ]
    }
    machine = {"machine_type": "3_axis_mill"}
    features = [{"id": "f_test", "type": "pocket", "width": 40.0, "length": 40.0, "depth": 10.0}]
    
    ctx = PlanningContext(setup, machine, None, features)
    assert ctx._locked is False
    v = ctx.validate()
    assert v["valid"] is True
    assert ctx._locked is True


def test_no_global_dimension_leakage():
    """Verify that an arbitrary scalar parameter (e.g. recess_depth_bottom: 4) is NEVER converted to a 4x4mm square."""
    extractor = ParametricFeatureExtractor()
    params = {
        "part_od": 75.0,
        "part_length": 113.0,
        "recess_depth_bottom": 4.0  # Scalar depth parameter with NO width/length
    }
    features = extractor.extract(params)
    
    # Should NOT produce a 4x4mm pocket feature
    fake_squares = [
        f for f in features 
        if f.get("type") == "pocket" 
        and f.get("dimensions", {}).get("width") == 4.0 
        and f.get("dimensions", {}).get("length") == 4.0
    ]
    assert len(fake_squares) == 0, f"Found leaked synthetic 4x4mm square: {fake_squares}"


def test_feature_geometry_unavailable_blocks_operation():
    """Verify that a feature missing boundary geometry fails fast with FEATURE_GEOMETRY_UNAVAILABLE."""
    engine = ParametricToolpathEngine()
    op = {
        "id": "op_pocket_err",
        "type": "pocketing",
        "tool": {"diameter": 10.0},
        "safe_heights": {"clearance": 15.0, "retract": 5.0, "top": 0.0, "bottom": -10.0}
    }
    # Feature with NO dimensions and NO geometry
    feature = {
        "id": "feat_corrupt",
        "type": "pocket",
        "center": [0, 0, 0]
    }
    
    with pytest.raises(ValueError, match="FEATURE_GEOMETRY_UNAVAILABLE"):
        engine.generate_toolpath(op, feature, {})


def test_complete_face_region_with_islands():
    """Verify PlanningContext and toolpath engine handle complete face regions with inner island wires."""
    setup = {
        "stockDimensions": [100.0, 100.0, 50.0],
        "modelToSetupTransform": [
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0, 1.0]
        ]
    }
    machine = {"machine_type": "3_axis_mill"}
    
    # Simulated B-Rep data with an outer square (60x60) and an inner circular island (dia 20)
    outer_3d = [
        [-30.0, -30.0, 0.0], [30.0, -30.0, 0.0], [30.0, 30.0, 0.0], [-30.0, 30.0, 0.0]
    ]
    # Circle approximation with 16 points for inner island
    import math
    inner_3d = [[round(10.0 * math.cos(2*math.pi*i/16), 3), round(10.0 * math.sin(2*math.pi*i/16), 3), 0.0] for i in range(16)]
    
    brep_data = {
        "status": "success",
        "pockets": [{
            "face_id": 1,
            "plane_type": "XY",
            "center": [0.0, 0.0, 0.0],
            "normal": [0.0, 0.0, 1.0],
            "u_axis": [1.0, 0.0, 0.0],
            "v_axis": [0.0, 1.0, 0.0],
            "outer_wire_3d": outer_3d,
            "inner_wires_3d": [inner_3d],
            "area": 3600.0 - (math.pi * 100.0),
            "width": 60.0,
            "length": 60.0,
            "depth_from_top": 8.0
        }]
    }
    
    features = [{
        "id": "feat_island_pocket",
        "type": "pocket",
        "width": 60.0,
        "length": 60.0,
        "depth": 8.0
    }]
    
    ctx = PlanningContext(setup, machine, None, features, brep_data=brep_data)
    ctx.validate()
    
    poly = ctx.get_feature_polygon("feat_island_pocket")
    assert poly is not None
    assert len(poly.interiors) == 1, "Inner island wire was not preserved in PlanningContext polygon!"
    
    # Verify machining region avoids island
    mr = ctx.get_machining_region("feat_island_pocket", tool_radius=4.0, strategy="pocketing")
    assert mr["status"] == "OK"
    assert mr["polygon"].is_valid
    assert not mr["polygon"].contains(Point(0.0, 0.0)), "Toolpath machining region invaded the central island!"


def test_depth_calculation_no_blind_halving():
    """Verify that a blind hole or pocket is not blindly halved to 56.5 or default depths."""
    from app.services.planning.setup_planner import SetupPlanner
    from app.models.schemas import MachineCapability
    
    planner = SetupPlanner()
    features = [{
        "id": "feat_deep_pocket",
        "type": "pocket",
        "dimensions": {"depth": 75.0, "z_top": 0.0, "z_bottom": -75.0},
        "machiningRegion": {"depth": 75.0, "topZ": 0.0, "bottomZ": -75.0},
        "axis": [0.0, 0.0, 1.0],
        "is_through": False  # Explicit blind feature
    }]
    
    cap = MachineCapability(milling_3axis=True)
    setups = planner.plan_setups(
        features=features,
        machine_capability=cap,
        topology_info={"bounds": [-37.5, -37.5, -113.0, 37.5, 37.5, 0.0]}
    )
    
    # Feature depth must remain 75.0, NOT halved to 56.5
    f_depth = features[0]["machiningRegion"]["depth"]
    assert f_depth == 75.0, f"Depth was corrupted to {f_depth} instead of remaining 75.0!"


def test_hard_gcode_gate_blocks_invalid_operations():
    """Verify that GCodeGenerator refuses to emit G-code when operations fail geometry validation."""
    gen = GCodeGenerator()
    ops = [{
        "id": "op_corrupt",
        "type": "pocketing",
        "status": "blocked",
        "parameters": {"error": "FEATURE_GEOMETRY_UNAVAILABLE"}
    }]
    
    res = gen.generate(ops, setup_plan={"postProcessor": "FANUC"})
    assert res["validation"]["status"] == "failed" or res["validation"]["status"] == "error"
    assert res["gcode"] == ""


def test_circular_recess_geometry_and_toolpath():
    """Verify circular recesses produce circular polygons and concentric circular toolpaths."""
    from app.services.planning.planning_context import PlanningContext
    from app.services.toolpath.parametric_toolpath_engine import ParametricToolpathEngine
    from shapely.geometry import Point

    feat = {
        "id": "feat_recess_circ",
        "type": "pocket",
        "subtype": "circular_pocket",
        "name": "counterbore_recess",
        "is_circular": True,
        "diameter": 56.0,
        "center": [0.0, 0.0, 10.0],
        "dimensions": {"width": 56.0, "length": 56.0, "depth": 10.0, "diameter": 56.0}
    }
    setup = {
        "id": "setup-1",
        "stockType": "box",
        "modelToSetupTransform": [
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0, 1.0]
        ]
    }
    stock = {"stockType": "box", "width": 150.0, "length": 80.0, "depth": 100.0}
    setup["resolvedStock"] = stock
    ctx = PlanningContext(setup=setup, machine_profile={}, material="aluminum", features=[feat])

    poly = ctx.get_feature_polygon("feat_recess_circ")
    assert poly is not None and not poly.is_empty
    # Circular polygon area should be approx pi * R^2 = pi * 28^2 = 2463.0
    expected_area = 3.14159 * (28.0 ** 2)
    assert abs(poly.area - expected_area) / expected_area < 0.05, f"Polygon area {poly.area} not circular!"

    engine = ParametricToolpathEngine()
    op = {
        "id": "op_pocket",
        "type": "pocketing",
        "tool": {"diameter": 12.0},
        "parameters": {"stepover": 5.0, "stepdown": 5.0},
        "safe_heights": {"clearance": 15.0, "retract": 5.0, "top": 10.0, "bottom": 0.0}
    }
    moves, val = engine.generate_toolpath(op, feat, {"setup": setup, "planning_context": ctx})
    assert val["valid"] is True
    assert len(moves) > 0

    # Ensure toolpath contains cutting moves centered around [0, 0]
    cut_moves = [m for m in moves if m.get("type") == "cut"]
    assert len(cut_moves) > 0
    for m in cut_moves:
        # Distance from center should be <= radius + tool_radius
        dist = (m["x"]**2 + m["y"]**2)**0.5
        assert dist <= 35.0, f"Move {m} exceeded circular pocket boundary!"


def test_bore_depth_from_cylinder_topology():
    """Verify that hole/bore depth does NOT fall back to part length or stock length."""
    from app.services.cam.parametric_feature_extractor import ParametricFeatureExtractor

    extractor = ParametricFeatureExtractor()
    parameters = {
        "bore_dia": 38.0
        # Notice: no explicit depth provided
    }
    brep_data = {
        "status": "success",
        "holes": [{
            "face_id": 4,
            "type": "hole",
            "center": [0.0, 0.0, 37.5],
            "axis": [0.0, 0.0, 1.0],
            "diameter": 38.0,
            "depth": 54.98,
            "is_through": True
        }],
        "bounds": {"width": 150.0, "length": 75.0, "height": 75.0}
    }
    feats = extractor.extract(parameters, brep_data=brep_data)
    bore_feat = next((f for f in feats if f.get("name") == "bore" or f.get("type") == "hole"), None)
    assert bore_feat is not None
    assert bore_feat["dimensions"]["depth"] == 54.98, f"Depth {bore_feat['dimensions']['depth']} did not match B-Rep depth 54.98!"
    assert bore_feat["center"] == [0.0, 0.0, 37.5]


def test_outer_contour_from_brep_silhouette():
    """Verify that outer contouring traces the actual silhouette polygon rather than a 4-sided box."""
    from app.services.planning.planning_context import PlanningContext
    from app.services.toolpath.parametric_toolpath_engine import ParametricToolpathEngine
    from shapely.geometry import Polygon

    # Arbitrary non-rectangular profile (e.g. L-shape or polygon with 6 vertices)
    poly_coords = [
        [0.0, 0.0], [100.0, 0.0], [100.0, 40.0], [40.0, 40.0], [40.0, 80.0], [0.0, 80.0], [0.0, 0.0]
    ]
    feat = {
        "id": "feat_contour_profile",
        "type": "contour",
        "subtype": "outer_profile",
        "wire_3d": [[p[0], p[1], 0.0] for p in poly_coords],
        "polygon_2d": poly_coords,
        "center": [50.0, 40.0, 0.0],
        "dimensions": {"width": 100.0, "length": 80.0, "depth": 20.0}
    }
    setup = {
        "id": "setup-1",
        "stockType": "box",
        "modelToSetupTransform": [
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0, 1.0]
        ]
    }
    stock = {"stockType": "box", "width": 120.0, "length": 100.0, "depth": 30.0}
    setup["resolvedStock"] = stock
    brep_data = {
        "status": "success",
        "silhouette": {"polygon_2d": poly_coords, "wire_3d": [[p[0], p[1], 0.0] for p in poly_coords]}
    }
    ctx = PlanningContext(setup=setup, machine_profile={}, material="aluminum", features=[feat], brep_data=brep_data)

    outer_poly = ctx.get_outer_contour_polygon()
    assert outer_poly is not None
    assert len(outer_poly.exterior.coords) >= 6, "Outer contour was simplified into a box!"

    engine = ParametricToolpathEngine()
    op = {
        "id": "op_contour",
        "type": "2d_contour",
        "tool": {"diameter": 10.0},
        "parameters": {"stepdown": 10.0},
        "safe_heights": {"clearance": 15.0, "retract": 5.0, "top": 0.0, "bottom": -20.0}
    }
    moves, val = engine.generate_toolpath(op, feat, {"setup": setup, "planning_context": ctx})
    assert val["valid"] is True
    # The cutting moves should have more than 4 corners (not a box)
    cut_moves = [m for m in moves if m.get("type") == "cut" and m.get("z") == -10.0]
    assert len(cut_moves) >= 6, f"Toolpath generated only {len(cut_moves)} moves, expected multi-segment profile!"


def test_gcode_endpoint_setup_id_resolution():
    """Verify that setup_id query variations ('setup-1', 'setup_1', 'Setup 1') resolve correctly."""
    from app.api.v1.router import CamGCodeRequest, cam_generate_gcode
    import asyncio

    # Test that CamGCodeRequest accepts operations and setup_id
    req = CamGCodeRequest(
        session_id="cmt144m5g0009u6mketkfv4qa",
        job_id="cmt144m5g0009u6mketkfv4qa",
        setup_id="setup-1"
    )
    assert req.setup_id == "setup-1"

    # Run the endpoint coroutine
    res = asyncio.run(cam_generate_gcode(req))
    assert res.get("can_generate_gcode") is True, f"Expected successful G-code generation, got: {res}"
    assert len(res.get("gcode") or "") > 0


def test_annular_pocket_tool_too_large_rejection():
    """Invariant A: Annular pocket where cutter exceeds passage width must fail with TOOL_TOO_LARGE_FOR_GEOMETRY."""
    import math
    from app.services.planning.planning_context import PlanningContext
    from app.services.toolpath.parametric_toolpath_engine import ParametricToolpathEngine
    from shapely.geometry import Point

    # Annular ring: Outer radius 28mm (dia 56mm), Inner radius 20mm (hole dia 40mm). Passage width = 8mm.
    outer_pts = [[28.0 * math.cos(2*math.pi*i/32), 28.0 * math.sin(2*math.pi*i/32)] for i in range(32)]
    inner_pts = [[20.0 * math.cos(2*math.pi*i/32), 20.0 * math.sin(2*math.pi*i/32)] for i in range(32)]

    feat = {
        "id": "feat_annular_pocket",
        "type": "pocket",
        "name": "annular_ring",
        "axis": [0.0, 0.0, 1.0],
        "center": [0.0, 0.0, 0.0],
        "min_passage_width": 8.0,
        "dimensions": {"depth": 10.0, "width": 56.0, "length": 56.0, "min_passage_width": 8.0}
    }
    brep_data = {
        "pockets": [{
            "face_id": 99,
            "center": [0.0, 0.0, 0.0],
            "normal": [0.0, 0.0, 1.0],
            "outer_wire_3d": [[p[0], p[1], 0.0] for p in outer_pts],
            "inner_wires_3d": [[[p[0], p[1], 0.0] for p in inner_pts]],
            "depth_from_entry": 10.0,
            "depth_from_top": 10.0
        }]
    }
    feat["face_id"] = 99
    setup = {
        "id": "setup-1",
        "stockType": "box",
        "resolvedStock": {"stockType": "box", "dimensions": [100.0, 100.0, 50.0]},
        "modelToSetupTransform": [[1,0,0,0], [0,1,0,0], [0,0,1,0], [0,0,0,1]]
    }
    ctx = PlanningContext(setup=setup, machine_profile={}, material="aluminum", features=[feat], brep_data=brep_data)
    engine = ParametricToolpathEngine()

    # 10mm cutter in 8mm passage -> must fail safely
    op_oversized = {
        "id": "op_annular",
        "type": "pocket_milling",
        "tool": {"diameter": 10.0},
        "safe_heights": {"clearance": 15.0, "retract": 5.0, "top": 0.0, "bottom": -10.0}
    }
    moves, val = engine.generate_toolpath(op_oversized, feat, {"setup": setup, "planning_context": ctx})
    assert val["valid"] is False
    assert "TOOL_TOO_LARGE_FOR_GEOMETRY" in val["error"]

    # 4mm cutter in 8mm passage -> must succeed without plunging in center
    op_valid = {
        "id": "op_annular",
        "type": "pocket_milling",
        "tool": {"diameter": 4.0},
        "safe_heights": {"clearance": 15.0, "retract": 5.0, "top": 0.0, "bottom": -10.0}
    }
    moves_ok, val_ok = engine.generate_toolpath(op_valid, feat, {"setup": setup, "planning_context": ctx})
    assert val_ok["valid"] is True
    assert len(moves_ok) > 0
    # Plunges must not occur at (0, 0)
    for m in moves_ok:
        if m.get("type") == "plunge":
            assert abs(m.get("x", 0.0)) > 1.0 or abs(m.get("y", 0.0)) > 1.0


def test_multistage_accessibility_minimum_set_cover_3axis_vs_5axis():
    """Invariant B: Opposing faces (+Z and -Z) dynamically yield 2 setups on 3-axis and 1 setup on 5-axis."""
    from app.services.planning.setup_planner import SetupPlanner
    from app.models.schemas import MachineCapability

    f_top = {
        "id": "feat_top_face",
        "type": "pocket",
        "name": "top_pocket",
        "axis": [0.0, 0.0, 1.0],
        "requiredMachining": True
    }
    f_bottom = {
        "id": "feat_bottom_face",
        "type": "pocket",
        "name": "bottom_pocket",
        "axis": [0.0, 0.0, -1.0],
        "requiredMachining": True
    }
    feats = [f_top, f_bottom]
    planner = SetupPlanner()

    # 3-Axis Mill: Cannot reach opposing sides simultaneously -> Must produce 2 setups
    caps_3axis = MachineCapability(milling_3axis=True, turning=False, pocketing=True)
    setups_3axis = planner.plan_setups(feats, caps_3axis)
    assert len(setups_3axis) == 2
    assert "feat_top_face" in setups_3axis[0].assignedFeatureIds
    assert "feat_bottom_face" in setups_3axis[1].assignedFeatureIds
    assert setups_3axis[0].toolAxis == [0.0, 0.0, 1.0]
    assert setups_3axis[1].toolAxis == [0.0, 0.0, -1.0]

    # 5-Axis Mill: Articulation covers both orientations in 1 setup
    caps_5axis = MachineCapability(milling_5axis=True, pocketing=True)
    setups_5axis = planner.plan_setups(feats, caps_5axis)
    assert len(setups_5axis) == 1
    assert "feat_top_face" in setups_5axis[0].assignedFeatureIds
    assert "feat_bottom_face" in setups_5axis[0].assignedFeatureIds


def test_facing_allowance_omission_when_flush():
    """Invariant D: Facing feature is omitted when stock top is flush with model top."""
    from app.services.cam.parametric_feature_extractor import ParametricFeatureExtractor

    extractor = ParametricFeatureExtractor()
    # Stock top = 75.0, model max Z = 75.0 (allowance = 0.0)
    setup = {"stockType": "box", "stockDimensions": [100.0, 100.0, 75.0]}
    brep_data = {"bounds": {"min": [-50.0, -50.0, 0.0], "max": [50.0, 50.0, 75.0]}}
    params = {"pocket_depth": 10.0, "pocket_width": 20.0}

    features = extractor.extract(params, setup=setup, brep_data=brep_data)
    face_feats = [f for f in features if f.get("type") == "face"]
    assert len(face_feats) == 0, f"Expected no facing operation when stock is flush, got: {face_feats}"


def test_bore_strategy_on_mill_resolves_helical_bore_milling():
    """Verify internal bore features on 3-axis mill resolve to helical_bore_milling and not boss_clearing."""
    from app.services.planning.manufacturing_strategy_planner import ManufacturingStrategyPlanner

    feat = {
        "id": "feat_bore_center",
        "type": "bore",
        "diameter": 32.0,
        "axis": [0.0, 0.0, 1.0],
        "dimensions": {"depth": 20.0, "diameter": 32.0}
    }
    strategy = ManufacturingStrategyPlanner.determine_strategy(feat, "3_axis_mill", setup_axis=[0.0, 0.0, 1.0])
    assert strategy == "helical_bore_milling", f"Expected helical_bore_milling, got: {strategy}"


def test_slot_and_cavity_operation_planning():
    """Verify slot and cavity features are accepted by OperationPlanner and generate toolpaths."""
    from app.services.planning.operation_planner import OperationPlanner
    from app.services.toolpath.parametric_toolpath_engine import ParametricToolpathEngine

    planner = OperationPlanner()
    features = [
        {"id": "feat_slot_1", "type": "slot", "width": 12.0, "length": 40.0, "dimensions": {"depth": 8.0, "z_top": 0.0}},
        {"id": "feat_cavity_1", "type": "cavity", "width": 30.0, "length": 30.0, "dimensions": {"depth": 15.0, "z_top": 0.0}},
    ]
    ops = planner.plan_operations(features, "3_axis_mill")
    assert len(ops) == 2
    assert all(op["status"] != "error" for op in ops)

    engine = ParametricToolpathEngine()
    for op, feat in zip(ops, features):
        paths, val = engine.generate_toolpath(op, feat, {})
        assert val["valid"] is True
        assert len(paths) > 0




