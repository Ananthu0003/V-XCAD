import pytest
import build123d as bd
from app.services.geometry.manual_cad_service import ManualCADService
from app.models.cad_modification import (
    PreviewRequest,
    CommitRequest,
    RecomputeRequest,
    OperationStatus
)

@pytest.fixture
def manual_cad_service(tmp_path):
    return ManualCADService(storage_dir=tmp_path)

@pytest.fixture
def box_session(manual_cad_service):
    session_id = "test_session_reg"
    box = bd.Box(10, 10, 10)
    manual_cad_service.initialize_session_if_needed(session_id, base_shape=box)
    return session_id, manual_cad_service

def test_registry_unknown_type(box_session):
    session_id, service = box_session
    req = PreviewRequest(
        session_id=session_id,
        base_revision="rev_000",
        operation_type="unknown_magic",
        references=[],
        parameters={}
    )
    result = service.preview_operation(req)
    assert result.valid is False
    assert result.status == OperationStatus.INVALID_REFERENCE
    assert "Unsupported operation type: unknown_magic" in result.validation.error_message

def test_registry_round_trip(box_session):
    session_id, service = box_session
    
    topo = service.get_topology(session_id, "rev_000")
    face_id = next(iter(topo.faces.keys()))
    face_ref = topo.faces[face_id]
    
    # 1. Preview
    prev_req = PreviewRequest(
        session_id=session_id,
        base_revision="rev_000",
        operation_type="pad",
        references=[face_ref],
        parameters={"height": 5.0, "profile": "rectangle", "width": 5.0, "length": 5.0}
    )
    prev_res = service.preview_operation(prev_req)
    assert prev_res.valid is True
    assert prev_res.status == OperationStatus.PREVIEW
    
    # 2. Commit
    commit_req = CommitRequest(
        session_id=session_id,
        base_revision="rev_000",
        operation_type="pad",
        references=[face_ref],
        parameters={"height": 5.0, "profile": "rectangle", "width": 5.0, "length": 5.0}
    )
    commit_res = service.commit_operation(commit_req)
    assert commit_res.success is True
    assert commit_res.new_revision == "rev_001"
    
    # 3. Replay
    recompute_req = RecomputeRequest(
        session_id=session_id,
        action="edit_params",
        target_op_id="op_001",
        updated_parameters={"height": 10.0}
    )
    recomp_res = service.recompute_history(recompute_req)
    assert recomp_res.success is True
    assert recomp_res.active_revision == "rev_001"
