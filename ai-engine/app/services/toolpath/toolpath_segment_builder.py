import math
import uuid
from typing import List, Dict, Any

class ToolpathSegmentBuilder:
    def __init__(self):
        pass

    def calculate_distance(self, p1: List[float], p2: List[float]) -> float:
        return math.sqrt(sum((a - b) ** 2 for a, b in zip(p1, p2)))

    def build_segments_from_operation(self, operation: Dict[str, Any], setup: Dict[str, Any], tool: Dict[str, Any]) -> List[Dict[str, Any]]:
        segments = []
        op_id = operation.get("id")
        tool_id = tool.get("id")
        
        # Safe heights from setup
        clearance_height = setup.get("clearance_height", 50.0)
        
        # Speeds and feeds from operation
        feed_rate = operation.get("feed_rate", 1000.0)
        plunge_rate = operation.get("plunge_rate", 300.0)
        rpm = operation.get("rpm", 10000)
        
        toolpaths = operation.get("toolpaths", [])
        if not toolpaths:
            return segments

        for idx, seg in enumerate(toolpaths):
            if not isinstance(seg, dict) or 'start' not in seg or 'end' not in seg:
                continue

            start = [float(seg['start']['x']), float(seg['start']['y']), float(seg['start']['z'])]
            end = [float(seg['end']['x']), float(seg['end']['y']), float(seg['end']['z'])]
            
            orig_type = seg.get('moveType') or seg.get('type') or 'linear'
            orig_lower = str(orig_type).lower()
            if orig_lower in ('rapid', 'rapid_clearance', 'rapid_xy', 'retract_clearance', 'retract'):
                move_type = 'rapid'
            elif orig_lower in ('arc_cw', 'arc_ccw'):
                move_type = orig_lower
            elif orig_lower in ('plunge', 'drill_cycle'):
                move_type = 'plunge'
            elif orig_lower in ('cut', 'feed', 'linear', 'helix'):
                move_type = 'linear'
            else:
                move_type = orig_lower

            # Extract arc center and radius if available
            center = None
            if 'center' in seg and isinstance(seg['center'], dict):
                center = [
                    float(seg['center'].get('x', 0.0)),
                    float(seg['center'].get('y', 0.0)),
                    float(seg['center'].get('z', start[2]))
                ]
            elif 'center_x' in seg and seg['center_x'] is not None:
                center = [
                    float(seg.get('center_x', 0.0)),
                    float(seg.get('center_y', 0.0)),
                    float(seg.get('center_z', start[2]))
                ]

            radius = seg.get('radius')
            if radius is not None:
                radius = float(radius)
            elif center is not None and move_type in ('arc_cw', 'arc_ccw'):
                radius = float(math.hypot(start[0] - center[0], start[1] - center[1]))

            # Calculate accurate distance (arc sweep length vs straight line)
            if move_type in ('arc_cw', 'arc_ccw') and center is not None and radius and radius > 0.0001:
                start_angle = math.atan2(start[1] - center[1], start[0] - center[0])
                end_angle = math.atan2(end[1] - center[1], end[0] - center[0])
                sweep = end_angle - start_angle
                if move_type == 'arc_cw':
                    if sweep >= -1e-6:
                        sweep -= 2.0 * math.pi
                else:
                    if sweep <= 1e-6:
                        sweep += 2.0 * math.pi
                arc_len_xy = abs(sweep) * radius
                dz = abs(end[2] - start[2])
                dist = math.sqrt(arc_len_xy ** 2 + dz ** 2)
            else:
                dist = self.calculate_distance(start, end)

            # Use segment feedrate or fallback to operation defaults
            feed = seg.get('feedrate') if seg.get('feedrate') is not None else seg.get('feed_rate')
            if feed is None:
                if move_type == 'rapid':
                    feed = None
                elif orig_lower in ('plunge', 'drill_cycle'):
                    feed = plunge_rate
                else:
                    feed = feed_rate
            else:
                feed = float(feed)

            spindle = seg.get('spindle') or seg.get('rpm') or rpm
            if spindle is not None:
                spindle = float(spindle)
            
            segments.append(self._create_segment(
                op_id, tool_id, idx, move_type, start, end,
                feed_rate=feed, rpm=spindle, length=dist,
                center=center, radius=radius,
                clockwise=seg.get('clockwise') if 'clockwise' in seg else (move_type == 'arc_cw')
            ))

        return segments

    def _create_segment(self, op_id, tool_id, index, move_type, start, end, feed_rate, rpm, length, center=None, radius=None, clockwise=None):
        # Calculate estimated time (rapid is assumed fast, say 5000 mm/min)
        effective_feed = feed_rate if feed_rate and move_type != "rapid" else 5000.0
        time_sec = (length / effective_feed) * 60.0 if effective_feed > 0 else 0.0
        
        seg_dict = {
            "id": f"seg_{uuid.uuid4().hex[:8]}",
            "operation_id": op_id,
            "tool_id": tool_id,
            "segment_index": index,
            "move_type": move_type,
            "moveType": move_type,
            "units": "mm",
            "feed_mode": "per_minute",
            "start_x": start[0],
            "start_y": start[1],
            "start_z": start[2],
            "start": {"x": round(start[0], 4), "y": round(start[1], 4), "z": round(start[2], 4)},
            "start_i": 0.0,
            "start_j": 0.0,
            "start_k": -1.0,
            "end_x": end[0],
            "end_y": end[1],
            "end_z": end[2],
            "end": {"x": round(end[0], 4), "y": round(end[1], 4), "z": round(end[2], 4)},
            "end_i": 0.0,
            "end_j": 0.0,
            "end_k": -1.0,
            "center_x": center[0] if center else None,
            "center_y": center[1] if center else None,
            "center_z": center[2] if center else None,
            "radius": round(radius, 4) if radius is not None else None,
            "feed_rate": feed_rate,
            "feedrate": feed_rate,
            "rpm": rpm,
            "spindle": rpm,
            "length_mm": round(length, 4),
            "estimated_time_sec": round(time_sec, 4),
            "toolId": tool_id,
            "operationId": op_id,
        }
        if center is not None:
            seg_dict["center"] = {"x": round(center[0], 4), "y": round(center[1], 4), "z": round(center[2], 4)}
        if clockwise is not None:
            seg_dict["clockwise"] = clockwise
        return seg_dict
