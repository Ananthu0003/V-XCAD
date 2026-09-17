import json
import uuid
import math
from typing import Dict, Any, List, Tuple, Optional
from app.models.provenance import GeometricProvenance

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
        _single_dim_suffixes = {"dia", "diameter", "radius", "width", "depth", "length", "size", "height", "offset", "chamfer", "fillet", "rad"}
        # Compound suffixes: match the last 2 tokens as a unit, map to a canonical dim type
        _compound_dim_suffixes = {
            ("width", "flats"): "width",      # e.g. hex_socket_width_flats → width
            ("across", "flats"): "width",     # e.g. hex_across_flats → width
            ("corner", "radius"): "corner_radius",
            ("nose", "radius"): "corner_radius",
            ("tip", "radius"): "corner_radius",
            ("fillet", "radius"): "fillet_radius",
            ("shoulder", "radius"): "fillet_radius",
            ("transition", "radius"): "fillet_radius",
        }
        
        for key, raw_val in parameters.items():
            if isinstance(raw_val, dict) and "value" in raw_val:
                value = raw_val["value"]
            elif isinstance(raw_val, (int, float)):
                value = raw_val
            else:
                continue
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
                elif parts[-2] in _single_dim_suffixes and parts[-1] in (_PRIMARY_SIDE_TOKENS | _OPPOSITE_SIDE_TOKENS):
                    # e.g. recess_depth_top -> prefix='recess_top', dim='depth'
                    # e.g. recess_depth_bottom -> prefix='recess_bottom', dim='depth'
                    prefix = f"{'_'.join(parts[:-2])}_{parts[-1]}"
                    dim_type = "dia" if parts[-2] == "diameter" else parts[-2]
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

        # Cross-propagate base attributes to directional sub-prefixes (e.g. recess_dia -> recess_top, recess_bottom)
        for pfx, d_map in list(groups.items()):
            if "_" in pfx:
                root_candidate = pfx.rsplit("_", 1)[0]
                if root_candidate in groups and root_candidate != pfx:
                    for k_dim, v_dim in groups[root_candidate].items():
                        if k_dim not in d_map:
                            d_map[k_dim] = v_dim
                
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
        
        # --- Phase 4: Sequence stepped cylindrical features & Add overall part features ---
        # Detect if we have multiple stepped cylindrical features along Z
        cylindrical_features = [f for f in features if f.get("type") in ("boss", "external_cylinder") and (f.get("dimensions", {}).get("diameter", 0) > 0 or f.get("diameter", 0) > 0) and f.get("axis") == _PRIMARY_AXIS]
        
        # If multiple cylindrical features all defaulted to offset 0, sequence them along Z from tip to base
        if len(cylindrical_features) > 1:
            all_zero_offset = all(f.get("dimensions", {}).get("offset", 0.0) == 0.0 for f in cylindrical_features)
            if all_zero_offset:
                # Sort from smallest diameter (tip) to largest diameter (base)
                cylindrical_features.sort(key=lambda f: float(f.get("dimensions", {}).get("diameter") or f.get("diameter") or 0))
                accum_z = stock_top_z
                for cf in cylindrical_features:
                    h = float(cf.get("dimensions", {}).get("height") or cf.get("dimensions", {}).get("depth") or 5.0)
                    cf["dimensions"]["offset"] = round(stock_top_z - accum_z, 4)
                    cf["machiningRegion"]["topZ"] = round(accum_z, 4)
                    cf["machiningRegion"]["bottomZ"] = round(accum_z - h, 4)
                    accum_z -= h

        has_stepped_cylinders = len(cylindrical_features) > 0

        # Check if part is rotational before synthesizing turned_od
        is_pure_rotational = True
        if part_width and part_od and abs(part_width - part_od) > 1.0:
            is_pure_rotational = False
        if part_length_y and part_od and abs(part_length_y - part_od) > 1.0:
            is_pure_rotational = False
        if brep_data and "bounds" in brep_data:
            bb = brep_data["bounds"]
            if isinstance(bb, dict):
                bw = float(bb.get("width", 0.0))
                bl = float(bb.get("length", 0.0))
                if (part_od and max(bw, bl) > (part_od * 1.08)) or (max(bw, bl) > 0 and abs(bw - bl) / max(bw, bl) > 0.08):
                    is_pure_rotational = False

        # Only add generic OD cylinder if no explicit stepped features were extracted and part is truly rotational
        if part_od and part_od > 0 and not has_stepped_cylinders and is_pure_rotational:
            import hashlib
            eff_len = part_length if part_length and part_length > 0 else 10.0
            feat_id = f"feat_od_{hashlib.md5(f'od_{part_od}_{eff_len}'.encode()).hexdigest()[:8]}"
            features.append({
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
        has_outer_boundary = any(
            f.get("subtype") == "outer_profile" or f.get("type") == "contour" for f in features
        )
        if not has_outer_boundary and brep_data and brep_data.get("silhouette"):
            sil = brep_data["silhouette"]
            bb = brep_data.get("bounds", {})
            part_h = float(bb.get("height", part_length or 10.0))
            features.append({
                "id": f"feat_{uuid.uuid4().hex[:8]}",
                "type": "contour",
                "subtype": "outer_profile",
                "name": "Outer Profile",
                "dimensions": {
                    "width": bb.get("width", 0.0),
                    "length": bb.get("length", 0.0),
                    "depth": part_h
                },
                "polygon_2d": sil.get("polygon_2d", []),
                "wire_3d": sil.get("wire_3d", []),
                "center": [0.0, 0.0, 0.0],
                "axis": _PRIMARY_AXIS,
                "status": "machinable",
                "geometry": {"status": "brep", "provenance": "brep_silhouette"},
                "machiningRegion": {
                    "valid": True,
                    "regionId": f"feat_{uuid.uuid4().hex[:8]}",
                    "regionType": "contour_region",
                    "polygon": sil.get("polygon_2d", []),
                    "depth": part_h,
                    "topZ": stock_top_z,
                    "bottomZ": stock_top_z - part_h,
                    "source": "brep"
                }
            })

        # Add facing at the very beginning of the primary setup features
        has_primary_features = any(
            f.get("axis") == _PRIMARY_AXIS for f in features
        )
        has_face_feat = any(
            f.get("type") in ("face", "facing") or "face" in str(f.get("name", "")).lower() for f in features
        )
        model_top_z = 0.0
        if brep_data and "bounds" in brep_data:
            b = brep_data["bounds"]
            if isinstance(b, dict) and "max" in b:
                model_top_z = float(b["max"][2])
        
        setup_facing = 0.0
        if setup:
            setup_facing = float(
                setup.get("facingAllowance")
                or setup.get("stockOffsetTop")
                or setup.get("axialOffsetTop")
                or setup.get("stockOffset")
                or 0.0
            )
            facing_allowance = setup_facing if setup_facing > 0 else max(0.0, round(stock_top_z - model_top_z, 4))
        elif part_od and part_od > 0 and not brep_data:
            facing_allowance = 1.0
            stock_top_z = 1.0
            model_top_z = 0.0
        else:
            facing_allowance = max(0.0, round(stock_top_z - model_top_z, 4))
        
        if not has_face_feat and facing_allowance > 0.01 and (has_primary_features or not features):
            face_feat = self._create_face_feature("Top Face (Setup 1)", _PRIMARY_AXIS, stock_top_z, part_od=part_od, part_length=part_length, part_center=part_center, model_top_z=model_top_z)
            if face_feat:
                features.insert(0, face_feat)

        # Deduplicate features by type and geometry (e.g. redundant tokens like 'base' vs 'base_thickness')
        deduped: List[Dict[str, Any]] = []
        for f in features:
            f_type = f.get("type")
            f_dia = f.get("dimensions", {}).get("diameter") or f.get("diameter")
            f_top = f.get("machiningRegion", {}).get("topZ")
            f_axis = f.get("axis")
            f_fid = f.get("face_id")
            is_dup = False
            for existing in deduped:
                # Features with different orientation axes or distinct B-Rep face IDs are never duplicates
                if existing.get("axis") != f_axis:
                    continue
                if f_fid is not None and existing.get("face_id") is not None and existing.get("face_id") != f_fid:
                    continue
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
        center = [0.0, 0.0, 0.0]
        if "x_center" in dims:
            center[0] = float(dims["x_center"])
        if "y_center" in dims:
            center[1] = float(dims["y_center"])
        if "offset" in dims:
            center[2] = float(dims["offset"])
        elif axis != _PRIMARY_AXIS and axis != _OPPOSITE_AXIS:
            center = self._compute_center_for_side(axis, part_length)

        is_through = False
        brep_provenance = None

        # --- B-Rep Topological Coordination (Authoritative) ---
        best_match = None
        if brep_data and brep_data.get("status") == "success" and brep_data.get("holes"):
            min_err = float('inf')
            for h in brep_data["holes"]:
                err = abs(h["diameter"] - diameter)
                if err < 0.1 and err < min_err:
                    min_err = err
                    best_match = h
            if best_match:
                # Use actual topological cylinder depth from B-Rep
                if best_match.get("depth") and float(best_match["depth"]) > 0:
                    depth = float(best_match["depth"])
                if best_match.get("center"):
                    center = list(best_match["center"])
                if best_match.get("axis"):
                    axis = list(best_match["axis"])
                is_through = best_match.get("is_through", False)
                brep_provenance = "brep_cylinder_topology"

        if depth <= 0:
            return None
                
        # Compute topZ/bottomZ in the feature's local frame
        # For primary side: tool enters from stock_top_z downward
        top_z = stock_top_z
        bottom_z = stock_top_z - depth
        
        import hashlib
        feat_id = f"feat_{hashlib.md5(prefix.encode()).hexdigest()[:8]}"
        has_brep = best_match is not None
        provenance = GeometricProvenance(
            source_type="brep_cylinder" if has_brep else "user_config",
            source_entity_ids=[best_match.get("face_id", "cylinder")] if has_brep else [prefix],
            topology_reference=f"Cylinder_{best_match.get('face_id', 0)}" if has_brep else None,
            coordinate_system="model_native",
            derivation="BRep internal cylinder topology with axial vertex projection" if has_brep else "Parametric annotation",
            confidence=1.0 if has_brep else 0.85,
            tolerance=0.01,
            parent_feature_id=feat_id
        ).model_dump()

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
            "is_through": is_through,
            "machinable_in_current_setup": (axis == _PRIMARY_AXIS),
            "status": "machinable",
            "provenance": provenance,
            "geometry": {"status": "brep" if brep_provenance else "parametric", "provenance": provenance},
            "machiningRegion": {
                "valid": True,
                "regionId": feat_id,
                "regionType": "drill_region",
                "center": center,
                "axis": axis,
                "depth": depth,
                "topZ": top_z,
                "bottomZ": bottom_z,
                "source": "brep" if brep_provenance else "parametric",
                "provenance": provenance,
                "diagnostics": {"source": brep_provenance or "parametric", "side": side_label}
            }
        }
    
    def _create_pocket_feature(self, prefix: str, dims: Dict, axis: List[float], part_length: Optional[float] = None, stock_top_z: float = 0.0, brep_data: Optional[Dict[str, Any]] = None, part_center: List[float] = None) -> Optional[Dict[str, Any]]:
        # Strictly extract width and length without converting scalar depth into a 2D square
        width = float(dims.get("width", 0.0))
        length = float(dims.get("length", width))
        depth = float(dims.get("depth", dims.get("height", 0.0)))
        
        # Parse explicit center coordinates
        center = [0.0, 0.0, 0.0]
        if "x_center" in dims:
            center[0] = float(dims["x_center"])
        elif "x_offset" in dims and width > 0:
            center[0] = float(dims["x_offset"]) + (width / 2.0)
            
        if "y_center" in dims:
            center[1] = float(dims["y_center"])
        elif "y_offset" in dims and length > 0:
            center[1] = float(dims["y_offset"]) + (length / 2.0)
            
        # --- B-Rep Topological Coordination ---
        best_match = None
        is_circular = False
        diameter = None

        if brep_data and brep_data.get("status") == "success" and brep_data.get("pockets"):
            min_err = float('inf')
            
            # 0. Prioritize candidate pockets whose face normal aligns with feature axis direction
            candidate_pockets = []
            for p in brep_data["pockets"]:
                norm = p.get("normal", [0, 0, 1])
                dot = norm[0] * axis[0] + norm[1] * axis[1] + norm[2] * axis[2]
                if dot > 0.7:
                    candidate_pockets.append(p)
            if not candidate_pockets:
                candidate_pockets = brep_data["pockets"]

            # 1. Match by depth first if depth is known
            if depth > 0:
                for p in candidate_pockets:
                    p_depth = p.get("depth_from_entry") if p.get("depth_from_entry") is not None else p.get("depth_from_top", 0.0)
                    diff = abs(p_depth - depth)
                    if diff < 1.0 and diff < min_err:
                        min_err = diff
                        best_match = p
                        
            # 2. Match by area if width and length were provided
            if not best_match and width > 0:
                target_area = width * length
                for p in candidate_pockets:
                    err = abs(p.get("area", 0.0) - target_area) / max(target_area, 1.0)
                    if err < 0.5 and err < min_err:
                        min_err = err
                        best_match = p
                        
            if best_match:
                if best_match.get("is_circular"):
                    is_circular = True
                    diameter = float(best_match.get("diameter", 0.0))
                    width = diameter
                    length = diameter
                else:
                    if width <= 0:
                        width = float(best_match.get("width", 0.0))
                    if length <= 0:
                        length = float(best_match.get("length", width))
                if depth <= 0:
                    depth = float(best_match.get("depth_from_entry") if best_match.get("depth_from_entry") is not None else best_match.get("depth_from_top", 0.0))
                if best_match.get("center"):
                    center = list(best_match["center"])

        # Check cylindrical troughs or partial cylinder features (e.g. rounded bottom U-slots)
        if not best_match and brep_data:
            for cyl in (brep_data.get("cylinders", []) + brep_data.get("holes", [])):
                c_dia = float(cyl.get("diameter", 0.0))
                c_rad = float(cyl.get("radius", 0.0))
                if (width > 0 and (abs(c_dia - width) < 0.5 or abs(c_rad - (width / 2.0)) < 0.25)):
                    c_center = cyl.get("center", [0, 0, 0])
                    center = list(c_center)
                    if depth <= 0 and cyl.get("depth"):
                        depth = float(cyl["depth"])
                    best_match = cyl
                    break

        # If still at default origin and B-Rep bounds available, check if prefix indicates an upright/arm/end feature
        if not best_match and center == [0.0, 0.0, 0.0] and brep_data and "bounds" in brep_data:
            bb = brep_data["bounds"]
            if isinstance(bb, dict) and "max" in bb and "min" in bb:
                if any(kw in prefix.lower() for kw in ("upright", "arm", "flange", "right", "end", "u_slot", "outer_slot")):
                    max_x = float(bb["max"][0])
                    flange_len = length if length > 0 else 28.0
                    center[0] = round(max_x - (flange_len / 2.0), 4)

        # Check if parametric dimensions explicitly indicate circular feature
        if not is_circular:
            target_dia = float(dims.get("dia") or dims.get("diameter") or 0.0)
            if target_dia > 0:
                is_circular = True
                diameter = target_dia
                width = target_dia
                length = target_dia

        # If width, length, or depth remain unresolved, do NOT fabricate synthetic geometry
        if width <= 0 or length <= 0 or depth <= 0:
            return None

        # Calculate minimum passage width if inner wires/island exist
        min_passage_width = None
        if best_match and best_match.get("inner_wires_3d") and best_match.get("circle_radius"):
            c_p = best_match.get("center", [0, 0, 0])
            inner_radii = []
            for loop in best_match["inner_wires_3d"]:
                for pt in loop:
                    dist = math.sqrt((pt[0] - c_p[0])**2 + (pt[1] - c_p[1])**2)
                    inner_radii.append(dist)
            if inner_radii:
                max_inner_r = max(inner_radii)
                min_passage_width = round(max(0.0, best_match["circle_radius"] - max_inner_r), 3)
        
        import hashlib
        feat_id = f"feat_{hashlib.md5(prefix.encode()).hexdigest()[:8]}"
        subtype = "circular_pocket" if is_circular else "rectangular_pocket"
        has_brep = best_match is not None
        provenance = GeometricProvenance(
            source_type="brep_face" if has_brep else "user_config",
            source_entity_ids=[best_match.get("face_id")] if (has_brep and best_match.get("face_id") is not None) else [prefix],
            topology_reference=f"Face_{best_match.get('face_id')}" if has_brep and best_match.get('face_id') is not None else None,
            coordinate_system="model_native",
            derivation="BRep planar pocket face topology with inner wire keepouts" if has_brep else "Parametric annotation",
            confidence=1.0 if has_brep else 0.8,
            tolerance=0.01,
            parent_feature_id=feat_id
        ).model_dump()

        return {
            "id": feat_id,
            "type": "pocket",
            "subtype": subtype,
            "name": prefix,
            "is_circular": is_circular,
            "diameter": diameter,
            "face_id": best_match.get("face_id") if best_match else None,
            "min_passage_width": min_passage_width,
            "dimensions": {
                "width": width,
                "length": length,
                "depth": depth,
                "diameter": diameter,
                "min_passage_width": min_passage_width
            },
            "center": center,
            "axis": axis,
            "machinable_in_current_setup": (axis == _PRIMARY_AXIS),
            "status": "machinable",
            "provenance": provenance,
            "geometry": {
                "status": "brep" if has_brep else "parametric",
                "provenance": provenance,
                "face_id": best_match.get("face_id") if best_match else None
            },
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
                "diameter": diameter,
                "min_passage_width": min_passage_width,
                "source": "brep" if has_brep else "parametric",
                "provenance": provenance,
                "diagnostics": {"source": "brep" if has_brep else "parametric"}
            }
        }
    
    def _create_boss_feature(self, prefix: str, dims: Dict, axis: List[float], part_length: Optional[float] = None, stock_top_z: float = 0.0, part_od: Optional[float] = None, brep_data: Optional[Dict[str, Any]] = None, part_center: List[float] = None) -> Optional[Dict[str, Any]]:
        width = float(dims.get("width", dims.get("value", 0.0)))
        length = float(dims.get("length", dims.get("value", width)))
        height = float(dims.get("height", dims.get("depth", dims.get("length", 0.0))))
        diameter = float(dims.get("dia", 0.0))
        
        if diameter <= 0 and "collar" in prefix.lower() and part_od:
             diameter = part_od
             
        # B-Rep coordination for turned cylinders / steps (Authoritative)
        ext_cyls = ((brep_data.get("cylinders") or []) if brep_data else []) or ((brep_data.get("external_cylinders") or []) if brep_data else [])
        best_boss_brep = None
        if ext_cyls and diameter > 0:
            min_err = float('inf')
            for c in ext_cyls:
                err = abs(c.get("diameter", 0.0) - diameter)
                if err < 0.1 and err < min_err:
                    min_err = err
                    best_boss_brep = c
            if best_boss_brep:
                if best_boss_brep.get("depth") and float(best_boss_brep["depth"]) > 0:
                    height = float(best_boss_brep["depth"])
                if best_boss_brep.get("center"):
                    center = list(best_boss_brep["center"])
                    
        # B-Rep coordination for planar step/saddle floor faces
        if not best_boss_brep and brep_data and brep_data.get("planar_regions"):
            for pr in brep_data["planar_regions"]:
                norm = pr.get("normal", [0, 0, 1])
                if norm[2] > 0.7 and pr.get("depth_from_top", 0.0) > 1.0:
                    face_z = pr.get("z", 0.0)
                    if abs(face_z - height) < 1.0 or abs(pr.get("depth_from_top", 0.0) - height) < 1.0:
                        height = float(pr.get("depth_from_top"))
                        if pr.get("center"):
                            center = list(pr["center"])
                            best_boss_brep = pr
                        break

        if (width <= 0 or length <= 0) and diameter <= 0:
            return None
        if height <= 0:
            return None
            
        # Parse explicit center coordinates in setup-local space if not provided by B-Rep
        if not best_boss_brep:
            center = [0.0, 0.0, 0.0]
            if "x_center" in dims:
                center[0] = float(dims["x_center"])
            if "y_center" in dims:
                center[1] = float(dims["y_center"])
            elif axis != _PRIMARY_AXIS and axis != _OPPOSITE_AXIS:
                center = self._compute_center_for_side(axis, part_length)

        offset = float(dims.get("offset") or dims.get("z_offset") or dims.get("start_z") or 0.0)
        top_z = stock_top_z - offset
        bottom_z = top_z - height
        
        # Parse edge treatments (nose radius / corner radius / shoulder fillet)
        corner_radius = float(dims.get("corner_radius") or dims.get("nose_radius") or dims.get("tip_radius") or dims.get("chamfer") or 0.0)
        fillet_radius = float(dims.get("fillet_radius") or dims.get("shoulder_radius") or dims.get("transition_radius") or dims.get("fillet") or 0.0)
        
        import hashlib
        feat_id = f"feat_{hashlib.md5(prefix.encode()).hexdigest()[:8]}"
        feature_dict = {
            "id": feat_id,
            "type": "boss",
            "subtype": "cylindrical_boss" if diameter else "rectangular_boss",
            "name": prefix,
            "dimensions": {
                "diameter": diameter,
                "width": width,
                "length": length,
                "height": height,
                "depth": height,
                "corner_radius": corner_radius,
                "fillet_radius": fillet_radius,
                "offset": offset
            },
            "center": center,
            "axis": axis,
            "corner_radius": corner_radius,
            "fillet_radius": fillet_radius,
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
                "corner_radius": corner_radius,
                "fillet_radius": fillet_radius,
                "source": "parametric",
                "diagnostics": {"source": "parametric"}
            }
        }
        return feature_dict
    
    def _create_face_feature(self, name: str, axis: List[float], stock_top_z: float = 0.0, part_od: float = None, part_length: float = None, part_center: List[float] = None, model_top_z: float = 0.0) -> Optional[Dict[str, Any]]:
        facing_allowance = round(max(0.0, stock_top_z - model_top_z), 4)
        if facing_allowance <= 0.01:
            return None
        dims = {"depth": facing_allowance}
        if part_od and part_od > 0:
            dims["diameter"] = part_od
            dims["width"] = part_od
            dims["length"] = part_od
        if part_length and part_length > 0:
            dims["part_length"] = part_length
        import hashlib
        feat_id = f"feat_{hashlib.md5(name.encode()).hexdigest()[:8]}"
        provenance = GeometricProvenance(
            source_type="stock_boundary",
            source_entity_ids=["stock_top", "model_top"],
            derivation="Difference between stock top surface and model top surface",
            coordinate_system="model_native",
            tolerance=0.01,
            parent_feature_id=feat_id
        ).model_dump()
        return {
            "id": feat_id,
            "type": "face",
            "name": name,
            "center": [0.0, 0.0, 0.0],
            "depth": facing_allowance,
            "diameter": part_od if part_od and part_od > 0 else None,
            "dimensions": dims,
            "axis": axis,
            "machinable_in_current_setup": (axis == _PRIMARY_AXIS),
            "status": "machinable",
            "provenance": provenance,
            "geometry": {"status": "stock_derived", "provenance": provenance},
            "machiningRegion": {
                "topZ": stock_top_z,
                "bottomZ": model_top_z,
                "depth": facing_allowance,
                "provenance": provenance
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

