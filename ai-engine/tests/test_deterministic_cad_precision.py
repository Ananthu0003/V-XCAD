"""
Test Suite for Deterministic CAD Precision & Closed-Loop Blueprint Verification.
Verifies that:
1. CADCompilerService compiles full parts (stepped revolves, multi-bosses, prismatic) to executable build123d.
2. BlueprintAutoCorrector detects missing/deviated parameters and auto-corrects them to 100% precision.
3. DeterministicGeometryBuilder executes and produces valid 3D B-Rep shapes.
"""

import pytest
from app.services.geometry.cad_compiler_service import CADCompilerService
from app.services.geometry.blueprint_auto_corrector import BlueprintAutoCorrector
from app.services.geometry.deterministic_builder import DeterministicGeometryBuilder


class TestDeterministicCADPrecision:
    @pytest.fixture
    def mock_revolved_audit(self):
        return {
            "envelope": {"x_total": 25.5, "y_total": 25.5, "z_total": 98.6},
            "features": [
                {
                    "id": "body_main",
                    "type": "revolved_profile",
                    "dims": {
                        "total_length": 98.6,
                        "outer_dia_max": 25.5,
                        "shaft_dia": 18.0,
                    },
                },
                {
                    "id": "internal_stepped_bore",
                    "type": "revolved_cutout",
                    "dims": {
                        "bore_dia_1": 23.0,
                        "bore_dia_2": 14.0,
                        "bore_dia_3": 13.5,
                        "depth": 98.6,
                    },
                    "is_subtractive": True,
                },
                {
                    "id": "oring_groove_1",
                    "type": "oring_groove",
                    "dims": {
                        "groove_width": 6.3,
                        "groove_dia": 20.5,
                        "z_position": 18.25,
                    },
                },
                {
                    "id": "entry_chamfer",
                    "type": "edge_treatment",
                    "dims": {
                        "treatment_type": "chamfer",
                        "size": 1.4,
                        "angle": 15.0,
                    },
                },
                {
                    "id": "blend_fillet",
                    "type": "edge_treatment",
                    "dims": {
                        "treatment_type": "fillet",
                        "radius": 0.2,
                    },
                },
            ],
        }

    @pytest.fixture
    def mock_multi_boss_audit(self):
        return {
            "envelope": {"x_total": 40.0, "y_total": 100.0, "z_total": 20.0},
            "features": [
                {
                    "id": "boss_1",
                    "type": "boss_eyelet",
                    "dims": {"diameter": 32.0, "thickness": 16.0},
                },
                {
                    "id": "boss_2",
                    "type": "boss_eyelet",
                    "dims": {
                        "diameter": 22.0,
                        "thickness": 12.0,
                        "center_distance": 75.0,
                        "neck_step_offset": 5.0,
                    },
                },
                {
                    "id": "connecting_arm",
                    "type": "connecting_arm",
                    "dims": {"width": 18.0, "thickness": 10.0},
                },
            ],
        }

    def test_cad_compiler_revolved_assembly(self, mock_revolved_audit):
        compiler = CADCompilerService()
        script = compiler.compile_from_audit(mock_revolved_audit)

        assert "import build123d as bd" in script
        assert "PARAMETERS = {" in script
        assert "total_length" in script
        assert "outer_dia_max" in script
        assert "oring_groove_1" in script
        assert "with bd.BuildPart() as part:" in script
        assert "part.part.locate" in script

    def test_cad_compiler_multi_boss_assembly(self, mock_multi_boss_audit):
        compiler = CADCompilerService()
        script = compiler.compile_from_audit(mock_multi_boss_audit)

        assert "boss1_dia" in script
        assert "boss2_dia" in script
        assert "center_to_center_dist" in script
        assert "bd.make_hull()" in script

    def test_blueprint_auto_corrector_fixes_drift_and_missing_features(self, mock_revolved_audit):
        # Flawed LLM script missing chamfer, fillet, with drifted diameter (25.0 instead of 25.5)
        flawed_script = """import build123d as bd

PARAMETERS = {
    "eps": 0.01,
    "total_length": 98.6,
    "outer_dia_max": 25.0
}

PARAMETER_METADATA = {
    "total_length": {"group": "Main", "confidence": 0.8, "description": "Length"},
    "outer_dia_max": {"group": "Main", "confidence": 0.8, "description": "Dia"}
}

eps = PARAMETERS["eps"]
total_length = PARAMETERS["total_length"]
outer_dia_max = PARAMETERS["outer_dia_max"]

with bd.BuildPart() as part:
    bd.Cylinder(radius=outer_dia_max/2.0, height=total_length, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN))

part.part = part.part.locate(bd.Location((0, 0, -part.part.bounding_box().max.Z)))
"""
        report = BlueprintAutoCorrector.verify_and_correct(flawed_script, mock_revolved_audit)

        assert report.is_100_percent is True
        assert len(report.corrections) >= 3
        # Check that outer_dia_max was corrected from 25.0 to 25.5
        assert report.parameters["outer_dia_max"] == 25.5
        # Check that chamfer and fillet were injected
        assert "entry_chamfer" in report.verified_script or "chamfer" in report.verified_script
        assert "blend_fillet" in report.verified_script or "fillet" in report.verified_script

    def test_deterministic_geometry_builder_execution(self, mock_revolved_audit):
        builder = DeterministicGeometryBuilder()
        shape = builder.build_geometry_from_audit(mock_revolved_audit)
        assert shape is not None
        assert shape.is_valid
        bb = shape.bounding_box()
        # Verify Z envelope matches total length within tolerance
        assert pytest.approx(bb.max.Z - bb.min.Z, rel=1e-2) == 98.6
