from typing import List, Dict, Any

class BasePostProcessor:
    """Base class for all CNC dialect post-processors."""
    def __init__(self):
        self.output = []
        
    def generate(self, operations: List[Dict[str, Any]]) -> str:
        self.output = []
        self.program_start()
        
        for op in operations:
            self.output.append(f"\n(--- OPERATION: {op.get('type', 'UNKNOWN').upper()} ---)")
            feature_id = op.get('feature_id')
            if feature_id:
                self.output.append(f"(FEATURE: {feature_id})")
                
            self._write_operation(op)
            
        self.program_end()
        return "\n".join(self.output)
        
    def program_start(self):
        pass
        
    def program_end(self):
        pass
        
    def tool_change(self, tool_num: int, tool_name: str = ""):
        pass
        
    def start_spindle(self, rpm: int):
        pass
        
    def spindle_stop(self):
        pass
        
    def coolant_on(self):
        pass
        
    def coolant_off(self):
        pass
        
    def apply_tool_length_offset(self, offset_num: int, safe_z: float):
        pass
        
    def rapid(self, x: float = None, y: float = None, z: float = None):
        pass
        
    def linear(self, x: float = None, y: float = None, z: float = None, feed: float = None):
        pass
        
    def drilling_cycle(self, x: float, y: float, z: float, r: float, feed: float):
        pass
        
    def peck_drilling_cycle(self, x: float, y: float, z: float, r: float, q: float, feed: float):
        pass
        
    def cancel_cycle(self):
        pass

    def emit_safe_approach(self, x: float, y: float, clearance_z: float, retract_z: float):
        self.rapid(z=clearance_z)
        self.rapid(x=x, y=y)
        self.rapid(z=retract_z)

    def emit_safe_retract(self, clearance_z: float):
        self.rapid(z=clearance_z)

    def _write_operation(self, op: Dict[str, Any]):
        tool = op.get('tool', {})
        if not tool:
            return # Blocked earlier, but safe guard

        tool_num = tool.get('tool_number', 1)
        tool_name = tool.get('tool_name', 'TOOL')
        self.tool_change(tool_num, tool_name)

        rpm = op.get('parameters', {}).get('spindle_rpm', 6000)
        self.start_spindle(rpm)

        offset_num = tool.get('length_offset_number', tool_num)
        safe_heights = op.get('safe_heights', {})
        clearance_z = safe_heights.get('clearance', 50.0)
        retract_z = safe_heights.get('retract', 5.0)

        # Move to safe Z first
        self.rapid(z=clearance_z)

        # Apply offset and coolant
        self.apply_tool_length_offset(offset_num, clearance_z)

        if op.get('parameters', {}).get('coolant_enabled', True):
            self.coolant_on()

        segments = op.get('toolpaths', [])
        if not segments:
            return

        op_type = op.get('type')
        feed_cut = op.get('parameters', {}).get('feed_rate', 1000)
        feed_plunge = op.get('parameters', {}).get('plunge_rate', 300)

        is_first = True
        current_z = clearance_z

        for seg in segments:
            move_type = seg.get('moveType', 'unknown')
            pt = seg.get('end', {})
            x, y, z = pt.get('x'), pt.get('y'), pt.get('z')

            if move_type == 'drill_cycle':
                bottom_z = pt.get('z', 0.0)
                cycle_type = op.get('parameters', {}).get('cycle_type', 'G81')
                self.rapid(x=x, y=y)
                if cycle_type == 'G83':
                    peck = op.get('parameters', {}).get('peck_depth', 2.0)
                    self.peck_drilling_cycle(x, y, bottom_z, retract_z, peck, feed_plunge)
                else:
                    self.drilling_cycle(x, y, bottom_z, retract_z, feed_plunge)
                self.cancel_cycle()
                self.rapid(z=clearance_z)
                current_z = clearance_z

            elif move_type == 'rapid_clearance':
                self.rapid(z=max(z if z is not None else clearance_z, clearance_z))
                current_z = clearance_z
                
            elif move_type == 'rapid_xy':
                self.rapid(x=x, y=y)
                
            elif move_type == 'approach_retract':
                safe_z = max(z if z is not None else retract_z, retract_z)
                self.rapid(z=safe_z)
                current_z = safe_z
                
            elif move_type == 'retract_clearance':
                self.rapid(z=max(z if z is not None else clearance_z, clearance_z))
                current_z = clearance_z

            elif move_type == 'plunge':
                self.linear(x=x, y=y, z=z, feed=feed_plunge)
                current_z = z if z is not None else current_z
                
            elif move_type in ['cut', 'arc_cw', 'arc_ccw']:
                # G2/G3 are not modeled in base linear method perfectly, 
                # but for now we fallback to linear as standard if arcs are not implemented in generator,
                # or use a specialized method if it existed.
                # Assuming `self.linear` works as the basic cut endpoint:
                self.linear(x=x, y=y, z=z, feed=feed_cut)
                current_z = z if z is not None else current_z

        # Retract at end of op
        self.emit_safe_retract(clearance_z)

        if op.get('parameters', {}).get('coolant_enabled', True):
            self.coolant_off()


class FanucPostProcessor(BasePostProcessor):
    """Standard ISO/Fanuc compatible G-Code output."""
    def program_start(self):
        self.output.append("%")
        self.output.append("O1001 (VEXCAD GENERATED)")
        self.output.append("G21 G90 G17 G40 G49 G80")
        self.output.append("G54")
        
    def program_end(self):
        self.output.append("M09")
        self.output.append("M05")
        self.output.append("G53 G0 Z0.")
        self.output.append("G53 G0 X0. Y0.")
        self.output.append("M30")
        self.output.append("%")
        
    def tool_change(self, tool_num: int, tool_name: str = ""):
        self.output.append(f"(T{tool_num} - {tool_name})")
        self.output.append(f"T{tool_num} M06")
        
    def start_spindle(self, rpm: int):
        self.output.append(f"S{rpm} M03")
        
    def spindle_stop(self):
        self.output.append("M05")
        
    def coolant_on(self):
        self.output.append("M08")
        
    def coolant_off(self):
        self.output.append("M09")
        
    def apply_tool_length_offset(self, offset_num: int, safe_z: float):
        self.output.append(f"G43 H{offset_num} Z{safe_z:.3f}")
        
    def rapid(self, x: float = None, y: float = None, z: float = None):
        cmd = "G0"
        if x is not None: cmd += f" X{x:.3f}"
        if y is not None: cmd += f" Y{y:.3f}"
        if z is not None: cmd += f" Z{z:.3f}"
        if cmd != "G0":
            self.output.append(cmd)
            
    def linear(self, x: float = None, y: float = None, z: float = None, feed: float = None):
        cmd = "G1"
        if x is not None: cmd += f" X{x:.3f}"
        if y is not None: cmd += f" Y{y:.3f}"
        if z is not None: cmd += f" Z{z:.3f}"
        if feed is not None: cmd += f" F{feed:.0f}"
        if cmd != "G1":
            self.output.append(cmd)
            
    def drilling_cycle(self, x: float, y: float, z: float, r: float, feed: float):
        self.output.append(f"G81 X{x:.3f} Y{y:.3f} Z{z:.3f} R{r:.3f} F{feed:.0f}")
        
    def peck_drilling_cycle(self, x: float, y: float, z: float, r: float, q: float, feed: float):
        self.output.append(f"G83 X{x:.3f} Y{y:.3f} Z{z:.3f} R{r:.3f} Q{q:.3f} F{feed:.0f}")
        
    def cancel_cycle(self):
        self.output.append("G80")

class HaasPostProcessor(FanucPostProcessor):
    """Haas-specific dialect."""
    def program_start(self):
        self.output.append("%")
        self.output.append("O1001 (HAAS VEXCAD GENERATED)")
        self.output.append("G21 G90 G17 G40 G49 G80")
        self.output.append("G54")

class PostProcessorFactory:
    """Factory to instantiate the correct dialect post-processor."""
    @staticmethod
    def create(controller: str) -> BasePostProcessor:
        controller = controller.lower() if controller else ""
        if controller == 'haas':
            return HaasPostProcessor()
        else:
            return FanucPostProcessor() # Default ISO/Fanuc

# Legacy compatibility removed intentionally to enforce operation-based paths
class GCodeGenerator:
    def __init__(self, **kwargs):
        self.post = PostProcessorFactory.create("fanuc")
        
    def generate_from_toolpaths(self, toolpaths, **kwargs):
        raise ValueError("legacy_path generation is permanently blocked. Use generate(operations) instead.")