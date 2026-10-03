from typing import Any, Dict, List, Optional
from app.services.cam.cost_estimation.models import QuoteContext

DEFAULT_MACHINE_RATES = {
    "3_axis_mill": {
        "machine_rate": 1800.0,
        "labor_rate": 1000.0,
        "overhead_rate": 700.0,
        "hourly_rate": 3500.0,
        "setup_rate": 2500.0,
        "min_setup_charge": 1000.0,
        "avg_power_kw": 7.5,
        "energy_price_per_kwh": 8.5,
        "margin_pct": 0.15,
        "currency": "INR",
    },
    "4_axis_mill": {
        "machine_rate": 2400.0,
        "labor_rate": 1200.0,
        "overhead_rate": 900.0,
        "hourly_rate": 4500.0,
        "setup_rate": 3000.0,
        "min_setup_charge": 1500.0,
        "avg_power_kw": 11.0,
        "energy_price_per_kwh": 8.5,
        "margin_pct": 0.15,
        "currency": "INR",
    },
    "5_axis_mill": {
        "machine_rate": 3500.0,
        "labor_rate": 1800.0,
        "overhead_rate": 1200.0,
        "hourly_rate": 6500.0,
        "setup_rate": 4000.0,
        "min_setup_charge": 2000.0,
        "avg_power_kw": 15.0,
        "energy_price_per_kwh": 8.5,
        "margin_pct": 0.15,
        "currency": "INR",
    },
    "mill_turn": {
        "machine_rate": 2800.0,
        "labor_rate": 1500.0,
        "overhead_rate": 1200.0,
        "hourly_rate": 5500.0,
        "setup_rate": 3500.0,
        "min_setup_charge": 1800.0,
        "avg_power_kw": 14.0,
        "energy_price_per_kwh": 8.5,
        "margin_pct": 0.15,
        "currency": "INR",
    },
    "lathe": {
        "machine_rate": 1500.0,
        "labor_rate": 900.0,
        "overhead_rate": 600.0,
        "hourly_rate": 3000.0,
        "setup_rate": 2000.0,
        "min_setup_charge": 1000.0,
        "avg_power_kw": 6.0,
        "energy_price_per_kwh": 8.5,
        "margin_pct": 0.15,
        "currency": "INR",
    },
    "turning_center": {
        "machine_rate": 1800.0,
        "labor_rate": 1000.0,
        "overhead_rate": 700.0,
        "hourly_rate": 3500.0,
        "setup_rate": 2500.0,
        "min_setup_charge": 1200.0,
        "avg_power_kw": 8.0,
        "energy_price_per_kwh": 8.5,
        "margin_pct": 0.15,
        "currency": "INR",
    },
}

def normalize_machine_profile(mp: Optional[Dict[str, Any]], setup: Dict[str, Any]) -> Dict[str, Any]:
    resolved = dict(mp) if isinstance(mp, dict) else {}
    mtype = resolved.get("machine_type") or resolved.get("machineType") or setup.get("machineType") or "3_axis_mill"
    mtype_lower = str(mtype).lower()
    
    defaults = DEFAULT_MACHINE_RATES["3_axis_mill"]
    for k, v in DEFAULT_MACHINE_RATES.items():
        if k in mtype_lower or (k == "mill_turn" and "turn" in mtype_lower and "mill" in mtype_lower):
            defaults = v
            break
        elif k == "5_axis_mill" and ("5x" in mtype_lower or "5_axis" in mtype_lower):
            defaults = v
            break
        elif k == "4_axis_mill" and ("4x" in mtype_lower or "4_axis" in mtype_lower):
            defaults = v
            break
        elif k == "lathe" and ("lathe" in mtype_lower or "turning" in mtype_lower):
            defaults = v
            break
            
    has_rates = (resolved.get("machine_rate") is not None or 
                 resolved.get("labor_rate") is not None or 
                 resolved.get("overhead_rate") is not None or 
                 resolved.get("hourly_rate") is not None)
                 
    if not has_rates:
        for k, v in defaults.items():
            if resolved.get(k) is None:
                resolved[k] = v
                
    if resolved.get("setup_rate") is None:
        resolved["setup_rate"] = resolved.get("hourly_rate") or defaults["setup_rate"]
        
    if resolved.get("min_setup_charge") is None:
        resolved["min_setup_charge"] = defaults["min_setup_charge"]
        
    if resolved.get("currency") is None:
        resolved["currency"] = defaults["currency"]
        
    return resolved

def normalize_tool_library(tools: Optional[List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    if not tools:
        return []
    normalized = []
    for t in tools:
        t_dict = dict(t) if isinstance(t, dict) else (t.model_dump() if hasattr(t, "model_dump") else {})
        t_id = t_dict.get("tool_id") or t_dict.get("id") or t_dict.get("toolId")
        if t_id:
            t_dict["tool_id"] = str(t_id)
        if not t_dict.get("tool_life_minutes") or float(t_dict.get("tool_life_minutes", 0)) <= 0:
            t_dict["tool_life_minutes"] = 120.0
        if not t_dict.get("tool_cost") or float(t_dict.get("tool_cost", 0)) <= 0:
            t_dict["tool_cost"] = 1500.0
        if not t_dict.get("holder_life_minutes") or float(t_dict.get("holder_life_minutes", 0)) <= 0:
            t_dict["holder_life_minutes"] = 3000.0
        if not t_dict.get("holder_cost") or float(t_dict.get("holder_cost", 0)) <= 0:
            t_dict["holder_cost"] = 4000.0
        normalized.append(t_dict)
    return normalized

def build_quote_context(
    setup: Dict[str, Any],
    material_profile: Dict[str, Any],
    machine_profile: Dict[str, Any],
    tool_library: Optional[List[Dict[str, Any]]] = None,
    operations: Optional[List[Dict[str, Any]]] = None,
    quantity: int = 1,
    learning_rate: float = 1.0,
    surface_area_dm2: Optional[float] = None,
    feature_count: Optional[int] = None,
    cycle_time_s: float = 0.0,
    setup_time_s: float = 0.0,
) -> QuoteContext:
    """
    Assembles the fully-resolved QuoteContext from already-resolved CAM/manufacturing data.
    Quantity has a single authoritative source: the caller passes it (do not re-derive here).
    """
    setup_dict = setup or {}
    resolved_machine_profile = normalize_machine_profile(machine_profile, setup_dict)
    resolved_tool_library = normalize_tool_library(tool_library)

    return QuoteContext(
        setup=setup_dict,
        material_profile=material_profile or {},
        machine_profile=resolved_machine_profile,
        tool_library=resolved_tool_library,
        operations=operations or [],
        quantity=int(quantity if quantity and quantity >= 1 else 1),
        learning_rate=float(learning_rate if learning_rate and learning_rate > 0 else 1.0),
        surface_area_dm2=surface_area_dm2,
        feature_count=feature_count,
        cycle_time_s=float(cycle_time_s or 0.0),
        setup_time_s=float(setup_time_s or 0.0),
    )
