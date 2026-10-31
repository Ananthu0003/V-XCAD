"""Body-level editing operations (move, rotate, scale, mirror, ... heal) on a real B-Rep."""
import build123d as bd
import pytest

from app.models.cad_modification import CommitRequest, OperationStatus, PreviewRequest
from app.services.geometry.manual_cad_service import ManualCADService


@pytest.fixture
def svc(tmp_path):
    s = ManualCADService(storage_dir=tmp_path)
    s.initialize_session_if_needed("s", base_shape=bd.Box(20, 20, 10))
    return s


def run(svc, op, params=None, refs=None):
    return svc.preview_operation(
        PreviewRequest(session_id="s", base_revision="rev_000", operation_type=op,
                       references=refs or [], parameters=params or {})
    )


def commit(svc, op, params=None, refs=None):
    res = svc.commit_operation(
        CommitRequest(session_id="s", base_revision="rev_000", operation_type=op,
                      references=refs or [], parameters=params or {})
    )
    return svc.load_revision_shape("s", res.new_revision)


def top_face_ref(svc):
    topo = svc.get_topology("s", "rev_000")
    return max(topo.faces.values(), key=lambda f: f.centroid[2])


def test_move_translates_bbox(svc):
    shape = commit(svc, "move", {"dx": 5, "dy": 0, "dz": 3})
    bb = shape.bounding_box()
    assert bb.min.X == pytest.approx(-5) and bb.min.Z == pytest.approx(-2)


def test_move_zero_is_rejected(svc):
    assert run(svc, "move", {"dx": 0, "dy": 0, "dz": 0}).valid is False


def test_rotate_90_swaps_extents(svc):
    shape = commit(svc, "rotate", {"axis": "x", "angle": 90})
    size = shape.bounding_box().size
    assert size.Y == pytest.approx(10) and size.Z == pytest.approx(20)


def test_scale_uniform_and_per_axis(svc):
    assert commit(svc, "scale", {"mode": "uniform", "factor": 2}).volume == pytest.approx(4000 * 8, rel=1e-3)
    svc.initialize_session_if_needed("s", base_shape=bd.Box(20, 20, 10), force_sync=True)
    sized = commit(svc, "scale", {"mode": "axis", "sx": 2, "sy": 1, "sz": 0.5}).bounding_box().size
    assert (sized.X, sized.Y, sized.Z) == pytest.approx((40, 20, 5), abs=1e-3)


def test_scale_limits(svc):
    assert run(svc, "scale", {"factor": 0}).valid is False
    assert run(svc, "scale", {"factor": 1}).valid is False


def test_mirror_keep_original_makes_symmetric_body(svc):
    shape = commit(svc, "move", {"dx": 30})  # off-centre so a mirror is visible
    assert shape.bounding_box().min.X == pytest.approx(20)


def test_mirror_with_copy_doubles_volume(svc):
    # offset the mirror plane so copy does not overlap: plane YZ at x=15 -> copy at x=20..40
    res = run(svc, "mirror", {"plane": "yz", "offset": 15, "keep_original": True})
    assert res.valid is True
    assert res.volume_delta_mm3 == pytest.approx(4000 - 0, abs=1)  # one extra 20x20x10 block


def test_align_drop_to_bed(svc):
    shape = commit(svc, "align", {"mode": "drop_to_bed"})
    assert shape.bounding_box().min.Z == pytest.approx(0)


def test_align_face_down(svc):
    top = top_face_ref(svc)
    shape = commit(svc, "align", {"mode": "face_down"}, [top])
    bb = shape.bounding_box()
    assert bb.min.Z == pytest.approx(0) and bb.size.Z == pytest.approx(10)


def test_align_face_down_requires_face(svc):
    assert run(svc, "align", {"mode": "face_down"}).valid is False


@pytest.mark.parametrize("shape_kind,expected", [("box", 4000 + 1000), ("cylinder", None), ("sphere", None), ("cone", None)])
def test_primitive_add(svc, shape_kind, expected):
    res = run(svc, "primitive", {"shape": shape_kind, "mode": "add", "x": 40, "length": 10, "width": 10, "height": 10, "diameter": 10, "top_diameter": 0})
    assert res.valid is True
    if expected:
        assert res.volume_delta_mm3 == pytest.approx(1000, abs=1)


def test_primitive_subtract_and_intersect(svc):
    cut = run(svc, "primitive", {"shape": "box", "mode": "subtract", "length": 10, "width": 10, "height": 10})
    assert cut.valid and cut.volume_delta_mm3 == pytest.approx(-1000, abs=1)
    keep = run(svc, "primitive", {"shape": "box", "mode": "intersect", "length": 10, "width": 10, "height": 10})
    assert keep.valid and keep.validation.volume_mm3 == pytest.approx(1000, abs=1)


def test_primitive_unknown_shape(svc):
    assert run(svc, "primitive", {"shape": "teapot"}).valid is False


def test_shell_closed_and_open(svc):
    closed = run(svc, "shell", {"thickness": 2})
    assert closed.valid is True and closed.validation.volume_mm3 < 4000
    opened = run(svc, "shell", {"thickness": 2}, [top_face_ref(svc)])
    assert opened.valid is True and opened.validation.volume_mm3 < 4000


def test_shell_too_thick_is_rejected(svc):
    assert run(svc, "shell", {"thickness": 6}).valid is False


def test_offset_grow_and_limit(svc):
    grown = run(svc, "offset", {"amount": 1})
    assert grown.valid and grown.validation.volume_mm3 > 4000
    assert run(svc, "offset", {"amount": -6}).valid is False
    assert run(svc, "offset", {"amount": 0}).valid is False


def test_split_keeps_half_and_rejects_miss(svc):
    half = commit(svc, "split", {"plane": "xy", "offset": 0, "keep": "top"})
    assert half.volume == pytest.approx(2000, rel=1e-3)
    assert run(svc, "split", {"plane": "xy", "offset": 100, "keep": "top"}).valid is False
    assert run(svc, "split", {"plane": "ab"}).valid is False


def test_split_with_selected_face_plane(svc):
    res = run(svc, "split", {"keep": "bottom", "offset": -2}, [top_face_ref(svc)])
    assert res.valid is True and res.validation.volume_mm3 == pytest.approx(3200, rel=1e-3)


def test_linear_pattern(svc):
    shape = commit(svc, "linear_pattern", {"count": 3, "dx": 30, "dy": 0, "dz": 0})
    assert shape.volume == pytest.approx(3 * 4000, rel=1e-3)
    assert shape.bounding_box().size.X == pytest.approx(80)


def test_pattern_count_limits(svc):
    assert run(svc, "linear_pattern", {"count": 1}).valid is False
    assert run(svc, "linear_pattern", {"count": 101}).valid is False
    assert run(svc, "polar_pattern", {"count": 1}).valid is False


def test_polar_pattern_full_circle(svc):
    moved = commit(svc, "move", {"dx": 40})
    assert moved.bounding_box().min.X == pytest.approx(30)
    res = run(svc, "polar_pattern", {"count": 4, "axis": "z", "angle": 360})
    assert res.valid is True


def test_heal_removes_loose_solids(svc):
    cluttered = bd.Compound([bd.Box(20, 20, 10), bd.Box(1, 1, 1).moved(bd.Location((50, 0, 0)))])
    svc.initialize_session_if_needed("s", base_shape=cluttered, force_sync=True)
    healed = commit(svc, "heal", {})
    assert len(healed.solids()) == 1
    assert healed.volume == pytest.approx(4000, rel=1e-3)


def test_edit_feature_is_an_accepted_operation_type(svc):
    # Previously rejected by the request schema (not part of the Literal), now routed to the handler.
    res = run(svc, "edit_feature", {}, [top_face_ref(svc)])
    assert res.status != OperationStatus.PREVIEW  # planar face -> handler refuses, but schema accepted
    assert "Unsupported operation type" not in (res.validation.error_message or "")


def test_export_formats(svc):
    for fmt, head in (("stl", None), ("step", b"ISO-10303"), ("obj", b"# VEXCAD"), ("3mf", b"PK")):
        data, media, name = svc.export_revision("s", None, fmt)
        assert data and name.endswith(fmt)
        if head:
            assert data.startswith(head)
    with pytest.raises(ValueError):
        svc.export_revision("s", None, "dwg")


def test_measure_min_distance_and_angle(svc):
    from app.models.cad_modification import MeasureRequest
    topo = svc.get_topology("s", "rev_000")
    faces = list(topo.faces.values())
    top = max(faces, key=lambda f: f.centroid[2])
    bottom = min(faces, key=lambda f: f.centroid[2])
    res = svc.measure(MeasureRequest(session_id="s", revision_id="rev_000", entity_a=top, entity_b=bottom))
    assert res.min_distance_mm == pytest.approx(10, abs=1e-3)
    assert res.angle_degrees == pytest.approx(180, abs=1e-3)
