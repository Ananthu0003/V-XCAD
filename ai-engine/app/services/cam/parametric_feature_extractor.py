import json
import uuid
import math
from typing import Dict, Any, List, Tuple, Optional

# Generic directional keywords → tool axis vectors.
# "left"/"a"/"1"/"front" = primary setup (tool approaches from +Z)
# "right"/"b"/"2"/"back"/"rear" = opposite setup (tool approaches from -Z, requires part flip)
_PRIMARY_SIDE_TOKENS = {"left", "front", "top", "upper", "near", "a", "1", "first", "primary"}
_OPPOSITE_SIDE_TOKENS = {"right", "back", "rear", "bottom", "lower", "far", "b", "2", "second", "secondary"}

_PRIMARY_AXIS = [0.0, 0.0, 1.0]    # +Z — accessible from default setup
_OPPOSITE_AXIS = [0.0, 0.0, -1.0]  # -Z — requires part flip / Setup 2


class ParametricFeatureExtractor:
    """
    Extracts CAM features directly from a dictionary of AI-extracted parameters.
    
    Key capabilities:
    - Groups parameters by common prefix (e.g., bore_left_diameter + bore_left_depth → bore_left)
    - Detects feature side/orientation from directional tokens in the prefix
    - Assigns opposing axes so the setup planner can separate features into multiple setups
    - Computes feature center positions along the part's longitudinal axis
    - Infers overall part dimensions from parameters for accurate positioning
    """
    
    def extract(self, parameters: Dict[str, Any], setup: Optional[Dict[str, Any]] = None, brep_data: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        features = []
         # --- Phase 1: Group parameters by common prefix ---
        groups = {}
        # Single-token dimension suffixes
        _single_dim_suffixes = {"dia", "diameter", "radius", "width", "depth", "length", "size", "height", "offset"}
        # Compound suffixes: match the last 2 tokens as a unit, map to a canonical dim type
        _compound_dim_suffixes = {
            ("width", "flats"): "width",      # e.g. hex_socket_width_flats → width
            ("across", "flats"): "width",     # e.g. hex_across_flats → width
        }
        
        for key, value in parameters.items():
            if not isinstance(value, (int, float)):
                continue
                
            # Normalize key: lowercase, spaces to underscores
            normalized_key = str(key).strip().lower().replace(" ", "_")
            parts = normalized_key.split('_')
            
            matched = False
            # Try compound suffix first (last 2 tokens)
            if len(parts) > 2:
                tail2 = (parts[-2], parts[-1])
                if tail2 in _compound_dim_suffixes:
                    prefix = "_".join(parts[:-2])
                    dim_type = _compound_dim_suffixes[tail2]
                    groups.setdefault(prefix, {})[dim_type] = value
                    matched = True
            
            # Try single-token suffix
            if not matched and len(parts) > 1 and parts[-1] in _single_dim_suffixes:
                prefix = "_".join(parts[:-1])
                dim_type = "dia" if parts[-1] == "diameter" else parts[-1]
                groups.setdefault(prefix, {})[dim_type] = value
                matched = True
            
            if not matched:
                groups.setdefault(normalized_key, {})[("value")] = value
                
        # --- Phase 2: Extract overall part dimensions from parameters ---
        part_length = self._infer_part_dimension(groups, ["overall_length", "total_length", "part_length", "body_length", "length"], raw_parameters=parameters)
        part_od = self._infer_part_dimension(groups, ["outer_diameter", "od", "outside_diameter", "body_diameter", "outer_dia", "body_dia"], raw_parameters=parameters)
        
        part_width = None
        part_length_y = None
        if setup:
            stock_dims = setup.get("stockDimensions")
            if stock_dims and len(stock_dims) >= 3:
                x_len = float(stock_dims[0])
                y_len = float(stock_dims[1])
                z_len = float(stock_dims[2])
                if not part_length or part_length <= 0:
                    part_length = z_len
                stock_type_str = str(setup.get("stockType", "")).lower()
                is_cyl = any(kw in stock_type_str for kw in ("cylinder", "round", "bar", "rod"))
                if is_cyl and (not part_od or part_od <= 0):
                    part_od = max(x_len, y_len)
                elif not is_cyl:
                    part_width = x_len
                    part_length_y = y_len
            else:
                stock = setup.get("resolvedStock", {})
                bounds = stock.get("bounds")
                if bounds and "min" in bounds and "max" in bounds:
                    # Z length
                    z_len = abs(bounds["max"][2] - bounds["min"][2])
                    if not part_length or part_length <= 0:
                        part_length = z_len
                    
                    # OD or width/length
                    x_len = abs(bounds["max"][0] - bounds["min"][0])
                    y_len = abs(bounds["max"][1] - bounds["min"][1])
                    stock_type_str = str(stock.get("stockType", stock.get("type", ""))).lower()
                    is_cyl = any(kw in stock_type_str for kw in ("cylinder", "round", "bar", "rod"))
                    if is_cyl and (not part_od or part_od <= 0):
                        part_od = max(x_len, y_len)
                    elif not is_cyl:
                        part_width = x_len
                        part_length_y = y_len
        
        # Determine actual CAD coordinate for the top of the stock
        stock_top_z = 0.0
        if setup:
            stock = setup.get("resolvedStock", {})
            bounds = stock.get("bounds")
            if bounds and "max" in bounds and len(bounds["max"]) >= 3:
                stock_top_z = float(bounds["max"][2])
            elif setup.get("stockDimensions") and setup.get("stockCenter") and len(setup.get("stockDimensions")) >= 3 and len(setup.get("stockCenter")) >= 3:
                stock_top_z = float(setup.get("stockCenter")[2]) + (float(setup.get("stockDimensions")[2]) / 2.0)
        
        # --- Phase 3: Analyze each group to determine features ---
        # Calculate part center from B-Rep bounds if available
        part_center = [0.0, 0.0, 0.0]
        if brep_data and "bounds" in brep_data:
            bounds = brep_data["bounds"]
            if bounds and isinstance(bounds, dict) and "min" in bounds and "max" in bounds:
                min_pt = bounds["min"]
                max_pt = bounds["max"]
                part_center = [
                    (min_pt[0] + max_pt[0]) / 2.0,
                    (min_pt[1] + max_pt[1]) / 2.0,
                    (min_pt[2] + max_pt[2]) / 2.0
                ]
            elif bounds and isinstance(bounds, list) and len(bounds) == 2:
                min_pt, max_pt = bounds
                part_center = [
                    (min_pt[0] + max_pt[0]) / 2.0,
                    (min_pt[1] + max_pt[1]) / 2.0,
                    (min_pt[2] + max_pt[2]) / 2.0
                ]

        for prefix, dims in groups.items():
            prefix_lower = prefix.lower()
            tokens = set(prefix_lower.split('_'))
            
            # Skip groups that are overall part dimensions (not features)
            if self._is_part_dimension_group(prefix_lower):
                continue
            
            # Detect feature side/orientation from prefix tokens
            axis, side_label = self._detect_side(tokens)
            
            # Identify Holes / Bores / Drills / Counterbores
            if self._matches_any(tokens, {"hole", "drill", "bore", "drilling", "boring", "cbore", "counterbore"}):
                feat = self._create_hole_feature(prefix, dims, axis, side_label, part_length, stock_top_z, part_od, brep_data, part_center)
                if feat:
                    features.append(feat)
                    
            # Identify Pockets / Slots / Sockets / Keyways / Hex recesses
            elif self._matches_any(tokens, {"pocket", "slot", "cavity", "groove", "channel", "socket", "keyway", "hex", "recess"}):
                feat = self._create_pocket_feature(prefix, dims, axis, part_length, stock_top_z, brep_data, part_center)
                if feat:
                    features.append(feat)
                    
            # Identify Bosses / Steps / Pads
            elif self._matches_any(tokens, {"boss", "step", "pad", "protrusion", "raised", "collar", "flange", "shoulder", "base", "block"}):
                feat = self._create_boss_feature(prefix, dims, axis, part_length, stock_top_z, part_od, brep_data, part_center)
                if feat:
                    features.append(feat)
                    
            # Robust Fallback: Infer feature type from dimensions if name is completely unknown
            else:
                # Skip arbitrary parameters (like 'eps') that don't have explicit geometric dimension keys
                if not any(k in dims for k in ["dia", "diameter", "depth", "height", "width", "length", "radius"]):
                    continue
                    
                if "dia" in dims or "diameter" in dims:
                    if "depth" in dims:
                        feat = self._create_hole_feature(prefix, dims, axis, side_label, part_length, stock_top_z, part_od, brep_data, part_center)
                    else:
                        feat = self._create_boss_feature(prefix, dims, axis, part_length, stock_top_z, part_od, brep_data, part_center)
                else:
                    if "height" in dims:
                        feat = self._create_boss_feature(prefix, dims, axis, part_length, stock_top_z, part_od, brep_data, part_center)
                    else:
                        feat = self._create_pocket_feature(prefix, dims, axis, part_length, stock_top_z, brep_data, part_center)
                
                if feat:
                    features.append(feat)
        
        # --- Phase 4: Add overall part features (OD and Facing) ---
        if part_od and part_od > 0:
            import hashlib
            eff_len = part_length if part_length and part_length > 0 else 10.0
            feat_id = f"feat_od_{hashlib.md5(f'od_{part_od}_{eff_len}'.encode()).hexdigest()[:8]}"
            features.insert(0, {
                "id": feat_id,
                "type": "external_cylinder",
                "subtype": "turned_od",
                "name": "Body Outer Diameter",
                "dimensions": {
                    "diameter": part_od,
                    "length": eff_len,
                    "height": eff_len
                },
                "center": [0.0, 0.0, 0.0],
                "axis": _PRIMARY_AXIS,
                "machinable_in_current_setup": True,
                "status": "machinable",
                "recommendedOperation": "od_turning",
                "recommendedToolType": "turning_tool",
                "geometry": {"status": "synthetic"},
                "machiningRegion": {
                    "valid": True,
                    "regionId": feat_id,
                    "regionType": "turning_region",
                    "center": [0.0, 0.0, 0.0],
                    "axis": _PRIMARY_AXIS,
                    "topZ": stock_top_z,
                    "bottomZ": stock_top_z - eff_len,
                    "diameter": part_od,
                    "source": "parametric"
                }
            })
        elif part_width and part_width > 0 and part_length_y and part_length_y > 0:
            features.insert(0, {
                "id": f"feat_{uuid.uuid4().hex[:8]}",
                "type": "contour",
                "subtype": "outer_profile",
                "name": "Outer Boundary",
                "dimensions": {
                    "width": part_width,
                    "length": part_length_y,
                    "depth": part_length if part_length and part_length > 0 else 10.0
                },
                "center": [0.0, 0.0, 0.0],
                "axis": _PRIMARY_AXIS,
                "status": "machinable",
                "geometry": {"status": "synthetic"},
                "machiningRegion": {
                    "valid": True,
                    "regionId": f"feat_{uuid.uuid4().hex[:8]}",
                    "regionType": "contour_region",
                    "center": [0.0, 0.0, 0.0],
                    "axis": _PRIMARY_AXIS,
                    "depth": part_length if part_length and part_length > 0 else 10.0,
                    "topZ": stock_top_z,
                    "bottomZ": stock_top_z - (part_length if part_length and part_length > 0 else 10.0),
                    "width": part_width,
                    "length": part_length_y,
                    "source": "parametric"
                }
            })

        # Only add facing for the primary setup (the part's exposed top face)
        has_primary_features = any(
            f.get("axis") == _PRIMARY_AXIS for f in features
        )
        if has_primary_features or not features:
            features.append(self._create_face_feature("Top Face (Setup 1)", _PRIMARY_AXIS, stock_top_z, part_od=part_od, part_length=part_length, part_center=part_center))

        # Deduplicate features by type and geometry (e.g. redundant tokens like 'base' vs 'base_thickness')
        deduped: List[Dict[str, Any]] = []
        for f in features:
            f_type = f.get("type")
            f_dia = f.get("dimensions", {}).get("diameter") or f.get("diameter")
            f_top = f.get("machiningRegion", {}).get("topZ")
            is_dup = False
            for existing in deduped:
                if existing.get("type") == f_type and f_dia and f_dia > 0:
                    ex_dia = existing.get("dimensions", {}).get("diameter") or existing.get("diameter")
                    if ex_dia and abs(ex_dia - f_dia) < 0.05:
                        ex_top = existing.get("machiningRegion", {}).get("topZ")
                        if ex_top is not None and f_top is not None and abs(ex_top - f_top) < 0.5:
                            is_dup = True
                            if (f.get("dimensions", {}).get("height", 0) > existing.get("dimensions", {}).get("height", 0)):
                                existing.update(f)
                            break
            if not is_dup:
                deduped.append(f)
                
        return deduped
    
    # -------------------------------------------------------------------------
    # Side / Orientation Detection
    # -------------------------------------------------------------------------
    
    def _detect_side(self, tokens: set) -> Tuple[List[float], str]:
        """
        Scans feature name tokens for directional keywords.
        Returns (axis_vector, side_label).
        """
        primary_match = tokens.intersection(_PRIMARY_SIDE_TOKENS)
        opposite_match = tokens.intersection(_OPPOSITE_SIDE_TOKENS)
        
        # Check for explicit axis tokens (requested by LLM prompt for off-axis features)
        if "x" in tokens or "x_axis" in tokens or "xaxis" in tokens:
            return [1.0, 0.0, 0.0], "radial_x"
        if "y" in tokens or "y_axis" in tokens or "yaxis" in tokens:
            return [0.0, 1.0, 0.0], "radial_y"
        if "radial" in tokens:
            # Fallback to X if radial is specified without a specific axis
            return [1.0, 0.0, 0.0], "radial"
            
        if opposite_match and not primary_match:
            return _OPPOSITE_AXIS, "opposite"
        elif primary_match and not opposite_match:
            return _PRIMARY_AXIS, "primary"
        else:
            # No directional keyword, or ambiguous → default to primary setup
            return _PRIMARY_AXIS, "default"
    
    # -------------------------------------------------------------------------
    # Feature Creators
    # -------------------------------------------------------------------------
    
    def _create_hole_feature(self, prefix: str, dims: Dict, axis: List[float], 
                              side_label: str, part_length: Optional[float], stock_top_z: float = 0.0, part_od: Optional[float] = None, brep_data: Optional[Dict[str, Any]] = None, part_center: List[float] = None) -> Optional[Dict[str, Any]]:
        diameter = float(dims.get("dia", dims.get("size", dims.get("value", 0))))
        if "radius" in dims:
            diameter = float(dims["radius"]) * 2.0
        if diameter <= 0:
            return None
            
        depth = float(dims.get("depth") or dims.get("length") or dims.get("height") or dims.get("len") or 0.0)
        if depth <= 0 and part_length:
            depth = part_length
        # Try to get depth from B-Rep data if parametric depth is still zero
        if depth <= 0 and brep_data and brep_data.get("status") == "success":
            bounds = brep_data.get("bounds", {})
            if bounds.get("height") and bounds["height"] > 0:
                depth = float(bounds["height"])
        if depth <= 0:
            return None
        
        # Center in setup space
        center = [0.0, 0.0, 0.0]
        if "x_center" in dims:
            center[0] = float(dims["x_center"])
        if "y_center" in dims:
            center[1] = float(dims["y_center"])
        if "offset" in dims:
            center[2] = float(dims["offset"])
        elif axis != _PRIMARY_AXIS and axis != _OPPOSITE_AXIS:
            center = self._compute_center_for_side(axis, part_length)
            
        # --- B-Rep Topological Coordination ---
        if brep_data and brep_data.get("status") == "success" and brep_data.get("holes"):
            best_match = None
            min_err = float('inf')
            for h in brep_data["holes"]:
                err = abs(h["diameter"] - diameter)
                if err < 0.1 and err < min_err:
                    min_err = err
                    best_match = h
            if best_match:
                if depth <= 0 and best_match.get("depth"):
                    depth = float(best_match["depth"])
                # For off-axis cross holes, compute radial offsets
                if axis != _PRIMARY_AXIS and axis != _OPPOSITE_AXIS:
                    if best_match.get("center") and part_center:
                        rel_x = best_match["center"][0] - part_center[0]
                        rel_y = best_match["center"][1] - part_center[1]
                        if abs(rel_x) > 0.01:
                            center[0] = round(rel_x, 4)
                        if abs(rel_y) > 0.01:
                            center[1] = round(rel_y, 4)
                
        # Compute topZ/bottomZ in the feature's local frame
        # For primary side: tool enters from stock_top_z downward
        top_z = stock_top_z
        bottom_z = stock_top_z - depth
        
        import hashlib
        feat_id = f"feat_{hashlib.md5(prefix.encode()).hexdigest()[:8]}"
        return {
            "id": feat_id,
            "type": "hole",
            "name": prefix,
            "side": side_label,
            "diameter": diameter,
            "depth": depth,
            "dimensions": {
                "diameter": diameter,
                "radius": diameter / 2.0,
                "depth": depth
            },
            "center": center,
            "axis": axis,
            "machinable_in_current_setup": (axis == _PRIMARY_AXIS),
            "status": "machinable",
            "geometry": {"status": "synthetic"},
            "machiningRegion": {
                "valid": True,
                "regionId": feat_id,
                "regionType": "drill_region",
                "center": center,
                "axis": axis,
                "depth": depth,
                "topZ": top_z,
                "bottomZ": bottom_z,
                "source": "parametric",
                "diagnostics": {"source": "parametric", "side": side_label}
            }
        }
    
    def _create_pocket_feature(self, prefix: str, dims: Dict, axis: List[float], part_length: Optional[float] = None, stock_top_z: float = 0.0, brep_data: Optional[Dict[str, Any]] = None, part_center: List[float] = None) -> Optional[Dict[str, Any]]:
        width = float(dims.get("width", dims.get("value", 0.0)))
        length = float(dims.get("length", dims.get("value", width)))
        depth = float(dims.get("depth", part_length if part_length else 0.0))
        
        if width <= 0 or length <= 0 or depth <= 0:
            return None
            
        # Center in setup-local space
        center = [0.0, 0.0, 0.0]
        if "x_center" in dims:
            center[0] = float(dims["x_center"])
        elif "x_offset" in dims:
            center[0] = float(dims["x_offset"]) + (width / 2.0)
            
        if "y_center" in dims:
            center[1] = float(dims["y_center"])
        elif "y_offset" in dims:
            center[1] = float(dims["y_offset"]) + (length / 2.0)
            
        # --- B-Rep Topological Coordination ---
        if brep_data and brep_data.get("status") == "success" and brep_data.get("pockets"):
            best_match = None
            min_err = float('inf')
            target_area = width * length
            for p in brep_data["pockets"]:
                # Match by area and dimensions roughly
                err = abs(p["area"] - target_area) / max(target_area, 1.0)
                if err < 0.5 and err < min_err:
                    min_err = err
                    best_match = p
            if best_match:
                # For off-center pockets, use relative XY in setup space
                if best_match.get("center") and part_center:
                    center[0] = round(best_match["center"][0] - part_center[0], 4)
                    center[1] = round(best_match["center"][1] - part_center[1], 4)
                if best_match.get("depth_from_top") and best_match["depth_from_top"] > 0:
                    depth = best_match["depth_from_top"]
        
        import hashlib
        feat_id = f"feat_{hashlib.md5(prefix.encode()).hexdigest()[:8]}"
        return {
            "id": feat_id,
            "type": "pocket",
            "subtype": "rectangular_pocket",
            "name": prefix,
            "dimensions": {
                "width": width,
                "length": length,
                "depth": depth
            },
            "center": center,
            "axis": axis,
            "machinable_in_current_setup": (axis == _PRIMARY_AXIS),
            "status": "machinable",
            "geometry": {"status": "synthetic"},
            "machiningRegion": {
                "valid": True,
                "regionId": feat_id,
                "regionType": "pocket_region",
                "center": center,
                "axis": axis,
                "depth": depth,
                "topZ": stock_top_z,
                "bottomZ": stock_top_z - depth,
                "width": width,
                "length": length,
                "source": "parametric",
                "diagnostics": {"source": "parametric"}
            }
        }
    
    def _create_boss_feature(self, prefix: str, dims: Dict, axis: List[float], part_length: Optional[float] = None, stock_top_z: float = 0.0, part_od: Optional[float] = None, brep_data: Optional[Dict[str, Any]] = None, part_center: List[float] = None) -> Optional[Dict[str, Any]]:
        width = float(dims.get("width", dims.get("value", 0.0)))
        length = float(dims.get("length", dims.get("value", width)))
        height = float(dims.get("height", dims.get("depth", dims.get("length", 0.0))))
        diameter = float(dims.get("dia", 0.0))
        
        if diameter <= 0 and "collar" in prefix.lower() and part_od:
             diameter = part_od
             
        if height <= 0 and part_length:
            height = part_length
            
        if (width <= 0 or length <= 0) and diameter <= 0:
            return None
        if height <= 0:
            return None
            
        # Parse explicit center coordinates in setup-local space
        center = [0.0, 0.0, 0.0]
        if "x_center" in dims:
            center[0] = float(dims["x_center"])
        if "y_center" in dims:
            center[1] = float(dims["y_center"])
        elif axis != _PRIMARY_AXIS and axis != _OPPOSITE_AXIS:
            center = self._compute_center_for_side(axis, part_length)

        top_z = stock_top_z
        bottom_z = stock_top_z - height
        
        # B-Rep coordination for turned cylinders / steps
        if brep_data and brep_data.get("external_cylinders") and diameter > 0:
            best_match = None
            min_err = float('inf')
            for c in brep_data["external_cylinders"]:
                err = abs(c.get("diameter", 0.0) - diameter)
                if err < 0.1 and err < min_err:
                    min_err = err
                    best_match = c
            if best_match:
                if "z_min" in best_match and "z_max" in best_match:
                    top_z = float(best_match["z_max"])
                    bottom_z = float(best_match["z_min"])
                    height = abs(top_z - bottom_z)
                    if "length" in dims and height <= 0:
                        height = float(dims["length"])
        
        import hashlib
        feat_id = f"feat_{hashlib.md5(prefix.encode()).hexdigest()[:8]}"
        return {
            "id": feat_id,
            "type": "boss",
            "subtype": "cylindrical_boss" if diameter else "rectangular_boss",
            "name": prefix,
            "dimensions": {
                "diameter": diameter,
                "width": width,
                "length": length,
                "height": height,
                "depth": height
            },
            "center": center,
            "axis": axis,
            "machinable_in_current_setup": (axis == _PRIMARY_AXIS),
            "status": "machinable",
            "geometry": {"status": "synthetic"},
            "machiningRegion": {
                "valid": True,
                "regionId": feat_id,
                "regionType": "boss_region",
                "center": center,
                "axis": axis,
                "height": height,
                "depth": height,
                "topZ": top_z,
                "bottomZ": bottom_z,
                "diameter": diameter,
                "width": width,
                "length": length,
                "source": "parametric",
                "diagnostics": {"source": "parametric"}
            }
        }
    
    def _create_face_feature(self, name: str, axis: List[float], stock_top_z: float = 0.0, part_od: float = None, part_length: float = None, part_center: List[float] = None) -> Dict[str, Any]:
        dims = {"depth": 1.0}
        if part_od and part_od > 0:
            dims["diameter"] = part_od
            dims["width"] = part_od
            dims["length"] = part_od
        if part_length and part_length > 0:
            dims["part_length"] = part_length
        import hashlib
        feat_id = f"feat_{hashlib.md5(name.encode()).hexdigest()[:8]}"
        return {
            "id": feat_id,
            "type": "face",
            "name": name,
            "center": [0.0, 0.0, 0.0],
            "depth": 1.0,
            "diameter": part_od if part_od and part_od > 0 else None,
            "dimensions": dims,
            "axis": axis,
            "machinable_in_current_setup": (axis == _PRIMARY_AXIS),
            "status": "machinable",
            "machiningRegion": {
                "topZ": stock_top_z,
                "bottomZ": stock_top_z - 1.0
            }
        }
    
    # -------------------------------------------------------------------------
    # Helpers
    # -------------------------------------------------------------------------
    
    def _compute_center_for_side(self, axis: List[float], part_length: Optional[float], part_center: List[float] = None) -> List[float]:
        """
        Returns the center coordinates for the feature in setup-local space.
        """
        return [0.0, 0.0, 0.0]
    
    def _infer_part_dimension(self, groups: Dict[str, Dict], candidate_keys: List[str], raw_parameters: Optional[Dict[str, Any]] = None) -> Optional[float]:
        """
        Searches parameter groups and raw parameters for known overall-dimension keys.
        Handles:
          - Exact group key match: e.g., groups["overall_length"]["value"]
          - Prefix + suffix match: e.g., groups["overall"]["length"]
          - Flexible token matching on groups (e.g. "body_main_outer" with "dia", "body_main_total" with "length")
          - Direct parameter dictionary inspection
        Returns the value if found, None otherwise.
        """
        for ckey in candidate_keys:
            # 1. Exact match on group key
            if ckey in groups:
                val = groups[ckey].get("value") or groups[ckey].get("length") or groups[ckey].get("depth") or groups[ckey].get("dia") or groups[ckey].get("diameter") or groups[ckey].get("radius")
                if val and isinstance(val, (int, float)) and val > 0:
                    return float(val)
            
            # 2. Prefix + suffix match
            parts = ckey.rsplit("_", 1)
            if len(parts) == 2:
                prefix, suffix = parts
                if prefix in groups:
                    norm_suffix = "dia" if suffix == "diameter" else suffix
                    val = groups[prefix].get(norm_suffix) or groups[prefix].get(suffix)
                    if val and isinstance(val, (int, float)) and val > 0:
                        return float(val)
                        
        is_length_query = any(any(t in ("length", "len", "depth", "height") for t in c.split("_")) for c in candidate_keys)
        is_od_query = any(any(t in ("outer", "od", "outside", "diameter", "dia") for t in c.split("_")) for c in candidate_keys)
        
        # 3. Flexible group token matching
        for prefix, dims in groups.items():
            p_tokens = set(prefix.lower().split("_"))
            if is_od_query:
                if "outer" in p_tokens or "od" in p_tokens or "outside" in p_tokens or ("body" in p_tokens and "outer" in p_tokens) or "major" in p_tokens:
                    val = dims.get("dia") or dims.get("diameter") or (dims.get("radius", 0) * 2 if "radius" in dims else None) or dims.get("value")
                    if val and isinstance(val, (int, float)) and val > 0:
                        return float(val)
            elif is_length_query:
                if "total" in p_tokens or "overall" in p_tokens or ("body" in p_tokens and "total" in p_tokens) or ("part" in p_tokens and "total" in p_tokens) or ("main" in p_tokens and "length" in p_tokens) or "length" in p_tokens:
                    val = dims.get("length") or dims.get("depth") or dims.get("height") or dims.get("value")
                    if val and isinstance(val, (int, float)) and val > 0:
                        return float(val)
                        
        # 4. Direct inspection on raw_parameters
        if raw_parameters:
            for k, v in raw_parameters.items():
                if not isinstance(v, (int, float)) or v <= 0:
                    continue
                k_tokens = set(str(k).lower().replace(" ", "_").split("_"))
                if is_od_query:
                    if ("outer" in k_tokens or "od" in k_tokens or "outside" in k_tokens) and ("diameter" in k_tokens or "dia" in k_tokens or "radius" in k_tokens or "od" in k_tokens):
                        return float(v * 2 if "radius" in k_tokens else v)
                    if "body" in k_tokens and ("diameter" in k_tokens or "dia" in k_tokens):
                        return float(v)
                elif is_length_query:
                    if ("total" in k_tokens or "overall" in k_tokens or "part" in k_tokens or "body" in k_tokens) and ("length" in k_tokens or "len" in k_tokens):
                        return float(v)
        return None
    
    def _is_part_dimension_group(self, prefix: str) -> bool:
        """
        Returns True if the prefix represents an overall part dimension
        rather than a machinable feature.
        """
        p_tokens = set(prefix.lower().split("_"))
        if ("outer" in p_tokens or "od" in p_tokens or "outside" in p_tokens) and ("dia" in p_tokens or "diameter" in p_tokens or "body" in p_tokens):
            return True
        if ("total" in p_tokens or "overall" in p_tokens or "length" in p_tokens) and ("length" in p_tokens or "body" in p_tokens or "part" in p_tokens):
            return True
        part_dim_tokens = {
            "overall_length", "total_length", "part_length", "body_length",
            "outer_diameter", "od", "outside_diameter", "body_diameter",
            "outer_dia", "body_dia", "overall", "total", "mass", "weight",
            "material", "scale", "body_main_outer", "body_main_total"
        }
        return prefix in part_dim_tokens or bool(p_tokens.intersection({"overall", "total", "mass", "weight"}))
    
    def _matches_any(self, tokens: set, keywords: set) -> bool:
        """Returns True if any token in the prefix matches a feature keyword."""
        return bool(tokens.intersection(keywords))

    def extract_with_engineering_parameters(
        self,
        parameters: Dict[str, Any],
        engineering_audit: Optional[Dict[str, Any]] = None,
        setup: Optional[Dict[str, Any]] = None,
        brep_data: Optional[Dict[str, Any]] = None,
    ) -> List[Dict[str, Any]]:
        """
        Extracts CAM features and enriches each feature with associated engineering metadata:
        tolerances, fits, GD&T callouts, surface finishes, chamfers, and fillets.
        """
        features = self.extract(parameters, setup=setup, brep_data=brep_data)
        if not engineering_audit:
            return features

        # Parse audit if given as raw dictionary
        from app.services.extraction.generic_parameter_parser import BlueprintParameterNormalizer
        audit = BlueprintParameterNormalizer.normalize_audit_payload(engineering_audit)

        for feat in features:
            feat_name = str(feat.get("name", "")).lower()
            feat_type = str(feat.get("type", "")).lower()

            # 1. Match tolerances
            feat_tols = {}
            for dim in audit.all_dimensions:
                if dim.tolerance and (dim.feature_id in feat_name or feat_name in dim.feature_id):
                    feat_tols[dim.geometry_reference] = dim.tolerance.model_dump()
            if feat_tols:
                feat["tolerances"] = feat_tols

            # 2. Match surface finish
            for sf in audit.surface_finishes:
                if sf.target_face_or_feature and (sf.target_face_or_feature in feat_name or feat_name in sf.target_face_or_feature):
                    feat["surface_finish"] = sf.model_dump()
                    break

            # 3. Match GD&T callouts
            feat_gdts = []
            for gdt in audit.gdt_callouts_parsed:
                if gdt.target_feature and (gdt.target_feature in feat_name or feat_name in gdt.target_feature):
                    feat_gdts.append(gdt.model_dump())
            if feat_gdts:
                feat["gdt_callouts"] = feat_gdts

            # 4. Match Chamfers & Fillets
            feat_chamfers = [c.model_dump() for c in audit.all_chamfers if c.feature_id and (c.feature_id in feat_name or feat_name in c.feature_id)]
            if feat_chamfers:
                feat["chamfers"] = feat_chamfers

            feat_fillets = [f.model_dump() for f in audit.all_fillets if f.feature_id and (f.feature_id in feat_name or feat_name in f.feature_id)]
            if feat_fillets:
                feat["fillets"] = feat_fillets

            # Attach global material & treatment if available
            if audit.material_parsed:
                feat["material"] = audit.material_parsed.material_name
            elif audit.material:
                feat["material"] = audit.material

            if audit.surface_treatments_parsed:
                feat["surface_treatments"] = [t.model_dump() for t in audit.surface_treatments_parsed]

        return features

