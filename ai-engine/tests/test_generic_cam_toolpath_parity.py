import pytest
from pathlib import Path
from app.services.cam.cam_engine_adapter import CamEngineAdapter
from cam_engine.operations import OpPurpose

def test_toolpath_generation_respects_planned_operations_faithfully():
    """Validate that VEXCAD toolpath generation follows caller-planned operations 100%."""
    step_path = Path(__file__).resolve().parents[2] / "outputs" / "sample_bracket.step"
    assert step_path.exists(), "Sample step file must exist"

    # Step 1: Initial auto-plan to get B-Rep features and base operations
    initial_plan = CamEngineAdapter.process_step_file(
        step_path=step_path,
        job_id="parity_test_job",
        session_id="parity_test_sess",
        controller="fanuc",
    )
    assert initial_plan["status"] == "success"
    ops = initial_plan["operations"]
    tools = initial_plan["tools"]
    features = initial_plan["features"]
    setups = initial_plan["setups"]

    assert len(ops) >= 3, "Expected at least 3 operations from feature planner"
    
    # Select a pocket or roughing operation
    pocket_ops = [op for op in ops if "pocket" in op["type"].lower() or "rough" in op["type"].lower()]
    assert len(pocket_ops) > 0, "Expected a pocket or roughing operation"
    test_op = pocket_ops[0]

    # Baseline generation
    base_ops, base_paths = CamEngineAdapter.generate_toolpaths_for_operations(
        step_path=step_path,
        operations=[test_op],
        tools=tools,
        setup=setups[0],
        setups=setups,
        features=features,
    )
    base_seg_count = len(base_paths)
    assert base_seg_count > 10, f"Expected real toolpath segments, got {base_seg_count}"
    
    # Verify it is NOT the old dummy fallback (which had only 4 segments)
    assert base_seg_count != 4, "Toolpath was degenerate dummy fallback!"

    # Step 2: Now test parameter sensitivity to prove planned operation parameters govern generation
    # Cut stepdown in half -> should roughly double the number of Z depth passes and segment count
    modified_op = dict(test_op)
    orig_stepdown = float(modified_op.get("stepdown_mm", 2.0) or 2.0)
    halved_stepdown = round(orig_stepdown / 2.0, 3)
    
    # Set across all common parameter keys
    modified_op["stepdown_mm"] = halved_stepdown
    modified_op["parameters"] = dict(modified_op.get("parameters", {}))
    modified_op["parameters"]["stepdown"] = halved_stepdown
    modified_op["parameters"]["stepdown_mm"] = halved_stepdown
    modified_op["parameters"]["maxStepdown"] = halved_stepdown
    
    # Also customize feed and speed
    modified_op["feed_rate"] = 1234.0
    modified_op["spindle_rpm"] = 5678.0
    modified_op["parameters"]["feedRate"] = 1234.0
    modified_op["parameters"]["spindleSpeed"] = 5678.0

    dense_ops, dense_paths = CamEngineAdapter.generate_toolpaths_for_operations(
        step_path=step_path,
        operations=[modified_op],
        tools=tools,
        setup=setups[0],
        setups=setups,
        features=features,
    )

    dense_seg_count = len(dense_paths)
    # The denser stepdown MUST produce more toolpath segments
    assert dense_seg_count > base_seg_count, (
        f"Dense stepdown ({halved_stepdown}mm) produced {dense_seg_count} segments, "
        f"which should be greater than baseline ({orig_stepdown}mm) with {base_seg_count} segments"
    )

    # Verify feeds and speeds were applied
    assert dense_ops[0]["feed_rate"] == 1234.0
    assert dense_ops[0]["spindle_rpm"] == 5678.0
    
    # Check feeds on cutting segments
    cut_segments = [s for s in dense_paths if s.get("moveType") in ("cut", "arc_cw", "arc_ccw")]
    assert len(cut_segments) > 0
    assert all(s.get("feedrate") == 1234.0 for s in cut_segments)

    # Step 3: Multi-Setup generation
    # Pass all operations across all setups
    all_gen_ops, all_gen_paths = CamEngineAdapter.generate_toolpaths_for_operations(
        step_path=step_path,
        operations=ops,
        tools=tools,
        setup=setups[0],
        setups=setups,
        features=features,
    )
    assert len(all_gen_ops) == len(ops)
    assert len(all_gen_paths) >= base_seg_count

    # Check setup assignment consistency
    op_sids = {op["id"]: op.get("setup_id") or op.get("setupId") for op in ops}
    for seg in all_gen_paths:
        expected_sid = op_sids.get(seg["operationId"])
        if expected_sid:
            assert seg["setupId"] == expected_sid, f"Segment setupId {seg['setupId']} != expected {expected_sid}"

    # Step 4: Verify dialect G-code generation with the generated operations
    gcode = CamEngineAdapter.generate_gcode_from_operations(
        operations=dense_ops,
        setup=setups[0],
        controller="fanuc",
        program_name="PARITY_TEST",
    )
    assert len(gcode) > 100
    assert "S5678" in gcode or "5678" in gcode, "Custom spindle speed must appear in G-code"
    assert "F1234" in gcode or "1234" in gcode, "Custom feed rate must appear in G-code"
