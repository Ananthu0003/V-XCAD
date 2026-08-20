"""
Engineering Parameter Models for Technical Drawing Analysis & Parametric CAD Pipeline.

Defines strongly typed, Pydantic v2 schemas for:
- Dimensions (linear, diameter, radius, depth, width, axial position, etc.)
- Tolerances (symmetric, deviational, limits, ISO fits e.g. H8/h8/h11, basic, general)
- Angular dimensions & transitions
- Chamfer & Fillet specifications with angles and multiplicities
- GD&T Feature Control Frames & Datums
- Surface finishes & roughness (Ra, Rz)
- Material & stock specifications (shapes, tolerances, standards)
- Surface treatments (hard anodizing, plating, hardness, thickness)
- Manufacturing requirements & notes
- Functional & inspection characteristics (mass, wetted surface, sealing area)
- General tolerance tables
- Comprehensive DrawingBlueprintAudit container & TraceabilityReport
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Dict, List, Literal, Optional, Tuple
from pydantic import BaseModel, ConfigDict, Field


# ─── TOLERANCE SCHEMAS ──────────────────────────────────────────────────────────

class ToleranceType(str, Enum):
    SYMMETRIC = "symmetric"          # ±0.1, +/-0.2
    DEVIATIONAL = "deviational"      # +0.2/-0.1, +0.02/0, 0/-0.033
    LIMITS = "limits"                # 25.5 / 25.3
    ISO_FIT = "iso_fit"              # H8, h8, h11, H7, g6
    BASIC = "basic"                  # [25.0] (theoretically exact for GD&T)
    MIN_ONLY = "min_only"            # MIN 5.0
    MAX_ONLY = "max_only"            # MAX 10.0
    REFERENCE = "reference"          # (25.0) reference dimension
    UNSPECIFIED = "unspecified"      # Governed by general tolerance table


class Tolerance(BaseModel):
    model_config = ConfigDict(extra="ignore")

    type: ToleranceType = ToleranceType.UNSPECIFIED
    upper: Optional[float] = None
    lower: Optional[float] = None
    nominal: Optional[float] = None
    fit_grade: Optional[str] = None       # e.g. "H8", "h8", "h11"
    raw_text: Optional[str] = None
    standard: Optional[str] = None       # e.g. "ISO 286", "ISO 2768-m"

    def is_bounded(self) -> bool:
        return self.upper is not None and self.lower is not None

    def span(self) -> Optional[float]:
        if self.upper is not None and self.lower is not None:
            return float(self.upper - self.lower)
        return None

    def calculate_bounds(self, nominal: Optional[float] = None) -> Tuple[Optional[float], Optional[float]]:
        nom = self.nominal if nominal is None else nominal
        if nom is None:
            return self.lower, self.upper
        low = nom + self.lower if self.lower is not None else nom
        high = nom + self.upper if self.upper is not None else nom
        return min(low, high), max(low, high)


# ─── DIMENSION SCHEMAS ────────────────────────────────────────────────────────

class DimensionType(str, Enum):
    LINEAR = "linear"
    DIAMETER = "diameter"
    RADIUS = "radius"
    ANGLE = "angle"
    DEPTH = "depth"
    WIDTH = "width"
    LENGTH = "length"
    OFFSET = "offset"
    AXIAL_POSITION = "axial_position"
    CHAMFER = "chamfer"
    FILLET = "fillet"
    TAPER = "taper"
    PITCH = "pitch"
    WALL_THICKNESS = "wall_thickness"
    SPACING = "spacing"
    COORDINATE = "coordinate"
    OVERALL = "overall"


class GenericDimension(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: "")
    dimension_type: DimensionType = DimensionType.LINEAR
    nominal_value: float
    unit: str = "mm"
    tolerance: Optional[Tolerance] = None
    feature_id: Optional[str] = None
    geometry_reference: Optional[str] = None
    source_annotation: Optional[str] = None
    source_view: Optional[str] = None
    balloon_number: Optional[int] = None
    multiplicity: int = 1
    is_reference: bool = False
    is_basic: bool = False
    confidence: float = 1.0


class DiameterKind(str, Enum):
    OUTER = "outer"
    INNER = "inner"
    BORE = "bore"
    SHAFT = "shaft"
    GROOVE = "groove"
    FLANGE = "flange"
    RECESS = "recess"
    PITCH = "pitch"
    ROOT = "root"
    UNSPECIFIED = "unspecified"


class DiameterParameter(GenericDimension):
    dimension_type: DimensionType = DimensionType.DIAMETER
    diameter_kind: DiameterKind = DiameterKind.UNSPECIFIED
    is_inner: Optional[bool] = None


class RadiusKind(str, Enum):
    FILLET = "fillet"
    CORNER = "corner"
    SPHERICAL = "spherical"
    BEND = "bend"
    GROOVE_ROOT = "groove_root"
    UNSPECIFIED = "unspecified"


class RadiusParameter(GenericDimension):
    dimension_type: DimensionType = DimensionType.RADIUS
    radius_kind: RadiusKind = RadiusKind.UNSPECIFIED


class AngularParameter(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: "")
    angle_value: float
    unit: str = "deg"
    tolerance: Optional[Tolerance] = None
    feature_id: Optional[str] = None
    angle_kind: str = "unspecified"
    source_annotation: Optional[str] = None
    source_view: Optional[str] = None
    confidence: float = 1.0


class ChamferParameter(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: "")
    size: float
    angle: float = 45.0
    unit: str = "mm"
    angle_unit: str = "deg"
    tolerance: Optional[Tolerance] = None
    angle_tolerance: Optional[Tolerance] = None
    feature_id: Optional[str] = None
    target_edge: Optional[str] = None
    source_annotation: Optional[str] = None
    source_view: Optional[str] = None
    confidence: float = 1.0


class FilletParameter(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: "")
    radius: float
    multiplicity: int = 1
    unit: str = "mm"
    tolerance: Optional[Tolerance] = None
    feature_id: Optional[str] = None
    target_edge: Optional[str] = None
    source_annotation: Optional[str] = None
    source_view: Optional[str] = None
    confidence: float = 1.0


# ─── GD&T AND DATUM SCHEMAS ───────────────────────────────────────────────────

class GDNTType(str, Enum):
    POSITION = "position"
    CONCENTRICITY = "concentricity"
    COAXIALITY = "coaxiality"
    PERPENDICULARITY = "perpendicularity"
    PARALLELISM = "parallelism"
    ANGULARITY = "angularity"
    FLATNESS = "flatness"
    STRAIGHTNESS = "straightness"
    CIRCULARITY = "circularity"
    CYLINDRICITY = "cylindricity"
    PROFILE_LINE = "profile_line"
    PROFILE_SURFACE = "profile_surface"
    CIRCULAR_RUNOUT = "circular_runout"
    TOTAL_RUNOUT = "total_runout"
    SYMMETRY = "symmetry"


class MaterialCondition(str, Enum):
    RFS = "RFS"  # Regardless of Feature Size (default)
    MMC = "MMC"  # Maximum Material Condition (Ⓖ/Ⓜ)
    LMC = "LMC"  # Least Material Condition (Ⓛ)


class GDNTCallout(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: "")
    gdnt_type: GDNTType
    tolerance_value: float
    diameter_zone: bool = False
    material_condition: MaterialCondition = MaterialCondition.RFS
    datum_references: List[str] = Field(default_factory=list)
    target_feature: Optional[str] = None
    target_face_or_axis: Optional[str] = None
    source_annotation: Optional[str] = None
    source_view: Optional[str] = None
    confidence: float = 1.0


class DatumDefinition(BaseModel):
    model_config = ConfigDict(extra="ignore")

    datum_id: str                          # e.g. "A", "B", "C"
    datum_type: Literal["face", "axis", "cylinder", "plane", "centerline", "point", "pattern", "unspecified"] = "face"
    referenced_feature: Optional[str] = None
    referenced_geometry: Optional[str] = None
    source_location: Optional[str] = None
    source_view: Optional[str] = None
    confidence: float = 1.0


# ─── SURFACE FINISH SCHEMAS ───────────────────────────────────────────────────

class SurfaceFinish(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: "")
    roughness_type: Literal["Ra", "Rz", "Rq", "Ry", "unspecified"] = "Ra"
    value: float
    unit: str = "µm"
    target_face_or_feature: Optional[str] = None
    source_annotation: Optional[str] = None
    source_view: Optional[str] = None
    is_default: bool = False
    confidence: float = 1.0


# ─── MATERIAL & STOCK SCHEMAS ─────────────────────────────────────────────────

class MaterialSpecification(BaseModel):
    model_config = ConfigDict(extra="ignore")

    material_name: str
    material_standard: Optional[str] = None    # e.g. "EN-AW", "AISI", "DIN", "ASTM"
    grade_or_temper: Optional[str] = None      # e.g. "T6", "4140", "304"
    raw_text: Optional[str] = None
    density_gcm3: Optional[float] = None
    hardness: Optional[str] = None
    source_location: Optional[str] = None
    confidence: float = 1.0


class StockSpecification(BaseModel):
    model_config = ConfigDict(extra="ignore")

    shape: Literal["round_bar", "bright_bar", "hex_bar", "tube", "plate", "block", "forging", "casting", "custom", "unspecified"] = "unspecified"
    nominal_size: Optional[str] = None         # e.g. "Ø25", "50x50", "Ø50"
    nominal_diameter: Optional[float] = None
    nominal_length: Optional[float] = None
    tolerance_class: Optional[str] = None      # e.g. "h11", "H8"
    upper_tolerance: Optional[float] = None
    lower_tolerance: Optional[float] = None
    raw_text: Optional[str] = None
    confidence: float = 1.0


# ─── SURFACE TREATMENT & MANUFACTURING REQUIREMENTS ───────────────────────────

class SurfaceTreatment(BaseModel):
    model_config = ConfigDict(extra="ignore")

    treatment_type: str                        # e.g. "hard_anodizing", "black_oxide", "nitriding", "passivation"
    process_requirement: Optional[str] = None  # e.g. "MIL-A-8625 Type III Class 1"
    thickness_nominal_um: Optional[float] = None
    thickness_min_um: Optional[float] = None
    thickness_max_um: Optional[float] = None
    thickness_tolerance: Optional[str] = None  # e.g. "±5 µm"
    hardness: Optional[str] = None             # e.g. "HV > 400"
    target_region: Optional[str] = None
    raw_text: Optional[str] = None
    source_location: Optional[str] = None
    confidence: float = 1.0


class ManufacturingRequirement(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: "")
    requirement_type: Literal[
        "deburring",
        "edge_finishing",
        "cleaning",
        "heat_treatment",
        "inspection",
        "packaging",
        "marking",
        "general_note",
        "critical_characteristic",
    ] = "general_note"
    text: str
    target_feature: Optional[str] = None
    source_location: Optional[str] = None
    confidence: float = 1.0


class FunctionalCharacteristic(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: "")
    characteristic_type: Literal[
        "mass",
        "wetted_surface",
        "sealing_area",
        "gasket_working_area",
        "volume",
        "cleanliness",
        "proof_pressure",
        "custom",
    ] = "custom"
    value: Optional[float] = None
    unit: Optional[str] = None
    description: str = ""
    target_feature_or_region: Optional[str] = None
    source_annotation: Optional[str] = None
    confidence: float = 1.0


# ─── GENERAL TOLERANCE SCHEMAS ────────────────────────────────────────────────

class GeneralToleranceRule(BaseModel):
    model_config = ConfigDict(extra="ignore")

    nominal_min: float
    nominal_max: float
    tolerance: float
    unit: str = "mm"


class GeneralToleranceTable(BaseModel):
    model_config = ConfigDict(extra="ignore")

    table_type: Literal["linear", "angular", "broken_edges", "unspecified"] = "linear"
    standard: Optional[str] = None             # e.g. "ISO 2768-m", "DIN 7168"
    precision_class: Optional[str] = None      # e.g. "fine", "medium", "coarse", "very_coarse"
    rules: List[GeneralToleranceRule] = Field(default_factory=list)
    angular_rules: List[GeneralToleranceRule] = Field(default_factory=list)
    raw_text: Optional[str] = None

    def lookup_linear(self, nominal: float) -> Optional[float]:
        for rule in self.rules:
            if rule.nominal_min <= nominal <= rule.nominal_max:
                return rule.tolerance
            if rule.nominal_min < nominal <= rule.nominal_max:
                return rule.tolerance
        return None

    def get_tolerance(self, nominal: float) -> Optional[float]:
        return self.lookup_linear(nominal)


# ─── COMPREHENSIVE BLUEPRINT AUDIT CONTAINER ──────────────────────────────────

class FeatureExtractionRecord(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    type: str
    description: str = ""
    dims: Dict[str, Any] = Field(default_factory=dict)
    location: Dict[str, Any] = Field(default_factory=dict)
    is_subtractive: bool = False
    parent_id: Optional[str] = None
    source_view: Optional[str] = None
    surface_finish: Optional[str] = None
    surface_finish_parsed: Optional[SurfaceFinish] = None
    dimensional_tolerances: Dict[str, Any] = Field(default_factory=dict)
    tolerances_parsed: Dict[str, Tolerance] = Field(default_factory=dict)
    chamfers: List[ChamferParameter] = Field(default_factory=list)
    fillets: List[FilletParameter] = Field(default_factory=list)
    angles: List[AngularParameter] = Field(default_factory=list)
    gdt_refs: List[str] = Field(default_factory=list)
    datum_refs: List[str] = Field(default_factory=list)
    balloon_numbers: List[int] = Field(default_factory=list)
    thread: Optional[Dict[str, Any]] = None
    confidence: str = "verified"


class DrawingBlueprintAudit(BaseModel):
    """
    Comprehensive structured representation of all engineering parameters extracted from a blueprint.
    """
    model_config = ConfigDict(extra="ignore")

    audit_schema_version: str = "engineering-v1"
    units: str = "mm"
    origin_point: List[float] = Field(default_factory=lambda: [0.0, 0.0, 0.0])
    origin_rationale: str = ""
    
    # Material & Stock
    material: Optional[str] = None
    material_parsed: Optional[MaterialSpecification] = None
    stock: Optional[StockSpecification] = None
    
    # Surface Treatments & Notes
    surface_treatments: List[Any] = Field(default_factory=list)
    surface_treatments_parsed: List[SurfaceTreatment] = Field(default_factory=list)
    manufacturing_requirements: List[ManufacturingRequirement] = Field(default_factory=list)
    functional_characteristics: List[FunctionalCharacteristic] = Field(default_factory=list)
    
    # Tolerances & Standards
    general_tolerances: Optional[str] = None
    general_tolerance_table: Optional[GeneralToleranceTable] = None
    
    # GD&T & Datums
    gdt_callouts: List[Dict[str, Any]] = Field(default_factory=list)
    gdt_callouts_parsed: List[GDNTCallout] = Field(default_factory=list)
    datums: List[DatumDefinition] = Field(default_factory=list)
    
    # Surface Roughness
    surface_finishes: List[SurfaceFinish] = Field(default_factory=list)
    
    # Geometry & Features
    envelope: Dict[str, float] = Field(default_factory=dict)
    primary_datum: Dict[str, Any] = Field(default_factory=dict)
    features: List[FeatureExtractionRecord] = Field(default_factory=list)
    patterns: List[Dict[str, Any]] = Field(default_factory=list)
    
    # All Dimensional Callouts with Grounding
    all_dimensions: List[GenericDimension] = Field(default_factory=list)
    all_chamfers: List[ChamferParameter] = Field(default_factory=list)
    all_fillets: List[FilletParameter] = Field(default_factory=list)
    all_angles: List[AngularParameter] = Field(default_factory=list)
    
    # Multi-View Hierarchy
    views: List[Dict[str, Any]] = Field(default_factory=list)
    view_relationships: List[Dict[str, Any]] = Field(default_factory=list)


# ─── TRACEABILITY & VALIDATION REPORT ─────────────────────────────────────────

class TraceabilityItem(BaseModel):
    model_config = ConfigDict(extra="ignore")

    category: str = "dimension"
    raw_callout: Optional[str] = None
    source_annotation: Optional[str] = None
    extracted_parameter: Optional[str] = None
    nominal_value: Any = None
    tolerance_info: Optional[str] = None
    associated_feature: Optional[str] = None
    feature_id: Optional[str] = None
    target_geometry: Optional[str] = None
    cam_feature_type: Optional[str] = None
    is_mapped: bool = True
    status: Literal["mapped", "unmapped", "unresolved", "discarded", "warning"] = "mapped"
    confidence: float = 1.0
    notes: Optional[str] = None


class TraceabilityReport(BaseModel):
    model_config = ConfigDict(extra="ignore")

    mapped_parameters: List[TraceabilityItem] = Field(default_factory=list)
    unmapped_annotations: List[TraceabilityItem] = Field(default_factory=list)
    unresolved_parameters: List[TraceabilityItem] = Field(default_factory=list)
    is_fully_resolved: bool = True
    extracted_parameter_count: int = 0
    associated_parameter_count: int = 0
    unresolved_dimensions: List[Dict[str, Any]] = Field(default_factory=list)
    unassociated_dimensions: List[Dict[str, Any]] = Field(default_factory=list)
    unmapped_gdnt: List[Dict[str, Any]] = Field(default_factory=list)
    unmapped_datums: List[Dict[str, Any]] = Field(default_factory=list)
    unmapped_surface_finishes: List[Dict[str, Any]] = Field(default_factory=list)
    unmapped_material: bool = False
    unmapped_manufacturing_notes: List[Dict[str, Any]] = Field(default_factory=list)
    geometry_feature_association_failures: List[Dict[str, Any]] = Field(default_factory=list)
    traceability_matrix: List[TraceabilityItem] = Field(default_factory=list)
    is_valid: bool = True
    warnings: List[str] = Field(default_factory=list)
    errors: List[str] = Field(default_factory=list)
