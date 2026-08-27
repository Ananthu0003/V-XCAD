from typing import Dict, Any, List
from app.services.cam.cost_estimation.models import ToolingCostDetail, ToolingItemDetail

def _op_cutting_time_min(op: Dict[str, Any]) -> tuple[float, bool]:
    """Return (cutting_time_min, used_total_time_as_fallback). Deterministic from resolved context."""
    bkd = op.get("breakdown") or {}
    ct = bkd.get("cutting_time_seconds")
    if ct is None:
        ct = op.get("cutting_time_s")
    if ct is None:
        ct = op.get("estimated_time_s", 0.0)
        return float(ct) / 60.0, True
    return float(ct) / 60.0, False

class ToolingCostCalculator:
    def calculate(
        self,
        operations: List[Dict[str, Any]],
        tool_library: List[Dict[str, Any]]
    ) -> tuple[ToolingCostDetail, List[Dict[str, str]]]:
        """
        Calculates per-part tooling (wear + holder amortization) cost.
        Op -> tool association is deterministic via explicit tool_id. Missing tool_id or
        unknown tool is skipped with a warning. Missing tool_life_minutes raises (no invention).
        """
        tool_map = {t.get("tool_id"): t for t in tool_library if t.get("tool_id")}

        aggregated: Dict[str, ToolingItemDetail] = {}
        warnings: List[Dict[str, str]] = []

        for op in operations:
            tool_id = op.get("tool_id") or op.get("toolId")
            if not tool_id:
                warnings.append({"code": "OP_TOOL_MISSING", "message": f"Operation '{op.get('id', '?')}' has no tool_id; tooling cost excluded for it."})
                continue
            tool = tool_map.get(tool_id)
            if tool is None:
                warnings.append({"code": "TOOL_NOT_FOUND", "message": f"Tool '{tool_id}' referenced by an operation is not in the tool library; skipped."})
                continue

            cut_min, used_fallback = _op_cutting_time_min(op)
            tool_life = tool.get("tool_life_minutes")
            if tool_life is None:
                raise ValueError(f"TOOL_LIFE_MISSING: Tool '{tool_id}' has no tool_life_minutes; cannot compute wear deterministically.")

            tool_life = float(tool_life)
            if tool_life <= 0:
                raise ValueError(f"TOOL_LIFE_INVALID: Tool '{tool_id}' has non-positive tool_life_minutes.")

            tool_cost = float(tool.get("tool_cost", 0.0) or 0.0)
            wear_cost = (cut_min / tool_life) * tool_cost

            holder_cost = float(tool.get("holder_cost", 0.0) or 0.0)
            holder_life = tool.get("holder_life_minutes")
            holder_amort = 0.0
            if holder_life is not None and float(holder_life) > 0 and holder_cost > 0:
                holder_amort = (cut_min / float(holder_life)) * holder_cost

            if tool_id in aggregated:
                agg = aggregated[tool_id]
                agg.cutting_time_min += cut_min
                agg.wear_cost += wear_cost
                agg.holder_amort += holder_amort
            else:
                aggregated[tool_id] = ToolingItemDetail(
                    tool_id=tool_id,
                    tool_name=tool.get("name", tool_id),
                    cutting_time_min=cut_min,
                    tool_life_min=tool_life,
                    tool_cost=tool_cost,
                    wear_cost=wear_cost,
                    holder_cost=holder_cost,
                    holder_life_min=holder_life,
                    holder_amort=holder_amort
                )

            if used_fallback:
                warnings.append({"code": "TOOLING_TIME_APPROX", "message": f"Tool '{tool_id}': cutting time unavailable; used total op time (wear may be overstated)."})

        total = sum(i.wear_cost + i.holder_amort for i in aggregated.values())
        return ToolingCostDetail(items=list(aggregated.values()), total=total), warnings
