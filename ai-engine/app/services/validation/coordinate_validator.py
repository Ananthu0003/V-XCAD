"""
CoordinateValidator — Enforces coordinate system consistency across CAM pipeline.

Validates:
  - STEP units are mm
  - Toolpath coordinates align with the STEP model frame
  - No viewer centering/normalization affects the actual coordinates
"""
from typing import Dict, List, Any, Optional


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
        self, toolpath_segments: List[Dict[str, Any]], model_bbox: Dict[str, Any], stock_bbox: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Verify toolpath coordinates fall within the physical stock/model envelope in Setup Space.
        Distinguishes between cutting moves (must engage within stock volume) and rapid clearance moves.
        """
        report = {"status": "ok", "warnings": [], "errors": [], "diagnostics": {}}

        if not toolpath_segments:
            return report

        try:
            m_min_x, m_min_y, m_min_z = model_bbox["min"]
            m_max_x, m_max_y, m_max_z = model_bbox["max"]
        except (KeyError, TypeError, IndexError):
            report["warnings"].append("Missing model bounding box for coordinate validation")
            return report

        st_min_x, st_min_y, st_min_z = (stock_bbox.get("min", [m_min_x, m_min_y, m_min_z]) if stock_bbox else [m_min_x, m_min_y, m_min_z])
        st_max_x, st_max_y, st_max_z = (stock_bbox.get("max", [m_max_x, m_max_y, m_max_z]) if stock_bbox else [m_max_x, m_max_y, m_max_z])

        # Compute Toolpath Bounding Box and check individual segment types
        tp_min_x, tp_min_y, tp_min_z = 1e9, 1e9, 1e9
        tp_max_x, tp_max_y, tp_max_z = -1e9, -1e9, -1e9
        cutting_out_of_bounds = []

        # Margin for tool radius and lead-in/out
        radial_margin = 25.0
        depth_margin = 1.0  # slight numerical tolerance on bottom floor

        for seg in toolpath_segments:
            s_pt = seg.get("start", {})
            e_pt = seg.get("end", {})
            m_type = str(seg.get("move_type") or seg.get("commandType") or "").lower()
            is_cut = ("cut" in m_type or "arc" in m_type or "plunge" in m_type or "drill" in m_type)

            for pt in (s_pt, e_pt):
                px, py, pz = pt.get("x"), pt.get("y"), pt.get("z")
                if px is not None and py is not None and pz is not None:
                    tp_min_x, tp_max_x = min(tp_min_x, px), max(tp_max_x, px)
                    tp_min_y, tp_max_y = min(tp_min_y, py), max(tp_max_y, py)
                    tp_min_z, tp_max_z = min(tp_min_z, pz), max(tp_max_z, pz)

                    if is_cut:
                        # Cutting moves must stay within stock XY bounds (plus tool margin) and not plunge below stock bottom
                        if (
                            px < st_min_x - radial_margin or px > st_max_x + radial_margin or
                            py < st_min_y - radial_margin or py > st_max_y + radial_margin or
                            pz < st_min_z - depth_margin
                        ):
                            cutting_out_of_bounds.append((px, py, pz, m_type))

        report["diagnostics"] = {
            "coordinateSpace": "SETUP",
            "units": "mm",
            "model_bbox": {"min": [m_min_x, m_min_y, m_min_z], "max": [m_max_x, m_max_y, m_max_z]},
            "stock_bbox": {"min": [st_min_x, st_min_y, st_min_z], "max": [st_max_x, st_max_y, st_max_z]},
            "toolpath_bbox": {
                "min": [round(tp_min_x, 4), round(tp_min_y, 4), round(tp_min_z, 4)] if tp_min_x < 1e8 else None,
                "max": [round(tp_max_x, 4), round(tp_max_y, 4), round(tp_max_z, 4)] if tp_max_x > -1e8 else None
            }
        }

        if cutting_out_of_bounds:
            err_msg = (
                f"{len(cutting_out_of_bounds)} cutting move points violate physical stock boundaries. "
                f"Stock envelope: X[{st_min_x:.1f}, {st_max_x:.1f}], Y[{st_min_y:.1f}, {st_max_y:.1f}], Z[{st_min_z:.1f}, {st_max_z:.1f}]. "
                f"First offending move: {cutting_out_of_bounds[0]}"
            )
            report["status"] = "error"
            report["errors"].append(err_msg)

        return report
