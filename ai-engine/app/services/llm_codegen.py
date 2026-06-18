from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from typing import Any, Callable

try:
    from google import genai
    from google.genai import types
except ImportError:
    genai = None 
    types = None


# -- System Instructions -------------------------------------------------------

AUDIT_INSTRUCTION = """
# ROLE: Senior CAD Reconstruction Engineer
You specialize in translating precision engineering blueprints into structured JSON with 100% accuracy.
You must analyze the provided technical drawing with tolerance-aware rigor.
The generated output must match the engineering drawing exactly. No dimension guessing. No hallucinated features. No invented measurements. No hardcoded assumptions.

--------------------------------------------------
NEW EXTRACTION STRATEGY
--------------------------------------------------
Before extracting dimensions:

STEP 1: Classify drawing type
- Single View, Orthographic, Third Angle Projection, First Angle Projection, Section View, Detail View, Assembly Drawing

STEP 2: Detect and separate all views
- e.g., Front View, Top View, Side View, Section A-A, Detail B. Store each view independently.

STEP 3: Determine feature ownership
- e.g., Hole visible in Front View, Diameter visible in Section View, Location visible in Top View. Merge into one feature.

--------------------------------------------------
FEATURE-FIRST EXTRACTION
--------------------------------------------------
Do NOT start with dimensions. First detect features.
Required features: Hole, Blind Hole, Through Hole, Counterbore, Countersink, Pocket, Slot, Boss, Rib, Fillet, Chamfer, Thread, Groove, Keyway, Step, Revolved Feature, Pattern.

For each feature, generate:
{ "feature_id", "feature_type", "dimensions", "coordinates", "parent_feature", "source_views" }

--------------------------------------------------
DIMENSION VALIDATION & MULTI-VIEW CONSISTENCY
--------------------------------------------------
Every extracted dimension must include:
{ "value", "unit", "confidence", "source_view", "source_text" }
If confidence < 0.90, mark as: "REQUIRES_VERIFICATION". Do NOT use uncertain dimensions directly.
Cross-check dimensions across views. If Front View Width=100 and Top View Width=98, flag inconsistency. Do not silently choose one.

--------------------------------------------------
ZERO-HALLUCINATION RULE
--------------------------------------------------
If a dimension is not visible: Do NOT guess.
Store: { "status": "missing_dimension" } instead of inventing values.

--------------------------------------------------
STRICT JSON SCHEMA OUTPUT
--------------------------------------------------
Output ONLY valid JSON matching this exact structure:

```json
{
  "view_analysis": {
    "drawing_type": "Orthographic",
    "detected_views": ["Front View", "Top View"]
  },
  "extracted_features": [
    {
      "feature_id": "hole_001",
      "feature_type": "Through Hole",
      "dimensions": [
        { "type": "diameter", "value": 10.0, "unit": "mm", "confidence": 0.98, "source_view": "Front View", "source_text": "Ø10" }
      ],
      "coordinates": { "x": 0.0, "y": 0.0, "z": 0.0 },
      "parent_feature": "base_001",
      "source_views": ["Front View", "Top View"]
    }
  ],
  "feature_graph": {
    "base_001": ["hole_001"]
  },
  "dimension_validation_report": {
    "inconsistencies": [],
    "missing_dimensions": []
  },
  "geometric_self_check": {
    "hole_count": 1,
    "slot_count": 0,
    "pocket_count": 0,
    "chamfer_count": 0,
    "fillet_count": 0,
    "overall_bounding_box": {"x": 100, "y": 50, "z": 20}
  },
  "overall_confidence_score": 0.95
}
```
""".strip()


SYSTEM_INSTRUCTION = """
# ROLE: Expert Python Parametric CAD Engineer
Generate production-grade, mathematically robust, parametric CAD code using the `build123d` Python library.

## 🎯 GOLDEN RULES
1. **Blueprint Adherence**: You MUST strictly follow the provided `FEATURE_MAP`. Do not invent new features or ignore existing ones. Ensure all dimensions match the `dims` field exactly.
2. **Manifold Stability**: Every boolean operation must resolve cleanly. Avoid coincident face intersections by extending subtractive cuts slightly.
3. **Parametric Stacking**: No hardcoded values. Derive downstream coordinates explicitly.
4. **Pythonic Structure**: Use the declarative `with BuildPart() as part:` syntax wherever possible.
5. **Metadata Mapping**: You MUST generate a `PARAMETER_METADATA` dictionary matching the `PARAMETERS` exactly, providing a `"group"`, `"confidence"` (0.0 to 1.0), and `"description"` for every parameter.

## 🧠 MANDATORY SPATIAL PLANNING (CRITICAL FOR ACCURACY)
Before writing the `with bd.BuildPart()` block, you MUST write a multi-line python comment block detailing the spatial coordinates for every single feature. Calculate exact X, Y, Z centers and alignments based on the `PARAMETERS`. 
Example:
# --- SPATIAL PLAN ---
# Base Block: size=(width, length, height), centered at (0, 0, height/2)
# Main Hole: offset from center by (width/2 - hole_margin, 0, 0), radius=hole_rad, depth=height
# --------------------

## 📚 STRICT BUILD123D API CHEAT SHEET
You may ONLY use the following exact signatures. DO NOT INVENT kwargs.

**2D Sketches (inside `with bd.BuildSketch():`)**
- `bd.Circle(radius: float)`
- `bd.Rectangle(width: float, height: float)`
- `bd.RegularPolygon(radius: float, side_count: int)`
- `bd.SlotOverall(width: float, height: float)`
- `bd.Polygon(pts: list[tuple[float, float]])`

**3D Primitives (inside `with bd.BuildPart():`)**
- `bd.Box(length: float, width: float, height: float)`
- `bd.Cylinder(radius: float, height: float)`
- `bd.Sphere(radius: float)`
- `bd.Cone(bottom_radius: float, top_radius: float, height: float)`

**3D Operations (inside `with bd.BuildPart():`)**
- `bd.extrude(amount: float, both: bool = False)`
- `bd.revolve(axis: bd.Axis = bd.Axis.Z)`
- `bd.Hole(radius: float, depth: float)`
- `bd.chamfer(edges, length: float)`
- `bd.fillet(edges, radius: float)`

**Locations & Contexts**
- `with bd.Locations((x, y, z)):`
- `with bd.PolarLocations(radius: float, count: int):`
- `with bd.GridLocations(x_spacing: float, y_spacing: float, x_count: int, y_count: int):`

**🚫 ANTI-HALLUCINATION RULES (NEVER DO THESE):**
- NEVER use `size=(...)` anywhere. Use explicit length/width/height.
- NEVER use `sides=...`. Use `side_count=...`.
- NEVER write CadQuery code (e.g., `cq.Workplane()`, `part.cut()`, `part.fuse()`). You are writing purely declarative `build123d`.
- NEVER call context functions as methods. (e.g., WRONG: `part.extrude()`. RIGHT: `bd.extrude()`).
- NEVER use `with bd.Rotation(...):`. Use `with bd.Locations(bd.Rotation(...)):`.

## 📦 COMPACT STRUCTURE
Your output script must follow this exact structure. Ensure the SPATIAL PLAN comment block is INSIDE the python code block, AFTER the parameter definitions.

```python
import build123d as bd

PARAMETERS = {
    "shank_diameter": 20.0,
    "shank_height": 20.0,
    "body_diameter": 40.0,
    "body_height": 30.0
}

PARAMETER_METADATA = {
    "shank_diameter": { "group": "Shank", "confidence": 0.98, "description": "Outer diameter of the shank" },
    "shank_height": { "group": "Shank", "confidence": 0.95, "description": "Total length of the shank" },
    "body_diameter": { "group": "Body", "confidence": 0.85, "description": "Outer diameter of the main body" },
    "body_height": { "group": "Body", "confidence": 0.99, "description": "Length of the main body" }
}

shank_diameter = PARAMETERS["shank_diameter"]
shank_height = PARAMETERS["shank_height"]
body_diameter = PARAMETERS["body_diameter"]
body_height = PARAMETERS["body_height"]

# --- SPATIAL PLAN ---
# Shank: centered at origin (0,0,0), extrudes UP (+Z) to shank_height.
# Body: sits on top of shank at Z=shank_height, extrudes UP (+Z) to body_height.
# Through Hole: drilled from Z=0 through entire height.
# --------------------

with bd.BuildPart() as part:
    # @id: shank
    with bd.BuildSketch():
        bd.Circle(radius=shank_diameter/2)
    bd.extrude(amount=shank_height)

    # @id: body
    with bd.Locations((0, 0, shank_height)):
        with bd.BuildSketch():
            bd.Circle(radius=body_diameter/2)
        bd.extrude(amount=body_height)

    # @id: through_hole
    with bd.Locations((0, 0, 0)):
        bd.Hole(radius=5, depth=shank_height + body_height)

if __name__ == '__main__':
    try:
        from ocp_vscode import show
        show(part)
    except ImportError:
        pass
```

**YOU ARE NOW READY TO GENERATE PRODUCTION-GRADE BUILD123D PYTHON CODE.**
""".strip()


EDIT_SYSTEM_PROMPT = """
# ROLE: Expert CAD Engineer & build123d Refinement Specialist
You are an expert CAD engineer editing an existing build123d Python script.
You must read the provided CURRENT CODE and modify it to fulfill the user's request.
DO NOT generate a completely new model from scratch. Retain the existing structure, parts, and variable definitions (PARAMETERS_START/END block) unless specifically asked to remove them.
Output the ENTIRE updated build123d Python script. Do not output partial snippets.

Your script must follow the exact syntax, manifold stability rules, and proper Build123d contexts.
""".strip()



# -- Regex ---------------------------------------------------------------------

_CODE_FENCE_RE = re.compile(r"```(?:scad|openscad|text|python)?\s*(.*?)```", re.I | re.S)
_CODE_START_RE = re.compile(
    r"(?m)^(?:import\s+|from\s+|PARAMETERS\s*=)"
)


# -- Service -------------------------------------------------------------------

class LLMCodegenService:
    """Stateless AI orchestration service wrapping the Gemini API."""

    MAX_RETRIES = 3

    def __init__(self, model: str | None = None) -> None:
        if genai is None:
            raise RuntimeError("google-genai SDK not installed.")

        self._load_env()
        api_key = os.getenv("GOOGLE_API_KEY", "")
        if not api_key:
            raise RuntimeError("GOOGLE_API_KEY environment variable not set.")

        self.client = genai.Client(api_key=api_key)
        self.model  = model or os.getenv("GENAI_MODEL", "gemini-3.1-flash-lite")

    # -- Private helpers ---------------------------------------------------------

    @staticmethod
    def _load_env() -> None:
        try:
            from dotenv import load_dotenv
            load_dotenv(Path(__file__).resolve().parents[2] / ".env")
        except Exception:
            pass

    def _call_with_retry(self, fn: Callable[[], Any], label: str) -> str:
        """Execute `fn()` up to MAX_RETRIES times with exponential back-off."""
        last_exc: Exception | None = None
        for attempt in range(self.MAX_RETRIES):
            try:
                response = fn()
                return response.text or ""
            except Exception as exc:
                last_exc = exc
                time.sleep(2 ** attempt)
        raise RuntimeError(
            f"[{label}] failed after {self.MAX_RETRIES} attempts: {last_exc}"
        )

    @staticmethod
    def _normalize_script(raw: str) -> str:
        """Strip markdown fences and leading prose from a raw LLM response."""
        if not raw:
            return ""

        # Extract the correct code fence block if present
        fences = _CODE_FENCE_RE.findall(raw)
        
        text = raw
        if fences:
            # Prioritize blocks that actually look like our CAD script
            cad_fences = [f for f in fences if "import build123d" in f or "from build123d" in f or "PARAMETERS" in f]
            if cad_fences:
                text = max(cad_fences, key=len)
            else:
                # Fallback to the largest code block
                text = max(fences, key=len)

        cleaned = text.strip().strip("`").strip()

        # Fast-forward to the first recognizable token
        m = _CODE_START_RE.search(cleaned)
        if m:
            cleaned = cleaned[m.start():].strip()

        return cleaned

    # -- Public API ------------------------------------------------------------

    def audit_blueprint(
        self,
        image_bytes: bytes,
        mime_type: str,
    ) -> dict[str, Any]:
        """
        Stage 1 - Analyse a blueprint image/PDF and return a structured
        feature-map dictionary.
        """
        def _call() -> Any:
            return self.client.models.generate_content(
                model=self.model,
                contents=[
                    types.Part.from_text(text=AUDIT_INSTRUCTION),
                    types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
                ],
                config=types.GenerateContentConfig(
                    temperature=0.0,
                    response_mime_type="application/json",
                ),
            )

        raw = self._call_with_retry(_call, "audit")

        try:
            cleaned = raw.strip().lstrip("```json").lstrip("```").rstrip("```").strip()
            return json.loads(cleaned)
        except Exception:
            return {}

    def generate_script(
        self,
        prompt: str,
        image_bytes: bytes | None = None,
        mime_type: str | None = None,
        feature_map: dict[str, Any] | None = None,
        base_code: str | None = None,
        selection_context: str | None = None,
    ) -> str:
        """
        Stage 2 - Synthesise or refine an OpenSCAD script.

        If `base_code` is provided, Gemini will refine the existing script
        rather than generating from scratch. `selection_context` attaches
        spatial raycasting data so edits are geometrically targeted.
        """
        # Build context string
        parts: list[str] = [f"REQUEST: {prompt}"]

        if feature_map:
            parts.append(f"FEATURE_MAP:\n{json.dumps(feature_map, indent=2)}")

        if base_code:
            parts.append(f"EXISTING_CODE_TO_REFINE:\n{base_code}")

        if selection_context:
            parts.append(f"USER_SELECTION_CONTEXT:\n{selection_context}")

        user_text = "\n\n".join(parts)

        # Assemble multimodal contents
        contents: list[Any] = [types.Part.from_text(text=SYSTEM_INSTRUCTION)]
        if image_bytes and mime_type:
            contents.append(types.Part.from_bytes(data=image_bytes, mime_type=mime_type))
        contents.append(types.Part.from_text(text=user_text))

        def _call() -> Any:
            return self.client.models.generate_content(
                model=self.model,
                contents=contents,
                config=types.GenerateContentConfig(temperature=0.0),
            )

        raw = self._call_with_retry(_call, "codegen")
        return self._normalize_script(raw)

    async def generate_script_stream(
        self,
        prompt: str,
        image_bytes: bytes | None = None,
        mime_type: str | None = None,
        feature_map: dict[str, Any] | None = None,
        base_code: str | None = None,
        selection_context: str | None = None,
    ):
        """
        Stage 2 - Synthesise or refine an OpenSCAD script, yielding chunks.
        """
        import asyncio

        parts: list[str] = [f"REQUEST: {prompt}"]
        if feature_map:
            parts.append(f"FEATURE_MAP:\n{json.dumps(feature_map, indent=2)}")
        if base_code:
            parts.append(f"EXISTING_CODE_TO_REFINE:\n{base_code}")
        if selection_context:
            parts.append(f"USER_SELECTION_CONTEXT:\n{selection_context}")

        user_text = "\n\n".join(parts)

        contents: list[Any] = [types.Part.from_text(text=SYSTEM_INSTRUCTION)]
        if image_bytes and mime_type:
            contents.append(types.Part.from_bytes(data=image_bytes, mime_type=mime_type))
        contents.append(types.Part.from_text(text=user_text))

        def _call_stream():
            return self.client.models.generate_content_stream(
                model=self.model,
                contents=contents,
                config=types.GenerateContentConfig(temperature=0.0),
            )

        # Retry logic for the initial connection
        response_stream = None
        last_exc: Exception | None = None
        for attempt in range(self.MAX_RETRIES):
            try:
                response_stream = await asyncio.to_thread(_call_stream)
                break
            except Exception as exc:
                last_exc = exc
                await asyncio.sleep(2 ** attempt)
        
        if not response_stream:
            raise RuntimeError(f"[codegen_stream] failed after {self.MAX_RETRIES} attempts: {last_exc}")

        for chunk in response_stream:
            if chunk.text:
                yield chunk.text

    def edit_script(
        self,
        prompt: str,
        current_code: str,
        target_point: list[float] | None = None,
    ) -> str:
        """
        Surgically edit an existing OpenSCAD script based on a user prompt.
        """
        user_prompt = prompt
        if target_point and len(target_point) == 3:
            x, y, z = target_point
            user_prompt += f"\n\n[System Context: The user clicked on the 3D mesh at absolute coordinates X: {x}, Y: {y}, Z: {z}. Use this exact spatial location as the origin/target for the requested modification.]"

        user_text = f"CURRENT_CODE:\n{current_code}\n\nUSER_REQUEST:\n{user_prompt}"

        contents = [
            types.Part.from_text(text=EDIT_SYSTEM_PROMPT),
            types.Part.from_text(text=user_text),
        ]

        def _call() -> Any:
            return self.client.models.generate_content(
                model=self.model,
                contents=contents,
                config=types.GenerateContentConfig(temperature=0.0),
            )

        raw = self._call_with_retry(_call, "edit")
        return self._normalize_script(raw)
