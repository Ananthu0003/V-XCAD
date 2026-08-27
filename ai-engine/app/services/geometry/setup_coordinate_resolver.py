import math
from typing import Dict, Any, Tuple, Optional, List
import build123d as bd
from app.constants import RECOGNIZED_STOCK_TYPES

class SetupCoordinateResolver:
    """
    Versioned SetupCoordinateResolver that combines:
    - setup orientation
    - model placement
    - resolved stock geometry
    - selected origin reference
    
    Generates a rigid 4x4 modelToSetupTransform.
    """
    VERSION = "1.0.0"

    def __init__(self, shape: bd.Shape, setup_config: Dict[str, Any]):
        self.shape = shape
        self.setup_config = setup_config
        self.resolved_stock = self._calculate_stock()
        self.model_to_setup_location = self._calculate_transform()

    def _calculate_stock(self) -> Dict[str, Any]:
        bb = self.shape.bounding_box()
        # Default bounds based on model
        min_x, max_x = bb.min.X, bb.max.X
        min_y, max_y = bb.min.Y, bb.max.Y
        min_z, max_z = bb.min.Z, bb.max.Z

        stock_type = self.setup_config.get("stockType", "box")
        offset = float(self.setup_config.get("stockOffset", 0.0))
        stock_dims = self.setup_config.get("stockDimensions")

        if stock_type in RECOGNIZED_STOCK_TYPES:
            if stock_dims and len(stock_dims) >= 3:
                # Use explicit stock dimensions from UI
                length, width, height = float(stock_dims[0]), float(stock_dims[1]), float(stock_dims[2])
                
                # Center in X and Y
                center_x = (min_x + max_x) / 2
                center_y = (min_y + max_y) / 2
                
                min_x = center_x - length / 2
                max_x = center_x + length / 2
                min_y = center_y - width / 2
                max_y = center_y + width / 2
                
                # Apply offset to top, let the rest hang down
                max_z += offset
                min_z = max_z - height
            else:
                # Auto-calculate from model + offset
                min_x -= offset
                max_x += offset
                min_y -= offset
                max_y += offset
                max_z += offset
                min_z -= offset

        length = max_x - min_x
        width = max_y - min_y
        height = max_z - min_z

        return {
            "bounds": {
                "min": (min_x, min_y, min_z),
                "max": (max_x, max_y, max_z)
            },
            "dimensions": (length, width, height),
            "center": (min_x + length/2, min_y + width/2, min_z + height/2),
            "stockType": stock_type,
            "stockOffset": offset
        }

    def _calculate_transform(self) -> bd.Location:
        """
        Calculates the transformation to move the setup's origin to (0,0,0) in setup space.
        """
        origin_pos = self.setup_config.get("originPosition", "top_center")
        bounds = self.resolved_stock["bounds"]
        
        # Origin is generally based on Stock bounds, not Model bounds
        min_x, min_y, min_z = bounds["min"]
        max_x, max_y, max_z = bounds["max"]
        
        if origin_pos == "top_center":
            ox, oy, oz = (min_x + max_x)/2, (min_y + max_y)/2, max_z
        elif origin_pos == "bottom_center":
            ox, oy, oz = (min_x + max_x)/2, (min_y + max_y)/2, min_z
        elif origin_pos == "model_center":
            ox, oy, oz = self.resolved_stock["center"]
        elif origin_pos == "front_left_top":
            ox, oy, oz = min_x, min_y, max_z
        else:
            ox, oy, oz = (min_x + max_x)/2, (min_y + max_y)/2, max_z

        translation = bd.Vector(-ox, -oy, -oz)
        # Assuming no orientation rotation changes for now (Z is up)
        return bd.Location(translation)

    def get_transform_matrix(self) -> List[float]:
        """
        Returns a 16-element flat array representing the 4x4 matrix in row-major order.
        """
        trsf = self.model_to_setup_location.wrapped.Transformation()
        matrix = []
        for i in range(1, 4):
            for j in range(1, 5):
                matrix.append(trsf.Value(i, j))
        matrix.extend([0.0, 0.0, 0.0, 1.0])
        return matrix

    def get_inverse_transform_matrix(self) -> List[float]:
        trsf = self.model_to_setup_location.wrapped.Transformation().Inverted()
        matrix = []
        for i in range(1, 4):
            for j in range(1, 5):
                matrix.append(trsf.Value(i, j))
        matrix.extend([0.0, 0.0, 0.0, 1.0])
        return matrix

    def get_setup_metadata(self) -> Dict[str, Any]:
        # Transform stock center and bounds into setup space
        trsf = self.model_to_setup_location.wrapped.Transformation()
        
        # Helper to transform a point
        def transform_pt(pt: Tuple[float, float, float]) -> Tuple[float, float, float]:
            from OCP.gp import gp_Pnt
            p = gp_Pnt(*pt)
            p.Transform(trsf)
            return (p.X(), p.Y(), p.Z())
            
        orig_bounds = self.resolved_stock["bounds"]
        orig_center = self.resolved_stock["center"]
        
        # Transform the bounding box corners and find new min/max
        # Since it's a rigid transformation without rotation, we can just transform min/max
        p_min = transform_pt(orig_bounds["min"])
        p_max = transform_pt(orig_bounds["max"])
        
        # Ensure min is actually min (in case of rotations in future)
        new_min = (min(p_min[0], p_max[0]), min(p_min[1], p_max[1]), min(p_min[2], p_max[2]))
        new_max = (max(p_min[0], p_max[0]), max(p_min[1], p_max[1]), max(p_min[2], p_max[2]))
        
        setup_space_stock = {
            "bounds": {"min": new_min, "max": new_max},
            "dimensions": self.resolved_stock["dimensions"],
            "center": transform_pt(orig_center),
            "stockType": self.resolved_stock["stockType"],
            "stockOffset": self.resolved_stock["stockOffset"]
        }

        return {
            "version": self.VERSION,
            "modelToSetupTransform": self.get_transform_matrix(),
            "setupToModelTransform": self.get_inverse_transform_matrix(),
            "matrixLayout": "row-major",
            "resolvedStock": setup_space_stock,
            "originPosition": self.setup_config.get("originPosition", "top_center")
        }

    def create_setup_space_copy(self) -> bd.Shape:
        """
        Returns a copy of the shape transformed to setup space.
        """
        # build123d .moved() returns a new transformed shape
        return self.shape.moved(self.model_to_setup_location)
