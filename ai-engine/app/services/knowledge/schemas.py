from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
from datetime import datetime

class OntologyNodeSchema(BaseModel):
    id: Optional[str] = None
    name: str
    description: Optional[str] = None
    parent_id: Optional[str] = None

class EngineeringRuleSchema(BaseModel):
    rule_id: str
    version: str = "1.0"
    source_id: str
    topic: Optional[str] = None
    confidence: float = 1.0
    status: str = "active" # active, deprecated, experimental
    reviewer: Optional[str] = None
    ontology_node_id: Optional[str] = None
    concept: Optional[str] = None
    description: str
    input_signals: Optional[Dict[str, Any]] = None
    required_context: Optional[Dict[str, Any]] = None
    validation_rules: Optional[Dict[str, Any]] = None

class KnowledgeDocumentSchema(BaseModel):
    id: Optional[str] = None
    filename: str
    version: str = "1.0"
    pageCount: int
    status: str = "processing"
    failedPages: Optional[Dict[str, Any]] = None

class KnowledgeRetrievalQuery(BaseModel):
    query: Optional[str] = None
    pipeline_stage: Optional[str] = None
    detected_symbols: List[str] = []
    ocr_tokens: List[str] = []
    feature_candidates: List[str] = []
    view_types: List[str] = []
    limit: int = 8

class KnowledgeRetrievalResponse(BaseModel):
    rules: List[EngineeringRuleSchema]
    ontology_nodes: List[OntologyNodeSchema]
    relevant_chunks: List[str] = []
    source_references: List[str] = []
    conflicts: List[str] = []
    retrieval_confidence: float = 0.0
