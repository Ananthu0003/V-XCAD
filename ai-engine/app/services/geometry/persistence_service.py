import os
import json
from pathlib import Path
from typing import Any
from pydantic import BaseModel

class JobPersistenceService:
    """
    Handles job-scoped artifact persistence to disk.
    Each generation session gets its own directory under storage/jobs/<session_id>/
    """
    
    def __init__(self, base_dir: str = "storage/jobs"):
        self.base_dir = Path(base_dir)
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def _get_job_dir(self, session_id: str) -> Path:
        job_dir = self.base_dir / session_id
        for subdir in ["input", "evidence", "efg", "constraints", "planning", "generation", "artifacts", "verification", "repairs"]:
            (job_dir / subdir).mkdir(parents=True, exist_ok=True)
        return job_dir

    def save_artifact(self, session_id: str, category: str, filename: str, data: Any):
        """
        Saves an artifact (Pydantic model, dict, or string) to the specified category folder.
        Categories: evidence, efg, constraints, planning, etc.
        """
        job_dir = self._get_job_dir(session_id)
        filepath = job_dir / category / filename
        
        if isinstance(data, BaseModel):
            filepath.write_text(data.model_dump_json(indent=2), encoding="utf-8")
        elif isinstance(data, dict):
            filepath.write_text(json.dumps(data, indent=2), encoding="utf-8")
        elif isinstance(data, str):
            filepath.write_text(data, encoding="utf-8")
        else:
            raise ValueError("Unsupported data type for persistence")
            
    def load_artifact(self, session_id: str, category: str, filename: str) -> str:
        job_dir = self._get_job_dir(session_id)
        filepath = job_dir / category / filename
        if filepath.exists():
            return filepath.read_text(encoding="utf-8")
        return ""
