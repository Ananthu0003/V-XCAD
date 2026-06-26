import pytest
import json
import asyncio
from pathlib import Path
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)
API_URL = "/api/v1"

def test_toolpath_A_hole():
    script = """from build123d import *
with BuildPart() as p:
    Box(100, 100, 20)
    with Locations((0, 0, 10)):
        Hole(radius=5, depth=20)
result = p.part"""
    res = client.post(f"{API_URL}/render", json={"python_script": script, "parameters": {}, "generate_cam": True})
    assert res.status_code == 200, res.text
    data = res.json()["artifacts"]
    features = data.get("features", [])
    
    operations = []
    for f in features:
        if f["type"] in ("hole", "blind_hole", "through_hole"):
            operations.append({"id": f"op_{f['id']}", "type": "drilling", "featureId": f["id"], "toolId": "tool_1", "machining_strategy": "default", "status": "planned"})
            
    res2 = client.post(f"{API_URL}/cam/toolpaths", json={"session_id": res.json()["session_id"], "setup": {}, "tools": [{"id": "tool_1", "diameter": 3.175, "type": "flat_end_mill"}], "operations": operations})
    assert res2.status_code == 200, res2.text
    result_ops = res2.json().get("operations", [])
    
    drill_ops = [op for op in result_ops if op.get("type") == "drilling"]
    assert drill_ops, "Should have generated a drilling operation"
    for op in drill_ops:
        assert op.get("status") not in ("error", "blocked")
        assert len(op.get("toolpaths", [])) > 0
        for seg in op.get("toolpaths", []):
            assert seg["source"] == "drill"

def test_toolpath_B_contour():
    script = """from build123d import *
with BuildPart() as p:
    Box(100, 100, 20)
result = p.part"""
    res = client.post(f"{API_URL}/render", json={"python_script": script, "parameters": {}, "generate_cam": True})
    assert res.status_code == 200, res.text
    data = res.json()["artifacts"]
    features = data.get("features", [])
    
    operations = []
    for f in features:
        if f["type"] == "contour":
            operations.append({"id": f"op_{f['id']}", "type": "2d_contour", "featureId": f["id"], "toolId": "tool_1", "machining_strategy": "default", "status": "planned"})
            
    res2 = client.post(f"{API_URL}/cam/toolpaths", json={"session_id": res.json()["session_id"], "setup": {}, "tools": [{"id": "tool_1", "diameter": 3.175, "type": "flat_end_mill"}], "operations": operations})
    assert res2.status_code == 200, res2.text
    result_ops = res2.json().get("operations", [])
    
    contour_ops = [op for op in result_ops if op.get("type") == "2d_contour"]
    assert contour_ops, "Should have generated a contour operation"
    for op in contour_ops:
        assert op.get("status") not in ("error", "blocked")
        assert len(op.get("toolpaths", [])) > 0
        for seg in op.get("toolpaths", []):
            assert seg["source"] == "contour"

def test_toolpath_C_boss():
    script = """from build123d import *
with BuildPart() as p:
    Box(100, 100, 20)
    with Locations((0, 0, 10)):
        Cylinder(radius=10, height=10, align=(Align.CENTER, Align.CENTER, Align.MIN))
result = p.part"""
    res = client.post(f"{API_URL}/render", json={"python_script": script, "parameters": {}, "generate_cam": True})
    assert res.status_code == 200, res.text
    data = res.json()["artifacts"]
    features = data.get("features", [])
    
    operations = []
    for f in features:
        if f["type"] == "boss":
            operations.append({"id": f"op_{f['id']}", "type": "boss_clearing", "featureId": f["id"], "toolId": "tool_1", "machining_strategy": "default", "status": "planned"})
            
    res2 = client.post(f"{API_URL}/cam/toolpaths", json={"session_id": res.json()["session_id"], "setup": {}, "tools": [{"id": "tool_1", "diameter": 3.175, "type": "flat_end_mill"}], "operations": operations})
    assert res2.status_code == 200, res2.text
    result_ops = res2.json().get("operations", [])
    
    boss_ops = [op for op in result_ops if op.get("type") == "boss_clearing"]
    assert boss_ops, "Should have generated a boss operation"
    for op in boss_ops:
        assert op.get("status") not in ("error", "blocked")
        assert len(op.get("toolpaths", [])) > 0
        for seg in op.get("toolpaths", []):
            assert seg["source"] == "boss"

def test_toolpath_D_side_shaft():
    script = """from build123d import *
with BuildPart() as p:
    Box(100, 100, 20)
    with Locations((50, 0, 0)):
        with BuildSketch(Plane.YZ):
            Circle(5)
        extrude(amount=20)
result = p.part"""
    res = client.post(f"{API_URL}/render", json={"python_script": script, "parameters": {}, "generate_cam": True})
    assert res.status_code == 200, res.text
    data = res.json()["artifacts"]
    features = data.get("features", [])
    
    operations = []
    for f in features:
        if f["type"] in ("side_protrusion", "external_cylinder"):
            operations.append({"id": f"op_{f['id']}", "type": "2d_contour", "featureId": f["id"], "toolId": "tool_1", "machining_strategy": "default", "status": "planned"})
            
    res2 = client.post(f"{API_URL}/cam/toolpaths", json={"session_id": res.json()["session_id"], "setup": {}, "tools": [{"id": "tool_1", "diameter": 3.175, "type": "flat_end_mill"}], "operations": operations})
    assert res2.status_code == 200, res2.text
    result_ops = res2.json().get("operations", [])
    
    for op in result_ops:
        feat = next((f for f in data.get("features", []) if f.get("id") == op.get("featureId") or f.get("id") == op.get("feature_id")), {})
        if feat.get("type") in ("side_protrusion", "external_cylinder"):
            assert op.get("status") == "error"
            assert len(op.get("toolpaths", [])) == 0

def test_toolpath_E_flange():
    script = """from build123d import *
with BuildPart() as p:
    Cylinder(radius=50, height=10)
    with PolarLocations(radius=35, count=6):
        Hole(radius=3)
result = p.part"""
    res = client.post(f"{API_URL}/render", json={"python_script": script, "parameters": {}, "generate_cam": True})
    assert res.status_code == 200, res.text
    data = res.json()["artifacts"]
    features = data.get("features", [])
    
    operations = []
    for f in features:
        if f["type"] == "contour":
            operations.append({"id": f"op_{f['id']}", "type": "2d_contour", "featureId": f["id"], "toolId": "tool_1", "machining_strategy": "default", "status": "planned"})
        elif f["type"] in ("hole", "through_hole", "blind_hole"):
            operations.append({"id": f"op_{f['id']}", "type": "drilling", "featureId": f["id"], "toolId": "tool_1", "machining_strategy": "default", "status": "planned"})
            
    res2 = client.post(f"{API_URL}/cam/toolpaths", json={"session_id": res.json()["session_id"], "setup": {}, "tools": [{"id": "tool_1", "diameter": 3.175, "type": "flat_end_mill"}], "operations": operations})
    assert res2.status_code == 200, res2.text
    result_ops = res2.json().get("operations", [])
    
    contour_ops = [op for op in result_ops if op.get("type") == "2d_contour"]
    drill_ops = [op for op in result_ops if op.get("type") == "drilling"]
    
    assert contour_ops, "Should have generated a contour operation"
    assert len(drill_ops) >= 6, "Should have generated at least 6 drilling operations"
