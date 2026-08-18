from typing import Optional
from pydantic import BaseModel

class MaterialCostDetail(BaseModel):
    stock_volume_mm3: float
    part_volume_mm3: Optional[float] = None
    removed_volume_mm3: Optional[float] = None
    density_g_cm3: float
    mass_kg: float
    cost_per_kg: float
    cost: float

class MachiningCostDetail(BaseModel):
    cutting_time_s: Optional[float] = None
    rapid_time_s: Optional[float] = None
    tool_change_time_s: Optional[float] = None
    dwell_time_s: Optional[float] = None
    total_time_s: float
    hourly_rate: float
    cost: float

class SetupCostDetail(BaseModel):
    setup_time_s: float
    setup_rate: float
    cost: float

class TotalCostDetail(BaseModel):
    material_cost: float
    machining_cost: float
    setup_cost: float
    total_cost: float

class CostEstimateResult(BaseModel):
    status: str
    currency: str
    material: Optional[MaterialCostDetail] = None
    machining: Optional[MachiningCostDetail] = None
    setup: Optional[SetupCostDetail] = None
    total: Optional[TotalCostDetail] = None
    errors: list[dict[str, str]] = []
    warnings: list[dict[str, str]] = []
