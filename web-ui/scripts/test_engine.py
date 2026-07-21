import sys
import os

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../ai-engine')))

from app.services.tooling.tool_recommendation_engine import ToolRecommendationEngine
from app.models.manufacturing import MachineProfile, MaterialProfile, ToolProfile

def test():
    tool_library = [
        ToolProfile(
            tool_id="longreach_12", name="12mm Long Reach Flat End Mill", type="flat_end_mill",
            diameter=12.0, flute_count=4, cutting_length=15.0, stickout=80.0,
            compatible_materials=[], # simulate null compatibility in db
            supported_machines=["all"]
        )
    ]
    
    engine = ToolRecommendationEngine(tool_library)
    
    machine = MachineProfile(
        machine_id="haas_umc750", machine_name="Haas UMC-750", machine_type="5_axis_mill", axis_count=5,
        work_envelope={"x": 762, "y": 508, "z": 508}, max_spindle_rpm=12000,
        max_feed_rate=30000, tool_capacity=40
    )
    material = MaterialProfile(
        material_id="mild_steel", material_name="mild_steel",
        category="steel", machinability_score=0.6,
        cutting_speed=100.0, feed_per_tooth=0.08
    )
    
    profile_feature = {
        "id": "f2",
        "name": "Outer Profile",
        "type": "2d_contour",
        "dimensions": {"depth": 75.0, "width": 100.0, "length": 75.0}
    }
    tool, status, reason, feeds = engine.recommend_tool("2d_contour_outer", profile_feature, machine, material)
    print("Profile Tool:", tool.name if tool else None, "| Reason:", repr(reason))

if __name__ == "__main__":
    test()
