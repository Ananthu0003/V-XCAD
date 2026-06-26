from fastapi.testclient import TestClient
from app.main import app
import json

client = TestClient(app)

script = """from build123d import *
with BuildPart() as p:
    Box(100, 100, 20)
    with Locations((0, 0, 10)):
        Cylinder(radius=10, height=10, align=(Align.CENTER, Align.CENTER, Align.MIN))
result = p.part"""

res = client.post("/api/v1/render", json={"python_script": script, "parameters": {}, "generate_cam": True})
data = res.json()["artifacts"]
features = data.get("features", [])

operations = []
for f in features:
    if f["type"] == "boss":
        operations.append({"id": f"op_{f['id']}", "type": "boss_clearing", "featureId": f["id"], "toolId": "tool_1", "machining_strategy": "default", "status": "planned"})

res2 = client.post("/api/v1/cam/toolpaths", json={"session_id": res.json()["session_id"], "setup": {}, "tools": [{"id": "tool_1", "diameter": 3.175, "type": "flat_end_mill"}], "operations": operations})
result_ops = res2.json().get("operations", [])
for op in result_ops:
    print("MR:", op.get("machiningRegion", {}).get("boundary"))
    print(op.get("type"), op.get("status"), op.get("parameters", {}).get("error"))
