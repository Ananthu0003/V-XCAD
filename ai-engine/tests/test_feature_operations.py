"""Tests for parametric feature editing operations (edit, delete, move, pattern, push/pull, round face edges)."""
import math
import pytest
import build123d as bd

from app.models.cad_modification import GeometricReference, OperationStatus
from app.services.geometry.feature_service import FeatureService
from app.services.geometry.manual_cad_service import ManualCADService
from tests.test_feature_detection import test_bracket


@pytest.fixture
def manual_service():
    return ManualCADService()


def test_edit_feature_hole_diameter(test_bracket, manual_service):
    """edit_feature Ø6 -> Ø8 changes volume by pi * (16 - 9) * 10 = 219.91 mm³."""
    features = FeatureService.detect_features(test_bracket)
    th = [f for f in features if f.kind == "hole" and f.subtype == "through"]
    assert len(th) >= 1
    target = th[0]

    initial_vol = test_bracket.volume
    new_shape, status, msg, _, _ = manual_service._apply_edit_feature(
        test_bracket, [], {"feature_id": target.feature_id, "changes": {"diameter": 8.0}}
    )
    assert status == OperationStatus.VALID
    assert new_shape is not None

    vol_diff = initial_vol - new_shape.volume
    expected_diff = math.pi * (4.0**2 - 3.0**2) * 10.0
    assert vol_diff == pytest.approx(expected_diff, rel=1e-3)


def test_edit_feature_through_hole_ignores_depth(test_bracket, manual_service):
    """Through hole ignores depth changes."""
    features = FeatureService.detect_features(test_bracket)
    th = [f for f in features if f.kind == "hole" and f.subtype == "through"]
    assert len(th) >= 1
    target = th[0]

    initial_vol = test_bracket.volume
    new_shape, status, msg, _, _ = manual_service._apply_edit_feature(
        test_bracket, [], {"feature_id": target.feature_id, "changes": {"depth": 99.0}}
    )
    assert status == OperationStatus.VALID
    assert new_shape is not None
    # Volume should remain identical because through hole depth is ignored
    assert new_shape.volume == pytest.approx(initial_vol, rel=1e-3)


def test_edit_feature_too_large_diameter_fails(test_bracket, manual_service):
    """Too-large diameter fails with clear safety message."""
    features = FeatureService.detect_features(test_bracket)
    th = [f for f in features if f.kind == "hole" and f.subtype == "through"]
    assert len(th) >= 1
    target = th[0]

    new_shape, status, msg, _, _ = manual_service._apply_edit_feature(
        test_bracket, [], {"feature_id": target.feature_id, "changes": {"diameter": 200.0}}
    )
    assert status != OperationStatus.VALID
    assert "break through the wall" in msg or "Safety" in msg or "max" in msg


def test_delete_feature_boss(test_bracket, manual_service):
    """delete_feature on a boss removes the boss and restores base plate volume."""
    features = FeatureService.detect_features(test_bracket)
    bosses = [f for f in features if f.kind == "boss"]
    assert len(bosses) >= 1
    boss = bosses[0]

    initial_vol = test_bracket.volume
    new_shape, status, msg, _, _ = manual_service._apply_delete_feature(
        test_bracket, [], {"face_ids": boss.face_ids}
    )
    assert status == OperationStatus.VALID
    assert new_shape is not None

    vol_removed = initial_vol - new_shape.volume
    expected_boss_vol = math.pi * 10.0**2 * 8.0
    assert vol_removed == pytest.approx(expected_boss_vol, rel=1e-3)


def test_delete_feature_hole(test_bracket, manual_service):
    """delete_feature on a through hole fills the hole and increases volume."""
    features = FeatureService.detect_features(test_bracket)
    th = [f for f in features if f.kind == "hole" and f.subtype == "through"]
    assert len(th) >= 1
    target = th[0]

    initial_vol = test_bracket.volume
    new_shape, status, msg, _, _ = manual_service._apply_delete_feature(
        test_bracket, [], {"face_ids": target.face_ids}
    )
    assert status == OperationStatus.VALID
    assert new_shape is not None

    vol_added = new_shape.volume - initial_vol
    expected_hole_vol = math.pi * 3.0**2 * 10.0
    assert vol_added == pytest.approx(expected_hole_vol, rel=1e-3)


def test_batch_edit_same_size_holes(test_bracket, manual_service):
    """Batch edit changes all four Ø6 holes to Ø8 in one operation."""
    features = FeatureService.detect_features(test_bracket)
    th = [
        f for f in features
        if f.kind == "hole" and f.subtype == "through" and abs(next(p.value for p in f.params if p.key == "diameter") - 6.0) < 0.1
    ]
    assert len(th) == 4
    fids = [h.feature_id for h in th]

    initial_vol = test_bracket.volume
    new_shape, status, msg, _, _ = manual_service._apply_edit_feature(
        test_bracket, [], {"batch_feature_ids": fids, "changes": {"diameter": 8.0}}
    )
    assert status == OperationStatus.VALID
    assert new_shape is not None

    vol_diff = initial_vol - new_shape.volume
    expected_diff = 4 * math.pi * (4.0**2 - 3.0**2) * 10.0
    assert vol_diff == pytest.approx(expected_diff, rel=1e-3)


def test_push_pull_planar_face(manual_service):
    """push_pull offsets a planar face outward or inward."""
    box = bd.Box(40, 40, 20)
    ref = GeometricReference(ref_id="r_top", entity_type="face", transient_id="face_5", centroid=[0, 0, 10])

    # Outward (+5mm) -> increases volume by 40*40*5 = 8000
    res_out, status, msg, _, _ = manual_service._apply_push_pull(box, [ref], {"distance": 5.0})
    assert status == OperationStatus.VALID
    assert res_out.volume == pytest.approx(box.volume + 40 * 40 * 5, rel=1e-3)

    # Inward (-3mm) -> decreases volume by 40*40*3 = 4800
    res_in, status_in, _, _, _ = manual_service._apply_push_pull(box, [ref], {"distance": -3.0})
    assert status_in == OperationStatus.VALID
    assert res_in.volume == pytest.approx(box.volume - 40 * 40 * 3, rel=1e-3)


def test_round_face_edges(manual_service):
    """round_face_edges applies fillet or chamfer to all edges of a planar face."""
    box = bd.Box(40, 40, 20)
    ref = GeometricReference(ref_id="r_top", entity_type="face", transient_id="face_5", centroid=[0, 0, 10])

    res, status, msg, _, _ = manual_service._apply_round_face_edges(
        box, [ref], {"mode": "fillet", "radius": 2.0}
    )
    assert status == OperationStatus.VALID
    assert res is not None
    assert res.volume < box.volume


def test_move_feature(manual_service):
    """move_feature repositions a hole along its face."""
    box = bd.Box(60, 60, 20) - bd.Cylinder(4.0, 30.0)
    feat = FeatureService.detect_features(box)[0]

    res, status, msg, _, _ = manual_service._apply_move_feature(
        box, [], {"feature_id": feat.feature_id, "dx": 10.0, "dy": 5.0, "dz": 0.0}
    )
    assert status == OperationStatus.VALID
    assert res is not None
    # Re-detect hole should have new center
    new_feat = FeatureService.detect_features(res)[0]
    assert new_feat.center[0] == pytest.approx(feat.center[0] + 10.0, abs=1.0)


def test_pattern_feature(manual_service):
    """pattern_feature duplicates a feature in a linear array."""
    box = bd.Box(100, 40, 20) - bd.Pos(-30, 0, 0) * bd.Cylinder(3.0, 30.0)
    feat = FeatureService.detect_features(box)[0]

    res, status, msg, _, _ = manual_service._apply_pattern_feature(
        box, [], {"feature_id": feat.feature_id, "count": 3, "dx": 25.0, "dy": 0.0, "dz": 0.0}
    )
    assert status == OperationStatus.VALID
    assert res is not None

    # After patterning, there should be 3 holes
    new_feats = FeatureService.detect_features(res)
    holes = [f for f in new_feats if f.kind == "hole"]
    assert len(holes) == 3


def test_delete_feature_by_single_face_reference(test_bracket, manual_service):
    """Deleting a feature by selecting only a single constituent face automatically finds the whole feature."""
    from app.services.geometry.reference_resolver import ReferenceResolver
    features = FeatureService.detect_features(test_bracket)
    th = [f for f in features if f.kind == "hole" and f.subtype == "through"]
    assert len(th) >= 1
    target = th[0]

    # Select only the first face reference
    fid = target.face_ids[0]
    idx = int(fid.replace("face_", ""))
    face = list(test_bracket.faces())[idx]
    face_ref = ReferenceResolver.extract_face_reference(face, fid)

    new_shape, status, msg, _, _ = manual_service._apply_delete_feature(
        test_bracket, [face_ref], {}
    )
    assert status == OperationStatus.VALID
    assert new_shape is not None
    assert new_shape.volume > test_bracket.volume

