import json
import math
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple
from app.models.schemas import MachineRecommendation, MachineRecommendationResponse
from app.services.cam.machine_validation import get_matrix


class MachineRecommendationEngine:
    """
    Intelligently recommends the optimal CNC machine profile based on:
    1. B-Rep topology & geometric bounding box
    2. Extracted manufacturing features & approach vectors
    3. Axis count requirements (3-Axis, 4-Axis indexer, 5-Axis, Lathe, Mill-Turn)
    4. Machine travel limits & capability matrix
    """

    def __init__(self):
        self.matrix = get_matrix()

    def recommend_machine(
        self,
        features: Optional[List[Dict[str, Any]]] = None,
        topology_info: Optional[Dict[str, Any]] = None,
        stock_dimensions: Optional[List[float]] = None,
        blueprint_data: Optional[Dict[str, Any]] = None,
        parameters: Optional[Dict[str, Any]] = None,
        python_script: Optional[str] = None
    ) -> MachineRecommendationResponse:
        features = features or []
        topology_info = topology_info or {}
        
        # 1. Analyze geometry & features
        analysis = self._analyze_part(features, topology_info, stock_dimensions, blueprint_data, parameters, python_script)
        
        # 2. Score all available machine profiles
        scored_profiles = self._score_machine_profiles(analysis)
        
        # 3. Assemble primary recommendation and alternatives
        if not scored_profiles:
            # Fallback default
            fallback = MachineRecommendation(
                profileId="haas_vf2",
                label="Haas VF-2",
                machineType="MILL_3X_VMC",
                confidence=0.8,
                isRecommended=True,
                reason="Default recommendation for standard 3-axis prismatic milling.",
                setupCount=1,
                requiredAxes=3,
                fitsEnvelope=True
            )
            return MachineRecommendationResponse(
                primaryRecommendation=fallback,
                alternatives=[],
                detectedPartType="prismatic",
                analysisSummary=analysis
            )
            
        primary = scored_profiles[0]
        primary.isRecommended = True
        alternatives = scored_profiles[1:6] # Top 5 alternatives
        
        return MachineRecommendationResponse(
            primaryRecommendation=primary,
            alternatives=alternatives,
            detectedPartType=analysis["part_type"],
            analysisSummary=analysis
        )

    def _analyze_part(
        self,
        features: List[Dict[str, Any]],
        topology_info: Dict[str, Any],
        stock_dimensions: Optional[List[float]],
        blueprint_data: Optional[Dict[str, Any]],
        parameters: Optional[Dict[str, Any]] = None,
        python_script: Optional[str] = None
    ) -> Dict[str, Any]:
        # Compute bounding box
        bounds = topology_info.get("bounds")
        dim_x, dim_y, dim_z = 0.0, 0.0, 0.0
        if stock_dimensions and len(stock_dimensions) >= 3:
            dim_x, dim_y, dim_z = float(stock_dimensions[0]), float(stock_dimensions[1]), float(stock_dimensions[2])
        elif bounds and len(bounds) >= 6:
            dim_x = abs(float(bounds[3]) - float(bounds[0]))
            dim_y = abs(float(bounds[4]) - float(bounds[1]))
            dim_z = abs(float(bounds[5]) - float(bounds[2]))
        elif parameters and ("total_length" in parameters or "length" in parameters):
            # Extract dimensions from parameters if bounds are missing
            dim_x = float(parameters.get("total_length") or parameters.get("length") or 100.0)
            max_dia = float(parameters.get("outer_dia_max") or parameters.get("dia") or parameters.get("diameter") or parameters.get("shaft_dia") or 30.0)
            dim_y = max_dia
            dim_z = max_dia
        else:
            dim_x, dim_y, dim_z = 100.0, 100.0, 25.0

        # Parameter semantics inspection
        param_turning_count = 0
        param_milling_count = 0
        if parameters:
            param_names = [str(k).lower() for k in parameters.keys()]
            turning_terms = ("dia", "diameter", "radius", "rad", "od", "id", "bore", "shaft", "neck", "collar", "turn", "revolve", "groove", "cone", "piston", "flange_dia")
            milling_terms = ("pocket", "slot", "keyway", "flat", "boss", "web", "rib", "hex", "tab", "cutout")
            for name in param_names:
                if any(kw in name for kw in turning_terms):
                    param_turning_count += 1
                if any(kw in name for kw in milling_terms):
                    param_milling_count += 1

        # Script AST / text inspection
        script_has_revolve = False
        if python_script:
            ps_lower = python_script.lower()
            if "revolve" in ps_lower or "cylinder" in ps_lower or "sphere" in ps_lower:
                script_has_revolve = True

        # Check rotational features in feature list
        turning_keywords = ("cylinder", "shaft", "turned", "dia", "bore", "groove", "turn", "thread_od", "thread_id", "facing_turn", "od_turn", "id_turn")
        milling_keywords = ("pocket", "slot", "face", "hole", "contour", "boss", "flat", "step", "keyway", "hex")
        
        turning_feat_count = 0
        milling_feat_count = 0
        tap_count = 0
        drill_count = 0
        
        unique_vectors: List[Tuple[float, float, float]] = []
        has_non_orthogonal_vector = False
        
        for f in features:
            ftype = str(f.get("type", "")).lower()
            if any(kw in ftype for kw in turning_keywords):
                turning_feat_count += 1
            if any(kw in ftype for kw in milling_keywords):
                milling_feat_count += 1
            if "tap" in ftype or "thread" in ftype:
                tap_count += 1
            if "hole" in ftype or "drill" in ftype:
                drill_count += 1
                
            axis = f.get("axis") or f.get("toolAxis") or [0.0, 0.0, 1.0]
            if len(axis) == 3:
                norm = math.sqrt(axis[0]**2 + axis[1]**2 + axis[2]**2) or 1.0
                vec = (round(axis[0]/norm, 2), round(axis[1]/norm, 2), round(axis[2]/norm, 2))
                
                # Check if matches any existing vector within tolerance
                found = False
                for u in unique_vectors:
                    dot = u[0]*vec[0] + u[1]*vec[1] + u[2]*vec[2]
                    if abs(dot) > 0.95:
                        found = True
                        break
                if not found:
                    unique_vectors.append(vec)
                    
                # Check if orthogonal to principal axes
                is_orthogonal = (
                    (abs(abs(vec[0]) - 1.0) < 0.05 and abs(vec[1]) < 0.05 and abs(vec[2]) < 0.05) or
                    (abs(vec[0]) < 0.05 and abs(abs(vec[1]) - 1.0) < 0.05 and abs(vec[2]) < 0.05) or
                    (abs(vec[0]) < 0.05 and abs(vec[1]) < 0.05 and abs(abs(vec[2]) - 1.0) < 0.05)
                )
                if not is_orthogonal:
                    has_non_orthogonal_vector = True

        # Geometric cross-section symmetry (aspect ratio check)
        dims_sorted = sorted([dim_x, dim_y, dim_z])
        is_rotational_geometry = False
        if dims_sorted[0] > 0.5:
            ratio_small_dims = dims_sorted[1] / dims_sorted[0]
            if (ratio_small_dims <= 1.10 or abs(dims_sorted[1] - dims_sorted[0]) <= 2.0) and (param_turning_count >= 1 or script_has_revolve or turning_feat_count > 0 or (stock_dimensions and len(stock_dimensions) == 2)):
                is_rotational_geometry = True

        is_axisymmetric = (
            topology_info.get("is_axisymmetric", False) or 
            (turning_feat_count > 0 and milling_feat_count == 0) or
            (param_turning_count >= 2 and param_milling_count == 0 and milling_feat_count == 0) or
            (script_has_revolve and param_milling_count == 0 and milling_feat_count == 0) or
            (is_rotational_geometry and param_milling_count == 0 and milling_feat_count == 0)
        )
        
        # Determine part type
        if is_axisymmetric:
            part_type = "turned"
            required_axes = 2
            recommended_machine_type = "CNC_LATHE"
            setup_count = 1 if len(unique_vectors) <= 1 else 2
        elif (turning_feat_count > 0 or param_turning_count >= 2 or is_rotational_geometry or script_has_revolve) and (milling_feat_count > 0 or param_milling_count > 0):
            part_type = "mill_turn"
            required_axes = 4
            recommended_machine_type = "MILL_TURN"
            setup_count = 1
        elif has_non_orthogonal_vector:
            part_type = "5axis_complex"
            required_axes = 5
            recommended_machine_type = "MILL_5X_VMC"
            setup_count = 1
        elif len(unique_vectors) > 2:
            # Features on > 2 sides
            part_type = "multi_sided_prismatic"
            required_axes = 4
            recommended_machine_type = "MILL_4X_VMC"
            setup_count = len(unique_vectors)
        elif len(unique_vectors) == 2:
            # 2 setups (e.g. top + bottom flip)
            part_type = "2_sided_prismatic"
            required_axes = 3
            recommended_machine_type = "MILL_3X_VMC"
            setup_count = 2
        else:
            # Standard single setup prismatic
            part_type = "prismatic"
            required_axes = 3
            recommended_machine_type = "MILL_3X_VMC"
            setup_count = 1

        # Check for drill/tap center candidacy (small part with high hole/tap density)
        is_drill_tap_candidate = (
            part_type in ["prismatic", "2_sided_prismatic"] and
            (drill_count + tap_count) >= 4 and
            dim_x <= 500.0 and dim_y <= 400.0 and dim_z <= 300.0
        )


        return {
            "part_type": part_type,
            "dimensions": [dim_x, dim_y, dim_z],
            "required_axes": required_axes,
            "recommended_machine_type": recommended_machine_type,
            "setup_count": setup_count,
            "turning_features": turning_feat_count,
            "milling_features": milling_feat_count,
            "drill_count": drill_count,
            "tap_count": tap_count,
            "approach_vector_count": len(unique_vectors),
            "has_non_orthogonal_vector": has_non_orthogonal_vector,
            "is_drill_tap_candidate": is_drill_tap_candidate,
            "blueprint_notes": blueprint_data.get("notes", []) if blueprint_data else []
        }

    def _score_machine_profiles(self, analysis: Dict[str, Any]) -> List[MachineRecommendation]:
        profiles = self.matrix.get("machineProfiles", [])
        recommendations: List[Tuple[float, MachineRecommendation]] = []
        
        target_mtype = analysis["recommended_machine_type"]
        dim_x, dim_y, dim_z = analysis["dimensions"]
        req_axes = analysis["required_axes"]
        setup_cnt = analysis["setup_count"]
        part_type = analysis["part_type"]
        
        # Machine envelope default lookup for common models if not in JSON
        travel_specs: Dict[str, Tuple[float, float, float]] = {
            "haas_vf2": (762.0, 406.0, 508.0),
            "haas_vf4ss": (1270.0, 508.0, 635.0),
            "mazak_vcn530c": (1050.0, 530.0, 510.0),
            "dmg_cmx1100v": (1100.0, 560.0, 630.0),
            "okuma_genos_m560v": (1050.0, 560.0, 460.0),
            "brother_speedio_s700x2": (700.0, 400.0, 300.0),
            "haas_umc750": (762.0, 508.0, 508.0),
            "dmg_dmu50": (650.0, 520.0, 475.0),
            "mazak_variaxis_c600": (600.0, 600.0, 500.0),
            "haas_st20": (330.0, 330.0, 572.0),
            "mazak_quick_turn_250": (380.0, 380.0, 500.0),
            "dmg_nlx2500": (366.0, 366.0, 705.0),
            "haas_st20y": (300.0, 100.0, 572.0),
            "mazak_integrex_i200": (658.0, 658.0, 1011.0),
            "shapeoko_5_pro": (600.0, 600.0, 100.0),
            "avid_cnc_pro4848": (1200.0, 1200.0, 200.0)
        }

        for prof in profiles:
            pid = prof.get("id", "")
            label = prof.get("label", pid)
            mtype = prof.get("machineType", "MILL_3X_VMC")
            axes = prof.get("axisCount", 3)
            
            # Envelope checks
            default_travel = travel_specs.get(pid, (1000.0, 500.0, 500.0))
            travel = (
                float(prof.get("travelX") or default_travel[0]),
                float(prof.get("travelY") or default_travel[1]),
                float(prof.get("travelZ") or default_travel[2])
            )
            fits_env = (dim_x <= travel[0] and dim_y <= travel[1] and dim_z <= travel[2])

            
            score = 0.0
            reasons = []
            
            # Machine type match
            if mtype == target_mtype:
                score += 0.50
                reasons.append(f"Direct match for {mtype.replace('_', ' ')} workflow")
            elif target_mtype == "MILL_3X_VMC" and mtype in ["MILL_4X_VMC", "MILL_5X_VMC"]:
                score += 0.35
                reasons.append("Higher-axis capability exceeds minimum requirements (cost premium)")
            elif target_mtype == "MILL_4X_VMC" and mtype == "MILL_5X_VMC":
                score += 0.45
                reasons.append("5-axis center can execute 4-axis indexing operations seamlessly")
            elif target_mtype == "CNC_LATHE" and mtype == "MILL_TURN":
                score += 0.40
                reasons.append("Mill-turn center can execute turned part with live tooling flexibility")
            elif target_mtype == "MILL_3X_VMC" and mtype == "DRILL_TAP_CENTER" and analysis["is_drill_tap_candidate"]:
                score += 0.55
                reasons.append("High hole/tap density makes drill/tap center optimal for cycle time")
            else:
                score += 0.10

            # Envelope score & sizing efficiency
            if fits_env:
                score += 0.30
                # Calculate bed utilization ratio (least necessary machine principle)
                bed_volume = travel[0] * travel[1] * travel[2] + 1e-6
                part_volume = dim_x * dim_y * dim_z
                vol_utilization = part_volume / bed_volume

                # Reward optimal sizing: not too cramped (<90% limit), not absurdly oversized (>2% utilization)
                if 0.05 <= vol_utilization <= 0.70:
                    score += 0.15
                    reasons.append(f"Ideal bed utilization ({vol_utilization*100:.1f}%) for part volume")
                elif vol_utilization > 0.70:
                    score += 0.05
                    reasons.append("Close to envelope limits; requires precise fixture planning")
                else:
                    # Oversized machine for tiny part
                    score += 0.02
                    reasons.append("Machine envelope significantly larger than part (usable, but higher overhead)")

                # Specific Lathe Length matching
                if target_mtype == "CNC_LATHE":
                    max_dim = max(dim_x, dim_y, dim_z)
                    if max_dim > 350.0 and travel[2] >= 700.0:
                        score += 0.10
                        reasons.append("Extended Z-travel optimal for long shaft turning")

                reasons.append(f"Part ({dim_x:.0f}×{dim_y:.0f}×{dim_z:.0f}mm) fits in envelope ({travel[0]:.0f}×{travel[1]:.0f}×{travel[2]:.0f}mm)")
            else:
                score -= 0.60
                reasons.append(f"Exceeds machine travel limits ({travel[0]:.0f}×{travel[1]:.0f}×{travel[2]:.0f}mm)")

            # Setup efficiency rationale
            if part_type == "prismatic":
                reasons.append(f"100% of features accessible in 1 setup (Z+)")
            elif part_type == "2_sided_prismatic":
                reasons.append(f"Machinable in 2 setups (Top + Flip)")
            elif part_type == "multi_sided_prismatic":
                if axes >= 4:
                    reasons.append(f"Single setup machining via rotary axis indexing")
                else:
                    reasons.append(f"Requires {setup_cnt} separate setups on 3-axis mill")
            elif part_type == "5axis_complex":
                if axes >= 5:
                    reasons.append(f"Simultaneous 5-axis continuous toolpath accessibility")
                else:
                    reasons.append(f"Cannot machine angled undercut features without 5-axis articulation")
            elif part_type == "mill_turn":
                if "MILL_TURN" in mtype or "LIVE_TOOLING" in mtype:
                    reasons.append(f"Combines OD/ID turning with live milled features in a single setup")

            # Final normalized confidence score
            conf = max(0.05, min(0.99, score))
            
            rec = MachineRecommendation(
                profileId=pid,
                label=label,
                machineType=mtype,
                confidence=round(conf, 2),
                isRecommended=False,
                reason="; ".join(reasons),
                setupCount=setup_cnt if axes < req_axes else 1,
                requiredAxes=req_axes,
                fitsEnvelope=fits_env,
                envelopeDetails=f"{travel[0]:.0f}×{travel[1]:.0f}×{travel[2]:.0f} mm"
            )
            recommendations.append((conf, rec))

        # Sort by score descending
        recommendations.sort(key=lambda x: x[0], reverse=True)
        return [r[1] for r in recommendations]
