import uuid
import datetime
from typing import Dict, Any, List

from .toolpath_segment_builder import ToolpathSegmentBuilder
from .simulation_timeline_builder import SimulationTimelineBuilder

class CamSimulationService:
    def __init__(self):
        self.segment_builder = ToolpathSegmentBuilder()
        self.timeline_builder = SimulationTimelineBuilder()

    def prepare_simulation(self, setup: Dict[str, Any], tools: List[Dict[str, Any]], operations: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Validates input and generates the complete simulation payload including 
        segments and timeline events.
        """
        validation_errors = []
        validation_warnings = []

        if not setup:
            validation_errors.append("No CAM setup provided.")
        if not operations:
            validation_errors.append("No operations provided.")
        
        for op in operations:
            if not op.get("tool_id") and not op.get("toolId"):
                validation_errors.append(f"Operation {op.get('id')} is missing a tool.")
            if not op.get("toolpaths"):
                validation_warnings.append(f"Operation {op.get('id')} has no generated toolpaths.")

        status = "failed" if validation_errors else "ready"
        
        run_id = f"sim_{uuid.uuid4().hex[:12]}"
        
        all_segments = []
        for op in operations:
            # Map toolId to tool_id if needed
            if "toolId" in op and "tool_id" not in op:
                op["tool_id"] = op["toolId"]
                
            tool_id = op.get("tool_id")
            tool = next((t for t in tools if t.get("id") == tool_id or t.get("dbId") == tool_id), {})
            
            segments = self.segment_builder.build_segments_from_operation(op, setup, tool)
            
            # Associate segments with run_id
            for seg in segments:
                seg["simulation_run_id"] = run_id
                
            all_segments.extend(segments)

        events = self.timeline_builder.build_timeline(all_segments, setup, tools, operations)
        for ev in events:
            ev["simulation_run_id"] = run_id

        total_runtime = sum(seg.get("estimated_time_sec", 0) for seg in all_segments)
        total_dist = sum(seg.get("length_mm", 0) for seg in all_segments)
        cut_dist = sum(seg.get("length_mm", 0) for seg in all_segments if seg.get("move_type") != "rapid")
        rapid_dist = sum(seg.get("length_mm", 0) for seg in all_segments if seg.get("move_type") == "rapid")

        simulation_run = {
            "id": run_id,
            "setup_id": setup.get("id"),
            "total_runtime_sec": total_runtime,
            "total_distance_mm": total_dist,
            "cutting_distance_mm": cut_dist,
            "rapid_distance_mm": rapid_dist,
            "status": status,
            "validation_status": "valid" if not validation_errors else "invalid",
            "validation_errors": validation_errors,
            "validation_warnings": validation_warnings,
            "created_at": datetime.datetime.utcnow().isoformat()
        }

        return {
            "simulationRunId": run_id,
            "simulationRun": simulation_run,
            "setup": setup,
            "tools": tools,
            "operations": operations,
            "segments": all_segments,
            "timeline": events
        }
