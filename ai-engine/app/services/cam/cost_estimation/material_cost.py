import math
from typing import Dict, Any, Tuple
from app.services.cam.cost_estimation.models import MaterialCostDetail
from app.services.planning.planning_context import PlanningContext

class MaterialCostCalculator:
    def calculate(self, context: Any, material_profile: Dict[str, Any]) -> MaterialCostDetail:
        """
        Calculates material cost using actual CAM stock geometry from Setup.
        Uses enhanced cost strategy including markup and scrap recovery.
        """
        setup = context.setup if hasattr(context, "setup") else (context or {})
        
        dims = setup.get("stockDimensions")
        if not dims or len(dims) < 3:
            # Fallback to individual fields from web-ui
            l = setup.get("stock_length")
            w = setup.get("stock_width")
            h = setup.get("stock_height")
            if l and w and h:
                dims = [l, w, h]
            else:
                raise ValueError("STOCK_GEOMETRY_MISSING: Valid stockDimensions or length/width/height are required for material cost estimation.")
            
        dx = float(dims[0])
        dy = float(dims[1])
        dz = float(dims[2])
        
        stock_type = str(setup.get("stockType", "")).lower()
        
        if stock_type in ("cylinder", "relative_cylinder", "fixed_cylinder"):
            radius = min(dx, dy) / 2.0
            stock_volume_mm3 = math.pi * (radius ** 2) * dz
        else:
            stock_volume_mm3 = dx * dy * dz
            
        if stock_volume_mm3 <= 0:
            raise ValueError("STOCK_GEOMETRY_INVALID: Computed stock volume must be greater than zero.")
            
        if not material_profile:
            raise ValueError("MATERIAL_MISSING: No material profile is assigned to the CAM setup.")
            
        # Allow dynamic overrides from the setup payload if they exist, otherwise fallback to material_profile
        density_g_cm3 = setup.get("density_g_cm3") or material_profile.get("density_gcm3") or material_profile.get("density_g_cm3") or material_profile.get("densityGcm3")
        cost_per_kg = setup.get("cost_per_kg") or material_profile.get("cost_per_kg") or material_profile.get("costPerKg")
        
        if density_g_cm3 is None or cost_per_kg is None:
            # Add a fallback for default missing materials so it doesn't fail outright
            density_g_cm3 = float(density_g_cm3 or 2.7)
            cost_per_kg = float(cost_per_kg or 420.0)
            
        stock_mass_kg = (stock_volume_mm3 * density_g_cm3) / 1000000.0
        base_material_cost = stock_mass_kg * float(cost_per_kg)
        
        # 1. Add Material Markup (e.g. 20% margin)
        markup_factor = 1.20
        gross_material_cost = base_material_cost * markup_factor
        
        # 2. Finished part volume is optional; if provided we can include Scrap Recovery
        part_volume_mm3 = setup.get("partVolumeMm3") 
        removed_volume_mm3 = None
        scrap_recovery_value = 0.0
        
        if part_volume_mm3:
            removed_volume_mm3 = stock_volume_mm3 - float(part_volume_mm3)
            if removed_volume_mm3 > 0:
                scrap_mass_kg = (removed_volume_mm3 * float(density_g_cm3)) / 1000000.0
                
                # Determine scrap value rate (typically 10-15% for non-ferrous, 5% for steels)
                category = str(material_profile.get("category", "")).lower()
                recovery_rate = 0.15 if "aluminum" in category or "copper" in category or "brass" in category else 0.05
                
                scrap_recovery_value = scrap_mass_kg * float(cost_per_kg) * recovery_rate
        
        # Final net material cost
        net_material_cost = gross_material_cost - scrap_recovery_value
        
        return MaterialCostDetail(
            stock_volume_mm3=stock_volume_mm3,
            part_volume_mm3=part_volume_mm3,
            removed_volume_mm3=removed_volume_mm3,
            density_g_cm3=float(density_g_cm3),
            mass_kg=stock_mass_kg,
            cost_per_kg=float(cost_per_kg),
            cost=net_material_cost
        )
