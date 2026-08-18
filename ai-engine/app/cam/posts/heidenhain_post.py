from typing import List
from .base_post import BasePostProcessor
import datetime

class HeidenhainPostProcessor(BasePostProcessor):
    """Heidenhain Conversational CNC Post Processor."""
    
    def format_program_header(self) -> List[str]:
        return [
            "BEGIN PGM O0001 MM",
            f"; (MATERIAL: {self.setup.get('material', 'UNKNOWN')})",
            f"; (DATE: {datetime.datetime.now().strftime('%Y-%m-%d')})",
            "; --- VEXCAD CAM Generated G-code ---",
        ]

    def format_program_footer(self) -> List[str]:
        return [
            "M9",
            "M5",
            "L Z+100 R0 FMAX",
            "L X+0 Y+0 R0 FMAX",
            "M30",
            "END PGM O0001 MM",
        ]

    def format_tool_change(self, tool_number: int, length_offset: int, safe_z: float) -> List[str]:
        return [
            "M09",
            "M05",
            f"TOOL CALL {tool_number} Z",
            f"L Z+{safe_z:.3f} R0 FMAX"
        ]

    def format_spindle_coolant(self, rpm: float, coolant: str) -> List[str]:
        lines = [f"M3 S{int(rpm)}"]
        if coolant == "flood":
            lines.append("M8")
        elif coolant == "mist":
            lines.append("M7")
        return lines

    def format_rapid_move(self, x: float = None, y: float = None, z: float = None) -> str:
        parts = ["L"]
        if x is not None: parts.append(f"X{x:+.3f}")
        if y is not None: parts.append(f"Y{y:+.3f}")
        if z is not None: parts.append(f"Z{z:+.3f}")
        parts.append("R0 FMAX")
        return " ".join(parts)

    def format_linear_feed(self, x: float = None, y: float = None, z: float = None, feed: float = None) -> str:
        parts = ["L"]
        if x is not None: parts.append(f"X{x:+.3f}")
        if y is not None: parts.append(f"Y{y:+.3f}")
        if z is not None: parts.append(f"Z{z:+.3f}")
        parts.append("R0")
        if feed is not None: parts.append(f"F{feed:.0f}")
        return " ".join(parts)
