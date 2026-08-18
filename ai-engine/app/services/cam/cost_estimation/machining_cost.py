from typing import Dict, Any, Optional
from app.services.cam.cost_estimation.models import MachiningCostDetail

class MachiningCostCalculator:
    def calculate(self, total_time_s: float, machine_profile: Dict[str, Any]) -> MachiningCostDetail:
        """
        Calculates machining cost using the aggregated total cycle time.
        """
        if not machine_profile:
            raise ValueError("MACHINE_MISSING: No machine profile is assigned to the CAM setup.")
            
        hourly_rate = machine_profile.get("hourly_rate")
        
        if hourly_rate is None:
            hourly_rate = 8400.0 # Fallback to 8400 INR/hr if missing
            
        cost = (total_time_s / 3600.0) * hourly_rate
        
        return MachiningCostDetail(
            total_time_s=total_time_s,
            hourly_rate=hourly_rate,
            cost=cost
        )
