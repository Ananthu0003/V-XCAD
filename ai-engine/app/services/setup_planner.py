import uuid
import math
from typing import List, Dict, Any, Optional
from app.models.schemas import CamSetupPlan, FeatureMachiningInfo, MachineCapability

_ALIGNMENT_THRESHOLD = 0.98

class SetupPlanner:
    """
    Analyzes recognized features and groups them into logical CAM Setups
    based on the machine's capabilities and the required machining direction.
    """

    def __init__(self):
        pass

    def plan_setups(
        self,
        features: List[Dict[str, Any]],
        machine_capability: MachineCapability,
        stock_orientation: str = "top_z",
        default_tool_axis: List[float] = [0.0, 0.0, 1.0]
    ) -> List[CamSetupPlan]:
        """
        Groups features into one or more setups.
        """
        
        base_setup_axis = self._normalize_axis(default_tool_axis)
        
        setups: Dict[str, CamSetupPlan] = {}
        
        # We start with a default Setup 1
        default_setup_id = f"setup_{uuid.uuid4().hex[:8]}"
        base_axis_key = self._format_axis_key(base_setup_axis)
        base_setup_key = f"milling_3axis:{base_axis_key}:top"
        
        setups[base_setup_key] = CamSetupPlan(
            setupId=default_setup_id,
            setupName="Setup 1 (Top)",
            setupType="milling_3axis",
            toolAxis=base_setup_axis,
            workCoordinateSystem="G54"
        )
        
        setup_counter = 1
        
        for feature in features:
            if not feature.get('requiredMachining', True):
                continue
                
            feat_id = feature.get('id')
            if not feat_id:
                continue

            info = self._analyze_feature_direction(feature, machine_capability, base_setup_axis)
            feature['machining_info'] = info.model_dump()
            
            # Map legacy fields for backwards compatibility temporarily
            feature['machinable_in_current_setup'] = info.machinableInCurrentSetup
            feature['requires_reorientation'] = info.requiresSecondarySetup
            feature['requires_4axis_or_secondary_setup'] = info.requires4Axis
            feature['blocked_reason'] = info.reason

            if info.status == "unsupported":
                continue
                
            required_axis = info.requiredSetupAxis or base_setup_axis
            required_axis_key = self._format_axis_key(required_axis)
            
            # Determine setup type based on capability
            if info.status == "requires_turning":
                stype = "turning"
            elif info.status == "requires_4axis_indexing":
                stype = "indexed_4axis"
            else:
                stype = "milling_3axis"
                
            fixtureSide = "top" if required_axis_key == base_axis_key else "side"
            setup_key = f"{stype}:{required_axis_key}:{fixtureSide}"
            
            if setup_key not in setups:
                setup_counter += 1
                new_setup_id = f"setup_{uuid.uuid4().hex[:8]}"
                
                setups[setup_key] = CamSetupPlan(
                    setupId=new_setup_id,
                    setupName=f"Setup {setup_counter} ({self._get_axis_name(required_axis)})",
                    setupType=stype,
                    toolAxis=required_axis,
                    workCoordinateSystem=f"G{53 + min(setup_counter, 6)}",
                    requiresManualReclamp=not machine_capability.indexed_4axis and stype == "milling_3axis",
                    requires4AxisIndexing=machine_capability.indexed_4axis and stype == "indexed_4axis"
                )
                
            setups[setup_key].assignedFeatureIds.append(feat_id)

        # Update feature['machining_info'] with the final setupId
        for setup_key, plan in setups.items():
            for feat_id in plan.assignedFeatureIds:
                feat = next((f for f in features if f.get('id') == feat_id), None)
                if feat and 'machining_info' in feat:
                    feat['machining_info']['setupId'] = plan.setupId

        # Convert to list and sort (put default setup first)
        plan_list = list(setups.values())
        plan_list.sort(key=lambda s: 0 if self._format_axis_key(s.toolAxis) == base_axis_key else 1)
        
        return plan_list

    def _analyze_feature_direction(
        self, 
        feature: Dict[str, Any], 
        caps: MachineCapability,
        base_tool_axis: List[float]
    ) -> FeatureMachiningInfo:
        """Determines the required machining direction for a single feature."""
        feat_id = feature.get("id", "unknown")
        feat_type = feature.get("type", "")
        feat_axis = feature.get("axis")
        
        info = FeatureMachiningInfo(
            featureId=feat_id,
            featureType=feat_type,
            featureAxis=feat_axis
        )
        
        # 1. Determine preferred tool axis based on feature type
        if feat_type in ("hole", "blind_hole", "through_hole"):
            if feat_axis:
                info.preferredToolAxis = self._normalize_axis(feat_axis)
            else:
                info.preferredToolAxis = base_tool_axis
        elif feat_type in ("pocket", "face", "contour", "step", "boss"):
            if feat_axis:
                info.preferredToolAxis = self._normalize_axis(feat_axis)
            else:
                info.preferredToolAxis = base_tool_axis
        elif feat_type in ("side_shaft", "external_cylinder"):
            info.requiresTurning = True
        else:
            info.preferredToolAxis = base_tool_axis

        # 2. Check capabilities
        if info.requiresTurning:
            if caps.turning or caps.mill_turn:
                info.status = "requires_turning"
                info.machinableInCurrentSetup = False
                info.requiredSetupAxis = info.preferredToolAxis or base_tool_axis
                return info
            else:
                info.status = "unsupported"
                info.reason = f"{feat_type} requires turning capability"
                info.machinableInCurrentSetup = False
                return info
            
        if feat_type in ("hole", "blind_hole", "through_hole") and not caps.drilling:
            info.status = "unsupported"
            info.reason = "Drilling capability not available"
            info.machinableInCurrentSetup = False
            return info
            
        if feat_type in ("pocket", "face", "boss") and not caps.pocketing:
            info.status = "unsupported"
            info.reason = "Pocketing capability not available"
            info.machinableInCurrentSetup = False
            return info

        # 3. Check alignment with base setup
        if info.preferredToolAxis:
            signed_alignment = self._axis_alignment(info.preferredToolAxis, base_tool_axis)
            abs_alignment = abs(signed_alignment)
            
            # Special handling for holes: use bidirectional alignment
            is_hole = feat_type in ("hole", "blind_hole", "through_hole")
            
            if is_hole and abs_alignment >= _ALIGNMENT_THRESHOLD:
                # Hole axis is aligned (either +Z or -Z). Use entry face to decide setup.
                entry_result = self._detect_entry_face(feature, base_tool_axis)
                
                if entry_result:
                    assigned_axis = entry_result["assignedToolAxis"]
                    entry_alignment = self._axis_alignment(assigned_axis, base_tool_axis)
                    
                    if entry_alignment >= _ALIGNMENT_THRESHOLD:
                        # Entry face reachable from active/base setup
                        info.status = "machinable_in_active_setup"
                        info.machinableInCurrentSetup = True
                        info.requiredSetupAxis = base_tool_axis
                    else:
                        # Entry face requires opposite/different setup
                        info.status = "machinable_in_secondary_setup"
                        info.machinableInCurrentSetup = False
                        info.requiresSecondarySetup = True
                        info.requiredSetupAxis = assigned_axis
                        info.reason = f"Hole entry face requires setup with tool axis {self._get_axis_name(assigned_axis)}"
                else:
                    # No entry face detected — default to active setup
                    info.status = "machinable_in_active_setup"
                    info.machinableInCurrentSetup = True
                    info.requiredSetupAxis = base_tool_axis
                    
            elif abs_alignment >= _ALIGNMENT_THRESHOLD:
                # Non-hole feature, aligned (signed or unsigned)
                if signed_alignment >= _ALIGNMENT_THRESHOLD:
                    info.status = "machinable_in_active_setup"
                    info.machinableInCurrentSetup = True
                    info.requiredSetupAxis = base_tool_axis
                else:
                    # Opposite direction (e.g. face pointing -Z)
                    info.status = "machinable_in_secondary_setup"
                    info.machinableInCurrentSetup = False
                    info.requiresSecondarySetup = True
                    info.requiredSetupAxis = info.preferredToolAxis
                    info.reason = "Feature requires opposite setup orientation"
            else:
                info.machinableInCurrentSetup = False
                info.requiredSetupAxis = info.preferredToolAxis
                
                if abs_alignment < 0.1:
                    info.requires4Axis = True
                    if caps.indexed_4axis or caps.continuous_4axis:
                        info.status = "requires_4axis_indexing"
                        info.reason = "Requires 4-axis indexing"
                    else:
                        info.status = "machinable_in_secondary_setup"
                        info.requiresSecondarySetup = True
                        info.reason = "Requires secondary setup (reclamping)"
                else:
                    if caps.milling_5axis:
                        info.status = "machinable_in_secondary_setup"
                        info.reason = "Requires 5-axis positioning"
                    else:
                        info.status = "machinable_in_secondary_setup"
                        info.requiresSecondarySetup = True
                        info.reason = "Requires secondary setup (custom fixture)"
        else:
            info.requiredSetupAxis = base_tool_axis
            info.status = "machinable_in_active_setup"

        return info

    def _detect_entry_face(
        self,
        feature: Dict[str, Any],
        base_tool_axis: List[float]
    ) -> Optional[Dict[str, Any]]:
        """
        Detect which face the drill enters from, for both through and blind holes.
        
        For through holes: pick the entry face reachable from active setup if possible.
        For blind holes: the open end (non-bottom face) is the entry.
        
        Returns dict with entryFaceId, entryNormal, assignedToolAxis, reason.
        Returns None if no entry faces found.
        """
        possible_entries = feature.get("possibleEntryFaces", [])
        if not possible_entries:
            return None
        
        hole_axis = self._normalize_axis(feature.get("axis", [0, 0, 1]))
        subtype = feature.get("subtype", "through_hole")
        
        # For blind holes: the entry face is the one whose normal points
        # in the opposite direction of the hole's closed end (bottom).
        # For through holes: prefer the entry face reachable from the active setup.
        
        # Score each entry face: higher score = better match to active setup
        best_entry = None
        best_score = -2.0
        
        for ef in possible_entries:
            ef_normal = ef.get("normal", [0, 0, 0])
            # The tool axis needed to enter from this face is the INWARD normal
            # (opposite of the face's outward normal)
            inward_normal = [-n for n in ef_normal]
            inward_norm = self._normalize_axis(inward_normal)
            
            # How well does this entry align with the base (active) tool axis?
            alignment_to_base = self._axis_alignment(inward_norm, base_tool_axis)
            
            if alignment_to_base > best_score:
                best_score = alignment_to_base
                best_entry = {
                    "entryFaceId": ef.get("faceId"),
                    "entryNormal": ef_normal,
                    "assignedToolAxis": inward_norm,
                    "reason": f"Entry face normal {ef_normal} -> tool axis {inward_norm}, alignment to base = {alignment_to_base:.3f}"
                }
        
        return best_entry

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
        # Round and fix negative zero
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
