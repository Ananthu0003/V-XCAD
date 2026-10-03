import uuid
from typing import List, Dict, Any, Optional
from app.models.execution import (
    ProgramExecutionModel, MotionBlock, CannedCycleBlock, MachineEventBlock, SetupTransitionBlock
)
from app.models.timeline import ExecutionTimeline, TimelineEntry
from app.services.cam.cycle_time_engine import CycleTimeEngine
from app.services.cam.program_state_interpreter import ProgramStateInterpreter

class ExecutionTimelineBuilder:
    """
    Builds a timed ExecutionTimeline from a ProgramExecutionModel by applying
    the CycleTimeEngine physics/timing models to each block.
    """
    def __init__(self, engine: CycleTimeEngine):
        self.engine = engine
        self.interpreter = ProgramStateInterpreter()
        
    def build(self, execution_model: ProgramExecutionModel) -> ExecutionTimeline:
        entries = []
        current_time = 0.0
        
        for block in execution_model.blocks:
            state_before = self.interpreter.get_snapshot()
            
            # The interpreter updates its internal state when processing the block.
            # We don't use the returned emitted blocks here because they were already
            # expanded by the ProgramBlockConverter.
            self.interpreter.process_block(block)
            state_after = self.interpreter.get_snapshot()
            
            duration = 0.0
            confidence = "high"
            time_category = "cutting"
            
            if isinstance(block, MotionBlock):
                if block.motion_type == "rapid":
                    duration, confidence = self.engine.estimate_rapid_time(block)
                    da = abs((block.end_position.a or 0) - (block.start_position.a or 0))
                    db = abs((block.end_position.b or 0) - (block.start_position.b or 0))
                    if da > 0.001 or db > 0.001:
                        time_category = "rapid"
                    else:
                        time_category = "rapid"
                else:
                    duration, confidence = self.engine.estimate_feed_time(block)
                    if getattr(block, "metadata", {}).get("is_air_cut"):
                        time_category = "air_cutting"
                    else:
                        time_category = "cutting"
                    
            elif isinstance(block, CannedCycleBlock):
                duration, confidence = self.engine.estimate_canned_cycle_time(block)
                time_category = "cutting"
                
            elif isinstance(block, MachineEventBlock):
                duration, confidence = self.engine.estimate_machine_event_time(block)
                if block.event_type == "tool_change":
                    time_category = "tool_change"
                elif "spindle" in block.event_type:
                    time_category = "spindle"
                elif block.event_type == "dwell":
                    time_category = "dwell"
                elif block.event_type == "probe":
                    time_category = "probe"
                elif block.event_type == "optional_stop":
                    time_category = "optional_stop"
                else:
                    time_category = "machine_action"
                    
            elif isinstance(block, SetupTransitionBlock):
                duration, confidence = self.engine.estimate_setup_transition(block)
                time_category = "handling"
                
            entry = TimelineEntry(
                entry_id=f"tln_{uuid.uuid4().hex[:8]}",
                block_id=block.block_id,
                block_type=block.block_type,
                start_time_seconds=current_time,
                end_time_seconds=current_time + duration,
                duration_seconds=duration,
                operation_id=getattr(block, "operation_id", None),
                setup_id=getattr(block, "setup_id", None),
                tool_id=getattr(block, "tool_id", None),
                state_before=state_before,
                state_after=state_after,
                time_category=time_category,
                timing_confidence=confidence
            )
            entries.append(entry)
            current_time += duration
            
        return ExecutionTimeline(
            schema_version="timeline_v1",
            estimation_level=execution_model.estimation_level,
            entries=entries,
            total_duration_seconds=current_time,
            source_execution_hash=execution_model.source_toolpath_hash
        )
