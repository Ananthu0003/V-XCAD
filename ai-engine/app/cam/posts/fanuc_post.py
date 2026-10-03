from typing import List
from .iso_post import IsoPostProcessor

class FanucPostProcessor(IsoPostProcessor):
    """Fanuc-specific CNC Post Processor."""
    
    def format_program_header(self) -> List[str]:
        lines = super().format_program_header()
        lines[1] = "(FANUC CNC PROGRAM)"
        return lines
