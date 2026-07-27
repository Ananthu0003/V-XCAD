import json
from pathlib import Path
from typing import Dict, Any, Optional
from app.models.timing_profiles import (
    MachineTimingProfile,
    ControllerTimingProfile,
    SetupHandlingProfile,
    ResolvedTimingParameter
)

class TimingParameterResolver:
    """Resolves timing values with priority cascade and provenance tracking."""
    
    def resolve(
        self,
        parameter_name: str,
        machine_profile: Optional[MachineTimingProfile],
        controller_profile: Optional[ControllerTimingProfile],
        setup_handling: Optional[SetupHandlingProfile],
        generic_defaults: Dict[str, Any]
    ) -> ResolvedTimingParameter:
        
        # 1. Check machine profile
        if machine_profile and hasattr(machine_profile, parameter_name):
            val = getattr(machine_profile, parameter_name)
            if val is not None:
                return ResolvedTimingParameter(
                    parameter=parameter_name,
                    value=val,
                    source="machine_timing_profile",
                    confidence="high",
                    profile_id=machine_profile.profile_id,
                    profile_version=machine_profile.profile_version
                )
                
        # 2. Check controller profile
        if controller_profile and hasattr(controller_profile, parameter_name):
            val = getattr(controller_profile, parameter_name)
            if val is not None:
                return ResolvedTimingParameter(
                    parameter=parameter_name,
                    value=val,
                    source="controller_timing_profile",
                    confidence="high",
                    profile_id=controller_profile.controller_id
                )
                
        # 3. Check setup handling profile
        if setup_handling and hasattr(setup_handling, parameter_name):
            val = getattr(setup_handling, parameter_name)
            if val is not None:
                return ResolvedTimingParameter(
                    parameter=parameter_name,
                    value=val,
                    source="setup_override",
                    confidence="medium"
                )
                
        # 4. Generic machine-family default
        if parameter_name in generic_defaults:
            return ResolvedTimingParameter(
                parameter=parameter_name,
                value=generic_defaults[parameter_name],
                source="generic_machine_family_default",
                confidence="low"
            )
            
        # 5. Missing
        return ResolvedTimingParameter(
            parameter=parameter_name,
            value=None,
            source="missing",
            confidence="low"
        )


class ProfileLoader:
    def __init__(self):
        self.profiles_dir = Path(__file__).resolve().parent / "profiles"
        
        self.machine_matrix = self._load_json(self.profiles_dir.parent / "cam_machine_matrix.json")
        self.capabilities = self._load_json(self.profiles_dir / "machine_capabilities.json")
        self.machine_timing = self._load_json(self.profiles_dir / "machine_timing_profiles.json")
        self.controller_timing = self._load_json(self.profiles_dir / "controller_timing_profiles.json")
        self.handling_defaults = self._load_json(self.profiles_dir / "setup_handling_defaults.json")

    def _load_json(self, path: Path) -> Dict[str, Any]:
        try:
            with open(path, 'r') as f:
                return json.load(f)
        except Exception as e:
            print(f"[ProfileLoader] Failed to load {path}: {e}")
            return {}
            
    def get_machine_matrix_entry(self, machine_id: str) -> Optional[Dict[str, Any]]:
        profiles = self.machine_matrix.get("machineProfiles", [])
        return next((p for p in profiles if p.get("id") == machine_id), None)

    def load_machine_timing_profile(self, profile_id: str) -> Optional[MachineTimingProfile]:
        data = self.machine_timing.get(profile_id)
        if not data:
            return None
        return MachineTimingProfile(profile_id=profile_id, **data)
        
    def load_controller_timing_profile(self, controller_id: str) -> Optional[ControllerTimingProfile]:
        data = self.controller_timing.get(controller_id)
        if not data:
            return None
        return ControllerTimingProfile(controller_id=controller_id, **data)
        
    def load_setup_handling_profile(self, profile_id: str) -> Optional[SetupHandlingProfile]:
        data = self.handling_defaults.get(profile_id)
        if not data:
            return None
        return SetupHandlingProfile(**data)
        
    def get_generic_defaults_for_type(self, machine_type: str) -> Dict[str, Any]:
        defaults = {
            "minimum_block_time_seconds": 0.002,
            "look_ahead_blocks": 40,
            "tool_change": {
                "timing_mode": "exchange_only",
                "duration_seconds": 15.0,
                "includes_spindle_stop": False,
                "includes_spindle_orientation": False,
                "includes_axis_positioning": False,
                "includes_spindle_restart": False,
                "includes_return_positioning": False
            }
        }
        
        if "MILL" in machine_type:
            defaults.update({
                "rapid_rate_x_mm_min": 10000.0,
                "rapid_rate_y_mm_min": 10000.0,
                "rapid_rate_z_mm_min": 10000.0,
                "acceleration_x_mm_s2": 1000.0,
                "acceleration_y_mm_s2": 1000.0,
                "acceleration_z_mm_s2": 1000.0,
                "spindle_accel_rpm_per_sec": 2000.0,
                "spindle_decel_rpm_per_sec": 2000.0,
            })
            
        return defaults
