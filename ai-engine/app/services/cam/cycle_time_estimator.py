import math
from typing import List, Dict, Any
from app.models.schemas import ToolpathSegment, ToolpathSegmentType
from app.models.manufacturing import MachineProfile

class CycleTimeEstimator:
    """Estimates machining time based on generated toolpath segments."""
    
    @staticmethod
    def estimate_segment_time(segment: ToolpathSegment, machine_profile: MachineProfile) -> float:
        """Calculate estimated time in seconds for a single toolpath segment."""
        # Rapid moves use machine rapid rate (converted from mm/min to mm/s)
        # Cut moves use the programmed feedrate
        rapid_feedrate_mms = machine_profile.rapid_feedrate / 60.0
        
        feedrate_mms = (segment.feedrate / 60.0) if (segment.feedrate and segment.feedrate > 0) else rapid_feedrate_mms

        # Check move type
        if segment.moveType in [ToolpathSegmentType.RAPID_CLEARANCE, ToolpathSegmentType.RAPID_XY, ToolpathSegmentType.APPROACH_RETRACT]:
            effective_feedrate = rapid_feedrate_mms
        elif segment.moveType in [ToolpathSegmentType.CUT, ToolpathSegmentType.PLUNGE, ToolpathSegmentType.DRILL_CYCLE]:
            effective_feedrate = feedrate_mms
        elif segment.moveType in [ToolpathSegmentType.ARC_CW, ToolpathSegmentType.ARC_CCW]:
            effective_feedrate = feedrate_mms
        elif segment.moveType == ToolpathSegmentType.RETRACT_CLEARANCE:
            effective_feedrate = rapid_feedrate_mms
        else:
            effective_feedrate = feedrate_mms # fallback

        # Calculate distance
        dist = 0.0
        if segment.moveType in [ToolpathSegmentType.ARC_CW, ToolpathSegmentType.ARC_CCW] and segment.center and segment.radius:
            # Arc length calculation
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
            
            # Z movement in helix
            dz = segment.end.z - segment.start.z
            arc_length_xy = abs(angle_diff) * segment.radius
            dist = math.sqrt(arc_length_xy**2 + dz**2)
        else:
            # Linear distance (3D)
            dx = segment.end.x - segment.start.x
            dy = segment.end.y - segment.start.y
            dz = segment.end.z - segment.start.z
            dist = math.sqrt(dx**2 + dy**2 + dz**2)

        if effective_feedrate <= 0:
            return 0.0

        return dist / effective_feedrate

    @classmethod
    def estimate_operation_time(cls, segments: List[ToolpathSegment], machine_profile: MachineProfile) -> float:
        """Calculate total estimated time in seconds for an operation."""
        total_time = 0.0
        for seg in segments:
            total_time += cls.estimate_segment_time(seg, machine_profile)
        return total_time

    @classmethod
    def estimate_operation_time_parametric(cls, operation: Dict[str, Any], feature: Dict[str, Any], setup: Dict[str, Any] = None) -> float:
        """
        Estimate operation time parametrically using Volume, Area, and MRR.
        Provides an approximate cycle time before toolpaths are generated.
        Returns time in seconds.
        """
        if setup is None:
            setup = {}
            
        op_type = operation.get("type", "").lower()
        feat_type = feature.get("type", "").lower()
        params = operation.get("parameters", {})
        
        feed_rate_val = params.get("feedRate")
        feed_rate = float(feed_rate_val) if feed_rate_val is not None else 1000.0
        if feed_rate <= 0:
            feed_rate = 1000.0
            
        dims = feature.get("dimensions", {})
        depth = float(feature.get("depth") or dims.get("depth") or 10.0)
        width = float(feature.get("width") or dims.get("width") or 50.0)
        length = float(feature.get("length") or dims.get("length") or 50.0)
        diameter = float(feature.get("diameter") or dims.get("diameter") or 10.0)
        
        # Default stepover/stepdown for rough calculations
        stepover = 5.0 
        stepdown = 5.0
        
        # Extract stock dimensions if available
        stock_z = 0.0
        stock_dims = setup.get("stockDimensions")
        if stock_dims and isinstance(stock_dims, list) and len(stock_dims) >= 3:
            stock_z = float(stock_dims[2])
            
        model_z = setup.get("estimated_model_z", depth)
        stock_allowance = max(0.0, stock_z - model_z)
            
        estimated_time = 0.0
        
        if "drill" in op_type or "hole" in feat_type:
            # Drilling: (Depth + Clearance) / FeedRate
            clearance = 5.0
            total_z = depth + clearance + stock_allowance
            # Add pecking multiplier if deep
            if diameter > 0 and depth > diameter * 3:
                peck_count = depth / diameter
                total_z += peck_count * clearance * 2 # retract and plunge
            estimated_time = (total_z / feed_rate) * 60.0 # to seconds
            
        elif "face" in op_type or "face" in feat_type:
            # Facing: Area / (FeedRate * Stepover) * Z-Passes
            area = length * width
            if area <= 0 and diameter > 0:
                import math
                area = math.pi * (diameter / 2.0) ** 2
            
            distance = area / stepover
            base_time = (distance / feed_rate) * 60.0
            
            # Stock aware facing
            # If stock Z is greater than feature Z, it needs multiple passes.
            material_to_remove = depth
            if stock_allowance > 0:
                material_to_remove = stock_allowance + (0.5 if depth <= 0 else depth)
                
            import math
            passes = max(1, math.ceil(material_to_remove / stepdown))
            
            estimated_time = base_time * passes
            
        elif "pocket" in op_type or "pocket" in feat_type:
            # Pocketing: Volume / MRR
            # Stock-Aware logic: If the pocket is deep inside stock, we must remove more volume
            # We add the stock allowance to the effective depth of the pocket to clear the material above it.
            effective_depth = depth + stock_allowance
            
            volume = length * width * effective_depth
            if volume <= 0 and diameter > 0:
                import math
                volume = math.pi * (diameter / 2.0) ** 2 * effective_depth
            
            mrr = feed_rate * stepover * stepdown
            if mrr > 0:
                estimated_time = (volume / mrr) * 60.0
                
        elif "contour" in op_type or "profile" in op_type:
            # Contouring: Perimeter * Passes / FeedRate
            perimeter = 2 * (length + width)
            if perimeter <= 0 and diameter > 0:
                import math
                perimeter = math.pi * diameter
            
            passes = max(1, int(depth / stepdown))
            distance = perimeter * passes
            estimated_time = (distance / feed_rate) * 60.0
            
        else:
            # Fallback for unknown operations
            distance = (length + width + depth) * 2
            estimated_time = (distance / feed_rate) * 60.0
            
        # Add 20% inefficiency factor for cornering deceleration and rapid positioning moves
        return estimated_time * 1.2

    @classmethod
    def estimate_setup_time(cls, operations: List[Dict[str, Any]], machine_profile: MachineProfile, features_dict: Dict[str, Dict[str, Any]] = None, setup: Dict[str, Any] = None) -> Dict[str, Any]:
        """
        Calculate total estimated time for a setup, including tool changes and handling.
        Implements the formula:
        T_cycle = T_cutting + T_rapid + T_toolchange + T_spindle + T_dwell + T_machine_actions + T_handling
        """
        if features_dict is None:
            features_dict = {}
        if setup is None:
            setup = {}
            
        t_cutting_and_rapid = 0.0
        t_spindle = 0.0
        t_dwell = 0.0
        t_machine_actions = 0.0
        
        tool_changes = 0
        current_tool = None
        
        for op in operations:
            # Operation time from toolpaths (T_cutting + T_rapid)
            op_time = op.get('estimated_time_s', 0.0)
            
            # If toolpaths were not generated or time is 0, estimate parametrically!
            if op_time <= 0.0:
                feat_id = op.get("feature_id") or op.get("featureId")
                feat = features_dict.get(feat_id, {})
                
                # Estimate model Z from features if not present
                if "estimated_model_z" not in setup and features_dict:
                    max_z = max([float(f.get("depth") or 0.0) for f in features_dict.values()] + [0.1])
                    setup["estimated_model_z"] = max_z
                    
                op_time = cls.estimate_operation_time_parametric(op, feat, setup)
                op["estimated_time_s"] = op_time
                
            t_cutting_and_rapid += op_time
            
            # Spindle start/stop time per operation (approx 3 seconds)
            t_spindle += 3.0
                
            # Check for tool change
            op_tool = op.get('tool_id') or op.get('toolId')
            if op_tool and current_tool and op_tool != current_tool:
                tool_changes += 1
            if op_tool:
                current_tool = op_tool
                
        t_toolchange = tool_changes * machine_profile.tool_change_time
        
        # handling_time = loading, reversing and unloading
        handling_time = 30.0  # Approx 30s for part load/unload per setup
        
        # setup_time = one-time machine preparation (probing, fixture clamping, etc.)
        setup_prep_time = 180.0  # Approx 3 mins initial setup prep (not per-part)
        
        # machine_cycle = automatic CNC program time
        machine_cycle = t_cutting_and_rapid + t_toolchange + t_spindle + t_dwell + t_machine_actions
        
        # total production cycle time (for a single part)
        total_cycle = machine_cycle + handling_time
        
        return {
            "machining_time_s": t_cutting_and_rapid,
            "tool_change_time_s": t_toolchange,
            "tool_change_count": tool_changes,
            "spindle_time_s": t_spindle,
            "handling_time_s": handling_time,
            "setup_preparation_s": setup_prep_time,
            "machine_cycle_s": machine_cycle,
            "total_setup_time_s": total_cycle
        }
