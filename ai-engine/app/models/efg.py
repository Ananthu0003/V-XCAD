from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field
from enum import Enum

from app.models.engineering_parameters import (
    GenericDimension,
    Tolerance,
    GDNTCallout,
    DatumDefinition,
    SurfaceFinish,
    ChamferParameter,
    FilletParameter,
    AngularParameter,
    MaterialSpecification,
    StockSpecification,
    SurfaceTreatment,
    ManufacturingRequirement,
    FunctionalCharacteristic,
    GeneralToleranceTable,
)

class FeatureType(str, Enum):
    COORDINATE_SYSTEM = "COORDINATE_SYSTEM"
    BASE_FEATURE = "BASE_FEATURE"
    ADDITIVE_FEATURE = "ADDITIVE_FEATURE"
    SUBTRACTIVE_FEATURE = "SUBTRACTIVE_FEATURE"
    TURNING_FEATURE = "TURNING_FEATURE"
    REVOLVED_PROFILE = "REVOLVED_PROFILE"
    REVOLVED_CUTOUT = "REVOLVED_CUTOUT"
    HOLE = "HOLE"
    BORE = "BORE"
    GROOVE = "GROOVE"
    SHOULDER = "SHOULDER"
    STEP = "STEP"
    CHAMFER = "CHAMFER"
    FILLET = "FILLET"
    THREAD = "THREAD"
    TAPER = "TAPER"
    INTERNAL_FEATURE = "INTERNAL_FEATURE"
    EDGE_TREATMENT = "EDGE_TREATMENT"

class EFGNode(BaseModel):
    feature_id: str
    feature_type: FeatureType
    parameters: Dict[str, Any] = Field(default_factory=dict)
    location: Dict[str, Any] = Field(default_factory=dict) # e.g. {'axis': 'X', 'position': 18.25}
    tolerance: Dict[str, Any] = Field(default_factory=dict)
    source_evidence: List[str] = Field(default_factory=list) # Links to ExtractedDimension, TextAnnotation IDs
    characteristic_ids: List[str] = Field(default_factory=list)
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    dependencies: List[str] = Field(default_factory=list) # IDs of parent features

    # Rich semantic fields
    semantic_dimensions: List[GenericDimension] = Field(default_factory=list)
    tolerances_parsed: Dict[str, Tolerance] = Field(default_factory=dict)
    gdt_callouts: List[GDNTCallout] = Field(default_factory=list)
    surface_finish: Optional[SurfaceFinish] = None
    chamfer_details: List[ChamferParameter] = Field(default_factory=list)
    fillet_details: List[FilletParameter] = Field(default_factory=list)
    angular_details: List[AngularParameter] = Field(default_factory=list)
    datum_references: List[str] = Field(default_factory=list)
    source_view: Optional[str] = None
    balloon_numbers: List[int] = Field(default_factory=list)

class EngineeringFeatureGraph(BaseModel):
    """
    An independent representation of engineering intent, completely decoupled from Python/CAD code.
    Features trace back to source evidence and declare their own dimensional limits.
    """
    version: int = 1
    nodes: List[EFGNode] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    
    # Global drawing attributes
    material: Optional[MaterialSpecification] = None
    stock: Optional[StockSpecification] = None
    surface_treatments: List[SurfaceTreatment] = Field(default_factory=list)
    manufacturing_requirements: List[ManufacturingRequirement] = Field(default_factory=list)
    functional_characteristics: List[FunctionalCharacteristic] = Field(default_factory=list)
    general_tolerances: Optional[GeneralToleranceTable] = None
    datums: List[DatumDefinition] = Field(default_factory=list)
    all_dimensions: List[GenericDimension] = Field(default_factory=list)
    
    def get_node(self, feature_id: str) -> Optional[EFGNode]:
        for node in self.nodes:
            if node.feature_id == feature_id:
                return node
        return None

    def add_node(self, node: EFGNode) -> None:
        existing = self.get_node(node.feature_id)
        if existing:
            idx = self.nodes.index(existing)
            self.nodes[idx] = node
        else:
            self.nodes.append(node)
