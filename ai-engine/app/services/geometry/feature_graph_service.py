import json
from typing import Dict, Any, Optional, List

from app.models.evidence import EngineeringEvidence
from app.models.efg import EngineeringFeatureGraph, EFGNode, FeatureType
from app.models.engineering_parameters import DrawingBlueprintAudit
from app.services.extraction.generic_parameter_parser import BlueprintParameterNormalizer


class FeatureGraphService:
    """
    Transforms EngineeringEvidence or DrawingBlueprintAudit into an EngineeringFeatureGraph (EFG).
    Decoupled from CAD syntax: captures engineering intent, tolerances, GD&T, and manufacturing rules.
    """

    def __init__(self):
        pass

    def build_efg_from_audit(self, audit: DrawingBlueprintAudit) -> EngineeringFeatureGraph:
        """
        Deterministically builds an EngineeringFeatureGraph directly from a structured DrawingBlueprintAudit.
        """
        efg = EngineeringFeatureGraph(
            version=1,
            metadata={
                "units": audit.units,
                "origin_point": audit.origin_point,
                "origin_rationale": audit.origin_rationale,
                "envelope": audit.envelope,
            },
            material=audit.material_parsed,
            stock=audit.stock,
            surface_treatments=audit.surface_treatments_parsed,
            manufacturing_requirements=audit.manufacturing_requirements,
            functional_characteristics=audit.functional_characteristics,
            general_tolerances=audit.general_tolerance_table,
            datums=audit.datums,
            all_dimensions=audit.all_dimensions,
        )

        for feat in audit.features:
            # Map feature type
            f_type_str = feat.type.upper()
            matched_type = FeatureType.TURNING_FEATURE
            for ft in FeatureType:
                if ft.value == f_type_str or f_type_str in ft.value:
                    matched_type = ft
                    break

            # Find matching GD&T callouts for this feature
            node_gdts = [g for g in audit.gdt_callouts_parsed if g.target_feature == feat.id]

            # Find matching surface finish for this feature
            node_finish = feat.surface_finish_parsed
            if not node_finish:
                for sf in audit.surface_finishes:
                    if sf.target_face_or_feature == feat.id:
                        node_finish = sf
                        break

            # Find matching dimensions for this feature
            node_dims = [d for d in audit.all_dimensions if d.feature_id == feat.id]

            node = EFGNode(
                feature_id=feat.id,
                feature_type=matched_type,
                parameters=feat.dims,
                location=feat.location,
                tolerance=feat.dimensional_tolerances,
                source_evidence=[feat.source_view] if feat.source_view else [],
                characteristic_ids=feat.gdt_refs,
                confidence=1.0 if feat.confidence == "verified" else 0.8,
                dependencies=[feat.parent_id] if feat.parent_id else [],
                semantic_dimensions=node_dims,
                tolerances_parsed=feat.tolerances_parsed,
                gdt_callouts=node_gdts,
                surface_finish=node_finish,
                chamfer_details=feat.chamfers,
                fillet_details=feat.fillets,
                angular_details=feat.angles,
                datum_references=feat.datum_refs,
                source_view=feat.source_view,
            )
            efg.add_node(node)

        return efg

    def build_efg_from_feature_map(self, feature_map: Dict[str, Any]) -> EngineeringFeatureGraph:
        """
        Normalizes a raw feature-map dictionary and constructs an EngineeringFeatureGraph.
        """
        audit = BlueprintParameterNormalizer.normalize_audit_payload(feature_map)
        return self.build_efg_from_audit(audit)

    async def generate_efg(self, evidence: EngineeringEvidence, llm_gateway: Any) -> EngineeringFeatureGraph:
        """
        Calls the LLM to propose an EFG based on the evidence.
        """
        efg = EngineeringFeatureGraph(version=1, nodes=[])
        return efg

    def apply_engineering_repair(self, efg: EngineeringFeatureGraph, repair_instructions: Dict[str, Any]) -> EngineeringFeatureGraph:
        """
        Iterates the EFG based on deterministic repair instructions or human override.
        """
        efg.version += 1
        return efg
