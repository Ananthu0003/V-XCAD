from typing import Dict, Any
from app.services.planning.planning_context import PlanningContext
from app.services.cam.cost_estimation.models import CostEstimateResult, TotalCostDetail
from app.services.cam.cost_estimation.material_cost import MaterialCostCalculator
from app.services.cam.cost_estimation.machining_cost import MachiningCostCalculator
from app.services.cam.cost_estimation.setup_cost import SetupCostCalculator

class CostEstimationEngine:
    def __init__(self):
        self.material_calculator = MaterialCostCalculator()
        self.machining_calculator = MachiningCostCalculator()
        self.setup_calculator = SetupCostCalculator()

    def estimate(
        self, 
        context: Any, 
        total_time_s: float, 
        setup_time_s: float, 
        material_profile: Dict[str, Any], 
        machine_profile: Dict[str, Any]
    ) -> CostEstimateResult:
        """
        Orchestrates cost estimation calculation.
        Catches specific missing input errors and returns them as structured diagnostics.
        """
        result = CostEstimateResult(
            status="incomplete",
            currency="INR", # default or derived from profiles
            errors=[],
            warnings=[]
        )
        
        # Determine currency from profiles if available
        if material_profile and "currency" in material_profile:
            result.currency = material_profile["currency"]
        elif machine_profile and "currency" in machine_profile:
            result.currency = machine_profile["currency"]

        try:
            result.material = self.material_calculator.calculate(context, material_profile)
        except ValueError as e:
            err_msg = str(e)
            code = err_msg.split(":")[0] if ":" in err_msg else "MATERIAL_CALCULATION_ERROR"
            result.errors.append({"code": code, "message": err_msg})

        try:
            result.machining = self.machining_calculator.calculate(total_time_s, machine_profile)
        except ValueError as e:
            err_msg = str(e)
            code = err_msg.split(":")[0] if ":" in err_msg else "MACHINING_CALCULATION_ERROR"
            result.errors.append({"code": code, "message": err_msg})

        try:
            result.setup = self.setup_calculator.calculate(setup_time_s, machine_profile)
        except ValueError as e:
            err_msg = str(e)
            code = err_msg.split(":")[0] if ":" in err_msg else "SETUP_CALCULATION_ERROR"
            result.errors.append({"code": code, "message": err_msg})

        if result.errors:
            print(f"[CAM CostEstimation] Errors occurred during estimation: {result.errors}")
            
        if not result.errors:
            result.status = "complete"
            total = 0.0
            if result.material:
                total += result.material.cost
            if result.machining:
                total += result.machining.cost
            if result.setup:
                total += result.setup.cost
                
            result.total = TotalCostDetail(
                material_cost=result.material.cost if result.material else 0.0,
                machining_cost=result.machining.cost if result.machining else 0.0,
                setup_cost=result.setup.cost if result.setup else 0.0,
                total_cost=total
            )

        return result
