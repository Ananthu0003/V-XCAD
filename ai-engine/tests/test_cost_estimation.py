import math
import pytest
from app.services.cam.cost_estimation.engine import CostEstimationEngine
from app.services.cam.cost_estimation.models import QuoteContext

def _ctx(**overrides) -> QuoteContext:
    base = dict(
        setup={"stockDimensions": [50, 50, 50]},
        material_profile={"density_gcm3": 2.7, "cost_per_kg": 5.0, "currency": "USD"},
        machine_profile={"hourly_rate": 60.0},
        tool_library=[],
        operations=[],
        quantity=1,
        learning_rate=1.0,
        cycle_time_s=0.0,
        setup_time_s=0.0,
    )
    base.update(overrides)
    return QuoteContext(**base)

def test_material_cost():
    engine = CostEstimationEngine()
    res = engine.estimate(_ctx())
    assert res.material is not None
    assert res.material.stock_volume_mm3 == 125000
    assert abs(res.material.mass_kg - 0.3375) < 0.001
    assert abs(res.material.cost - 1.6875) < 0.001

def test_material_markup_pct():
    engine = CostEstimationEngine()
    res = engine.estimate(_ctx(material_profile={"density_gcm3": 2.7, "cost_per_kg": 5.0, "material_markup_pct": 0.20, "currency": "USD"}))
    assert abs(res.material.cost - 1.6875 * 1.20) < 0.001

def test_machining_cost_legacy_rate():
    engine = CostEstimationEngine()
    res = engine.estimate(_ctx(cycle_time_s=1800.0))
    assert res.machining is not None
    assert abs(res.machining.cost - 30.0) < 0.001
    assert res.machining.hourly_rate_used == 60.0

def test_machining_cost_decomposed_rates():
    engine = CostEstimationEngine()
    res = engine.estimate(_ctx(
        cycle_time_s=1800.0,
        machine_profile={"machine_rate": 30.0, "labor_rate": 20.0, "overhead_rate": 10.0},
    ))
    assert abs(res.machining.cost - 30.0) < 0.001
    assert res.machining.machine_rate == 30.0
    assert res.machining.labor_rate == 20.0
    assert res.machining.overhead_rate == 10.0

def test_setup_cost_and_min_charge():
    engine = CostEstimationEngine()
    res = engine.estimate(_ctx(setup_time_s=1800.0, machine_profile={"hourly_rate": 60.0, "setup_rate": 40.0}))
    assert res.setup is not None
    assert abs(res.setup.cost - 20.0) < 0.001

    res2 = engine.estimate(_ctx(setup_time_s=60.0, machine_profile={"setup_rate": 40.0, "min_setup_charge": 25.0}))
    assert abs(res2.setup.cost - 25.0) < 0.001  # floored at min charge

def test_quantity_amortizes_setup():
    engine = CostEstimationEngine()
    res = engine.estimate(_ctx(cycle_time_s=1800.0, setup_time_s=1800.0,
                               machine_profile={"hourly_rate": 60.0, "setup_rate": 40.0},
                               quantity=10))
    # material lot = 1.6875*10, machining lot = 30*10, setup lot fixed = 20
    assert abs(res.manufacturing_cost.lot - (1.6875 * 10 + 30 * 10 + 20)) < 0.001
    # setup amortized per-part
    assert abs(res.manufacturing_cost.setup_cost - 2.0) < 0.001

def test_learning_curve_reduces_per_unit_time():
    engine = CostEstimationEngine()
    no_learn = engine.estimate(_ctx(cycle_time_s=1800.0, quantity=10, learning_rate=1.0))
    with_learn = engine.estimate(_ctx(cycle_time_s=1800.0, quantity=10, learning_rate=0.8))
    # lot machining cost must decrease with learning (learning applied at lot level)
    assert with_learn.manufacturing_cost.machining_cost < no_learn.manufacturing_cost.machining_cost
    # per-unit machining must decrease with learning
    per_unit_no = no_learn.manufacturing_cost.machining_cost / 10
    per_unit_yes = with_learn.manufacturing_cost.machining_cost / 10
    assert per_unit_yes < per_unit_no

def test_tooling_deterministic():
    engine = CostEstimationEngine()
    tool_library = [{"tool_id": "T1", "name": "Endmill", "tool_cost": 100.0, "tool_life_minutes": 100.0}]
    operations = [{"id": "op1", "tool_id": "T1", "estimated_time_s": 600.0}]  # 10 min cut (fallback)
    res = engine.estimate(_ctx(operations=operations, tool_library=tool_library))
    assert res.tooling is not None
    assert abs(res.tooling.total - (10.0 / 100.0) * 100.0) < 0.001  # 10 min / 100 min * $100

def test_tooling_missing_tool_id_warns_and_skips():
    engine = CostEstimationEngine()
    tool_library = [{"tool_id": "T1", "name": "Endmill", "tool_cost": 100.0, "tool_life_minutes": 100.0}]
    operations = [{"id": "op1", "estimated_time_s": 600.0}]  # no tool_id
    res = engine.estimate(_ctx(operations=operations, tool_library=tool_library))
    assert any(w["code"] == "OP_TOOL_MISSING" for w in res.warnings)
    assert res.tooling.total == 0.0

def test_tooling_missing_life_is_error():
    engine = CostEstimationEngine()
    tool_library = [{"tool_id": "T1", "name": "Endmill", "tool_cost": 100.0}]  # no tool_life_minutes
    operations = [{"id": "op1", "tool_id": "T1", "estimated_time_s": 600.0}]
    res = engine.estimate(_ctx(operations=operations, tool_library=tool_library))
    assert res.status == "incomplete"
    assert any("TOOL_LIFE_MISSING" in e["code"] for e in res.errors)

def test_energy_present_and_absent():
    engine = CostEstimationEngine()
    # present
    res = engine.estimate(_ctx(cycle_time_s=3600.0,
                               machine_profile={"hourly_rate": 60.0, "avg_power_kw": 10.0, "energy_price_per_kwh": 0.2}))
    assert res.energy is not None
    assert abs(res.energy.energy_kwh - 10.0) < 0.001
    assert abs(res.energy.cost - 2.0) < 0.001
    # absent -> warning, no invention
    res2 = engine.estimate(_ctx(cycle_time_s=3600.0, machine_profile={"hourly_rate": 60.0}))
    assert res2.energy is None
    assert any(w["code"] == "ENERGY_DATA_MISSING" for w in res2.warnings)

def test_secondary_ops_basis():
    engine = CostEstimationEngine()
    machine_profile = {
        "hourly_rate": 60.0,
        "secondary_operations": [
            {"id": "s1", "name": "Deburr", "basis": "per_unit", "value": 5.0},
            {"id": "s2", "name": "Inspection", "basis": "per_batch", "value": 100.0},
        ],
    }
    res = engine.estimate(_ctx(quantity=10, machine_profile=machine_profile))
    assert abs(res.secondary.per_part_total - 5.0) < 0.001
    assert abs(res.secondary.per_batch_total - 100.0) < 0.001
    # lot secondary = 5*10 + 100 = 150
    assert abs(res.manufacturing_cost.secondary_cost - 150.0) < 0.001

def test_secondary_per_dm2_requires_surface_area():
    engine = CostEstimationEngine()
    machine_profile = {"hourly_rate": 60.0,
                       "secondary_operations": [{"id": "a", "name": "Anodize", "basis": "per_dm2", "value": 2.0}]}
    res = engine.estimate(_ctx(machine_profile=machine_profile))  # no surface_area_dm2
    assert res.status == "incomplete"
    assert any("SECONDARY_BASIS_MISSING" in e["code"] for e in res.errors)

def test_true_margin():
    engine = CostEstimationEngine()
    res = engine.estimate(_ctx(cycle_time_s=1800.0, machine_profile={"hourly_rate": 60.0, "margin_pct": 0.20}))
    mfg = res.manufacturing_cost.lot
    assert abs(res.selling_price.lot - mfg / 0.80) < 0.001
    assert abs(res.selling_price.profit - (mfg / 0.80) * 0.20) < 0.001

def test_margin_invalid():
    engine = CostEstimationEngine()
    res = engine.estimate(_ctx(machine_profile={"hourly_rate": 60.0, "margin_pct": 1.0}))
    assert res.status == "incomplete"
    assert any("MARGIN_INVALID" in e["code"] for e in res.errors)

def test_quantity_invalid():
    engine = CostEstimationEngine()
    res = engine.estimate(_ctx(quantity=0))
    assert res.status == "incomplete"
    assert any("QUANTITY_INVALID" in e["code"] for e in res.errors)

def test_missing_stock():
    engine = CostEstimationEngine()
    res = engine.estimate(_ctx(setup={}))
    assert res.status == "incomplete"
    assert any("STOCK_GEOMETRY_MISSING" in e["code"] for e in res.errors)

def test_missing_material():
    engine = CostEstimationEngine()
    res = engine.estimate(_ctx(material_profile={}))
    assert res.status == "incomplete"
    assert any("MATERIAL_MISSING" in e["code"] for e in res.errors)

def test_missing_machine_rate():
    engine = CostEstimationEngine()
    res = engine.estimate(_ctx(machine_profile={"machine_id": "x"}))
    assert res.status == "incomplete"
    assert any("MACHINE_RATE_MISSING" in e["code"] for e in res.errors)

def test_deterministic_no_invention():
    engine = CostEstimationEngine()
    a = engine.estimate(_ctx(cycle_time_s=1800.0, setup_time_s=1800.0,
                             machine_profile={"hourly_rate": 60.0, "setup_rate": 40.0}, quantity=5))
    b = engine.estimate(_ctx(cycle_time_s=1800.0, setup_time_s=1800.0,
                             machine_profile={"hourly_rate": 60.0, "setup_rate": 40.0}, quantity=5))
    assert a.model_dump() == b.model_dump()
