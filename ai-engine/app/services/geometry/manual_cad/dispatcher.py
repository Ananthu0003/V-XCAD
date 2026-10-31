"""Manual CAD operations dispatcher."""
from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional

import build123d as bd

from app.models.cad_modification import GeometricReference, OperationStatus
from app.services.geometry.manual_cad.common import OpResult
from app.services.geometry.manual_cad.operations import (
    apply_hole,
    apply_plug_hole,
    apply_pocket,
    apply_pad,
    apply_fillet,
    apply_chamfer,
    apply_round_face_edges,
    apply_push_pull,
    apply_offset_face,
    apply_snap_to_plane,
    apply_delete_feature,
    apply_transform,
    apply_move,
    apply_rotate,
    apply_scale,
    apply_mirror,
    apply_align,
    apply_move_feature,
    apply_linear_pattern,
    apply_polar_pattern,
    apply_pattern_feature,
    apply_primitive,
    apply_shell,
    apply_offset,
    apply_split,
    apply_heal,
    apply_edit_feature,
)

OPERATION_DISPATCH_TABLE: Dict[str, Callable[[bd.Shape, List[GeometricReference], Dict[str, Any]], OpResult]] = {
    # Feature additions & cuts
    "fillet": apply_fillet,
    "chamfer": apply_chamfer,
    "hole": apply_hole,
    "pocket": apply_pocket,
    "pad": apply_pad,
    "edit_feature": apply_edit_feature,
    "offset_face": apply_offset_face,
    "snap_to_plane": apply_snap_to_plane,
    "plug_hole": apply_plug_hole,
    # Body transforms
    "transform": apply_transform,
    "move": apply_move,
    "rotate": apply_rotate,
    "scale": apply_scale,
    "mirror": apply_mirror,
    "align": apply_align,
    # Solid boolean & shaping
    "primitive": apply_primitive,
    "shell": apply_shell,
    "offset": apply_offset,
    "split": apply_split,
    "linear_pattern": apply_linear_pattern,
    "polar_pattern": apply_polar_pattern,
    "heal": apply_heal,
    # Direct modeling & feature operations
    "push_pull": apply_push_pull,
    "round_face_edges": apply_round_face_edges,
    "delete_feature": apply_delete_feature,
    "move_feature": apply_move_feature,
    "pattern_feature": apply_pattern_feature,
}


def dispatch_operation(
    base_shape: bd.Shape,
    op_type: str,
    references: List[GeometricReference],
    parameters: Dict[str, Any],
) -> OpResult:
    """Dispatch operation to specific geometry builder."""
    handler = OPERATION_DISPATCH_TABLE.get(op_type)
    if not handler:
        return None, OperationStatus.INVALID_REFERENCE, f"Unsupported operation type: {op_type}", [], []
    try:
        return handler(base_shape, references, parameters)
    except Exception as exc:
        return None, OperationStatus.GEOMETRY_FAILURE, str(exc), [], []

