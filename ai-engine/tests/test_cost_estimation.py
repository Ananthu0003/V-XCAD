import pytest
from app.services.cam.cost_estimation.engine import CostEstimationEngine
from app.services.planning.planning_context import PlanningContext

# Mocks
class MockPlanningContext:
    def __init__(self, stock_type="box", bounds=None, part_volume=None):
        self.stock = {
            "stockType": stock_type,
            "bounds": bounds if bounds is not None else {"min": [0,0,0], "max": [50,50,50]}
        }
        self.setup = {"partVolumeMm3": part_volume, "stockDimensions": [50, 50, 50]} if part_volume else {"stockDimensions": [50, 50, 50]}

def test_material_cost():
    engine = CostEstimationEngine()
    ctx = MockPlanningContext(bounds={"min": [0,0,0], "max": [50,50,50]})
    # Volume = 125,000 mm3
    
    material_profile = {
        "density_g_cm3": 2.7,
        "cost_per_kg": 5.0,
        "currency": "USD"
    }
    
    res = engine.estimate(ctx, 0, 0, material_profile, {})
    
    assert res.material is not None
    assert res.material.stock_volume_mm3 == 125000
    assert abs(res.material.mass_kg - 0.3375) < 0.001
    assert abs(res.material.cost - 1.6875) < 0.001

def test_machining_cost():
    engine = CostEstimationEngine()
    ctx = MockPlanningContext()
    
    machine_profile = {
        "hourly_rate": 60.0
    }
    
    res = engine.estimate(ctx, 1800.0, 0, {"density_g_cm3": 2.7, "cost_per_kg": 5.0}, machine_profile)
    
    assert res.machining is not None
    assert abs(res.machining.cost - 30.0) < 0.001

def test_setup_cost():
    engine = CostEstimationEngine()
    ctx = MockPlanningContext()
    
    machine_profile = {
        "hourly_rate": 60.0,
        "setup_rate": 40.0
    }
    
    res = engine.estimate(ctx, 0, 1800.0, {"density_g_cm3": 2.7, "cost_per_kg": 5.0}, machine_profile)
    
    assert res.setup is not None
    assert abs(res.setup.cost - 20.0) < 0.001
    
def test_total_cost():
    engine = CostEstimationEngine()
    ctx = MockPlanningContext()
    
    machine_profile = {
        "hourly_rate": 60.0,
        "setup_rate": 40.0
    }
    
    material_profile = {
        "density_g_cm3": 2.7,
        "cost_per_kg": 5.0
    }
    
    res = engine.estimate(ctx, 1800.0, 1800.0, material_profile, machine_profile)
    
    assert res.status == "complete"
    assert res.total is not None
    assert abs(res.total.total_cost - (1.6875 + 30.0 + 20.0)) < 0.001

def test_missing_stock():
    engine = CostEstimationEngine()
    ctx = MockPlanningContext(bounds={})
    ctx.setup = {}
    
    res = engine.estimate(ctx, 1800, 1800, {"density_g_cm3": 1, "cost_per_kg": 1}, {"hourly_rate": 1})
    
    assert res.status == "incomplete"
    assert len(res.errors) > 0
    assert any("STOCK_GEOMETRY_MISSING" in e["code"] for e in res.errors)

def test_missing_material():
    engine = CostEstimationEngine()
    ctx = MockPlanningContext()
    
    res = engine.estimate(ctx, 1800, 1800, {}, {"hourly_rate": 1})
    
    assert res.status == "incomplete"
    assert any("MATERIAL_MISSING" in e["code"] for e in res.errors)

def test_missing_machine_rate():
    engine = CostEstimationEngine()
    ctx = MockPlanningContext()
    
    res = engine.estimate(ctx, 1800, 1800, {"density_g_cm3": 1, "cost_per_kg": 1}, {})
    
    assert res.status == "incomplete"
    assert any("MACHINE_MISSING" in e["code"] for e in res.errors)
