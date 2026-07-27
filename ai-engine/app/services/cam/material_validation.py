import json
import os
from typing import Dict, Any, List, Optional
from pathlib import Path
from app.models.manufacturing import MaterialProfile

# Load the material matrix JSON (co-located with this module)
MATRIX_FILE_PATH = Path(__file__).resolve().parent / "cam_material_matrix.json"

_material_matrix_data: Optional[Dict[str, Any]] = None

def get_material_matrix() -> Dict[str, Any]:
    global _material_matrix_data
    if _material_matrix_data is None:
        if not MATRIX_FILE_PATH.exists():
            # Fallback path if loaded relative to root
            alt_path = Path(__file__).resolve().parents[3] / "web-ui" / "lib" / "cam" / "cam_material_matrix.json"
            if alt_path.exists():
                with open(alt_path, "r") as f:
                    _material_matrix_data = json.load(f)
                return _material_matrix_data
            raise FileNotFoundError(f"CAM material matrix not found at {MATRIX_FILE_PATH}")
        with open(MATRIX_FILE_PATH, "r") as f:
            _material_matrix_data = json.load(f)
    return _material_matrix_data

def get_material_profile(material_id: Optional[str]) -> MaterialProfile:
    """
    Resolves a material_id string (e.g. 'aluminum_6061', 'titanium_gr5') to a full MaterialProfile object.
    Falls back to Aluminum 6061 if material_id is unknown or None.
    """
    if not material_id:
        material_id = "aluminum_6061"

    matrix = get_material_matrix()
    materials = matrix.get("materials", [])
    
    mat_data = None
    material_id_lower = material_id.lower().strip()
    
    # 1. Exact match
    for m in materials:
        if m["id"].lower() == material_id_lower:
            mat_data = m
            break

    # 2. Substring match fallback (e.g. '6061', 'titanium', 'delrin', 'stainless')
    if not mat_data:
        for m in materials:
            if material_id_lower in m["id"].lower() or material_id_lower in m["name"].lower():
                mat_data = m
                break

    # 3. Default fallback if still not found
    if not mat_data:
        mat_data = materials[0]  # aluminum_6061

    return MaterialProfile(
        material_id=mat_data["id"],
        material_name=mat_data["name"],
        category=mat_data.get("category", "aluminum"),
        category_label=mat_data.get("categoryLabel", "Aluminum Alloys"),
        machinability_rating=float(mat_data.get("machinabilityRating", 100)),
        tool_materials=mat_data.get("compatibleToolMaterials", ["carbide", "hss"]),
        cutting_speed=float(mat_data.get("cuttingSpeedMMin", 300)),
        feed_per_tooth=float(mat_data.get("feedPerToothMm", 0.08)),
        coolant_requirement=mat_data.get("coolantRequirement", "flood"),
        density_gcm3=float(mat_data.get("densityGcm3", 2.70)),
        hardness=f"{mat_data.get('hardnessHb', 95)} HB",
        description=mat_data.get("description", "")
    )

def list_all_materials() -> List[Dict[str, Any]]:
    matrix = get_material_matrix()
    return matrix.get("materials", [])

def list_material_categories() -> List[Dict[str, Any]]:
    matrix = get_material_matrix()
    return matrix.get("categories", [])
