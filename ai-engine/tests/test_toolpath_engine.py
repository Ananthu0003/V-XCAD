import pytest
from typing import Dict, Any
from app.services.toolpath.parametric_toolpath_engine import ParametricToolpathEngine

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
        
        toolpaths_resolved = engine.generate_toolpath(operation, feature, machine_config_resolved)
        assert len(toolpaths_resolved) > 0
        assert toolpaths_resolved[0]["source"] == "face"
        
        # Test 2: Top-level stockDimensions fallback logic
        machine_config_top_level = {
            "stockDimensions": [80.0, 120.0, 10.0]
        }
        
        toolpaths_top_level = engine.generate_toolpath(operation, feature, machine_config_top_level)
        assert len(toolpaths_top_level) > 0
        assert toolpaths_top_level[0]["source"] == "face"
        
        # The first toolpath should be rastering along the longest dimension
        # For 80 x 120, longest is Y, so it should start rastering along Y
        
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
        toolpaths_wide = engine.generate_toolpath(operation, feature, machine_config_wide)
        
        # Count the number of cuts to determine direction
        cuts_wide = [tp for tp in toolpaths_wide if tp["type"] == "cut"]
        
        # Deep stock (L > W) -> Raster along Y
        machine_config_deep = {
            "stockDimensions": [50.0, 200.0, 10.0]
        }
        toolpaths_deep = engine.generate_toolpath(operation, feature, machine_config_deep)
        cuts_deep = [tp for tp in toolpaths_deep if tp["type"] == "cut"]
        
        assert len(cuts_wide) > 0
        assert len(cuts_deep) > 0
        
        # For wide stock, X values should change significantly on the first cut
        diff_x_wide = abs(cuts_wide[0]["end"]["x"] - cuts_wide[0]["start"]["x"])
        diff_y_wide = abs(cuts_wide[0]["end"]["y"] - cuts_wide[0]["start"]["y"])
        assert diff_x_wide > diff_y_wide
        
        # For deep stock, Y values should change significantly on the first cut
        diff_x_deep = abs(cuts_deep[0]["end"]["x"] - cuts_deep[0]["start"]["x"])
        diff_y_deep = abs(cuts_deep[0]["end"]["y"] - cuts_deep[0]["start"]["y"])
        assert diff_y_deep > diff_x_deep
