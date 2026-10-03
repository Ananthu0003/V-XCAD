from typing import Dict, Any, List, Optional
from app.services.cam.cost_estimation.models import SecondaryCostDetail, SecondaryOpDetail

class SecondaryOpsCostCalculator:
    def calculate(
        self,
        secondary_configs: List[Dict[str, Any]],
        quantity: int,
        part_mass_kg: float,
        surface_area_dm2: Optional[float],
        feature_count: Optional[int]
    ) -> SecondaryCostDetail:
        """
        Evaluates secondary operations with an explicit, declared basis. No implicit mixing.
        Missing basis inputs (e.g. surface area for per_dm2) raise ValueError.
        """
        items: List[SecondaryOpDetail] = []
        per_part_total = 0.0
        per_batch_total = 0.0

        for cfg in secondary_configs:
            name = cfg.get("name", cfg.get("id", "secondary"))
            basis = cfg.get("basis")
            value = float(cfg.get("value", 0.0) or 0.0)

            if basis == "per_batch":
                computed = value
                per_batch_total += computed
            elif basis == "per_unit":
                computed = value * quantity
                per_part_total += value
            elif basis == "per_kg":
                computed = value * part_mass_kg * quantity
                per_part_total += value * part_mass_kg
            elif basis == "per_dm2":
                if surface_area_dm2 is None:
                    raise ValueError(f"SECONDARY_BASIS_MISSING: Secondary op '{name}' uses per_dm2 but surface area is not in the resolved context.")
                computed = value * surface_area_dm2 * quantity
                per_part_total += value * surface_area_dm2
            elif basis == "per_feature":
                if feature_count is None:
                    raise ValueError(f"SECONDARY_BASIS_MISSING: Secondary op '{name}' uses per_feature but feature count is not in the resolved context.")
                computed = value * feature_count * quantity
                per_part_total += value * feature_count
            else:
                raise ValueError(f"SECONDARY_BASIS_UNKNOWN: Secondary op '{name}' has unknown basis '{basis}'.")

            items.append(SecondaryOpDetail(
                id=cfg.get("id", name),
                name=name,
                basis=basis,
                value=value,
                computed_cost=computed
            ))

        return SecondaryCostDetail(
            items=items,
            per_part_total=per_part_total,
            per_batch_total=per_batch_total
        )
