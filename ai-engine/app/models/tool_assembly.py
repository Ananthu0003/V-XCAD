from typing import Dict, Any, Optional
from pydantic import BaseModel, Field

class ToolAssembly(BaseModel):
    """
    Models the physical constraints of a cutting tool and its holder.
    All lengths are referenced from the tool tip (cutting edge) at Z=0,
    progressing upwards towards the gauge line (spindle face).
    All dimensions are in millimetres natively.
    """
    tool_id: str
    tool_number: str
    
    # Tool cutting limits
    diameter: float
    cutting_length: float = Field(default=10.0, description="Flute length: Maximum depth that can cut on the side.")
    shoulder_length: float = Field(default=20.0, description="Length before the shank diameter changes.")
    
    # Assembly limits
    usable_stickout: float = Field(default=30.0, description="Overall length extending from the holder.")
    
    # Holder envelope
    holder_diameter: float = Field(default=50.0, description="Diameter of the tool holder body.")
    holder_length: float = Field(default=50.0, description="Length of the tool holder up to the gauge line.")
    
    @classmethod
    def from_cam_tool(cls, tool_data: Dict[str, Any]) -> 'ToolAssembly':
        """Constructs a ToolAssembly from a standard CAM tool dictionary."""
        # Provide safe defaults if the frontend didn't supply full definitions yet
        stickout = tool_data.get('stickout') or 30.0
        diameter = tool_data.get('diameter') or 10.0
        
        # Flute length is normally provided, but we can default to stickout * 0.5
        cutting_len = tool_data.get('fluteLength') or tool_data.get('cutting_length') or (stickout * 0.5)
        shoulder_len = tool_data.get('shoulderLength') or tool_data.get('shoulder_length') or stickout
        
        return cls(
            tool_id=tool_data.get('id', 'unknown_tool'),
            tool_number=str(tool_data.get('number', '0')),
            diameter=float(diameter),
            cutting_length=float(cutting_len),
            shoulder_length=float(shoulder_len),
            usable_stickout=float(stickout),
            holder_diameter=float(tool_data.get('holderDiameter', 50.0)),
            holder_length=float(tool_data.get('holderLength', 50.0))
        )
