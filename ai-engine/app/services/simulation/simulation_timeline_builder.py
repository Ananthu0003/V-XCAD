import uuid
from typing import List, Dict, Any

from app.services.cam.program_block_converter import ProgramBlockConverter
from app.services.cam.execution_timeline_builder import ExecutionTimelineBuilder
from app.services.cam.cycle_time_engine import CycleTimeEngine
from app.services.cam.profile_loader import ProfileLoader
from app.models.timeline import ExecutionTimeline

class SimulationTimelineBuilder:
    def __init__(self):
        self.profile_loader = ProfileLoader()

    def build_timeline(self, operations: List[Dict[str, Any]], setup: Dict[str, Any], tools: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        # 1. Setup Engine
        m_id = setup.get("machineProfileId", "default") if setup else "default"
        matrix_entry = self.profile_loader.get_machine_matrix_entry(m_id) or {}
        time_id = matrix_entry.get("timingProfileId", "generic_vmc_3axis")
        m_timing = self.profile_loader.load_machine_timing_profile(time_id) or self.profile_loader.load_machine_timing_profile("generic_vmc_3axis")
        c_timing = self.profile_loader.load_controller_timing_profile("generic_fanuc")
        h_profile = self.profile_loader.load_setup_handling_profile("generic_handling")
        defaults = self.profile_loader.get_generic_defaults_for_type("MILL_3X_VMC")
        
        ct_engine = CycleTimeEngine(m_timing, c_timing, h_profile, defaults)
        timeline_builder = ExecutionTimelineBuilder(ct_engine)
        pb_converter = ProgramBlockConverter()
        
        setup_id = setup.get("id", "setup1") if setup else "setup1"
        
        # 2. Build Execution Model
        exec_model = pb_converter.from_toolpaths(operations, setup_id)
        
        # 3. Build Timeline
        timeline = timeline_builder.build(exec_model)
        
        # 4. Convert to legacy simulation events format
        events = []
        current_op_id = None
        
        for entry in timeline.entries:
            op_id = entry.operation_id
            tool_id = entry.tool_id
            
            # Legacy event translation
            if op_id != current_op_id:
                if current_op_id is not None:
                    events.append(self._create_event(entry.start_time_seconds, "operation_end", current_op_id, tool_id, "Operation completed"))
                op_name = next((o.get("name", "Unknown Op") for o in operations if o.get("id") == op_id), "Unknown Op")
                if op_id:
                    events.append(self._create_event(entry.start_time_seconds, "operation_start", op_id, tool_id, f"Started operation {op_name}"))
                current_op_id = op_id
            
            if entry.time_category == "tool_change":
                tool_name = next((t.get("name", "Unknown Tool") for t in tools if t.get("id") == tool_id), "Unknown Tool")
                events.append(self._create_event(entry.start_time_seconds, "tool_change", op_id, tool_id, f"Tool changed to {tool_name}"))
            elif entry.time_category == "spindle_accel_decel" and entry.state_after.spindle_running and not entry.state_before.spindle_running:
                events.append(self._create_event(entry.start_time_seconds, "spindle_on", op_id, tool_id, f"Spindle started at {entry.state_after.spindle_rpm} RPM"))
            elif entry.time_category == "spindle_accel_decel" and not entry.state_after.spindle_running and entry.state_before.spindle_running:
                events.append(self._create_event(entry.start_time_seconds, "spindle_off", op_id, tool_id, "Spindle stopped"))
            
        if current_op_id is not None:
            events.append(self._create_event(timeline.total_duration_seconds, "operation_end", current_op_id, None, "Program completed"))
            
        return events, timeline

    def _create_event(self, time_sec, event_type, op_id, tool_id, message):
        return {
            "id": f"evt_{uuid.uuid4().hex[:8]}",
            "time_sec": time_sec,
            "event_type": event_type,
            "operation_id": op_id,
            "tool_id": tool_id,
            "message": message
        }
