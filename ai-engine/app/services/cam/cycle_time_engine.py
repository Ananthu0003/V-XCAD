import math
from typing import Dict, Any, List, Optional, Tuple
from app.models.execution import (
    MotionBlock, CannedCycleBlock, MachineEventBlock, SetupTransitionBlock, Position
)
from app.models.timing_profiles import (
    MachineTimingProfile, ControllerTimingProfile, SetupHandlingProfile
)

class CycleTimeEngine:
    """
    Core math engine for calculating durations based on kinematics and machine limits.
    """
    def __init__(
        self,
        machine_profile: Optional[MachineTimingProfile],
        controller_profile: Optional[ControllerTimingProfile],
        handling_profile: Optional[SetupHandlingProfile],
        generic_defaults: Dict[str, Any]
    ):
        self.machine = machine_profile
        self.controller = controller_profile
        self.handling = handling_profile
        self.defaults = generic_defaults

    def _get_val(self, obj, attr, default=None):
        if obj and hasattr(obj, attr):
            v = getattr(obj, attr)
            if v is not None:
                return v
        if attr in self.defaults:
            return self.defaults[attr]
        return default

    def calculate_distance(self, p1: Position, p2: Position) -> float:
        return math.sqrt((p2.x - p1.x)**2 + (p2.y - p1.y)**2 + (p2.z - p1.z)**2)

    def calculate_arc_length(self, block: MotionBlock) -> float:
        # Simplified: using computed_distance_mm if available, else chord length
        if block.computed_distance_mm:
            return block.computed_distance_mm
        if block.sweep_angle_radians and block.arc_radius:
            return block.arc_radius * block.sweep_angle_radians
        return self.calculate_distance(block.start_position, block.end_position)

    def estimate_rapid_time(self, block: MotionBlock) -> Tuple[float, str]:
        """Returns (duration_seconds, confidence)"""
        dx = abs(block.end_position.x - block.start_position.x)
        dy = abs(block.end_position.y - block.start_position.y)
        dz = abs(block.end_position.z - block.start_position.z)
        
        rx = self._get_val(self.machine, 'rapid_rate_x_mm_min')
        ry = self._get_val(self.machine, 'rapid_rate_y_mm_min')
        rz = self._get_val(self.machine, 'rapid_rate_z_mm_min')
        
        ax = self._get_val(self.machine, 'acceleration_x_mm_s2')
        ay = self._get_val(self.machine, 'acceleration_y_mm_s2')
        az = self._get_val(self.machine, 'acceleration_z_mm_s2')
        
        if not (rx and ry and rz):
            # Fallback to simple distance / generic_rapid
            dist = self.calculate_distance(block.start_position, block.end_position)
            r_fallback = self.defaults.get("rapid_rate_x_mm_min", 10000.0)
            t_linear = dist / (r_fallback / 60.0)
            confidence = "low"
        else:
            def axis_time(dist, v_max_min, a_s2):
                if dist == 0: return 0
                v_max = v_max_min / 60.0
                if not a_s2: return dist / v_max
                
                d_accel = (v_max**2) / (2 * a_s2)
                if dist >= 2 * d_accel:
                    return (2 * v_max / a_s2) + (dist - 2 * d_accel) / v_max
                else:
                    return 2 * math.sqrt(dist / a_s2)
                    
            tx = axis_time(dx, rx, ax)
            ty = axis_time(dy, ry, ay)
            tz = axis_time(dz, rz, az)
            t_linear = max(tx, ty, tz)
            confidence = "high" if (ax and ay and az) else "medium"
            
        # Rotary Rapid calculations
        da = abs((block.end_position.a or 0) - (block.start_position.a or 0))
        db = abs((block.end_position.b or 0) - (block.start_position.b or 0))
        
        ra = self._get_val(self.machine, 'rotary_rate_a_deg_min')
        rb = self._get_val(self.machine, 'rotary_rate_b_deg_min')
        ar = self._get_val(self.machine, 'rotary_acceleration_deg_s2')
        
        ta = 0.0
        tb = 0.0
        
        if ra and ar:
            def axis_time_rot(dist, v_max_min, a_s2):
                if dist == 0: return 0
                v_max = v_max_min / 60.0
                d_accel = (v_max**2) / (2 * a_s2)
                if dist >= 2 * d_accel:
                    return (2 * v_max / a_s2) + (dist - 2 * d_accel) / v_max
                return 2 * math.sqrt(dist / a_s2)
            ta = axis_time_rot(da, ra, ar) if ra else (da / (ra/60.0) if ra else 0)
            tb = axis_time_rot(db, rb, ar) if rb else (db / (rb/60.0) if rb else 0)
        else:
            if da > 0 or db > 0:
                confidence = "low"
            ta = da / (3600.0/60.0) # default 3600 deg/min
            tb = db / (3600.0/60.0)
            
        return (max(t_linear, ta, tb), confidence)

    def estimate_feed_time(self, block: MotionBlock) -> Tuple[float, str]:
        # 1. Inverse time feed (G93)
        if getattr(block, "inverse_time_feed", None):
            return ((1.0 / block.inverse_time_feed) * 60.0, "high")
            
        # 2. Determine Spindle RPM for CSS
        if getattr(block, "is_css", False) and getattr(block, "surface_speed_m_min", None):
            # Assume X is radial (radius), diameter = 2 * |x|
            d_start = abs(block.start_position.x) * 2
            d_end = abs(block.end_position.x) * 2
            d_avg = (d_start + d_end) / 2
            if d_avg > 0.001:
                rpm = (block.surface_speed_m_min * 1000) / (math.pi * d_avg)
            else:
                rpm = 1000.0
        else:
            rpm = block.spindle_rpm or 1000.0
            
        # 3. Determine actual feed mm/min
        if getattr(block, "feed_per_rev", None):
            feed = block.feed_per_rev * rpm
        else:
            feed = block.feed_rate or 1000.0
            
        if block.motion_type in ("arc_cw", "arc_ccw"):
            dist = self.calculate_arc_length(block)
        else:
            dist = block.computed_distance_mm or self.calculate_distance(block.start_position, block.end_position)
            
        base_time = dist / (feed / 60.0) if feed > 0 else 0
        
        # Rotary time components
        da = abs((block.end_position.a or 0) - (block.start_position.a or 0))
        db = abs((block.end_position.b or 0) - (block.start_position.b or 0))
        if da > 0 or db > 0:
            # DPM Approximation (Degrees Per Minute) mapping usually depends on control.
            # We assume a standard Inverse Time mapping if linear is missing, or simple ratio.
            rot_feed = feed # Assuming mm/min maps roughly to deg/min if untracked, but normally CAM generates G93.
            rot_time = max(da, db) / (rot_feed / 60.0) if rot_feed > 0 else 0
            base_time = max(base_time, rot_time)
        
        # Apply min block time
        min_block = self._get_val(self.controller, 'minimum_block_time_seconds', 0.002)
        base_time = max(base_time, min_block)
        
        # Acceleration penalty for short segments
        a_feed = self._get_val(self.controller, 'feed_acceleration_mm_s2')
        confidence = "high"
        
        if a_feed:
            v_max = feed / 60.0
            d_accel = (v_max**2) / (2 * a_feed)
            if dist < 2 * d_accel:
                base_time = 2 * math.sqrt(dist / a_feed)
        else:
            confidence = "medium"
            
        return (base_time, confidence)

    def estimate_canned_cycle_time(self, block: CannedCycleBlock) -> Tuple[float, str]:
        total_time = 0.0
        confidence = "medium"
        
        # Simplified drilling math:
        # Time per hole = rapid to R + feed to depth + rapid to R
        # If peck, add pecking overhead
        
        feed_s = block.feed_rate / 60.0 if block.feed_rate > 0 else 1000.0/60.0
        rapid_s = self._get_val(self.machine, 'rapid_rate_z_mm_min', 10000.0) / 60.0
        
        for hole in block.holes:
            # We don't have XY distance from previous hole here easily, so we assume
            # average 20mm move between holes
            total_time += 20.0 / rapid_s
            
            # Rapid to R
            total_time += abs(hole.z - block.r_plane) / rapid_s
            
            depth_dist = abs(block.r_plane - block.final_depth)
            
            if block.cycle_type == "G81":
                total_time += depth_dist / feed_s
                total_time += depth_dist / rapid_s
            elif block.cycle_type == "G82":
                total_time += depth_dist / feed_s
                total_time += block.dwell_seconds or 0.0
                total_time += depth_dist / rapid_s
            elif block.cycle_type in ("G83", "G73"):
                peck = block.peck_depth or 5.0
                num_pecks = max(1, int(depth_dist / peck))
                
                # Feeding time is the same
                total_time += depth_dist / feed_s
                
                # Pecking overhead
                if block.cycle_type == "G83":
                    # Full retract every peck
                    retract_dist = depth_dist / 2  # Average retract distance
                    total_time += (num_pecks * retract_dist * 2) / rapid_s
                else:
                    # G73 Chip break
                    cb = block.chip_break_retract_mm or 1.0
                    total_time += (num_pecks * cb * 2) / rapid_s
                    
                total_time += depth_dist / rapid_s # Final retract
                
        return (total_time, confidence)

    def estimate_machine_event_time(self, block: MachineEventBlock) -> Tuple[float, str]:
        if block.event_type == "tool_change":
            tc = self._get_val(self.machine, 'tool_change')
            
            # Use ATC specs if available
            atc_type = getattr(tc, "atc_type", "manual") if tc else "manual"
            base_search = getattr(tc, "tool_search_time", 2.0) if tc else 2.0
            index_time = getattr(tc, "magazine_indexing_time_per_pocket", 0.5) if tc else 0.5
            clamp_time = getattr(tc, "clamp_unclamp_time", 1.5) if tc else 1.5
            orient_time = getattr(tc, "spindle_orient_time", 1.0) if tc else 1.0
            stop_time = getattr(tc, "spindle_stop_time", 2.0) if tc else 2.0
            
            # Simple ATC simulation (assume average 2 pockets away for chain/carousel)
            avg_indexing = index_time * 2
            if atc_type == "random_pocket":
                avg_indexing = index_time * 1
                
            total = orient_time + stop_time + avg_indexing + clamp_time
            if not tc or tc.duration_seconds is None:
                # If no explicit duration, use ATC calc
                pass
            else:
                # Fallback to duration_seconds if ATC details are missing but duration is present
                total = tc.duration_seconds
                if not tc.includes_spindle_stop:
                    total += stop_time
                if not tc.includes_spindle_orientation:
                    total += orient_time

            return (total, "high")
            
        elif block.event_type == "spindle_start":
            rpm = block.metadata.get("target_rpm", 0)
            accel = self._get_val(self.machine, "spindle_accel_rpm_per_sec")
            if accel and accel > 0:
                return (rpm / accel, "high")
            return (2.0, "medium")
            
        elif block.event_type == "spindle_stop":
            # Simplified
            return (2.0, "medium")
            
        elif block.event_type in ("coolant_on", "coolant_off"):
            delay = self._get_val(self.machine, f"{block.event_type}_delay_sec", 0.0)
            return (delay, "high" if self.machine and getattr(self.machine, f"{block.event_type}_delay_sec") is not None else "low")
            
        elif block.event_type == "dwell":
            return (block.metadata.get("duration_seconds", 0.0), "high")
            
        elif block.event_type in ("clamp", "unclamp"):
            sec = self._get_val(self.machine, f"axis_{block.event_type}_seconds", 1.0)
            return (sec, "medium")
            
        elif block.event_type in ("chuck_open", "chuck_close"):
            sec = self._get_val(self.machine, f"{block.event_type}_seconds", 2.0)
            return (sec, "medium")
            
        elif block.event_type == "bar_feed":
            sec = self._get_val(self.machine, "bar_feed_seconds", 5.0)
            return (sec, "medium")
            
        elif block.event_type == "part_transfer":
            sec = self._get_val(self.machine, "sub_spindle_transfer_seconds", 15.0)
            return (sec, "medium")
            
        elif block.event_type == "sync_wait":
            # Wait codes themselves don't take time inherently unless blocked, 
            # timeline simulation handles blocking
            return (0.0, "high")
            
        return (0.0, "high")

    def estimate_setup_transition(self, block: SetupTransitionBlock) -> Tuple[float, str]:
        if block.duration_seconds:
            return (block.duration_seconds, "high")
            
        if block.transition_type == "manual_reorientation":
            t = self._get_val(self.handling, "reorientation_time_seconds")
            if t is not None:
                return (t, "medium")
            return (60.0, "low")
            
        return (0.0, "low")
