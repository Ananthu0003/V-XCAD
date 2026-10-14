import pytest
import build123d as bd
from app.models.cad_modification import GeometryContext
from app.services.geometry.geometry_context import get_geometry_context, _context_cache

# Mock ManualCADService to avoid full session setup
class MockManualCADService:
    def __init__(self, shape):
        self.shape = shape
    def load_revision_shape(self, session_id, revision_id):
        return self.shape

@pytest.fixture
def mock_cad_service(monkeypatch):
    def _patch(shape):
        monkeypatch.setattr("app.services.geometry.manual_cad_service.ManualCADService.load_revision_shape", lambda self, s, r: shape)
    return _patch

def test_box_context(mock_cad_service):
    box = bd.Box(10, 20, 30)
    mock_cad_service(box)
    _context_cache.clear()
    
    # Test face context
    ctx = get_geometry_context("session_1", "rev_1", "face_0")
    assert ctx.status in ("ok", "partial")
    assert ctx.entity_class == "face.planar"
    assert ctx.planar is not None
    assert ctx.planar.extents_u is not None
    
    # Test body context
    ctx = get_geometry_context("session_1", "rev_1", "body")
    assert ctx.status in ("ok", "partial")
    assert ctx.entity_class == "body"
    assert ctx.body is not None
    assert ctx.body.volume is not None

def test_box_with_blind_hole(mock_cad_service):
    box = bd.Box(10, 10, 10)
    cyl = bd.Cylinder(radius=2, height=5)
    cyl = cyl.locate(bd.Location(bd.Vector(0, 0, 2.5)))
    shape = box - cyl
    mock_cad_service(shape)
    _context_cache.clear()
    
    ctx = get_geometry_context("session_1", "rev_1", "face_0", 0, 0)
    assert ctx.status in ("ok", "partial")
    assert ctx.entity_class == "face.planar"
    assert ctx.planar is not None
    
def test_cylinder(mock_cad_service):
    cyl = bd.Cylinder(radius=5, height=20)
    mock_cad_service(cyl)
    _context_cache.clear()
    
    ctx = get_geometry_context("session_1", "rev_1", "face_0") # cylindrical face
    assert ctx.status in ("ok", "partial")
    
def test_edge_linear(mock_cad_service):
    box = bd.Box(10, 10, 10)
    mock_cad_service(box)
    _context_cache.clear()
    
    ctx = get_geometry_context("session_1", "rev_1", "edge_0")
    assert ctx.status in ("ok", "partial")
    assert ctx.entity_class == "edge.linear"
    assert ctx.edge is not None
    assert ctx.edge.length is not None
    
def test_edge_circular(mock_cad_service):
    cyl = bd.Cylinder(radius=5, height=20)
    mock_cad_service(cyl)
    _context_cache.clear()
    
    # Find a circular edge
    for idx, e in enumerate(cyl.edges()):
        if str(e.geom_type).split(".")[-1].lower() == "circle" or getattr(e, "geom_type", "").name.lower() == "circle":
            ctx = get_geometry_context("session_1", "rev_1", f"edge_{idx}")
            assert ctx.status in ("ok", "partial")
            assert ctx.entity_class == "edge.circular"
            assert ctx.edge is not None
            assert ctx.edge.radius is not None
            break

def test_sphere(mock_cad_service):
    sph = bd.Sphere(radius=10)
    mock_cad_service(sph)
    _context_cache.clear()
    
    ctx = get_geometry_context("session_1", "rev_1", "face_0")
    # Sphere should be face.other and unsupported
    assert ctx.status == "unsupported"
    assert ctx.entity_class == "face.other"

def test_unresolvable_reference(mock_cad_service):
    box = bd.Box(10, 10, 10)
    mock_cad_service(box)
    _context_cache.clear()
    
    ctx = get_geometry_context("session_1", "rev_1", "face_999")
    assert ctx.status == "error"
    assert "reselect" in ctx.message.lower()

def test_open_shell(mock_cad_service):
    box = bd.Box(10, 10, 10)
    faces = box.faces()
    shell = faces[0] # Single face is not a valid solid
    mock_cad_service(shell)
    _context_cache.clear()
    
    ctx = get_geometry_context("session_1", "rev_1", "body")
    assert ctx.status == "error"
    assert "open shell" in ctx.message.lower() or "invalid" in ctx.message.lower()
