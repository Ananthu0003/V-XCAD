import uuid
import math
from typing import List, Dict, Any, Optional
from app.models.schemas import CamSetupPlan, FeatureMachiningInfo, MachineCapability
from app.models.provenance import SetupConfiguration, AccessibilityResult

_ALIGNMENT_THRESHOLD = 0.85

class SetupPlanner:
    """
    Analyzes recognized features and groups them into logical CAM Setups
    based on machine kinematics, multi-stage accessibility analysis, and
    minimum valid set cover.
    """

    def __init__(self):
        pass

    def _increment_wcs(self, base_wcs: str, increment: int) -> str:
        if not base_wcs or not str(base_wcs).startswith("G"):
            base_wcs = "G54"
        try:
            if base_wcs.startswith("G54.1 P"):
                base_p = int(base_wcs.replace("G54.1 P", "").strip())
                return f"G54.1 P{base_p + increment}"
            else:
                num = int(base_wcs.replace("G", ""))
                new_num = num + increment
                if new_num <= 59:
                    return f"G{new_num}"
                else:
                    return f"G54.1 P{new_num - 59}"
        except Exception:
            return f"G{54 + increment}"

    def _get_candidate_configurations(self, caps: MachineCapability, base_axis: List[float]) -> List[SetupConfiguration]:
        """
        Derives candidate setup configurations supported by machine kinematics.
        """
        configs = []
        opposed = [-base_axis[0], -base_axis[1], -base_axis[2]]

        if caps.mill_turn:
            configs.append(SetupConfiguration(
                config_id="config_main_spindle",
                name="Main Spindle (Z+)",
                tool_orientation=base_axis,
                spindle_mode="mill_turn",
                work_offset="G54",
                fixture_side="top",
                approach_vector=base_axis
            ))
            configs.append(SetupConfiguration(
                config_id="config_opposed_spindle",
                name="Opposed Spindle (Z-)",
                tool_orientation=opposed,
                spindle_mode="mill_turn",
                work_offset="G55",
                fixture_side="bottom",
                approach_vector=opposed,
                is_opposed_spindle=True
            ))
            for axis_name, rvec in [("Radial X+", [1.0, 0.0, 0.0]), ("Radial X-", [-1.0, 0.0, 0.0]), ("Radial Y+", [0.0, 1.0, 0.0]), ("Radial Y-", [0.0, -1.0, 0.0])]:
                configs.append(SetupConfiguration(
                    config_id=f"config_{axis_name.lower().replace(' ', '_').replace('+', 'pos').replace('-', 'neg')}",
                    name=axis_name,
                    tool_orientation=rvec,
                    spindle_mode="milling",
                    fixture_side="radial",
                    approach_vector=rvec
                ))
        elif caps.turning and not caps.milling_3axis:
            configs.append(SetupConfiguration(
                config_id="config_main_spindle",
                name="Main Spindle (Z+)",
                tool_orientation=base_axis,
                spindle_mode="turning",
                work_offset="G54",
                fixture_side="top",
                approach_vector=base_axis
            ))
            configs.append(SetupConfiguration(
                config_id="config_opposed_spindle",
                name="Opposed Spindle (Z-)",
                tool_orientation=opposed,
                spindle_mode="turning",
                work_offset="G55",
                fixture_side="bottom",
                approach_vector=opposed,
                is_opposed_spindle=True
            ))
        elif caps.milling_5axis:
            configs.append(SetupConfiguration(
                config_id="config_5axis_primary",
                name="5-Axis Multi-Directional",
                tool_orientation=base_axis,
                spindle_mode="milling",
                work_offset="G54",
                fixture_side="table",
                approach_vector=base_axis
            ))
        elif caps.indexed_4axis or caps.continuous_4axis:
            configs.append(SetupConfiguration(
                config_id="config_top",
                name="Top (Z+)",
                tool_orientation=base_axis,
                spindle_mode="milling",
                work_offset="G54",
                fixture_side="top",
                approach_vector=base_axis
            ))
            configs.append(SetupConfiguration(
                config_id="config_rot_180",
                name="Rotary 180 (Z-)",
                tool_orientation=opposed,
                spindle_mode="milling",
                work_offset="G55",
                rotary_angles={"A": 180.0},
                fixture_side="bottom",
                approach_vector=opposed
            ))
            configs.append(SetupConfiguration(
                config_id="config_rot_90",
                name="Rotary 90 (Y-)",
                tool_orientation=[0.0, -1.0, 0.0],
                spindle_mode="milling",
                work_offset="G56",
                rotary_angles={"A": 90.0},
                fixture_side="side_front",
                approach_vector=[0.0, -1.0, 0.0]
            ))
        else:
            # 3-axis mill with orthogonal vice re-clamping
            configs.append(SetupConfiguration(
                config_id="config_top",
                name="Top (Z+)",
                tool_orientation=base_axis,
                spindle_mode="milling",
                work_offset="G54",
                fixture_side="top",
                approach_vector=base_axis
            ))
            configs.append(SetupConfiguration(
                config_id="config_bottom",
                name="Bottom / Flip (Z-)",
                tool_orientation=opposed,
                spindle_mode="milling",
                work_offset="G55",
                fixture_side="bottom",
                approach_vector=opposed
            ))
            for axis_name, svec in [("Right (X+)", [1.0, 0.0, 0.0]), ("Left (X-)", [-1.0, 0.0, 0.0]), ("Front (Y-)", [0.0, -1.0, 0.0]), ("Back (Y+)", [0.0, 1.0, 0.0])]:
                if svec != base_axis and svec != opposed:
                    configs.append(SetupConfiguration(
                        config_id=f"config_{axis_name.lower().replace(' ', '_').replace('+', 'pos').replace('-', 'neg').replace('(', '').replace(')', '')}",
                        name=axis_name,
                        tool_orientation=svec,
                        spindle_mode="milling",
                        work_offset="G56",
                        fixture_side="side",
                        approach_vector=svec
                    ))
        return configs

    def _evaluate_feature_accessibility(self, feature: Dict[str, Any], config: SetupConfiguration, caps: MachineCapability) -> AccessibilityResult:
        """
        Multi-stage physical accessibility evaluation:
        1. Spindle mode compatibility
        2. Orientation alignment / kinematic capability
        3. Obstruction / through-hole accessibility
        """
        feat_type = str(feature.get("type", "")).lower()
        feat_axis = self._normalize_axis(feature.get("axis") or [0.0, 0.0, 1.0])
        tool_axis = self._normalize_axis(config.tool_orientation)

        # 1. Spindle mode check
        is_turning_feat = any(kw in feat_type for kw in ("dia", "od", "shaft", "cylinder", "turn", "bore", "id", "groove")) or str(feature.get("recommendedOperation", "")).startswith("od_") or str(feature.get("recommendedOperation", "")).startswith("id_")
        if is_turning_feat and config.spindle_mode == "milling" and not caps.mill_turn:
            return AccessibilityResult(accessible=False, reason="SPINDLE_MODE_INCOMPATIBLE: turning feature requires turning spindle")

        if not is_turning_feat and config.spindle_mode == "turning":
            return AccessibilityResult(accessible=False, reason="SPINDLE_MODE_INCOMPATIBLE: milling feature requires milling spindle")

        # 2. 5-Axis machine capability
        if caps.milling_5axis:
            return AccessibilityResult(accessible=True, reason="ACCESSIBLE_VIA_5AXIS", setup_axis=tool_axis)

        # 3. Orientation alignment check
        dot = tool_axis[0] * feat_axis[0] + tool_axis[1] * feat_axis[1] + tool_axis[2] * feat_axis[2]
        is_through_hole = feat_type in ("hole", "blind_hole", "through_hole") and bool(feature.get("is_through", False))

        if dot >= _ALIGNMENT_THRESHOLD:
            return AccessibilityResult(accessible=True, reason="ACCESSIBLE_ALIGNED", setup_axis=tool_axis)
        elif dot <= -_ALIGNMENT_THRESHOLD and is_through_hole:
            return AccessibilityResult(accessible=True, reason="ACCESSIBLE_THROUGH_HOLE_OPPOSING", setup_axis=tool_axis)
        elif dot <= -_ALIGNMENT_THRESHOLD:
            return AccessibilityResult(accessible=False, reason=f"ORIENTATION_INCOMPATIBLE: tool axis {tool_axis} opposes feature face {feat_axis}")
        else:
            return AccessibilityResult(accessible=False, reason=f"ORIENTATION_INCOMPATIBLE: feature axis {feat_axis} is off-axis to tool axis {tool_axis}")

    def plan_setups(
        self,
        features: List[Dict[str, Any]],
        machine_capability: MachineCapability,
        stock_orientation: str = "top_z",
        default_tool_axis: List[float] = [0.0, 0.0, 1.0],
        topology_info: Dict[str, Any] = None,
        base_wcs: str = "G54"
    ) -> List[CamSetupPlan]:
        """
        Groups features into the minimum number of valid setups based on multi-stage
        accessibility analysis and minimum valid set cover.
        """
        base_setup_axis = self._normalize_axis(default_tool_axis)

        # Extract authoritative stock bounds
        bounds = None
        if topology_info and "bounds" in topology_info:
            b = topology_info["bounds"]
            if isinstance(b, dict) and "min" in b and "max" in b:
                bounds = [b["min"][0], b["min"][1], b["min"][2], b["max"][0], b["max"][1], b["max"][2]]
            elif isinstance(b, (list, tuple)) and len(b) >= 6:
                bounds = list(b)

        if not bounds:
            feat_zs = [float(f.get("dimensions", {}).get("z_top", 0.0)) for f in features if isinstance(f, dict)]
            stock_top = max(feat_zs) if feat_zs else 0.0
            bounds = [0.0, 0.0, stock_top - 50.0, 0.0, 0.0, stock_top]

        ox = (bounds[0] + bounds[3]) / 2.0
        oy = (bounds[1] + bounds[4]) / 2.0
        stock_top_z = bounds[5]
        stock_bottom_z = bounds[2]

        # 1. Derive candidate configurations from machine capability
        candidates = self._get_candidate_configurations(machine_capability, base_setup_axis)

        # 2. Build accessibility matrix
        access_matrix: Dict[str, Dict[str, AccessibilityResult]] = {}
        for feat in features:
            fid = feat.get("id")
            if not fid or not feat.get("requiredMachining", True):
                continue
            access_matrix[fid] = {}
            for cfg in candidates:
                access_matrix[fid][cfg.config_id] = self._evaluate_feature_accessibility(feat, cfg, machine_capability)

        # 3. Solve Minimum Valid Set Cover
        uncovered = set(access_matrix.keys())
        selected_configs: List[SetupConfiguration] = []

        while uncovered:
            best_cfg = None
            best_covered: set = set()
            for cfg in candidates:
                covered = {fid for fid in uncovered if access_matrix[fid][cfg.config_id].accessible}
                # Prefer primary/top setup if equal coverage
                if len(covered) > len(best_covered) or (len(covered) == len(best_covered) and len(covered) > 0 and cfg.fixture_side == "top"):
                    best_covered = covered
                    best_cfg = cfg

            if not best_cfg or len(best_covered) == 0:
                # Features remaining cannot be machined in any supported configuration
                for fid in uncovered:
                    f = next((x for x in features if x.get("id") == fid), None)
                    if f:
                        f["status"] = "unsupported"
                        f["blocked_reason"] = "UNSUPPORTED_FEATURE_ORIENTATION: feature orientation not accessible in any supported machine setup configuration"
                break

            selected_configs.append(best_cfg)
            uncovered -= best_covered

        # Fallback: if no features or no configurations selected, provide default primary setup
        if not selected_configs:
            selected_configs = [candidates[0]]

        # 4. Instantiate CamSetupPlan for each selected configuration
        setups: List[CamSetupPlan] = []
        assigned_feat_set: set = set()

        for idx, cfg in enumerate(selected_configs):
            sid = f"setup_{uuid.uuid4().hex[:8]}"
            tax = cfg.tool_orientation

            # Setup coordinate transform
            if tax == [0.0, 0.0, 1.0]:
                setup_transform = [
                    [1.0,  0.0,  0.0, -ox],
                    [0.0,  1.0,  0.0, -oy],
                    [0.0,  0.0,  1.0, -stock_top_z],
                    [0.0,  0.0,  0.0,  1.0]
                ]
            elif tax == [0.0, 0.0, -1.0]:
                setup_transform = [
                    [1.0,  0.0,  0.0, -ox],
                    [0.0, -1.0,  0.0,  oy],
                    [0.0,  0.0, -1.0,  stock_bottom_z],
                    [0.0,  0.0,  0.0,  1.0]
                ]
            elif tax == [1.0, 0.0, 0.0]:
                setup_transform = [
                    [0.0,  0.0, -1.0,  bounds[3]],
                    [0.0,  1.0,  0.0, -oy],
                    [1.0,  0.0,  0.0, -ox],
                    [0.0,  0.0,  0.0,  1.0]
                ]
            elif tax == [-1.0, 0.0, 0.0]:
                setup_transform = [
                    [0.0,  0.0,  1.0, -bounds[0]],
                    [0.0,  1.0,  0.0, -oy],
                    [-1.0, 0.0,  0.0,  ox],
                    [0.0,  0.0,  0.0,  1.0]
                ]
            else:
                setup_transform = [
                    [1.0,  0.0,  0.0, -ox],
                    [0.0,  1.0,  0.0, -oy],
                    [0.0,  0.0,  1.0, -stock_top_z],
                    [0.0,  0.0,  0.0,  1.0]
                ]

            # Authoritative Setup Space Stock Bounds
            dx = abs(float(bounds[3]) - float(bounds[0]))
            dy = abs(float(bounds[4]) - float(bounds[1]))
            dz = abs(float(stock_top_z) - float(stock_bottom_z))
            
            setup_space_stock = {
                "bounds": {
                    "min": [-dx / 2.0, -dy / 2.0, -dz],
                    "max": [dx / 2.0, dy / 2.0, 0.0]
                },
                "dimensions": [dx, dy, dz],
                "center": [0.0, 0.0, -dz / 2.0],
                "stockType": "box"
            }

            plan = CamSetupPlan(
                setupId=sid,
                setupName=f"Setup {idx + 1} ({cfg.name})",
                setupType=cfg.spindle_mode,
                toolAxis=tax,
                workCoordinateSystem=self._increment_wcs(base_wcs, idx),
                requiresManualReclamp=cfg.fixture_side != "top" and not cfg.is_opposed_spindle,
                requires4AxisIndexing=bool(cfg.rotary_angles),
                stockTopZ=stock_top_z,
                stockBottomZ=stock_bottom_z,
                modelToSetupTransform=setup_transform,
                resolvedStock=setup_space_stock,
                assignedFeatureIds=[],
                unassignedFeatureIds=[]
            )

            # Assign features accessible in this setup
            for fid, res_map in access_matrix.items():
                if fid not in assigned_feat_set:
                    if res_map.get(cfg.config_id) and res_map[cfg.config_id].accessible:
                        plan.assignedFeatureIds.append(fid)
                        assigned_feat_set.add(fid)
                        feat = next((x for x in features if x.get("id") == fid), None)
                        if feat:
                            feat["machinable_in_current_setup"] = (idx == 0)
                            feat["machining_info"] = {
                                "featureId": fid,
                                "featureType": feat.get("type", "generic"),
                                "setupId": sid,
                                "status": "machinable_in_active_setup" if idx == 0 else "machinable_in_secondary_setup",
                                "toolAxis": tax,
                                "requiresSecondarySetup": (idx > 0)
                            }

            setups.append(plan)

        # Record unassigned features
        all_feature_ids = [f.get("id") for f in features if f.get("id")]
        for feat in features:
            fid = feat.get("id")
            if fid and fid not in assigned_feat_set:
                feat["machinable_in_current_setup"] = False
                if setups:
                    setups[0].unassignedFeatureIds.append(fid)

        for plan in setups:
            plan.allFeatureIds = all_feature_ids

        return setups

    def _normalize_axis(self, axis: List[float]) -> List[float]:
        """Ensures axis is a unit vector."""
        if not axis or len(axis) != 3:
            return [0.0, 0.0, 1.0]
        length = math.sqrt(sum(v*v for v in axis))
        if length < 1e-6:
            return [0.0, 0.0, 1.0]
        return [round(v / length, 4) for v in axis]

    def _format_axis_key(self, axis: List[float]) -> str:
        if not axis or len(axis) != 3:
            return "0.000,0.000,1.000"
        vals = [round(v, 3) + 0.0 for v in axis]
        return f"{vals[0]:.3f},{vals[1]:.3f},{vals[2]:.3f}"

    def _axis_alignment(self, axis1: List[float], axis2: List[float]) -> float:
        """Returns dot product of two normalized axes."""
        a1 = self._normalize_axis(axis1)
        a2 = self._normalize_axis(axis2)
        return sum(v1 * v2 for v1, v2 in zip(a1, a2))

    def _get_axis_name(self, axis: List[float]) -> str:
        """Helper to name common axes."""
        ax = [round(v, 2) for v in axis]
        if ax == [0.0, 0.0, 1.0]: return "Top +Z"
        if ax == [0.0, 0.0, -1.0]: return "Bottom -Z"
        if ax == [1.0, 0.0, 0.0]: return "Right +X"
        if ax == [-1.0, 0.0, 0.0]: return "Left -X"
        if ax == [0.0, 1.0, 0.0]: return "Front +Y"
        if ax == [0.0, -1.0, 0.0]: return "Back -Y"
        return f"Custom [{ax[0]}, {ax[1]}, {ax[2]}]"
