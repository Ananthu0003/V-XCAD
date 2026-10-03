from pydantic import BaseModel, Field
from typing import List, Optional, Any, Dict, Union

class GraphNode(BaseModel):
    id: str = Field(..., description="Unique identifier for the node")
    node_type: str = Field(..., description="Type of node (e.g. circle, line, hole, dimension)")
    confidence: float = 1.0

class GraphEdge(BaseModel):
    source_id: str
    target_id: str
    relationship: str = Field(..., description="e.g. supports, contains, connects_to, matches")
    weight: float = 1.0

class GeometryNode(GraphNode):
    geometry_data: Dict[str, Any] = Field(default_factory=dict, description="Deterministic 2D data (e.g. endpoints, radius, center)")

class SketchNode(GraphNode):
    profile_type: str = Field(..., description="e.g. open, closed, extrusion_candidate, revolve_candidate")
    geometry_refs: List[str] = Field(default_factory=list, description="IDs of GeometryNodes forming this profile")

class DimensionNode(GraphNode):
    value: float
    tolerance: Optional[str] = None
    feature_refs: List[str] = Field(default_factory=list, description="IDs of features this dimension applies to")
    source_view: str
    supporting_rules: List[str] = Field(default_factory=list, description="Knowledge rule IDs retrieved during parsing")

class FeatureNode(GraphNode):
    feature_class: str = Field(..., description="e.g. Hole, Boss, Pocket")
    parameters: Dict[str, Any] = Field(default_factory=dict)
    sketch_refs: List[str] = Field(default_factory=list, description="IDs of SketchNodes defining this feature")

class ViewCorrespondenceEdge(GraphEdge):
    primary_view: str
    secondary_view: str
    transformation: Optional[Dict[str, float]] = Field(None, description="Mathematical alignment transform between views")

class AbstractGraph(BaseModel):
    nodes: Dict[str, GraphNode] = Field(default_factory=dict)
    edges: List[GraphEdge] = Field(default_factory=list)

class ViewCorrespondenceGraph(AbstractGraph):
    pass

class GeometryGraph(AbstractGraph):
    pass

class SketchGraph(AbstractGraph):
    pass

class DimensionGraph(AbstractGraph):
    pass

class EvidenceGraph(AbstractGraph):
    fused_confidence_scores: Dict[str, float] = Field(default_factory=dict)

class FeatureGraph(AbstractGraph):
    pass
