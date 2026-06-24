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

            start = [seg['start']['x'], seg['start']['y'], seg['start']['z']]
            end = [seg['end']['x'], seg['end']['y'], seg['end']['z']]
            
            orig_type = seg.get('type', 'linear')
            if orig_type == 'cut': move_type = 'linear'
            elif orig_type == 'plunge': move_type = 'linear'
            elif orig_type == 'retract': move_type = 'rapid'
            else: move_type = orig_type

            # Use segment feedrate or fallback to operation defaults
            feed = seg.get('feedrate')
            if feed is None:
                if move_type == 'rapid':
                    feed = None
                elif orig_type == 'plunge':
                    feed = plunge_rate
                else:
                    feed = feed_rate

            spindle = seg.get('spindle') or rpm
            dist = self.calculate_distance(start, end)
            
            segments.append(self._create_segment(
                op_id, tool_id, idx, move_type, start, end,
                feed_rate=feed, rpm=spindle, length=dist
            ))

        return segments

    def _create_segment(self, op_id, tool_id, index, move_type, start, end, feed_rate, rpm, length):
        # Calculate estimated time (rapid is assumed fast, say 5000 mm/min)
        effective_feed = feed_rate if feed_rate and move_type != "rapid" else 5000.0
        time_sec = (length / effective_feed) * 60.0 if effective_feed > 0 else 0.0
        
        return {
            "id": f"seg_{uuid.uuid4().hex[:8]}",
            "operation_id": op_id,
            "tool_id": tool_id,
            "segment_index": index,
            "move_type": move_type,
            "units": "mm",
            "feed_mode": "per_minute",
            "start_x": start[0],
            "start_y": start[1],
            "start_z": start[2],
            "start_i": 0.0,
            "start_j": 0.0,
            "start_k": -1.0,
            "end_x": end[0],
            "end_y": end[1],
            "end_z": end[2],
            "end_i": 0.0,
            "end_j": 0.0,
            "end_k": -1.0,
            "center_x": None,
            "center_y": None,
            "center_z": None,
            "radius": None,
            "feed_rate": feed_rate,
            "rpm": rpm,
            "length_mm": length,
            "estimated_time_sec": time_sec
        }
