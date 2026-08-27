import math
from typing import Any, Dict, List, Optional
from app.services.cam.cost_estimation.models import (
    CostEstimateResult,
    QuoteContext,
    TotalCostDetail,
    ManufacturingCostDetail,
    SellingPriceDetail,
)
from app.services.cam.cost_estimation.material_cost import MaterialCostCalculator
from app.services.cam.cost_estimation.machining_cost import MachiningCostCalculator
from app.services.cam.cost_estimation.setup_cost import SetupCostCalculator
from app.services.cam.cost_estimation.energy_cost import EnergyCostCalculator
from app.services.cam.cost_estimation.tooling_cost import ToolingCostCalculator, _op_cutting_time_min
from app.services.cam.cost_estimation.secondary_ops_cost import SecondaryOpsCostCalculator

class CostEstimationEngine:
    def __init__(self):
        self.material_calculator = MaterialCostCalculator()
        self.machining_calculator = MachiningCostCalculator()
        self.setup_calculator = SetupCostCalculator()
        self.energy_calculator = EnergyCostCalculator()
        self.tooling_calculator = ToolingCostCalculator()
        self.secondary_calculator = SecondaryOpsCostCalculator()

    def estimate(self, quote_context: QuoteContext) -> CostEstimateResult:
        """
        Deterministic consumer of the resolved QuoteContext. Computes manufacturing cost
        (material + machining + energy + setup + tooling + secondary) for a lot of `quantity`,
        then derives the selling price via a true profit margin. Never invents missing data.
        """
        ctx = quote_context
        result = CostEstimateResult(
            status="incomplete",
            currency="INR",
            errors=[],
            warnings=[],
            quantity=ctx.quantity,
            learning_rate=ctx.learning_rate,
        )

        if ctx.material_profile and "currency" in ctx.material_profile:
            result.currency = ctx.material_profile["currency"]
        elif ctx.machine_profile and "currency" in ctx.machine_profile:
            result.currency = ctx.machine_profile["currency"]

        try:
            self._validate_boundaries(ctx)
        except ValueError as e:
            result.errors.append({"code": e.args[0].split(":")[0], "message": str(e)})
            return result

        quantity = ctx.quantity
        learning_rate = ctx.learning_rate
        b = math.log2(learning_rate) if 0.0 < learning_rate < 1.0 else 0.0
        lot_time_factor = quantity ** (b + 1.0)
        margin_pct = float(ctx.machine_profile.get("margin_pct", 0.0) or 0.0)

        try:
            result.material = self.material_calculator.calculate(ctx.setup, ctx.material_profile)
        except ValueError as e:
            result.errors.append({"code": self._code(e), "message": str(e)})

        try:
            result.machining = self.machining_calculator.calculate(ctx.cycle_time_s, ctx.machine_profile)
        except ValueError as e:
            result.errors.append({"code": self._code(e), "message": str(e)})

        cutting_time_s = sum(_op_cutting_time_min(op)[0] * 60.0 for op in ctx.operations) \
            if ctx.operations else ctx.cycle_time_s
        energy_detail = self.energy_calculator.calculate(cutting_time_s, ctx.machine_profile)
        if energy_detail is None:
            result.warnings.append({"code": "ENERGY_DATA_MISSING", "message": "avg_power_kw / energy_price_per_kwh not in machine profile; energy cost omitted."})
        else:
            result.energy = energy_detail

        try:
            result.setup = self.setup_calculator.calculate(ctx.setup_time_s, ctx.machine_profile)
        except ValueError as e:
            result.errors.append({"code": self._code(e), "message": str(e)})

        try:
            tooling_detail, tooling_warnings = self.tooling_calculator.calculate(ctx.operations, ctx.tool_library)
            result.tooling = tooling_detail
            result.warnings.extend(tooling_warnings)
        except ValueError as e:
            result.errors.append({"code": self._code(e), "message": str(e)})

        try:
            part_mass = result.material.mass_kg if result.material else 0.0
            secondary_configs = ctx.machine_profile.get("secondary_operations", []) or []
            result.secondary = self.secondary_calculator.calculate(
                secondary_configs, quantity, part_mass, ctx.surface_area_dm2, ctx.feature_count
            )
        except ValueError as e:
            result.errors.append({"code": self._code(e), "message": str(e)})

        if result.errors:
            return result

        material_lot = result.material.cost * quantity
        machining_lot = result.machining.cost * lot_time_factor
        energy_lot = (result.energy.cost if result.energy else 0.0) * lot_time_factor
        tooling_lot = result.tooling.total * lot_time_factor
        setup_lot = result.setup.cost

        secondary_lot = result.secondary.per_batch_total + (result.secondary.per_part_total * quantity)

        mfg_lot = material_lot + machining_lot + energy_lot + tooling_lot + setup_lot + secondary_lot
        mfg_per_part = mfg_lot / quantity

        result.manufacturing_cost = ManufacturingCostDetail(
            material_cost=material_lot,
            machining_cost=machining_lot,
            energy_cost=energy_lot,
            setup_cost=setup_lot / quantity,
            tooling_cost=tooling_lot,
            secondary_cost=secondary_lot,
            per_part=mfg_per_part,
            lot=mfg_lot,
        )

        if margin_pct >= 1.0:
            result.errors.append({"code": "MARGIN_INVALID", "message": f"margin_pct must be < 1.0 (got {margin_pct})."})
            return result

        selling_lot = mfg_lot / (1.0 - margin_pct)
        profit = selling_lot - mfg_lot

        result.selling_price = SellingPriceDetail(
            margin_pct=margin_pct,
            manufacturing_lot=mfg_lot,
            profit=profit,
            lot=selling_lot,
            per_unit=selling_lot / quantity,
        )

        result.total = TotalCostDetail(
            material_cost=material_lot,
            machining_cost=machining_lot,
            setup_cost=setup_lot,
            total_cost=mfg_lot,
        )

        result.status = "complete"
        return result

    @staticmethod
    def _code(err: ValueError) -> str:
        msg = str(err)
        return msg.split(":")[0] if ":" in msg else "ESTIMATION_ERROR"

    @staticmethod
    def _validate_boundaries(ctx: QuoteContext) -> None:
        if ctx.quantity is None or not isinstance(ctx.quantity, int) or ctx.quantity < 1:
            raise ValueError(f"QUANTITY_INVALID: quantity must be an integer >= 1 (got {ctx.quantity}).")
        if ctx.learning_rate is not None and (ctx.learning_rate <= 0):
            raise ValueError(f"LEARNING_RATE_INVALID: learning_rate must be > 0 (got {ctx.learning_rate}).")
