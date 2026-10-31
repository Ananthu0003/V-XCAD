"""Manual CAD operations package."""
from app.services.geometry.manual_cad.operations.hole_builder import apply_hole, apply_plug_hole
from app.services.geometry.manual_cad.operations.pocket_builder import apply_pocket
from app.services.geometry.manual_cad.operations.pad_builder import apply_pad
from app.services.geometry.manual_cad.operations.dressup_builder import apply_fillet, apply_chamfer, apply_round_face_edges
from app.services.geometry.manual_cad.operations.direct_builder import (
    apply_push_pull,
    apply_offset_face,
    apply_snap_to_plane,
    apply_delete_feature,
    cluster_subpart_faces,
)
from app.services.geometry.manual_cad.operations.transform_builder import (
    apply_transform,
    apply_move,
    apply_rotate,
    apply_scale,
    apply_mirror,
    apply_align,
    apply_move_feature,
)
from app.services.geometry.manual_cad.operations.pattern_builder import (
    apply_linear_pattern,
    apply_polar_pattern,
    apply_pattern_feature,
)
from app.services.geometry.manual_cad.operations.boolean_builder import (
    apply_primitive,
    apply_shell,
    apply_offset,
    apply_split,
    apply_heal,
)
from app.services.geometry.manual_cad.operations.parametric_builder import (
    apply_edit_feature,
    apply_planar_dimension_edit,
    apply_legacy_cylinder_edit,
)

__all__ = [
    "apply_hole",
    "apply_plug_hole",
    "apply_pocket",
    "apply_pad",
    "apply_fillet",
    "apply_chamfer",
    "apply_round_face_edges",
    "apply_push_pull",
    "apply_offset_face",
    "apply_snap_to_plane",
    "apply_delete_feature",
    "cluster_subpart_faces",
    "apply_transform",
    "apply_move",
    "apply_rotate",
    "apply_scale",
    "apply_mirror",
    "apply_align",
    "apply_move_feature",
    "apply_linear_pattern",
    "apply_polar_pattern",
    "apply_pattern_feature",
    "apply_primitive",
    "apply_shell",
    "apply_offset",
    "apply_split",
    "apply_heal",
    "apply_edit_feature",
    "apply_planar_dimension_edit",
    "apply_legacy_cylinder_edit",
]

