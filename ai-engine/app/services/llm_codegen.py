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
1. **PARAMETERS**: Extract EVERY dimension, tolerance, and quantity into `PARAMETERS = { ... }`. Transcribe dimensions EXACTLY as they appear on the blueprint. Do NOT round values (e.g., if it says 12.05, use 12.05).
2. **FUNCTION**: `def build_model(params: dict) -> Part:` is the ONLY entry point.
3. **FEATURE PARITY**: Every dimension extracted from the blueprint MUST map to a feature.
4. **NO YAP**: Output ONLY the python code block inside ```python markers. No explanations or notes.
5. **LOOP INTEGRITY**: All segments in `BuildLine` MUST form a single, continuous, closed loop. No floating or extra segments.
6. **ANNOTATIONS (METADATA)**: You MUST return a tuple `(part.part, annotations)` at the end of the script. `annotations` is a dictionary mapping each parameter name to its 3D location for rendering overlay lines. Format: `{"PARAM_NAME": {"p1": [x, y, z], "p2": [x, y, z]}}`. Return `{}` if no annotations apply.

## DATA RULES (NO HALLUCINATIONS)
- **Shorthand Decoder**: Correctly interpret technical shorthand: `Nx` or `N Pls` means the feature occurs N times; `L x A°` is a chamfer of length L at angle A; `PCD` is a Pitch Circle Diameter for circular patterns.
- Units are **millimeters**. Use floats for all dimensional parameters.
- **Multi-View Integration**: Extract parameters from all views including detail callouts (Detail A, Detail B...) and section cuts (Section A-A, E-E...). In your parameter description, explicitly write which view/detail the parameter was extracted from (e.g. `[Detail C]` or `[Section A-A]`).
- **Detail Scale Safety**: Detail callouts are often magnified for readability (e.g. Scale 3:1 or 5:1). The physical dimensions annotated on them are 1:1 real-world values in millimeters. DO NOT apply visual scaling or multiply parameters by the detail magnification!
- **Coordinate Datum Registration**: Map all sub-view local coordinates (like hole locations in Section A-A or Detail C) back to the global origin of the coordinate standard chosen. Do NOT construct disjointed bodies unless their positions are mathematically registered relative to the main origin.
- **Missing Dimensions on Axisymmetric Parts**: If a blueprint visually shows a stepped profile (like a base and a shaft) but omits diameters, you MUST guess distinct parameters (e.g., `BASE_DIA=15.0`, `SHAFT_DIA=10.0`) so the geometric steps match the visual shape. Do not simplify a stepped part into a single cylinder/cone.
- **Micro-Feature & Visual Parity (Edge Breaks & Torus Prevention)**: Technical deburring or tolerance specs like `C0.15max` or `R0.15max` are manufacturing limits, NOT structural CAD features. On microscopic or small parts (e.g., total diameter or height under 10mm), applying these relatively large fillets/chamfers (like 0.15mm on a 0.3mm flange) will consume the flat faces, turning the step into a bulbous torus block. To maintain 100% visual parity with the blueprint's flat-faced intent, you MUST reduce these deburring fillets/chamfers to a microscopic scale (e.g., `0.02mm`) or omit them entirely. This keeps the functional shoulders sharp, clean, and flat as visually drawn.
- Merge parameters at the top of `build_model`: `params = {**PARAMETERS, **params}`.
- Keep parameters as **diameters**; use `d / 2` only at the point of use.
- Every script MUST start with `from build123d import *`.
- **FATAL ERROR PREVENTION (NO KEYWORDS IN ARCS)**: NEVER use keyword arguments like `start=`, `end=`, `p1=`, or `p2=` in ANY Arc function (`RadiusArc`, `TangentArc`, `ThreePointArc`). Pass points POSITIONALLY ONLY. (e.g., Use `RadiusArc(p1, p2, radius=R)`, NEVER `RadiusArc(start=p1, ...)`).
- **NO CADQUERY & FORBIDDEN BOOLEAN SYNTAX (FATAL)**: NEVER use `Workplane`, `show_object`, or CadQuery-style method chaining (e.g., `.rect().extrude()`). 
  1. NEVER use the non-existent function `union()`, `part.union()`, or `fuse()`. In `build123d`, union is performed automatically (implicit addition) within the builder contexts (`BuildPart`, `BuildSketch`), or explicitly using the operator `+` (e.g., `combined = part1 + part2`).
  2. Use ONLY `build123d` builders and standalone functions like `extrude()`, `revolve()`, and `fillet()`.
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
- **SECTION VIEW DIMENSIONS (INTERNAL BORES)**: If a dimension is shown *inside* or spanning the internal boundaries in a section view (like `4.40 (Wire cut)` or `5.20 Bore`), it is an **INTERNAL BORE DIAMETER**, even if the diameter symbol `Ø` is missing!
  1. NEVER interpret these internal horizontal dimensions as depths or linear lengths.
  2. NEVER use the outer shaft diameter (e.g., `Ø8.00`) for the subtractive internal bore, as that will hollow out the walls to zero thickness, destroying the model. Always use the specified internal dimension (e.g., `4.40`) as the bore diameter, and the vertical offset (e.g., `3.0`) as the depth.
- **Centerline Datum**: Dimensions shown from a centerline (like keyway offsets or hole PCDs) MUST be treated as absolute coordinates from the `(0,0)` origin. NEVER calculate them as offsets from an outer edge unless the blueprint explicitly shows it that way.
- Always set `mode=Mode.SUBTRACT` for cut features and use `both=True` for through cuts.

## FEATURE PLACEMENT (SLOTS, HOLES, & KEYWAYS)
- **Radial Offsetting**: For any feature shown on the outer surface of a cylinder (like slots or keyways), you MUST anchor the sketch at the correct radius. Use `with PolarLocations(radius=MAJOR_DIA / 2, count=N):` or `with Locations((0, MAJOR_DIA / 2)):`. NEVER use `radius=0` for features that are not central bores.
- **Longitudinal Slots**: If a slot is shown in the side view with a length L and a starting position X, sketch on `Plane.YZ` at `X` and `extrude(amount=L)`.
- **Cutting Depth**: For slots on a surface, the `Rectangle` or `Circle` in the sketch should be positioned so that it intersects the surface. Use `mode=Mode.SUBTRACT`.
- **Keyways & Internal Notches (Always Subtractive)**: Any keyway, slot, or notch that is dimensioned relative to an internal bore or hole (e.g. `6.00` wide, `3.67` depth next to `R7.05` bore) is **100% SUBTRACTIVE**.
  1. NEVER add keyways as positive extrusions or protrusions in the main body sketch.
  2. **Horizontal/Vertical Orientation**: Carefully read which side of the bore the keyway is located on:
     - If it is on the left side of the bore, its coordinates are negative along the X-axis (`X < 0`), centered on `Y = 0`.
     - If it is on the top side, it is positive along the Y-axis (`Y > 0`), centered on `X = 0`.
  3. **Collinear Math**: For a keyway of depth D and width W on the left of an internal bore of radius R: the back of the keyway is located at `X = -R - D`. You MUST draw a `Rectangle(R + D, W, align=(Align.MAX, Align.CENTER))` centered at the origin, and subtract it together with the bore circle, which perfectly cuts the notch!

## CRITICAL OCP ERROR PREVENTION (ZERO-FAIL GEOMETRY)
- **OpenCascade BRep_API Command Not Done (FATAL)**: To prevent `StdFail_NotDone` crashes during booleans and filleting:
  1. **Fillet & Chamfer Size Limit**: NEVER apply a fillet or chamfer size that is larger than 50% of the smallest local wall thickness or adjacent edge length. If a feature size or height is 2.0mm, the fillet/chamfer must be at most 1.0mm.
  2. **Strict try...except Wrapping**: EVERY single `fillet()` or `chamfer()` call MUST be wrapped in its own separate `try...except Exception:` block to guarantee that standard mathematical failures do not crash the script.
  3. **Coincident Face (Coplanar) Boolean Safety**: When subtracting pockets, bores, notches, keyways, or holes using `Mode.SUBTRACT`, NEVER let the cutting shape be exactly coplanar or tangent to the boundaries of the target body. Extend the cutting shape slightly beyond the target faces (e.g. use `extrude(amount + 2, both=True)` or offset the start point by 1.0mm) so that the face geometries do not clash during computation.
- **Nothing to Subtract From (FATAL)**: In `build123d`, calling a subtractive operation (`mode=Mode.SUBTRACT`) will throw a `RuntimeError: Nothing to subtract from` if no main solid body exists or if the shapes do not intersect. To prevent this:
  1. **Strict Ordering**: Always build the main body solid first before attempting any cuts.
  2. **Intersection Check**: Ensure all subtractive coordinates (holes, slots, pockets) physically overlap the main body's 3D boundary.
  3. **Guards & try...except blocks**: Wrap secondary subtractive features (like external keyways or slots) in a `try...except Exception: pass` block to isolate them and prevent overall script rendering failure.
- **Tapers & Self-Consistency (Length Boundary Trap)**: NEVER calculate coordinate offsets or feature segments (e.g. tapers, chamfers, or grooves) that mathematically exceed the total overall length (`TOTAL_LENGTH` or `TOTAL_HEIGHT`) of the part.
  1. For example, a `1°` taper transitioning from `Ø11.0` to `Ø8.0` requires a slope length of `85.9mm`. If the total part length is only `19.0mm`, this is a **mathematically impossible collision** and a visual hallucination!
  2. Re-read the drawing: the `1°` draft taper is likely an internal bore relief angle, and the outer transition is actually a **sharp, flat 90° shoulder step**.
  3. ALWAYS verify that calculated coordinates do not exceed overall boundary limits.
- **Face Creation (IMPORTANT)**: Call `make_face()` ONLY when you have drawn a custom profile using `with BuildLine():`. 
- **SHAPE RULE**: If you are using primitive shapes (Circle, Rectangle, etc.), **NEVER** use `make_face()`. Shapes are already faces. Calling `make_face()` on them will CRASH the engine with a `ValueError: No objects to create a hull`.
- **Non-Intersection Rule**: Trace coordinates in a single continuous path (CW or CCW). NEVER cross or re-trace an existing segment.
- **Filter By Position Signature**: When using `filter_by_position()`, you MUST pass BOTH a minimum and a maximum value (e.g., `filter_by_position(Axis.Z, 0, 0)`). NEVER pass only one positional value like `filter_by_position(Axis.Z, 0)` as it will fail execution. 
- **Vertices and Edges Context Access**: NEVER use `part.sketch.vertices()` or `part.sketch.edges()`. Within a `BuildSketch` context, simply call `vertices()` or `edges()` directly to retrieve the geometry elements of the active sketch (e.g., use `fillet(vertices(), radius=R)`). Within a `BuildPart` context, use `part.vertices()` or `part.edges()`. 
- **Rectangle and Square Corner Filleting**: NEVER pass a `radius` argument directly into `Rectangle` or `Square` (e.g. `Rectangle(w, h, radius=r)` is forbidden in build123d). Construct a standard sharp-cornered rectangle or square first, then apply a `fillet` to the vertices (e.g. use `Rectangle(w, h)` then `fillet(vertices(), radius=r)`). 

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

### MULTI-VIEW & MULTI-IMAGE CROP PROTOCOL
- You may receive multiple images: Image 0 is the full Context Map, and subsequent images are high-resolution zoomed crops of specific section cuts (e.g., Section A-A) or detail callouts (e.g., Detail C, Detail D).
- Cross-reference the zoomed crops back to their parent locations in the context map.
- NEVER apply the detail view magnification scale (e.g., "Scale 3:1" or "Scale 5:1") to the dimensions! Extracted dimensions must always be 1:1 real-world size in millimeters as written on the labels.
- Read physical parameters carefully from the crops since they provide 100% legibility compared to the downsampled context sheet.
- **ACCURACY DIRECTIVE**: Transcribe every single dimension EXACTLY as written. DO NOT round numbers. DO NOT guess missing dimensions. If a value is 5.08, write 5.08, never 5.

### FEATURE ANALYSIS
1. **DIAMETER DISCRIMINATION**: 
   - Identify the "Main Envelope" (the largest outer diameters).
   - Distinguish between "Shaft Diameter" and "Groove Bottom Diameter" (often shown as a diameter inside a groove).
   - If a diameter is shown as `øX` inside a groove, the Groove Depth = (Main Diameter - X) / 2.
2. **LONGITUDINAL DATUMS**:
   - Use the leftmost or largest face as the Primary Datum (X=0) for revolved parts.
   - For prismatic parts, establish the center of the base plate as (0,0) and the bottom surface as Z=0.
   - Capture all lengths and offsets relative to this origin. Note if a dimension is "Incremental" or "Absolute".
3. **FEATURE SYNTHESIS & REPETITIONS**:
   - Correctly parse quantity multipliers (e.g., "Nx ØY" or "Nx R Z" means a feature repeating N times).
   - Map every chamfer (`L x A°`) and fillet/radius (`R`) to its specific edge (e.g., "front face", "shoulder", "undercut").
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
# HIERARCHICAL ANALYSIS SYSTEM PROMPTS (COMPLICATED BLUEPRINTS)
# ============================================================================

CONTEXT_INSTRUCTION = """
Analyze this full engineering blueprint context sheet.
Your mission is to perform an architectural audit of the overall part layout and extract the global metadata.

Extract:
1. **Global Specifications**: Title block details (Part Name, Part ID, Material, General Tolerances, and Units).
2. **Main Envelope**: Establish the primary coordinates and overall bounding box (e.g. maximum outer diameter, total length, or width/height/thickness).
3. **Sub-View Layout**: List all cross-sections, detail cuts, tables, and reference views visible on the sheet. For each, describe where it is located on the sheet and what area of the model it magnifies or cuts.
""".strip()

LOCAL_VIEW_INSTRUCTION_TEMPLATE = """
Analyze this high-resolution cropped detail/section view labeled: "{label}".
Your mission is to extract every dimension, parameter, tolerance, repetition, and technical note shown inside this specific view.

MANDATORY RULES:
1. **No Visual Scaling**: This cropped image is a zoomed-in view for legibility. DO NOT apply the visual magnification scale (e.g. "Scale 3:1" or "Scale 5:1") to the values! All dimensions annotated on the drawing represent the 1:1 real-world size of the final physical part in millimeters.
2. **Exact Transcription**: Transcribe decimal values exactly as written. Do not round numbers (e.g., use 15.24, never 15).
3. **Feature Identification**: Explain what each parameter belongs to (e.g., "M12x1.25 thread pitch", "internal counterbore diameter", "groove bottom offset", "hole pattern pitch circle diameter (PCD)").
4. **Tolerance Capture**: Capture any asymmetric or symmetric tolerance values associated with the dimension.
""".strip()

CONSOLIDATION_INSTRUCTION_TEMPLATE = """
You are a Lead Mechanical Engineer. Reconcile the following high-precision blueprint analysis reports into a single, unified, 100% accurate global engineering parameter map and construction plan.

### MAIN CONTEXT REPORT:
{context_summary}

### LOCAL DETAIL & SECTION REPORTS:
{view_summaries}

### CONSOLIDATION DIRECTIVES:
1. **Coordinate Datum Registration**: Reconcile all local offsets and measurements to a single global coordinate origin (datum).
   - For **revolved (axisymmetric)** parts (shafts, pins, bushings): Establish the leftmost face as X=0 (along the rotational axis X) and the centerline as Y=0.
   - For **prismatic** parts (plates, housings, brackets): Establish the visual center of the base plate as (0,0) and the bottom surface as Z=0.
2. **Feature Deduplication**: Reconcile parameters shown in multiple views. If the same dimension is shown in both the main sheet and a detail view, select the more precise, specific dimension from the detail view.
3. **Parameter Synthesis & Loop Continuity**:
   - Establish `PARAMETERS = {{ ... }}` containing every single physical dimension as a float in millimeters.
   - Use highly descriptive parameter names (e.g., `BASE_DIA`, `HEAD_LEN`, `THREAD_PCD`, `BORE_DIA`, `KEYWAY_WIDTH`).
   - Group the parameters logically: Overall Envelope, External Steps, Internal Bores, Holes/Patterns, Chamfers/Fillets.
   - Do NOT round numbers! Maintain exact decimal accuracy.
4. **Step-by-Step Feature Walkthrough**:
   - Outline the sequential order of construction (`build123d` construction plan) to guide the coding stage.
   - Explain how all subtractive features (cavities, internal bores, slots, keyways, and holes) are centered and located relative to the global origin.
   - Highlight any potential error traps (like very small edge deburring radii or chamfers: suggest making them microscopic like 0.02mm or omitting them to prevent torus/OpenCascade filleting failures).

RULE: Output a clear, beautifully structured engineering report. Put the unified python dictionary `PARAMETERS = {{ ... }}` in a separate block at the top of your report so that the downstream generator can extract it easily.
""".strip()

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
            dotenv.load_dotenv(project_root / ".env", override=True)
        except Exception:
            return

    def _prepare_full_instruction(self) -> str:
        instructions = [CORE_INSTRUCTION]
        if self.include_safety:
            instructions.append(SAFETY_INSTRUCTION)
        if self.include_example:
            instructions.append(FEW_SHOT_EXAMPLE)
        return "\n\n".join(instructions)

    def summarise_blueprint(self, images: list[tuple[bytes, str] | tuple[bytes, str, str]] | bytes, image_mime_type: Optional[str] = None) -> str:
        if types is None:
            raise RuntimeError("google-genai is not installed. Check dependencies.")

        # 1. Unpack main image and find any existing crops
        main_image_bytes = None
        main_mime = "image/png"
        existing_crops = []

        if isinstance(images, list):
            if len(images) > 0:
                first_item = images[0]
                main_image_bytes = first_item[0]
                main_mime = first_item[1]
                
                # Check for any crop/detail views passed in
                for item in images[1:]:
                    crop_bytes = item[0]
                    crop_mime = item[1]
                    crop_label = item[2] if len(item) > 2 else f"Detail {len(existing_crops) + 1}"
                    existing_crops.append((crop_bytes, crop_mime, crop_label))
        else:
            main_image_bytes = images
            main_mime = image_mime_type or "image/png"

        if main_image_bytes is None:
            # Fallback to single shot if no main image bytes found
            return self._summarise_blueprint_single_shot(images, image_mime_type)

        # 2. Get high-resolution crops
        # If crops are not already provided, run auto-detection
        auto_crops = []
        if not existing_crops:
            try:
                auto_crops = self.auto_detect_and_crop_details(main_image_bytes, main_mime)
            except Exception as e:
                logger.error(f"Error during auto-crop detection: {e}", exc_info=True)
                auto_crops = []
        else:
            auto_crops = existing_crops

        # 3. Classify Complexity: Complicated vs Simple
        # If there are fewer than 3 detail views, treat as a Simple Blueprint (Single-Shot)
        if len(auto_crops) < 3:
            logger.info(f"Blueprint classified as SIMPLE ({len(auto_crops)} detail views/sections). Using Single-Shot Analysis.")
            # Standard single shot pathway
            # If crops were auto-detected, let's include them in the single shot parts list to give it extra context
            single_shot_payload = [(main_image_bytes, main_mime)]
            for b, m, l in auto_crops:
                single_shot_payload.append((b, m))
            return self._summarise_blueprint_single_shot(single_shot_payload)

        # 4. Complicated Blueprint: Hierarchical Multi-Stage Analysis Protocol
        logger.info(f"Blueprint classified as COMPLICATED ({len(auto_crops)} detail views/sections). Activating Hierarchical Analysis Protocol!")
        try:
            # Stage A: Main Context Analysis
            logger.info("Executing Stage A: Main Context Sheet Analysis...")
            context_summary = self._analyse_main_context(main_image_bytes, main_mime)

            # Stage B: View-Specific High-Resolution Analyses (up to 6 views to avoid timeout/limits)
            logger.info(f"Executing Stage B: Local View-Specific Analyses (processing {len(auto_crops[:6])} crops)...")
            view_summaries = []
            for idx, (crop_bytes, crop_mime, label) in enumerate(auto_crops[:6]):
                logger.info(f"Reading crop {idx+1}/{len(auto_crops[:6])}: '{label}'...")
                crop_summary = self._analyse_local_view(crop_bytes, crop_mime, label)
                view_summaries.append(f"--- DETECTED VIEW: {label} ---\n{crop_summary}")

            # Stage C: Consolidation and Coordinate Alignment (Text-Only)
            logger.info("Executing Stage C: Global Parameter Reconcile and Consolidation...")
            joined_views = "\n\n".join(view_summaries)
            consolidated_summary = self._consolidate_reports(context_summary, joined_views)
            logger.info("Hierarchical Multi-Stage Analysis completed successfully!")
            return consolidated_summary

        except Exception as e:
            logger.error(f"Hierarchical Multi-Stage Analysis crashed: {e}. Falling back to Single-Shot Analysis.", exc_info=True)
            # Reconstruct simple payload as fallback
            single_shot_payload = [(main_image_bytes, main_mime)]
            for b, m, l in auto_crops:
                single_shot_payload.append((b, m))
            return self._summarise_blueprint_single_shot(single_shot_payload)

    def _summarise_blueprint_single_shot(self, images: list[Any] | bytes, image_mime_type: Optional[str] = None) -> str:
        if types is None:
            raise RuntimeError("google-genai is not installed. Check dependencies.")

        parts = [
            types.Part.from_text(text=SUMMARISATION_INSTRUCTION),
        ]

        if isinstance(images, list):
            for item in images:
                img_bytes = item[0]
                mime = item[1]
                parts.append(types.Part.from_bytes(data=img_bytes, mime_type=mime))
        else:
            mime = image_mime_type or "image/png"
            parts.append(types.Part.from_bytes(data=images, mime_type=mime))

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
            f"Single-shot summarisation failed: {last_exception}"
        )
        return ""

    def _analyse_main_context(self, main_image_bytes: bytes, mime: str) -> str:
        parts = [
            types.Part.from_text(text=CONTEXT_INSTRUCTION),
            types.Part.from_bytes(data=main_image_bytes, mime_type=mime)
        ]
        
        last_exception = None
        for attempt in range(1, self.summary_max_retries + 1):
            try:
                response = self.client.models.generate_content(
                    model=self.summary_model,
                    contents=parts,
                    config=types.GenerateContentConfig(
                        temperature=0.0,
                        max_output_tokens=1500,
                    ),
                )
                return response.text or ""
            except Exception as exc:
                last_exception = exc
                if attempt >= self.summary_max_retries or not self._is_retryable_error(exc):
                    break
                backoff_delay = self.summary_retry_base_delay_seconds * (2 ** (attempt - 1))
                time.sleep(min(backoff_delay, self.max_retry_delay_seconds))
                
        raise last_exception or RuntimeError("Failed main context analysis")

    def _analyse_local_view(self, crop_bytes: bytes, crop_mime: str, label: str) -> str:
        prompt = LOCAL_VIEW_INSTRUCTION_TEMPLATE.format(label=label)
        parts = [
            types.Part.from_text(text=prompt),
            types.Part.from_bytes(data=crop_bytes, mime_type=crop_mime)
        ]
        
        last_exception = None
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
                time.sleep(min(backoff_delay, self.max_retry_delay_seconds))
                
        raise last_exception or RuntimeError(f"Failed local view analysis for {label}")

    def _consolidate_reports(self, context_summary: str, view_summaries: str) -> str:
        prompt = CONSOLIDATION_INSTRUCTION_TEMPLATE.format(
            context_summary=context_summary,
            view_summaries=view_summaries
        )
        
        last_exception = None
        for attempt in range(1, self.summary_max_retries + 1):
            try:
                response = self.client.models.generate_content(
                    model=self.summary_model,
                    contents=[types.Part.from_text(text=prompt)],
                    config=types.GenerateContentConfig(
                        temperature=0.0,
                        max_output_tokens=4096,
                    ),
                )
                return response.text or ""
            except Exception as exc:
                last_exception = exc
                if attempt >= self.summary_max_retries or not self._is_retryable_error(exc):
                    break
                backoff_delay = self.summary_retry_base_delay_seconds * (2 ** (attempt - 1))
                time.sleep(min(backoff_delay, self.max_retry_delay_seconds))
                
        raise last_exception or RuntimeError("Failed report consolidation")

    def auto_detect_and_crop_details(self, image_bytes: bytes, image_mime_type: Optional[str] = None) -> list[tuple[bytes, str, str]]:
        """Automatically detects detail sections and crops them at high resolution."""
        if types is None:
            return []

        from pydantic import BaseModel, Field
        
        class BoundingBox(BaseModel):
            label: str = Field(description="Name/label of the detail view or section cut (e.g. 'Detail B', 'Section A-A', 'Detail C')")
            x_min: float = Field(description="Normalized starting X coordinate between 0.0 and 1.0")
            y_min: float = Field(description="Normalized starting Y coordinate between 0.0 and 1.0")
            x_max: float = Field(description="Normalized ending X coordinate between 0.0 and 1.0")
            y_max: float = Field(description="Normalized ending Y coordinate between 0.0 and 1.0")

        class DetectedDetails(BaseModel):
            details: list[BoundingBox]

        mime = image_mime_type or "image/png"
        
        prompt_text = (
            "Analyze this high-resolution engineering blueprint. "
            "Your task is to detect and locate all zoomed-in detail callouts (like Detail B, Detail C), "
            "cross-section views (like Section A-A, E-E), and key dimension lists/tables on the sheet. "
            "Provide the exact bounding box coordinates of these regions as normalized floats between 0.0 and 1.0, "
            "where (0.0, 0.0) is the top-left and (1.0, 1.0) is the bottom-right of the image."
        )

        parts = [
            types.Part.from_text(text=prompt_text),
            types.Part.from_bytes(data=image_bytes, mime_type=mime)
        ]

        logger.info("Executing auto-detect bounding box analysis stage...")
        try:
            response = self.client.models.generate_content(
                model=self.summary_model,
                contents=parts,
                config=types.GenerateContentConfig(
                    temperature=0.0,
                    response_mime_type="application/json",
                    response_schema=DetectedDetails,
                ),
            )
            
            if not response.text:
                logger.warning("Empty response from detail detector stage.")
                return []
                
            try:
                data = json.loads(response.text)
                detected_boxes = data.get("details", [])
            except Exception as e:
                logger.error(f"Failed to parse detected boxes JSON: {e}. Raw response: {response.text}")
                return []
                
            if not detected_boxes:
                logger.info("No detailed views or sections were detected on the blueprint.")
                return []
                
            logger.info(f"Auto-detected {len(detected_boxes)} detailed views/sections on the blueprint: {[box.get('label') for box in detected_boxes]}")
            
            from PIL import Image
            from io import BytesIO
            
            img = Image.open(BytesIO(image_bytes))
            w, h = img.size
            
            cropped_payloads = []
            for box in detected_boxes:
                label = box.get("label", "Detail")
                x1 = int(max(0.0, min(1.0, box.get("x_min", 0.0))) * w)
                y1 = int(max(0.0, min(1.0, box.get("y_min", 0.0))) * h)
                x2 = int(max(0.0, min(1.0, box.get("x_max", 1.0))) * w)
                y2 = int(max(0.0, min(1.0, box.get("y_max", 1.0))) * h)
                
                if x2 <= x1 or y2 <= y1:
                    continue
                    
                cropped_img = img.crop((x1, y1, x2, y2))
                
                out_io = BytesIO()
                save_fmt = img.format if img.format else "PNG"
                cropped_img.save(out_io, format=save_fmt)
                cropped_bytes = out_io.getvalue()
                
                cropped_payloads.append((cropped_bytes, f"image/{save_fmt.lower()}", label))
                logger.info(f"Successfully auto-cropped region '{label}' at pixels: {x1}, {y1}, {x2}, {y2}")
                
            return cropped_payloads
            
        except Exception as exc:
            logger.error(f"Auto-detect and crop stage failed: {exc}", exc_info=True)
            return []

    def stream_build123d_script(
        self,
        prompt: str,
        images: list[tuple[bytes, str]] | bytes,
        image_mime_type: Optional[str] = None,
        summary: Optional[str] = None,
    ) -> Iterator[str]:
        if types is None:
            raise RuntimeError("google-genai is not installed. Check dependencies.")

        image_payloads = []
        if isinstance(images, list):
            image_payloads = list(images)
        else:
            mime = image_mime_type or "image/png"
            image_payloads = [(images, mime)]

        if len(image_payloads) == 1 and not summary:
            main_image_bytes, main_mime = image_payloads[0]
            try:
                auto_crops = self.auto_detect_and_crop_details(main_image_bytes, main_mime)
                if auto_crops:
                    image_payloads.extend([(b, m) for b, m, l in auto_crops])
                    summary = self.summarise_blueprint(image_payloads)
                    logger.info("Re-summarized blueprint with automatic high-resolution crops.")
            except Exception as e:
                logger.error(f"Failed to execute background auto-crop pipeline: {e}", exc_info=True)

        full_system_instruction = self._prepare_full_instruction()
        context_block = f"\n\n### BLUEPRINT ANALYSIS SUMMARY\n{summary}\n" if summary else ""
        user_prompt = f"CAD request: {prompt.strip()}{context_block}"

        image_parts = []
        for img_bytes, mime in image_payloads:
            image_parts.append(types.Part.from_bytes(data=img_bytes, mime_type=mime))

        try:
            token_count_response = self.client.models.count_tokens(
                model=self.model,
                contents=[
                    full_system_instruction,
                    user_prompt,
                    *image_parts,
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
                *image_parts,
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

        res = ""
        if candidates:
            # Prioritize candidates that satisfy our contract
            contract_matches = [
                c for c in candidates 
                if "PARAMETERS" in c and "build_model" in c
            ]
            if contract_matches:
                # Return the longest one that matches the contract (usually the most complete one)
                res = max(contract_matches, key=len)
            else:
                # Fallback to the longest candidate overall
                res = max(candidates, key=len)
        else:
            # Final fallback: strip all markers and find start
            cleaned = script.strip().strip("`").strip()
            cleaned = cleaned.replace("```python", "").replace("```py", "").replace("```", "").strip()

            start_match = LIKELY_CODE_START_RE.search(cleaned)
            if start_match:
                cleaned = cleaned[start_match.start():].lstrip()
            res = cleaned

        # Programmatic Fail-Safe Sanitization Guardrail
        if res:
            # Strip standalone 'union()' calls (these are automatic in build123d anyway)
            res = re.sub(r'(?m)^\s*union\(\s*\)(?:\s*#.*)?$', '', res)
            # Replace functional union(a, b) with (a + b) operator syntax
            res = re.sub(r'union\(([^,]+),\s*([^)]+)\)', r'(\1 + \2)', res)
            # Replace method a.union(b) with (a + b) operator syntax
            res = re.sub(r'(\w+)\.union\(([^)]+)\)', r'(\1 + \2)', res)

        return res