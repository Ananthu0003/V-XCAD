"""
Comprehensive Test Suite for Blueprint Parameter Extraction Pipeline.
Verifies dynamic extraction of:
- Tolerances (symmetric, deviational, limits, ISO 286 fits H8/h8/h11, basic)
- Dimensional parameters (diameters, radii, linear, depths, widths, angles)
- Chamfers (size + angle) & Fillets (radius + multiplicity)
- GD&T callouts & Datum references
- Surface finishes (Ra, Rz)
- Title block material & stock specifications
- Surface treatments (thickness, hardness, process)
- Manufacturing requirements & functional characteristics
- General tolerance tables
- Feature Graph (EFG) integration & CAM feature parameter enrichment
- Traceability reporting
- Multi-drawing adaptability (ZERO hardcoding)
"""

import pytest
from typing import Dict, Any

from app.models.engineering_parameters import (
    ToleranceType,
    Tolerance,
    DimensionType,
    GenericDimension,
    GDNTType,
    MaterialCondition,
    DrawingBlueprintAudit,
    TraceabilityReport,
)
from app.services.extraction.generic_parameter_parser import (
    parse_tolerance_string,
    resolve_iso_fit_deviation,
    parse_chamfer_callout,
    parse_fillet_callout,
    parse_angular_callout,
    parse_surface_finish_callout,
    parse_gdnt_callout,
    parse_datum_callout,
    parse_material_callout,
    parse_stock_callout,
    parse_treatment_callout,
    parse_manufacturing_requirement,
    parse_functional_characteristic,
    parse_general_tolerance_table,
    BlueprintParameterNormalizer,
)
from app.services.geometry.feature_graph_service import FeatureGraphService
from app.services.validation.blueprint_validator import BlueprintValidator
from app.services.cam.parametric_feature_extractor import ParametricFeatureExtractor


# ─── 1. TOLERANCE PARSING TESTS ───────────────────────────────────────────────

class TestToleranceParsing:
    def test_symmetric_tolerance(self):
        t1 = parse_tolerance_string("±0.1", nominal=98.6)
        assert t1 is not None
        assert t1.type == ToleranceType.SYMMETRIC
        assert t1.upper == pytest.approx(0.1)
        assert t1.lower == pytest.approx(-0.1)
        min_v, max_v = t1.calculate_bounds()
        assert min_v == pytest.approx(98.5)
        assert max_v == pytest.approx(98.7)

    def test_deviational_tolerance_asymmetric(self):
        t = parse_tolerance_string("+0.2/-0.1", nominal=25.0)
        assert t is not None
        assert t.type == ToleranceType.DEVIATIONAL
        assert t.upper == pytest.approx(0.2)
        assert t.lower == pytest.approx(-0.1)
        min_v, max_v = t.calculate_bounds()
        assert min_v == pytest.approx(24.9)
        assert max_v == pytest.approx(25.2)

    def test_deviational_tolerance_with_zero(self):
        t_pos = parse_tolerance_string("+0.02/0", nominal=13.5)
        assert t_pos is not None
        assert t_pos.upper == pytest.approx(0.02)
        assert t_pos.lower == pytest.approx(0.0)

        t_neg = parse_tolerance_string("0/-0.033", nominal=18.0)
        assert t_neg is not None
        assert t_neg.upper == pytest.approx(0.0)
        assert t_neg.lower == pytest.approx(-0.033)

    def test_deviational_tolerance_both_positive(self):
        t = parse_tolerance_string("+0.2/+0.1", nominal=6.3)
        assert t is not None
        assert t.upper == pytest.approx(0.2)
        assert t.lower == pytest.approx(0.1)
        min_v, max_v = t.calculate_bounds()
        assert min_v == pytest.approx(6.4)
        assert max_v == pytest.approx(6.5)

    def test_iso_fit_hole_h8(self):
        # Hole basis: H8 for Ø23mm (18-30mm step, IT8 = 33µm = 0.033mm)
        t = parse_tolerance_string("H8", nominal=23.0)
        assert t is not None
        assert t.type == ToleranceType.ISO_FIT
        assert t.fit_grade == "H8"
        assert t.upper == pytest.approx(0.033, rel=1e-2)
        assert t.lower == pytest.approx(0.0)
        min_v, max_v = t.calculate_bounds()
        assert min_v == pytest.approx(23.0)
        assert max_v == pytest.approx(23.033, rel=1e-2)

    def test_iso_fit_shaft_h8(self):
        # Shaft basis: h8 for Ø18mm (10-18mm step, IT8 = 27µm = 0.027mm)
        t = parse_tolerance_string("h8", nominal=18.0)
        assert t is not None
        assert t.type == ToleranceType.ISO_FIT
        assert t.fit_grade == "h8"
        assert t.upper == pytest.approx(0.0)
        assert t.lower == pytest.approx(-0.027, rel=1e-2)

    def test_iso_fit_stock_h11(self):
        # Stock: h11 for Ø25mm (18-30mm step, IT11 = 130µm = 0.130mm)
        t = parse_tolerance_string("h11", nominal=25.0)
        assert t is not None
        assert t.type == ToleranceType.ISO_FIT
        assert t.upper == pytest.approx(0.0)
        assert t.lower == pytest.approx(-0.130, rel=1e-2)

    def test_limits_tolerance(self):
        t = parse_tolerance_string("25.5 / 25.3", nominal=25.4)
        assert t is not None
        assert t.type == ToleranceType.LIMITS
        min_v, max_v = t.calculate_bounds()
        assert min_v == pytest.approx(25.3)
        assert max_v == pytest.approx(25.5)

    def test_basic_dimension(self):
        t = parse_tolerance_string("[50.0]", nominal=50.0)
        assert t is not None
        assert t.type == ToleranceType.BASIC


# ─── 2. CHAMFER, FILLET & ANGULAR PARSING TESTS ───────────────────────────────

class TestGeometryParameters:
    def test_chamfer_size_and_angle(self):
        ch1 = parse_chamfer_callout("1.4 × 15°")
        assert ch1 is not None
        assert ch1.size == pytest.approx(1.4)
        assert ch1.angle == pytest.approx(15.0)

        ch2 = parse_chamfer_callout("0.2 x 45 deg")
        assert ch2 is not None
        assert ch2.size == pytest.approx(0.2)
        assert ch2.angle == pytest.approx(45.0)

        ch3 = parse_chamfer_callout("C1.5")
        assert ch3 is not None
        assert ch3.size == pytest.approx(1.5)
        assert ch3.angle == pytest.approx(45.0)

    def test_fillet_radius_and_multiplicity(self):
        f1 = parse_fillet_callout("2X R0.2")
        assert f1 is not None
        assert f1.radius == pytest.approx(0.2)
        assert f1.multiplicity == 2

        f2 = parse_fillet_callout("R0.4")
        assert f2 is not None
        assert f2.radius == pytest.approx(0.4)
        assert f2.multiplicity == 1

        f3 = parse_fillet_callout("4x R1.5")
        assert f3 is not None
        assert f3.radius == pytest.approx(1.5)
        assert f3.multiplicity == 4

    def test_angular_dimensions(self):
        a1 = parse_angular_callout("10°")
        assert a1 is not None
        assert a1.angle_value == pytest.approx(10.0)
        assert a1.unit == "deg"

        a2 = parse_angular_callout("20 deg")
        assert a2 is not None
        assert a2.angle_value == pytest.approx(20.0)

        a3 = parse_angular_callout("45°")
        assert a3 is not None
        assert a3.angle_value == pytest.approx(45.0)


# ─── 3. GD&T, DATUM, SURFACE FINISH & METROLOGY TESTS ─────────────────────────

class TestMetrologyParameters:
    def test_gdnt_circular_runout(self):
        g = parse_gdnt_callout({
            "type": "circular_runout",
            "tolerance": 0.03,
            "diameter_zone": False,
            "material_condition": "RFS",
            "datums": ["A"],
            "target_feature": "body_main",
        })
        assert g is not None
        assert g.gdnt_type == GDNTType.CIRCULAR_RUNOUT
        assert g.tolerance_value == pytest.approx(0.03)
        assert not g.diameter_zone
        assert g.material_condition == MaterialCondition.RFS
        assert g.datum_references == ["A"]
        assert g.target_feature == "body_main"

    def test_gdnt_position_with_mmc(self):
        g = parse_gdnt_callout({
            "type": "position",
            "tolerance": "Ø0.05",
            "material_condition": "MMC",
            "datums": "A, B, C",
            "target_feature": "hole_pattern",
        })
        assert g is not None
        assert g.gdnt_type == GDNTType.POSITION
        assert g.tolerance_value == pytest.approx(0.05)
        assert g.diameter_zone is True
        assert g.material_condition == MaterialCondition.MMC
        assert g.datum_references == ["A", "B", "C"]

    def test_datum_parsing(self):
        d = parse_datum_callout({
            "datum_id": "A",
            "datum_type": "cylinder",
            "referenced_feature": "body_main",
        })
        assert d is not None
        assert d.datum_id == "A"
        assert d.datum_type == "cylinder"
        assert d.referenced_feature == "body_main"

    def test_surface_finish_roughness(self):
        sf1 = parse_surface_finish_callout("Ra 1.6")
        assert sf1 is not None
        assert sf1.roughness_type == "Ra"
        assert sf1.value == pytest.approx(1.6)

        sf2 = parse_surface_finish_callout("Rz 3.2")
        assert sf2 is not None
        assert sf2.roughness_type == "Rz"
        assert sf2.value == pytest.approx(3.2)


# ─── 4. MATERIAL, STOCK, TREATMENTS & NOTES TESTS ─────────────────────────────

class TestMaterialAndManufacturing:
    def test_material_specification(self):
        mat = parse_material_callout("EN-AW 6082 T6")
        assert mat is not None
        assert mat.material_name == "EN-AW 6082 T6"
        assert mat.material_standard == "EN-AW"
        assert mat.grade_or_temper == "T6"

    def test_stock_specification(self):
        stk = parse_stock_callout("Bright Bar Ø25 h11")
        assert stk is not None
        assert stk.shape == "bright_bar"
        assert stk.nominal_diameter == pytest.approx(25.0)
        assert stk.tolerance_class == "h11"
        assert stk.upper_tolerance == pytest.approx(0.0)
        assert stk.lower_tolerance == pytest.approx(-0.130, rel=1e-2)

    def test_surface_treatment(self):
        tr = parse_treatment_callout({
            "treatment_type": "hard_anodizing",
            "thickness_nominal_um": 55.0,
            "thickness_tolerance": "±5 µm",
            "hardness": "HV > 400",
            "target_region": "outer_surfaces",
        })
        assert tr is not None
        assert tr.treatment_type == "hard_anodizing"
        assert tr.thickness_nominal_um == pytest.approx(55.0)
        assert tr.thickness_tolerance == "±5 µm"
        assert tr.hardness == "HV > 400"

    def test_manufacturing_requirement_notes(self):
        req = parse_manufacturing_requirement("Remove all burrs and sharp edges.")
        assert req is not None
        assert req.requirement_type == "deburring"
        assert "burrs" in req.text.lower()

    def test_functional_characteristic(self):
        fc = parse_functional_characteristic("38 GASKET WORKING AREA")
        assert fc is not None
        assert fc.characteristic_type == "gasket_working_area"

    def test_general_tolerance_table(self):
        table_raw = {
            "standard": "ISO 2768",
            "precision_class": "m",
            "rules": [
                {"min": 0.0, "max": 6.0, "tol": 0.1},
                {"min": 6.0, "max": 30.0, "tol": 0.2},
                {"min": 30.0, "max": 120.0, "tol": 0.3},
            ],
        }
        gt = parse_general_tolerance_table(table_raw)
        assert gt is not None
        assert len(gt.rules) == 3
        assert gt.get_tolerance(15.0) == pytest.approx(0.2)
        assert gt.get_tolerance(98.6) == pytest.approx(0.3)


# ─── 5. FULL DRAWING AUDIT & TRACEABILITY REPORT TESTS ─────────────────────────

class TestFullBlueprintAuditAndTraceability:
    @pytest.fixture
    def mock_drawing_payload(self) -> Dict[str, Any]:
        """Mock realistic blueprint audit payload for a precision piston/shaft."""
        return {
            "units": "mm",
            "origin_point": [0.0, 0.0, 0.0],
            "origin_rationale": "Base center datum",
            "material": "EN-AW 6082 T6",
            "stock": "Bright Bar Ø25 h11",
            "surface_treatments": ["Hard Anodizing 55 ± 5 µm HV > 400"],
            "general_tolerances": "ISO 2768-m",
            "gdt_callouts": [
                {
                    "type": "circular_runout",
                    "tolerance": 0.03,
                    "diameter_zone": False,
                    "material_condition": "RFS",
                    "datums": ["A"],
                    "target_feature": "body_main",
                }
            ],
            "datums": [
                {
                    "datum_id": "A",
                    "datum_type": "cylinder",
                    "referenced_feature": "body_main",
                    "source_view": "SECTION A-A",
                }
            ],
            "surface_finishes": [
                {
                    "roughness_type": "Ra",
                    "value": 1.6,
                    "unit": "µm",
                    "target_face_or_feature": "body_main",
                    "source_view": "SECTION A-A",
                },
                {
                    "roughness_type": "Ra",
                    "value": 0.8,
                    "unit": "µm",
                    "target_face_or_feature": "oring_groove_1",
                    "source_view": "DETAIL-D",
                },
            ],
            "manufacturing_requirements": [
                {"requirement_type": "deburring", "text": "Remove all burrs and sharp edges."}
            ],
            "functional_characteristics": [
                {"characteristic_type": "gasket_working_area", "value": 38.0, "unit": "mm", "target": "shaft_outer"}
            ],
            "features": [
                {
                    "id": "body_main",
                    "type": "revolved_profile",
                    "dims": {
                        "total_length": 98.6,
                        "outer_dia_max": 25.5,
                        "shaft_dia": 18.0,
                    },
                    "dimensional_tolerances": {
                        "total_length": "±0.2",
                        "outer_dia_max": "±0.2",
                        "shaft_dia": "h8",
                    },
                    "surface_finish": "Ra 1.6",
                    "source_view": "MAIN",
                },
                {
                    "id": "internal_stepped_bore",
                    "type": "revolved_cutout",
                    "dims": {
                        "bore_dia_1": 23.0,
                        "bore_dia_2": 14.0,
                        "bore_dia_3": 13.5,
                    },
                    "dimensional_tolerances": {
                        "bore_dia_1": "H8",
                        "bore_dia_2": "H8",
                        "bore_dia_3": "+0.02/0",
                    },
                    "source_view": "SECTION A-A",
                },
                {
                    "id": "oring_groove_1",
                    "type": "oring_groove",
                    "dims": {
                        "groove_width": 6.3,
                        "groove_dia": 20.5,
                        "z_position": 18.25,
                        "wall_angle": 15.0,
                    },
                    "dimensional_tolerances": {
                        "groove_width": "+0.2/+0.1",
                        "groove_dia": "±0.1",
                    },
                    "chamfers": [
                        {"size": 1.4, "angle": 15.0, "target_edge": "outer", "source_view": "DETAIL-B"}
                    ],
                    "fillets": [
                        {"radius": 0.2, "multiplicity": 2, "target_edge": "groove", "source_view": "DETAIL-D"}
                    ],
                    "angles": [
                        {"angle_value": 15.0, "angle_kind": "wall_taper", "source_view": "DETAIL-D"}
                    ],
                    "source_view": "DETAIL-D",
                },
            ],
        }

    def test_blueprint_normalization_and_audit(self, mock_drawing_payload):
        audit = BlueprintParameterNormalizer.normalize_audit_payload(mock_drawing_payload)
        assert isinstance(audit, DrawingBlueprintAudit)

        # Verify Material & Stock
        assert audit.material_parsed is not None
        assert audit.material_parsed.material_name == "EN-AW 6082 T6"
        assert audit.stock is not None
        assert audit.stock.nominal_diameter == 25.0

        # Verify Tolerances parsed dynamically
        feat_dict = {f.id: f for f in audit.features}
        body = feat_dict["body_main"]
        assert "shaft_dia" in body.tolerances_parsed
        assert body.tolerances_parsed["shaft_dia"].type == ToleranceType.ISO_FIT
        assert body.tolerances_parsed["total_length"].upper == pytest.approx(0.2)

        bore = feat_dict["internal_stepped_bore"]
        assert bore.tolerances_parsed["bore_dia_1"].fit_grade == "H8"
        assert bore.tolerances_parsed["bore_dia_3"].upper == pytest.approx(0.02)

        groove = feat_dict["oring_groove_1"]
        assert groove.tolerances_parsed["groove_width"].upper == pytest.approx(0.2)
        assert groove.tolerances_parsed["groove_width"].lower == pytest.approx(0.1)

        # Verify Chamfers, Fillets, Angles
        assert len(audit.all_chamfers) >= 1
        assert audit.all_chamfers[0].size == pytest.approx(1.4)
        assert audit.all_chamfers[0].angle == pytest.approx(15.0)

        assert len(audit.all_fillets) >= 1
        assert audit.all_fillets[0].radius == pytest.approx(0.2)
        assert audit.all_fillets[0].multiplicity == 2

        assert len(audit.all_angles) >= 1
        assert audit.all_angles[0].angle_value == pytest.approx(15.0)

    def test_feature_graph_efg_generation(self, mock_drawing_payload):
        fg_service = FeatureGraphService()
        efg = fg_service.build_efg_from_feature_map(mock_drawing_payload)

        assert len(efg.nodes) == 3
        body_node = efg.get_node("body_main")
        assert body_node is not None
        assert len(body_node.gdt_callouts) == 1
        assert body_node.gdt_callouts[0].gdnt_type == GDNTType.CIRCULAR_RUNOUT
        assert "A" in body_node.datum_references

        assert efg.material is not None
        assert efg.material.material_name == "EN-AW 6082 T6"

    def test_traceability_report(self, mock_drawing_payload):
        audit = BlueprintParameterNormalizer.normalize_audit_payload(mock_drawing_payload)
        validator = BlueprintValidator()
        report = validator.validate_engineering_audit(audit)

        assert isinstance(report, TraceabilityReport)
        assert report.is_fully_resolved is True
        assert len(report.mapped_parameters) > 5
        assert len(report.unresolved_parameters) == 0

    def test_cam_feature_extraction_enrichment(self, mock_drawing_payload):
        extractor = ParametricFeatureExtractor()
        params = {
            "total_length": 98.6,
            "outer_dia": 25.5,
            "bore_dia": 23.0,
            "bore_depth": 30.0,
            "groove_dia": 20.5,
            "groove_width": 6.3,
        }
        enriched_features = extractor.extract_with_engineering_parameters(
            parameters=params,
            engineering_audit=mock_drawing_payload,
        )

        assert len(enriched_features) > 0
        for f in enriched_features:
            assert "name" in f
            # Features should have attached material & engineering metadata
            assert f.get("material") == "EN-AW 6082 T6"


# ─── 6. MULTI-DRAWING ADAPTABILITY (ZERO HARDCODING) ──────────────────────────

class TestMultiDrawingAdaptability:
    def test_different_flange_drawing(self):
        """Test on an entirely different drawing with different dimensions, tolerances, materials, and GD&T."""
        flange_payload = {
            "material": "AISI 4140 Hardened",
            "stock": "Round Bar Ø120 H9",
            "general_tolerances": "DIN 7168-m",
            "gdt_callouts": [
                {
                    "type": "perpendicularity",
                    "tolerance": 0.015,
                    "material_condition": "RFS",
                    "datums": ["B"],
                    "target_feature": "flange_face",
                }
            ],
            "datums": [
                {"datum_id": "B", "datum_type": "face", "referenced_feature": "flange_face"}
            ],
            "features": [
                {
                    "id": "flange_face",
                    "type": "base_cylinder",
                    "dims": {"diameter": 115.0, "thickness": 22.0},
                    "dimensional_tolerances": {"diameter": "h9", "thickness": "±0.05"},
                    "surface_finish": "Ra 0.4",
                },
                {
                    "id": "center_bore",
                    "type": "hole_through",
                    "dims": {"diameter": 45.0, "depth": 22.0},
                    "dimensional_tolerances": {"diameter": "H7"},
                    "chamfers": [{"size": 2.0, "angle": 30.0, "target_edge": "inner"}],
                },
            ],
        }

        audit = BlueprintParameterNormalizer.normalize_audit_payload(flange_payload)
        assert audit.material_parsed.material_name == "AISI 4140 Hardened"
        assert audit.stock.nominal_diameter == 120.0
        assert audit.stock.tolerance_class == "H9"

        flange_feat = next(f for f in audit.features if f.id == "flange_face")
        assert flange_feat.tolerances_parsed["thickness"].upper == pytest.approx(0.05)
        assert flange_feat.tolerances_parsed["diameter"].fit_grade == "h9"

        bore_feat = next(f for f in audit.features if f.id == "center_bore")
        assert bore_feat.tolerances_parsed["diameter"].fit_grade == "H7"
        assert bore_feat.chamfers[0].size == pytest.approx(2.0)
        assert bore_feat.chamfers[0].angle == pytest.approx(30.0)

        # Check Traceability
        validator = BlueprintValidator()
        report = validator.validate_engineering_audit(audit)
        assert report.is_fully_resolved is True
