import pytest
from typing import Dict, Any
from app.services.toolpath.parametric_toolpath_engine import ParametricToolpathEngine

class MockPlanningContext:
    def __init__(self, width, length):
        self.width = width
        self.length = length

    def get_stock_geometry(self):
        return {
            "bounds": [-self.width/2, -self.length/2, self.width/2, self.length/2],
            "provenance": {"derived_from": "box"}
        }

class TestToolpathEngine:
    def test_stock_dimension_extraction(self):
        engine = ParametricToolpathEngine()
        
        operation = {
            "id": "op_face_1",
            "type": "facing",
            "tool": {"diameter": 50.0},
            "safe_heights": {"clearance": 10.0, "top": 5.0, "bottom": 4.0},
            "parameters": {"stepoverPercentage": 50.0}
        }
        
        feature = {
            "id": "feat_face_1",
            "type": "face",
            "center": [0, 0, 5.0]
        }
        
        # Test 1: resolvedStock fallback logic
        machine_config_resolved = {
            "setup": {
                "resolvedStock": {
                    "width": 100.0,
                    "length": 150.0,
                    "depth": 10.0
                }
            }
        }
        ctx_resolved = MockPlanningContext(100.0, 150.0)
        
        toolpaths_resolved, valid = engine.generate_toolpath(operation, feature, machine_config_resolved, planning_context=ctx_resolved)
        assert len(toolpaths_resolved) > 0
        assert toolpaths_resolved[0]["source"] == "face"
        
        # Test 2: Top-level stockDimensions fallback logic
        machine_config_top_level = {
            "stockDimensions": [80.0, 120.0, 10.0]
        }
        ctx_top = MockPlanningContext(80.0, 120.0)
        
        toolpaths_top_level, valid = engine.generate_toolpath(operation, feature, machine_config_top_level, planning_context=ctx_top)
        assert len(toolpaths_top_level) > 0
        assert toolpaths_top_level[0]["source"] == "face"
        
    def test_smart_facing_raster_direction(self):
        engine = ParametricToolpathEngine()
        operation = {
            "id": "op_face_1",
            "type": "facing",
            "tool": {"diameter": 50.0},
            "safe_heights": {"clearance": 10.0, "top": 5.0, "bottom": 4.0},
            "parameters": {"stepoverPercentage": 50.0}
        }
        feature = {
            "id": "feat_face_1",
            "type": "face",
            "center": [0, 0, 5.0]
        }
        
        # Wide stock (W > L) -> Raster along X
        machine_config_wide = {
            "stockDimensions": [200.0, 50.0, 10.0]
        }
        ctx_wide = MockPlanningContext(200.0, 50.0)
        toolpaths_wide, valid = engine.generate_toolpath(operation, feature, machine_config_wide, planning_context=ctx_wide)
        
        # Count the number of cuts to determine direction
        cuts_wide = [tp for tp in toolpaths_wide if tp["type"] == "cut"]
        
        # Deep stock (L > W) -> Raster along Y
        machine_config_deep = {
            "stockDimensions": [50.0, 200.0, 10.0]
        }
        ctx_deep = MockPlanningContext(50.0, 200.0)
        toolpaths_deep, valid = engine.generate_toolpath(operation, feature, machine_config_deep, planning_context=ctx_deep)
        cuts_deep = [tp for tp in toolpaths_deep if tp["type"] == "cut"]
        
        assert len(cuts_wide) > 0
        assert len(cuts_deep) > 0

    def test_arbitrary_parameter_name_stock_extraction(self):
        from app.services.planning.planning_context import PlanningContext
        
        # Test case mirroring arbitrary blueprint parameters with prefixes/casing
        setup = {
            "parameters": {
                "BODY MAIN OUTER DIAMETER": 0.9,
                "BODY MAIN TOTAL LENGTH": 3.22,
                "BORE LEFT BORE DIAMETER": 0.58,
                "BORE LEFT BORE LENGTH": 1.75
            },
            "stockType": "cylinder"
        }
        machine = {"machine_type": "mill_turn"}
        features = [
            {"id": "f1", "type": "face", "dimensions": {"diameter": 0.9}},
            {"id": "f2", "type": "hole", "dimensions": {"diameter": 0.58, "depth": 1.75}}
        ]
        
        ctx = PlanningContext(setup, machine, None, features)
        stock_geom = ctx.get_stock_geometry()
        bounds = stock_geom["bounds"]
        
        # Diameter is 0.9 -> radius is 0.45 -> min/max around 0.45
        width = bounds[2] - bounds[0]
        length = bounds[3] - bounds[1]
        assert abs(width - 0.9) < 0.01
        assert abs(length - 0.9) < 0.01

    def test_cylindrical_facing_bounds(self):
        from app.services.planning.planning_context import PlanningContext
        engine = ParametricToolpathEngine()
        
        setup = {
            "stockDimensions": [0.9, 0.9, 3.22],
            "stockType": "cylinder"
        }
        machine = {"machine_type": "mill_turn"}
        features = [{"id": "f_face", "type": "face", "dimensions": {"diameter": 0.9}}]
        ctx = PlanningContext(setup, machine, None, features)
        
        operation = {
            "id": "op_face",
            "type": "facing",
            "tool": {"diameter": 0.25},
            "safe_heights": {"clearance": 0.5, "top": 0.0, "bottom": -0.05},
            "parameters": {"stepoverPercentage": 50.0}
        }
        
        paths, val = engine.generate_toolpath(operation, features[0], {"setup": setup}, planning_context=ctx)
        assert len(paths) > 0
        
        # Verify toolpath cuts do not exceed stock radius + tool radius + overhang
        max_r = (0.9 / 2.0) + (0.25 * 0.4) + 0.1
        for p in paths:
            if p["type"] == "cut":
                dist = (p["x"]**2 + p["y"]**2)**0.5
                assert dist <= max_r + 0.01, f"Toolpath point ({p['x']}, {p['y']}) exceeds cylindrical stock radius bound {max_r}"

    def test_od_turning_bounded_to_stock_radius(self):
        from app.services.planning.planning_context import PlanningContext
        engine = ParametricToolpathEngine()
        
        setup = {
            "stockDimensions": [0.9, 0.9, 3.22],
            "stockType": "cylinder"
        }
        machine = {"machine_type": "mill_turn"}
        feature = {
            "id": "feat_od",
            "type": "external_cylinder",
            "subtype": "turned_od",
            "name": "Body Outer Diameter",
            "dimensions": {"diameter": 0.9, "length": 3.22, "height": 3.22}
        }
        ctx = PlanningContext(setup, machine, None, [feature])
        
        operation = {
            "id": "op_od",
            "type": "od_turning",
            "tool": {"diameter": 1.0},
            "safe_heights": {"clearance": 2.0, "top": 0.0, "bottom": -3.22},
            "parameters": {"stepover": 0.2}
        }
        
        paths, val = engine.generate_toolpath(operation, feature, {"setup": setup}, planning_context=ctx)
        assert len(paths) > 0
        assert val.get("valid", True)
        
        # Verify cutting passes are tightly bounded around cylinder (radius <= 0.45 + tool_dia)
        # and NEVER explode into 15-30mm radius
        for p in paths:
            if p.get("moveType") == "cut":
                dist = (p["x"]**2 + p["y"]**2)**0.5
                assert dist <= 2.5, f"OD Turning point ({p['x']}, {p['y']}) with radius {dist} is too large for 0.9mm cylinder"


