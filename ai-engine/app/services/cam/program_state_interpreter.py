from typing import List, Dict, Any, Optional
import copy
from app.models.timeline import MachineStateSnapshot
from app.models.execution import (
    Position,
    ProgramBlock,
    MachineEventBlock,
    MotionBlock,
    CannedCycleBlock
)

class ProgramStateInterpreter:
    """
    Sequentially processes execution blocks, tracking the complete machine state
    and automatically emitting state transition events (tool changes, spindle starts, etc.)
    that are implied by the execution blocks.
    """
    def __init__(self):
        self.state = MachineStateSnapshot()
        
    def process_block(self, block: ProgramBlock) -> List[ProgramBlock]:
        """
        Takes a raw block (e.g., a MotionBlock with a new tool_id)
        and returns a list of blocks representing the transition + the original block.
        """
        emitted_blocks = []
        
        target_tool = None
        target_rpm = None
        
        if isinstance(block, (MotionBlock, CannedCycleBlock)):
            target_tool = block.tool_id
            target_rpm = block.spindle_rpm
            
        # 1. Tool Change
        if target_tool and target_tool != self.state.active_tool_id:
            # Emitting Optional Stop (M01) before Tool Change
            emitted_blocks.append(
                MachineEventBlock(
                    block_id=f"evt_m01_{target_tool}_{block.block_id}",
                    event_type="optional_stop",
                    operation_id=getattr(block, "operation_id", None),
                    setup_id=getattr(block, "setup_id", None)
                )
            )
            
            # Emitting Tool Change Event
            emitted_blocks.append(
                MachineEventBlock(
                    block_id=f"evt_tc_{target_tool}_{block.block_id}",
                    event_type="tool_change",
                    operation_id=getattr(block, "operation_id", None),
                    setup_id=getattr(block, "setup_id", None),
                    metadata={
                        "from_tool": self.state.active_tool_id,
                        "to_tool": target_tool
                    }
                )
            )
            # A tool change implicitly stops the spindle and coolant on most machines
            # (Though our tool change timing model handles the timing overlap, we track state strictly)
            self.state.spindle_running = False
            self.state.coolant_active = False
            self.state.active_tool_id = target_tool
            
        # 2. Spindle Start / Speed Change
        if target_rpm:
            if not self.state.spindle_running:
                emitted_blocks.append(
                    MachineEventBlock(
                        block_id=f"evt_spindle_start_{block.block_id}",
                        event_type="spindle_start",
                        operation_id=getattr(block, "operation_id", None),
                        setup_id=getattr(block, "setup_id", None),
                        metadata={"target_rpm": target_rpm, "direction": "CW"}
                    )
                )
                self.state.spindle_running = True
                self.state.spindle_rpm = target_rpm
                self.state.spindle_direction = "CW"
            elif target_rpm != self.state.spindle_rpm:
                emitted_blocks.append(
                    MachineEventBlock(
                        block_id=f"evt_spindle_speed_{block.block_id}",
                        event_type="spindle_speed_change",
                        operation_id=getattr(block, "operation_id", None),
                        setup_id=getattr(block, "setup_id", None),
                        metadata={"from_rpm": self.state.spindle_rpm, "target_rpm": target_rpm}
                    )
                )
                self.state.spindle_rpm = target_rpm
                
        # 3. Coolant (Assume cutting moves turn it on)
        if isinstance(block, (MotionBlock, CannedCycleBlock)):
            is_cutting = False
            if isinstance(block, MotionBlock) and block.motion_type != "rapid":
                is_cutting = True
            elif isinstance(block, CannedCycleBlock):
                is_cutting = True
                
            if is_cutting and not self.state.coolant_active:
                emitted_blocks.append(
                    MachineEventBlock(
                        block_id=f"evt_coolant_on_{block.block_id}",
                        event_type="coolant_on",
                        operation_id=getattr(block, "operation_id", None),
                        setup_id=getattr(block, "setup_id", None),
                        metadata={}
                    )
                )
                self.state.coolant_active = True

        # 4. Update CSS and Feed Mode
        if isinstance(block, MotionBlock):
            if getattr(block, "is_css", False):
                self.state.is_css_active = True
            else:
                self.state.is_css_active = False
                
            if getattr(block, "inverse_time_feed", None) is not None:
                self.state.feed_mode = "inverse_time"
            elif getattr(block, "feed_per_rev", None) is not None:
                self.state.feed_mode = "per_revolution"
            elif block.feed_rate is not None:
                self.state.feed_mode = "per_minute"

        # 5. Rotary Indexing (Auto Clamp/Unclamp)
        if isinstance(block, MotionBlock) and block.motion_type == "rapid":
            da = abs((block.end_position.a or 0) - (block.start_position.a or 0))
            db = abs((block.end_position.b or 0) - (block.start_position.b or 0))
            if da > 0.001 or db > 0.001:
                # Need to unclamp before move, clamp after move if it's indexing
                emitted_blocks.insert(0, MachineEventBlock(
                    block_id=f"evt_unclamp_{block.block_id}",
                    event_type="unclamp",
                    operation_id=block.operation_id,
                    setup_id=block.setup_id
                ))
                self.state.clamp_state = "unclamped"
                # The block itself happens while unclamped
                # We'll emit clamp after the block
                block_to_emit_after = MachineEventBlock(
                    block_id=f"evt_clamp_{block.block_id}",
                    event_type="clamp",
                    operation_id=block.operation_id,
                    setup_id=block.setup_id
                )
            else:
                block_to_emit_after = None
        else:
            block_to_emit_after = None

        # 6. Update Position
        if isinstance(block, MotionBlock):
            self.state.position = copy.deepcopy(block.end_position)
        elif isinstance(block, CannedCycleBlock) and block.holes:
            last_hole = block.holes[-1]
            # Assumes it ends at R-plane or clearance
            self.state.position = Position(x=last_hole.x, y=last_hole.y, z=block.r_plane)

        # 5. Spindle Stop / Coolant Off at the end of the program or before setup transitions
        # This will be handled explicitly if the caller passes a specific machine event
        if isinstance(block, MachineEventBlock):
            if block.event_type == "spindle_stop":
                self.state.spindle_running = False
                self.state.spindle_rpm = 0.0
            elif block.event_type == "coolant_off":
                self.state.coolant_active = False
            elif block.event_type == "tool_change":
                self.state.active_tool_id = block.metadata.get("to_tool")
            elif block.event_type == "clamp":
                self.state.clamp_state = "clamped"
            elif block.event_type == "unclamp":
                self.state.clamp_state = "unclamped"
        
        emitted_blocks.append(block)
        
        if block_to_emit_after:
            emitted_blocks.append(block_to_emit_after)
            self.state.clamp_state = "clamped"
            
        return emitted_blocks

    def get_snapshot(self) -> MachineStateSnapshot:
        return copy.deepcopy(self.state)
