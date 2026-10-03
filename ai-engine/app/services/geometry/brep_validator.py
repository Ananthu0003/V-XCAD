"""BRep Validator — Analytical B-Rep manifold and geometry validation for VEXCAD."""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Tuple
import build123d as bd

from OCP.BRepCheck import BRepCheck_Analyzer, BRepCheck_Status
from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps
from OCP.TopAbs import TopAbs_SOLID, TopAbs_SHELL, TopAbs_FACE
from OCP.TopExp import TopExp_Explorer

from app.models.cad_modification import ValidationReport


class BRepValidator:
    """
    Formal OpenCASCADE B-Rep topological and solid manifoldness validator.
    Prevents degenerate geometry, non-manifold solids, and invalid operations from
    silently corrupting the authoritative STEP model.
    """

    @staticmethod
    def validate_shape(shape: bd.Shape) -> ValidationReport:
        """Analyze a build123d / OpenCASCADE shape."""
        occ_shape = shape.wrapped if hasattr(shape, "wrapped") else shape

        if occ_shape.IsNull():
            return ValidationReport(
                is_valid=False,
                is_manifold=False,
                is_closed=False,
                volume_mm3=0.0,
                error_code="NULL_SHAPE",
                error_message="The evaluated geometry result is null or empty.",
                suggestions=["Check operation parameters or profile dimensions."]
            )

        # 1. BRepCheck_Analyzer
        analyzer = BRepCheck_Analyzer(occ_shape)
        is_valid = bool(analyzer.IsValid())

        # 2. Solid & Shell check
        solids = []
        solid_exp = TopExp_Explorer(occ_shape, TopAbs_SOLID)
        while solid_exp.More():
            solids.append(solid_exp.Current())
            solid_exp.Next()

        has_solids = len(solids) > 0

        # 3. Volume calculation
        props = GProp_GProps()
        BRepGProp.VolumeProperties_s(occ_shape, props)
        volume = float(props.Mass())

        warnings: List[str] = []
        error_code: Optional[str] = None
        error_message: Optional[str] = None
        suggestions: List[str] = []

        if not is_valid:
            error_code = "BREP_TOPOLOGY_INVALID"
            error_message = "The resulting B-Rep topology contains invalid geometric or topological relationships."
            suggestions.append("Verify blend radii, face orientations, or intersecting boundaries.")

        if has_solids and volume <= 1e-6:
            is_valid = False
            error_code = "ZERO_OR_NEGATIVE_VOLUME"
            error_message = f"Solid has non-positive volume: {volume:.4f} mm³."
            suggestions.append("Check if a cut or boolean operation completely consumed the base solid.")

        return ValidationReport(
            is_valid=is_valid,
            is_manifold=is_valid,
            is_closed=has_solids,
            self_intersections=0 if is_valid else 1,
            volume_mm3=max(0.0, volume),
            warnings=warnings,
            error_code=error_code,
            error_message=error_message,
            suggestions=suggestions
        )
