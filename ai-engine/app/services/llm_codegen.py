import json
import logging
import os
import re
import sys
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Iterator, Optional

try:
    from google import genai
    from google.genai import types
    GENAI_AVAILABLE = True
except ImportError:
    genai = None
    types = None
    GENAI_AVAILABLE = False

logger = logging.getLogger(__name__)

# ============================================================================
# SYSTEM PROMPTS & ENGINEERING CONTRACTS
# ============================================================================

CORE_INSTRUCTION = """
# CAD COPILOT V7: Principal Engineering Protocol
You are a Principal CAD Software Engineer. Your mission is 100% feature-perfect, mathematically robust `build123d` scripts.

## MANDATORY CONTRACT
1. **PARAMETERS**: Extract EVERY dimension, tolerance, and quantity into `PARAMETERS = { ... }`.
2. **FUNCTION**: `def build_model(params: dict) -> Part:` is the ONLY entry point.
3. **FEATURE PARITY**: Every dimension extracted from the blueprint MUST map to a feature.
4. **NO YAP**: Output ONLY the python code block inside ```python markers. No explanations or notes.
5. **LOOP INTEGRITY**: All segments in `BuildLine` MUST form a single, continuous, closed loop. No floating or extra segments.
6. **ANNOTATIONS (METADATA)**: You MUST return a tuple `(part.part, annotations)` at the end of the script. `annotations` is a dictionary mapping each parameter name to its 3D location for rendering overlay lines. Format: `{"PARAM_NAME": {"p1": [x, y, z], "p2": [x, y, z]}}`. Return `{}` if no annotations apply.

## DATA RULES (NO HALLUCINATIONS)
- **Shorthand Decoder**: Correctly interpret technical shorthand: `Nx` or `N Pls` means the feature occurs N times; `L x A°` is a chamfer of length L at angle A; `PCD` is a Pitch Circle Diameter for circular patterns.
- Units are **millimeters**. Use floats for all dimensional parameters.
- **Missing Dimensions on Axisymmetric Parts**: If a blueprint visually shows a stepped profile (like a base and a shaft) but omits diameters, you MUST guess distinct parameters (e.g., `BASE_DIA=15.0`, `SHAFT_DIA=10.0`) so the geometric steps match the visual shape. Do not simplify a stepped part into a single cylinder/cone.
- Merge parameters at the top of `build_model`: `params = {**PARAMETERS, **params}`.
- Keep parameters as **diameters**; use `d / 2` only at the point of use.
- Every script MUST start with `from build123d import *`.
- **FATAL ERROR PREVENTION (NO KEYWORDS IN ARCS)**: NEVER use keyword arguments like `start=`, `end=`, `p1=`, or `p2=` in ANY Arc function (`RadiusArc`, `TangentArc`, `ThreePointArc`). Pass points POSITIONALLY ONLY. (e.g., Use `RadiusArc(p1, p2, radius=R)`, NEVER `RadiusArc(start=p1, ...)`).
- **NO CADQUERY SYNTAX**: NEVER use `Workplane`, `show_object`, or CadQuery-style method chaining (e.g., `.rect().extrude()`). Use ONLY `build123d` builders (`BuildPart`, `BuildSketch`) and standalone functions like `extrude()`, `revolve()`, and `fillet()`.
- **POINT ACCESS (FATAL)**: NEVER use `.X` or `.Y` on points you defined manually as tuples (e.g., `p1 = (x, y)`). Tuples have no attributes. Use `p1[0]` for X and `p1[1]` for Y. You may ONLY use `.X` and `.Y` on properties returned by the engine (e.g., `line.end.X` or `part.center().Y`).
- **Parameter Consistency**: EVERY key accessed via `p["NAME"]` inside `build_model` MUST be defined in the `PARAMETERS` dictionary. Do not hallucinate missing parameters like `TOTAL_LENGTH` if you didn't define them in the header.

## GEOMETRY RULES (ROBUSTNESS)
### INTELLIGENT MODE SELECTION (CRITICAL)
- **Step 1: Identify Part Type**: Before coding, determine if the part is **REVOLVED** (Axisymmetric: shafts, pulleys, bushings) or **PRISMATIC** (Extruded: flat plates, linkages, brackets).
- **Step 2: Apply Axis Standard**:
    - For **REVOLVED** parts: Use the **X-AXIS** as the rotation centerline. Sketch the profile on `Plane.XY` and use `revolve(axis=Axis.X)`.
    - For **PRISMATIC** parts: Use the **Z-AXIS** as the extrusion direction. Sketch on `Plane.XY` and use `extrude(amount=THICKNESS)`.
- **NEVER** mix axes. If you start a part on the X-axis, every subsequent hole and cut MUST use X-axis coordinates.

### GLOBAL FORBIDDEN CODE (FATAL ERRORS)
- **NEVER** use `position=` in any shape constructor. Use `with Locations((x, y)):`.
- **NEVER** allow a profile to have a negative Y-coordinate in a revolved part (`Y >= 0` ALWAYS).
- **NEVER** use `Align.CENTER` on the Y-axis for a revolved part.
- **NEVER** use a `Rectangle` for an internal bore in a revolved part.
- **Arc Robustness**: For smooth transitions between diameters or features (like nose radii or spherical tips), you MUST use `TangentArc` instead of `RadiusArc`. `TangentArc` is mathematically robust and ensures C1 continuity.
- **Tangent Directions**: When using `TangentArc` on a lathe profile, the tangent at the end of a horizontal segment is `(1, 0)`.
- **Axisymmetry**: For all revolved parts (shafts, pins, bushings), always create a closed profile on `Plane.XY` and `revolve(axis=Axis.X)`. 
- **AXIS CROSSING (FATAL)**: NEVER allow any point in a revolved profile to have a negative Y-coordinate. All points MUST have `Y >= 0`. Crossing the X-axis will CRASH the math engine. 
- **NO RECTANGLE/CIRCLE FOR BORES**: You MUST NOT use `Rectangle` or `Circle` to create internal bores. You MUST trace the **upper half** (Y >= 0) of the bore profile using `BuildLine`. This is the ONLY safe way to ensure the profile does not cross the X-axis.
- **NO Y-CENTERING**: NEVER use `Align.CENTER` on the Y-axis for any revolved sketch. Use ONLY `Align.MIN` or explicit coordinates.
- **STRICT LATHE PROFILE RULE**: You MUST trace the outer boundary first! Start at `(0,0)`, then draw a vertical line UP the Y-axis to the starting radius `(0, START_DIA / 2)`. Then draw horizontal/vertical lines tracing the outer surface from left to right. Once you reach the total length `(TOTAL_LEN, END_DIA / 2)`, draw a vertical line DOWN to the X-axis `(TOTAL_LEN, 0)`. Finally, draw a horizontal line LEFT back to `(0,0)` to close the loop. 
- **STEPPED PROFILES**: You MUST draw vertical lines to transition between different diameters! NEVER draw a diagonal line from one diameter to another unless the blueprint explicitly shows a taper.
- **CRITICAL**: NEVER draw `Line((0,0), (L, 0))` as your first segment. You MUST go UP first.
- NEVER use Plane.XZ or Axis.Z for longitudinal parts.
- For milled parts, sketch on planar faces using `BuildSketch` and `extrude()`.
- **NOSE RADII & ROUNDED TOPS**: For rounded noses, draw the vertical wall or shaft to its end, then use `TangentArc` to curve from that point to the apex `(TOTAL_LENGTH, 0)` or top center.
- **SHOULDER GROOVES**: For features like `1.0 x 0.2 Dp`, draw a small notch into the outer profile at the specified height.
- **Internal Cavities & Hollow Bodies**: For core drills, sleeves, and tubes, you MUST identify the internal diameter (e.g., `Ø4.40` for a bore).
- **SECTION VIEW DIMENSIONS**: If a diameter is shown *inside* the part boundaries in a section view, it is an **INTERNAL diameter**. NEVER use it for the outer profile.
- **Centerline Datum**: Dimensions shown from a centerline (like keyway offsets or hole PCDs) MUST be treated as absolute coordinates from the `(0,0)` origin. NEVER calculate them as offsets from an outer edge unless the blueprint explicitly shows it that way.
- Always set `mode=Mode.SUBTRACT` for cut features and use `both=True` for through cuts.

## FEATURE PLACEMENT (SLOTS, HOLES, & KEYWAYS)
- **Radial Offsetting**: For any feature shown on the outer surface of a cylinder (like slots or keyways), you MUST anchor the sketch at the correct radius. Use `with PolarLocations(radius=MAJOR_DIA / 2, count=N):` or `with Locations((0, MAJOR_DIA / 2)):`. NEVER use `radius=0` for features that are not central bores.
- **Longitudinal Slots**: If a slot is shown in the side view with a length L and a starting position X, sketch on `Plane.YZ` at `X` and `extrude(amount=L)`.
- **Cutting Depth**: For slots on a surface, the `Rectangle` or `Circle` in the sketch should be positioned so that it intersects the surface. Use `mode=Mode.SUBTRACT`.

## CRITICAL OCP ERROR PREVENTION (ZERO-FAIL GEOMETRY)
- **Face Creation (IMPORTANT)**: Call `make_face()` ONLY when you have drawn a custom profile using `with BuildLine():`. 
- **SHAPE RULE**: If you are using primitive shapes (Circle, Rectangle, etc.), **NEVER** use `make_face()`. Shapes are already faces. Calling `make_face()` on them will CRASH the engine with a `ValueError: No objects to create a hull`.
- **Non-Intersection Rule**: Trace coordinates in a single continuous path (CW or CCW). NEVER cross or re-trace an existing segment.
- **Topological Filtering**: Wrap chamfers/fillets in `try...except: pass`. 

## PHASE-BASED CONSTRUCTION (STRICT ORDER)
1. `# Main Body`: Primary envelope (revolve/extrude).
2. `# Internal Cavities`: Counterbores, stepped bores, central pockets.
3. `# Hole Patterns`: PCDs, grids, slots, keyways (Mode.SUBTRACT).
4. `# Finishing`: Fillets and chamfers inside a `try...except` block.
""".strip()


SAFETY_INSTRUCTION = """
# TOPOLOGICAL SAFETY
- DIMS: Use `max(0.01, v)` for thin walls.
- BOOLEANS: Use (+, -, &) operators. Avoid `BuildPart` context unless required.
- TYPE: NEVER pass raw tuples where `Location` or `Vector` is expected.
""".strip()


SUMMARISATION_INSTRUCTION = """
## ARCHITECTURAL AUDIT - PRECISION ENGINEERING PROTOCOL
Analyze this blueprint as a Lead Mechanical Engineer. Your goal is a 100% accurate parameter map.

1. **DIAMETER DISCRIMINATION**: 
   - Identify the "Main Envelope" (the largest outer diameters).
   - Distinguish between "Shaft Diameter" and "Groove Bottom Diameter" (often shown as a diameter inside a groove).
   - If a diameter is shown as `øX` inside a groove, the Groove Depth = (Main Diameter - X) / 2.
2. **LONGITUDINAL DATUMS**:
   - Use the leftmost or largest face as the Primary Datum (X=0).
   - Capture all lengths from this origin. 
   - Note if a dimension is "Incremental" (between features) or "Absolute" (from datum).
3. **FEATURE SYNTESIS**:
   - Map every chamfer (`L x A°`) to its specific edge (e.g., "front face", "rear face", "shoulder").
   - Capture all radii (R) and map them to the specific internal or external corner.
4. **TOLERANCE CAPTURE**:
   - Capture the nominal value. If a tolerance is asymmetrical (e.g., +0.2/0), note it in the parameter description.

RULE: Output a structured list of PARAMETERS. Use descriptive names like `SHAFT_DIA`, `GROOVE_BOTTOM_DIA`, `HEAD_LEN`.
RULE: Verification check—do the sum of internal lengths equal the `TOTAL_LENGTH`?
""".strip()


FEW_SHOT_EXAMPLE = """
# EXAMPLE: Universal Master Component (Demonstrates all logic)
```python
from build123d import *

# 1. EXTRACT ALL DIMENSIONS FROM BLUEPRINT
PARAMETERS = {
    "MAJOR_DIA": 50.0,
    "MINOR_DIA": 40.0,
    "TOTAL_LEN": 60.0,
    "BORE_DIA": 20.0,
    "GROOVE_X": 15.0,
    "GROOVE_WIDTH": 5.0,
    "GROOVE_DEPTH": 2.5,
    "PCD": 35.0,
    "HOLE_DIA": 6.0,
    "HOLE_COUNT": 4,
}

def build_model(params: dict) -> tuple[Part, dict]:
    p = {**PARAMETERS, **params}
    
    with BuildPart() as part:
        # FEATURE 1: Primary Envelope (Lathe or Extrude)
        with BuildSketch(Plane.XY):
            with BuildLine():
                l1 = Line((0, 0), (0, p["MAJOR_DIA"] / 2))
                l2 = Line(l1.end, (p["TOTAL_LEN"], p["MINOR_DIA"] / 2)) # Taper
                l3 = Line(l2.end, (p["TOTAL_LEN"], 0))
                Line(l3.end, (0, 0))
            make_face()
        revolve(axis=Axis.X)
        
        # FEATURE 2: Internal Cavities (Subtractive)
        with BuildSketch(Plane.XY):
            with BuildLine():
                b1 = Line((0, 0), (0, p["BORE_DIA"] / 2))
                b2 = Line(b1.end, (p["TOTAL_LEN"], p["BORE_DIA"] / 2))
                b3 = Line(b2.end, (p["TOTAL_LEN"], 0))
                Line(b3.end, (0, 0))
            make_face()
        revolve(axis=Axis.X, mode=Mode.SUBTRACT)

        # FEATURE 3: Notches/Grooves (Parametric Subtraction)
        with BuildSketch(Plane.XY):
            with Locations((p["GROOVE_X"], p["MINOR_DIA"] / 2)):
                Rectangle(p["GROOVE_WIDTH"], p["GROOVE_DEPTH"] * 2, align=(Align.CENTER, Align.CENTER))
        revolve(axis=Axis.X, mode=Mode.SUBTRACT)
        
    # DYNAMIC ANNOTATIONS: Create an entry for EVERY physical dimension in PARAMETERS
    annotations = {
        "PARAM_NAME_1": {"p1": [0, -p["PARAM_NAME_1"]/2, 0], "p2": [0, p["PARAM_NAME_1"]/2, 0]},
        "PARAM_NAME_2": {"p1": [0, 0, 0], "p2": [p["PARAM_NAME_2"], 0, 0]},
        # Repeat for ALL extracted parameters (diameters, lengths, offsets)
    }

    return part.part, annotations
```
"""

# ============================================================================
# REGULAR EXPRESSION PATTERNS
# ============================================================================

CODE_BLOCK_RE = re.compile(r"```(?:python|py)?\s*(.*?)```", re.IGNORECASE | re.DOTALL)
LIKELY_CODE_START_RE = re.compile(
    r"(?m)^(?:from\s+\w+\s+import\s+|import\s+\w+|PARAMETERS\s*=|def\s+build_model\s*\(|def\s+\w+\s*\(|class\s+\w+\s*\(|@|\w+\s*=)"
)

# ============================================================================
# LLM CODEGEN SERVICE
# ============================================================================

class LLMCodegenService:
    """AI-powered CAD script generation service."""

    def __init__(self, model: Optional[str] = None) -> None:
        if not GENAI_AVAILABLE or genai is None or types is None:
            raise RuntimeError("google-genai is not installed. Check dependencies.")

        self._load_env_file()
        api_key = os.getenv("GOOGLE_API_KEY")
        if not api_key:
            raise RuntimeError("GOOGLE_API_KEY is not set.")

        self.client = genai.Client(api_key=api_key)
        self.model = model or os.getenv("GENAI_MODEL", "gemini-3.1-flash-lite")
        self.summary_model = os.getenv("GENAI_SUMMARY_MODEL", self.model)

        self.max_retries = max(1, int(os.getenv("GENAI_MAX_RETRIES", "5")))
        self.max_prompt_tokens = int(os.getenv("MAX_PROMPT_TOKENS", "12000"))
        self.max_output_tokens = int(os.getenv("MAX_OUTPUT_TOKENS", "4096"))
        self.include_safety = os.getenv("GENAI_SAFETY", "0") == "1"
        self.include_example = os.getenv("GENAI_INCLUDE_EXAMPLE", "1") == "1"

        self.summary_max_retries = max(1, int(os.getenv("GENAI_SUMMARY_MAX_RETRIES", "3")))
        self.summary_retry_base_delay_seconds = float(
            os.getenv("GENAI_SUMMARY_RETRY_BASE_DELAY", "1.5")
        )
        self.retry_base_delay_seconds = float(os.getenv("GENAI_RETRY_BASE_DELAY", "1.5"))
        self.max_retry_delay_seconds = float(os.getenv("GENAI_MAX_RETRY_DELAY", "60"))

    @staticmethod
    def _load_env_file() -> None:
        try:
            import importlib

            dotenv = importlib.import_module("dotenv")
            project_root = Path(__file__).resolve().parents[2]
            dotenv.load_dotenv(project_root / ".env")
        except Exception:
            return

    def _prepare_full_instruction(self) -> str:
        instructions = [CORE_INSTRUCTION]
        if self.include_safety:
            instructions.append(SAFETY_INSTRUCTION)
        if self.include_example:
            instructions.append(FEW_SHOT_EXAMPLE)
        return "\n\n".join(instructions)

    def summarise_blueprint(self, image_bytes: bytes, image_mime_type: str) -> str:
        if types is None:
            raise RuntimeError("google-genai is not installed. Check dependencies.")

        parts = [
            types.Part.from_text(text=SUMMARISATION_INSTRUCTION),
            types.Part.from_bytes(data=image_bytes, mime_type=image_mime_type),
        ]

        last_exception: Optional[Exception] = None
        for attempt in range(1, self.summary_max_retries + 1):
            try:
                response = self.client.models.generate_content(
                    model=self.summary_model,
                    contents=parts,
                    config=types.GenerateContentConfig(
                        temperature=0.0,
                        max_output_tokens=1024,
                    ),
                )
                return response.text or ""
            except Exception as exc:
                last_exception = exc
                if attempt >= self.summary_max_retries or not self._is_retryable_error(exc):
                    break
                backoff_delay = self.summary_retry_base_delay_seconds * (2 ** (attempt - 1))
                delay = min(backoff_delay, self.max_retry_delay_seconds)
                logger.info(f"Retrying summary call in {delay}s due to: {exc}")
                time.sleep(delay)

        logger.warning(
            f"Summarisation stage failed, proceeding without summary: {last_exception}"
        )
        return ""

    def stream_build123d_script(
        self,
        prompt: str,
        image_bytes: bytes,
        image_mime_type: str,
        summary: Optional[str] = None,
    ) -> Iterator[str]:
        if types is None:
            raise RuntimeError("google-genai is not installed. Check dependencies.")

        full_system_instruction = self._prepare_full_instruction()
        context_block = f"\n\n### BLUEPRINT ANALYSIS SUMMARY\n{summary}\n" if summary else ""
        user_prompt = f"CAD request: {prompt.strip()}{context_block}"

        try:
            token_count_response = self.client.models.count_tokens(
                model=self.model,
                contents=[
                    full_system_instruction,
                    user_prompt,
                    types.Part.from_bytes(data=image_bytes, mime_type=image_mime_type),
                ],
            )
            total_tokens = token_count_response.total_tokens
            if total_tokens is None:
                total_tokens = 0
            if total_tokens > self.max_prompt_tokens:
                raise RuntimeError(
                    f"Prompt is too large ({total_tokens} tokens). Max budget is {self.max_prompt_tokens}."
                )
        except Exception as exc:
            if "Prompt is too large" in str(exc):
                raise

        content = types.Content(
            role="user",
            parts=[
                types.Part.from_text(text=user_prompt),
                types.Part.from_bytes(data=image_bytes, mime_type=image_mime_type),
            ],
        )

        config = types.GenerateContentConfig(
            system_instruction=full_system_instruction,
            candidate_count=1,
            max_output_tokens=self.max_output_tokens,
            temperature=0.0,
            safety_settings=[],
        )

        seen_errors: list[str] = []
        last_exception: Optional[Exception] = None
        raw_output_chunks: list[str] = []

        for attempt in range(1, self.max_retries + 1):
            try:
                yielded_any = False
                stream = self.client.models.generate_content_stream(
                    model=self.model,
                    contents=[content],
                    config=config,
                )

                for chunk in stream:
                    text = getattr(chunk, "text", "")
                    if text:
                        yielded_any = True
                        raw_output_chunks.append(text)
                        yield text

                if not yielded_any:
                    raise RuntimeError("Empty response from generate_content_stream")

                self._log_diagnostic(prompt, "".join(raw_output_chunks), None)
                return
            except Exception as exc:
                last_exception = exc
                error_text = str(exc)
                retry_after_seconds = self._extract_retry_delay_seconds(error_text)
                seen_errors.append(error_text)

                if attempt >= self.max_retries or not self._is_retryable_error(exc):
                    break

                backoff_delay = self.retry_base_delay_seconds * (2 ** (attempt - 1))
                delay = max(backoff_delay, retry_after_seconds or 0.0)
                delay = min(delay, self.max_retry_delay_seconds)
                time.sleep(delay)

        self._log_diagnostic(
            prompt,
            "".join(raw_output_chunks),
            str(last_exception) if last_exception else "Max retries exceeded",
        )

        joined_errors = "\n".join(seen_errors)
        if self._is_daily_quota_error(joined_errors):
            raise RuntimeError(
                "Model daily quota reached. Try again after quota reset or switch models."
            )

        if last_exception and self._is_quota_error(last_exception):
            raise RuntimeError(
                "Model quota is temporarily exhausted. Please retry in a few minutes."
            )

        if last_exception and self._is_transient_error(last_exception):
            raise RuntimeError(
                "Model is temporarily unavailable. Please retry shortly."
            )

        raise RuntimeError("Unable to generate CAD script right now. Please retry.")

    def _log_diagnostic(self, prompt: str, raw_output: str, error: Optional[str]) -> None:
        try:
            log_dir = Path(__file__).resolve().parents[2] / "logs"
            log_dir.mkdir(parents=True, exist_ok=True)
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            log_id = uuid.uuid4().hex[:8]
            log_file = log_dir / f"cad_gen_{timestamp}_{log_id}.json"

            log_data = {
                "timestamp": datetime.now().isoformat(),
                "model": self.model,
                "prompt": prompt,
                "raw_output": raw_output,
                "cleaned_output": self.normalize_script(raw_output) if raw_output else "",
                "error": error,
            }

            with open(log_file, "w", encoding="utf-8") as f:
                json.dump(log_data, f, indent=2)
        except Exception as exc:
            logger.error(f"Failed to write diagnostic log: {exc}")

    @staticmethod
    def _is_retryable_error(exc: Exception) -> bool:
        return LLMCodegenService._is_transient_error(exc) or LLMCodegenService._is_quota_error(exc)

    @staticmethod
    def _is_transient_error(exc: Exception) -> bool:
        message = str(exc).lower()
        transient_markers = (
            "503",
            "unavailable",
            "high demand",
            "deadline_exceeded",
            "timed out",
            "temporar",
            "try again later",
        )

        if any(marker in message for marker in transient_markers):
            return True

        status_code = getattr(exc, "status_code", None)
        if status_code in {408, 429, 500, 502, 503, 504}:
            return True

        return False

    @staticmethod
    def _is_quota_error(exc: Exception) -> bool:
        message = str(exc).lower()
        quota_markers = (
            "429",
            "resource_exhausted",
            "quota exceeded",
            "rate limit",
            "free_tier_requests",
        )
        return any(marker in message for marker in quota_markers)

    @staticmethod
    def _is_daily_quota_error(message: str) -> bool:
        normalized = message.lower()
        daily_markers = (
            "generaterequestsperday",
            "perday",
            "per day",
            "requests per day",
        )
        return any(marker in normalized for marker in daily_markers)

    @staticmethod
    def _extract_retry_delay_seconds(message: str) -> Optional[float]:
        patterns = (
            r"retry in\s+([0-9]+(?:\.[0-9]+)?)s",
            r"'retryDelay'\s*:\s*'([0-9]+(?:\.[0-9]+)?)s'",
            r'"retryDelay"\s*:\s*"([0-9]+(?:\.[0-9]+)?)s"',
        )

        for pattern in patterns:
            match = re.search(pattern, message, re.IGNORECASE)
            if match:
                try:
                    return float(match.group(1))
                except ValueError:
                    return None

        return None

    @staticmethod
    def normalize_script(script: str) -> str:
        if not script:
            return ""

        # Try to find all code blocks
        block_matches = CODE_BLOCK_RE.findall(script)
        candidates = [m.strip() for m in block_matches if m.strip()]

        # If no clean blocks, or blocks seem truncated, try a more aggressive split
        # in case the model "restarted" (e.g. ```python ... ```python ...)
        if not candidates or not any("build_model" in c for c in candidates):
            # Split by any triple-backtick and treat segments as candidates
            parts = re.split(r"```(?:python|py)?\s*", script)
            candidates.extend([p.strip() for p in parts if p.strip()])

        if candidates:
            # Prioritize candidates that satisfy our contract
            contract_matches = [
                c for c in candidates 
                if "PARAMETERS" in c and "build_model" in c
            ]
            if contract_matches:
                # Return the longest one that matches the contract (usually the most complete one)
                return max(contract_matches, key=len)
            
            # Fallback to the longest candidate overall
            return max(candidates, key=len)

        # Final fallback: strip all markers and find start
        cleaned = script.strip().strip("`").strip()
        cleaned = cleaned.replace("```python", "").replace("```py", "").replace("```", "").strip()

        start_match = LIKELY_CODE_START_RE.search(cleaned)
        if start_match:
            cleaned = cleaned[start_match.start():].lstrip()

        return cleaned