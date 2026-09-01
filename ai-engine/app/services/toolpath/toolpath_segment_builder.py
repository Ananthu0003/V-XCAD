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
        
        # Safe heights and units are sourced from the setup, not hardcoded.
        safe_heights = setup.get("safe_heights", {}) or {}
        clearance_height = setup.get("clearance_height", safe_heights.get("clearance", 50.0))
        internal_units = setup.get("internalUnits", "mm")

        # Feeds & speeds are resolved from the operation (feeds_and_speeds or
        # top-level params) with sensible defaults. These should ultimately be
        # driven by the machine profile + tool + material model.
        feeds = operation.get("parameters", {}).get("feeds_and_speeds", {}) or {}
        feed_rate = operation.get("feed_rate", feeds.get("feed_rate", operation.get("parameters", {}).get("feedRate", 1000.0)))
        plunge_rate = operation.get("plunge_rate", feeds.get("plunge_rate", operation.get("parameters", {}).get("plungeRate", 300.0)))
        rpm = operation.get("rpm", feeds.get("spindle_rpm", operation.get("parameters", {}).get("spindleSpeed", 10000)))
        # Rapid traverse rate should come from the machine profile; allow override.
        rapid_feed = setup.get("rapid_feed_rate", operation.get("rapid_feed_rate", 5000.0))

        toolpaths = operation.get("toolpaths", [])
        if not toolpaths:
            return segments

        for idx, seg in enumerate(toolpaths):
            if not isinstance(seg, dict) or 'start' not in seg or 'end' not in seg:
                continue

            start = [seg['start']['x'], seg['start']['y'], seg['start']['z']]
            end = [seg['end']['x'], seg['end']['y'], seg['end']['z']]
            
            # The canonical move-type field is `moveType` (set by the toolpath
            # engine / MotionCommand). Fall back to `type` for legacy/parametric
            # payloads so the simulator never silently drops rapids or drills.
            orig_type = seg.get('moveType') or seg.get('type') or 'linear'
            # Cutting moves are linear; every approach/retract/rapid variant is a
            # rapid move (no feed, uses traverse rate) so timing is correct.
            if orig_type in ('cut', 'plunge', 'arc_cw', 'arc_ccw'):
                move_type = 'linear'
            elif orig_type in ('retract', 'rapid_xy', 'rapid_clearance',
                               'retract_clearance', 'approach_retract'):
                move_type = 'rapid'
            else:
                move_type = orig_type

            # Use segment feedrate or fallback to operation defaults
            feed = seg.get('feedrate')
            if feed is None:
                if move_type == 'rapid':
                    feed = None
                elif orig_type in ('plunge', 'drill_cycle'):
                    feed = plunge_rate
                else:
                    feed = feed_rate

            spindle = seg.get('spindle') or rpm
            dist = self.calculate_distance(start, end)
            
            segments.append(self._create_segment(
                op_id, tool_id, idx, move_type, start, end,
                feed_rate=feed, rpm=spindle, length=dist,
                units=internal_units, rapid_feed=rapid_feed,
                tool_axis=operation.get("tool_axis") or setup.get("tool_axis") or [0.0, 0.0, -1.0],
            ))

        return segments

    def _create_segment(self, op_id, tool_id, index, move_type, start, end, feed_rate, rpm, length, units="mm", rapid_feed=5000.0, tool_axis=None):
        # Rapid moves use the machine traverse rate, not the cutting feed.
        effective_feed = feed_rate if feed_rate and move_type != "rapid" else rapid_feed
        time_sec = (length / effective_feed) * 60.0 if effective_feed > 0 else 0.0

        if tool_axis is None:
            tool_axis = [0.0, 0.0, -1.0]
        
        return {
            "id": f"seg_{uuid.uuid4().hex[:8]}",
            "operation_id": op_id,
            "tool_id": tool_id,
            "segment_index": index,
            "move_type": move_type,
            "units": units,
            "feed_mode": "per_minute",
            "start_x": start[0],
            "start_y": start[1],
            "start_z": start[2],
            "start_i": 0.0,
            "start_j": 0.0,
            "start_k": tool_axis[2],
            "end_x": end[0],
            "end_y": end[1],
            "end_z": end[2],
            "end_i": 0.0,
            "end_j": 0.0,
            "end_k": tool_axis[2],
            "center_x": None,
            "center_y": None,
            "center_z": None,
            "radius": None,
            "feed_rate": feed_rate,
            "rpm": rpm,
            "length_mm": length,
            "estimated_time_sec": time_sec
        }
