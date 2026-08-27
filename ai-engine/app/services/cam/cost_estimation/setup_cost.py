from typing import Dict, Any
from app.services.cam.cost_estimation.models import SetupCostDetail

class SetupCostCalculator:
    def calculate(self, setup_time_s: float, machine_profile: Dict[str, Any]) -> SetupCostDetail:
        """
        Calculates per-BATCH setup cost with optional minimum charge (batch rule headroom).
        Setup cost is charged once per batch and amortized by the engine over quantity.
        """
        if not machine_profile:
            raise ValueError("MACHINE_MISSING: No machine profile is assigned to the CAM setup.")

        setup_rate = machine_profile.get("setup_rate")
        if setup_rate is None:
            setup_rate = machine_profile.get("hourly_rate")
        if setup_rate is None:
            raise ValueError("SETUP_RATE_MISSING: No setup_rate or hourly_rate provided for setup cost.")

        setup_rate = float(setup_rate)
        min_setup_charge = float(machine_profile.get("min_setup_charge", 0.0) or 0.0)

        computed = (setup_time_s / 3600.0) * setup_rate
        cost = max(computed, min_setup_charge)

        return SetupCostDetail(
            setup_time_s=setup_time_s,
            setup_rate=setup_rate,
            min_setup_charge=min_setup_charge,
            cost=cost
        )
