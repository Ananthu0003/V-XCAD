from typing import Dict, List, Optional
from app.services.knowledge.schemas import OntologyNodeSchema

# Predefined ontology for quick in-memory lookups
# A full version would be dynamically loaded from PostgreSQL
DEFAULT_ONTOLOGY: List[OntologyNodeSchema] = [
    OntologyNodeSchema(name="Feature", description="Base manufacturing or geometric feature"),
    OntologyNodeSchema(name="Hole", parent_id="Feature", description="Cylindrical feature extending into or through the part"),
    OntologyNodeSchema(name="Boss", parent_id="Feature", description="Raised cylindrical or generalized geometric protrusion"),
    OntologyNodeSchema(name="Slot", parent_id="Feature", description="Elongated cutout"),
    OntologyNodeSchema(name="Pocket", parent_id="Feature", description="Enclosed cutout"),
    OntologyNodeSchema(name="Shaft", parent_id="Feature", description="Cylindrical external feature"),
    OntologyNodeSchema(name="Chamfer", parent_id="Feature", description="Angled edge treatment"),
    OntologyNodeSchema(name="Fillet", parent_id="Feature", description="Rounded edge treatment"),
    
    # Hole properties
    OntologyNodeSchema(name="Diameter", parent_id="Hole", description="Primary width of the hole"),
    OntologyNodeSchema(name="Depth", parent_id="Hole", description="Length of the hole along its axis"),
    OntologyNodeSchema(name="Thread", parent_id="Hole", description="Internal threading definition"),
    OntologyNodeSchema(name="Counterbore", parent_id="Hole", description="Flat-bottomed enlargement at the opening"),
    OntologyNodeSchema(name="Countersink", parent_id="Hole", description="Conical enlargement at the opening"),
    OntologyNodeSchema(name="Tolerance", parent_id="Hole", description="Allowable variance in dimensions")
]

class EngineeringOntology:
    def __init__(self, nodes: List[OntologyNodeSchema] = None):
        self.nodes = {node.name.lower(): node for node in (nodes or DEFAULT_ONTOLOGY)}

    def get_node(self, name: str) -> Optional[OntologyNodeSchema]:
        return self.nodes.get(name.lower())

    def get_children(self, parent_name: str) -> List[OntologyNodeSchema]:
        parent = self.get_node(parent_name)
        if not parent:
            return []
        return [node for node in self.nodes.values() if node.parent_id and node.parent_id.lower() == parent_name.lower()]
