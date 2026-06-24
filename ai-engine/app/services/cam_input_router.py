import uuid
import os
from typing import Dict, Any

class CamInputRouter:
    """
    Unified CAM input router.
    Supports routing both Blueprint-generated CAD scripts and direct STEP file uploads
    into the CAM processing pipeline.
    """
    
    def __init__(self, output_dir: str):
        self.output_dir = output_dir
        os.makedirs(self.output_dir, exist_ok=True)
        
    def process_step_upload(self, step_content: bytes, filename: str) -> Dict[str, Any]:
        """Process a directly uploaded STEP file."""
        job_id = str(uuid.uuid4())
        safe_filename = f"upload_{job_id}.step"
        step_file_path = os.path.join(self.output_dir, safe_filename)
        
        with open(step_file_path, "wb") as f:
            f.write(step_content)
            
        return {
            "job_id": job_id,
            "input_type": "step",
            "step_file_path": step_file_path,
            "source": "uploaded_step",
            "status": "ready_for_cam"
        }
        
    def process_blueprint_cad(self, step_file_path: str) -> Dict[str, Any]:
        """Process a STEP file generated from a blueprint/LLM script."""
        job_id = str(uuid.uuid4())
        
        return {
            "job_id": job_id,
            "input_type": "blueprint",
            "step_file_path": step_file_path,
            "source": "generated_from_build123d",
            "status": "ready_for_cam"
        }
