import uuid
from typing import List, Dict, Any

class SimulationTimelineBuilder:
    def __init__(self):
        pass

    def build_timeline(self, segments: List[Dict[str, Any]], setup: Dict[str, Any], tools: List[Dict[str, Any]], operations: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        events = []
        current_time = 0.0
        
        current_tool_id = None
        current_op_id = None
        spindle_on = False
        
        for seg in segments:
            op_id = seg.get("operation_id")
            tool_id = seg.get("tool_id")
            
            # Tool Change Event
            if tool_id != current_tool_id:
                if spindle_on:
                    events.append(self._create_event(current_time, "spindle_off", current_op_id, current_tool_id, "Spindle stopped for tool change"))
                    spindle_on = False
                    
                tool_name = next((t.get("name", "Unknown Tool") for t in tools if t.get("id") == tool_id), "Unknown Tool")
                events.append(self._create_event(current_time, "tool_change", op_id, tool_id, f"Tool changed to {tool_name}"))
                current_tool_id = tool_id
                
            # Operation Change Event
            if op_id != current_op_id:
                if current_op_id is not None:
                    events.append(self._create_event(current_time, "operation_end", current_op_id, current_tool_id, "Operation completed"))
                
                op_name = next((o.get("name", "Unknown Op") for o in operations if o.get("id") == op_id), "Unknown Op")
                events.append(self._create_event(current_time, "operation_start", op_id, tool_id, f"Started operation {op_name}"))
                current_op_id = op_id
                
            # Spindle Start Event
            if seg.get("rpm", 0) > 0 and not spindle_on:
                events.append(self._create_event(current_time, "spindle_on", op_id, tool_id, f"Spindle started at {seg['rpm']} RPM"))
                spindle_on = True
                
            # Spindle Stop Event
            if seg.get("rpm", 0) == 0 and spindle_on:
                events.append(self._create_event(current_time, "spindle_off", op_id, tool_id, "Spindle stopped"))
                spindle_on = False

            # Advance time
            current_time += seg.get("estimated_time_sec", 0.0)

        # Finalize
        if spindle_on:
            events.append(self._create_event(current_time, "spindle_off", current_op_id, current_tool_id, "Spindle stopped at end of program"))
        if current_op_id is not None:
            events.append(self._create_event(current_time, "operation_end", current_op_id, current_tool_id, "Program completed"))

        return events

    def _create_event(self, time_sec, event_type, op_id, tool_id, message):
        return {
            "id": f"evt_{uuid.uuid4().hex[:8]}",
            "time_sec": time_sec,
            "event_type": event_type,
            "operation_id": op_id,
            "tool_id": tool_id,
            "message": message
        }
