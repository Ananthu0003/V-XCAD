from typing import List, Dict, Any

class BasePostProcessor:
    """Base class for all CNC dialect post-processors."""
    def __init__(self):
        self.output = []
        
    def generate(self, operations: List[Dict[str, Any]]) -> str:
        self.output = []
        self._write_header()
        
        for op in operations:
            self.output.append(f"\n(--- OPERATION: {op.get('type', 'UNKNOWN').upper()} ---)")
            self._write_operation(op)
            
        self._write_footer()
        return "\n".join(self.output)
        
    def _write_header(self):
        pass
        
    def _write_operation(self, op: Dict[str, Any]):
        pass
        
    def _write_footer(self):
        pass

class FanucPostProcessor(BasePostProcessor):
    """Standard ISO/Fanuc compatible G-Code output."""
    def _write_header(self):
        self.output.append("%")
        self.output.append("O1001 (VEXCAD GENERATED)")
        self.output.append("G21 G90 G54 (MM, ABSOLUTE, WCS)")
        self.output.append("G17 G40 G49 G80 (XY PLANE, CANCEL COMP, CANCEL CYCLES)")
        
    def _write_operation(self, op: Dict[str, Any]):
        tool = op.get('tool')
        if tool:
            # Simplistic tool mapping for MVP
            tool_id_str = tool.get('id', 'tool_1').split('_')[-1]
            try:
                tool_num = int(tool_id_str)
            except ValueError:
                tool_num = 1
            self.output.append(f"T{tool_num} M6")
            self.output.append("S8000 M3")
            
        for path in op.get('toolpaths', []):
            if not path: continue
            
            # Rapid to first point
            first = path[0]
            self.output.append(f"G0 X{first[0]:.3f} Y{first[1]:.3f} Z{first[2]:.3f}")
            
            # Feed to subsequent points
            feed_rate = op.get('parameters', {}).get('feed_rate', 1000)
            for pt in path[1:]:
                self.output.append(f"G1 X{pt[0]:.3f} Y{pt[1]:.3f} Z{pt[2]:.3f} F{feed_rate}")
                
    def _write_footer(self):
        self.output.append("M30")
        self.output.append("%")

class HaasPostProcessor(FanucPostProcessor):
    """Haas-specific dialect."""
    def _write_header(self):
        self.output.append("%")
        self.output.append("O1001 (HAAS VEXCAD GENERATED)")
        self.output.append("G21 G90 G54")
        self.output.append("G17 G40 G49 G80")
        self.output.append("G53 G0 Z0. (SAFE Z RETRACT TO HOME)")

class SiemensPostProcessor(BasePostProcessor):
    """Siemens Sinumerik-specific dialect."""
    def _write_header(self):
        self.output.append("; SIEMENS VEXCAD GENERATED")
        self.output.append("G71 G90 G54")

    def _write_operation(self, op: Dict[str, Any]):
        tool = op.get('tool')
        if tool:
            self.output.append(f'T="{tool.get("name", "TOOL")}" M6')
            self.output.append("S8000 M3")
            
        for path in op.get('toolpaths', []):
            if not path: continue
            first = path[0]
            self.output.append(f"G0 X{first[0]:.3f} Y{first[1]:.3f} Z{first[2]:.3f}")
            feed_rate = op.get('parameters', {}).get('feed_rate', 1000)
            for pt in path[1:]:
                self.output.append(f"G1 X{pt[0]:.3f} Y{pt[1]:.3f} Z{pt[2]:.3f} F{feed_rate}")
                
    def _write_footer(self):
        self.output.append("M30")

class PostProcessorFactory:
    """Factory to instantiate the correct dialect post-processor."""
    @staticmethod
    def create(controller: str) -> BasePostProcessor:
        controller = controller.lower() if controller else ""
        if controller == 'haas':
            return HaasPostProcessor()
        elif controller == 'siemens':
            return SiemensPostProcessor()
        else:
            return FanucPostProcessor() # Default ISO/Fanuc

# Legacy bridge (for compatibility until Phase 12)
class GCodeGenerator:
    def __init__(self, **kwargs):
        self.post = PostProcessorFactory.create("fanuc")
        
    def generate_from_toolpaths(self, toolpaths: List[List[List[float]]], **kwargs) -> str:
        # Wrap legacy paths into the new operation structure for the post processor
        mock_op = {
            "type": "legacy_path",
            "toolpaths": toolpaths
        }
        return self.post.generate([mock_op])