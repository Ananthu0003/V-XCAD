from typing import List
from .base_post import BasePostProcessor
import datetime

class SiemensPostProcessor(BasePostProcessor):
    """Siemens Sinumerik-specific CNC Post Processor."""
    
    def format_program_header(self) -> List[str]:
        return [
            "; O0001 (SIEMENS CNC PROGRAM)",
            f"; (MATERIAL: {self.setup.get('material', 'UNKNOWN')})",
            f"; (DATE: {datetime.datetime.now().strftime('%Y-%m-%d')})",
            "; --- VEXCAD CAM Generated G-code ---",
            "G17 G71 G90 G94",
        ]

    def format_program_footer(self) -> List[str]:
        return [
            "M09",
            "M05",
            "SUPA G0 Z0 D0",
            "SUPA G0 X0 Y0",
            "M30",
        ]

    def format_tool_change(self, tool_number: int, length_offset: int, safe_z: float) -> List[str]:
        return [
            "M09",
            "M05",
            f"T=\"TOOL_{tool_number}\"",
            "M06",
            f"D{length_offset}",
            f"G0 Z{safe_z:.3f}"
        ]

    def format_spindle_coolant(self, rpm: float, coolant: str) -> List[str]:
        lines = [f"S{int(rpm)} M03"]
        if coolant == "flood":
            lines.append("M08")
        elif coolant == "mist":
            lines.append("M07")
        return lines

    def format_rapid_move(self, x: float = None, y: float = None, z: float = None) -> str:
        parts = ["G0"]
        if x is not None: parts.append(f"X{x:.3f}")
        if y is not None: parts.append(f"Y{y:.3f}")
        if z is not None: parts.append(f"Z{z:.3f}")
        return " ".join(parts)

    def format_linear_feed(self, x: float = None, y: float = None, z: float = None, feed: float = None) -> str:
        parts = ["G1"]
        if x is not None: parts.append(f"X{x:.3f}")
        if y is not None: parts.append(f"Y{y:.3f}")
        if z is not None: parts.append(f"Z{z:.3f}")
        if feed is not None: parts.append(f"F{feed:.1f}")
        return " ".join(parts)
