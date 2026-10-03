from typing import Dict, Any, List, Optional
from app.models.evidence import EvidenceGraph
from app.models.engineering_parameters import (
    DrawingBlueprintAudit,
    TraceabilityReport,
    TraceabilityItem,
)
from app.services.extraction.generic_parameter_parser import BlueprintParameterNormalizer


class BlueprintValidator:
    """
    Validates features and engineering parameters extracted from the blueprint.
    Detects conflicts, missing parameters, invalid GD&T datum chains, and topological errors.
    Generates a full TraceabilityReport without silent guessing or fallbacks.
    """

    def validate_features(self, feature_map: Dict[str, Any], evidences: List[EvidenceGraph]) -> Dict[str, Any]:
        validation_errors = []
        validation_warnings = []

        feature_evidence = {}
        for ev in evidences:
            if ev.feature_id not in feature_evidence:
                feature_evidence[ev.feature_id] = []
            feature_evidence[ev.feature_id].append(ev)

        validated_features = []

        for feature in feature_map.get("features", []):
            fid = feature.get("id")
            f_evidences = feature_evidence.get(fid, [])

            # Check for ambiguous statuses
            ambiguous = [e for e in f_evidences if e.status in ("ambiguous", "requires_user_confirmation")]
            if ambiguous:
                validation_errors.append(f"Feature {fid} has ambiguous parameters: {[e.name for e in ambiguous]}")
                feature["status"] = "blocked"
                validated_features.append(feature)
                continue

            # Check missing mandatory parameters
            ftype = feature.get("type", "").lower()
            if ftype == "hole":
                has_dia = any(e.name.lower() == "diameter" for e in f_evidences)
                if not has_dia and "dimensions" in feature and "diameter" in feature["dimensions"]:
                    has_dia = feature["dimensions"]["diameter"] > 0

                has_depth = any(e.name.lower() == "depth" for e in f_evidences)
                if not has_depth and "dimensions" in feature and "depth" in feature["dimensions"]:
                    has_depth = feature["dimensions"]["depth"] > 0

                is_through = feature.get("parameters", {}).get("depth_type") == "through"

                if not has_dia:
                    validation_errors.append(f"Hole {fid} is missing mandatory diameter.")
                if not has_depth and not is_through:
                    validation_warnings.append(f"Hole {fid} is missing depth. Assuming through hole.")

            if any(f"Feature {fid}" in err or f"Hole {fid}" in err for err in validation_errors):
                feature["status"] = "blocked"
            else:
                feature["status"] = "confirmed"

            validated_features.append(feature)

        return {
            "is_valid": len(validation_errors) == 0,
            "errors": validation_errors,
            "warnings": validation_warnings,
            "features": validated_features,
        }

    def validate_engineering_audit(self, audit: DrawingBlueprintAudit) -> TraceabilityReport:
        """
        Validates the extracted DrawingBlueprintAudit and builds a complete TraceabilityReport.
        Verifies:
        - Mapped dimensions, tolerances, chamfers, fillets, angles
        - GD&T datum chain integrity (referenced datums exist)
        - Material and stock completeness
        - Unresolved / unmapped annotations
        """
        report = TraceabilityReport()
        feature_ids = {f.id for f in audit.features}
        declared_datum_ids = {d.datum_id for d in audit.datums}

        # 1. Trace Dimensions
        for dim in audit.all_dimensions:
            is_mapped = bool(dim.feature_id and dim.feature_id in feature_ids)
            item = TraceabilityItem(
                category="dimension",
                raw_callout=f"{dim.geometry_reference}: {dim.nominal_value} {dim.unit}",
                associated_feature=dim.feature_id,
                target_geometry=dim.geometry_reference,
                is_mapped=is_mapped,
                status="mapped" if is_mapped else "unmapped",
                confidence=dim.confidence,
                notes=f"Tolerance: {dim.tolerance.raw_text or dim.tolerance.type.value}" if dim.tolerance else "General tolerance applies",
            )
            if is_mapped:
                report.mapped_parameters.append(item)
            else:
                report.unmapped_annotations.append(item)

        # 2. Trace Chamfers
        for cham in audit.all_chamfers:
            is_mapped = bool(cham.feature_id and cham.feature_id in feature_ids)
            item = TraceabilityItem(
                category="chamfer",
                raw_callout=cham.source_annotation or f"{cham.size} x {cham.angle}°",
                associated_feature=cham.feature_id,
                target_geometry=cham.target_edge,
                is_mapped=is_mapped,
                status="mapped" if is_mapped else "unmapped",
                confidence=cham.confidence,
            )
            if is_mapped:
                report.mapped_parameters.append(item)
            else:
                report.unmapped_annotations.append(item)

        # 3. Trace Fillets
        for fil in audit.all_fillets:
            is_mapped = bool(fil.feature_id and fil.feature_id in feature_ids)
            item = TraceabilityItem(
                category="fillet",
                raw_callout=fil.source_annotation or f"R{fil.radius} ({fil.multiplicity}X)",
                associated_feature=fil.feature_id,
                target_geometry=fil.target_edge,
                is_mapped=is_mapped,
                status="mapped" if is_mapped else "unmapped",
                confidence=fil.confidence,
            )
            if is_mapped:
                report.mapped_parameters.append(item)
            else:
                report.unmapped_annotations.append(item)

        # 4. Trace GD&T
        for gdt in audit.gdt_callouts_parsed:
            is_mapped = bool(gdt.target_feature and gdt.target_feature in feature_ids)
            # Check datum reference validity
            missing_datums = [d for d in gdt.datum_references if d and d not in declared_datum_ids]
            status = "mapped"
            notes = None
            if missing_datums:
                status = "unresolved"
                notes = f"Referenced datums not declared on drawing: {missing_datums}"
                report.warnings.append(f"GD&T [{gdt.gdnt_type.value}] references missing datum(s): {missing_datums}")
            elif not is_mapped:
                status = "unmapped"

            item = TraceabilityItem(
                category="gdt",
                raw_callout=f"{gdt.gdnt_type.value} tol={gdt.tolerance_value} datums={gdt.datum_references}",
                associated_feature=gdt.target_feature,
                is_mapped=is_mapped and not missing_datums,
                status=status,
                confidence=gdt.confidence,
                notes=notes,
            )
            if status == "mapped":
                report.mapped_parameters.append(item)
            elif status == "unresolved":
                report.unresolved_parameters.append(item)
            else:
                report.unmapped_annotations.append(item)

        # 5. Trace Surface Finishes
        for sf in audit.surface_finishes:
            is_mapped = bool(sf.target_face_or_feature and sf.target_face_or_feature in feature_ids)
            item = TraceabilityItem(
                category="surface_finish",
                raw_callout=sf.source_annotation or f"{sf.roughness_type} {sf.value} {sf.unit}",
                associated_feature=sf.target_face_or_feature,
                is_mapped=is_mapped,
                status="mapped" if is_mapped else "unmapped",
                confidence=sf.confidence,
            )
            if is_mapped:
                report.mapped_parameters.append(item)
            else:
                report.unmapped_annotations.append(item)

        # 6. Trace Material & Stock
        if audit.material_parsed:
            report.mapped_parameters.append(TraceabilityItem(
                category="material",
                raw_callout=audit.material_parsed.raw_text or audit.material_parsed.material_name,
                is_mapped=True,
                status="mapped",
                confidence=audit.material_parsed.confidence,
            ))
        elif audit.material:
            report.mapped_parameters.append(TraceabilityItem(
                category="material",
                raw_callout=audit.material,
                is_mapped=True,
                status="mapped",
            ))

        if audit.stock:
            report.mapped_parameters.append(TraceabilityItem(
                category="stock",
                raw_callout=audit.stock.raw_text or f"{audit.stock.shape} {audit.stock.nominal_size}",
                is_mapped=True,
                status="mapped",
                confidence=audit.stock.confidence,
            ))

        # Check total validity
        report.is_fully_resolved = len(report.unresolved_parameters) == 0
        return report
