from typing import Dict, Any, List, Optional
import math
from shapely.geometry import Polygon, MultiPolygon, box
from shapely.ops import unary_union

class PlanningContext:
    """
    Immutable single source of truth for CAM planning geometry and parameters.
    Handles coordinate transformations, stock resolution, and boolean operations,
    abstracting away the underlying geometry engine (Shapely).
    """
    def __init__(self, setup: Dict[str, Any], machine_profile: Dict[str, Any], material: Any, features: List[Dict[str, Any]]):
        self.setup = setup
        self.machine_profile = machine_profile
        self.material = material
        self.features = {f.get("id", f"feat_{i}"): f for i, f in enumerate(features)}
        
        self.stock = setup.get("resolvedStock", {})
        self.transforms = {
            "model_to_setup": setup.get("modelToSetupTransform"),
            "setup_to_model": setup.get("setupToModelTransform"),
            "wcs": setup.get("wcs", "G54")
        }
        
        # We will lazy-load the base stock polygon to support caching
        self._stock_polygon = None
        
    def validate(self) -> Dict[str, Any]:
        """
        Validates the overall context. If invalid, returns a dict with 'valid'=False and 'errors'.
        """
        errors = []
        if not self.stock or not self.stock.get("bounds"):
            errors.append("No valid stock geometry or boundaries defined in the setup.")
        
        # Verify transforms
        if not self.transforms["model_to_setup"]:
            # Fallback to identity matrix if missing, rather than blocking the pipeline
            self.transforms["model_to_setup"] = [
                [1.0, 0.0, 0.0, 0.0],
                [0.0, 1.0, 0.0, 0.0],
                [0.0, 0.0, 1.0, 0.0],
                [0.0, 0.0, 0.0, 1.0]
            ]
            
        return {"valid": len(errors) == 0, "errors": errors}
        
    def _get_raw_stock_polygon(self) -> Polygon:
        """Internal helper to generate the 2D bounding stock geometry in Setup space."""
        if self._stock_polygon is not None:
            return self._stock_polygon
            
        bounds = self.stock.get("bounds")
        if bounds and "min" in bounds and "max" in bounds:
            s_min_x, s_min_y = bounds["min"][0], bounds["min"][1]
            s_max_x, s_max_y = bounds["max"][0], bounds["max"][1]
        else:
            # Fallback to stockDimensions if bounds are not explicitly provided
            dims = self.stock.get("stockDimensions", [100.0, 100.0, 100.0])
            stock_w, stock_l = float(dims[0]), float(dims[1])
            s_min_x, s_max_x = -stock_w / 2.0, stock_w / 2.0
            s_min_y, s_max_y = -stock_l / 2.0, stock_l / 2.0
        
        stock_type = str(self.stock.get("stockType", "")).lower()
        
        if stock_type in ("cylinder", "relative_cylinder", "fixed_cylinder"):
            cx = (s_min_x + s_max_x) / 2.0
            cy = (s_min_y + s_max_y) / 2.0
            radius = min(s_max_x - s_min_x, s_max_y - s_min_y) / 2.0
            points = []
            num_points = 64
            for i in range(num_points):
                angle = 2 * math.pi * i / num_points
                points.append((cx + radius * math.cos(angle), cy + radius * math.sin(angle)))
            self._stock_polygon = Polygon(points)
        else:
            self._stock_polygon = box(s_min_x, s_min_y, s_max_x, s_max_y)
            
        return self._stock_polygon

    def get_stock_geometry(self) -> Dict[str, Any]:
        """Returns the generic stock boundary envelope."""
        poly = self._get_raw_stock_polygon()
        return {
            "type": "stock",
            "polygon": poly,
            "area": poly.area,
            "bounds": poly.bounds,
            "provenance": {
                "source": "SetupPlanner",
                "space": "Setup Coordinates",
                "derived_from": self.stock.get("stockType", "box")
            }
        }

    def get_feature_geometry(self, feature_id: str) -> Optional[Dict[str, Any]]:
        """Returns the explicit bounding geometry for a feature."""
        feat = self.features.get(feature_id)
        if not feat:
            return None
            
        # Try to resolve a polygon from the feature
        center = feat.get("center", [0, 0, 0])
        cx, cy = center[0], center[1]
        dims = feat.get("dimensions", {})
        
        w = float(feat.get("width") or dims.get("width") or feat.get("diameter") or dims.get("diameter") or 0.0)
        l = float(feat.get("length") or dims.get("length") or feat.get("diameter") or dims.get("diameter") or 0.0)
        
        if w > 0 and l > 0:
            poly = box(cx - w/2, cy - l/2, cx + w/2, cy + l/2)
        else:
            poly = Polygon() # Empty
            
        return {
            "type": "feature",
            "polygon": poly,
            "area": poly.area,
            "bounds": poly.bounds if not poly.is_empty else (),
            "provenance": {
                "source": "FeatureExtractor",
                "space": "Setup Coordinates",
                "derived_from": "Feature dimensions"
            }
        }
        
    def get_machining_region(self, feature_id: str, tool_radius: float, strategy: str = "default") -> Dict[str, Any]:
        """
        Calculates the safe machining area for an operation.
        Machining Region = Stock + Expansion - Keepouts - Fixtures.
        """
        stock_geom = self.get_stock_geometry()
        stock_poly = stock_geom["polygon"]
        
        feat_geom = self.get_feature_geometry(feature_id)
        feat_poly = feat_geom["polygon"] if feat_geom else Polygon()
        
        machining_area = stock_poly
        keepout = Polygon()
        
        if strategy == "boss_clearing":
            # For Boss Clearing, the tool is allowed to step outside the stock bounds slightly.
            # Machining area extended slightly beyond stock so tool can plunge outside.
            machining_area = stock_poly.buffer(tool_radius + 2.0, join_style=2)
            
            # The keepout is the boss itself + tool radius + finish allowance
            finish_allowance = 0.5 # Could be parameterized
            if not feat_poly.is_empty:
                keepout = feat_poly.buffer(tool_radius + finish_allowance, join_style=2)
                
            safe_area = machining_area.difference(keepout)
            
        elif strategy == "pocketing":
            # For pockets, we machine strictly INSIDE the feature boundary, offset by tool radius
            if not feat_poly.is_empty:
                safe_area = feat_poly.buffer(-tool_radius, join_style=2)
            else:
                safe_area = Polygon()
                
        elif strategy == "facing":
            # Facing generally machines the entire top face of the stock
            safe_area = stock_poly
            
        else:
            safe_area = stock_poly
            
        return {
            "type": "machining_region",
            "polygon": safe_area,
            "keepout_polygon": keepout,
            "extended_machining_area": machining_area,
            "area": safe_area.area,
            "is_valid": safe_area.is_valid and not safe_area.is_empty,
            "bounds": safe_area.bounds if not safe_area.is_empty else (),
            "provenance": {
                "source": "PlanningContext",
                "strategy": strategy,
                "tool_radius": tool_radius,
                "space": "Setup Coordinates"
            }
        }
