"""AiGeometryPlanner — Converts natural-language CAD commands into structured CADOperationPlan objects.

This planner uses:
1. Rule-based fast-path parsing for common, unambiguous commands.
2. LLM fallback (Gemini Flash Lite) for complex or ambiguous commands.
3. Strict validation: only supported operation types are allowed. No arbitrary code execution.

Supported operations: offset_face, snap_to_plane, plug_hole, edit_feature,
                      fillet, chamfer, hole, pocket, pad, select_coplanar, select_similar.
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.models.cad_modification import (
    AiPlanRequest,
    AiPlanResult,
    CADOperationPlan,
)

SUPPORTED_OPERATIONS = frozenset({
    "offset_face",
    "snap_to_plane",
    "plug_hole",
    "edit_feature",
    "fillet",
    "chamfer",
    "hole",
    "pocket",
    "pad",
    "select_coplanar",
    "select_similar",
})

# -----------------------------------------------------------------------
# Rule-based command patterns
# -----------------------------------------------------------------------

# Matches: "offset this face outward by 2 mm", "move face inward by 1.5mm", "push face 3mm"
_OFFSET_PATTERN = re.compile(
    r"(?:offset|push|pull|move|shift)\s+(?:this\s+)?(?:face|surface)?\s*"
    r"(?:(?P<dir>outward|inward|forward|backward|out|in|up|down))?\s*"
    r"(?:by\s+)?(?P<dist>-?\d+(?:\.\d+)?)\s*mm",
    re.IGNORECASE,
)

# Matches: "align face to Z=0", "snap to plane Z=0", "place on Z=0", "put on global Z"
_SNAP_PLANE_PATTERN = re.compile(
    r"(?:snap|align|place|put|move).*?(?:to|on|at)\s+(?:the\s+)?(?:global\s+)?"
    r"(?P<plane>XY|XZ|YZ|Z|X|Y)[\s=]*(?P<coord>-?\d+(?:\.\d+)?)?",
    re.IGNORECASE,
)

# Matches: "plug this bore", "defeature hole", "remove this hole", "fill bore"
_PLUG_PATTERN = re.compile(
    r"(?:plug|defeature|fill|remove|delete|close)\s+(?:this\s+)?(?:bore|hole|cylinder)",
    re.IGNORECASE,
)

# Matches: "select coplanar", "select all coplanar faces"
_COPLANAR_PATTERN = re.compile(r"select\s+(?:all\s+)?coplanar", re.IGNORECASE)

# Matches: "select similar", "find similar bores", "select matching holes"
_SIMILAR_PATTERN = re.compile(
    r"(?:select|find)\s+(?:all\s+)?(?:similar|matching|equivalent|same)",
    re.IGNORECASE,
)

# Matches: "apply 1 mm chamfer to selected edges", "chamfer 1.5mm"
_CHAMFER_PATTERN = re.compile(
    r"(?:apply\s+)?(?P<dist>\d+(?:\.\d+)?)\s*mm\s+chamfer|chamfer\s+(?P<dist2>\d+(?:\.\d+)?)\s*mm",
    re.IGNORECASE,
)

# Matches: "apply 2 mm fillet", "fillet radius 3mm"
_FILLET_PATTERN = re.compile(
    r"(?:apply\s+)?(?P<r>\d+(?:\.\d+)?)\s*mm\s+fillet|fillet\s+(?:radius\s+)?(?P<r2>\d+(?:\.\d+)?)\s*mm",
    re.IGNORECASE,
)

# Matches: "increase these holes to M6 clearance", "make holes 6.6mm"
_EDIT_FEATURE_PATTERN = re.compile(
    r"(?:increase|change|resize|update|make)\s+(?:these\s+)?(?:holes?|bores?)\s+"
    r"(?:to\s+)?(?:M(?P<metric>\d+)\s+clearance|(?P<dia>\d+(?:\.\d+)?)\s*mm)",
    re.IGNORECASE,
)

_M_CLEARANCE = {
    2: 2.2, 3: 3.4, 4: 4.5, 5: 5.5, 6: 6.6,
    8: 9.0, 10: 11.0, 12: 13.5, 16: 17.5, 20: 22.0,
}


def _parse_rule_based(command: str, selected_ids: List[str]) -> Optional[CADOperationPlan]:
    """Attempt fast-path rule-based parsing. Returns None if no rule matches."""

    # Offset face
    m = _OFFSET_PATTERN.search(command)
    if m:
        dist = float(m.group("dist"))
        direction = (m.group("dir") or "outward").lower()
        if direction in ("inward", "in", "backward", "down"):
            dist = -abs(dist)
        else:
            dist = abs(dist)
        return CADOperationPlan(
            operation_type="offset_face",
            target_entity_ids=selected_ids,
            parameters={"distance": dist},
            description=f"Offset selected face by {dist:+.2f} mm along normal",
            confidence=0.92,
        )

    # Snap to plane
    m = _SNAP_PLANE_PATTERN.search(command)
    if m:
        plane_raw = (m.group("plane") or "Z").upper()
        coord = float(m.group("coord") or 0.0) if m.group("coord") else 0.0
        # Map single-axis to plane name
        plane_map = {"Z": "XY", "Y": "XZ", "X": "YZ", "XY": "XY", "XZ": "XZ", "YZ": "YZ"}
        plane = plane_map.get(plane_raw, "XY")
        return CADOperationPlan(
            operation_type="snap_to_plane",
            target_entity_ids=selected_ids,
            parameters={"plane": plane, "target_coordinate": coord},
            description=f"Snap selected face to {plane} plane at {coord:.2f}",
            confidence=0.88,
        )

    # Plug bore
    if _PLUG_PATTERN.search(command):
        return CADOperationPlan(
            operation_type="plug_hole",
            target_entity_ids=selected_ids,
            parameters={},
            description="Plug selected cylindrical bore (bore defeaturing)",
            confidence=0.90,
        )

    # Coplanar selection
    if _COPLANAR_PATTERN.search(command):
        return CADOperationPlan(
            operation_type="select_coplanar",
            target_entity_ids=selected_ids,
            parameters={},
            description="Select all faces coplanar with the selected face",
            confidence=0.95,
        )

    # Similar selection
    if _SIMILAR_PATTERN.search(command):
        return CADOperationPlan(
            operation_type="select_similar",
            target_entity_ids=selected_ids,
            parameters={},
            description="Select all geometrically similar entities",
            confidence=0.90,
        )

    # Chamfer
    m = _CHAMFER_PATTERN.search(command)
    if m:
        dist = float(m.group("dist") or m.group("dist2") or 1.0)
        return CADOperationPlan(
            operation_type="chamfer",
            target_entity_ids=selected_ids,
            parameters={"distance": dist},
            description=f"Apply {dist:.2f} mm chamfer to selected edges",
            confidence=0.90,
        )

    # Fillet
    m = _FILLET_PATTERN.search(command)
    if m:
        radius = float(m.group("r") or m.group("r2") or 2.0)
        return CADOperationPlan(
            operation_type="fillet",
            target_entity_ids=selected_ids,
            parameters={"radius": radius},
            description=f"Apply {radius:.2f} mm fillet to selected edges",
            confidence=0.90,
        )

    # Edit feature (resize hole)
    m = _EDIT_FEATURE_PATTERN.search(command)
    if m:
        if m.group("metric"):
            msize = int(m.group("metric"))
            dia = _M_CLEARANCE.get(msize, msize * 1.1)
        else:
            dia = float(m.group("dia"))
        return CADOperationPlan(
            operation_type="edit_feature",
            target_entity_ids=selected_ids,
            parameters={"diameter": dia, "kind": "hole"},
            description=f"Resize selected holes to ⌀{dia:.2f} mm",
            confidence=0.87,
        )

    return None


# -----------------------------------------------------------------------
# LLM fallback for ambiguous commands
# -----------------------------------------------------------------------

_PLANNER_SYSTEM = """You are a CAD geometry command interpreter for V-XCAD.
Your job is to convert a natural-language CAD editing command into a structured JSON operation plan.

Supported operation_type values (ONLY these are valid):
- offset_face      : parameters: {distance: float (mm, signed, +outward/-inward)}
- snap_to_plane    : parameters: {plane: "XY"|"XZ"|"YZ", target_coordinate: float}
- plug_hole        : parameters: {} (no params, operates on selected cylindrical face)
- edit_feature     : parameters: {diameter: float, kind: "hole"|"boss", depth?: float}
- fillet           : parameters: {radius: float (mm)}
- chamfer          : parameters: {distance: float (mm)}
- hole             : parameters: {diameter: float, depth?: float, hole_type: "blind"|"through"|"counterbore"|"countersink"}
- pocket           : parameters: {depth: float, profile: "rectangle"|"circle"|"slot", width?: float, height?: float}
- pad              : parameters: {height: float, profile: "rectangle"|"circle", width?: float, length?: float}
- select_coplanar  : parameters: {} (query only, no geometry mutation)
- select_similar   : parameters: {} (query only, no geometry mutation)

Rules:
- You MUST respond with a single JSON object and nothing else.
- If the command is ambiguous and you cannot determine the operation with high confidence, set "clarification_needed" to a specific question.
- If the command references units other than mm, convert to mm.
- Never invent an operation_type not in the list above.
- The "confidence" field should be between 0.0 and 1.0.

JSON schema:
{
  "operation_type": "string",
  "target_entity_ids": ["..."],
  "parameters": {...},
  "description": "string",
  "confidence": 0.0-1.0,
  "clarification_needed": "string or null",
  "requires_confirmation": false
}
"""


class AiGeometryPlanner:
    """Converts natural-language CAD commands into validated CADOperationPlan objects."""

    def __init__(self) -> None:
        env_path = Path(__file__).resolve().parents[4] / ".env"
        from dotenv import dotenv_values
        env_dict = dotenv_values(env_path) if env_path.exists() else {}
        self._google_api_key = env_dict.get("GOOGLE_API_KEY") or os.getenv("GOOGLE_API_KEY", "")
        self._openrouter_key = env_dict.get("OPENROUTER_API_KEY") or os.getenv("OPENROUTER_API_KEY", "")

    def plan(self, request: AiPlanRequest) -> AiPlanResult:
        """
        Convert a natural-language command to a CADOperationPlan.
        1. Try rule-based fast path.
        2. If no rule matches, call LLM fallback.
        3. Validate the operation_type is in SUPPORTED_OPERATIONS.
        4. Return the plan or an error.
        """
        command = request.command.strip()
        selected_ids = request.selected_entity_ids or []

        # Fast-path rule-based parsing
        plan = _parse_rule_based(command, selected_ids)
        if plan is not None:
            return AiPlanResult(plan=plan, raw_command=command)

        # LLM fallback
        try:
            llm_plan = self._llm_plan(command, selected_ids, request.geometry_context, request.operation_history)
            if llm_plan is not None:
                return AiPlanResult(plan=llm_plan, raw_command=command)
        except Exception as exc:
            return AiPlanResult(
                plan=None,
                raw_command=command,
                error=f"LLM planning failed: {exc}",
                suggestions=["Try rephrasing the command with explicit measurements (e.g., 'offset face by 2 mm')."],
            )

        return AiPlanResult(
            plan=None,
            raw_command=command,
            error="Could not interpret command. No matching operation found.",
            suggestions=[
                "Specify a measurement (e.g. '2 mm').",
                "Use explicit action words: offset, snap, plug, fillet, chamfer, select similar.",
            ],
        )

    def _llm_plan(
        self,
        command: str,
        selected_ids: List[str],
        geometry_context: Optional[Dict[str, Any]],
        operation_history: List[str],
    ) -> Optional[CADOperationPlan]:
        """Call Gemini Flash Lite to interpret the command. Returns None if unavailable."""
        if not self._google_api_key:
            return None

        import requests

        ctx_str = ""
        if geometry_context:
            ctx_str = f"\nSelected geometry context: {json.dumps(geometry_context, indent=2)}"
        if operation_history:
            ctx_str += f"\nRecent operations: {'; '.join(operation_history[-3:])}"

        user_message = (
            f"Command: {command}\n"
            f"Selected entity IDs: {selected_ids}{ctx_str}\n\n"
            "Respond with ONLY the JSON operation plan."
        )

        payload = {
            "contents": [
                {"role": "user", "parts": [{"text": user_message}]}
            ],
            "systemInstruction": {"parts": [{"text": _PLANNER_SYSTEM}]},
            "generationConfig": {"temperature": 0.1, "maxOutputTokens": 512},
        }

        model = "gemini-2.0-flash-lite"
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={self._google_api_key}"
        resp = requests.post(url, json=payload, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        raw_text = data["candidates"][0]["content"]["parts"][0]["text"]

        # Extract JSON from response
        raw_text = raw_text.strip()
        if raw_text.startswith("```"):
            raw_text = re.sub(r"```(?:json)?", "", raw_text).replace("```", "").strip()

        plan_data = json.loads(raw_text)

        op_type = plan_data.get("operation_type", "")
        if op_type not in SUPPORTED_OPERATIONS:
            raise ValueError(f"LLM returned unsupported operation_type: {op_type!r}")

        return CADOperationPlan(
            operation_type=op_type,
            target_entity_ids=plan_data.get("target_entity_ids", selected_ids),
            parameters=plan_data.get("parameters", {}),
            description=plan_data.get("description", ""),
            confidence=float(plan_data.get("confidence", 0.7)),
            clarification_needed=plan_data.get("clarification_needed"),
            requires_confirmation=bool(plan_data.get("requires_confirmation", False)),
        )
