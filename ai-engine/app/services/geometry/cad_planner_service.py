from typing import List, Dict, Any
from pydantic import BaseModel
from app.models.efg import EngineeringFeatureGraph
from app.models.constraints import ConstraintGraph

class CADOperation(BaseModel):
    operation_id: str
    feature_id: str
    operation_type: str
    parameters: Dict[str, Any]
    dependencies: List[str]

class CADFeaturePlan(BaseModel):
    operations: List[CADOperation]

class CADPlannerService:
    """
    Transforms the EngineeringFeatureGraph and ConstraintGraph into a deterministic 
    ordered sequence of CAD operations.
    """
    
    def __init__(self):
        pass
        
    def generate_plan(self, efg: EngineeringFeatureGraph, constraints: ConstraintGraph) -> CADFeaturePlan:
        """
        Creates an execution plan for the CAD compiler.
        """
        operations = []
        
        # A simple topological sort based on dependencies would go here.
        # For now, we will just iterate the EFG nodes and create 1:1 operations.
        # Base features first.
        
        base_nodes = [n for n in efg.nodes if n.feature_type == "BASE_FEATURE"]
        other_nodes = [n for n in efg.nodes if n.feature_type != "BASE_FEATURE" and n.feature_type != "COORDINATE_SYSTEM"]
        
        op_idx = 1
        for node in base_nodes + other_nodes:
            operations.append(CADOperation(
                operation_id=f"OP_{op_idx:03d}",
                feature_id=node.feature_id,
                operation_type=node.feature_type.value,
                parameters=node.parameters,
                dependencies=node.dependencies
            ))
            op_idx += 1
            
        return CADFeaturePlan(operations=operations)
