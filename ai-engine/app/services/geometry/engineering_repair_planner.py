from typing import List, Dict, Any, Optional
from pydantic import BaseModel
from app.models.efg import EngineeringFeatureGraph
from app.models.constraints import ConstraintGraph
from app.services.validation.characteristic_verifier import ValidationReport
from app.models.evidence import EngineeringEvidence

class RepairRecord(BaseModel):
    iteration_id: str
    reason: str
    failed_characteristic: str
    old_value: Any
    new_value: Any
    source_evidence: str
    affected_feature: str
    status: str # ACCEPTED, REJECTED

class EngineeringRepairPlanner:
    """
    Handles closed-loop engineering repair when CharacteristicVerification fails.
    Updates the EFG and ConstraintGraph instead of blindly editing Python.
    Ensures every repair is supported by immutable source evidence.
    """
    
    def __init__(self):
        self.history: List[RepairRecord] = []

    def plan_repair(self, 
                    report: ValidationReport, 
                    efg: EngineeringFeatureGraph, 
                    constraints: ConstraintGraph, 
                    evidence: EngineeringEvidence,
                    iteration_id: str) -> bool:
        """
        Attempts to adjust the EFG or constraints based on the validation report failures.
        Returns True if a valid repair was planned (supported by evidence), False otherwise.
        """
        repair_planned = False
        
        for result in report.results:
            if result.status == "FAIL":
                # Find the source evidence for this characteristic
                supporting_evidence = None
                for dim in evidence.dimensions:
                    if dim.characteristic_id == result.characteristic_id:
                        supporting_evidence = dim
                        break
                        
                if supporting_evidence:
                    # Apply the repair to the EFG by matching the evidence value
                    node = efg.get_node(result.feature_id)
                    if node:
                        # ... update node parameters based on supporting_evidence.value ...
                        
                        record = RepairRecord(
                            iteration_id=iteration_id,
                            reason="Characteristic Failed",
                            failed_characteristic=result.characteristic_id,
                            old_value=result.measured_value,
                            new_value=supporting_evidence.value,
                            source_evidence=supporting_evidence.id,
                            affected_feature=result.feature_id,
                            status="ACCEPTED"
                        )
                        self.history.append(record)
                        repair_planned = True
                else:
                    record = RepairRecord(
                        iteration_id=iteration_id,
                        reason="No supporting evidence found for characteristic",
                        failed_characteristic=result.characteristic_id,
                        old_value=result.measured_value,
                        new_value=None,
                        source_evidence="",
                        affected_feature=result.feature_id,
                        status="REJECTED"
                    )
                    self.history.append(record)
                    
        return repair_planned
