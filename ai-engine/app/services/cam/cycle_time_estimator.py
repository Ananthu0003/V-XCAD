import math
from typing import List, Dict, Any, Tuple
from app.models.schemas import ToolpathSegment, ToolpathSegmentType
from app.models.manufacturing import MachineProfile, ToolProfile
from app.models.timing_profiles import (
    OperationPenaltyProfile, MaterialMachiningProfile, ToolPerformanceProfile,
    MachineTimingProfile, SetupHandlingProfile, CoolantTimingProfile, ProbeTimingProfile
)
from app.models.cycle_time import OperationTimeBreakdown

class CycleTimeEstimator:
    """Estimates machining time based on generated toolpath segments and engineering profiles."""
    
    @staticmethod
    def get_operation_penalty(op_type: str) -> float:
        """Fetch inefficiency penalty based on operation type."""
        # Using a default OperationPenaltyProfile instance
        profile = OperationPenaltyProfile()
        modifiers = profile.modifiers
        
        op_type_lower = op_type.lower()
        if "face" in op_type_lower: return modifiers.get("facing", 1.10)
        if "adaptive" in op_type_lower: return modifiers.get("adaptive_pocket", 1.05)
        if "pocket" in op_type_lower: return modifiers.get("pocket", 1.25)
        if "contour" in op_type_lower or "profile" in op_type_lower: return modifiers.get("contour", 1.15)
        if "drill" in op_type_lower and "deep" in op_type_lower: return modifiers.get("deep_drilling", 1.30)
        if "drill" in op_type_lower: return modifiers.get("drilling", 1.05)
        if "helic" in op_type_lower: return modifiers.get("helical_milling", 1.10)
        if "bore" in op_type_lower or "boring" in op_type_lower: return modifiers.get("boring", 1.05)
        if "chamf" in op_type_lower: return modifiers.get("chamfering", 1.10)
        if "thread" in op_type_lower: return modifiers.get("thread_milling", 1.20)
        
        return 1.15 # Fallback

    @staticmethod
    def calculate_distance(segment: ToolpathSegment) -> float:
        if segment.moveType in [ToolpathSegmentType.ARC_CW, ToolpathSegmentType.ARC_CCW] and segment.center and segment.radius:
            dx1 = segment.start.x - segment.center.x
            dy1 = segment.start.y - segment.center.y
            dx2 = segment.end.x - segment.center.x
            dy2 = segment.end.y - segment.center.y
            
            angle1 = math.atan2(dy1, dx1)
            angle2 = math.atan2(dy2, dx2)
            
            angle_diff = angle2 - angle1
            if segment.moveType == ToolpathSegmentType.ARC_CCW:
                if angle_diff <= 0:
                    angle_diff += 2 * math.pi
            else: # ARC_CW
                if angle_diff >= 0:
                    angle_diff -= 2 * math.pi
            
            dz = segment.end.z - segment.start.z
            arc_length_xy = abs(angle_diff) * segment.radius
            return math.sqrt(arc_length_xy**2 + dz**2)
        else:
            dx = segment.end.x - segment.start.x
            dy = segment.end.y - segment.start.y
            dz = segment.end.z - segment.start.z
            return math.sqrt(dx**2 + dy**2 + dz**2)

    @classmethod
    def estimate_segment_time(cls, segment: ToolpathSegment, machine_profile: MachineProfile) -> Tuple[float, str]:
        """
        Calculate estimated time in seconds for a single toolpath segment.
        Returns: (time_seconds, category)
        Categories: "cut", "rapid", "air_cut"
        """
        rapid_feedrate_mms = machine_profile.rapid_feedrate / 60.0
        feedrate_mms = (segment.feedrate / 60.0) if (segment.feedrate and segment.feedrate > 0) else rapid_feedrate_mms

        # Check move type
        category = "cut"
        if segment.moveType in [ToolpathSegmentType.RAPID_CLEARANCE, ToolpathSegmentType.RAPID_XY]:
            effective_feedrate = rapid_feedrate_mms
            category = "rapid"
        elif segment.moveType in [ToolpathSegmentType.APPROACH_RETRACT, ToolpathSegmentType.RETRACT_CLEARANCE]:
            effective_feedrate = rapid_feedrate_mms
            category = "air_cut"
        elif segment.moveType in [ToolpathSegmentType.CUT, ToolpathSegmentType.PLUNGE, ToolpathSegmentType.DRILL_CYCLE, ToolpathSegmentType.ARC_CW, ToolpathSegmentType.ARC_CCW]:
            effective_feedrate = feedrate_mms
            # Additional logic for air cut classification based on segment role
            if segment.segmentRole in ["lead_in", "lead_out", "retract"]:
                category = "air_cut"
        else:
            effective_feedrate = feedrate_mms
            
        dist = cls.calculate_distance(segment)
        if effective_feedrate <= 0:
            return (0.0, category)

        return (dist / effective_feedrate, category)

    @classmethod
    def estimate_operation_time(cls, segments: List[ToolpathSegment], machine_profile: MachineProfile, op_id: str = "") -> OperationTimeBreakdown:
        """Calculate total estimated time in seconds for an operation from its segments."""
        breakdown = OperationTimeBreakdown(operation_id=op_id, operation_type="toolpath_execution")
        
        for seg in segments:
            t, cat = cls.estimate_segment_time(seg, machine_profile)
            if cat == "cut": breakdown.cutting_time_seconds += t
            elif cat == "rapid": breakdown.rapid_time_seconds += t
            elif cat == "air_cut": breakdown.air_cutting_time_seconds += t
            breakdown.total_seconds += t
            
        return breakdown

    @classmethod
    def resolve_feeds_and_speeds(cls, params: Dict[str, Any], mat_profile: MaterialMachiningProfile, tool_diameter: float = 10.0, flutes: int = 4) -> Tuple[float, float, float]:
        """Resolves (feed_rate, stepover, stepdown) based on requested values or material profiles."""
        fs = params.get("feeds_and_speeds", {})
        feed_rate_val = fs.get("feedrate_mm_min") or fs.get("feed_rate") or params.get("feedRate")
        stepover_val = fs.get("stepover") or params.get("stepover")
        stepdown_val = fs.get("stepdown") or params.get("maxStepdown") or params.get("stepdown")
        # Load Material Profile
        # Handled externally now, passed as argument
        
        # Calculate ideal params
        rpm = (mat_profile.surface_speed_m_min * 1000) / (math.pi * tool_diameter) if tool_diameter > 0 else 5000.0
        ideal_feed = rpm * flutes * mat_profile.chip_load_mm
        ideal_stepover = tool_diameter * (mat_profile.recommended_stepover_pct / 100.0)
        ideal_stepdown = tool_diameter * (mat_profile.recommended_stepdown_pct / 100.0)
        
        feed = float(feed_rate_val) if feed_rate_val is not None and float(feed_rate_val) > 0 else ideal_feed
        stepover = float(stepover_val) if stepover_val is not None and float(stepover_val) > 0 else max(ideal_stepover, 1.0)
        stepdown = float(stepdown_val) if stepdown_val is not None and float(stepdown_val) > 0 else max(ideal_stepdown, 1.0)
        
        return feed, stepover, stepdown

    @classmethod
    def apply_mrr_limits(cls, requested_mrr: float, tool_mrr: float, machine_mrr: float) -> float:
        """Calculates Actual MRR based on physical limits."""
        return min(requested_mrr, tool_mrr, machine_mrr)

    @classmethod
    def estimate_operation_time_parametric(
        cls, 
        operation: Dict[str, Any], 
        feature: Dict[str, Any], 
        setup: Dict[str, Any],
        machine_profile: MachineProfile
    ) -> OperationTimeBreakdown:
        """
        Estimate operation time parametrically using Volume, Area, and MRR.
        Provides an approximate cycle time before toolpaths are generated.
        Returns an OperationTimeBreakdown.
        """
        if setup is None: setup = {}
            
        op_type = operation.get("type", "").lower()
        feat_type = feature.get("type", "").lower()
        params = operation.get("parameters", {})
        
        op_id = operation.get("id", "param_op")
        breakdown = OperationTimeBreakdown(operation_id=op_id, operation_type=op_type)
        
        dims = feature.get("dimensions", {})
        depth = float(feature.get("depth") or dims.get("depth") or 10.0)
        width = float(feature.get("width") or dims.get("width") or 50.0)
        length = float(feature.get("length") or dims.get("length") or 50.0)
        diameter = float(feature.get("diameter") or dims.get("diameter") or 10.0)
        
        tool_diameter = diameter # simplified mapping
        flutes = operation.get("tool", {}).get("flute_count") or 4
        
        # Get Material and Feeds
        material_cat = setup.get("material", "aluminum")
        mat_profile = MaterialMachiningProfile(material_category=material_cat)
        feed_rate, stepover, stepdown = cls.resolve_feeds_and_speeds(params, mat_profile, tool_diameter, flutes)
        
        # MRR calculation
        requested_mrr = feed_rate * stepover * stepdown # mm^3/min
        
        # Determine Limits
        tool_perf = ToolPerformanceProfile()
        tool_mrr_limit = tool_perf.max_recommended_mrr_cm3_min * 1000.0 # to mm^3/min
        
        # Machine limit based on Spindle Power (approximation: MRR (cm3/min) = Power (kW) / Specific Cutting Force)
        spfc = mat_profile.specific_cutting_force_n_mm2 / 1000.0 # Convert N/mm2 to kW/cm3/min approx
        if spfc <= 0: spfc = 0.7
        spindle_power = getattr(machine_profile, "spindle_power_kw", 15.0)
        machine_mrr_limit = (spindle_power / spfc) * 1000.0 * 1000.0 # cm3/min to mm3/min approx conversion
        
        actual_mrr = cls.apply_mrr_limits(requested_mrr, tool_mrr_limit, machine_mrr_limit)
        # Adjust feed rate backwards from MRR
        actual_feed_rate = actual_mrr / (stepover * stepdown) if stepover > 0 and stepdown > 0 else feed_rate
        
        # Depth cuts parameters
        depth_cuts_enabled = params.get("depthCutsEnabled", True)
        finish_cuts = int(params.get("finishCuts") or 0)
        
        # Extract stock dimensions if available
        stock_z = 0.0
        stock_dims = setup.get("stockDimensions")
        if stock_dims and isinstance(stock_dims, list) and len(stock_dims) >= 3:
            stock_z = float(stock_dims[2])
            
        model_z = setup.get("estimated_model_z", depth)
        stock_allowance = max(0.0, stock_z - model_z)
            
        estimated_time = 0.0
        
        if "drill" in op_type or "hole" in feat_type:
            clearance = 5.0
            total_z = depth + clearance + stock_allowance
            if tool_diameter > 0 and depth > tool_diameter * 3:
                peck_count = depth / tool_diameter
                total_z += peck_count * clearance * 2 
            estimated_time = (total_z / actual_feed_rate) * 60.0 
            
        elif "face" in op_type or "face" in feat_type:
            area = length * width
            if area <= 0 and tool_diameter > 0:
                area = math.pi * (tool_diameter / 2.0) ** 2
            distance = area / stepover
            base_time = (distance / actual_feed_rate) * 60.0
            
            material_to_remove = depth
            if stock_allowance > 0:
                material_to_remove = stock_allowance + (0.5 if depth <= 0 else depth)
                
            passes = 1
            if depth_cuts_enabled:
                target_rough_mat = material_to_remove
                rough_passes = 0
                if target_rough_mat > 0:
                    rough_passes = max(1, math.ceil(target_rough_mat / stepdown))
                passes = rough_passes + finish_cuts
            
            estimated_time = base_time * passes
            
        elif "pocket" in op_type or "pocket" in feat_type:
            effective_depth = depth + stock_allowance
            volume = length * width * effective_depth
            if volume <= 0 and tool_diameter > 0:
                volume = math.pi * (tool_diameter / 2.0) ** 2 * effective_depth
            
            if actual_mrr > 0:
                estimated_time = (volume / actual_mrr) * 60.0
                
        elif "contour" in op_type or "profile" in op_type:
            perimeter = 2 * (length + width)
            if perimeter <= 0 and tool_diameter > 0:
                perimeter = math.pi * tool_diameter
            
            passes = 1
            if depth_cuts_enabled:
                target_rough = depth
                rough_passes = 0
                if target_rough > 0:
                    rough_passes = max(1, math.ceil(target_rough / stepdown))
                passes = rough_passes + finish_cuts
                
            distance = perimeter * passes
            estimated_time = (distance / actual_feed_rate) * 60.0
            
        else:
            distance = (length + width + depth) * 2
            estimated_time = (distance / actual_feed_rate) * 60.0
            
        penalty = cls.get_operation_penalty(op_type)
        total_time = estimated_time * penalty
        
        op_prof = OperationPenaltyProfile()
        
        # Break down total time for parametric
        breakdown.cutting_time_seconds = total_time * op_prof.parametric_cutting_split
        breakdown.air_cutting_time_seconds = total_time * op_prof.parametric_aircut_split
        breakdown.rapid_time_seconds = total_time * op_prof.parametric_rapid_split
        breakdown.total_seconds = total_time
        
        return breakdown

    @classmethod
    def estimate_setup_time(
        cls, 
        operations: List[Dict[str, Any]], 
        machine_profile: MachineProfile, 
        features_dict: Dict[str, Dict[str, Any]] = None, 
        setup: Dict[str, Any] = None
    ) -> Dict[str, Any]:
        """
        Calculate total estimated time for a setup, including tool changes and handling.
        Reads timing values from setup and handling profiles.
        """
        if features_dict is None: features_dict = {}
        if setup is None: setup = {}
        
        setup_prof = SetupHandlingProfile()
        coolant_prof = CoolantTimingProfile()
        probe_prof = ProbeTimingProfile()
        
        t_cutting = 0.0
        t_rapid = 0.0
        t_air_cut = 0.0
        t_spindle = 0.0
        t_coolant = 0.0
        t_probe = 0.0
        t_machine_actions = 0.0
        t_dwell = 0.0
        
        tool_changes = 0
        current_tool = None
        
        for op in operations:
            op_time = op.get('estimated_time_s', 0.0)
            
            # Parametric estimate if toolpaths absent
            if op_time <= 0.0:
                feat_id = op.get("feature_id") or op.get("featureId")
                feat = features_dict.get(feat_id, {})
                if "estimated_model_z" not in setup and features_dict:
                    max_z = max([float(f.get("depth") or 0.0) for f in features_dict.values()] + [0.1])
                    setup["estimated_model_z"] = max_z
                    
                breakdown = cls.estimate_operation_time_parametric(op, feat, setup, machine_profile)
                
                t_cutting += breakdown.cutting_time_seconds
                t_rapid += breakdown.rapid_time_seconds
                t_air_cut += breakdown.air_cutting_time_seconds
                op_time = breakdown.total_seconds
                op["estimated_time_s"] = op_time
                op["breakdown"] = breakdown.model_dump()
            else:
                # If toolpaths exist, we'd sum up the actual parsed breakdown. 
                # Assuming `breakdown` might be stored in `op` in a real scenario.
                bkd = op.get("breakdown", {})
        
                op_prof = OperationPenaltyProfile()
                t_cutting += bkd.get("cutting_time_seconds", op_time * op_prof.parametric_cutting_split)
                t_rapid += bkd.get("rapid_time_seconds", op_time * op_prof.parametric_rapid_split)
                t_air_cut += bkd.get("air_cutting_time_seconds", op_time * op_prof.parametric_aircut_split)

            # Spindle Start/Stop Delay
            t_spindle += getattr(machine_profile, "spindle_orient_time", 1.0) + getattr(machine_profile, "spindle_stop_time", 2.0)
            
            # Coolant
            if op.get("parameters", {}).get("coolant") != "none":
                t_coolant += coolant_prof.coolant_start_delay_seconds + coolant_prof.coolant_stop_delay_seconds
                
            # Probing (if probing op)
            op_type = op.get("type", "").lower()
            if "probe" in op_type:
                t_probe += probe_prof.workpiece_probe_cycle_seconds
                
            # Check for tool change
            op_tool = op.get('tool_id') or op.get('toolId')
            if op_tool and current_tool and op_tool != current_tool:
                tool_changes += 1
            if op_tool:
                current_tool = op_tool
                
        tc_time = machine_profile.tool_change_time
        # Refine Tool Change with ATC parameters if available
        if hasattr(machine_profile, "atc_type"):
            tc_time = (
                getattr(machine_profile, "spindle_orient_time", 1.0) +
                getattr(machine_profile, "magazine_indexing_time", 0.5) * 2 + 
                getattr(machine_profile, "clamp_unclamp_time", 1.5)
            )
            
        t_toolchange = tool_changes * tc_time
        
        # Handling Time
        load_t = setup_prof.load_time_seconds if setup_prof.load_time_seconds is not None else 15.0
        unload_t = setup_prof.unload_time_seconds if setup_prof.unload_time_seconds is not None else 10.0
        handling_time = load_t + unload_t
        if setup.get("requires_flip", False):
            handling_time += setup_prof.reorientation_time_seconds if setup_prof.reorientation_time_seconds is not None else 20.0
            
        setup_prep_time = setup_prof.initial_setup_time_seconds if setup_prof.initial_setup_time_seconds is not None else 180.0
        
        t_bar_feed = setup_prof.bar_feed_time_seconds if getattr(setup_prof, "bar_feed_time_seconds", None) else 0.0
        if machine_profile.machine_type in ["lathe", "turning_center", "mill_turn"]:
            t_bar_feed = setup_prof.bar_feed_time_seconds if getattr(setup_prof, "bar_feed_time_seconds", None) else 5.0
            
        t_chip_evac = setup_prof.chip_evacuation_time_seconds if getattr(setup_prof, "chip_evacuation_time_seconds", None) else (3.0 * len(operations))
        t_opt_stop = setup_prof.optional_stop_time_seconds if getattr(setup_prof, "optional_stop_time_seconds", None) else (2.0 * len(operations))
        
        machine_cycle = t_cutting + t_rapid + t_air_cut + t_toolchange + t_spindle + t_dwell + t_machine_actions + t_coolant + t_probe + t_bar_feed + t_chip_evac + t_opt_stop
        total_cycle = machine_cycle + handling_time + setup_prep_time
        
        confidence = "medium"
        if all("breakdown" in op for op in operations):
            confidence = "high" if len(operations) > 0 else "medium"
            
        # Percents
        total_non_zero = max(total_cycle, 0.001)
        
        return {
            "cutting_time_seconds": t_cutting,
            "rapid_time_seconds": t_rapid,
            "air_cutting_time_seconds": t_air_cut,
            "tool_change_time_seconds": t_toolchange,
            "probe_time_seconds": t_probe,
            "coolant_delay_seconds": t_coolant,
            "spindle_time_seconds": t_spindle,
            "handling_time_seconds": handling_time,
            "setup_time_seconds": setup_prep_time,
            "bar_feed_time_seconds": t_bar_feed,
            "chip_evacuation_time_seconds": t_chip_evac,
            "optional_stop_time_seconds": t_opt_stop,
            "machine_cycle_seconds": machine_cycle,
            "total_setup_time_seconds": total_cycle,
            "tool_change_count": tool_changes,
            "confidence": confidence,
            "percentages": {
                "cutting_percent": (t_cutting / total_non_zero) * 100,
                "rapid_percent": (t_rapid / total_non_zero) * 100,
                "air_cutting_percent": (t_air_cut / total_non_zero) * 100,
                "tool_change_percent": (t_toolchange / total_non_zero) * 100,
                "probe_percent": (t_probe / total_non_zero) * 100,
                "coolant_delay_percent": (t_coolant / total_non_zero) * 100,
                "handling_percent": (handling_time / total_non_zero) * 100,
                "setup_percent": 0.0 # Setup is initial, not part of per-part cycle usually
            }
        }
