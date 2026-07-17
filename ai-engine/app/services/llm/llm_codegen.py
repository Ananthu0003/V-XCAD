from __future__ import annotations

import hashlib
import json
import os
import re
import threading
import asyncio
from pathlib import Path
from typing import Any, Callable, Coroutine, Iterator

from app.services.llm.gateways import UniversalHTTPXGateway
from app.services.llm.registry import get_model_by_id

# Cache structure mapping image hash to feature map
_BLUEPRINT_CACHE: dict[str, dict[str, Any]] = {}
_BLUEPRINT_CACHE_LOCK = threading.Lock()

# Increment this whenever the audit schema or deterministic normalization rules change.
# Including it in the cache key prevents older in-memory feature maps from being reused.
_AUDIT_SCHEMA_VERSION = "thread-aware-v2"

# ISO 261/262-style preferred coarse pitches. This is standards data, not
# blueprint-specific hardcoding. Values are used only when a metric callout
# intentionally omits pitch, for example: M6, M8, M10, or M12.
_ISO_METRIC_COARSE_PITCH_MM: dict[float, float] = {
    1.0: 0.25,
    1.2: 0.25,
    1.4: 0.30,
    1.6: 0.35,
    1.8: 0.35,
    2.0: 0.40,
    2.2: 0.45,
    2.5: 0.45,
    3.0: 0.50,
    3.5: 0.60,
    4.0: 0.70,
    5.0: 0.80,
    6.0: 1.00,
    7.0: 1.00,
    8.0: 1.25,
    10.0: 1.50,
    12.0: 1.75,
    14.0: 2.00,
    16.0: 2.00,
    18.0: 2.50,
    20.0: 2.50,
    22.0: 2.50,
    24.0: 3.00,
    27.0: 3.00,
    30.0: 3.50,
    33.0: 3.50,
    36.0: 4.00,
    39.0: 4.00,
    42.0: 4.50,
    45.0: 4.50,
    48.0: 5.00,
    52.0: 5.00,
    56.0: 5.50,
    60.0: 5.50,
    64.0: 6.00,
}

_BARE_METRIC_THREAD_RE = re.compile(
    r"^\s*M\s*(?P<diameter>\d+(?:[.,]\d+)?)\s*$",
    re.IGNORECASE,
)
_EMBEDDED_BARE_METRIC_THREAD_RE = re.compile(
    r"(?<![A-Z0-9])M\s*(?P<diameter>\d+(?:[.,]\d+)?)(?!\s*(?:[xX×]|[-–—]\s*\d))",
    re.IGNORECASE,
)
_THREAD_MARKER_RE = re.compile(
    r"(?:\bM\s*\d|\bUNC\b|\bUNF\b|\bUNEF\b|\bUNR\b|"
    r"\bUNS\b|\bACME\b|\bBUTT(?:RESS)?\b|\bNPTF?\b|"
    r"\bNPS[CLR]?\b|\bBSP[PT]?\b|\bTHD\b|\bTAP(?:PED)?\b)",
    re.IGNORECASE,
)

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
- **ADDITIVE**: `base_prismoid`, `base_cylinder`, `mounting_ear`, `alignment_boss`, `reinforcement_rib`, `spherical_dome`, `revolved_profile`, `complex_shell`
- **SUBTRACTIVE**: `pocket_interior`, `step_shoulder`, `counterbore`, `hole_through`, `hole_blind`, `thread_internal`, `oring_groove`, `revolved_cutout`
- **SURFACE / MANUFACTURING**: `thread_external`
- **EDGE_MODIFIER**: `fillet_interior`, `chamfer_exterior`

## 3. MACHINING & DIMENSIONAL RULES
- **Profile Decompositions**: For parts with asymmetric or multi-angular walls (e.g., specific draft angles like 33°, 40°, 22° shifts), capture the exact 2D coordinate paths outlining the perimeter.
- **Z-Reference**: Every feature must declare an exact `z_reference`: `"bottom_of_feature"`, `"top_of_feature"`, or `"absolute_zero"`.
- **Half-Section Views (ANTI-HALLUCINATION)**: NEVER interpret crosshatching on the top or bottom half of a symmetric part as a physical cutout or slot! Half-sections are drafting conventions used to expose internal geometry (like bores and internal threads). The physical part remains fully cylindrical/symmetric! However, you MUST explicitly extract the internal geometry (bores, internal threads) shown inside the half-section as `hole_blind` or `thread_internal` features! Do not ignore them.
- **Keyways & Slots**: Look for discrete keyway slots (width and length) often shown on shafts or flanges. Ensure you capture them as distinct subtractive features (e.g. `pocket_interior`), NOT just generic holes. Do NOT miss them!
- **Hidden & Internal Subtractions (CRITICAL)**: You MUST carefully scan all section views, detail views, and dashed hidden lines for ANY material removal. Every internal bore, countersink, counterbore, groove, chamfer, and intersecting hole MUST be explicitly listed as a subtractive feature. Do not skip smaller cutting portions or assume they are implied by a larger bore. Look closely at cross-sections to find hidden stepped cuts.

## 4. THREAD CALLOUT EXTRACTION — CALLOUT FIRST
When identifying threads from the blueprint, you MUST identify every thread callout (M, UNC, UNF, NPT) from the blueprint text, leader lines, or general notes. 
Every identified thread must be modeled in the FEATURE_MAP as either `thread_internal` or `thread_external`.
A thread is never identified from repeated graphic lines alone. Its written callout,
leader target, target geometry, section view, and general drawing notes are the
primary evidence. Visible thread lines are supporting evidence only.

For every thread, include a nested `thread` object. Preserve the raw text exactly
in `source_callout` and place the cleaned interpretation in `normalized_callout`.
Extract, when available:

- `thread_standard`, `thread_family`, `nominal_diameter`, `diameter_unit`
- `pitch`, `pitch_unit`, `threads_per_inch`, `lead`, `number_of_starts`
- `internal_or_external`, `thread_class`, `tolerance_grade`, `tolerance_position`
- `handedness`, `thread_length`, `full_thread_depth`, `hole_depth`
- `through_or_blind`, `tapered_or_parallel`, `taper_ratio`, `thread_form`
- `quantity`, `leader_target`, `source_view`, `inferred_fields`
- `unresolved_fields`, `warnings`, and `requires_user_confirmation`

Association priority:
1. Connected leader/arrow endpoint and extension-line topology.
2. Target geometry and section-view evidence.
3. Projection alignment and shared centerlines.
4. Proximity only as a final supporting signal.

### Bare metric callouts such as M10

When the complete thread callout is only `M` plus nominal diameter, such as
`M6`, `M8`, `M10`, or `M12`:

1. Interpret it as an ISO metric thread.
2. Resolve the omitted pitch using the preferred ISO metric coarse-pitch table.
3. Mark `pitch` as inferred with `pitch_source = "standard_coarse_pitch_inference"`.
4. Default to right-hand and single-start according to standard convention, but
   record both in `inferred_fields`; never present them as visually extracted.
5. Determine internal/external only from the leader target and geometry.
6. Search general notes for a default tolerance class. If none is available, keep
   `thread_class` null and add a warning.
7. Never invent thread depth, thread length, drill depth, or tap depth.
8. If the target or required length/depth cannot be established, add the field to
   `unresolved_fields` and set `requires_user_confirmation` to true.

Example interpretation of a leader pointing to a blind threaded hole:
`M10` -> ISO metric, nominal diameter 10 mm, inferred coarse pitch 1.5 mm,
right-hand, single-start; thread depth and tolerance remain unresolved unless
shown elsewhere in the drawing.

Do not confuse drilled-hole depth with full-thread depth. Do not infer pitch from
the spacing of simplified thread lines when a callout exists.

## 5. STRICT JSON SCHEMA
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
    },
    {
      "id": "thread_001",
      "type": "thread_internal",
      "description": "Metric threaded hole identified from a leader-linked callout.",
      "dims": { "diameter": 10.0, "depth": null },
      "location": { "x": 0.0, "y": 0.0, "z": 14.0, "z_reference": "top_of_feature" },
      "is_subtractive": true,
      "parent_id": "body_main",
      "thread": {
        "source_callout": "M10",
        "normalized_callout": "M10 × 1.5",
        "thread_standard": "ISO_METRIC",
        "thread_family": "M",
        "nominal_diameter": 10.0,
        "diameter_unit": "mm",
        "pitch": 1.5,
        "pitch_unit": "mm",
        "pitch_source": "standard_coarse_pitch_inference",
        "internal_or_external": "internal",
        "handedness": "right",
        "number_of_starts": 1,
        "lead": 1.5,
        "thread_class": null,
        "full_thread_depth": null,
        "through_or_blind": "blind",
        "inferred_fields": ["pitch", "handedness", "number_of_starts", "lead"],
        "unresolved_fields": ["thread_class", "full_thread_depth"],
        "warnings": [
          "Pitch omitted; inferred preferred ISO metric coarse pitch.",
          "Thread tolerance class was not specified.",
          "Full thread depth was not specified."
        ],
        "requires_user_confirmation": true
      },
      "confidence": "inferred"
    }
  ],
  "patterns": []
}
```

## 6. SEVERE VALIDATION GATE

* Do not output any markdown code fences, conversational prose, or warning summaries. Return pure, parsable JSON text only.
""".strip()

API_CHEATSHEET_AND_RULES = """
## 📚 STRICT BUILD123D API CHEAT SHEET
You may ONLY use the following exact signatures. DO NOT INVENT kwargs.

**2D Lines & Arcs (inside `with bd.BuildLine():`)**
- `bd.Line(p1: tuple[float, float], p2: tuple[float, float])`
- `bd.RadiusArc(start_point: tuple[float, float], end_point: tuple[float, float], radius: float)`
- `bd.ThreePointArc(p1: tuple[float, float], p2: tuple[float, float], p3: tuple[float, float])`
- `bd.TangentArc(p1: tuple[float, float], p2: tuple[float, float], tangent: tuple[float, float])`
- `bd.Polyline(pts: list[tuple[float, float]])`

**2D Sketches (inside `with bd.BuildSketch():`)**
- `bd.make_face()` (converts active BuildLine sequence into a face)
- `bd.Circle(radius: float)`
- `bd.Rectangle(width: float, height: float)`
- `bd.RegularPolygon(radius: float, side_count: int)`
- `bd.SlotOverall(width: float, height: float)` (CRITICAL: width MUST be > height. For vertical slots, swap them and rotate the slot by 90 degrees)
- `bd.SlotCenterToCenter(center_to_center: float, height: float)`
- `bd.Polygon(pts: list[tuple[float, float]])`
- `bd.offset(amount: float)` (Offsets the active sketch boundary. Positive amount expands outward, negative shrinks inward. Extremely useful for rounded/bowed rectangles!)

**3D Primitives (inside `with bd.BuildPart():`)**
- `bd.Box(length: float, width: float, height: float, mode=bd.Mode.ADD)`
- `bd.Cylinder(radius: float, height: float, mode=bd.Mode.ADD)`
- `bd.Sphere(radius: float, mode=bd.Mode.ADD)`
- `bd.Cone(bottom_radius: float, top_radius: float, height: float, mode=bd.Mode.ADD)`
- `IsoThread(major_diameter: float, pitch: float, length: float, external: bool, end_finishes=("fade", "fade"))` (NOTE: You MUST import it at the top via `from bd_warehouse.thread import IsoThread`)
*(Note: pass `mode=bd.Mode.SUBTRACT` to cut, or `mode=bd.Mode.INTERSECT` to intersect)*

**3D Operations (inside `with bd.BuildPart():`)**
- `bd.extrude(amount: float, both: bool = False)`
- `bd.revolve(axis: bd.Axis = bd.Axis.Z)`
- `bd.Hole(radius: float, depth: float)`
- `bd.chamfer(edges, length: float)`
- `bd.fillet(edges, radius: float)`
- `bd.offset(amount: float, openings: list = None)` (Hollows or offsets a 3D part. E.g. to create a constant-thickness shell from a sphere, you can offset by a negative amount with no openings).

**Locations & Contexts**
- `with bd.Locations((x, y, z)):`
- `with bd.PolarLocations(radius: float, count: int):`
- `with bd.GridLocations(x_spacing: float, y_spacing: float, x_count: int, y_count: int):`

**🚫 ANTI-HALLUCINATION RULES (NEVER DO THESE):**
- **CRITICAL - ARCS & COMPLEX PROFILES**: NEVER attempt to manually calculate exact floating-point endpoints for tangent arcs (`bd.RadiusArc`, `bd.TangentArc`) for complex cutouts unless absolutely necessary. Missing by 0.001mm crashes the engine with open wires! Use boolean intersections, `bd.offset()`, or simple primitives wherever possible. If you MUST draw arcs, ensure exact mathematical closure.
- **CRITICAL - TopoDS::Face TypeMismatch**: If you see `OCP.OCP.Standard.Standard_TypeMismatch: TopoDS::Face`, it means `bd.make_face()` failed to close a wire (often due to `RadiusArc` calculations). NEVER revolve manually drawn 2D arcs to make domes! Use 3D boolean operations instead (e.g. creating a `bd.Cylinder` and a `bd.Sphere` and unioning or intersecting them).
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
- **CRITICAL - 2D Primitives in 3D**: NEVER call 2D sketches like `bd.SlotOverall` or `bd.Rectangle` directly inside `with bd.BuildPart():` without an active `BuildSketch`. Doing so returns `None` and causes `AttributeError: 'NoneType' object has no attribute 'moved'`. Always wrap 2D shapes in `with bd.BuildSketch():` and then `bd.extrude()` them!
- **CRITICAL - Extrude Crashes**: If you get `Standard_ConstructionError: BRepSweep_Translation::Constructor` during `bd.extrude()`, you are trying to extrude by an `amount` of 0! Check your depth math! Extrusion amounts must ALWAYS be non-zero!
- **CRITICAL - end_finishes**: The `end_finishes` parameter in `IsoThread` MUST be a tuple of two strings (e.g., `end_finishes=("fade", "fade")`), NEVER a single string (like `"fade"`)!
- **CRITICAL - IsoThread Subtraction**: `IsoThread` is a native primitive! It AUTOMATICALLY adds itself to the active `BuildPart` context when you instantiate it, just like `bd.Cylinder`. Therefore, NEVER pass it to `bd.add()`! To subtract a thread, just instantiate it with `mode=bd.Mode.SUBTRACT` (e.g., `IsoThread(..., mode=bd.Mode.SUBTRACT)`). Using `bd.add(thread)` on an already-instantiated thread will create massive duplicate floating solids in the workspace!
- **Fillet/Chamfer Crashes**: If you get `ValueError: Failed creating a fillet`, your radius is too large for the adjacent faces, OR you selected edges that don't exist. If 3D fillets constantly fail in tight spaces (like relief grooves or keyways), just fillet the 2D sketch BEFORE revolving/extruding, or remove the fillet entirely!
- NEVER nest `bd.PolarLocations` inside `bd.Locations` (e.g., `with bd.Locations(bd.PolarLocations(...))`). `bd.PolarLocations` is already a context manager. Use it directly: `with bd.PolarLocations(...):`.
- NEVER pass a 3D Solid (like `bd.Box`, `bd.Cylinder`, `bd.Sphere`) into `bd.extrude()`. `bd.extrude` is ONLY for 2D Sketches or Faces. To subtract a 3D solid, just instantiate it with the subtract mode: e.g., `bd.Box(..., mode=bd.Mode.SUBTRACT)`.
- NEVER use `bd.Hull()`. The correct function in build123d is `bd.make_hull()`. Also, NEVER pass objects manually to `bd.make_hull([c1, c2])` as this triggers a bug in build123d. Just call `bd.make_hull()` with NO ARGUMENTS to automatically hull the active sketch context.
- NEVER use `plane=...` in `bd.PolarLocations`, `bd.GridLocations`, or `bd.HexLocations`. These do not accept a plane argument. To evaluate locations on a specific plane, chain the contexts: e.g., `with bd.Locations(my_plane): with bd.PolarLocations(...):`.
- NEVER use `Plane.shifted()`. The correct method to offset a plane in build123d is `Plane.offset()`.
- NEVER use `Plane.z_axis`, `Plane.x_axis`, or `Plane.y_axis`. Planes use `z_dir` and `x_dir`. (DO NOT pass `y_dir` into `bd.Plane(...)`, as it is automatically computed).
- NEVER use `.at_coords(...)` to select faces or edges. It does not exist. Use `.filter_by_position(...)` or `.sort_by_distance(...)` instead.
- **CRITICAL - ShapeList First/Last**: NEVER use `.first()` or `.last()` as methods on edge/face lists (e.g., `edges.first()`). In build123d, `.first` and `.last` are PROPERTIES. Calling them will crash with `TypeError: 'Edge' object is not callable`. ALWAYS use standard python list indexing like `edges[0]` and `edges[-1]`.
- NEVER place polygon vertices exactly on the boundary of another shape if you intend to fuse them. (e.g., If attaching a rib to a cylinder of radius R, place the vertex at R-2, NOT R, to guarantee structural overlap and prevent zero-thickness boolean failures).
- **CRITICAL**: `bd.Hole(depth=D)` ALWAYS cuts in the `-Z` direction of the active Location/Plane. If you place a `bd.Hole` at `Z=0` and your part grows upwards, the hole will cut DOWN into empty space! To cut upwards from the bottom, you must chain a rotation: `with bd.Locations((0, 0, 0)): with bd.Locations(bd.Rotation(180, 0, 0)): bd.Hole(...)`. Also, if your flange extrudes in `+Z` of a plane, a `bd.Hole` on that same plane will cut `-Z` into empty space! Ensure your holes cut *into* the material.
- **CRITICAL**: NEVER subtract a shape whose boundary is EXACTLY coincident with the outer boundary of the part (e.g., subtracting a bore of radius R from a cylinder of radius R). This creates zero-thickness walls and crashes the engine (`StdFail_NotDone`). If a bore cuts completely to the outside edge, make the subtractive shape slightly LARGER (e.g., radius `R + eps`) to ensure a clean cut through the boundary.
- **CRITICAL**: NEVER pass edges or faces from a primitive object (like `cyl.edges()`) into `bd.fillet()` or `bd.chamfer()` after it has been added to the active `BuildPart`. Once a primitive is unioned into a part, its original edges are destroyed! This causes a fatal C++ `NCollection_IndexedDataMap::FindFromKey` crash. ALWAYS extract edges from the active part itself using `part.edges().filter_by(...).sort_by(...)`.
- **Edge Treatments**: Actively apply `bd.fillet` and `bd.chamfer` to 3D edges as dictated by the blueprint. Use precise edge selection (e.g. `part.edges().filter_by(bd.GeomType.CIRCLE).sort_by(bd.Axis.Z)`).
- **NO MAGIC NUMBERS**: NEVER use hardcoded float literals (like `15.0`, `bd.extrude(6.0)`, or `bd.Polygon([(10.0, 20.0)...])`) anywhere in your construction logic. Extract every dimension to the `PARAMETERS` dict at the top.
- **Spherical Domes**: If the blueprint calls for a spherical dome of radius `R` intersecting a base of radius `r_base`, DO NOT fake it with a filleted cylinder! Use `bd.Sphere(radius=R)` and shift its center down along Z to perfectly intersect the base plane. To find the exact Z-shift distance, let Python do the math: `import math` and use `math.sqrt(R**2 - r_base**2)` to calculate the distance from the sphere center to the intersection plane. NEVER hardcode the square root result!
- **Half-Section Views (ANTI-HALLUCINATION)**: NEVER model a cutout or slot through a symmetrical cylinder just because the blueprint shows a half-section view! Half-sections are just drafting conventions to show internal bores and threads. The cylinder MUST remain a full 360-degree revolved solid unless a physical slot is explicitly dimensioned.
- **Keyways & Slots**: For keyways ALONG a shaft, use `bd.SlotOverall(width=Length, height=Width)` BUT YOU MUST rotate it 90 degrees using `with bd.Locations(bd.Rotation(0, 0, 90)):` inside the `BuildSketch`! If you don't rotate it 90 degrees, the slot will be cut perpendicularly across the shaft instead of along it!
- ALWAYS write the `# --- MENTAL WALKTHROUGH ---` block right after the SPATIAL PLAN. DO NOT SKIP IT.
"""

THREAD_CAD_RULES = """
## THREAD-AWARE CAD GENERATION RULES

- Treat the `thread` object in the FEATURE_MAP as manufacturing metadata and the
  source of truth. Do not reconstruct pitch from visible thread-line spacing.
- A bare metric designation such as `M10` is normalized to its preferred coarse
  pitch (`M10 × 1.5`) only when the feature map marks the pitch as inferred.
- Preserve `source_callout`, `normalized_callout`, inferred fields, unresolved
  fields, warnings, and confidence in generated script metadata.
- Never invent a blind-thread depth, external-thread length, tolerance class, or
  tap-drill depth. If required geometry is unresolved, create only the safe base
  cylindrical/hole geometry and expose the unresolved thread metadata for review.
- For an internal metric thread, the nominal diameter is NOT automatically the
  tap-drill diameter. Unless a standards registry or explicit callout supplies a
  validated tap-drill diameter, do not silently cut a hole at nominal diameter and
  claim it is a manufactured thread.
- Default right-hand and single-start values may be used only when marked as
  standards-based defaults. Left-hand and multi-start callouts override them.
- You MUST model EXACT helical threads physically using the `bd_warehouse` library whenever thread dimensions (pitch, length, diameter) are available. Do NOT leave them as plain cylinders/holes.
- For metric threads, use `bd_warehouse.thread.IsoThread` which is guaranteed to be available in this environment.
- Parameterize all thread values used by CAD code and add matching
  PARAMETER_METADATA entries.
""".strip()

EDIT_SYSTEM_INSTRUCTION = """
# ROLE: Expert Python Parametric CAD Revision Engineer
You are performing surgical geometric updates on an existing build123d Python script.

## IMMUTABILITY & ENGINE RULES
1. **Never generate a completely new part from scratch**. Retain the foundational modules, structural identifiers, and base operations.
2. **Variable Protection**: You are strictly FORBIDDEN from altering the string spelling of any variable keys inside the PARAMETERS envelope unless explicitly adding new ones. Changing key names will break the user's React slider system completely.
3. **Parametric Stacking**: Any newly introduced measurements MUST be extracted into the PARAMETERS dictionary. Derive downstream coordinates explicitly using these variables.
4. **Metadata Mapping**: You MUST generate a PARAMETER_METADATA entry for every NEW parameter you add.

__API_CHEATSHEET_AND_RULES__

__THREAD_CAD_RULES__

Output the ENTIRE updated python file text block containing the fixes. Partial code snippets are completely unacceptable.
""".replace(
    "__API_CHEATSHEET_AND_RULES__", API_CHEATSHEET_AND_RULES
).replace(
    "__THREAD_CAD_RULES__", THREAD_CAD_RULES
).strip()

SYSTEM_INSTRUCTION = """
# ROLE: Expert Python Parametric CAD Engineer
Generate production-grade, mathematically robust, parametric CAD code using the `build123d` Python library.

## 🎯 GOLDEN RULES
1. **Blueprint Adherence**: You MUST strictly follow the provided `FEATURE_MAP`. Do not invent new features or ignore existing ones. When identifying threads from the blueprint, ensure every single topological feature (chamfers, cutouts, ribs, holes, threads) described in the map is modeled.
2. **Manifold Stability & The Epsilon Protocol**: Every boolean operation must resolve cleanly. To prevent zero-thickness faces, you MUST declare `eps = 0.01` in your `PARAMETERS` dictionary. For all through-holes or subtractive cutouts, extend the depth/height by `eps` (or `2*eps`) and adjust placement by `eps` to guarantee a clean pierce through the boundary.
3. **Parametric Stacking (NO MAGIC NUMBERS)**: You may NOT use hardcoded float literals for dimensions anywhere in the `BuildPart` block! EVERY single measurement (radii, lengths, heights, chamfers, fillets, hole offsets) MUST be extracted into the `PARAMETERS` dictionary at the top of the script. Derive downstream coordinates explicitly using these variables.
4. **Pythonic Structure**: Use the declarative `with BuildPart() as part:` syntax wherever possible.
5. **Metadata Mapping**: You MUST generate a `PARAMETER_METADATA` dictionary matching the `PARAMETERS` exactly, providing a `"group"`, `"confidence"` (0.0 to 1.0), and `"description"` for every parameter.
6. **Z=0 Top Surface Alignment**: The final part MUST be exactly aligned so its absolute top-most surface is at Z=0. HOWEVER, you may build the part in whatever coordinate system makes the math easiest (e.g. growing upwards from Z=0). At the end of your script, OUTSIDE the BuildPart block, you MUST shift the entire part down programmatically using: `part.part = part.part.locate(bd.Location((0, 0, -part.part.bounding_box().max.Z)))`. This eliminates the need for you to do complex floating-point calculations!
7. **Complete Extraction Enforcement**: Do NOT omit or simplify any subtractive features (holes, grooves, chamfers) mapped in the `FEATURE_MAP`. If a feature is described, you MUST physically model it and subtract it from the part.

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

__API_CHEATSHEET_AND_RULES__

__THREAD_CAD_RULES__

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
# Body: Extrudes from Z = -body_height to Z = 0.
# Shank: Extrudes from Z = -(body_height + shank_height) to Z = -body_height.
# Through Hole: drilled from Z=0 through entire height.
# --- MENTAL WALKTHROUGH ---
# 1. The Body is built first at the top.
# 2. The Shank connects to the Body. To guarantee fusion, the Shank's top Z is pushed 1mm up into the Body (overlap).
# 3. The Through Hole is cut along -Z, correctly penetrating both solids.
# --------------------

with bd.BuildPart() as part:
    # @id: body
    with bd.Locations((0, 0, -body_height)):
        with bd.BuildSketch():
            bd.Circle(radius=body_diameter/2)
        bd.extrude(amount=body_height)
        
    # @id: shank
    with bd.Locations((0, 0, -(body_height + shank_height))):
        with bd.BuildSketch():
            bd.Circle(radius=shank_diameter/2)
        bd.extrude(amount=shank_height)

    # @id: through_hole
    with bd.Locations((0, 0, 0)):
        bd.Hole(radius=5, depth=shank_height + body_height)

# Ensure top surface is exactly at Z=0 for CAM export
part.part = part.part.locate(bd.Location((0, 0, -part.part.bounding_box().max.Z)))

if __name__ == '__main__':
    try:
        from ocp_vscode import show
        show(part)
    except ImportError:
        pass
```

**YOU ARE NOW READY TO GENERATE PRODUCTION-GRADE BUILD123D PYTHON CODE.**
""".replace(
    "__API_CHEATSHEET_AND_RULES__", API_CHEATSHEET_AND_RULES
).replace(
    "__THREAD_CAD_RULES__", THREAD_CAD_RULES
).strip()

EDIT_SYSTEM_PROMPT = """
# ROLE: Expert CAD Revision Engineer & build123d Refinement Specialist
You are an expert CAD engineer editing an existing build123d Python script based on user requests.

## ⚠️ IMMUTABILITY & ENGINE RULES (CRITICAL)

1. **Never generate a completely new model from scratch**. Retain the foundational structure, SPATIAL PLAN block, and exact logic sequence unless specifically asked to restructure.
2. **Parameter Variable Lock**: You are strictly FORBIDDEN from altering the string keys inside the `PARAMETERS` dictionary or `PARAMETER_METADATA`. If you change key names, the React UI parameter sliders will break entirely!
   * ✅ ACCEPTABLE: Appending new keys or adjusting the float values of existing keys (e.g., `20.0` -> `25.0`).
   * ❌ UNACCEPTABLE: Renaming existing keys (e.g., `"shank_diameter"` -> `"diameter"`).
3. **Manifold Stability (Epsilon Protocol)**: When modifying or adding subtractive holes (`bd.Hole`, `bd.extrude(mode=bd.Mode.SUBTRACT)`), always apply `eps` depth extensions and offsets to guarantee clean bounds.
4. **Strict API Enforcement**: NO magic numbers. ALL dimensions must come from `PARAMETERS`. Use declarative `build123d` syntax (never CadQuery).
5. **Thread Metadata Safety**: Preserve existing thread metadata. For bare metric callouts such as M10, infer only the standards-based coarse pitch and mark it as inferred; do not invent depth, length, tolerance class, or tap-drill diameter.
6. **Output Format**: Return the ENTIRE valid Python file text block containing the fixes. Partial code snippets are completely unacceptable.
""".strip()

REPAIR_SYSTEM_PROMPT = """
# ROLE: build123d Compiler Error Recovery Specialist

You are receiving a build123d Python script that failed to render due to an exception or topological failure. Fix the EXACT error reported in the ERROR_LOG and return a corrected script.

## ⚠️ IMMUTABILITY & SYNTAX CONSTRAINTS (CRITICAL)

1. **Parameter Variable Lock**: You are strictly FORBIDDEN from altering the string keys inside the `PARAMETERS` or `PARAMETER_METADATA` dictionaries. 
2. **Context Manager Enforcement**: Ensure 3D operations (`bd.extrude`, `bd.revolve`, etc) are NOT nested inside `with bd.BuildSketch():`. They must sit under `with bd.BuildPart():`.
3. **Edge/Face Referencing**: If a C++ `NCollection_IndexedDataMap` crash occurs, you likely passed primitive edges directly to a chamfer/fillet. ALWAYS extract edges from the active part using `part.edges().filter_by(...)`.
4. **Boolean Epsilon Rules**: If a `StdFail_NotDone` crash occurs, you likely have zero-thickness walls from overlapping subtractive boundaries. Ensure `eps=0.01` is applied to subtractive shapes so they pierce cleanly.
5. **Thread Metadata Safety**: Do not remove, rename, or silently replace thread parameters while repairing topology. A bare M10 callout may infer 1.5 mm coarse pitch, but missing depth, length, tolerance, or tap-drill values must remain unresolved.
6. **Output Format**: Return the ENTIRE valid Python file text block. Do not output snippets or incomplete reconstructions.
""".strip()

# -- Regex ---------------------------------------------------------------------

_CODE_FENCE_RE = re.compile(r"```(?:scad|openscad|text|python)?\s*(.*?)```", re.I | re.S)
_CODE_START_RE = re.compile(
    r"(?m)^(?:import\s+|from\s+|PARAMETERS\s*=)"
)


# -- Service -------------------------------------------------------------------

class LLMCodegenService:
    """Stateless AI orchestration service wrapping the UniversalHTTPXGateway."""

    MAX_RETRIES = 3

    def __init__(self, model: str | None = None) -> None:
        self._load_env()
        self.gateway = UniversalHTTPXGateway()
        self.model_id = model or os.getenv("GENAI_MODEL", "gemini-3.5-flash")
        
        self.primary_metadata = get_model_by_id(self.model_id)
        if not self.primary_metadata:
            # Fallback if unknown model
            self.primary_metadata = get_model_by_id("gemini-3.1-flash-lite")
            self.model_id = self.primary_metadata.id

    # -- Private helpers ---------------------------------------------------------

    @staticmethod
    def _load_env() -> None:
        try:
            from dotenv import load_dotenv
            load_dotenv(Path(__file__).resolve().parents[3] / ".env")
        except Exception:
            pass

    async def _call_with_retry(self, fn: Callable[[Any], Coroutine[Any, Any, str]], label: str) -> str:
        """Execute `fn(metadata)` up to MAX_RETRIES times with auto-fallback."""
        last_exc: Exception | None = None
        current_metadata = self.primary_metadata

        for attempt in range(self.MAX_RETRIES):
            try:
                response = await fn(current_metadata)
                return response or ""
            except Exception as exc:
                last_exc = exc
                if attempt == 0 and current_metadata.fallbackModelId:
                    fallback_id = current_metadata.fallbackModelId
                    fallback_metadata = get_model_by_id(fallback_id)
                    if fallback_metadata:
                        print(f"[{label}] Attempt {attempt} failed. Auto-falling back to {fallback_id}.")
                        current_metadata = fallback_metadata
                await asyncio.sleep(2 ** attempt)

        raise RuntimeError(
            f"[{label}] failed after {self.MAX_RETRIES} attempts: {last_exc}"
        )

    @staticmethod
    def _normalize_script(raw: str) -> str:
        """Strip markdown fences and leading prose from a raw LLM response."""
        if not raw:
            return ""

        fences = _CODE_FENCE_RE.findall(raw)
        
        text = raw
        if fences:
            cad_fences = [f for f in fences if "import build123d" in f or "from build123d" in f or "PARAMETERS" in f]
            if cad_fences:
                text = max(cad_fences, key=len)
            else:
                text = max(fences, key=len)

        cleaned = text.strip().strip("`").strip()

        m = _CODE_START_RE.search(cleaned)
        if m:
            cleaned = cleaned[m.start():].strip()

        return cleaned

    @staticmethod
    def _extract_json_payload(raw: str) -> dict[str, Any]:
        """Extract the first valid JSON object from a model response."""
        if not raw or not raw.strip():
            raise ValueError("The audit model returned an empty response.")

        text = raw.strip()
        fences = _CODE_FENCE_RE.findall(text)
        candidates = [text, *fences]

        decoder = json.JSONDecoder()
        for candidate in candidates:
            candidate = candidate.strip().strip("`").strip()
            try:
                parsed = json.loads(candidate)
                if isinstance(parsed, dict):
                    return parsed
            except json.JSONDecodeError:
                pass

            for match in re.finditer(r"\{", candidate):
                try:
                    parsed, _ = decoder.raw_decode(candidate[match.start():])
                except json.JSONDecodeError:
                    continue
                if isinstance(parsed, dict):
                    return parsed

        raise ValueError("No valid JSON object was found in the audit response.")

    @staticmethod
    def _iter_feature_dicts(feature_map: dict[str, Any]) -> Iterator[dict[str, Any]]:
        """Yield feature dictionaries from common feature-map containers."""
        visited: set[int] = set()

        def _walk(value: Any) -> Iterator[dict[str, Any]]:
            if isinstance(value, dict):
                object_id = id(value)
                if object_id in visited:
                    return
                visited.add(object_id)

                if any(key in value for key in ("type", "feature_type", "thread")):
                    yield value

                for key, child in value.items():
                    if key in {"thread", "confidence"}:
                        continue
                    yield from _walk(child)
            elif isinstance(value, list):
                for child in value:
                    yield from _walk(child)

        yield from _walk(feature_map.get("features", []))

    @staticmethod
    def _append_unique_text(container: dict[str, Any], key: str, value: str) -> None:
        items = container.setdefault(key, [])
        if not isinstance(items, list):
            items = []
            container[key] = items
        if value not in items:
            items.append(value)

    @staticmethod
    def _first_non_empty_text(*values: Any) -> str | None:
        for value in values:
            if isinstance(value, str) and value.strip():
                return value.strip()
        return None

    @classmethod
    def _normalize_thread_feature(cls, feature: dict[str, Any]) -> None:
        """Apply deterministic standards-based defaults to extracted threads.

        The LLM remains responsible for reading the blueprint and associating the
        callout with geometry. This method only normalizes explicit or confidently
        identified thread records; it never creates depth, tolerance, or target
        geometry that was not present in the drawing.
        """
        feature_type = str(feature.get("type") or feature.get("feature_type") or "").lower()
        thread_value = feature.get("thread")
        thread: dict[str, Any] = thread_value if isinstance(thread_value, dict) else {}

        source_callout = cls._first_non_empty_text(
            thread.get("source_callout"),
            thread.get("raw_callout"),
            thread.get("normalized_callout"),
            feature.get("thread_callout"),
            feature.get("callout"),
        )

        description = feature.get("description") if isinstance(feature.get("description"), str) else ""
        candidate_text = source_callout or description
        is_thread_candidate = (
            bool(thread)
            or "thread" in feature_type
            or bool(candidate_text and _THREAD_MARKER_RE.search(candidate_text))
        )
        if not is_thread_candidate:
            return

        if not isinstance(thread_value, dict):
            feature["thread"] = thread

        if source_callout:
            thread.setdefault("source_callout", source_callout)

        bare_match = _BARE_METRIC_THREAD_RE.fullmatch(source_callout or "")
        if bare_match is None and not source_callout and description:
            bare_match = _EMBEDDED_BARE_METRIC_THREAD_RE.search(description)
            if bare_match:
                source_callout = bare_match.group(0).replace(" ", "")
                thread.setdefault("source_callout", source_callout)

        if bare_match is not None:
            diameter = float(bare_match.group("diameter").replace(",", "."))
            pitch = _ISO_METRIC_COARSE_PITCH_MM.get(diameter)

            thread.setdefault("thread_standard", "ISO_METRIC")
            thread.setdefault("thread_family", "M")
            thread.setdefault("nominal_diameter", diameter)
            thread.setdefault("diameter_unit", "mm")

            if pitch is not None and thread.get("pitch") in (None, ""):
                thread["pitch"] = pitch
                thread.setdefault("pitch_unit", "mm")
                thread["pitch_source"] = "standard_coarse_pitch_inference"
                thread["normalized_callout"] = f"M{diameter:g} × {pitch:g}"
                cls._append_unique_text(thread, "inferred_fields", "pitch")
                cls._append_unique_text(
                    thread,
                    "warnings",
                    f"Pitch omitted; inferred preferred ISO metric coarse pitch {pitch:g} mm.",
                )
            elif pitch is None and thread.get("pitch") in (None, ""):
                cls._append_unique_text(thread, "unresolved_fields", "pitch")
                cls._append_unique_text(
                    thread,
                    "warnings",
                    f"No preferred coarse pitch is registered for M{diameter:g}; pitch remains unresolved.",
                )

            if not thread.get("handedness"):
                thread["handedness"] = "right"
                thread["handedness_source"] = "standard_default"
                cls._append_unique_text(thread, "inferred_fields", "handedness")

            if not thread.get("number_of_starts"):
                thread["number_of_starts"] = 1
                thread["number_of_starts_source"] = "standard_default"
                cls._append_unique_text(thread, "inferred_fields", "number_of_starts")

            if (
                thread.get("lead") in (None, "")
                and isinstance(thread.get("pitch"), (int, float))
                and isinstance(thread.get("number_of_starts"), int)
            ):
                thread["lead"] = float(thread["pitch"]) * int(thread["number_of_starts"])
                thread["lead_source"] = "derived_from_pitch_and_starts"
                cls._append_unique_text(thread, "inferred_fields", "lead")

        # Geometry/context determines internal vs external. A standard designation
        # such as M10 alone cannot decide this.
        internal_or_external = str(thread.get("internal_or_external") or "").lower()
        if internal_or_external not in {"internal", "external"}:
            internal_tokens = ("thread_internal", "hole", "bore", "tap")
            external_tokens = ("thread_external", "shaft", "stud", "bolt")
            if any(token in feature_type for token in internal_tokens):
                thread["internal_or_external"] = "internal"
                thread["internal_external_source"] = "feature_geometry_context"
            elif any(token in feature_type for token in external_tokens):
                thread["internal_or_external"] = "external"
                thread["internal_external_source"] = "feature_geometry_context"
            else:
                cls._append_unique_text(thread, "unresolved_fields", "internal_or_external")
                cls._append_unique_text(
                    thread,
                    "warnings",
                    "Could not determine whether the thread is internal or external from the associated geometry.",
                )

        if not thread.get("thread_class"):
            cls._append_unique_text(thread, "unresolved_fields", "thread_class")
            cls._append_unique_text(
                thread,
                "warnings",
                "Thread tolerance class was not specified in the callout or resolved from general notes.",
            )

        resolved_kind = str(thread.get("internal_or_external") or "").lower()
        through_or_blind = str(thread.get("through_or_blind") or "").lower()
        if resolved_kind == "internal":
            has_thread_depth = any(
                thread.get(key) not in (None, "")
                for key in ("full_thread_depth", "thread_depth", "thread_length")
            )
            if through_or_blind not in {"through", "thru"} and not has_thread_depth:
                cls._append_unique_text(thread, "unresolved_fields", "full_thread_depth")
                cls._append_unique_text(
                    thread,
                    "warnings",
                    "Full thread depth was not specified; no arbitrary blind-thread depth may be generated.",
                )
        elif resolved_kind == "external":
            if thread.get("thread_length") in (None, ""):
                cls._append_unique_text(thread, "unresolved_fields", "thread_length")
                cls._append_unique_text(
                    thread,
                    "warnings",
                    "External thread length was not specified.",
                )

        unresolved = thread.get("unresolved_fields")
        thread["requires_user_confirmation"] = bool(isinstance(unresolved, list) and unresolved)

    @classmethod
    def _normalize_feature_map(cls, feature_map: dict[str, Any]) -> dict[str, Any]:
        """Normalize thread records without inventing blueprint geometry."""
        for feature in cls._iter_feature_dicts(feature_map):
            cls._normalize_thread_feature(feature)

        feature_map.setdefault("audit_schema_version", _AUDIT_SCHEMA_VERSION)
        return feature_map

    # -- Public API ------------------------------------------------------------

    async def audit_blueprint(
        self,
        image_bytes: bytes,
        mime_type: str,
    ) -> dict[str, Any]:
        """
        Stage 1 - Analyse a blueprint image/PDF and return a detailed structured JSON feature map.
        """
        file_hash = hashlib.sha256(_AUDIT_SCHEMA_VERSION.encode("utf-8") + image_bytes).hexdigest()
        with _BLUEPRINT_CACHE_LOCK:
            if file_hash in _BLUEPRINT_CACHE:
                return _BLUEPRINT_CACHE[file_hash]

        async def _call(metadata) -> str:
            return await self.gateway.generate(
                prompt="Extract technical drawing features map JSON matching the strict schema.",
                metadata=metadata,
                system_instruction=AUDIT_INSTRUCTION,
                image_bytes=image_bytes,
                mime_type=mime_type,
                response_json=True
            )

        raw = await self._call_with_retry(_call, "audit")
        try:
            result = self._extract_json_payload(raw)
            result = self._normalize_feature_map(result)
            with _BLUEPRINT_CACHE_LOCK:
                _BLUEPRINT_CACHE[file_hash] = result
            return result
        except (TypeError, ValueError, json.JSONDecodeError) as exc:
            print(f"[audit] Failed to parse or normalize feature-map JSON: {exc}")
            return {}

    async def generate_script(
        self,
        prompt: str,
        image_bytes: bytes | None = None,
        mime_type: str | None = None,
        feature_map: dict[str, Any] | str | None = None,
        base_code: str | None = None,
    ) -> str:
        """
        Stage 2 - Synthesise or refine a build123d Python script.
        """
        parts: list[str] = [f"REQUEST: {prompt}"]

        if feature_map:
            if isinstance(feature_map, dict):
                parts.append(f"FEATURE_MAP:\n{json.dumps(feature_map, indent=2)}")
            else:
                parts.append(f"BLUEPRINT_AUDIT_REPORT:\n{feature_map}")

        if base_code:
            parts.append(f"EXISTING_CODE_TO_REFINE:\n{base_code}")

        user_text = "\n\n".join(parts)
        sys_instr = EDIT_SYSTEM_INSTRUCTION if base_code else SYSTEM_INSTRUCTION

        async def _call(metadata) -> str:
            return await self.gateway.generate(
                prompt=user_text,
                metadata=metadata,
                system_instruction=sys_instr,
                image_bytes=image_bytes,
                mime_type=mime_type,
            )

        raw = await self._call_with_retry(_call, "codegen")
        return self._normalize_script(raw)

    async def generate_script_stream(
        self,
        prompt: str,
        image_bytes: bytes | None = None,
        mime_type: str | None = None,
        feature_map: dict[str, Any] | str | None = None,
        base_code: str | None = None,
    ):
        """
        Stage 2 - Synthesise or refine a build123d Python script, yielding chunks.
        """
        parts: list[str] = [f"REQUEST: {prompt}"]
        if feature_map:
            if isinstance(feature_map, dict):
                parts.append(f"FEATURE_MAP:\n{json.dumps(feature_map, indent=2)}")
            else:
                parts.append(f"BLUEPRINT_AUDIT_REPORT:\n{feature_map}")
        if base_code:
            parts.append(f"EXISTING_CODE_TO_REFINE:\n{base_code}")

        user_text = "\n\n".join(parts)
        sys_instr = EDIT_SYSTEM_INSTRUCTION if base_code else SYSTEM_INSTRUCTION

        current_metadata = self.primary_metadata
        response_stream = None
        last_exc: Exception | None = None

        for attempt in range(self.MAX_RETRIES):
            try:
                response_stream = self.gateway.generate_stream(
                    prompt=user_text,
                    metadata=current_metadata,
                    system_instruction=sys_instr,
                    image_bytes=image_bytes,
                    mime_type=mime_type,
                )
                break
            except Exception as exc:
                last_exc = exc
                if attempt == 0 and current_metadata.fallbackModelId:
                    fallback_id = current_metadata.fallbackModelId
                    fallback_metadata = get_model_by_id(fallback_id)
                    if fallback_metadata:
                        print(f"[codegen stream] Attempt {attempt} failed. Auto-falling back to {fallback_id}.")
                        current_metadata = fallback_metadata
                await asyncio.sleep(2 ** attempt)
        
        if not response_stream:
            raise RuntimeError(f"[codegen_stream] failed after {self.MAX_RETRIES} attempts: {last_exc}")

        complete_text = ""
        async for chunk in response_stream:
            if chunk:
                complete_text += chunk
                yield chunk

        try:
            outputs_dir = Path(__file__).resolve().parents[3] / "outputs"
            outputs_dir.mkdir(parents=True, exist_ok=True)
            with open(outputs_dir / "latest_generated_script.py.txt", "w", encoding="utf-8") as f:
                f.write(complete_text)
        except Exception as e:
            print(f"Failed to write debug script: {e}")

    async def edit_script(
        self,
        prompt: str,
        current_code: str,
        target_point: list[float] | None = None,
    ) -> str:
        """
        Surgically edit an existing build123d Python script based on a user prompt.
        """
        user_prompt = prompt
        if target_point and len(target_point) == 3:
            x, y, z = target_point
            user_prompt += f"\n\n[System Context: The user clicked on the 3D mesh at absolute coordinates X: {x}, Y: {y}, Z: {z}. Use this exact spatial location as the origin/target for the requested modification.]"

        user_text = f"CURRENT_CODE:\n{current_code}\n\nUSER_REQUEST:\n{user_prompt}"

        async def _call(metadata) -> str:
            return await self.gateway.generate(
                prompt=user_text,
                metadata=metadata,
                system_instruction=EDIT_SYSTEM_PROMPT,
            )

        raw = await self._call_with_retry(_call, "edit")
        return self._normalize_script(raw)

    async def repair_script(
        self,
        current_code: str,
        error_log: str,
    ) -> str:
        """
        Stage 3 - Auto-heal a broken build123d Python script.
        """
        user_text = f"CURRENT_CODE:\n{current_code}\n\nERROR_LOG:\n{error_log}"

        async def _call(metadata) -> str:
            return await self.gateway.generate(
                prompt=user_text,
                metadata=metadata,
                system_instruction=REPAIR_SYSTEM_PROMPT,
            )

        raw = await self._call_with_retry(_call, "repair")
        return self._normalize_script(raw)
