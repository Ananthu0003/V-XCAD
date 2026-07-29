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
    
    def extract(self, parameters: Dict[str, Any]) -> List[Dict[str, Any]]:
        features = []
        
        # --- Phase 1: Group parameters by common prefix ---
        groups = {}
        for key, value in parameters.items():
            if not isinstance(value, (int, float)):
                continue
                
            # Normalize key: lowercase, spaces to underscores
            normalized_key = str(key).strip().lower().replace(" ", "_")
            parts = normalized_key.split('_')
            
            # Known dimension suffixes
            dim_suffixes = {"dia", "diameter", "radius", "width", "depth", "length", "size", "height", "offset"}
            
            if len(parts) > 1 and parts[-1] in dim_suffixes:
                prefix = "_".join(parts[:-1])
                dim_type = "dia" if parts[-1] == "diameter" else parts[-1]
                groups.setdefault(prefix, {})[dim_type] = value
            else:
                groups.setdefault(normalized_key, {})["value"] = value
        
        # --- Phase 2: Extract overall part dimensions from parameters ---
        part_length = self._infer_part_dimension(groups, ["overall_length", "total_length", "part_length", "body_length", "length"])
        part_od = self._infer_part_dimension(groups, ["outer_diameter", "od", "outside_diameter", "body_diameter", "outer_dia", "body_dia"])
        
        # --- Phase 3: Analyze each group to determine features ---
        for prefix, dims in groups.items():
            prefix_lower = prefix.lower()
            tokens = set(prefix_lower.split('_'))
            
            # Skip groups that are overall part dimensions (not features)
            if self._is_part_dimension_group(prefix_lower):
                continue
            
            # Detect feature side/orientation from prefix tokens
            axis, side_label = self._detect_side(tokens)
            
            # Identify Holes / Bores / Drills
            if self._matches_any(tokens, {"hole", "drill", "bore", "drilling", "boring"}):
                feat = self._create_hole_feature(prefix, dims, axis, side_label, part_length, part_od)
                if feat:
                    features.append(feat)
                    
            # Identify Pockets / Slots
            elif self._matches_any(tokens, {"pocket", "slot", "cavity", "groove", "channel"}):
                feat = self._create_pocket_feature(prefix, dims, axis)
                if feat:
                    features.append(feat)
                    
            # Identify Bosses / Steps / Pads
            elif self._matches_any(tokens, {"boss", "step", "pad", "protrusion", "raised", "collar", "flange", "shoulder"}):
                feat = self._create_boss_feature(prefix, dims, axis, part_od)
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
                "center": [0, 0, 0],
                "axis": _PRIMARY_AXIS,
                "machinable_in_current_setup": True,
                "status": "machinable",
                "geometry": {"status": "synthetic"}
            })

        # Only add facing for the primary setup (the part's exposed top face)
        has_primary_features = any(
            f.get("axis") == _PRIMARY_AXIS for f in features
        )
        if has_primary_features or not features:
            features.append(self._create_face_feature("Top Face (Setup 1)", _PRIMARY_AXIS, part_od=part_od, part_length=part_length))
                
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
                              side_label: str, part_length: Optional[float], part_od: Optional[float] = None) -> Optional[Dict[str, Any]]:
        diameter = float(dims.get("dia", dims.get("size", dims.get("value", 0))))
        if "radius" in dims:
            diameter = float(dims["radius"]) * 2.0
        if diameter <= 0:
            return None
            
        depth = float(dims.get("depth", dims.get("length", 0)))
        if depth <= 0:
            return None
        
        # Compute center position based on side
        center = self._compute_center_for_side(axis, part_length)
        if "offset" in dims:
            # If there's an offset (like cross hole offset), apply it to Z
            center[2] = float(dims["offset"])
        
        # Compute topZ/bottomZ in the feature's local frame
        # For primary side: tool enters from Z=0 downward → topZ=0, bottomZ=-depth
        # For opposite side: after part flip, the same convention applies
        top_z = 0.0
        bottom_z = -depth
        
        feat_id = f"feat_{uuid.uuid4().hex[:8]}"
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
    
    def _create_pocket_feature(self, prefix: str, dims: Dict, axis: List[float]) -> Optional[Dict[str, Any]]:
        width = float(dims.get("width", dims.get("value", 10.0)))
        length = float(dims.get("length", dims.get("value", 10.0)))
        depth = float(dims.get("depth", 5.0))
        
        feat_id = f"feat_{uuid.uuid4().hex[:8]}"
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
            "center": [0, 0, 0],
            "axis": axis,
            "machinable_in_current_setup": (axis == _PRIMARY_AXIS),
            "status": "machinable",
            "geometry": {"status": "synthetic"},
            "machiningRegion": {
                "valid": True,
                "regionId": feat_id,
                "regionType": "pocket_region",
                "center": [0, 0, 0],
                "axis": axis,
                "depth": depth,
                "topZ": 0.0,
                "bottomZ": -depth,
                "width": width,
                "length": length,
                "source": "parametric",
                "diagnostics": {"source": "parametric"}
            }
        }
    
    def _create_boss_feature(self, prefix: str, dims: Dict, axis: List[float], part_od: Optional[float] = None) -> Optional[Dict[str, Any]]:
        width = float(dims.get("width", dims.get("value", 20.0)))
        length = float(dims.get("length", dims.get("value", 20.0)))
        height = float(dims.get("height", dims.get("depth", dims.get("length", 5.0))))
        diameter = dims.get("dia")
        
        if not diameter and "collar" in prefix.lower() and part_od:
             diameter = part_od
        
        feat_id = f"feat_{uuid.uuid4().hex[:8]}"
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
            "center": [0, 0, 0],
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
                "topZ": height,
                "bottomZ": 0.0,
                "diameter": diameter,
                "width": width,
                "length": length,
                "source": "parametric",
                "diagnostics": {"source": "parametric"}
            }
        }
    
    def _create_face_feature(self, name: str, axis: List[float], part_od: float = None, part_length: float = None) -> Dict[str, Any]:
        dims = {"depth": 1.0}
        if part_od and part_od > 0:
            dims["diameter"] = part_od
            dims["width"] = part_od
            dims["length"] = part_od
        if part_length and part_length > 0:
            dims["part_length"] = part_length
        return {
            "id": f"feat_{uuid.uuid4().hex[:8]}",
            "type": "face",
            "name": name,
            "depth": 1.0,
            "diameter": part_od if part_od and part_od > 0 else None,
            "dimensions": dims,
            "center": [0, 0, 0],
            "axis": axis,
            "machinable_in_current_setup": (axis == _PRIMARY_AXIS),
            "status": "machinable"
        }
    
    # -------------------------------------------------------------------------
    # Helpers
    # -------------------------------------------------------------------------
    
    def _compute_center_for_side(self, axis: List[float], part_length: Optional[float]) -> List[float]:
        """
        For the primary side, center is at origin [0, 0, 0].
        For the opposite side, center is offset along -Z by the part length
        (this positions the feature at the far end of the part).
        """
        if axis == _OPPOSITE_AXIS and part_length and part_length > 0:
            return [0.0, 0.0, -part_length]
        return [0.0, 0.0, 0.0]
    
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
