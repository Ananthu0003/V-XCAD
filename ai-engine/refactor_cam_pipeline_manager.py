import re

with open("app/services/cam_pipeline_manager.py", "r") as f:
    content = f.read()

# Replace references to feature.get("geometry") with feature.get("machiningRegion") in the debug outputs
content = content.replace('feat.get("geometry", {})', 'feat.get("machiningRegion", {})')
content = content.replace('cam_geometry_mapping.json', 'cam_regions.json')

with open("app/services/cam_pipeline_manager.py", "w") as f:
    f.write(content)
