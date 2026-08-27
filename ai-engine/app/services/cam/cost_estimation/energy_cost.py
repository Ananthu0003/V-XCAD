from typing import Dict, Any, Optional
from app.services.cam.cost_estimation.models import EnergyCostDetail

class EnergyCostCalculator:
    def calculate(self, cutting_time_s: float, machine_profile: Dict[str, Any]) -> Optional[EnergyCostDetail]:
        """
        Calculates per-part energy cost from AVERAGE power draw (not rated spindle power).
        Returns None + appends a warning when energy data is missing (never invents it).
        """
        avg_power_kw = machine_profile.get("avg_power_kw")
        energy_price = machine_profile.get("energy_price_per_kwh")

        if avg_power_kw is None or energy_price is None:
            return None  # caller records a warning; energy is omitted, not guessed

        avg_power_kw = float(avg_power_kw)
        energy_price = float(energy_price)
        if avg_power_kw <= 0 or energy_price < 0:
            return None

        energy_kwh = (cutting_time_s / 3600.0) * avg_power_kw
        cost = energy_kwh * energy_price

        return EnergyCostDetail(
            avg_power_kw=avg_power_kw,
            energy_price_per_kwh=energy_price,
            energy_kwh=energy_kwh,
            cost=cost
        )
