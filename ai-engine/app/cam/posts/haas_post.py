from typing import List
from .iso_post import IsoPostProcessor

class HaasPostProcessor(IsoPostProcessor):
    """Haas-specific CNC Post Processor."""
    
    def format_program_header(self) -> List[str]:
        lines = super().format_program_header()
        lines[1] = "(HAAS CNC PROGRAM)"
        return lines
