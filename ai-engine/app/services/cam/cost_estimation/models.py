from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# QuoteContext: the fully-resolved bundle the estimator consumes.
# The estimator NEVER resolves or invents data; it only reads from here.
# ---------------------------------------------------------------------------
class QuoteContext(BaseModel):
    setup: Dict[str, Any] = Field(default_factory=dict)           # stock geometry, part volume, surface area, etc.
    material_profile: Dict[str, Any] = Field(default_factory=dict)
    machine_profile: Dict[str, Any] = Field(default_factory=dict)
    tool_library: List[Dict[str, Any]] = Field(default_factory=list)
    operations: List[Dict[str, Any]] = Field(default_factory=list)
    quantity: int = 1
    learning_rate: float = 1.0   # 1.0 == no learning curve
    surface_area_dm2: Optional[float] = None
    feature_count: Optional[int] = None
    # Resolved times (single-part), provided by the pipeline, never computed by the estimator.
    cycle_time_s: float = 0.0
    setup_time_s: float = 0.0

# ---------------------------------------------------------------------------
# Component detail models
# ---------------------------------------------------------------------------
class MaterialCostDetail(BaseModel):
    stock_volume_mm3: float
    part_volume_mm3: Optional[float] = None
    removed_volume_mm3: Optional[float] = None
    density_g_cm3: float
    mass_kg: float
    cost_per_kg: float
    markup_pct: float
    scrap_recovery_value: float = 0.0
    cost: float   # per-part material cost (after markup, minus scrap)

class MachiningCostDetail(BaseModel):
    total_time_s: float
    machine_rate: float
    labor_rate: float
    overhead_rate: float
    hourly_rate_used: float   # combined running rate actually applied
    cost: float               # per-part machining cost (no learning applied yet)

class EnergyCostDetail(BaseModel):
    avg_power_kw: float
    energy_price_per_kwh: float
    energy_kwh: float
    cost: float               # per-part energy cost (no learning applied yet)

class SetupCostDetail(BaseModel):
    setup_time_s: float
    setup_rate: float
    min_setup_charge: float
    cost: float               # per-BATCH setup cost (amortized by engine)

class ToolingItemDetail(BaseModel):
    tool_id: str
    tool_name: str
    cutting_time_min: float
    tool_life_min: Optional[float] = None
    tool_cost: float
    wear_cost: float
    holder_cost: float = 0.0
    holder_life_min: Optional[float] = None
    holder_amort: float = 0.0

class ToolingCostDetail(BaseModel):
    items: List[ToolingItemDetail] = Field(default_factory=list)
    total: float = 0.0        # per-part tooling cost (no learning applied yet)

class SecondaryOpDetail(BaseModel):
    id: str
    name: str
    basis: str
    value: float
    computed_cost: float      # per-part (or per-batch) cost depending on basis

class SecondaryCostDetail(BaseModel):
    items: List[SecondaryOpDetail] = Field(default_factory=list)
    per_part_total: float = 0.0
    per_batch_total: float = 0.0

class ManufacturingCostDetail(BaseModel):
    material_cost: float
    machining_cost: float
    energy_cost: float
    setup_cost: float          # amortized per-part
    tooling_cost: float
    secondary_cost: float
    per_part: float
    lot: float

class SellingPriceDetail(BaseModel):
    margin_pct: float
    manufacturing_lot: float
    profit: float
    lot: float
    per_unit: float

class TotalCostDetail(BaseModel):
    # Retained for backward-compatible consumers; equals manufacturing lot cost.
    material_cost: float
    machining_cost: float
    setup_cost: float
    total_cost: float

class CostEstimateResult(BaseModel):
    status: str   # "complete" | "incomplete"
    currency: str
    quantity: int = 1
    learning_rate: float = 1.0
    material: Optional[MaterialCostDetail] = None
    machining: Optional[MachiningCostDetail] = None
    energy: Optional[EnergyCostDetail] = None
    setup: Optional[SetupCostDetail] = None
    tooling: Optional[ToolingCostDetail] = None
    secondary: Optional[SecondaryCostDetail] = None
    manufacturing_cost: Optional[ManufacturingCostDetail] = None
    selling_price: Optional[SellingPriceDetail] = None
    # Legacy aggregate (manufacturing lot)
    total: Optional[TotalCostDetail] = None
    errors: List[Dict[str, str]] = Field(default_factory=list)
    warnings: List[Dict[str, str]] = Field(default_factory=list)
