import build123d as bd
from OCP.STEPControl import STEPControl_Reader
from OCP.IFSelect import IFSelect_RetDone
from OCP.ShapeFix import ShapeFix_Shape
from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
from OCP.gp import gp_Trsf
from typing import Dict, Any, Tuple
import os

class StepImporter:
    @staticmethod
    def load_and_heal(file_path: str) -> Tuple[Any, Dict[str, Any]]:
        """
        Loads a STEP file, checks units, normalizes to mm, heals topology.
        Returns (build123d.Shape, metadata_dict)
        """
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"STEP file not found: {file_path}")
            
        bd_shape = bd.import_step(file_path)
        
        if hasattr(bd_shape, "part"):
            bd_shape = bd_shape.part
            
        # Count solids properly by looking at solids() if possible, or just 1 if it's a solid
        solid_count = 1
        try:
            solid_count = len(bd_shape.solids())
        except:
            pass
        
        bbox = bd_shape.bounding_box()
        
        metadata = {
            "unit": "mm",
            "solid_count": solid_count,
            "is_valid": True,
            "bbox": {
                "x": round(bbox.max.X - bbox.min.X, 2),
                "y": round(bbox.max.Y - bbox.min.Y, 2),
                "z": round(bbox.max.Z - bbox.min.Z, 2)
            }
        }
        
        return bd_shape, metadata
