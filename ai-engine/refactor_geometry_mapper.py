import re

with open("app/services/geometry_mapper.py", "r") as f:
    content = f.read()

# Replace feature["geometry"] with feature["machiningRegion"]
content = content.replace('feature["geometry"] = {', 'feature["machiningRegion"] = {')
content = content.replace("feature['geometry'] = {", "feature['machiningRegion'] = {")
content = content.replace('feature.get("geometry", {})', 'feature.get("machiningRegion", {})')
content = content.replace("feature.get('geometry', {})", "feature.get('machiningRegion', {})")
content = content.replace('geom = feat.get(\'geometry\', {})', 'geom = feat.get(\'machiningRegion\', {})')

# Update Contour
content = re.sub(
    r'"status": "ok",\s*"regionType": "contour_region",\s*"closedBoundary": True,\s*"profile_points": profile_points,\s*"z_top": (.*?),\s*"z_bottom": (.*?),\s*"plane_normal": list\(plane_normal\),\s*"plane_origin": list\(plane_origin\),\s*"source": source,',
    r'"valid": True,\n            "regionId": feature.get("id", "unknown"),\n            "regionType": "contour_region",\n            "closedBoundary": True,\n            "boundary": profile_points,\n            "topZ": \1,\n            "bottomZ": \2,\n            "source": source,\n            "area": area,',
    content, flags=re.DOTALL
)

# Update Hole
content = re.sub(
    r'"status": "ok",\s*"regionType": "cylinder",\s*"center": list\(center\),\s*"axis": list\(axis\),\s*"radius": round\(radius, 6\),\s*"depth": depth,\s*"top_z": top_z,\s*"bottom_z": bottom_z,',
    r'"valid": True,\n            "regionId": feature.get("id", "unknown"),\n            "regionType": "drill_region",\n            "center": list(center),\n            "axis": list(axis),\n            "depth": depth,\n            "topZ": top_z,\n            "bottomZ": bottom_z,\n            "source": "hole_center",',
    content, flags=re.DOTALL
)

# Update Pocket
content = re.sub(
    r'"status": "ok",\s*"regionType": "pocket_region",\s*"boundary_points": boundary_points,\s*"floor_z": floor_z,\s*"top_z": top_z,\s*"wire_id": wire_id,\s*"point_count": len\(boundary_points\),',
    r'"valid": True,\n            "regionId": feature.get("id", "unknown"),\n            "regionType": "pocket_region",\n            "boundary": boundary_points,\n            "bottomZ": floor_z,\n            "topZ": top_z,\n            "source": "pocket_boundary",\n            "area": area,',
    content, flags=re.DOTALL
)

# Update Face
content = re.sub(
    r'"status": "ok",\s*"regionType": "face_boundary",\s*"face_boundary": face_boundary,\s*"face_z": face_z,\s*"normal": list\(normal\),\s*"wire_id": wire_id,\s*"point_count": len\(face_boundary\),',
    r'"valid": True,\n            "regionId": feature.get("id", "unknown"),\n            "regionType": "face_region",\n            "boundary": face_boundary,\n            "topZ": face_z,\n            "bottomZ": face_z,\n            "source": "face_boundary",\n            "area": area,',
    content, flags=re.DOTALL
)

# Update Step
content = re.sub(
    r'"status": "ok",\s*"regionType": "step_region",\s*"boundary_points": boundary_points,\s*"step_z": step_z,\s*"top_z": top_z,\s*"wire_id": wire_id,\s*"point_count": len\(boundary_points\),',
    r'"valid": True,\n            "regionId": feature.get("id", "unknown"),\n            "regionType": "contour_region",\n            "boundary": boundary_points,\n            "bottomZ": step_z,\n            "topZ": top_z,\n            "source": "outer_wire",',
    content, flags=re.DOTALL
)

# Update External Cylinder / Shaft
content = re.sub(
    r'"status": "blocked" if status == "blocked" else "ok",\s*"regionType": "none" if status == "blocked" else region_type,\s*"center": center,\s*"axis": axis,\s*"radius": round\(radius, 6\),\s*"length": length,\s*"bbox": bb,\s*"source": "cylinder_extraction",',
    r'"valid": status == "ok",\n            "regionId": feature.get("id", "unknown"),\n            "regionType": "none" if status == "blocked" else region_type,\n            "center": center,\n            "axis": axis,\n            "bbox": bb,\n            "source": "turning_profile",',
    content, flags=re.DOTALL
)

# Update Boss
content = re.sub(
    r'"status": "ok",\s*"regionType": "boss_clearing_region",\s*"floor_boundary": floor_boundary,\s*"boss_island": boss_island,\s*"floor_z": floor_z,\s*"top_z": top_z,\s*"floor_area": floor_area,\s*"island_area": island_area,',
    r'"valid": True,\n            "regionId": feature.get("id", "unknown"),\n            "regionType": "boss_clearing_region",\n            "boundary": floor_boundary,\n            "islands": [boss_island],\n            "bottomZ": floor_z,\n            "topZ": top_z,\n            "area": floor_area,\n            "source": "boss_floor_minus_island",',
    content, flags=re.DOTALL
)

# Update failed status to valid: False and errorReason
content = content.replace('"status": "failed"', '"valid": False')
content = content.replace('"status": "error"', '"valid": False')
content = content.replace('"status": "blocked"', '"valid": False')
content = content.replace('"error": ', '"errorReason": ')

# Specific fix for contour blocked source:
content = content.replace('"regionType": "none"', '"regionType": "none",\n                "source": "none"')

with open("app/services/geometry_mapper.py", "w") as f:
    f.write(content)
