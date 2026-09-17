from typing import Dict, Any, List, Optional, Tuple
import math
from shapely.geometry import Polygon, MultiPolygon, box, Point
from shapely.ops import unary_union
from app.constants import CYLINDRICAL_STOCK_TYPES
from app.models.schemas import ResolvedFeatureGeometry, FaceRegion


def _apply_transform_3d(pt: List[float], matrix: Optional[Any]) -> List[float]:
    """Multiply a 3D point [X, Y, Z] by a 4x4 affine transformation matrix."""
    if not matrix:
        return list(pt)
    x = float(pt[0]) if len(pt) > 0 else 0.0
    y = float(pt[1]) if len(pt) > 1 else 0.0
    z = float(pt[2]) if len(pt) > 2 else 0.0
    if isinstance(matrix, list) and len(matrix) == 16 and isinstance(matrix[0], (int, float)):
        # 16-element flat row-major matrix
        m = matrix
        tx = m[0] * x + m[1] * y + m[2] * z + m[3]
        ty = m[4] * x + m[5] * y + m[6] * z + m[7]
        tz = m[8] * x + m[9] * y + m[10] * z + m[11]
    elif isinstance(matrix, list) and len(matrix) >= 3 and isinstance(matrix[0], list):
        m = matrix
        tx = m[0][0] * x + m[0][1] * y + m[0][2] * z + (m[0][3] if len(m[0]) > 3 else 0.0)
        ty = m[1][0] * x + m[1][1] * y + m[1][2] * z + (m[1][3] if len(m[1]) > 3 else 0.0)
        tz = m[2][0] * x + m[2][1] * y + m[2][2] * z + (m[2][3] if len(m[2]) > 3 else 0.0)
    else:
        return list(pt)
    return [round(tx, 4), round(ty, 4), round(tz, 4)]


class PlanningContext:
    """
    Immutable single source of truth for CAM planning geometry and parameters.
    Handles coordinate transformations, stock resolution, B-Rep topology association,
    and boolean machining region operations.
    """
    def __init__(
        self, 
        setup: Dict[str, Any], 
        machine_profile: Dict[str, Any], 
        material: Any, 
        features: List[Dict[str, Any]],
        brep_data: Optional[Dict[str, Any]] = None
    ):
        self.setup = setup
        self.machine_profile = machine_profile
        self.material = material
        self.features = {f.get("id", f"feat_{i}"): f for i, f in enumerate(features)}
        self.brep_data = brep_data
        
        self.stock = setup.get("resolvedStock", {})
        self.transforms = {
            "model_to_setup": setup.get("modelToSetupTransform"),
            "setup_to_model": setup.get("setupToModelTransform"),
            "wcs": setup.get("wcs", "G54")
        }
        
        # Lazy-load caches
        self._stock_polygon = None
        self._resolved_geometries: Dict[str, ResolvedFeatureGeometry] = {}
        self._locked = False
        
        # Resolve all feature geometries
        self._resolve_all_geometries()

    def _assert_unlocked(self):
        if self._locked:
            raise RuntimeError("PlanningContext is immutable after validation. Planners cannot mutate context.")

    def validate(self) -> Dict[str, Any]:
        """
        Validates the overall context. Locks the context upon successful validation.
        """
        errors = []
        raw_poly = self._get_raw_stock_polygon()
        if raw_poly is None or raw_poly.is_empty:
            errors.append("No valid stock geometry or boundaries defined in the setup.")
        
        # Verify transforms
        if not self.transforms["model_to_setup"]:
            self.transforms["model_to_setup"] = [
                [1.0, 0.0, 0.0, 0.0],
                [0.0, 1.0, 0.0, 0.0],
                [0.0, 0.0, 1.0, 0.0],
                [0.0, 0.0, 0.0, 1.0]
            ]

        is_valid = len(errors) == 0
        if is_valid:
            self._locked = True  # Enforce immutability
            
        return {"valid": is_valid, "errors": errors}

    def _resolve_all_geometries(self) -> None:
        """
        Builds the authoritative ResolvedFeatureGeometry for every recognized feature.
        B-Rep topology takes strict precedence over parameter approximations.
        """
        matrix = self.transforms["model_to_setup"]
        pockets_brep = (self.brep_data.get("pockets") or []) if self.brep_data else []
        holes_brep = (self.brep_data.get("holes") or []) if self.brep_data else []
        cylinders_brep = (self.brep_data.get("cylinders") or []) if self.brep_data else []

        for feat_id, feat in self.features.items():
            feat_type = str(feat.get("type", "")).lower()
            dims = feat.get("dimensions", {}) if isinstance(feat.get("dimensions"), dict) else {}
            center_cad = list(feat.get("center", [0.0, 0.0, 0.0]))
            
            # --- 1. Cylindrical Features (Holes, Bores, Turned OD, Bosses) ---
            if feat_type in ("hole", "blind_hole", "through_hole", "bore", "external_cylinder", "cylinder"):
                # Try matching with B-Rep cylinder/hole
                target_dia = float(feat.get("diameter") or dims.get("diameter") or dims.get("dia") or 0.0)
                matched_brep = None
                source_list = holes_brep if "hole" in feat_type or feat_type == "bore" else cylinders_brep
                
                if target_dia > 0 and source_list:
                    best_diff = float("inf")
                    for cand in source_list:
                        diff = abs(cand.get("diameter", 0.0) - target_dia)
                        if diff < 0.2 and diff < best_diff:
                            best_diff = diff
                            matched_brep = cand

                if matched_brep:
                    cad_c = matched_brep.get("center", center_cad)
                    axis_cad = matched_brep.get("axis", [0.0, 0.0, 1.0])
                    dia = float(matched_brep.get("diameter", target_dia))
                    depth = float(matched_brep.get("depth", 0.0))
                    
                    center_setup = _apply_transform_3d(cad_c, matrix)
                    res_geom = ResolvedFeatureGeometry(
                        feature_id=feat_id,
                        feature_type=feat_type,
                        source_type="brep",
                        center_3d=center_setup,
                        axis_3d=axis_cad,
                        depth=depth,
                        diameter=dia,
                        radius=dia / 2.0,
                        is_through=matched_brep.get("is_through", False),
                        top_z_setup=center_setup[2] + (depth / 2.0),
                        bottom_z_setup=center_setup[2] - (depth / 2.0),
                        provenance={"source": "BRepFeatureExtractor", "face_id": matched_brep.get("face_id")}
                    )
                    self._resolved_geometries[feat_id] = res_geom
                    continue

                # Parametric fallback (if explicit dimensions exist)
                explicit_depth = float(feat.get("depth") or dims.get("depth") or dims.get("height") or 0.0)
                if target_dia > 0 and explicit_depth > 0:
                    center_setup = _apply_transform_3d(center_cad, matrix)
                    res_geom = ResolvedFeatureGeometry(
                        feature_id=feat_id,
                        feature_type=feat_type,
                        source_type="parametric",
                        center_3d=center_setup,
                        axis_3d=feat.get("axis", [0.0, 0.0, 1.0]),
                        depth=explicit_depth,
                        diameter=target_dia,
                        radius=target_dia / 2.0,
                        top_z_setup=center_setup[2],
                        bottom_z_setup=center_setup[2] - explicit_depth,
                        provenance={"source": "ParametricParameters"}
                    )
                    self._resolved_geometries[feat_id] = res_geom
                    continue

            # --- 2. Planar Features (Pockets, Slots, Recesses, Bosses, Faces, Contours) ---
            matched_pocket = None
            if pockets_brep:
                f_axis = feat.get("axis", [0.0, 0.0, 1.0])
                aligned_pockets = [
                    p for p in pockets_brep 
                    if (p.get("normal", [0,0,1])[0]*f_axis[0] + p.get("normal", [0,0,1])[1]*f_axis[1] + p.get("normal", [0,0,1])[2]*f_axis[2]) > 0.7
                ]
                candidate_pockets = aligned_pockets if aligned_pockets else pockets_brep

                # 1. Match by face_id if feature has it
                if feat.get("face_id") is not None:
                    for p in candidate_pockets:
                        if p.get("face_id") == feat.get("face_id"):
                            matched_pocket = p
                            break
                # 2. Match by circular diameter
                if not matched_pocket and (feat.get("diameter") or feat.get("is_circular")):
                    target_dia = float(feat.get("diameter") or dims.get("diameter") or dims.get("dia") or 0.0)
                    if target_dia > 0:
                        for p in candidate_pockets:
                            if p.get("is_circular") and p.get("diameter"):
                                if abs(p["diameter"] - target_dia) < 0.2:
                                    matched_pocket = p
                                    break
                # 3. Match by area or proximity
                if not matched_pocket:
                    feat_w = float(feat.get("width") or dims.get("width") or 0.0)
                    feat_l = float(feat.get("length") or dims.get("length") or feat_w)
                    feat_area = feat_w * feat_l if feat_w > 0 else 0.0
                    
                    if feat_area > 0:
                        best_diff = float("inf")
                        for p in candidate_pockets:
                            diff = abs(p.get("area", 0.0) - feat_area) / max(feat_area, 1.0)
                            if diff < 0.35 and diff < best_diff:
                                best_diff = diff
                                matched_pocket = p

            if matched_pocket:
                # Transform outer and inner 3D wires into Setup space
                ow_setup = [_apply_transform_3d(pt, matrix)[:2] for pt in matched_pocket.get("outer_wire_3d", [])]
                iw_setup = [[_apply_transform_3d(pt, matrix)[:2] for pt in loop] for loop in matched_pocket.get("inner_wires_3d", [])]
                
                c_setup = _apply_transform_3d(matched_pocket["center"], matrix)
                depth = float(matched_pocket.get("depth_from_entry") if matched_pocket.get("depth_from_entry") is not None else matched_pocket.get("depth_from_top", 0.0))
                
                face_reg = FaceRegion(
                    face_id=matched_pocket.get("face_id"),
                    plane_type=matched_pocket.get("plane_type", "XY"),
                    center=c_setup,
                    normal=matched_pocket.get("normal", [0.0, 0.0, 1.0]),
                    u_axis=matched_pocket.get("u_axis", [1.0, 0.0, 0.0]),
                    v_axis=matched_pocket.get("v_axis", [0.0, 1.0, 0.0]),
                    outer_wire_3d=matched_pocket.get("outer_wire_3d", []),
                    inner_wires_3d=matched_pocket.get("inner_wires_3d", []),
                    outer_wire_uv=matched_pocket.get("outer_wire_uv", []),
                    inner_wires_uv=matched_pocket.get("inner_wires_uv", []),
                    area=matched_pocket.get("area", 0.0),
                    depth_from_top=depth
                )
                
                res_geom = ResolvedFeatureGeometry(
                    feature_id=feat_id,
                    feature_type=feat_type,
                    source_type="brep",
                    face_region=face_reg,
                    center_3d=c_setup,
                    axis_3d=[0.0, 0.0, 1.0],
                    plane_type=matched_pocket.get("plane_type", "XY"),
                    depth=depth,
                    diameter=matched_pocket.get("diameter"),
                    radius=matched_pocket.get("circle_radius"),
                    width=matched_pocket.get("width"),
                    length=matched_pocket.get("length"),
                    outer_polygon_setup=ow_setup,
                    inner_polygons_setup=iw_setup,
                    top_z_setup=c_setup[2] + depth,
                    bottom_z_setup=c_setup[2],
                    provenance={"source": "BRepFeatureExtractor", "face_id": matched_pocket.get("face_id")}
                )
                self._resolved_geometries[feat_id] = res_geom
                continue

            # Support explicit contour / outer profile wires from B-Rep silhouette or machiningRegion
            poly_data = feat.get("wire_3d") or feat.get("polygon_2d") or feat.get("machiningRegion", {}).get("polygon")
            if (feat_type == "contour" or feat.get("subtype") == "outer_profile" or feat.get("machiningRegion", {}).get("regionType") == "contour_region") and poly_data:
                w3d = feat.get("wire_3d") or [[pt[0], pt[1], 0.0] for pt in (feat.get("polygon_2d") or feat.get("machiningRegion", {}).get("polygon", []))]
                ow_setup = [_apply_transform_3d(pt, matrix)[:2] for pt in w3d]
                poly_min_x = min(p[0] for p in ow_setup)
                poly_max_x = max(p[0] for p in ow_setup)
                poly_min_y = min(p[1] for p in ow_setup)
                poly_max_y = max(p[1] for p in ow_setup)
                
                c_depth = float(feat.get("depth") or dims.get("depth") or dims.get("height") or 10.0)
                # In Setup Space, the top datum of the workpiece is at Z=0.0
                top_z = 0.0
                bot_z = round(-c_depth, 4)
                
                res_geom = ResolvedFeatureGeometry(
                    feature_id=feat_id,
                    feature_type=feat_type,
                    source_type="brep",
                    center_3d=[(poly_min_x + poly_max_x) / 2.0, (poly_min_y + poly_max_y) / 2.0, -c_depth / 2.0],
                    axis_3d=[0.0, 0.0, 1.0],
                    plane_type="XY",
                    depth=c_depth,
                    width=abs(poly_max_x - poly_min_x),
                    length=abs(poly_max_y - poly_min_y),
                    outer_polygon_setup=ow_setup,
                    inner_polygons_setup=[],
                    top_z_setup=top_z,
                    bottom_z_setup=bot_z,
                    provenance={"source": "BRepSilhouette"}
                )
                self._resolved_geometries[feat_id] = res_geom
                continue

            # Support exact analytical circular pockets/recesses with defined diameter
            is_circ_pocket = (
                feat.get("is_circular")
                or feat.get("subtype") == "circular_pocket"
                or bool(feat.get("diameter"))
                or bool(dims.get("diameter"))
                or bool(dims.get("dia"))
            )
            c_dia = float(feat.get("diameter") or dims.get("diameter") or dims.get("dia") or 0.0)
            explicit_d = float(feat.get("depth") or dims.get("depth") or dims.get("height") or 0.0)
            if (is_circ_pocket or c_dia > 0) and explicit_d > 0:
                c_setup = _apply_transform_3d(center_cad, matrix)
                dia = c_dia if c_dia > 0 else float(feat.get("width") or dims.get("width") or 0.0)
                if dia > 0:
                    res_geom = ResolvedFeatureGeometry(
                        feature_id=feat_id,
                        feature_type=feat_type,
                        source_type="parametric",
                        center_3d=c_setup,
                        axis_3d=feat.get("axis", [0.0, 0.0, 1.0]),
                        plane_type="XY",
                        depth=explicit_d,
                        diameter=dia,
                        radius=dia / 2.0,
                        width=dia,
                        length=dia,
                        outer_polygon_setup=[],
                        inner_polygons_setup=[],
                        top_z_setup=c_setup[2],
                        bottom_z_setup=c_setup[2] - explicit_d,
                        provenance={"source": "parametric_circular"}
                    )
                    self._resolved_geometries[feat_id] = res_geom
                    continue
            # Support explicit parametric rectangular pockets/slots with width, length, depth
            p_width = float(feat.get("width") or dims.get("width") or 0.0)
            p_length = float(feat.get("length") or dims.get("length") or p_width)
            if p_width > 0 and p_length > 0 and explicit_d > 0:
                c_setup = _apply_transform_3d(center_cad, matrix)
                hw = p_length / 2.0
                hh = p_width / 2.0
                rect_pts = [
                    [c_setup[0] - hw, c_setup[1] - hh],
                    [c_setup[0] + hw, c_setup[1] - hh],
                    [c_setup[0] + hw, c_setup[1] + hh],
                    [c_setup[0] - hw, c_setup[1] + hh],
                    [c_setup[0] - hw, c_setup[1] - hh]
                ]
                res_geom = ResolvedFeatureGeometry(
                    feature_id=feat_id,
                    feature_type=feat_type,
                    source_type="parametric",
                    center_3d=c_setup,
                    axis_3d=feat.get("axis", [0.0, 0.0, 1.0]),
                    plane_type="XY",
                    depth=explicit_d,
                    width=p_width,
                    length=p_length,
                    outer_polygon_setup=rect_pts,
                    inner_polygons_setup=[],
                    top_z_setup=c_setup[2],
                    bottom_z_setup=c_setup[2] - explicit_d,
                    provenance={"source": "parametric_rectangular"}
                )
                self._resolved_geometries[feat_id] = res_geom
                continue

            # If no authoritative B-Rep boundary exists, do NOT synthesize box_pts.
            # Mark feature geometry as unavailable so unsafe toolpaths are blocked.
            self._resolved_geometries[feat_id] = ResolvedFeatureGeometry(
                feature_id=feat_id,
                feature_type=feat_type,
                source_type="none",
                provenance={"status": "FEATURE_GEOMETRY_UNAVAILABLE", "reason": "No authoritative B-Rep boundary wire or region available"}
            )

    def _extract_dimension_from_params(self, param_dict: Dict[str, Any], candidate_tokens: List[str]) -> Optional[float]:
        """Helper to extract a dimension by token matching from arbitrary parameter keys."""
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
        """Helper to generate the 2D bounding stock geometry in Setup space."""
        if self._stock_polygon is not None:
            return self._stock_polygon
            
        bounds = self.stock.get("bounds") or (self.stock.get("resolvedStock", {}).get("bounds") if isinstance(self.stock.get("resolvedStock"), dict) else None)
        if bounds and "min" in bounds and "max" in bounds:
            s_min_x, s_min_y = float(bounds["min"][0]), float(bounds["min"][1])
            s_max_x, s_max_y = float(bounds["max"][0]), float(bounds["max"][1])
        else:
            dims = self.stock.get("stockDimensions") or self.setup.get("stockDimensions")
            if dims and len(dims) >= 2 and float(dims[0]) > 0 and float(dims[1]) > 0:
                stock_w, stock_l = float(dims[0]), float(dims[1])
                s_min_x, s_max_x = -stock_w / 2.0, stock_w / 2.0
                s_min_y, s_max_y = -stock_l / 2.0, stock_l / 2.0
            else:
                params = self.setup.get("parameters", {})
                w = self._extract_dimension_from_params(params, ["diameter", "outer_diameter", "width"])
                l = self._extract_dimension_from_params(params, ["diameter", "outer_diameter", "length"]) or w
                if w and l:
                    s_min_x, s_max_x = -w / 2.0, w / 2.0
                    s_min_y, s_max_y = -l / 2.0, l / 2.0
                else:
                    return Polygon()
        
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
        """Returns the authoritative stock boundary envelope."""
        poly = self._get_raw_stock_polygon()
        return {
            "type": "stock",
            "polygon": poly,
            "area": poly.area if not poly.is_empty else 0.0,
            "bounds": poly.bounds if not poly.is_empty else (),
            "provenance": {
                "source": "SetupPlanner",
                "space": "Setup Coordinates",
                "stock_type": self.stock.get("stockType", "box")
            }
        }

    def get_resolved_geometry(self, feature_id: str) -> Optional[ResolvedFeatureGeometry]:
        """Returns the immutable ResolvedFeatureGeometry contract for a feature."""
        return self._resolved_geometries.get(feature_id)

    def get_feature_polygon(self, feature_id: str) -> Optional[Polygon]:
        """Returns the exact Shapely Polygon for a feature (with inner islands/holes preserved)."""
        geom = self._resolved_geometries.get(feature_id)
        if not geom or geom.source_type == "none":
            return None
        if geom.outer_polygon_setup and len(geom.outer_polygon_setup) >= 3:
            try:
                holes = [h for h in geom.inner_polygons_setup if len(h) >= 3]
                p = Polygon(geom.outer_polygon_setup, holes=holes)
                if p.is_valid and not p.is_empty:
                    return p
            except Exception:
                pass
        if geom.diameter and geom.diameter > 0:
            cx, cy = geom.center_3d[0], geom.center_3d[1]
            return Point(cx, cy).buffer(geom.diameter / 2.0, resolution=32)
        return None

    def get_outer_contour_polygon(self) -> Optional[Polygon]:
        """Returns the exact 2D external silhouette boundary of the solid in setup space."""
        # 1. Check if any resolved geometry is an outer profile contour
        for geom in self._resolved_geometries.values():
            if (geom.feature_type == "contour" or "profile" in geom.feature_id.lower() or "outer" in geom.feature_id.lower()) and geom.outer_polygon_setup:
                if len(geom.outer_polygon_setup) >= 3:
                    try:
                        p = Polygon(geom.outer_polygon_setup)
                        if p.is_valid and not p.is_empty:
                            return p
                    except Exception:
                        pass
        # 2. Check if brep_data has silhouette
        if self.brep_data and self.brep_data.get("silhouette"):
            sil = self.brep_data["silhouette"]
            matrix = self.setup.get("modelToSetupTransform") or [
                [1.0, 0.0, 0.0, 0.0],
                [0.0, 1.0, 0.0, 0.0],
                [0.0, 0.0, 1.0, 0.0],
                [0.0, 0.0, 0.0, 1.0]
            ]
            w3d = sil.get("wire_3d") or [[pt[0], pt[1], 0.0] for pt in sil.get("polygon_2d", [])]
            pts_setup = [_apply_transform_3d(pt, matrix)[:2] for pt in w3d]
            if len(pts_setup) >= 3:
                try:
                    p = Polygon(pts_setup)
                    if p.is_valid and not p.is_empty:
                        return p
                except Exception:
                    pass
        return None

    def get_machining_region(self, feature_id: str, tool_radius: float, strategy: str = "default") -> Dict[str, Any]:
        """
        Calculates the safe machining region for an operation using actual resolved geometry.
        Returns explicit statuses: 'OK', 'EMPTY_MACHINING_REGION', or 'FEATURE_GEOMETRY_UNAVAILABLE'.
        """
        stock_geom = self.get_stock_geometry()
        stock_poly = stock_geom["polygon"]
        
        feat_poly = self.get_feature_polygon(feature_id)
        res_geom = self._resolved_geometries.get(feature_id)
        
        if not res_geom or res_geom.source_type == "none" or feat_poly is None or feat_poly.is_empty:
            return {
                "is_valid": False,
                "status": "FEATURE_GEOMETRY_UNAVAILABLE",
                "reason": f"Feature '{feature_id}' lacks resolved CAD/topological geometry.",
                "polygon": Polygon()
            }

        machining_area = stock_poly
        keepout = Polygon()
        
        if strategy == "boss_clearing":
            machining_area = stock_poly.buffer(tool_radius + 2.0, join_style=2)
            finish_allowance = 0.5
            keepout = feat_poly.buffer(tool_radius + finish_allowance, join_style=2)
            safe_area = machining_area.difference(keepout)
            
        elif strategy == "pocketing":
            safe_area = feat_poly.buffer(-tool_radius, join_style=2)
            if safe_area.is_empty:
                return {
                    "is_valid": True,
                    "status": "EMPTY_MACHINING_REGION",
                    "reason": f"Tool diameter ({tool_radius*2}mm) exceeds pocket boundary clearance.",
                    "polygon": Polygon(),
                    "empty": True
                }
                
        elif strategy == "facing":
            safe_area = stock_poly
            
        else:
            safe_area = feat_poly

        return {
            "type": "machining_region",
            "status": "OK",
            "polygon": safe_area,
            "keepout_polygon": keepout,
            "extended_machining_area": machining_area,
            "area": safe_area.area if not safe_area.is_empty else 0.0,
            "is_valid": safe_area.is_valid and not safe_area.is_empty,
            "bounds": safe_area.bounds if not safe_area.is_empty else (),
            "provenance": {
                "source": "PlanningContext",
                "strategy": strategy,
                "tool_radius": tool_radius,
                "feature_source": res_geom.source_type
            }
        }
