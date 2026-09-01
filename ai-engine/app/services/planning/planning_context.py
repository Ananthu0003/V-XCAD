from typing import Dict, Any, List, Optional
import math
from shapely.geometry import Polygon, MultiPolygon, box, Point
from shapely.ops import unary_union
from app.constants import CYLINDRICAL_STOCK_TYPES

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
        raw_poly = self._get_raw_stock_polygon()
        if raw_poly is None or raw_poly.is_empty:
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
        
    def _extract_dimension_from_params(self, param_dict: Dict[str, Any], candidate_tokens: List[str]) -> Optional[float]:
        """Generalized helper to extract a dimension by token matching from arbitrary parameter keys."""
        if not param_dict or not isinstance(param_dict, dict):
            return None
        for k, v in param_dict.items():
            if not isinstance(v, (int, float)) or float(v) <= 0:
                continue
            norm_k = str(k).strip().lower().replace(" ", "_").replace("-", "_")
            parts = norm_k.split("_")
            for token in candidate_tokens:
                if token in parts or norm_k.endswith(token) or norm_k == token:
                    return float(v)
        return None

    def _get_raw_stock_polygon(self) -> Polygon:
        """Internal helper to generate the 2D bounding stock geometry in Setup space."""
        if self._stock_polygon is not None:
            return self._stock_polygon
            
        bounds = self.stock.get("bounds") or (self.stock.get("resolvedStock", {}).get("bounds") if isinstance(self.stock.get("resolvedStock"), dict) else None)
        if bounds and "min" in bounds and "max" in bounds:
            s_min_x, s_min_y = float(bounds["min"][0]), float(bounds["min"][1])
            s_max_x, s_max_y = float(bounds["max"][0]), float(bounds["max"][1])
        else:
            dims = self.stock.get("stockDimensions") or self.setup.get("stockDimensions")
            
            # Derive bounding envelope from actual features if available
            feat_min_x, feat_max_x = [], []
            feat_min_y, feat_max_y = [], []
            if self.features:
                for f in self.features.values():
                    if not isinstance(f, dict):
                        continue
                    c = f.get("center", [0, 0, 0])
                    d = f.get("dimensions", {})
                    w = float(f.get("width") or d.get("width") or f.get("diameter") or d.get("diameter") or 0.0)
                    l = float(f.get("length") or d.get("length") or f.get("diameter") or d.get("diameter") or 0.0)
                    cx = float(c[0]) if len(c) > 0 else 0.0
                    cy = float(c[1]) if len(c) > 1 else 0.0
                    if w > 0 and l > 0:
                        feat_min_x.append(cx - w / 2.0)
                        feat_max_x.append(cx + w / 2.0)
                        feat_min_y.append(cy - l / 2.0)
                        feat_max_y.append(cy + l / 2.0)
                    elif cx != 0.0 or cy != 0.0:
                        feat_min_x.append(cx - 5.0)
                        feat_max_x.append(cx + 5.0)
                        feat_min_y.append(cy - 5.0)
                        feat_max_y.append(cy + 5.0)

            # Try extracting from parameters if dimensions missing
            raw_params = self.setup.get("parameters") or {}
            param_dia = self._extract_dimension_from_params(raw_params, ["outer_diameter", "diameter", "dia", "od", "radius"])
            param_len = self._extract_dimension_from_params(raw_params, ["total_length", "overall_length", "length", "len", "height"])
            param_width = self._extract_dimension_from_params(raw_params, ["width", "w"])

            if dims and len(dims) >= 2 and float(dims[0]) > 0 and float(dims[1]) > 0:
                stock_w, stock_l = float(dims[0]), float(dims[1])
                # In Setup Space, the stock envelope is centered at (0.0, 0.0) in XY
                s_min_x, s_max_x = -stock_w / 2.0, stock_w / 2.0
                s_min_y, s_max_y = -stock_l / 2.0, stock_l / 2.0
            elif param_dia and param_dia > 0:
                stock_w = param_dia
                stock_l = param_dia
                s_min_x, s_max_x = -stock_w / 2.0, stock_w / 2.0
                s_min_y, s_max_y = -stock_l / 2.0, stock_l / 2.0
            elif param_width and param_len and param_width > 0 and param_len > 0:
                stock_w, stock_l = param_width, param_len
                s_min_x, s_max_x = -stock_w / 2.0, stock_w / 2.0
                s_min_y, s_max_y = -stock_l / 2.0, stock_l / 2.0
            elif feat_min_x and feat_min_y:
                # Add tight 2mm margin around part features
                s_min_x = min(feat_min_x) - 2.0
                s_max_x = max(feat_max_x) + 2.0
                s_min_y = min(feat_min_y) - 2.0
                s_max_y = max(feat_max_y) + 2.0
            else:
                stock_w, stock_l = 30.0, 30.0
                s_min_x, s_max_x = -stock_w / 2.0, stock_w / 2.0
                s_min_y, s_max_y = -stock_l / 2.0, stock_l / 2.0
        
        stock_type = str(self.stock.get("stockType") or self.setup.get("stockType", "")).lower()
        m_type = str(self.machine_profile.get("machine_type", "")).lower()
        is_cylindrical = stock_type in CYLINDRICAL_STOCK_TYPES or any(t in m_type for t in ("lathe", "turning", "mill_turn", "swiss"))
        
        if is_cylindrical:
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
        feat_type = str(feat.get("type", "")).lower()
        
        dia = float(feat.get("diameter") or dims.get("diameter") or 0.0)
        if dia > 0 and (feat_type in ("external_cylinder", "cylinder", "hole", "bore", "boss") or "dia" in dims or "diameter" in dims):
            w = dia
            l = dia
        else:
            w = float(feat.get("width") or dims.get("width") or dia or 0.0)
            l = float(feat.get("length") or dims.get("length") or dia or 0.0)
        
        if w > 0 and l > 0:
            if dia > 0 and (feat_type in ("external_cylinder", "cylinder", "hole", "bore", "boss") or "dia" in dims or "diameter" in dims):
                poly = Point(cx, cy).buffer(dia / 2.0, resolution=32)
            else:
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
