import uuid
from typing import List, Dict, Any
import math
from app.models.execution import (
    ProgramExecutionModel,
    ProgramBlock,
    MotionBlock,
    CannedCycleBlock,
    Position,
    SetupTransitionBlock
)
from app.services.cam.program_state_interpreter import ProgramStateInterpreter

class ProgramBlockConverter:
    """
    Converts CAM operations and toolpaths into the canonical ProgramExecutionModel.
    Provides two paths: Level 1 (Planned Operations) and Level 2 (Final Toolpaths).
    """

    def __init__(self):
        pass

    def from_planned_operations(self, operations: List[Dict[str, Any]], setup_id: str) -> ProgramExecutionModel:
        """
        Level 1 Estimation: Synthesizes execution blocks from feature geometry, depths, and strategies
        without needing actual toolpath segments.
        """
        interpreter = ProgramStateInterpreter()
        all_blocks = []
        
        for op in operations:
            if op.get("status") in ("blocked", "error", "unsupported"):
                continue

            op_id = op.get("id", f"op_{uuid.uuid4().hex[:8]}")
            tool_id = op.get("toolId") or op.get("tool_id")
            
            # Simple fallback defaults for missing parameters
            params = op.get("parameters", {})
            feed = params.get("feedRate", 1000.0)
            rpm = params.get("spindleSpeed", 5000.0)
            
            op_type = op.get("type", "")
            
            # 1. Start with a rapid to safe height
            safe_z = op.get("safe_heights", {}).get("clearance", 50.0)
            center = op.get("feature_center", [0, 0, 0])
            
            # Start position is wherever interpreter state is
            start_pos = interpreter.get_snapshot().position
            approach_pos = Position(x=center[0], y=center[1], z=safe_z)
            
            approach_block = MotionBlock(
                block_id=f"blk_app_{uuid.uuid4().hex[:6]}",
                motion_type="rapid",
                start_position=start_pos,
                end_position=approach_pos,
                tool_id=tool_id,
                spindle_rpm=rpm,
                operation_id=op_id,
                setup_id=setup_id
            )
            all_blocks.extend(interpreter.process_block(approach_block))
            
            # 2. Synthesize cutting blocks based on operation type
            geom = op.get("machiningRegion", {}) or op.get("geometry", {})
            
            if op_type == "drilling":
                # Single hole for simplicity at planning level, or loop through pattern
                z_top = op.get("safe_heights", {}).get("top", 0.0)
                z_bottom = op.get("safe_heights", {}).get("bottom", -10.0)
                
                cycle_type = params.get("cycle_type", "G81")
                peck_depth = params.get("peckDepth", 5.0)
                
                drill_block = CannedCycleBlock(
                    block_id=f"blk_drill_{uuid.uuid4().hex[:6]}",
                    cycle_type=cycle_type,
                    holes=[Position(x=center[0], y=center[1], z=z_top)],
                    r_plane=z_top + 2.0,
                    final_depth=z_bottom,
                    feed_rate=feed,
                    spindle_rpm=rpm,
                    tool_id=tool_id,
                    operation_id=op_id,
                    setup_id=setup_id,
                    peck_depth=peck_depth if cycle_type in ("G83", "G73") else None
                )
                all_blocks.extend(interpreter.process_block(drill_block))

            else:
                # 2D/3D Milling Operations
                area = geom.get("area", 2500.0)  # Default 50x50mm
                if area <= 0: area = 2500.0
                
                z_top = op.get("safe_heights", {}).get("top", 0.0)
                z_bottom = op.get("safe_heights", {}).get("bottom", -10.0)
                depth = abs(z_top - z_bottom)
                
                stepdown = params.get("stepdown", 5.0)
                if stepdown <= 0: stepdown = 5.0
                passes = max(1, math.ceil(depth / stepdown))
                
                tool_dia = params.get("tool_diameter", 10.0)
                stepover_frac = params.get("stepover", 0.5)
                
                if op_type in ("facing", "pocketing", "boss_clearing"):
                    # Area clearing
                    # Distance per pass ≈ Area / Stepover_width
                    effective_width = tool_dia * stepover_frac
                    distance_per_pass = area / effective_width
                    total_distance = distance_per_pass * passes
                elif op_type in ("2d_contour", "2d_contour_outer"):
                    # Perimeter only
                    perimeter = geom.get("perimeter", math.sqrt(area) * 4) # Approximation
                    total_distance = perimeter * passes
                else:
                    # Fallback
                    total_distance = 100.0
                    
                # Create a synthetic motion block representing the entire cut
                # We move back and forth to simulate the cut length
                cut_start = interpreter.get_snapshot().position
                cut_end = Position(x=cut_start.x + total_distance, y=cut_start.y, z=cut_start.z)
                
                synth_cut = MotionBlock(
                    block_id=f"blk_synth_{uuid.uuid4().hex[:6]}",
                    motion_type="linear",
                    start_position=cut_start,
                    end_position=cut_end,
                    feed_rate=feed,
                    spindle_rpm=rpm,
                    tool_id=tool_id,
                    operation_id=op_id,
                    setup_id=setup_id,
                    computed_distance_mm=total_distance
                )
                all_blocks.extend(interpreter.process_block(synth_cut))
                
            # 3. Retract
            retract_pos = Position(x=center[0], y=center[1], z=safe_z)
            retract_block = MotionBlock(
                block_id=f"blk_ret_{uuid.uuid4().hex[:6]}",
                motion_type="rapid",
                start_position=interpreter.get_snapshot().position,
                end_position=retract_pos,
                tool_id=tool_id,
                spindle_rpm=rpm,
                operation_id=op_id,
                setup_id=setup_id
            )
            all_blocks.extend(interpreter.process_block(retract_block))

        return ProgramExecutionModel(
            estimation_level="planned_operations",
            blocks=all_blocks,
            setup_ids=[setup_id]
        )

    def from_toolpaths(self, operations: List[Dict[str, Any]], setup_id: str) -> ProgramExecutionModel:
        """
        Level 2 Estimation: Translates actual ToolpathSegment objects into precise Execution blocks.
        """
        interpreter = ProgramStateInterpreter()
        all_blocks = []
        
        for op in operations:
            if op.get("status") in ("blocked", "error", "unsupported"):
                continue

            op_id = op.get("id")
            tool_id = op.get("toolId") or op.get("tool_id")
            params = op.get("parameters", {})
            feed = params.get("feedRate", 1000.0)
            rpm = params.get("spindleSpeed", 5000.0)
            
            toolpaths = op.get("toolpaths", [])
            
            for i, seg in enumerate(toolpaths):
                # We expect dict here, assuming pydantic dump
                seg_type = seg.get("type", "LINEAR")
                
                sp_dict = seg.get("start", {"x": 0, "y": 0, "z": 0})
                ep_dict = seg.get("end", {"x": 0, "y": 0, "z": 0})
                
                # Check for DRILL_CYCLE
                if seg_type == "DRILL_CYCLE":
                    c_type = seg.get("parameters", {}).get("cycle_type", "G81")
                    p_depth = seg.get("parameters", {}).get("peckDepth", 5.0)
                    
                    cb = CannedCycleBlock(
                        block_id=f"blk_tp_{i}_{uuid.uuid4().hex[:4]}",
                        cycle_type=c_type,
                        holes=[Position(**sp_dict)],
                        r_plane=sp_dict.get("z", 0.0) + 2.0,  # approximate
                        final_depth=ep_dict.get("z", -10.0),
                        feed_rate=feed,
                        spindle_rpm=rpm,
                        tool_id=tool_id,
                        operation_id=op_id,
                        setup_id=setup_id,
                        peck_depth=p_depth,
                        source_segment_id=seg.get("id")
                    )
                    all_blocks.extend(interpreter.process_block(cb))
                    
                else:
                    # RAPID, LINEAR, ARC
                    m_type = "linear"
                    if seg_type == "RAPID":
                        m_type = "rapid"
                        
                    mb = MotionBlock(
                        block_id=f"blk_tp_{i}_{uuid.uuid4().hex[:4]}",
                        motion_type=m_type,
                        start_position=Position(**sp_dict),
                        end_position=Position(**ep_dict),
                        feed_rate=None if m_type == "rapid" else feed,
                        spindle_rpm=rpm,
                        tool_id=tool_id,
                        operation_id=op_id,
                        setup_id=setup_id,
                        source_segment_id=seg.get("id")
                    )
                    
                    # Add arc info if applicable
                    if seg_type in ("ARC_CW", "ARC_CCW"):
                        mb.motion_type = "arc_cw" if seg_type == "ARC_CW" else "arc_ccw"
                        c_dict = seg.get("center")
                        if c_dict:
                            mb.arc_center = Position(**c_dict)
                        mb.arc_plane = seg.get("parameters", {}).get("plane", "XY")
                        mb.arc_radius = seg.get("parameters", {}).get("radius")
                        
                    all_blocks.extend(interpreter.process_block(mb))
                    
        return ProgramExecutionModel(
            estimation_level="final_toolpath",
            blocks=all_blocks,
            setup_ids=[setup_id]
        )
