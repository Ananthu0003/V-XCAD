from typing import Dict, Any, Optional
from app.services.cam.cost_estimation.models import SetupCostDetail

class SetupCostCalculator:
    def calculate(self, setup_time_s: float, machine_profile: Dict[str, Any]) -> SetupCostDetail:
        """
        Calculates setup cost based on setup time and setup rate.
        """
        if not machine_profile:
            raise ValueError("MACHINE_MISSING: No machine profile is assigned to the CAM setup.")
            
        setup_rate = machine_profile.get("setup_rate")
        
        # If setup_rate is not explicitly defined, fallback to hourly_rate if permitted, or error.
        if setup_rate is None:
            setup_rate = machine_profile.get("hourly_rate")
            if setup_rate is None:
                setup_rate = 6720.0 # Fallback to 6720 INR/hr if missing
            
        cost = (setup_time_s / 3600.0) * setup_rate
        
        return SetupCostDetail(
            setup_time_s=setup_time_s,
            setup_rate=setup_rate,
            cost=cost
        )
