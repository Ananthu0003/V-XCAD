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
_AUDIT_SCHEMA_VERSION = "revolve-aware-v7"

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
Before outputting any JSON, you MUST perform a deep visual audit of the blueprint using a `<scratchpad>` block. Inside the scratchpad, you MUST explicitly trace the Z-dimensions and calculate the Wall Thickness at every Z-step to prove your topology is physically possible. Only after this analysis, output a valid JSON feature-map matching the exact schema below, wrapped in ```json ... ``` tags.
# ROLE: Precision Mechanical CAD Auditor & Spatial Topologist
Analyze the provided multi-view technical drawing with tolerance-aware manufacturing rigor.
## 1. COORDINATE SYSTEM CONSTRAINTS
- **Origin**: Place (0,0,0) at the absolute bottom-center of the primary datum body for symmetric stability.
- **Z-Axis**: Points UPWARD (+Z). Face pockets, blind steps, and through-boring occur relative to this axis.
- **Rationale**: State the exact placement logic in `origin_rationale`.

## 2. FEATURE TAXONOMY
- **ADDITIVE**: `base_prismoid`, `base_cylinder`, `mounting_ear`, `alignment_boss`, `reinforcement_rib`, `spherical_dome`, `revolved_profile`, `complex_shell`
- **SUBTRACTIVE**: `pocket_interior`, `step_shoulder`, `counterbore`, `hole_through`, `hole_blind`, `thread_internal`, `oring_groove`, `revolved_cutout`
- **SURFACE / MANUFACTURING**: `thread_external`
- **EDGE_MODIFIER**: `fillet_interior`, `chamfer_exterior`, `edge_treatment`
- **MANUFACTURING_METADATA**: Ensure you capture any specific `material`, `surface_treatments`, `general_tolerances`, and `gdt_callouts`.
- **COMPLEX GEOMETRY (Gears/Serrations)**: For features like gears, splines, or taper serrations, DO NOT attempt to trace every tooth in the 2D profile. Model the nominal blank geometry (e.g., the major/minor cylindrical boundary) and attach the specific callout (e.g., "Taper Serrations INT 2 5/32x48 STD") as a `manufacturing_metadata` or `surface_treatment` field so the CAM system can handle the tooling path.

## 3. MACHINING & DIMENSIONAL RULES
- **Profile Decompositions**: For parts with asymmetric or multi-angular walls (e.g., specific draft angles like 33°, 40°, 22° shifts), capture the exact 2D coordinate paths outlining the perimeter.
- **Z-Reference & Coordinate Independence (CRITICAL)**: Every feature must declare an exact `z_reference`: `"bottom_of_feature"`, `"top_of_feature"`, or `"absolute_zero"`. You MUST measure the Z-depth of internal bores and external profiles explicitly from the SAME global datum (e.g., Z=0 at one end). DO NOT assume internal bore steps align with external profile steps! For example, a large internal counterbore might extend deep into the small external shaft. If you wrongly assume the internal bore stops where the external profile steps down, you will ruin the part's wall thickness and topology. Map every single Z-height strictly to the dimension lines provided, completely independent of other features.
- **Revolved / Lathe Parts (CONTOUR TRACING IS MANDATORY)**: You MUST trace the full outer contour sequentially from Z=0 to the end. Capture every diameter change as an array of `[radius, z_height]` points in `profile_points`. CRITICAL TRACING RULES: 1. **Follow the Arrowhead EXACTLY**: In section views, dimensions below the centerline can point to BOTH inner and outer profiles! If the arrowhead touches the FIRST solid line near the centerline, it is the INNER bore. If the arrowhead crosses the hatched material and touches the FARTHEST solid line, it is the OUTER profile! 2. **Angles vs Diameters**: NEVER mistake an angle (e.g., `10°` or `45°`) for a diameter! Angles define chamfers/tapers. 3. **Topological Sanity Check (MANDATORY)**: Before you output the JSON, you MUST mentally calculate the wall thickness at every Z-height: `Wall Thickness = Outer_Radius - Inner_Radius`. If this value is negative (e.g., you assigned an outer `Ø20.5` to the inner bore, and an outer profile of `16.975`), you have created a physical impossibility! A solid part CANNOT have an inner bore larger than its outer boundary! If you detect a negative wall thickness, YOU HAVE SWAPPED THE DIMENSIONS. You MUST re-evaluate your assignments and fix the overlap before generating the JSON! 4. **Gasket/Working Areas**: Text like `38 GASKET WORKING AREA` pointing to the outer surface means the outer profile maintains the specified diameter for that Z-length. Do not skip these major cylindrical sections!
- **Half-Section Views (ANTI-HALLUCINATION)**: NEVER interpret crosshatching on the top or bottom half of a symmetric part as a physical cutout or slot! Half-sections are drafting conventions used to expose internal geometry (like bores and internal threads). The physical part remains fully cylindrical/symmetric! However, you MUST explicitly extract the internal geometry (bores, internal threads) shown inside the half-section as `revolved_cutout` or `hole_blind` features. Do not ignore them.
- **INTERNAL VS EXTERNAL DIMENSIONING (CRITICAL)**: In Half-Section views (like Section AA), you MUST carefully distinguish which lines a dimension points to! Dimensions whose leader lines point to the OUTER solid boundaries (above the center line or outside the hatching) define the OUTER profile (e.g., Flanges, Shafts). Dimensions whose leader lines point to the INNER empty channel (the white space in the middle) define the INTERNAL bores. NEVER classify an outer dimension (like a 20.5 shaft diameter) as an internal bore! If you subtract an outer diameter from the inside, you will completely cut the part in half!
- **Solid vs Cavity (Hatching Rule)**: Leader lines ending on hatched regions ALWAYS indicate solid material boundaries (Outer profile). 
- **Piston Exterior Features (CRITICAL)**: "GASKET WORKING AREA" and "O-RING GROOVES" are strictly exterior features on pistons and shafts. If you see "38 GASKET WORKING AREA", it refers to the OUTER shaft surface. DO NOT hallucinate this as an internal chamber depth!
- **Z-Axis Chaining (WARNING)**: Pay extreme attention to the difference between a position (e.g., "6.0 from the left face") and a width (e.g., "6.3 groove width"). Do not swap them when calculating Z-coordinates!
- **Right-Datum & Dimension Origin Alignment (CRITICAL)**: When a dimension is given from the opposite/right end face of a part (e.g. `57.2 from right face`), its absolute global Z-coordinate starting from the left origin (Z=0) MUST be calculated directly as: `z_pos = total_length - right_dim`. Never subtract internal middle section lengths or compound deductions from it! Keep datum conversions clean and direct.
- **End Face Steps & Recesses (MANDATORY 2D PROFILES)**: When detail views show an end-face step or recess (e.g., a `2.0mm deep` recess with `R2.0` blend radius on a shaft face), you MUST include the axial step directly in the 2D `profile_points` array (or as a subtractive `counterbore`). Never leave an end face flat if a detail view explicitly dimensions a face recess!
- **Conical Internal Bores & Angle Tracing**: In Section views, when bore entries or internal diameter transitions specify an angle (e.g. `60°` entry cone or `120°` transition cone), trace the angled coordinate vertices directly in `profile_points`. Do NOT approximate complex angled internal tapers with generic 45° 3D chamfers.
- **Missing Outer Steps (CRITICAL)**: You MUST carefully trace every single diameter change on the outer profile. Do not jump straight from a large collar (e.g., Dia 25.0) to a small shaft (e.g., Dia 16.975) if there is an intermediate step (e.g., Dia 20.5) and a taper (e.g., 20 degrees) in between! Missing these intermediate steps ruins the geometric constraints.
- **NO MAGIC NUMBERS IN PROFILES**: Never hardcode a distance like `total_length - 25.0` in your `bd.Polygon` points unless `25.0` was explicitly extracted to the `PARAMETERS` dictionary as a named variable. Use mathematically derived positions based on your extracted parameters (like subtracting the `gasket_working_area` length from the total length).

- **Complex Stepped Bores (MANDATORY)**: If an internal bore has multiple steps, tapers, or complex transitions (like stepping from Dia 17.4 to 14 to 13.5 to 10), do NOT attempt to extract it as multiple overlapping `hole_blind` or `cylinder` subtractions. You MUST extract the ENTIRE internal channel as a single `revolved_cutout` feature with a complete `profile_points` array, mapping the X (radius) and Y (Z-length) coordinates of the inner bore exactly as you would for the outer profile. This guarantees a clean, continuous inner channel without boolean errors.
- **Implicit Heights & Deduced Dimensions**: If a block or boss doesn't have an explicit total height, deduce it from its subtractive features or alignments. For example, if a U-slot has a depth of 25 to the center of an R9.5 arc, its total cut depth is 34.5. If the bottom of this slot aligns with an adjacent 28mm thick base, the block's total height must be 28 + 34.5 = 62.5. NEVER assume a block is flush with an adjacent base if the orthographic views show it protruding higher!
- **Keyways & Slots**: Look for discrete keyway slots (width and length) often shown on shafts or flanges. Ensure you capture them as distinct subtractive features (e.g. `pocket_interior`), NOT just generic holes. Do NOT miss them! CRITICAL: If a keyway is dimensioned from the opposite side of a bore (e.g., dimension `41` across a `Ø38` bore), calculate the depth from center accurately (`41 - (38/2) = 22`). Do not invent standard keyway depths.
- **Edge Cutouts & U-Slots**: Carefully examine the ends of arms, flanges, and blocks. If you see a U-shaped cutout (e.g. an open slot with a full radius bottom like R9.5 and width 19), you MUST extract it as a subtractive `pocket_interior` or `slot_through`. Do not ignore these! Measure their depth and width from the specific orthographic views (like the front or section views).
- **Hidden & Internal Subtractions (CRITICAL)**: You MUST carefully scan all section views, detail views, and dashed hidden lines for ANY material removal. Every internal bore, countersink, counterbore, groove, chamfer, and intersecting hole MUST be explicitly listed as a subtractive feature. Do not skip smaller cutting portions or assume they are implied by a larger bore. Look closely at cross-sections to find hidden stepped cuts.
- **Radial / Cross-Holes (DEPTH VS POSITION WARNING)**: Look for holes drilled into the side of a cylindrical part (perpendicular to the main axis). You MUST capture these as `hole_blind` or `hole_through` features and assign them a specific 3D location and direction (e.g., `direction: [1, 0, 0]`) so they are cut sideways into the part. Pay EXTREME ATTENTION to the difference between a positional dimension (how far the hole is along the shaft) and the actual depth of the hole (how deep it cuts into the material, e.g. `0.220" Deep`). NEVER mistake a positional dimension for a hole depth!
- **DETAIL VIEWS (CRITICAL MULTI-FEATURE EXTRACTION)**: When a blueprint includes magnified DETAIL views (e.g., DETAIL B, C, D, E), these contain CRITICAL micro-geometry (chamfers, multiple grooves, angled transitions, precise radii) that are too small to see in the main view! You MUST meticulously extract EVERY SINGLE micro-feature shown in every detail view. For example, if a detail view shows TWO adjacent O-ring grooves, you must extract BOTH of them. If it shows a 20-degree transition with an R0.2 fillet, you must calculate the exact coordinate points for that slope. DO NOT skim over detail views or simplify them! Missing a micro-feature from a detail view is a fatal error.
- **EDGE TREATMENT EXTRACTION (MANDATORY)**: For EVERY fillet radius (R0.2, R0.3, R0.4, R0.7, etc.) and chamfer (CxD, Cx45°) visible in ANY detail view or section view, you MUST create a SEPARATE `edge_treatment` feature in the features array. Each `edge_treatment` must specify: `treatment_type` ("fillet" or "chamfer"), the `radius` or `size`, the `z_position` where it occurs on the main axis, whether it applies to an "outer", "inner", or "groove" edge via `target_edge`, the `parent_id` of the feature it modifies, and `source_view` indicating which Detail View it was extracted from (e.g., "DETAIL-D"). Do NOT lump multiple edge treatments into a single feature — EVERY SINGLE fillet or chamfer gets its own feature entry. If you see R0.2, R0.4, and R0.7 in Detail-D alone, that is THREE separate `edge_treatment` features. The code generator downstream RELIES on these to apply `bd.fillet()` and `bd.chamfer()` — if you omit them, the 3D model will have sharp corners where the blueprint specifies radii!
- **Feature Separation & Double-Subtraction (ANTI-HALLUCINATION)**: If you extract a micro-groove, undercut, or thread as a separate subtractive feature (e.g. `oring_groove`, `thread_external`, `revolved_cutout`), its parent `revolved_profile` MUST remain a solid cylinder across that Z-range! Do NOT dip the parent's `profile_points` inward to model the groove, because the separate subtractive feature will cut it out later. Doing both causes a fatal double-subtraction error.
- **Angled Profiles & Internal Tapers (ANTI-HALLUCINATION)**: Internal bores are almost never just flat stepped cylinders! Look closely at section views and details for angled transitions, chamfers, or tapered drafts. If a `revolved_cutout` or `revolved_profile` has an angled feature (e.g., a 20° undercut, a 60° chamfer), YOU MUST trace the exact angled geometry in `profile_points`. DO NOT simplify them into flat rectangles! Use trigonometry in your `<scratchpad>` to calculate the exact X (radius) and Y (height) coordinates of the angled points based on the given angle and adjacent dimensions.
- **Dual Dimensioning (Inches & mm)**: If a blueprint contains dual dimensions (e.g. `1.177 [29.896]`), you MUST standardize on a single unit system (preferably millimeters) for your entire JSON output. NEVER mix metric and imperial numbers! Pay extreme attention to distinguishing between radius and diameter values when resolving dimensions.

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
  "material": "SAE 1144 / 45MF6",
  "surface_treatments": ["HARDEN & TEMPER TO HRc 45 to 50"],
  "general_tolerances": "LINEAR 0.00 +/-0.01, ANGULAR +/-2 deg",
  "gdt_callouts": [
    {"type": "runout", "tolerance": "0.03", "datum": "A", "target": "body_main"}
  ],
  "envelope": { "x_total": 116.50, "y_total": 78.61, "z_total": 14.00 },
  "primary_datum": { "id": "body_main", "type": "base_prismoid" },
  "features": [
    {
      "id": "body_main",
      "type": "revolved_profile",
      "description": "Main stepped shaft body.",
      "dims": {
        "profile_points": [
          [0.0, 0.0],
          [20.0, 0.0],
          [20.0, 50.0],
          [15.0, 50.0],
          [15.0, 80.0],
          [0.0, 80.0]
        ]
      },
      "location": { "x": 0.0, "y": 0.0, "z": 0.0, "z_reference": "bottom_of_feature" },
      "is_subtractive": false,
      "parent_id": null,
      "surface_finish": "Ra 3.2",
      "dimensional_tolerances": {"diameter": "+0.018/-0.002"},
      "confidence": "verified"
    },
    {
      "id": "internal_stepped_bore",
      "type": "revolved_cutout",
      "description": "Internal stepped bore with three diameters and a chamfer.",
      "dims": {
        "profile_points": [
          [0.0, 0.0],
          [5.0, 0.0],
          [5.0, 10.0],
          [6.75, 10.0],
          [6.75, 30.0],
          [8.7, 30.0],
          [8.7, 50.0],
          [0.0, 50.0]
        ]
      },
      "location": { "x": 0.0, "y": 0.0, "z": 0.0, "z_reference": "bottom_of_feature" },
      "is_subtractive": true,
      "parent_id": "body_main",
      "surface_finish": "Ra 1.6",
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
    },
    {
      "id": "fillet_bore_step_1",
      "type": "edge_treatment",
      "description": "R0.7 fillet at the bore step transition from D17.4 to D14.",
      "dims": {
        "treatment_type": "fillet",
        "radius": 0.7,
        "z_position": 11.5,
        "target_edge": "inner"
      },
      "location": { "x": 0.0, "y": 0.0, "z": 11.5, "z_reference": "absolute_zero" },
      "is_subtractive": false,
      "parent_id": "internal_stepped_bore",
      "source_view": "DETAIL-D",
      "confidence": "verified"
    },
    {
      "id": "chamfer_right_outer_1",
      "type": "edge_treatment",
      "description": "1.4mm chamfer on the right-most outer edge.",
      "dims": {
        "treatment_type": "chamfer",
        "size": 1.4,
        "z_position": 80.0,
        "target_edge": "outer"
      },
      "location": { "x": 0.0, "y": 0.0, "z": 80.0, "z_reference": "absolute_zero" },
      "is_subtractive": false,
      "parent_id": "body_main",
      "source_view": "DETAIL-B",
      "confidence": "verified"
    }
  ],
  "patterns": []
}
```

## 6. SEVERE VALIDATION GATE

* Do not output any markdown code fences, conversational prose, or warning summaries. Return pure, parsable JSON text only.
* **Edge Treatment Completeness**: Before finalizing, count how many DETAIL views (DETAIL-A, B, C, D, E, etc.) are present in the blueprint. Each detail view typically contains 2-4 edge treatments (fillets and chamfers). If your `features` array contains ZERO `edge_treatment` entries despite detail views being present, you have MISSED critical features — re-examine every detail view and extract all fillets and chamfers as separate `edge_treatment` features.
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
*(CRITICAL: Do NOT use hallucinated attributes like `p1.end_point` or `p1.start_point` to chain curves. They do not exist and will crash. To get the start/end coordinates of a line `p1`, you MUST use parameterization: `p1 @ 0` for the start point and `p1 @ 1` for the end point, or explicitly re-type the coordinate tuple!)*

**2D Sketches (inside `with bd.BuildSketch():`)**
- `bd.make_face()` (converts active BuildLine sequence into a face)
- `bd.Circle(radius: float)`
- `bd.Rectangle(width: float, height: float)`
- `bd.RegularPolygon(radius: float, side_count: int)`
- `bd.SlotOverall(width: float, height: float)` (CRITICAL: width MUST be > height. If you pass width=19 and height=69, it WILL CRASH with ValueError! You MUST pass width=69, height=19 and use `with bd.Locations(bd.Rotation(0, 0, 90)):` to rotate it vertical.)
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
- NEVER use the `*` operator to place objects (e.g. `bd.Location(...) * bd.Cylinder(...)`). This crashes with `TypeError: Multiplied(): incompatible function arguments`. ALWAYS use `with bd.Locations(...):`.
- NEVER use `with bd.Rotation(...):`. Use `with bd.Locations(bd.Rotation(...)):`.
- NEVER revolve a profile that crosses the axis of revolution. (e.g., If revolving around Z, the sketch must be entirely on `X >= 0`. Use `bd.Align.MIN` for X, NOT `bd.Align.CENTER`).
- NEVER write multiple `with bd.BuildPart():` blocks or restart your approach mid-script. Think it through in the SPATIAL PLAN and write it once.
- NEVER nest `with bd.BuildSketch():` inside another `BuildSketch`.
- NEVER call 3D operations (`bd.extrude`, `bd.revolve`, `bd.sweep`, `bd.loft`) inside a `BuildSketch`. They MUST be called directly under `with bd.BuildPart():`.
- NEVER use `axis=...` or `rotation=...` in 3D Primitives (like `bd.Cylinder` or `bd.Box`). Use `with bd.Locations(bd.Rotation(...)):` instead.
- **CRITICAL**: 3D Primitives (`bd.Cylinder`, `bd.Box`, etc.) default to `bd.Align.CENTER` on all axes. If you want a part to sit *on top* of a plane and grow upwards, you MUST explicitly pass `align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN)`. Otherwise, your parts will float mid-air or intersect the floor!
- **CRITICAL - bd.Cylinder SUBTRACTION**: If you MUST use `bd.Cylinder` as a subtractive cutter (e.g., for a through-bore starting at Z=0), you MUST set `align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN)` AND place it at `Z=-eps`. If you forget `align.MIN`, the cylinder will be centered at Z=0 and will ONLY CUT HALFWAY up your part, leaving a solid block of material at the top! It is often safer to just use `bd.Hole()`.
- NEVER use `part.sketch` or `part.sketch.vertices()`. To fillet a 2D sketch, capture the object explicitly (e.g., `rect = bd.Rectangle(...)`; `bd.fillet(rect.vertices(), ...)`).
- NEVER filter cylinder edges by `bd.Axis.Z` to find circular top/bottom edges. Circular edges of a Z-extruded cylinder are in the XY plane. Use `.filter_by(bd.GeomType.CIRCLE)` instead.
- NEVER use `bd.GeomType.ARC`. It does not exist in `build123d`. Use `bd.GeomType.CIRCLE` for all circular curves and arcs.
- ALWAYS extract your variables from the `PARAMETERS` dictionary explicitly before using them (e.g., `base_flange_dia = PARAMETERS["base_flange_dia"]`). DO NOT assume they are auto-injected.
- NEVER use `normal=` in `bd.Plane(...)`. Use `z_dir=` instead.
- NEVER use `length=` in `bd.Rectangle(...)`. The correct arguments are `width=` and `height=`.
- NEVER use `bd.GeomType.POINT`. Vertices are inherently points. If you need to fillet a rectangle's corners, just use `bd.fillet(rect.vertices(), radius=...)`.
- **CRITICAL - 2D Primitives in 3D**: NEVER call 2D sketches like `bd.SlotOverall` or `bd.Rectangle` directly inside `with bd.BuildPart():` without an active `BuildSketch`. Doing so returns `None` and causes `AttributeError: 'NoneType' object has no attribute 'moved'`. Always wrap 2D shapes in `with bd.BuildSketch():` and then `bd.extrude()` them!
- **CRITICAL - Vertex Filtering & Local Coordinates**: When you create a shape inside a `with bd.Locations(...):` block, the shape's vertices are returned in the GLOBAL coordinates of the Sketch. DO NOT assume `v.Y < 0` will find the bottom vertices of a shape that was moved to `Y=50`! ALWAYS use `.sort_by(bd.Axis.Y)[0:2]` or similar relative sorting to find bottom/top/left/right edges and vertices!
- **CRITICAL - Extruding Offset Sketches**: `bd.extrude()` ALWAYS extrudes from the exact plane where the `BuildSketch` was created. Wrapping `bd.extrude()` in a `with bd.Locations(...):` block DOES NOTHING to move the sketch! If you need to cut a slot at the end of a block (e.g. from X=85 to X=113), you MUST create the sketch on an offset plane: `with bd.BuildSketch(bd.Plane.YZ.offset(85)):` and then `bd.extrude(...)`.
- **CRITICAL - Extrude Crashes**: If you get `Standard_ConstructionError: BRepSweep_Translation::Constructor` during `bd.extrude()`, you are trying to extrude by an `amount` of 0! Check your depth math! Extrusion amounts must ALWAYS be non-zero!
- **CRITICAL - end_finishes**: The `end_finishes` parameter in `IsoThread` MUST be a tuple of two strings (e.g., `end_finishes=("fade", "fade")`), NEVER a single string (like `"fade"`)!
- **CRITICAL - IsoThread Subtraction**: `IsoThread` is a native primitive! It AUTOMATICALLY adds itself to the active `BuildPart` context when you instantiate it, just like `bd.Cylinder`. Therefore, NEVER pass it to `bd.add()`! To subtract a thread, just instantiate it with `mode=bd.Mode.SUBTRACT` (e.g., `IsoThread(..., mode=bd.Mode.SUBTRACT)`). Using `bd.add(thread)` on an already-instantiated thread will create massive duplicate floating solids in the workspace!
- **Fillet/Chamfer Crashes**: If you get `ValueError: Failed creating a fillet`, your radius is too large for the adjacent faces, OR you selected edges that don't exist. If 3D fillets constantly fail in tight spaces (like relief grooves or keyways), just fillet the 2D sketch BEFORE revolving/extruding, or remove the fillet entirely!
- NEVER nest `bd.PolarLocations` inside `bd.Locations` (e.g., `with bd.Locations(bd.PolarLocations(...))`). `bd.PolarLocations` is already a context manager. Use it directly: `with bd.PolarLocations(...):`.
- NEVER pass a 3D Solid (like `bd.Box`, `bd.Cylinder`, `bd.Sphere`) into `bd.extrude()`. `bd.extrude` is ONLY for 2D Sketches or Faces. To subtract a 3D solid, just instantiate it with the subtract mode: e.g., `bd.Box(..., mode=bd.Mode.SUBTRACT)`.
- NEVER use `bd.Hull()`. The correct function in build123d is `bd.make_hull()`. Also, NEVER pass objects manually to `bd.make_hull([c1, c2])` as this triggers a bug in build123d. Just call `bd.make_hull()` with NO ARGUMENTS to automatically hull the active sketch context.
- NEVER use `plane=...` in `bd.PolarLocations`, `bd.GridLocations`, or `bd.HexLocations`. These do not accept a plane argument. To evaluate locations on a specific plane, chain the contexts: e.g., `with bd.Locations(my_plane): with bd.PolarLocations(...):`.
- **CRITICAL - Bounding Box Diagonal**: NEVER call `diagonal()` as a function on a bounding box. In `build123d`, it is a property! Use `e.bounding_box().diagonal`, not `e.bounding_box().diagonal()`. Calling it as a function causes `TypeError: 'float' object is not callable`.
- **CRITICAL - Edge Center**: NEVER access `center` as a property on an edge. In `build123d`, it is a function! Use `e.center().Z`, not `e.center.Z`. Accessing it as a property causes `AttributeError: 'function' object has no attribute 'Z'`.
- NEVER use `Plane.shifted()`. The correct method to offset a plane in build123d is `Plane.offset()`.
- NEVER use `Plane.z_axis`, `Plane.x_axis`, or `Plane.y_axis`. Planes use `z_dir` and `x_dir`. (DO NOT pass `y_dir` into `bd.Plane(...)`, as it is automatically computed).
- NEVER use `.at_coords(...)` to select faces or edges. It does not exist. Use `.filter_by_position(...)` or `.sort_by_distance(...)` instead.
- **CRITICAL - ShapeList First/Last**: NEVER use `.first()` or `.last()` as methods on edge/face lists (e.g., `edges.first()`). In build123d, `.first` and `.last` are PROPERTIES. Calling them will crash with `TypeError: 'Edge' object is not callable`. ALWAYS use standard python list indexing like `edges[0]` and `edges[-1]`.
- NEVER place polygon vertices exactly on the boundary of another shape if you intend to fuse them. (e.g., If attaching a rib to a cylinder of radius R, place the vertex at R-2, NOT R, to guarantee structural overlap and prevent zero-thickness boolean failures).
- **CRITICAL**: `bd.Hole(depth=D)` ALWAYS cuts in the `-Z` direction of the active Location/Plane. If you place a `bd.Hole` at `Z=0` and your part grows upwards, the hole will cut DOWN into empty space! To cut upwards from the bottom, you must chain a rotation: `with bd.Locations((0, 0, 0)): with bd.Locations(bd.Rotation(180, 0, 0)): bd.Hole(...)`. Also, if your flange extrudes in `+Z` of a plane, a `bd.Hole` on that same plane will cut `-Z` into empty space! Ensure your holes cut *into* the material.
- **CRITICAL**: NEVER subtract a shape whose boundary is EXACTLY coincident with the outer boundary of the part (e.g., subtracting a bore of radius R from a cylinder of radius R). This creates zero-thickness walls and crashes the engine (`StdFail_NotDone`). If a bore cuts completely to the outside edge, make the subtractive shape slightly LARGER (e.g., radius `R + eps`) to ensure a clean cut through the boundary.
- **CRITICAL**: NEVER pass edges or faces from a primitive object (like `cyl.edges()`) into `bd.fillet()` or `bd.chamfer()` after it has been added to the active `BuildPart`. Once a primitive is unioned into a part, its original edges are destroyed! This causes a fatal C++ `NCollection_IndexedDataMap::FindFromKey` crash. ALWAYS extract edges from the active part itself using `part.edges().filter_by(...).sort_by(...)`.
- **Chamfer/Fillet Safety (CRITICAL)**: When applying chamfers or fillets, ensure the length/radius is smaller than the available wall thickness. If chamfering inner and outer edges of a thin tube, their combined chamfer lengths MUST be less than the wall thickness, otherwise the geometry collapses and crashes with `StdFail_NotDone`. If the blueprint implies a chamfer that exceeds the wall thickness, cap the chamfer length programmatically to slightly less than the wall thickness.
- **Edge Treatments**: Actively apply `bd.fillet` and `bd.chamfer` to 3D edges as dictated by the blueprint. Use precise edge selection (e.g. `part.edges().filter_by(bd.GeomType.CIRCLE).sort_by(bd.Axis.Z)`). CRITICAL: NEVER try to carve out 3D fillets by sketching 2D curves (like an R10 arc) and extruding them across a cylinder! Extruding a flat 2D profile across a round cylinder will chop off the entire front face of the cylinder! Always fuse your basic 3D primitives (like Box and Cylinder) first, and then apply a 3D `bd.fillet()` to the intersection edge!
- **NO MAGIC NUMBERS**: NEVER use hardcoded float literals (like `15.0`, `bd.extrude(6.0)`, or `bd.Polygon([(10.0, 20.0)...])`) anywhere in your construction logic. Extract every dimension to the `PARAMETERS` dict at the top.
- **Spherical Domes**: If the blueprint calls for a spherical dome of radius `R` intersecting a base of radius `r_base`, DO NOT fake it with a filleted cylinder! Use `bd.Sphere(radius=R)` and shift its center down along Z to perfectly intersect the base plane. To find the exact Z-shift distance, let Python do the math: `import math` and use `math.sqrt(R**2 - r_base**2)` to calculate the distance from the sphere center to the intersection plane. NEVER hardcode the square root result!
- **Half-Section Views (ANTI-HALLUCINATION)**: NEVER model a cutout or slot through a symmetrical cylinder just because the blueprint shows a half-section view! Half-sections are just drafting conventions to show internal bores and threads. The cylinder MUST remain a full 360-degree revolved solid unless a physical slot is explicitly dimensioned.
- **Internal Stepped Bores**: ALWAYS construct complex internal bores using a single `BuildSketch` with `bd.Polygon` containing the exact `profile_points` array, and then `bd.revolve(axis=bd.Axis.Z, mode=bd.Mode.SUBTRACT)`. Do NOT use multiple `bd.Cylinder` subtractions! Stacking multiple cylinders for a stepped bore often leads to zero-thickness faces and boolean failures (`StdFail_NotDone`).
- **Keyways & Slots**: For keyways ALONG a shaft, use `bd.SlotOverall(width=Length, height=Width)` BUT YOU MUST rotate it 90 degrees using `with bd.Locations(bd.Rotation(0, 0, 90)):` inside the `BuildSketch`! If you don't rotate it 90 degrees, the slot will be cut perpendicularly across the shaft instead of along it!
- **U-Shaped Edge Slots**: To cut an open U-shaped slot at the edge of a part, DO NOT center a `bd.SlotOverall` exactly on the edge unless you offset it. The best way is to create a `bd.SlotOverall` (or `bd.SlotCenterToCenter`) in a `BuildSketch` and place it so that one of its rounded ends hangs completely off the edge of the part into empty space, then `bd.extrude(..., mode=bd.Mode.SUBTRACT)`. Ensure `eps` is added so it cuts cleanly through boundaries.
- **Height Derivations**: When you calculate variables in the PARAMETERS section based on derived heights (e.g. `block_height = base_thickness + slot_depth`), explicitly write out this math and extract it to a dedicated parameter. Never hardcode the summation result in the BuildPart block!
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
# ROLE: Expert Python Parametric CAD Revision Engineer & Surgical Geometric Specialist
You are performing surgical geometric updates on an existing build123d Python script.

## 🎯 IMMUTABILITY & REVISION RULES
1. **Never generate a completely new part from scratch**: Retain the foundational modules, structural identifiers, base geometry, and working operations.
2. **Variable Protection**: You are strictly FORBIDDEN from altering the string spelling or deleting existing variable keys inside the `PARAMETERS` dictionary unless explicitly correcting their numerical values. Changing or removing key names will break the user's React slider system.
3. **Adding New / Missed Features (Grooves, Chamfers, Fillets, Bores, Threads, Steps, Detail Views)**:
   - When the user prompt or `TARGETED_BLUEPRINT_FEATURE_INSPECTION` identifies a missing or incorrect feature (e.g. from Detail Views like DETAIL-D or DETAIL-E), extract the newly introduced dimensions into `PARAMETERS` (e.g. `groove_width`, `groove_depth`, `groove_fillet_r`, `entry_chamfer_size`, `stepped_bore_d2`).
   - Add corresponding descriptive entries to `PARAMETER_METADATA` and 3D spatial points to `ANNOTATIONS`.
   - In the `with bd.BuildPart() as part:` block, surgically insert the required `build123d` operations.
   - For subtractive features (grooves, undercuts, steps), use `bd.revolve(axis=bd.Axis.Z, mode=bd.Mode.SUBTRACT)` with a `BuildSketch(bd.Plane.XZ)` or `bd.Hole()`.
   - Apply the **Epsilon Protocol (`eps = 0.01`)** on all new cutting boundaries to prevent zero-thickness faces and boolean kernel crashes (`StdFail_NotDone`).
4. **Edge Treatments**: When adding fillets or chamfers, use precise edge filtering from the active part (e.g., `part.edges().filter_by(bd.GeomType.CIRCLE).filter_by_position(...)`). Ensure the fillet/chamfer size does not exceed the wall thickness.
5. **Output Format**: Output the ENTIRE updated Python file text block wrapped in ```python ... ``` fences. Partial code snippets or placeholders are completely unacceptable.

__API_CHEATSHEET_AND_RULES__

__THREAD_CAD_RULES__
""".replace(
    "__API_CHEATSHEET_AND_RULES__", API_CHEATSHEET_AND_RULES
).replace(
    "__THREAD_CAD_RULES__", THREAD_CAD_RULES
).strip()

TARGETED_FEATURE_AUDIT_INSTRUCTION = """
# ROLE: Senior Precision Mechanical CAD Auditor & Detail View Specialist
You are performing a TARGETED BLUEPRINT INSPECTION for a specific localized mechanical feature (such as a groove, chamfer, fillet, stepped bore, thread, undercut, or detail view feature) that was flagged by the user.

## MISSION
Instead of reading or summarizing the whole drawing:
1. Locate the specific VIEW or REGION on the drawing that corresponds to the requested feature (e.g. DETAIL B, DETAIL C, DETAIL D, DETAIL E, SECTION A-A, leader callout, or local datum).
2. Scan the dimension arrows, leader lines, balloon numbers, and callouts specifically for this target feature.
3. Extract the exact localized measurements without guessing or rounding:
   - Feature type and location on the part (e.g., "Outer collar at Z=18mm", "Inner bore entrance", "Shaft tip")
   - Detail / Section view reference (e.g., "DETAIL-D", "DETAIL-E", "SECTION-AA")
   - Exact dimensions (diameters, depths, axial lengths/widths, radii, tapers/angles)
   - Tolerances & surface finish if specified
   - Edge treatments (fillets, chamfers, lead-in slopes)
   - Coordinate reference relative to the part's primary datums (Z-distance from left/right face, radial distance)
4. Return a clean, structured JSON object with the localized findings and a recommended build123d modeling strategy.

## STRICT JSON OUTPUT SCHEMA
```json
{
  "target_portion": "groove",
  "identified_view": "DETAIL-D",
  "feature_name": "dual_seal_grooves",
  "location_description": "Located on the Ø25 outer collar, starting 6.0mm from the left face",
  "parameters": {
    "groove_width": 1.45,
    "groove_depth": 1.95,
    "groove_pitch_spacing": 2.15,
    "groove_count": 2,
    "rear_draft_angle": 15.0,
    "corner_fillet_radius": 0.2,
    "outer_corner_chamfer": 0.2
  },
  "z_datum_reference": {
    "reference_face": "left_face_datum_A",
    "z_start": 6.0
  },
  "cad_modeling_strategy": "Create a 2D sketch on the XZ plane with the trapezoidal groove profile and revolve with mode=bd.Mode.SUBTRACT around Axis.Z, then apply 0.2mm fillets to the root edges.",
  "confidence": 0.98,
  "notes": "Detail-D shows two identical grooves with 15° rear wall taper and R0.2 corner blends."
}
```
"""


SYSTEM_INSTRUCTION = """
# ROLE: Expert Python Parametric CAD Engineer
Generate production-grade, mathematically robust, parametric CAD code using the `build123d` Python library.

## 🎯 GOLDEN RULES
1. **Blueprint Adherence**: You MUST strictly follow the provided `FEATURE_MAP`. Do not invent new features or ignore existing ones. When identifying threads from the blueprint, ensure every single topological feature (chamfers, cutouts, ribs, holes, threads) described in the map is modeled.
2. **Manifold Stability & The Epsilon Protocol**: Every boolean operation must resolve cleanly. To prevent zero-thickness faces, you MUST declare `eps = 0.01` in your `PARAMETERS` dictionary. For all through-holes or subtractive cutouts, extend the depth/height by `eps` (or `2*eps`) and adjust placement by `eps` to guarantee a clean pierce through the boundary.
3. **Parametric Stacking (NO MAGIC NUMBERS)**: You may NOT use hardcoded float literals for dimensions anywhere in the `BuildPart` block! EVERY single measurement (radii, lengths, heights, chamfers, fillets, hole offsets) MUST be extracted into the `PARAMETERS` dictionary at the top of the script. Derive downstream coordinates explicitly using these variables. **EXCEPTION:** For `profile_points` arrays from the FEATURE_MAP, you MUST copy the ENTIRE array directly into the `PARAMETERS` dict (e.g., `PARAMETERS = {"profile_points": [[0,0], [10,0], ...]}`). DO NOT break the array apart into individual named length/diameter variables! Pass the array directly to `bd.Polygon()`.
4. **Pythonic Structure**: Use the declarative `with BuildPart() as part:` syntax wherever possible.
5. **Metadata Mapping**: You MUST generate a `PARAMETER_METADATA` dictionary matching the `PARAMETERS` exactly, providing a `"group"`, `"confidence"` (0.0 to 1.0), and `"description"` for every parameter. You MUST also preserve any `surface_finish` (e.g. Ra 3.2), `gdt_callouts`, or `dimensional_tolerances` from the FEATURE_MAP inside the parameter description or a dedicated metadata field so it reaches downstream CAM.
6. **Z=0 Top Surface Alignment**: The final part MUST be exactly aligned so its absolute top-most surface is at Z=0. HOWEVER, you may build the part in whatever coordinate system makes the math easiest (e.g. growing upwards from Z=0). At the end of your script, OUTSIDE the BuildPart block, you MUST shift the entire part down programmatically using: `part.part = part.part.locate(bd.Location((0, 0, -part.part.bounding_box().max.Z)))`. This eliminates the need for you to do complex floating-point calculations!
7. **Complete Extraction Enforcement**: Do NOT omit or simplify any subtractive features (holes, grooves, chamfers) mapped in the `FEATURE_MAP`. If a feature is described, you MUST physically model it and subtract it from the part. NEVER simplify `revolved_profile` or `revolved_cutout` arrays. If the FEATURE_MAP provides multiple profile points (e.g. for stepped bores or outer profiles), you MUST copy the ENTIRE array into `PARAMETERS` and use it to draw the exact polygon. Do NOT convert the points into separate named length/diameter parameters! CRITICAL RULE: IF THE FEATURE MAP CONTAINS A 'revolved_cutout' WITH 'profile_points', YOU MUST USE A 'BuildSketch' AND 'bd.revolve()' TO CUT IT. YOU ARE STRICTLY FORBIDDEN FROM REPLACING A 'revolved_cutout' WITH A 'bd.Hole()'. A 'bd.Hole()' CAN ONLY BE USED FOR SIMPLE STRAIGHT 'hole_blind' OR 'hole_through' FEATURES!
8. **Mandatory Parametric CAM Naming Convention**: The CAD parameters are used directly by the downstream CAM engine to auto-generate CNC toolpaths! Therefore, you MUST name parameters for machinable features (holes, pockets, slots, bosses, steps) using these exact keywords: `hole`, `drill`, `bore`, `pocket`, `slot`, `cavity`, `boss`, `step`, or `pad`. For example, use `center_hole_dia` and `center_hole_depth` (not `center_d`). You MUST explicitly provide a `_depth` parameter for EVERY hole and pocket, even through-holes (set the depth to the material thickness or outer diameter). For off-axis features (such as cross-holes or radial features), you MUST include the axis direction in the parameter prefix (e.g., `x_axis_cross_hole_dia`, `y_axis_radial_pocket_width`) so the CAM engine knows the tool vector. General stock dimensions like `plate_width` should remain generic. This ensures the Parametric CAM Engine maps them correctly.
9. **Spatial Parameter Annotations (CRITICAL)**: To enable 3D parameter highlighting in the UI, you MUST generate an `ANNOTATIONS` dictionary below `PARAMETER_METADATA`. For every dimension parameter (lengths, widths, radii, heights), you must calculate the absolute 3D spatial points `p1` and `p2` that represent the extreme ends of that dimension in the final model space (BEFORE the final Z-shift). Format: `"param_name": {"p1": [x,y,z], "p2": [x,y,z]}`.

10. **Parameter Usage Completeness (CRITICAL)**: After writing your `with bd.BuildPart()` block, you MUST verify that EVERY SINGLE key defined in your `PARAMETERS` dictionary is actually used somewhere in the construction logic. If a parameter exists in `PARAMETERS` but has no corresponding `bd.fillet()`, `bd.chamfer()`, `bd.Hole()`, `bd.Polygon()`, or other build123d operation that references it, this is a FATAL ERROR — you MUST add the missing operation. In your MENTAL WALKTHROUGH, explicitly list every edge treatment parameter and map it to its corresponding `bd.fillet()` or `bd.chamfer()` call. A dead parameter means a missing manufacturing feature!
11. **Edge Treatment Feature Handling (CRITICAL)**: When the FEATURE_MAP contains features of type `edge_treatment`, you MUST generate the corresponding `bd.fillet()` or `bd.chamfer()` code for EACH one. Extract the `radius` or `size` into a named PARAMETERS entry (e.g., `fillet_bore_step_r`). Use precise edge selection: `part.edges().filter_by(bd.GeomType.CIRCLE).filter_by_position(bd.Axis.Z, z_min, z_max)` where `z_min` and `z_max` bracket the `z_position` from the feature. For `target_edge: "inner"`, also filter by radius to select only bore edges. For `target_edge: "groove"`, select edges near the groove Z-range. If a fillet/chamfer operation fails geometrically (e.g., radius too large), wrap it in a `try/except` block and print a warning, but do NOT silently omit it from the code!
12. **Detail View Micro-Features & Lead-In Angles (CRITICAL)**: Detail views (e.g. DETAIL-A, B, C, D, E) define functional micro-geometry such as lead-in tapers (e.g. a 30° sliding cut or 15° entry chamfer), O-ring retaining grooves, and corner radii. You MUST incorporate these features into the 2D profile geometry or apply precise `bd.chamfer()` / `bd.fillet()` operations. In precision CNC manufacturing, omitting a 30° lead-in angle or seal groove prevents proper assembly and will cause part rejection. Treat all detail view features as mandatory production geometry!
13. **Conical Bore Profiles & Right-Datum Stationing (MANDATORY)**: When drawing `bore_profile_points` for parts with angled bore entries (e.g. 60° entry chamfer cone) or conical step transitions (e.g. 120° internal transition), trace the exact sloped (X, Z) coordinate vertices directly into the sketch polygon. For dimensions measured from the opposite right face (e.g. length 57.2 from right face), the Z-station on the global axis must be algebraically derived as `total_length - right_dim`. Never approximate internal cones with generic flat steps!



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
You MUST wrap your entire Python script in ```python ... ``` fences.
CRITICAL INSTRUCTION: START YOUR RESPONSE IMMEDIATELY WITH ```python. DO NOT OUTPUT RAW CONVERSATIONAL CHAIN-OF-THOUGHT TEXT OR BULLET POINTS BEFORE THE CODE BLOCK. PUT ALL MATHEMATICAL CALCULATIONS AND SPATIAL REASONING INSIDE THE `# --- SPATIAL PLAN ---` COMMENTS INSIDE THE CODE!

```python
import build123d as bd


PARAMETERS = {
    "flange_radius": 20.0,
    "flange_thickness": 10.0,
    "shaft_radius": 12.0,
    "shaft_length": 40.0,
    "bore_radius": 5.0
}

PARAMETER_METADATA = {
    "flange_radius": { "group": "Body", "confidence": 0.98, "description": "Outer radius of the bottom flange" },
    "flange_thickness": { "group": "Body", "confidence": 0.95, "description": "Thickness of the flange section" },
    "shaft_radius": { "group": "Body", "confidence": 0.99, "description": "Radius of the upper shaft section" },
    "shaft_length": { "group": "Body", "confidence": 0.99, "description": "Length of the upper shaft section" },
    "bore_radius": { "group": "Internal", "confidence": 0.95, "description": "Radius of the central through bore" }
}

ANNOTATIONS = {
    "flange_radius": { "p1": [0.0, 0.0, 0.0], "p2": [20.0, 0.0, 0.0] },
    "flange_thickness": { "p1": [20.0, 0.0, 0.0], "p2": [20.0, 0.0, 10.0] },
    "shaft_radius": { "p1": [0.0, 0.0, 10.0], "p2": [12.0, 0.0, 10.0] },
    "shaft_length": { "p1": [12.0, 0.0, 10.0], "p2": [12.0, 0.0, 50.0] },
    "bore_radius": { "p1": [0.0, 0.0, 50.0], "p2": [5.0, 0.0, 50.0] }
}

flange_radius = PARAMETERS["flange_radius"]
flange_thickness = PARAMETERS["flange_thickness"]
shaft_radius = PARAMETERS["shaft_radius"]
shaft_length = PARAMETERS["shaft_length"]
bore_radius = PARAMETERS["bore_radius"]

# --- SPATIAL PLAN ---
# The part is a stepped revolved shaft.
# We will draw a 2D profile representing the right half (X >= 0) of the cross-section.
# Total height = flange_thickness + shaft_length.
# The profile will start at origin, go right to flange_radius, up by flange_thickness, 
# step inward to shaft_radius, up by shaft_length, then left to origin.
# Then we revolve it around the Z axis.
# A central bore is cut through the entire part.
# --- MENTAL WALKTHROUGH ---
# 1. Polyline creates the closed outer profile.
# 2. bd.revolve(axis=bd.Axis.Z) spins it into a solid.
# 3. A central Hole cuts through it entirely.
# --------------------

with bd.BuildPart() as part:
    # @id: body_revolve
    with bd.BuildSketch(bd.Plane.XZ) as sk: # Draw on XZ plane so revolving around Z creates a vertical part
        pts = [
            (0, 0),
            (flange_radius, 0),
            (flange_radius, flange_thickness),
            (shaft_radius, flange_thickness),
            (shaft_radius, flange_thickness + shaft_length),
            (0, flange_thickness + shaft_length),
        ]
        bd.Polygon(pts)
    bd.revolve(axis=bd.Axis.Z)

    # @id: central_bore
    # bd.Hole cuts along -Z of the active plane. Since part is from Z=0 up, 
    # we need to put the plane at the top to cut downwards.
    with bd.Locations((0, 0, flange_thickness + shaft_length)):
        bd.Hole(radius=bore_radius, depth=flange_thickness + shaft_length + 0.01)

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
7. **Strict Markdown Wrapping**: You MUST wrap your entire Python script in ```python ... ``` fences. Do NOT output conversational text or reasoning outside of the Python code block comments.
""".strip()

REPAIR_SYSTEM_PROMPT = """
# ROLE: build123d Compiler Error Recovery Specialist

You are receiving a build123d Python script that failed to render due to an exception or topological failure. Fix the EXACT error reported in the ERROR_LOG and return a corrected script.

## ⚠️ IMMUTABILITY & SYNTAX CONSTRAINTS (CRITICAL)

1. **Parameter Variable Lock**: You are strictly FORBIDDEN from altering the string keys inside the `PARAMETERS` or `PARAMETER_METADATA` dictionaries. 
   * ✅ ACCEPTABLE: Appending new keys or adjusting the float values of existing keys (e.g., 20.0 -> 10.0, or halving values inside an array).
   * ❌ UNACCEPTABLE: Renaming existing keys (e.g., "shank_diameter" -> "diameter").
2. **Context Manager Enforcement**: Ensure 3D operations (`bd.extrude`, `bd.revolve`, etc) are NOT nested inside `with bd.BuildSketch():`. They must sit under `with bd.BuildPart():`.
3. **Edge/Face Referencing**: If a C++ `NCollection_IndexedDataMap` crash occurs, you likely passed primitive edges directly to a chamfer/fillet. ALWAYS extract edges from the active part using `part.edges().filter_by(...)`.
4. **Boolean Epsilon Rules**: If a `StdFail_NotDone` crash occurs, you likely have zero-thickness walls from overlapping subtractive boundaries. Ensure `eps=0.01` is applied to subtractive shapes so they pierce cleanly.
5. **Empty Part / Consumed Part Errors**: If you get an error stating a SUBTRACT operation resulted in an empty part (0 solids remaining), it means your cutter (e.g. `bd.Hole` or `bd.revolve(mode=SUBTRACT)`) is LARGER than the part itself! Check your `PARAMETERS` values. Did you accidentally put a DIAMETER value into a radius parameter? Or did you put diameters into a `profile_points` array when it should be radii? YOU ARE ALLOWED to halve the float values in `PARAMETERS` (including inside arrays) to fix this!
6. **Thread Metadata Safety**: Do not remove, rename, or silently replace thread parameters while repairing topology. A bare M10 callout may infer 1.5 mm coarse pitch, but missing depth, length, tolerance, or tap-drill values must remain unresolved.
7. **Output Format**: Return the ENTIRE valid Python file text block. Do not output snippets or incomplete reconstructions.
8. **Strict Markdown Wrapping**: You MUST wrap your entire Python script in ```python ... ``` fences. Do NOT output conversational text or reasoning outside of the Python code block comments.
9. **Mandatory 3D Solid Body (CRITICAL)**: If the input script was cut off or only contains 2D sketch arrays/variables, you MUST write the complete `with bd.BuildPart() as part:` block that creates the 3D solid part via `bd.extrude()` or `bd.revolve()`, applies cuts and edge treatments, and shifts the top surface to Z=0. NEVER return a script that only declares dictionaries or 2D sketches without the 3D solid!


__API_CHEATSHEET_AND_RULES__

__THREAD_CAD_RULES__
""".replace(
    "__API_CHEATSHEET_AND_RULES__", API_CHEATSHEET_AND_RULES
).replace(
    "__THREAD_CAD_RULES__", THREAD_CAD_RULES
).strip()

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
            load_dotenv(Path(__file__).resolve().parents[3] / ".env", override=True)
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
                if current_metadata.fallbackModelId and current_metadata.fallbackModelId != current_metadata.id:
                    fallback_id = current_metadata.fallbackModelId
                    fallback_metadata = get_model_by_id(fallback_id)
                    if fallback_metadata:
                        print(f"[{label}] Attempt {attempt} failed ({exc}). Auto-falling back to {fallback_id}.")
                        current_metadata = fallback_metadata
                await asyncio.sleep(min(4, 2 ** attempt))

        raise RuntimeError(
            f"[{label}] failed after {self.MAX_RETRIES} attempts: {last_exc}"
        )

    @staticmethod
    def _normalize_script(raw: str) -> str:
        """Strip markdown fences and leading prose from a raw LLM response."""
        if not raw:
            return ""

        parts = raw.split("```")
        candidates = []
        
        for part in parts:
            part = part.strip()
            if not part:
                continue
            for lang in ['python', 'scad', 'openscad', 'text']:
                if part.lower().startswith(lang):
                    part = part[len(lang):].strip()
                    break
            if part:
                candidates.append(part)
                
        cad_fences = []
        for c in candidates:
            m = _CODE_START_RE.search(c)
            if m:
                cad_fences.append(c[m.start():].strip())
        
        if cad_fences:
            return max(cad_fences, key=len)
        
        # Fallback: search for code start in raw text directly (handles missing/unclosed code fences)
        m_raw = _CODE_START_RE.search(raw)
        if m_raw:
            candidate = raw[m_raw.start():].strip()
            # If there's an unclosed fence or trailing prose after if __name__, clean it
            if "if __name__" in candidate:
                idx = candidate.find("if __name__")
                end_idx = candidate.find("\n\n", idx + 50)
                if end_idx != -1:
                    candidate = candidate[:end_idx].strip()
            return candidate

        # If no valid code block was found, raise an error
        raise ValueError(f"LLM failed to generate a valid Python code block. Response was: {raw[:100]}...")


    @staticmethod
    def _extract_json_payload(raw: str) -> dict[str, Any]:
        """Extract the first valid JSON object from a model response."""
        if not raw or not raw.strip():
            raise ValueError("The audit model returned an empty response.")

        text = raw.strip()
        parts = text.split("```")
        
        candidates = [text] + parts

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

    @staticmethod
    def _validate_parameter_usage(script: str) -> list[str]:
        """Check that fillet/chamfer parameters are actually applied in the BuildPart block.

        Returns a list of warning strings for unused edge-treatment parameters.
        Non-blocking: only logs warnings, never raises or alters the script.
        """
        audit_warnings: list[str] = []
        try:
            param_match = re.search(
                r'PARAMETERS\s*=\s*\{(.*?)\n\}',
                script,
                re.DOTALL,
            )
            if not param_match:
                return audit_warnings

            keys = re.findall(r'"(\w+)"\s*:', param_match.group(1))

            # Focus on edge treatment parameters that are commonly forgotten
            edge_keys = [
                k for k in keys
                if any(kw in k.lower() for kw in ("fillet", "chamfer"))
            ]

            # Find the BuildPart block
            build_match = re.search(
                r'(with\s+bd\.BuildPart\(\).*?)(?=\npart\.part|\nif __name__)',
                script,
                re.DOTALL,
            )
            build_block = build_match.group(1) if build_match else ""

            for key in edge_keys:
                if key not in build_block:
                    audit_warnings.append(
                        f"[param-audit] Edge treatment '{key}' is defined in "
                        f"PARAMETERS but never used in the BuildPart block — "
                        f"a bd.fillet() or bd.chamfer() call is likely missing."
                    )
        except Exception:
            pass
        return audit_warnings

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

        # --- NEW KNOWLEDGE RETRIEVAL STAGE ---
        try:
            from app.services.knowledge.retriever import KnowledgeRetriever
            from app.services.knowledge.schemas import KnowledgeRetrievalQuery
            
            retriever = KnowledgeRetriever()
            # Mock preliminary signals (in a real pipeline, a fast pass or OCR would generate these)
            query = KnowledgeRetrievalQuery(
                detected_symbols=["Ø", "M", "Ra", "±"], 
                feature_candidates=["Hole", "Thread", "Dimension"],
                query="General machining rules"
            )
            knowledge_res = retriever.retrieve(query)
            
            knowledge_context = "Engineering Rules Context:\\n"
            for rule in knowledge_res.rules:
                knowledge_context += f"- {rule.concept}: {rule.description}\\n"
                
            enhanced_instruction = f"{AUDIT_INSTRUCTION}\\n\\n{knowledge_context}"
        except Exception as e:
            print(f"[Knowledge] Retrieval failed or unavailable: {e}")
            enhanced_instruction = AUDIT_INSTRUCTION

        async def _call(metadata) -> str:
            return await self.gateway.generate(
                prompt="Extract technical drawing features map JSON matching the strict schema.",
                metadata=metadata,
                system_instruction=enhanced_instruction,
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

    async def audit_target_feature(
        self,
        image_bytes: bytes,
        mime_type: str,
        target_portion: str,
        user_prompt: str,
        base_code: str | None = None,
    ) -> dict[str, Any]:
        """
        Targeted Inspection - Focus exclusively on a specific localized feature or detail view on the blueprint.
        """
        query_text = (
            f"TARGET FEATURE / PORTION TO INSPECT: {target_portion}\n"
            f"USER FEEDBACK & CONTEXT: {user_prompt}\n"
        )
        if base_code:
            param_match = re.search(r'PARAMETERS\s*=\s*\{(.*?)\n\}', base_code, re.DOTALL)
            if param_match:
                query_text += f"\nEXISTING_MODEL_PARAMETERS:\n{param_match.group(0)}"

        async def _call(metadata) -> str:
            return await self.gateway.generate(
                prompt=query_text,
                metadata=metadata,
                system_instruction=TARGETED_FEATURE_AUDIT_INSTRUCTION,
                image_bytes=image_bytes,
                mime_type=mime_type,
                response_json=True,
            )

        raw = await self._call_with_retry(_call, "targeted_audit")
        try:
            return self._extract_json_payload(raw)
        except Exception as exc:
            print(f"[targeted_audit] Failed to parse targeted feature JSON: {exc}")
            return {"raw_report": raw}

    async def generate_script(
        self,
        prompt: str,
        image_bytes: bytes | None = None,
        mime_type: str | None = None,
        feature_map: dict[str, Any] | str | None = None,
        targeted_feature: dict[str, Any] | str | None = None,
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

        if targeted_feature:
            if isinstance(targeted_feature, dict):
                parts.append(f"TARGETED_BLUEPRINT_FEATURE_INSPECTION:\n{json.dumps(targeted_feature, indent=2)}")
            else:
                parts.append(f"TARGETED_BLUEPRINT_FEATURE_INSPECTION:\n{targeted_feature}")

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
        targeted_feature: dict[str, Any] | str | None = None,
        base_code: str | None = None,
        selection_context: str | None = None,
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
        if targeted_feature:
            if isinstance(targeted_feature, dict):
                parts.append(f"TARGETED_BLUEPRINT_FEATURE_INSPECTION:\n{json.dumps(targeted_feature, indent=2)}")
            else:
                parts.append(f"TARGETED_BLUEPRINT_FEATURE_INSPECTION:\n{targeted_feature}")
        if base_code:
            parts.append(f"EXISTING_CODE_TO_REFINE:\n{base_code}")
        if selection_context:
            parts.append(f"TARGET_PORTION_OR_COORDINATE:\n{selection_context}")

        user_text = "\n\n".join(parts)
        sys_instr = EDIT_SYSTEM_INSTRUCTION if base_code else SYSTEM_INSTRUCTION

        current_metadata = self.primary_metadata
        last_exc: Exception | None = None
        complete_text = ""

        for attempt in range(self.MAX_RETRIES):
            try:
                response_stream = self.gateway.generate_stream(
                    prompt=user_text,
                    metadata=current_metadata,
                    system_instruction=sys_instr,
                    image_bytes=image_bytes,
                    mime_type=mime_type,
                )
                
                async for chunk in response_stream:
                    if chunk:
                        complete_text += chunk
                        yield chunk
                        
                # If we complete the stream successfully, break out of retry loop
                break
                
            except Exception as exc:
                last_exc = exc
                
                if complete_text:
                    # We already yielded partial stream to the client. A transparent retry 
                    # is impossible here because the client would receive duplicate/broken text.
                    raise
                    
                if current_metadata.fallbackModelId and current_metadata.fallbackModelId != current_metadata.id:
                    fallback_id = current_metadata.fallbackModelId
                    fallback_metadata = get_model_by_id(fallback_id)
                    if fallback_metadata:
                        print(f"[codegen stream] Attempt {attempt} failed ({exc}). Auto-falling back to {fallback_id}.")
                        current_metadata = fallback_metadata
                        
                print(f"[codegen stream] Attempt {attempt} failed with {exc}. Retrying...")
                await asyncio.sleep(min(4, 2 ** attempt))
        else:
            raise RuntimeError(f"[codegen_stream] failed after {self.MAX_RETRIES} attempts: {last_exc}")

        try:
            outputs_dir = Path(__file__).resolve().parents[3] / "outputs"
            outputs_dir.mkdir(parents=True, exist_ok=True)
            with open(outputs_dir / "latest_generated_script.py.txt", "w", encoding="utf-8") as f:
                f.write(complete_text)
        except Exception as e:
            print(f"Failed to write debug script: {e}")

        # Non-blocking parameter usage audit
        try:
            normalized = self._normalize_script(complete_text)
            unused_warnings = self._validate_parameter_usage(normalized)
            for w in unused_warnings:
                print(w)
        except Exception:
            pass

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
