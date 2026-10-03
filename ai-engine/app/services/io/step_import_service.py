import os
import build123d as bd
from typing import Dict, Any

class StepImportService:
    """
    Imports STEP files using OpenCASCADE (via build123d),
    validates the B-Rep topology, extracts bounding boxes,
    and heuristically recommends a machine type.
    """
    
    def __init__(self):
        pass

    def import_and_validate(self, step_file_path: str) -> Dict[str, Any]:
        """
        Loads the STEP file, validates that it contains solid B-Rep geometry,
        and returns a structured topology analysis.
        """
        if not os.path.exists(step_file_path):
            raise FileNotFoundError(f"STEP file not found: {step_file_path}")

        try:
            shape = bd.import_step(step_file_path)
            if hasattr(shape, "part"):
                shape = shape.part
        except Exception as e:
            raise ValueError(f"Failed to load STEP file. Not a valid B-Rep or corrupted. Error: {e}")

        # Validate Solids
        solids = shape.solids() if hasattr(shape, "solids") else []
        solid_count = len(solids)
        if solid_count == 0:
            if isinstance(shape, bd.Solid):
                solid_count = 1
            else:
                raise ValueError("Validation failed: STEP file must contain at least one solid B-Rep body for CAM processing.")

        # Extract Topology Elements
        faces = shape.faces() if hasattr(shape, "faces") else []
        edges = shape.edges() if hasattr(shape, "edges") else []
        
        # Precision Bounding Box
        bbox = shape.bounding_box()
        
        # Machine Type Heuristic
        machine_type = self._detect_machine_type(shape, bbox)

        return {
            "solid_count": solid_count,
            "units": "mm", # build123d normalizes to mm
            "bbox": {
                "x": bbox.max.X - bbox.min.X,
                "y": bbox.max.Y - bbox.min.Y,
                "z": bbox.max.Z - bbox.min.Z
            },
            "topology": {
                "faces": len(faces),
                "edges": len(edges),
                "solids": solid_count
            },
            "recommended_machine_type": machine_type
        }
        
    def _detect_machine_type(self, shape: Any, bbox: Any) -> str:
        """
        Heuristic detection of CNC machine type based on B-Rep face geometries.
        If the majority of faces are cylindrical/rotational, it's likely a lathe part.
        """
        cylindrical_faces = 0
        total_faces = len(shape.faces()) if hasattr(shape, "faces") else 1
        
        if hasattr(shape, "faces"):
            for f in shape.faces():
                try:
                    # Try to get underlying surface type string
                    geom_type = f.geom_type().name if hasattr(f.geom_type, 'name') else str(f.geom_type())
                    if any(t in geom_type.upper() for t in ['CYLINDER', 'CONE', 'SPHERE']):
                        cylindrical_faces += 1
                except Exception:
                    pass
                
        # If > 60% of faces are rotational, it's primarily a turned part.
        if total_faces > 0 and (cylindrical_faces / total_faces) > 0.6:
            # Check for non-planar/non-rotational features that might require live tooling
            try:
                complex_faces = [f for f in shape.faces() 
                                 if 'CYLINDER' not in str(f.geom_type()).upper() and 
                                    'CONE' not in str(f.geom_type()).upper() and 
                                    'SPHERE' not in str(f.geom_type()).upper() and 
                                    'PLANE' not in str(f.geom_type()).upper()]
                if len(complex_faces) > 0:
                     return "mill_turn"
            except Exception:
                pass
                
            return "lathe"
            
        return "3_axis_mill"
