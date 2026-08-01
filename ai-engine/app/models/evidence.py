from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional

class EvidenceGraph(BaseModel):
    parameter_id: str
    name: str
    value: Any
    unit: str = "mm"
    feature_id: str
    source_view: Optional[str] = None
    source_page: Optional[int] = None
    source_bbox: Optional[List[float]] = None
    source_text: Optional[str] = None
    association_method: Optional[str] = None
    supporting_rules: List[str] = []
    confidence: float = 1.0
    status: str = "inferred" # confirmed, inferred, ambiguous, missing, requires_user_confirmation
