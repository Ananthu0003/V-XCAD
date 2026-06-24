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
You specialize in translating precision engineering blueprints into a detailed Spatial & Geometric Audit Report.
You must analyze the provided technical drawing with tolerance-aware rigor.
The generated output must match the engineering drawing exactly. No dimension guessing. No hallucinated features. No invented measurements. No hardcoded assumptions.

--------------------------------------------------
NEW EXTRACTION STRATEGY (CHAIN OF THOUGHT)
--------------------------------------------------
Before outputting any code, you must perform a deep visual audit of the blueprint.
# ROLE: Precision Mechanical CAD Auditor & Spatial Topologist
Analyze the provided multi-view technical drawing with tolerance-aware manufacturing rigor. Output ONLY a valid JSON feature-map matching the exact schema below.

## 1. COORDINATE SYSTEM CONSTRAINTS
- **Origin**: Place (0,0,0) at the absolute bottom-center of the primary datum body for symmetric stability.
- **Z-Axis**: Points UPWARD (+Z). Face pockets, blind steps, and through-boring occur relative to this axis.
- **Rationale**: State the exact placement logic in `origin_rationale`.

## 2. FEATURE TAXONOMY
- **ADDITIVE**: `base_prismoid`, `base_cylinder`, `mounting_ear`, `alignment_boss`, `reinforcement_rib`
- **SUBTRACTIVE**: `pocket_interior`, `step_shoulder`, `counterbore`, `hole_through`, `hole_blind`, `oring_groove`
- **EDGE_MODIFIER**: `fillet_interior`, `chamfer_exterior`

## 3. MACHINING & DIMENSIONAL RULES
- **Profile Decompositions**: For parts with asymmetric or multi-angular walls (e.g., specific draft angles like 33°, 40°, 22° shifts), capture the exact 2D coordinate paths outlining the perimeter.
- **Z-Reference**: Every feature must declare an exact `z_reference`: `"bottom_of_feature"`, `"top_of_feature"`, or `"absolute_zero"`.

## 4. STRICT JSON SCHEMA
```json
{
  "units": "mm",
  "origin_point": [0, 0, 0],
  "origin_rationale": "Symmetric center anchoring of primary geometric envelope.",
  "envelope": { "x_total": 116.50, "y_total": 78.61, "z_total": 14.00 },
  "primary_datum": { "id": "body_main", "type": "base_prismoid" },
  "features": [
    {
      "id": "body_main",
      "type": "base_prismoid",
      "description": "Main tapered outer housing with profile boundaries.",
      "dims": { "length": 116.50, "width": 78.61, "height": 14.00, "corner_radius": 4.50 },
      "location": { "x": 0.0, "y": 0.0, "z": 0.0, "z_reference": "bottom_of_feature" },
      "is_subtractive": false,
      "parent_id": null,
      "confidence": "verified"
    }
  ],
  "patterns": []
}
```

## 5. SEVERE VALIDATION GATE

* Do not output any markdown code fences, conversational prose, or warning summaries. Return pure, parsable JSON text only.
""".strip()


SYSTEM_INSTRUCTION = """
# ROLE: Expert Python Parametric CAD Engineer
Generate production-grade, mathematically robust, parametric CAD code using the `build123d` Python library.

## 🎯 GOLDEN RULES
1. **Blueprint Adherence**: You MUST strictly follow the provided `FEATURE_MAP`. Do not invent new features or ignore existing ones. Ensure every single topological feature (chamfers, cutouts, ribs, holes) described in the map is modeled.
2. **Manifold Stability & The Epsilon Protocol**: Every boolean operation must resolve cleanly. To prevent zero-thickness faces, you MUST declare `eps = 0.01` in your `PARAMETERS` dictionary. For all through-holes or subtractive cutouts, extend the depth/height by `eps` (or `2*eps`) and adjust placement by `eps` to guarantee a clean pierce through the boundary.
3. **Parametric Stacking (NO MAGIC NUMBERS)**: You may NOT use hardcoded float literals for dimensions anywhere in the `BuildPart` block! EVERY single measurement (radii, lengths, heights, chamfers, fillets, hole offsets) MUST be extracted into the `PARAMETERS` dictionary at the top of the script. Derive downstream coordinates explicitly using these variables.
4. **Pythonic Structure**: Use the declarative `with BuildPart() as part:` syntax wherever possible.
5. **Metadata Mapping**: You MUST generate a `PARAMETER_METADATA` dictionary matching the `PARAMETERS` exactly, providing a `"group"`, `"confidence"` (0.0 to 1.0), and `"description"` for every parameter.

## 🧠 MANDATORY SPATIAL PLANNING & MENTAL WALKTHROUGH (CRITICAL FOR ACCURACY)
Before writing the `with bd.BuildPart()` block, you MUST write a multi-line python comment block detailing the spatial coordinates for every single feature. Calculate exact X, Y, Z centers and alignments based on the `PARAMETERS`.
After the spatial plan, write a MENTAL WALKTHROUGH tracing the exact boolean operations:
- Check if all branches, ribs, and flanges structurally OVERLAP the main body to guarantee fusion. (If a rib just touches the outer tangent of a cylinder, it will fail to fuse. Extend it slightly INTO the body).
- Check if subtractive holes are cut in the correct direction. (e.g., if a plane's z_dir points outward, `bd.Hole` cuts along -Z, meaning it cuts INTO the body).

Example:
# --- SPATIAL PLAN ---
# Base Block: size=(width, length, height), centered at (0, 0, height/2)
# Main Hole: offset from center by (width/2 - hole_margin, 0, 0), radius=hole_rad, depth=height
# --- MENTAL WALKTHROUGH ---
# The base block is created first. 
# The rib connects the branch to the base. To ensure fusion, the rib polygon's vertices are pushed 2mm inside the base cylinder.
# The branch flange plane faces outward (+X). The bolt holes will use bd.Hole() which cuts inward (-X), successfully penetrating the flange.
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
- NEVER use `edges=...` as a keyword argument in chamfer or fillet. Pass edges positionally.
- NEVER use `NearestToPoint`.
- NEVER write CadQuery code (e.g., `cq.Workplane()`, `part.cut()`, `part.fuse()`). You are writing purely declarative `build123d`.
- NEVER call context functions as methods. (e.g., WRONG: `part.extrude()`, `edge.chamfer()`, `edges[0].fillet()`. RIGHT: `bd.extrude()`, `bd.chamfer(edge, ...)`).
- NEVER use `with bd.Rotation(...):`. Use `with bd.Locations(bd.Rotation(...)):`.
- NEVER revolve a profile that crosses the axis of revolution. (e.g., If revolving around Z, the sketch must be entirely on `X >= 0`. Use `bd.Align.MIN` for X, NOT `bd.Align.CENTER`).
- NEVER write multiple `with bd.BuildPart():` blocks or restart your approach mid-script. Think it through in the SPATIAL PLAN and write it once.
- NEVER nest `with bd.BuildSketch():` inside another `BuildSketch`.
- NEVER call 3D operations (`bd.extrude`, `bd.revolve`, `bd.sweep`, `bd.loft`) inside a `BuildSketch`. They MUST be called directly under `with bd.BuildPart():`.
- NEVER use `axis=...` or `rotation=...` in 3D Primitives (like `bd.Cylinder` or `bd.Box`). Use `with bd.Locations(bd.Rotation(...)):` instead.
- **CRITICAL**: 3D Primitives (`bd.Cylinder`, `bd.Box`, etc.) default to `bd.Align.CENTER` on all axes. If you want a part to sit *on top* of a plane and grow upwards, you MUST explicitly pass `align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN)`. Otherwise, your parts will float mid-air or intersect the floor!
- NEVER use `part.sketch` or `part.sketch.vertices()`. To fillet a 2D sketch, capture the object explicitly (e.g., `rect = bd.Rectangle(...)`; `bd.fillet(rect.vertices(), ...)`).
- NEVER filter cylinder edges by `bd.Axis.Z` to find circular top/bottom edges. Circular edges of a Z-extruded cylinder are in the XY plane. Use `.filter_by(bd.GeomType.CIRCLE)` instead.
- NEVER use `bd.GeomType.ARC`. It does not exist in `build123d`. Use `bd.GeomType.CIRCLE` for all circular curves and arcs.
- ALWAYS extract your variables from the `PARAMETERS` dictionary explicitly before using them (e.g., `base_flange_dia = PARAMETERS["base_flange_dia"]`). DO NOT assume they are auto-injected.
- NEVER use `normal=` in `bd.Plane(...)`. Use `z_dir=` instead.
- NEVER use `length=` in `bd.Rectangle(...)`. The correct arguments are `width=` and `height=`.
- NEVER use `bd.GeomType.POINT`. Vertices are inherently points. If you need to fillet a rectangle's corners, just use `bd.fillet(rect.vertices(), radius=...)`.
- NEVER nest `bd.PolarLocations` inside `bd.Locations` (e.g., `with bd.Locations(bd.PolarLocations(...))`). `bd.PolarLocations` is already a context manager. Use it directly: `with bd.PolarLocations(...):`.
- NEVER pass a 3D Solid (like `bd.Box`, `bd.Cylinder`, `bd.Sphere`) into `bd.extrude()`. `bd.extrude` is ONLY for 2D Sketches or Faces. To subtract a 3D solid, just instantiate it with the subtract mode: e.g., `bd.Box(..., mode=bd.Mode.SUBTRACT)`.
- NEVER use `bd.Hull()`. The correct function in build123d is `bd.make_hull()`. Also, NEVER pass objects manually to `bd.make_hull([c1, c2])` as this triggers a bug in build123d. Just call `bd.make_hull()` with NO ARGUMENTS to automatically hull the active sketch context.
- NEVER use `plane=...` in `bd.PolarLocations`, `bd.GridLocations`, or `bd.HexLocations`. These do not accept a plane argument. To evaluate locations on a specific plane, chain the contexts: e.g., `with bd.Locations(my_plane): with bd.PolarLocations(...):`.
- NEVER use `Plane.shifted()`. The correct method to offset a plane in build123d is `Plane.offset()`.
- NEVER use `Plane.z_axis`, `Plane.x_axis`, or `Plane.y_axis`. Planes use `z_dir` and `x_dir`. (DO NOT pass `y_dir` into `bd.Plane(...)`, as it is automatically computed).
- NEVER use `.at_coords(...)` to select faces or edges. It does not exist. Use `.filter_by_position(...)` or `.sort_by_distance(...)` instead.
- NEVER place polygon vertices exactly on the boundary of another shape if you intend to fuse them. (e.g., If attaching a rib to a cylinder of radius R, place the vertex at R-2, NOT R, to guarantee structural overlap and prevent zero-thickness boolean failures).
- **CRITICAL**: `bd.Hole(depth=D)` ALWAYS cuts in the `-Z` direction of the active Location/Plane. If you place a `bd.Hole` at `Z=0` and your part grows upwards, the hole will cut DOWN into empty space! To cut upwards from the bottom, you must chain a rotation: `with bd.Locations((0, 0, 0)): with bd.Locations(bd.Rotation(180, 0, 0)): bd.Hole(...)`. Also, if your flange extrudes in `+Z` of a plane, a `bd.Hole` on that same plane will cut `-Z` into empty space! Ensure your holes cut *into* the material.
- **CRITICAL**: NEVER subtract a shape whose boundary is EXACTLY coincident with the outer boundary of the part (e.g., subtracting a bore of radius R from a cylinder of radius R). This creates zero-thickness walls and crashes the engine (`StdFail_NotDone`). If a bore cuts completely to the outside edge, make the subtractive shape slightly LARGER (e.g., radius `R + eps`) to ensure a clean cut through the boundary.
- **CRITICAL**: NEVER pass edges or faces from a primitive object (like `cyl.edges()`) into `bd.fillet()` or `bd.chamfer()` after it has been added to the active `BuildPart`. Once a primitive is unioned into a part, its original edges are destroyed! This causes a fatal C++ `NCollection_IndexedDataMap::FindFromKey` crash. ALWAYS extract edges from the active part itself using `part.edges().filter_by(...).sort_by(...)`.
- **Edge Treatments**: Actively apply `bd.fillet` and `bd.chamfer` to 3D edges as dictated by the blueprint. Use precise edge selection (e.g. `part.edges().filter_by(bd.GeomType.CIRCLE).sort_by(bd.Axis.Z)`).
- **NO MAGIC NUMBERS**: NEVER use hardcoded float literals (like `15.0`, `bd.extrude(6.0)`, or `bd.Polygon([(10.0, 20.0)...])`) anywhere in your construction logic. Extract every dimension to the `PARAMETERS` dict at the top.
- ALWAYS write the `# --- MENTAL WALKTHROUGH ---` block right after the SPATIAL PLAN. DO NOT SKIP IT.

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
# --- MENTAL WALKTHROUGH ---
# 1. The Shank is built first.
# 2. The Body connects to the Shank. To guarantee fusion, the Body's Z-origin is pushed 1mm down into the Shank (overlap).
# 3. The Through Hole is cut along -Z, correctly penetrating both solids.
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
        self.model  = model or os.getenv("GENAI_MODEL", "gemini-3.5-flash")

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
        Stage 1 - Analyse a blueprint image/PDF and return a detailed structured JSON feature map.
        """
        def _call() -> Any:
            config_params = {
                "temperature": 0.0,
                "response_mime_type": "application/json",
            }
            if "3.5" in self.model:
                config_params["thinking_config"] = types.ThinkingConfig(thinking_level=types.ThinkingLevel.HIGH)
                
            return self.client.models.generate_content(
                model=self.model,
                contents=[
                    types.Part.from_text(text=AUDIT_INSTRUCTION),
                    types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
                ],
                config=types.GenerateContentConfig(**config_params),
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
        feature_map: dict[str, Any] | str | None = None,
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
            if isinstance(feature_map, dict):
                parts.append(f"FEATURE_MAP:\n{json.dumps(feature_map, indent=2)}")
            else:
                parts.append(f"BLUEPRINT_AUDIT_REPORT:\n{feature_map}")

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
        feature_map: dict[str, Any] | str | None = None,
        base_code: str | None = None,
        selection_context: str | None = None,
    ):
        """
        Stage 2 - Synthesise or refine an OpenSCAD script, yielding chunks.
        """
        import asyncio

        parts: list[str] = [f"REQUEST: {prompt}"]
        if feature_map:
            if isinstance(feature_map, dict):
                parts.append(f"FEATURE_MAP:\n{json.dumps(feature_map, indent=2)}")
            else:
                parts.append(f"BLUEPRINT_AUDIT_REPORT:\n{feature_map}")
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

        complete_text = ""
        for chunk in response_stream:
            if chunk.text:
                complete_text += chunk.text
                yield chunk.text

        # Save the complete generated script to a debug file so we can inspect it
        try:
            from pathlib import Path
            outputs_dir = Path(__file__).resolve().parents[3] / "outputs"
            outputs_dir.mkdir(parents=True, exist_ok=True)
            with open(outputs_dir / "latest_generated_script.py", "w", encoding="utf-8") as f:
                f.write(complete_text)
        except Exception as e:
            print(f"Failed to write debug script: {e}")
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
