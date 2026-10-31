"""Manual CAD modular backend services."""
from app.services.geometry.manual_cad.dispatcher import OPERATION_DISPATCH_TABLE, dispatch_operation
from app.services.geometry.manual_cad.common import OpResult

__all__ = [
    "OPERATION_DISPATCH_TABLE",
    "dispatch_operation",
    "OpResult",
]

