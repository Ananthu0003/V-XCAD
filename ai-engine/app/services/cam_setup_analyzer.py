"""
CamSetupAnalyzer — Setup-aware machinability analysis.

For every recognized feature, compares the feature's machining axis
against the current setup's tool axis.  Marks each feature as
machinable, blocked, or requiring reorientation.

Axis rule:
    abs(dot(feature.axis, setup.toolAxis)) > 0.98 → machinable
    Otherwise → blocked with reason.
"""
import math
from typing import List, Dict, Any, Optional


# Cosine threshold for "aligned enough" with the tool axis
_ALIGNMENT_THRESHOLD = 0.98


class CamSetupAnalyzer:
    """Analyses feature machinability relative to a given CNC setup."""

    def __init__(self):
        pass

    def analyze(
        self,
        features: List[Dict[str, Any]],
        setup: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        """
        Annotate each feature with machinability fields.

        Parameters
        ----------
        features : list[dict]
            Features produced by CamFeatureRecognition (already geometry-mapped).
        setup : dict
            Active CamSetup, must contain ``toolAxis`` (list of 3 floats).

        Returns
        -------
        list[dict]
            The same feature list, with added keys:
            - machinable_in_current_setup (bool)
            - requires_reorientation (bool)
            - requires_4axis_or_secondary_setup (bool)
            - blocked_reason (str | None)
        """
        tool_axis = setup.get("toolAxis", [0.0, 0.0, 1.0])

        for feature in features:
            result = self._check_feature(feature, tool_axis)
            feature.update(result)

        return features

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _check_feature(
        self,
        feature: Dict[str, Any],
        tool_axis: List[float],
    ) -> Dict[str, Any]:
        """Return a dict of machinability fields for one feature."""
        feat_type = feature.get("type", "")
        feat_axis = feature.get("axis")

        # Features that are inherently axis-independent (planar faces,
        # outer contours) are treated as machinable if their normal is
        # aligned with the tool axis — or if no explicit axis is stored.
        if not feat_axis:
            # No axis → assume top-facing (Z-up), check tool axis is Z
            if abs(tool_axis[2]) > _ALIGNMENT_THRESHOLD:
                return self._machinable()
            else:
                return self._blocked(
                    f"{feat_type.replace('_', ' ').title()} has no explicit axis and "
                    f"tool axis is not Z-up."
                )

        alignment = self._axis_alignment(feat_axis, tool_axis)

        if alignment > _ALIGNMENT_THRESHOLD:
            return self._machinable()

        # Determine whether a simple flip (reorientation) or full
        # multi-axis / secondary setup is needed.
        #
        # If the feature axis is perpendicular to the tool axis
        # (dot ≈ 0) it definitely needs a different setup direction.
        # If it's somewhere in between, flag it as needing 4-axis.
        if alignment < 0.1:
            # Nearly perpendicular — needs 90° reorientation
            return self._blocked(
                f"{feat_type.replace('_', ' ').title()} axis "
                f"[{','.join(f'{v:.2f}' for v in feat_axis)}] is perpendicular "
                f"to tool axis — requires secondary setup or 4-axis indexing.",
                requires_reorientation=True,
            )
        else:
            # Oblique — needs continuous 4-axis or 5-axis
            return self._blocked(
                f"{feat_type.replace('_', ' ').title()} axis "
                f"[{','.join(f'{v:.2f}' for v in feat_axis)}] is not aligned "
                f"with tool axis — requires 4-axis or secondary setup.",
                requires_4axis=True,
            )

    @staticmethod
    def _axis_alignment(a: List[float], b: List[float]) -> float:
        """Return abs(dot(a, b)), assuming both are unit vectors."""
        dot = sum(ai * bi for ai, bi in zip(a, b))
        return abs(dot)

    @staticmethod
    def _machinable() -> Dict[str, Any]:
        return {
            "machinable_in_current_setup": True,
            "requires_reorientation": False,
            "requires_4axis_or_secondary_setup": False,
            "blocked_reason": None,
        }

    @staticmethod
    def _blocked(
        reason: str,
        *,
        requires_reorientation: bool = False,
        requires_4axis: bool = False,
    ) -> Dict[str, Any]:
        return {
            "machinable_in_current_setup": False,
            "requires_reorientation": requires_reorientation,
            "requires_4axis_or_secondary_setup": requires_4axis,
            "blocked_reason": reason,
        }
