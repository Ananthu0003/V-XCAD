"""Body-level editing operations for VEXCAD Manual CAD.

These operations are modularized under app.services.geometry.manual_cad.operations.
This module preserves full backward-compatibility for BodyOperationsMixin and legacy helpers.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Set, Tuple

import build123d as bd

from app.models.cad_modification import GeometricReference, OperationStatus
from app.services.geometry.manual_cad.common import (
    OpResult,
    _AXES,
    _PLANES,
    MAX_PATTERN_COUNT,
    MAX_SCALE,
    MIN_SCALE,
    _fail,
    _ok,
    _f,
    _center,
    _pivot,
    _plane_from,
)
from app.services.geometry.manual_cad.operations import (
    apply_transform,
    apply_move,
    apply_rotate,
    apply_scale,
    apply_mirror,
    apply_align,
    apply_primitive,
    apply_shell,
    apply_offset,
    apply_split,
    apply_linear_pattern,
    apply_polar_pattern,
    apply_heal,
    apply_push_pull,
    apply_round_face_edges,
    cluster_subpart_faces,
    apply_delete_feature,
    apply_edit_feature,
    apply_planar_dimension_edit,
    apply_legacy_cylinder_edit,
    apply_move_feature,
    apply_pattern_feature,
)


class BodyOperationsMixin:
    """Mixed into ``ManualCADService``; delegates whole-body editing handlers to modular operations."""

    def _apply_transform(self, shape: bd.Shape, refs: List[GeometricReference], params: Dict[str, Any]) -> OpResult:
        return apply_transform(shape, refs, params)

    def _apply_move(self, shape: bd.Shape, refs: List[GeometricReference], params: Dict[str, Any]) -> OpResult:
        return apply_move(shape, refs, params)

    def _apply_rotate(self, shape: bd.Shape, refs: List[GeometricReference], params: Dict[str, Any]) -> OpResult:
        return apply_rotate(shape, refs, params)

    def _apply_scale(self, shape: bd.Shape, refs: List[GeometricReference], params: Dict[str, Any]) -> OpResult:
        return apply_scale(shape, refs, params)

    def _apply_mirror(self, shape: bd.Shape, refs: List[GeometricReference], params: Dict[str, Any]) -> OpResult:
        return apply_mirror(shape, refs, params)

    def _apply_align(self, shape: bd.Shape, refs: List[GeometricReference], params: Dict[str, Any]) -> OpResult:
        return apply_align(shape, refs, params)

    def _apply_primitive(self, shape: bd.Shape, refs: List[GeometricReference], params: Dict[str, Any]) -> OpResult:
        return apply_primitive(shape, refs, params)

    def _apply_shell(self, shape: bd.Shape, refs: List[GeometricReference], params: Dict[str, Any]) -> OpResult:
        return apply_shell(shape, refs, params)

    def _apply_offset(self, shape: bd.Shape, refs: List[GeometricReference], params: Dict[str, Any]) -> OpResult:
        return apply_offset(shape, refs, params)

    def _apply_split(self, shape: bd.Shape, refs: List[GeometricReference], params: Dict[str, Any]) -> OpResult:
        return apply_split(shape, refs, params)

    def _apply_linear_pattern(self, shape: bd.Shape, refs: List[GeometricReference], params: Dict[str, Any]) -> OpResult:
        return apply_linear_pattern(shape, refs, params)

    def _apply_polar_pattern(self, shape: bd.Shape, refs: List[GeometricReference], params: Dict[str, Any]) -> OpResult:
        return apply_polar_pattern(shape, refs, params)

    def _apply_heal(self, shape: bd.Shape, refs: List[GeometricReference], params: Dict[str, Any]) -> OpResult:
        return apply_heal(shape, refs, params)

    def _apply_push_pull(self, shape: bd.Shape, refs: List[GeometricReference], params: Dict[str, Any]) -> OpResult:
        return apply_push_pull(shape, refs, params)

    def _apply_round_face_edges(self, shape: bd.Shape, refs: List[GeometricReference], params: Dict[str, Any]) -> OpResult:
        return apply_round_face_edges(shape, refs, params)

    @classmethod
    def _cluster_subpart_faces(cls, shape: bd.Shape, initial_fids: Set[str]) -> List[Set[str]]:
        return cluster_subpart_faces(shape, initial_fids)

    def _apply_delete_feature(self, shape: bd.Shape, refs: List[GeometricReference], params: Dict[str, Any]) -> OpResult:
        return apply_delete_feature(shape, refs, params)

    def _apply_edit_feature(self, shape: bd.Shape, refs: List[GeometricReference], params: Dict[str, Any]) -> OpResult:
        return apply_edit_feature(shape, refs, params)

    def _apply_planar_dimension_edit(self, shape: bd.Shape, face: bd.Face, params: Dict[str, Any], refs: List[GeometricReference]) -> OpResult:
        return apply_planar_dimension_edit(shape, face, params, refs)

    def _apply_legacy_cylinder_edit(self, shape: bd.Shape, face: bd.Face, params: Dict[str, Any]) -> OpResult:
        return apply_legacy_cylinder_edit(shape, face, params)

    def _apply_move_feature(self, shape: bd.Shape, refs: List[GeometricReference], params: Dict[str, Any]) -> OpResult:
        return apply_move_feature(shape, refs, params)

    def _apply_pattern_feature(self, shape: bd.Shape, refs: List[GeometricReference], params: Dict[str, Any]) -> OpResult:
        return apply_pattern_feature(shape, refs, params)
