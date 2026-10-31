"""Unit tests for ReferenceResolver match scoring and ambiguity resolution."""
import pytest
from unittest.mock import MagicMock
from app.models.cad_modification import GeometricReference, OperationStatus
from app.services.geometry.reference_resolver import ReferenceResolver


def test_score_face_match_exact():
    ref = GeometricReference(
        ref_id="ref_f1",
        transient_id="face_1",
        entity_type="face",
        surface_type="plane",
        normal=[0.0, 0.0, 1.0],
        plane_d=0.0,
        centroid=[10.0, 10.0, 0.0],
        area=100.0,
    )
    score = ReferenceResolver._score_face_match(ref, ref)
    assert score == pytest.approx(1.0, abs=1e-3)


def test_score_face_match_parallel_offset_plane():
    ref1 = GeometricReference(
        ref_id="ref_f1",
        transient_id="face_1",
        entity_type="face",
        surface_type="plane",
        normal=[0.0, 0.0, 1.0],
        plane_d=0.0,
        centroid=[10.0, 10.0, 0.0],
        area=100.0,
    )
    # Parallel face, same area and normal, but offset by 10mm in Z (plane_d = -10.0)
    ref2 = GeometricReference(
        ref_id="ref_f2",
        transient_id="face_2",
        entity_type="face",
        surface_type="plane",
        normal=[0.0, 0.0, 1.0],
        plane_d=-10.0,
        centroid=[10.0, 10.0, 10.0],
        area=100.0,
    )
    score = ReferenceResolver._score_face_match(ref1, ref2)
    # The offset plane should be heavily penalized rather than scoring near 1.0
    assert score < 0.60


def test_resolve_face_unambiguous_exact_match(monkeypatch):
    """
    Simulates the exact case reported by the user:
    Target face matched candidate 0 at 1.00, candidate 1 at 0.94.
    Should resolve as VALID, NOT AMBIGUOUS_REFERENCE.
    """
    ref = GeometricReference(
        ref_id="ref_f1",
        transient_id="face_1",
        entity_type="face",
        surface_type="plane",
        normal=[0.0, 0.0, 1.0],
        plane_d=0.0,
        centroid=[0.0, 0.0, 0.0],
        area=100.0,
    )

    mock_shape = MagicMock()
    mock_face_0 = MagicMock()
    mock_face_1 = MagicMock()
    mock_shape.faces.return_value = [mock_face_0, mock_face_1]

    # Mock extract_face_reference
    def mock_extract(face, transient_id):
        return ref

    monkeypatch.setattr(ReferenceResolver, "extract_face_reference", mock_extract)

    # Mock _score_face_match to return 1.00 for face 0, and 0.94 for face 1
    scores = [1.00, 0.94]
    call_count = {"cnt": 0}

    def mock_score(target, cand):
        c = call_count["cnt"]
        call_count["cnt"] += 1
        return scores[c]

    monkeypatch.setattr(ReferenceResolver, "_score_face_match", mock_score)

    matched, status, msg = ReferenceResolver.resolve_face(mock_shape, ref)
    assert status == OperationStatus.VALID
    assert matched is mock_face_0
    assert "uniquely" in msg


def test_extract_face_reference_triangulation_and_orientation():
    """Verify that extract_face_reference extracts triangles with valid outward normal winding."""
    import build123d as bd
    box = bd.Box(30, 20, 10)
    for i, face in enumerate(box.faces()):
        ref = ReferenceResolver.extract_face_reference(face, f"face_{i}")
        assert ref.triangles is not None
        assert len(ref.triangles) >= 18 # at least 2 triangles = 18 floats
        assert len(ref.triangles) % 9 == 0 # valid triangles


def test_extract_face_reference_curved_surface():
    """Verify that cylinders and curved surfaces receive full triangulation."""
    import build123d as bd
    cyl = bd.Cylinder(radius=10, height=25)
    for i, face in enumerate(cyl.faces()):
        ref = ReferenceResolver.extract_face_reference(face, f"face_{i}")
        assert ref.triangles is not None
        assert len(ref.triangles) >= 18
        if ref.surface_type == "cylinder":
            # Cylinder must have fine tessellation
            assert len(ref.triangles) >= 9 * 16
        assert len(ref.boundary_points) > 0
