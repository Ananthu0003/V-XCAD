"""Tests for B-Rep feature detection and parameter extraction."""
import pytest
import build123d as bd
from app.services.geometry.feature_service import FeatureService
from app.services.geometry.manual_cad_service import ManualCADService


@pytest.fixture
def test_bracket():
    """
    Standard test bracket:
    80x80x10 plate,
    four Ø6 through holes,
    one Ø8x5 blind hole on the side face (X-axis),
    one counterbore hole (Ø6 through, Ø12 cbore depth 4),
    one Ø20x8 boss on top,
    one 30x20x4 rectangular pocket,
    one obround slot (20x8x3),
    R3 fillets on 4 vertical edges,
    1mm chamfers on top edges.
    """
    plate = bd.Box(80, 80, 10)
    # Fillet vertical edges
    vert_edges = plate.edges().filter_by(bd.Axis.Z)
    plate = bd.fillet(vert_edges, 3.0)

    # Chamfer top outer edges
    top_edges = plate.edges().filter_by(bd.Axis.Z, reverse=True).filter_by_position(bd.Axis.Z, 5, 5)
    plate = bd.chamfer(top_edges, 1.0)

    # 4 through holes Ø6
    for x in [-25, 25]:
        for y in [-25, 25]:
            plate -= bd.Pos(x, y, 0) * bd.Cylinder(3.0, 15.0)

    # 1 blind hole on side face (drilled in -X direction at X=40, depth=5.0, diameter=8.0)
    plate -= bd.Pos(40, 0, 0) * bd.Rot(0, 90, 0) * bd.Cylinder(4.0, 10.0)

    # 1 counterbore hole: through Ø6 with Ø12 cbore depth 4 on top face
    cb = bd.Pos(0, 20, 0) * bd.Cylinder(3.0, 15.0) + bd.Pos(0, 20, 3) * bd.Cylinder(6.0, 4.01)
    plate -= cb

    # 1 Ø20x8 boss on top (top face at Z=5, center at Z=9 for 8mm height)
    plate += bd.Pos(0, -20, 9) * bd.Cylinder(10.0, 8.0)

    # 1 30x20x4 rectangular pocket
    plate -= bd.Pos(-15, 0, 3) * bd.Box(30.0, 20.0, 4.01)

    # 1 slot (obround 20x8x3)
    slot = bd.Pos(20, 0, 3.5) * (bd.Box(12.0, 8.0, 3.01) + bd.Pos(-6, 0, 0) * bd.Cylinder(4.0, 3.01) + bd.Pos(6, 0, 0) * bd.Cylinder(4.0, 3.01))
    plate -= slot

    return plate


def test_feature_detection_counts_and_parameters(test_bracket):
    features = FeatureService.detect_features(test_bracket)
    assert len(features) > 0

    kinds = [f.kind for f in features]
    assert "hole" in kinds
    assert "boss" in kinds
    assert "pocket" in kinds
    assert "slot" in kinds
    assert "fillet" in kinds
    assert "chamfer" in kinds

    # Test through holes
    through_holes = [f for f in features if f.kind == "hole" and f.subtype == "through"]
    assert len(through_holes) >= 4
    for h in through_holes:
        dia_param = next(p for p in h.params if p.key == "diameter")
        assert dia_param.value == pytest.approx(6.0, abs=1e-2)
        # Through hole should not have depth parameter
        assert not any(p.key == "depth" for p in h.params)

    # Test counterbore hole
    cb_holes = [f for f in features if f.kind == "hole" and f.subtype == "counterbore"]
    assert len(cb_holes) >= 1
    cb = cb_holes[0]
    dia_param = next(p for p in cb.params if p.key == "diameter")
    assert dia_param.value == pytest.approx(6.0, abs=1e-2)
    cb_dia_param = next(p for p in cb.params if p.key == "cbore_diameter")
    assert cb_dia_param.value == pytest.approx(12.0, abs=1e-2)

    # Test boss
    bosses = [f for f in features if f.kind == "boss"]
    assert len(bosses) >= 1
    boss = bosses[0]
    dia_param = next(p for p in boss.params if p.key == "diameter")
    assert dia_param.value == pytest.approx(20.0, abs=1e-2)
    height_param = next(p for p in boss.params if p.key == "height")
    assert height_param.value == pytest.approx(8.0, abs=1e-2)

    # Test pocket
    pockets = [f for f in features if f.kind == "pocket"]
    assert len(pockets) >= 1
    p = pockets[0]
    assert p.subtype == "rect"

    # Test slot
    slots = [f for f in features if f.kind == "slot"]
    assert len(slots) >= 1

    # Verify face_ids format and consistency
    for f in features:
        assert len(f.face_ids) > 0
        for fid in f.face_ids:
            assert fid.startswith("face_")


def test_hole_axis_x_depth_regression(test_bracket):
    """Verify that a hole oriented along the X-axis reports the correct depth, not Z bbox."""
    features = FeatureService.detect_features(test_bracket)
    # The side hole has diameter Ø8 and axis along X
    side_holes = [
        f for f in features
        if f.kind == "hole" and f.axis and abs(f.axis[0]) > 0.9
    ]
    assert len(side_holes) >= 1
    side_hole = side_holes[0]
    dia_param = next(p for p in side_hole.params if p.key == "diameter")
    assert dia_param.value == pytest.approx(8.0, abs=1e-2)
    depth_param = next(p for p in side_hole.params if p.key == "depth")
    # Blind hole depth is 5mm into the side face
    assert depth_param.value == pytest.approx(5.0, abs=0.5)
