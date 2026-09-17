"""VEXCAD API v1 Routers Package."""
from app.api.v1.routers.cad import router as cad_router
from app.api.v1.routers.cam import router as cam_router
from app.api.v1.routers.knowledge import router as knowledge_router
from app.api.v1.routers.assistant import router as assistant_router

__all__ = ["cad_router", "cam_router", "knowledge_router", "assistant_router"]
