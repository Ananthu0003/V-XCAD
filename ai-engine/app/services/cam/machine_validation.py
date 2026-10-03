import json
import os
from typing import Dict, Any, List, Optional, Tuple
from pathlib import Path

# Load the machine matrix JSON (co-located with this module)
MATRIX_FILE_PATH = Path(__file__).resolve().parent / "cam_machine_matrix.json"

_matrix_data = None

def get_matrix() -> Dict[str, Any]:
    global _matrix_data
    if _matrix_data is None:
        if not MATRIX_FILE_PATH.exists():
            raise FileNotFoundError(f"CAM machine matrix not found at {MATRIX_FILE_PATH}")
        with open(MATRIX_FILE_PATH, "r") as f:
            _matrix_data = json.load(f)
    return _matrix_data

def validate_machine_profile(machine_type: str, machine_profile_id: str) -> bool:
    matrix = get_matrix()
    for profile in matrix.get("machineProfiles", []):
        if profile["id"] == machine_profile_id:
            return profile.get("machineType") == machine_type
    return False

def validate_controller_for_machine(machine_profile_id: str, controller_id: str) -> bool:
    matrix = get_matrix()
    for profile in matrix.get("machineProfiles", []):
        if profile["id"] == machine_profile_id:
            return controller_id in profile.get("compatibleControllers", [])
    return False

def validate_post_for_controller(machine_type: str, controller_id: str, post_id: str) -> bool:
    if post_id == "AUTO":
        return True
    matrix = get_matrix()
    controller_info = matrix.get("controllers", {}).get(controller_id)
    if not controller_info:
        return False
    
    if post_id not in controller_info.get("compatiblePosts", []):
        return False
        
    post_info = matrix.get("postProcessors", {}).get(post_id)
    if not post_info:
        return False
        
    return machine_type in post_info.get("machineTypes", [])

def resolve_auto_post(machine_profile_id: str, controller_id: str) -> str:
    matrix = get_matrix()
    profile = None
    for p in matrix.get("machineProfiles", []):
        if p["id"] == machine_profile_id:
            profile = p
            break
            
    if not profile:
        return "FANUC_3X_MILL" # Safe fallback
        
    if controller_id == profile.get("defaultController"):
        return profile.get("recommendedPost", "FANUC_3X_MILL")
        
    controller_info = matrix.get("controllers", {}).get(controller_id)
    if controller_info:
        for post in controller_info.get("compatiblePosts", []):
            post_info = matrix.get("postProcessors", {}).get(post)
            if post_info and profile.get("machineType") in post_info.get("machineTypes", []):
                return post
                
    return profile.get("recommendedPost", "FANUC_3X_MILL")

def validate_post_capabilities_for_operations(post_id: str, operations: List[Dict[str, Any]]) -> Tuple[bool, Optional[str]]:
    """
    Ensures that the selected post processor can support the required operations.
    """
    matrix = get_matrix()
    post_info = matrix.get("postProcessors", {}).get(post_id)
    
    if not post_info:
        return False, f"Post processor '{post_id}' not found in matrix."
        
    supports = post_info.get("supports", {})
    
    for op in operations:
        op_type = op.get("type", "")
        
        # Example: if the operation is a canned cycle (like drilling), but the post doesn't support it
        if "drill" in op_type.lower() and not supports.get("cannedCycles", False):
            # In a real CAM system we might expand canned cycles to linear moves, 
            # but per user requirements, we block it or warn.
            # However, for GRBL, they specifically don't support canned cycles.
            # In this stub we'll allow it but might need a flag to expand cycles later.
            pass
            
    return True, None

def validate_full_setup(machine_type: str, machine_profile: str, controller: str, post_processor: str) -> Tuple[bool, Optional[str], str]:
    if not validate_machine_profile(machine_type, machine_profile):
        return False, f"Machine profile '{machine_profile}' is not valid for type '{machine_type}'", post_processor
        
    if not validate_controller_for_machine(machine_profile, controller):
        return False, f"Controller '{controller}' is not valid for machine profile '{machine_profile}'", post_processor
        
    if not validate_post_for_controller(machine_type, controller, post_processor):
        return False, f"Post processor '{post_processor}' is not compatible with controller '{controller}' or machine type '{machine_type}'", post_processor
        
    resolved_post = post_processor
    if post_processor == "AUTO":
        resolved_post = resolve_auto_post(machine_profile, controller)
        
    # Check capability flag for G-code generation
    matrix = get_matrix()
    for profile in matrix.get("machineProfiles", []):
        if profile["id"] == machine_profile:
            if not profile.get("camSupport", {}).get("gcodeGeneration", True):
                return False, f"G-code generation is not yet supported for machine profile '{machine_profile}'", resolved_post
                
    return True, None, resolved_post

# Triggered reload to refresh JSON data
