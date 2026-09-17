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

    # 2. Substring & Token matching
    if not mat_data:
        # Check bidirectional substring
        for m in materials:
            m_id = m["id"].lower()
            m_name = m["name"].lower()
            if material_id_lower in m_id or material_id_lower in m_name or m_id in material_id_lower:
                mat_data = m
                break

    # 3. Known Engineering Material Aliases & Callout Mappings
    if not mat_data:
        # Common blueprint callouts: HSS / HRC 58-60 / Tool Steel / Hardened
        if any(kw in material_id_lower for kw in ("hss", "high speed steel", "m2", "m35", "m42")):
            for m in materials:
                if m["id"] in ("hss_m2", "hardened_steel", "tool_steel_d2"):
                    mat_data = m
                    break
        elif any(kw in material_id_lower for kw in ("hrc", "hardened", "58-60", "58_60", "50-65")):
            for m in materials:
                if m["id"] in ("hardened_steel", "hss_m2"):
                    mat_data = m
                    break
        elif "tool" in material_id_lower and "steel" in material_id_lower:
            for m in materials:
                if m["id"] in ("tool_steel_d2", "tool_steel_a2", "tool_steel_o1", "hss_m2"):
                    mat_data = m
                    break
        elif any(kw in material_id_lower for kw in ("mild", "1018", "a36", "en8", "en9")):
            for m in materials:
                if m["id"] in ("mild_steel", "steel_1045"):
                    mat_data = m
                    break
        elif any(kw in material_id_lower for kw in ("4140", "4340", "en19", "en24", "chromoly")):
            for m in materials:
                if m["id"] in ("alloy_steel_4140", "alloy_steel_4340"):
                    mat_data = m
                    break
        elif any(kw in material_id_lower for kw in ("stainless", "ss304", "ss316", "304", "316", "17-4")):
            for m in materials:
                if "stainless" in m["id"]:
                    mat_data = m
                    break
        elif any(kw in material_id_lower for kw in ("titanium", "ti-6al-4v", "gr5")):
            for m in materials:
                if "titanium" in m["id"]:
                    mat_data = m
                    break
        elif any(kw in material_id_lower for kw in ("brass", "copper", "bronze")):
            for m in materials:
                if any(k in m["id"] for k in ("brass", "copper", "bronze")):
                    mat_data = m
                    break

    # 4. Default fallback if still not found
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
        description=mat_data.get("description", ""),
        cost_per_kg=float(mat_data.get("costPerKg", 420.0)),
        currency=mat_data.get("currency", "INR")
    )

def list_all_materials() -> List[Dict[str, Any]]:
    matrix = get_material_matrix()
    return matrix.get("materials", [])

def list_material_categories() -> List[Dict[str, Any]]:
    matrix = get_material_matrix()
    return matrix.get("categories", [])
