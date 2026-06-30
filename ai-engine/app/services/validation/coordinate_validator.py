"""
CoordinateValidator — Enforces coordinate system consistency across CAM pipeline.

Validates:
  - STEP units are mm
  - Toolpath coordinates align with the STEP model frame
  - No viewer centering/normalization affects the actual coordinates
"""
from typing import Dict, List, Any


class CoordinateValidator:
    """Validates coordinate system consistency across the CAM pipeline (C5)."""

    def __init__(self):
        pass

    def validate_step_units(self, step_metadata: Dict[str, Any]) -> None:
        """Verify STEP file is in mm."""
        unit = step_metadata.get("unit", "").lower()
        if unit and unit not in ("mm", "millimeter", "millimeters"):
            raise ValueError(f"STEP file must be in mm, got {unit}")

    def validate_toolpath_in_model_frame(
        self, toolpath_segments: List[Dict[str, Any]], model_bbox: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Verify toolpath coordinates fall within reasonable bounds of the model
        bounding box (with stock offset allowance).  Catches viewer centering
        or normalization bugs.
        """
        report = {"status": "ok", "warnings": [], "errors": []}

        if not toolpath_segments:
            return report

        try:
            min_x = model_bbox["min"][0]
            min_y = model_bbox["min"][1]
            min_z = model_bbox["min"][2]
            max_x = model_bbox["max"][0]
            max_y = model_bbox["max"][1]
            max_z = model_bbox["max"][2]
        except KeyError:
            report["warnings"].append("Missing model bounding box for validation")
            return report

        # Allow paths to go 50mm outside model (for rapids, clearance, etc)
        margin = 50.0
        allowed_min_x = min_x - margin
        allowed_max_x = max_x + margin
        allowed_min_y = min_y - margin
        allowed_max_y = max_y + margin
        # Z can go higher for clearance, but shouldn't go significantly below
        # the model bottom unless drilling deep holes.
        allowed_min_z = min_z - margin
        allowed_max_z = max_z + 200.0

        out_of_bounds_count = 0
        extreme_point = None

        for seg in toolpath_segments:
            end_pt = seg.get("end", {})
            x = end_pt.get("x")
            y = end_pt.get("y")
            z = end_pt.get("z")

            if x is None or y is None or z is None:
                continue

            if (
                x < allowed_min_x or x > allowed_max_x or
                y < allowed_min_y or y > allowed_max_y or
                z < allowed_min_z or z > allowed_max_z
            ):
                out_of_bounds_count += 1
                if extreme_point is None:
                    extreme_point = (x, y, z)

        if out_of_bounds_count > 0:
            msg = (
                f"{out_of_bounds_count} toolpath points are out of bounds. "
                f"Model bounds: X[{min_x:.1f}, {max_x:.1f}], Y[{min_y:.1f}, {max_y:.1f}], Z[{min_z:.1f}, {max_z:.1f}]. "
                f"Extreme point: {extreme_point}"
            )
            report["status"] = "warning"
            report["warnings"].append(msg)
            # If it's wildly out of bounds, it might be a centering bug
            if out_of_bounds_count > len(toolpath_segments) * 0.1:  # >10% of path
                 report["status"] = "error"
                 report["errors"].append(msg + " (Possible coordinate frame mismatch)")

        # Compute Toolpath Bounding Box
        tp_min_x, tp_min_y, tp_min_z = 1e9, 1e9, 1e9
        tp_max_x, tp_max_y, tp_max_z = -1e9, -1e9, -1e9

        for seg in toolpath_segments:
            s_pt = seg.get("start", {})
            e_pt = seg.get("end", {})
            for pt in (s_pt, e_pt):
                px, py, pz = pt.get("x"), pt.get("y"), pt.get("z")
                if px is not None:
                    tp_min_x, tp_max_x = min(tp_min_x, px), max(tp_max_x, px)
                    tp_min_y, tp_max_y = min(tp_min_y, py), max(tp_max_y, py)
                    tp_min_z, tp_max_z = min(tp_min_z, pz), max(tp_max_z, pz)

        if tp_min_x < 1e8:
            tp_center_x = (tp_min_x + tp_max_x) / 2.0
            tp_center_y = (tp_min_y + tp_max_y) / 2.0
            tp_center_z = (tp_min_z + tp_max_z) / 2.0

            m_center_x = (min_x + max_x) / 2.0
            m_center_y = (min_y + max_y) / 2.0
            m_center_z = (min_z + max_z) / 2.0

            dist = ((tp_center_x - m_center_x)**2 + (tp_center_y - m_center_y)**2 + (tp_center_z - m_center_z)**2)**0.5

            report["diagnostics"] = {
                "model_bbox": {"min": [min_x, min_y, min_z], "max": [max_x, max_y, max_z]},
                "toolpath_bbox": {"min": [tp_min_x, tp_min_y, tp_min_z], "max": [tp_max_x, tp_max_y, tp_max_z]},
                "coordinate_offset": [tp_center_x - m_center_x, tp_center_y - m_center_y, tp_center_z - m_center_z],
                "offset_distance": dist
            }

            if dist > 5.0:
                report["status"] = "error"
                report["errors"].append(f"Toolpath generation rejected: BBox center differs from model by {dist:.2f}mm (limit is 5mm). Coordinate System Failure.")

        return report
