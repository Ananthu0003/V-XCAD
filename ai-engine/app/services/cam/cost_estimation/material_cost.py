import math
from typing import Dict, Any
from app.services.cam.cost_estimation.models import MaterialCostDetail
from app.constants import CYLINDRICAL_STOCK_TYPES

class MaterialCostCalculator:
    def calculate(self, setup: Dict[str, Any], material_profile: Dict[str, Any]) -> MaterialCostDetail:
        """
        Calculates per-part material cost from already-resolved stock geometry and material profile.
        Never invents missing geometry or pricing; raises ValueError on gaps.
        """
        if not material_profile:
            raise ValueError("MATERIAL_MISSING: No material profile is assigned to the CAM setup.")

        resolved_stock = setup.get("resolvedStock") if isinstance(setup.get("resolvedStock"), dict) else {}
        stock_type = str(setup.get("stockType") or resolved_stock.get("stockType") or "").lower()
        is_cylindrical = stock_type in CYLINDRICAL_STOCK_TYPES

        dims = setup.get("stockDimensions")
        if not dims and resolved_stock.get("dimensions"):
            dims = list(resolved_stock["dimensions"])
        elif not dims and resolved_stock.get("bounds"):
            b = resolved_stock["bounds"]
            if "min" in b and "max" in b:
                dims = [
                    abs(float(b["max"][0]) - float(b["min"][0])),
                    abs(float(b["max"][1]) - float(b["min"][1])),
                    abs(float(b["max"][2]) - float(b["min"][2])),
                ]

        if is_cylindrical:
            cyl_dia = setup.get("cylinderDiameter")
            cyl_len = setup.get("cylinderLength")
            if cyl_dia is not None and cyl_len is not None and float(cyl_dia) > 0 and float(cyl_len) > 0:
                dia = float(cyl_dia)
                length = float(cyl_len)
            elif dims and len(dims) == 2:
                dia = float(dims[0])
                length = float(dims[1])
            elif dims and len(dims) >= 3:
                dx, dy, dz = float(dims[0]), float(dims[1]), float(dims[2])
                axis = str(setup.get("stockAxis") or setup.get("axis") or "z").lower()
                if axis == "x":
                    length = dx
                    dia = max(dy, dz)
                elif axis == "y":
                    length = dy
                    dia = max(dx, dz)
                elif axis == "z":
                    length = dz
                    dia = max(dx, dy)
                else:
                    if dx == dy and dx != dz:
                        dia, length = dx, dz
                    elif dy == dz and dy != dx:
                        dia, length = dy, dx
                    elif dx == dz and dx != dy:
                        dia, length = dx, dy
                    else:
                        dia = min(dx, dy)
                        length = dz
            else:
                l = setup.get("stock_length")
                w = setup.get("stock_width")
                h = setup.get("stock_height")
                if l and w and h:
                    dia = max(float(l), float(w))
                    length = float(h)
                else:
                    raise ValueError("STOCK_GEOMETRY_MISSING: Valid stockDimensions or cylinderDiameter/cylinderLength are required for material cost estimation.")

            if dia <= 0 or length <= 0:
                raise ValueError("STOCK_GEOMETRY_INVALID: Computed cylindrical stock diameter and length must be greater than zero.")

            radius = dia / 2.0
            stock_volume_mm3 = math.pi * (radius ** 2) * length
        else:
            if not dims or len(dims) < 3:
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
            stock_volume_mm3 = dx * dy * dz

        if stock_volume_mm3 <= 0:
            raise ValueError("STOCK_GEOMETRY_INVALID: Computed stock volume must be greater than zero.")

        density_g_cm3 = setup.get("density_g_cm3") or setup.get("densityGcm3") or material_profile.get("densityGcm3") or material_profile.get("density_gcm3") or material_profile.get("density_g_cm3")
        cost_per_kg = setup.get("cost_per_kg") or setup.get("costPerKg") or material_profile.get("cost_per_kg") or material_profile.get("costPerKg")
        if density_g_cm3 is None or cost_per_kg is None:
            raise ValueError("MATERIAL_PRICING_MISSING: density and cost_per_kg must be present in the material profile (no silent defaults).")

        density_g_cm3 = float(density_g_cm3)
        cost_per_kg = float(cost_per_kg)

        markup_pct = float(material_profile.get("material_markup_pct", 0.0) or 0.0)

        stock_mass_kg = (stock_volume_mm3 * density_g_cm3) / 1000000.0
        base_material_cost = stock_mass_kg * cost_per_kg
        gross_material_cost = base_material_cost * (1.0 + markup_pct)

        part_volume_mm3 = setup.get("partVolumeMm3") or setup.get("part_volume_mm3") or setup.get("partVolume") or setup.get("volume")
        removed_volume_mm3 = None
        scrap_recovery_value = 0.0

        if part_volume_mm3:
            removed_volume_mm3 = stock_volume_mm3 - float(part_volume_mm3)
            if removed_volume_mm3 > 0:
                scrap_mass_kg = (removed_volume_mm3 * density_g_cm3) / 1000000.0
                category = str(material_profile.get("category", "")).lower()
                recovery_rate = 0.15 if "aluminum" in category or "copper" in category or "brass" in category else 0.05
                scrap_recovery_value = scrap_mass_kg * cost_per_kg * recovery_rate

        net_material_cost = gross_material_cost - scrap_recovery_value

        return MaterialCostDetail(
            stock_volume_mm3=stock_volume_mm3,
            part_volume_mm3=float(part_volume_mm3) if part_volume_mm3 else None,
            removed_volume_mm3=removed_volume_mm3,
            density_g_cm3=density_g_cm3,
            mass_kg=stock_mass_kg,
            cost_per_kg=cost_per_kg,
            markup_pct=markup_pct,
            scrap_recovery_value=scrap_recovery_value,
            cost=net_material_cost
        )
