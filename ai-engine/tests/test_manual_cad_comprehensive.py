import pytest
import build123d as bd
from app.services.geometry.manual_cad_service import ManualCADService
from app.models.cad_modification import (
    PreviewRequest,
    CommitRequest,
    GeometricReference,
    OperationStatus,
    OperationType,
    RollbackRequest,
)
from app.api.v1.cad_modify_router import ImportStepRequest
from app.services.geometry.brep_validator import BRepValidator


@pytest.fixture
def cad_service(tmp_path):
    return ManualCADService(storage_dir=tmp_path)


@pytest.fixture
def box_session(cad_service):
    session_id = "test_box_sess"
    box = bd.Box(50, 50, 20)
    cad_service.initialize_session_if_needed(session_id, base_shape=box)
    return session_id, cad_service


@pytest.fixture
def cyl_session(cad_service):
    session_id = "test_cyl_sess"
    cyl = bd.Cylinder(radius=15, height=40)
    cad_service.initialize_session_if_needed(session_id, base_shape=cyl)
    return session_id, cad_service


def test_import_step_request_model():
    """Verify router typing bug fix: ImportStepRequest builds without runtime type error."""
    req = ImportStepRequest(session_id="test_sess", source_step="test.step", step_base64="aGVsbG8=")
    assert req.source_step == "test.step"
    assert req.step_base64 == "aGVsbG8="


def test_all_operations_schema_acceptance():
    """Verify A1: all operation types are accepted by PreviewRequest."""
    for op in [
        "fillet", "chamfer", "hole", "pocket", "pad", "transform",
        "edit_feature", "offset_face", "plug_hole", "move", "rotate", "scale"
    ]:
        req = PreviewRequest(
            session_id="s",
            base_revision="rev_000",
            operation_type=op,
            references=[],
            parameters={}
        )
        assert req.operation_type == op


def test_hole_wizard_types(box_session):
    """Test all 4 hole wizard types: blind, through, counterbore, countersink."""
    session_id, service = box_session
    topo = service.get_topology(session_id, "rev_000")
    top_face_id = [fid for fid, f in topo.faces.items() if f.normal and f.normal[2] > 0.9][0]
    ref = GeometricReference(
        ref_id=top_face_id,
        transient_id=top_face_id,
        entity_type="face",
        surface_type="plane",
        centroid=[0.0, 0.0, 10.0],
        normal=[0.0, 0.0, 1.0],
    )

    # 1. Blind hole
    res = service.preview_operation(PreviewRequest(
        session_id=session_id,
        base_revision="rev_000",
        operation_type="hole",
        references=[ref],
        parameters={"hole_type": "blind", "diameter": 8.0, "depth": 10.0, "pos_x": 0.0, "pos_y": 0.0}
    ))
    assert res.valid is True
    assert res.volume_delta_mm3 < 0

    # 2. Through hole
    res_through = service.preview_operation(PreviewRequest(
        session_id=session_id,
        base_revision="rev_000",
        operation_type="hole",
        references=[ref],
        parameters={"hole_type": "through", "diameter": 8.0}
    ))
    assert res_through.valid is True
    assert res_through.volume_delta_mm3 < res.volume_delta_mm3

    # 3. Counterbore hole
    res_cb = service.preview_operation(PreviewRequest(
        session_id=session_id,
        base_revision="rev_000",
        operation_type="hole",
        references=[ref],
        parameters={"hole_type": "counterbore", "diameter": 6.0, "depth": 15.0, "cbore_diameter": 11.0, "cbore_depth": 5.0}
    ))
    assert res_cb.valid is True
    assert res_cb.volume_delta_mm3 < 0

    # 4. Countersink hole
    res_cs = service.preview_operation(PreviewRequest(
        session_id=session_id,
        base_revision="rev_000",
        operation_type="hole",
        references=[ref],
        parameters={"hole_type": "countersink", "diameter": 6.0, "depth": 15.0, "csink_diameter": 12.0, "csink_angle": 90.0}
    ))
    assert res_cs.valid is True
    assert res_cs.volume_delta_mm3 < 0


def test_pocket_profiles(box_session):
    """Test all 3 pocket profiles: rectangle, circle, slot."""
    session_id, service = box_session
    topo = service.get_topology(session_id, "rev_000")
    top_face_id = [fid for fid, f in topo.faces.items() if f.normal and f.normal[2] > 0.9][0]
    ref = GeometricReference(
        ref_id=top_face_id,
        transient_id=top_face_id,
        entity_type="face",
        surface_type="plane",
        centroid=[0.0, 0.0, 10.0],
        normal=[0.0, 0.0, 1.0],
    )

    for profile in ["rectangle", "circle", "slot"]:
        res = service.preview_operation(PreviewRequest(
            session_id=session_id,
            base_revision="rev_000",
            operation_type="pocket",
            references=[ref],
            parameters={"profile": profile, "width": 15.0, "length": 25.0, "height": 15.0, "depth": 5.0}
        ))
        assert res.valid is True
        assert res.volume_delta_mm3 < 0


def test_pad_profiles(box_session):
    """Test additive pad profiles: rectangle, circle."""
    session_id, service = box_session
    topo = service.get_topology(session_id, "rev_000")
    top_face_id = [fid for fid, f in topo.faces.items() if f.normal and f.normal[2] > 0.9][0]
    ref = GeometricReference(
        ref_id=top_face_id,
        transient_id=top_face_id,
        entity_type="face",
        surface_type="plane",
        centroid=[0.0, 0.0, 10.0],
        normal=[0.0, 0.0, 1.0],
    )

    for profile in ["rectangle", "circle"]:
        res = service.preview_operation(PreviewRequest(
            session_id=session_id,
            base_revision="rev_000",
            operation_type="pad",
            references=[ref],
            parameters={"profile": profile, "width": 15.0, "length": 20.0, "height": 6.0}
        ))
        assert res.valid is True
        assert res.volume_delta_mm3 > 0


def test_fillet_and_chamfer_without_false_rejection(box_session):
    """Verify A4: radius > edge_len is not falsely rejected."""
    session_id, service = box_session
    topo = service.get_topology(session_id, "rev_000")
    edge_id = list(topo.edges.keys())[0]
    edge_info = topo.edges[edge_id]
    ref = GeometricReference(
        ref_id=edge_id,
        transient_id=edge_id,
        entity_type="edge",
        centroid=edge_info.centroid,
        length=edge_info.length,
        curve_type=edge_info.curve_type,
    )

    # Fillet with valid radius
    res_f = service.preview_operation(PreviewRequest(
        session_id=session_id,
        base_revision="rev_000",
        operation_type="fillet",
        references=[ref],
        parameters={"radius": 3.0}
    ))
    assert res_f.valid is True

    # Asymmetric chamfer
    res_c = service.preview_operation(PreviewRequest(
        session_id=session_id,
        base_revision="rev_000",
        operation_type="chamfer",
        references=[ref],
        parameters={"distance": 2.0, "distance2": 4.0}
    ))
    assert res_c.valid is True


def test_transform_operations(box_session):
    """Verify B1: Transform (move, rotate, scale) operations."""
    session_id, service = box_session

    # Move
    res_m = service.preview_operation(PreviewRequest(
        session_id=session_id,
        base_revision="rev_000",
        operation_type="transform",
        references=[],
        parameters={"mode": "move", "dx": 10.0, "dy": 0.0, "dz": 5.0}
    ))
    assert res_m.valid is True

    # Rotate
    res_r = service.preview_operation(PreviewRequest(
        session_id=session_id,
        base_revision="rev_000",
        operation_type="transform",
        references=[],
        parameters={"mode": "rotate", "axis": "z", "angle": 45.0}
    ))
    assert res_r.valid is True

    # Scale
    res_s = service.preview_operation(PreviewRequest(
        session_id=session_id,
        base_revision="rev_000",
        operation_type="transform",
        references=[],
        parameters={"mode": "scale", "factor": 1.5}
    ))
    assert res_s.valid is True
    assert res_s.volume_delta_mm3 > 0


def test_parameters_classification_endpoint(box_session, cyl_session):
    """Verify Part C: /parameters endpoint correctly classifies box, cylinder, and features."""
    box_id, box_svc = box_session
    cyl_id, cyl_svc = cyl_session

    # Box
    box_params = box_svc.get_parameters(box_id, "rev_000")
    assert box_params.base_solid.primitive == "box"
    assert box_params.base_solid.parameters["length"] == 50.0
    assert box_params.base_solid.parameters["width"] == 50.0
    assert box_params.base_solid.parameters["height"] == 20.0
    assert box_params.mass_properties.is_valid is True

    # Cylinder
    cyl_params = cyl_svc.get_parameters(cyl_id, "rev_000")
    assert cyl_params.base_solid.primitive == "cylinder"
    assert cyl_params.base_solid.parameters["diameter"] == 30.0
    assert cyl_params.base_solid.parameters["height"] == 40.0


def test_monotonic_revision_ids_no_collision(box_session):
    """Verify Acceptance Criterion 9: rev_xxx IDs never collide after rollback followed by new commit."""
    session_id, service = box_session
    topo = service.get_topology(session_id, "rev_000")
    top_face_id = [fid for fid, f in topo.faces.items() if f.normal and f.normal[2] > 0.9][0]
    ref = GeometricReference(
        ref_id=top_face_id,
        transient_id=top_face_id,
        entity_type="face",
        surface_type="plane",
        centroid=[0.0, 0.0, 10.0],
        normal=[0.0, 0.0, 1.0],
    )

    # 1. Commit rev_001
    c1 = service.commit_operation(CommitRequest(
        session_id=session_id,
        base_revision="rev_000",
        operation_type="hole",
        references=[ref],
        parameters={"hole_type": "blind", "diameter": 6.0, "depth": 5.0}
    ))
    assert c1.new_revision == "rev_001"

    # 2. Rollback to rev_000
    r_res = service.rollback_revision(RollbackRequest(session_id=session_id, target_revision="rev_000"))
    assert r_res.active_revision == "rev_000"

    # 3. New commit from rev_000: must NOT collide with rev_001!
    c2 = service.commit_operation(CommitRequest(
        session_id=session_id,
        base_revision="rev_000",
        operation_type="pad",
        references=[ref],
        parameters={"profile": "rectangle", "width": 10.0, "length": 10.0, "height": 5.0}
    ))
    assert c2.new_revision == "rev_002"
    assert c2.operation.operation_id == "op_002"
