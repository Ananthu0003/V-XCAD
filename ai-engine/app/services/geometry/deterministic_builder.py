from __future__ import annotations

from typing import Any, Dict, Optional
import build123d as b3d

from app.models.hypothesis import GeometryHypothesis
from app.models.evidence import EngineeringEvidence
from app.services.geometry.cad_compiler_service import CADCompilerService


class DeterministicGeometryBuilder:
    """
    Constructs deterministic B-Rep geometry strictly from a GeometryHypothesis,
    EngineeringEvidence, or Blueprint Audit without relying on non-deterministic LLM text surgery.
    Enforces that all geometry is deterministically compiled and executed via build123d.
    """

    def __init__(self):
        self.compiler = CADCompilerService()

    def build_geometry_from_audit(self, audit_dict: Dict[str, Any]) -> b3d.Shape:
        """
        Takes a structured Blueprint Audit dictionary, compiles it deterministically,
        and returns the executed build123d B-Rep Shape.
        """
        script = self.compiler.compile_from_audit(audit_dict)
        return self._execute_script_to_shape(script)

    def build_geometry(self, hypothesis: GeometryHypothesis, evidence: EngineeringEvidence) -> b3d.Shape:
        """
        Takes a GeometryHypothesis and EngineeringEvidence, converts to audit structure,
        and returns a build123d Shape (B-Rep).
        """
        features = []
        for prim in getattr(hypothesis, "primitives", []):
            features.append({
                "id": prim.id if hasattr(prim, "id") else "prim_1",
                "type": prim.primitive_type if hasattr(prim, "primitive_type") else "base_cylinder",
                "dims": prim.parameters if hasattr(prim, "parameters") else {},
                "is_subtractive": False,
            })
        for feat in getattr(hypothesis, "features", []):
            features.append({
                "id": feat.id if hasattr(feat, "id") else "feat_1",
                "type": feat.feature_type if hasattr(feat, "feature_type") else "hole_through",
                "dims": feat.parameters if hasattr(feat, "parameters") else {},
                "is_subtractive": True,
            })

        audit_dict = {"features": features}
        return self.build_geometry_from_audit(audit_dict)

    def _execute_script_to_shape(self, script: str) -> b3d.Shape:
        """
        Safely executes the deterministic build123d script in an isolated namespace
        and extracts the built `part.part` Shape.
        """
        local_scope: Dict[str, Any] = {}
        exec(script, {}, local_scope)

        part_obj = local_scope.get("part")
        if part_obj and hasattr(part_obj, "part"):
            return part_obj.part
        shape_obj = local_scope.get("shape")
        if shape_obj and isinstance(shape_obj, b3d.Shape):
            return shape_obj

        raise RuntimeError("Deterministic script execution did not yield a valid build123d Shape.")
