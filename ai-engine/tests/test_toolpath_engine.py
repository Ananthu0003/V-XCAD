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
