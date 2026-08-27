from typing import Dict, Any
from app.services.cam.cost_estimation.models import MachiningCostDetail

class MachiningCostCalculator:
    def calculate(self, total_time_s: float, machine_profile: Dict[str, Any]) -> MachiningCostDetail:
        """
        Calculates per-part machining cost from cycle time and rate composition.
        Resolves rates deterministically: prefers decomposed rates; falls back to legacy
        hourly_rate only if decomposed rates are entirely absent. Never double counts.
        """
        if not machine_profile:
            raise ValueError("MACHINE_MISSING: No machine profile is assigned to the CAM setup.")

        machine_rate = machine_profile.get("machine_rate")
        labor_rate = machine_profile.get("labor_rate")
        overhead_rate = machine_profile.get("overhead_rate")
        hourly_rate = machine_profile.get("hourly_rate")

        has_decomposed = machine_rate is not None or labor_rate is not None or overhead_rate is not None

        if has_decomposed:
            machine_rate = float(machine_rate or 0.0)
            labor_rate = float(labor_rate or 0.0)
            overhead_rate = float(overhead_rate or 0.0)
            hourly_rate_used = machine_rate + labor_rate + overhead_rate
            if hourly_rate_used <= 0:
                raise ValueError("MACHINE_RATE_MISSING: Decomposed rates resolve to zero; provide machine/labor/overhead rates.")
        elif hourly_rate is not None:
            hourly_rate_used = float(hourly_rate)
            machine_rate = hourly_rate_used
            labor_rate = 0.0
            overhead_rate = 0.0
        else:
            raise ValueError("MACHINE_RATE_MISSING: No machine_rate/labor_rate/overhead_rate or hourly_rate provided.")

        cost = (total_time_s / 3600.0) * hourly_rate_used

        return MachiningCostDetail(
            total_time_s=total_time_s,
            machine_rate=machine_rate,
            labor_rate=labor_rate,
            overhead_rate=overhead_rate,
            hourly_rate_used=hourly_rate_used,
            cost=cost
        )
