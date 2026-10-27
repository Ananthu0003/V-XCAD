import os
import pytest
from pathlib import Path
from fastapi.testclient import TestClient

from app.main import app

SERVICE_KEY = os.getenv("SERVICE_API_KEY", "532707dcc4c2105b8567ec11132c889dab84ea661db49581d9da2a92b5b7065c")
HEADERS = {"X-Service-Key": SERVICE_KEY, "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_cam_pipeline_endpoints_e2e(client):
    """End-to-end integration test validating that VexCAD CAM endpoints run Generic-CAM engine."""
    session_id = "test_e2e_session"
    job_id = "test_e2e_job"

    # Seed sample_bracket.step into outputs for this session
    outputs_dir = Path(__file__).resolve().parents[1] / "outputs"
    outputs_dir.mkdir(parents=True, exist_ok=True)
    src_step = outputs_dir / "sample_bracket.step"
    dest_step = outputs_dir / f"cad_{session_id}.step"

    if src_step.exists():
        dest_step.write_bytes(src_step.read_bytes())

    try:
        # 1. /api/v1/cam/analyze
        analyze_resp = client.post(
            "/api/v1/cam/analyze",
            headers=HEADERS,
            json={
                "session_id": session_id,
                "job_id": job_id,
                "setup": {
                    "stockType": "box",
                    "stockDimensions": [100.0, 60.0, 25.0],
                    "controller": "fanuc"
                }
            }
        )
        assert analyze_resp.status_code == 200, f"Analyze failed: {analyze_resp.text}"
        analyze_data = analyze_resp.json()
        assert analyze_data["status"] == "ok"
        features = analyze_data.get("features", [])
        assert len(features) > 0, "Expected features recognized by Generic-CAM B-Rep recognizer"

        # 2. /api/v1/cam/auto_plan
        plan_resp = client.post(
            "/api/v1/cam/auto_plan",
            headers=HEADERS,
            json={
                "session_id": session_id,
                "job_id": job_id,
                "machine_config": {
                    "machine_type": "3_axis_mill",
                    "machine_name": "Haas VF-2",
                    "setup": {
                        "stockType": "box",
                        "stockDimensions": [100.0, 60.0, 25.0],
                        "controller": "fanuc",
                        "wcs": "G54"
                    }
                }
            }
        )
        assert plan_resp.status_code == 200, f"Auto-plan failed: {plan_resp.text}"
        plan_data = plan_resp.json()
        assert plan_data["status"] == "success"
        operations = plan_data.get("operations", [])
        tools = plan_data.get("tools", [])
        toolpaths = plan_data.get("toolpaths", [])

        assert len(operations) >= 3, f"Expected at least 3 operations from Generic-CAM, got {len(operations)}"
        assert len(tools) >= 1, "Expected tools assigned to operations"
        assert len(toolpaths) > 100, f"Expected full strategy toolpaths, got {len(toolpaths)}"
        assert plan_data.get("toolpath_schema_version") == "semantic_v1"
        assert len(plan_data.get("gcode", "")) > 100, "Expected valid post-processed G-code"

        # 3. /api/v1/cam/toolpaths
        tp_resp = client.post(
            "/api/v1/cam/toolpaths",
            headers=HEADERS,
            json={
                "session_id": session_id,
                "job_id": job_id,
                "setup": {
                    "setupId": "setup_001",
                    "stockType": "box",
                    "controller": "fanuc"
                },
                "tools": tools,
                "operations": operations,
                "features": features
            }
        )
        assert tp_resp.status_code == 200, f"Toolpaths generation failed: {tp_resp.text}"
        tp_data = tp_resp.json()
        assert tp_data["status"] in ("toolpaths_generated", "success")
        assert len(tp_data.get("toolpaths", [])) > 100
        assert tp_data.get("can_generate_gcode") is True

        # 4. /api/v1/cam/gcode
        gcode_resp = client.post(
            "/api/v1/cam/gcode",
            headers=HEADERS,
            json={
                "session_id": session_id,
                "job_id": job_id
            }
        )
        assert gcode_resp.status_code == 200, f"Gcode generation failed: {gcode_resp.text}"
        gcode_data = gcode_resp.json()
        assert gcode_data.get("can_generate_gcode") is True, f"Errors: {gcode_data.get('errors')}"
        gcode_str = gcode_data.get("gcode")
        assert gcode_str is not None and len(gcode_str) > 100
        assert "G21" in gcode_str or "G20" in gcode_str or "G90" in gcode_str or "G54" in gcode_str

        # 5. /api/v1/cam/simulate/prepare
        sim_resp = client.post(
            "/api/v1/cam/simulate/prepare",
            headers=HEADERS,
            json={
                "setup": {
                    "setupId": "setup_001",
                    "bounds": {"min": [-50, -30, -25], "max": [50, 30, 0]}
                },
                "tools": tools,
                "operations": operations
            }
        )
        assert sim_resp.status_code == 200, f"Simulation prepare failed: {sim_resp.text}"
        sim_data = sim_resp.json()
        assert sim_data.get("status") == "ready"
        assert len(sim_data.get("segments", [])) > 0
        assert len(sim_data.get("timeline", [])) > 0

    finally:
        if dest_step.exists():
            try:
                dest_step.unlink()
            except Exception:
                pass
