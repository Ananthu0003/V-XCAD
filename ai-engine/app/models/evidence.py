from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
from enum import Enum

class ProvenanceSource(str, Enum):
    OBSERVED = "OBSERVED"
    DETERMINISTIC_INFERRED = "DETERMINISTIC_INFERRED"
    AI_INFERRED = "AI_INFERRED"
    AI_GENERATED = "AI_GENERATED"
    VALIDATED = "VALIDATED"

class ProvenanceData(BaseModel):
    source: ProvenanceSource
    confidence: float = Field(..., ge=0.0, le=1.0)
    history: List[str] = Field(default_factory=list)

class DrawingMetadata(BaseModel):
    id: str
    filename: str
    width: int
    height: int
    pages: int

class ProjectionType(str, Enum):
    ORTHOGRAPHIC = "ORTHOGRAPHIC"
    ISOMETRIC = "ISOMETRIC"
    SECTION = "SECTION"
    DETAIL = "DETAIL"
    UNKNOWN = "UNKNOWN"

class DrawingView(BaseModel):
    id: str
    name: str
    projection: ProjectionType
    bbox: List[float] # [x_min, y_min, x_max, y_max]

class ImageRegion(BaseModel):
    id: str
    view_id: Optional[str] = None
    bbox: List[float]
    label: str

class Geometry2DObservations(BaseModel):
    lines: List[Dict[str, Any]] = []
    arcs: List[Dict[str, Any]] = []
    circles: List[Dict[str, Any]] = []
    curves: List[Dict[str, Any]] = []

class EvidenceStatus(str, Enum):
    VALIDATED = "VALIDATED"
    REQUIRES_REVIEW = "REQUIRES_REVIEW"
    REJECTED = "REJECTED"

class ExtractedDimension(BaseModel):
    id: str
    value: float
    unit: str = "mm"
    tolerance_upper: Optional[float] = None
    tolerance_lower: Optional[float] = None
    text: str
    view_id: Optional[str] = None
    bbox: Optional[List[float]] = None
    characteristic_id: Optional[str] = None
    dependencies: List[str] = Field(default_factory=list)
    alternative_interpretations: List[Dict[str, Any]] = Field(default_factory=list)
    status: EvidenceStatus = EvidenceStatus.REQUIRES_REVIEW
    confidence: float = 1.0

class TextAnnotation(BaseModel):
    id: str
    text: str
    view_id: Optional[str] = None
    bbox: Optional[List[float]] = None
    characteristic_id: Optional[str] = None
    status: EvidenceStatus = EvidenceStatus.REQUIRES_REVIEW
    confidence: float = 1.0

class EngineeringSymbol(BaseModel):
    id: str
    symbol_type: str # e.g. surface_finish, gd_t
    value: str
    view_id: Optional[str] = None
    bbox: Optional[List[float]] = None
    characteristic_id: Optional[str] = None
    status: EvidenceStatus = EvidenceStatus.REQUIRES_REVIEW
    confidence: float = 1.0

class SegmentationMask(BaseModel):
    id: str
    label: str
    mask_data: Any # Placeholder for mask polygon/RLE

class ComponentDetection(BaseModel):
    id: str
    label: str
    view_id: Optional[str] = None
    confidence: float
    status: EvidenceStatus = EvidenceStatus.REQUIRES_REVIEW

class FeatureCandidate(BaseModel):
    id: str
    feature_type: str
    view_id: Optional[str] = None
    related_dimensions: List[str] = Field(default_factory=list)
    status: EvidenceStatus = EvidenceStatus.REQUIRES_REVIEW
    confidence: float = 1.0

class ObservedConstraint(BaseModel):
    id: str
    constraint_type: str # e.g. parallelism, perpendicularity
    target_elements: List[str]
    value: Optional[float] = None
    characteristic_id: Optional[str] = None
    dependencies: List[str] = Field(default_factory=list)
    alternative_interpretations: List[Dict[str, Any]] = Field(default_factory=list)
    status: EvidenceStatus = EvidenceStatus.REQUIRES_REVIEW
    confidence: float = 1.0

class EngineeringEvidence(BaseModel):
    """
    IMMUTABLE source of truth extracted from the 2D Drawing.
    Once created and passed through the Evidence Quality Gate, this model should NOT be modified.
    """
    drawing_metadata: DrawingMetadata
    views: List[DrawingView] = Field(default_factory=list)
    projection_types: List[ProjectionType] = Field(default_factory=list)
    image_regions: List[ImageRegion] = Field(default_factory=list)
    geometry2d: Geometry2DObservations = Field(default_factory=Geometry2DObservations)
    dimensions: List[ExtractedDimension] = Field(default_factory=list)
    text_annotations: List[TextAnnotation] = Field(default_factory=list)
    symbols: List[EngineeringSymbol] = Field(default_factory=list)
    segmentation: List[SegmentationMask] = Field(default_factory=list)
    detected_components: List[ComponentDetection] = Field(default_factory=list)
    feature_candidates: List[FeatureCandidate] = Field(default_factory=list)
    constraints: List[ObservedConstraint] = Field(default_factory=list)
    provenance: ProvenanceData
    is_frozen: bool = False

    def model_post_init(self, __context: Any) -> None:
        """Allow initial setup but after that, it can be marked as frozen."""
        super().model_post_init(__context)

    def freeze(self):
        """Mark evidence as immutable."""
        self.is_frozen = True

    def __setattr__(self, name, value):
        if getattr(self, "is_frozen", False) and name != "is_frozen":
            raise TypeError("EngineeringEvidence is immutable after creation.")
        super().__setattr__(name, value)

# Retain EvidenceGraph for legacy compatibility
class EvidenceGraph(BaseModel):
    parameter_id: str
    name: str
    value: Any
    unit: str = "mm"
    feature_id: str
    source_view: Optional[str] = None
    source_page: Optional[int] = None
    source_bbox: Optional[List[float]] = None
    source_text: Optional[str] = None
    association_method: Optional[str] = None
    supporting_rules: List[str] = []
    confidence: float = 1.0
    status: str = "inferred" # confirmed, inferred, ambiguous, missing, requires_user_confirmation
