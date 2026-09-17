from typing import List, Dict, Any, Optional, Literal, Union
from pydantic import BaseModel, Field

class GeometricProvenance(BaseModel):
    """
    Structured provenance tracing every geometric dimension, boundary, depth,
    or coordinate to its authoritative B-Rep or configuration source.
    """
    source_type: Literal[
        "brep_face", 
        "brep_wire", 
        "brep_cylinder", 
        "brep_silhouette", 
        "stock_boundary", 
        "user_config",
        "derived_intersection"
    ]
    source_entity_ids: List[Union[int, str]] = Field(default_factory=list)
    topology_reference: Optional[str] = None
    coordinate_system: Literal["model_native", "setup_local", "wcs"] = "model_native"
    derivation: str
    confidence: float = 1.0
    tolerance: float = 0.01  # explicit configured geometric tolerance in mm
    parent_feature_id: Optional[str] = None

class AccessibilityResult(BaseModel):
    """
    Structured result from multi-stage accessibility analysis.
    """
    accessible: bool
    reason: str = "ACCESSIBLE"
    stage_failures: List[str] = Field(default_factory=list)
    setup_axis: Optional[List[float]] = None
    confidence: float = 1.0

class SetupConfiguration(BaseModel):
    """
    A machine setup configuration exposing spindle mode, tool orientation,
    fixture plane, and kinematic constraints.
    """
    config_id: str
    name: str
    tool_orientation: List[float]  # e.g. [0.0, 0.0, 1.0]
    spindle_mode: Literal["milling", "turning", "mill_turn"] = "milling"
    work_offset: str = "G54"
    rotary_angles: Optional[Dict[str, float]] = None
    fixture_side: str = "top"
    approach_vector: List[float] = Field(default_factory=lambda: [0.0, 0.0, 1.0])
    is_opposed_spindle: bool = False
