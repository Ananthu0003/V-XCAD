from .base_post import BasePostProcessor
from .iso_post import IsoPostProcessor
from .fanuc_post import FanucPostProcessor
from .haas_post import HaasPostProcessor
from .siemens_post import SiemensPostProcessor
from .heidenhain_post import HeidenhainPostProcessor

def get_post_processor(controller_name: str, cam_params: dict) -> BasePostProcessor:
    """Returns the appropriate post processor based on the controller name."""
    name = controller_name.lower().strip()
    
    if name == "fanuc":
        return FanucPostProcessor(cam_params)
    elif name == "haas":
        return HaasPostProcessor(cam_params)
    elif name == "siemens":
        return SiemensPostProcessor(cam_params)
    elif name == "heidenhain":
        return HeidenhainPostProcessor(cam_params)
    # Default fallback
    return IsoPostProcessor(cam_params)
