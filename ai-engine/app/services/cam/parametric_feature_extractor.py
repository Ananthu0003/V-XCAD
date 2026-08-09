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
        part_length = self._infer_part_dimension(groups, ["overall_length", "total_length", "part_length", "body_length", "length"])
        part_od = self._infer_part_dimension(groups, ["outer_diameter", "od", "outside_diameter", "body_diameter", "outer_dia", "body_dia"])
        
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
            features.insert(0, {
                "id": f"feat_{uuid.uuid4().hex[:8]}",
                "type": "external_cylinder",
                "name": "Outer Diameter",
                "dimensions": {
                    "diameter": part_od,
                    "length": part_length if part_length and part_length > 0 else 10.0
                },
                "center": part_center,
                "axis": _PRIMARY_AXIS,
                "machinable_in_current_setup": True,
                "status": "machinable",
                "geometry": {"status": "synthetic"}
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
                "center": part_center,
                "axis": _PRIMARY_AXIS,
                "status": "machinable",
                "geometry": {"status": "synthetic"},
                "machiningRegion": {
                    "valid": True,
                    "regionId": f"feat_{uuid.uuid4().hex[:8]}",
                    "regionType": "contour_region",
                    "center": part_center,
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
                
        return features
    
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
            
        depth = float(dims.get("depth", dims.get("length", 0)))
        if depth <= 0 and part_length:
            depth = part_length
        # Try to get depth from B-Rep data if parametric depth is still zero
        if depth <= 0 and brep_data and brep_data.get("status") == "success":
            # Use the stock height as fallback for through-holes
            bounds = brep_data.get("bounds", {})
            if bounds.get("height") and bounds["height"] > 0:
                depth = bounds["height"]
        if depth <= 0:
            return None
        
        # Compute center position based on side
        center = self._compute_center_for_side(axis, part_length)
        if "offset" in dims:
            # If there's an offset (like cross hole offset), apply it to Z
            center[2] = float(dims["offset"])
            
        # --- B-Rep Topological Coordination ---
        # Match the parametric hole to the closest B-Rep cylinder by diameter.
        # Use the B-Rep XY center for positioning, but keep center Z at the
        # stock top (Z=0 in CAM coordinates) so the toolpath engine starts
        # the cut from the correct height.
        if brep_data and brep_data.get("status") == "success" and brep_data.get("holes"):
            best_match = None
            min_err = float('inf')
            for h in brep_data["holes"]:
                err = abs(h["diameter"] - diameter)
                if err < 1.0 and err < min_err:
                    min_err = err
                    best_match = h
            if best_match:
                # Only take XY from B-Rep; Z stays at 0 (stock top)
                center[0] = best_match["center"][0]
                center[1] = best_match["center"][1]
                # Update depth from the B-Rep measured extent
                if best_match.get("depth") and best_match["depth"] > 0:
                    depth = best_match["depth"]
                
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
            
        # Parse explicit center coordinates if provided by AI parameters, 
        # or fallback to bounding box center if we don't have B-Rep planar mapping yet.
        center = part_center[:] if part_center else [0.0, 0.0, 0.0]
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
                # Use XY from B-Rep
                center[0] = best_match["center"][0]
                center[1] = best_match["center"][1]
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
            
        # Parse explicit center coordinates if provided
        center = part_center[:] if part_center else [0.0, 0.0, 0.0]
        if "x_center" in dims:
            center[0] = float(dims["x_center"])
        if "y_center" in dims:
            center[1] = float(dims["y_center"])
            
        # Determine center based on side (front/back) if no explicit center is found
        if "x_center" not in dims and "y_center" not in dims:
            center = self._compute_center_for_side(axis, part_length, part_center)
        
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
                "height": height
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
                "center": [0, 0, 0],
                "axis": axis,
                "height": height,
                "topZ": stock_top_z,
                "bottomZ": stock_top_z - height,
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
            "center": part_center[:] if part_center else [0.0, 0.0, 0.0],
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
        For the primary side, center is at the part bounding box center.
        For the opposite side, center is offset along -Z by the part length
        (this positions the feature at the far end of the part).
        """
        cx, cy, cz = part_center if part_center else [0.0, 0.0, 0.0]
        if axis == _OPPOSITE_AXIS and part_length and part_length > 0:
            return [cx, cy, cz - part_length]
        return [cx, cy, cz]
    
    def _infer_part_dimension(self, groups: Dict[str, Dict], candidate_keys: List[str]) -> Optional[float]:
        """
        Searches the parameter groups for known overall-dimension keys.
        Handles both forms:
          - Exact group key match: e.g., groups["overall_length"]["value"]
          - Prefix + suffix match: e.g., groups["overall"]["length"] (from "OVERALL LENGTH")
        Returns the value if found, None otherwise.
        """
        for ckey in candidate_keys:
            # 1. Exact match on group key
            if ckey in groups:
                val = groups[ckey].get("value") or groups[ckey].get("length") or groups[ckey].get("depth") or groups[ckey].get("dia")
                if val and isinstance(val, (int, float)) and val > 0:
                    return float(val)
            
            # 2. Prefix + suffix match: split candidate key and look for prefix group with suffix dim
            parts = ckey.rsplit("_", 1)
            if len(parts) == 2:
                prefix, suffix = parts
                if prefix in groups:
                    # Normalize suffix: "diameter" → "dia"
                    norm_suffix = "dia" if suffix == "diameter" else suffix
                    val = groups[prefix].get(norm_suffix) or groups[prefix].get(suffix)
                    if val and isinstance(val, (int, float)) and val > 0:
                        return float(val)
        return None
    
    def _is_part_dimension_group(self, prefix: str) -> bool:
        """
        Returns True if the prefix represents an overall part dimension
        rather than a machinable feature.
        """
        part_dim_tokens = {
            "overall_length", "total_length", "part_length", "body_length",
            "outer_diameter", "od", "outside_diameter", "body_diameter",
            "outer_dia", "body_dia", "overall", "total", "mass", "weight",
            "material", "scale"
        }
        return prefix in part_dim_tokens
    
    def _matches_any(self, tokens: set, keywords: set) -> bool:
        """Returns True if any token in the prefix matches a feature keyword."""
        return bool(tokens.intersection(keywords))
