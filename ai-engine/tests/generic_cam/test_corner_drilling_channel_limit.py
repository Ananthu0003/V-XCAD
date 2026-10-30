"""Tests ensuring corner drilling respects cavity/channel minimum width constraints
and never plans oversized tools into narrow slots or pockets.
"""

import numpy as np
import pytest

from cam_engine.context import (
    PlanningContext, Setup, Stock, StockKind, Tool, ToolType, WorkOffset, Material, DEFAULT_MATERIALS
)
from cam_engine.features import FeatureType, MachiningFeature, Accessibility
from cam_engine.operations import OperationPlanner, OpPurpose
from cam_engine.toolpaths.strategies import StrategyEngine, StrategyContext
from cam_engine.geometry.mesh import TriangleMesh
from cam_engine.demo_models import get_default_machine


def test_narrow_slot_corner_drill_does_not_select_oversized_tool():
    """Verify that a 0.76mm open slot with corner details will NOT have an oversized
    drill (e.g. Ø2.0mm T04) planned for corner relief, which would fail geometry validation."""
    
    # Tool library where smallest tool is Ø2.0mm
    tools = [
        Tool(id="T01", tool_number=1, type=ToolType.FLAT_ENDMILL, diameter=10.0, flute_length=30.0, overall_length=75.0, flutes=4),
        Tool(id="T02", tool_number=2, type=ToolType.FLAT_ENDMILL, diameter=6.0, flute_length=25.0, overall_length=60.0, flutes=3),
        Tool(id="T04", tool_number=4, type=ToolType.FLAT_ENDMILL, diameter=2.0, flute_length=10.0, overall_length=45.0, flutes=3, can_plunge=True),
        Tool(id="T05", tool_number=5, type=ToolType.DRILL, diameter=3.0, flute_length=20.0, overall_length=50.0, flutes=2),
    ]
    
    stock = Stock(kind=StockKind.BOX, bounds_min=np.array([0.0, 0.0, -10.0]), bounds_max=np.array([50.0, 50.0, 0.0]))
    setup = Setup(id="setup_001", name="Top Setup", model_to_setup=np.eye(4), work_offset=WorkOffset.G54, stock=stock)
    
    ctx = PlanningContext(
        model=None,
        setups=[setup],
        machine=get_default_machine(),
        tools=tools,
        material=DEFAULT_MATERIALS["aluminum_6061"],
    )
    
    # 0.76mm open slot with corner details
    slot_feat = MachiningFeature(
        id="setup_001_open_slot_67",
        type=FeatureType.OPEN_SLOT,
        face_indices=[1, 2],
        bounds_min=np.array([10.0, 10.0, -5.0]),
        bounds_max=np.array([10.76, 25.0, 0.0]),  # X span = 0.76mm, Y span = 15mm
        depth=5.0,
        top_z=0.0,
        floor_z=-5.0,
        is_concave=True,
        accessibility=Accessibility.TOOL_AXIS_OK,
        notes={
            "corner_details": [
                {"radius": 0.5, "x": 10.38, "y": 10.5, "center": [10.38, 10.5]},
                {"radius": 0.5, "x": 10.38, "y": 24.5, "center": [10.38, 24.5]},
            ],
            "min_corner_radius": 0.5,
        }
    )
    
    planner = OperationPlanner(ctx, setup, [slot_feat])
    ops = planner.plan()
    
    # Crucial: NO corner drilling op should be planned with T04 (Ø2.0mm) for a 0.76mm slot!
    corner_ops = [op for op in ops if op.purpose == OpPurpose.DRILLING and op.notes.get("corner_drilling")]
    assert len(corner_ops) == 0, f"Expected 0 corner drilling ops, got {corner_ops}"
    
    # A structured warning must be present explaining no compatible corner drill was available
    assert any(w["code"] == "MISSING_CORNER_DRILL" for w in planner.warnings)
    w = next(w for w in planner.warnings if w["code"] == "MISSING_CORNER_DRILL")
    assert w["suggested_tool"]["diameter"] <= 0.76
    
    # Now, add a micro tool (e.g. Ø0.5mm endmill/drill)
    micro_drill = Tool(id="T99", tool_number=99, type=ToolType.DRILL, diameter=0.5, flute_length=8.0, overall_length=35.0, flutes=2, can_plunge=True)
    ctx.tools.append(micro_drill)
    
    planner2 = OperationPlanner(ctx, setup, [slot_feat])
    ops2 = planner2.plan()
    
    corner_ops2 = [op for op in ops2 if op.purpose == OpPurpose.DRILLING and op.notes.get("corner_drilling")]
    assert len(corner_ops2) == 1
    assert corner_ops2[0].tool.diameter <= 0.76
