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
_AUDIT_SCHEMA_VERSION = "engineering-audit-v8"

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
# ROLE: Senior CAD Reconstruction Engineer & Precision Metrology Auditor
You specialize in translating precision engineering blueprints and multi-view technical drawings into a detailed Spatial & Geometric Audit Report.
You must analyze the provided technical drawing with tolerance-aware manufacturing rigor.
The generated output must match the engineering drawing exactly. No dimension guessing. No hallucinated features. No invented measurements. No hardcoded assumptions.

--------------------------------------------------
EXTRACTION STRATEGY & CHAIN OF THOUGHT
--------------------------------------------------
Before outputting any JSON, you MUST perform a deep visual audit of the blueprint using a `<scratchpad>` block. Inside the scratchpad:
1. Identify all Views present (Main, Section Views like A-A, Detail Views like Detail B/D/E, etc.) and Title Block / Notes.
2. Explicitly trace the axial (Z) dimensions and radial (X) dimensions to verify Wall Thickness at every step.
3. Catalogue every single dimensional annotation, upper/lower tolerance, fit callout (e.g. H8, h8, h11), angle, chamfer, fillet, GD&T control frame, datum symbol, surface roughness callout, material, stock spec, surface treatment, and manufacturing requirement.
4. Associate every annotation with its corresponding geometric feature and source view.
5. For Multi-Boss / Lever / Linkage / Offset Arm parts (e.g. Pitman arms, control arms, rocker arms, connecting rods, bell cranks, offset brackets):
   a. Identify all discrete boss eyelets (Boss 1 / Large Head, Boss 2 / Small Head, intermediate pivots) and their center-to-center pitch distances.
   b. Inspect longitudinal section views (e.g., Section A-A) for non-coplanar boss faces, axial step offsets / dog-leg neck bends (e.g. step offset between boss centerlines), neck thickness vs. boss thickness, and transition slopes.
   c. Trace the Connecting Arm / Web envelope connecting the bosses (tapered web width, thickness, draft angles, and blend fillets).
Only after this analysis, output a valid JSON feature-map matching the exact schema below, wrapped in ```json ... ``` tags.

## 1. COORDINATE SYSTEM CONSTRAINTS
- **Origin**: Place (0,0,0) at the primary datum face/axis of the main body or primary boss eyelet for symmetric stability.
- **Z-Axis**: Points along the primary axis of rotation or build direction. Face pockets, blind steps, and through-boring occur relative to this axis.
- **Rationale**: State the exact placement logic in `origin_rationale`.

## 2. FEATURE TAXONOMY
- **ADDITIVE**: `base_prismoid`, `base_cylinder`, `boss_eyelet`, `connecting_arm`, `offset_neck`, `dogleg_bend`, `tangent_web`, `tapered_shank`, `mounting_ear`, `alignment_boss`, `reinforcement_rib`, `spherical_dome`, `revolved_profile`, `complex_shell`
- **SUBTRACTIVE**: `pocket_interior`, `step_shoulder`, `counterbore`, `hole_through`, `hole_blind`, `thread_internal`, `oring_groove`, `revolved_cutout`
- **SURFACE / MANUFACTURING**: `thread_external`
- **EDGE_MODIFIER**: `fillet_interior`, `chamfer_exterior`, `edge_treatment`
- **MANUFACTURING_METADATA**: Ensure you capture any specific `material`, `stock`, `surface_treatments`, `general_tolerances`, `gdt_callouts`, `datums`, `surface_finishes`, and `manufacturing_requirements`.
- **COMPLEX GEOMETRY (Gears/Serrations/Splines)**: Model the nominal blank envelope and attach the specific callout as a `manufacturing_metadata` or `surface_treatment` field so the CAM system can handle the tooling path.

## 3. MACHINING & DIMENSIONAL RULES
- **Profile Decompositions**: For parts with asymmetric or multi-angular walls, capture the exact 2D coordinate paths outlining the perimeter.
- **Z-Reference & Coordinate Independence**: Every feature must declare an exact `z_reference`: `"bottom_of_feature"`, `"top_of_feature"`, or `"absolute_zero"`. Map every single Z-height strictly to the dimension lines provided, independent of other features.
- **Revolved / Lathe Parts (MANDATORY DIMENSIONAL PARAMETERIZATION)**: Extract all sequential diameters, step lengths, groove widths/depths, tapers, and corner radii as explicit named dimensional parameters in `dims` and `all_dimensions`. In section views, carefully distinguish between inner bore lines and outer profile lines. Verify `Wall Thickness = Outer_Radius - Inner_Radius > 0`.
- **Multi-Boss Links, Lever Arms & Offset Arm Parts (MANDATORY GEOMETRIC DECOMPOSITION)**:
  - For parts consisting of multiple bosses connected by an arm, web, or neck (e.g. Pitman arm, control arm, connecting rod, rocker arm, bell crank, offset bracket):
    1. **Boss Eyelets**: Model Boss 1 (primary) and Boss 2 (secondary) as distinct features with their respective outer diameters, thicknesses, and center coordinates `(0, 0)` and `(0, center_distance)`.
    2. **Section A-A & Dog-Leg Neck Bends**: Inspect the cross-section view to check if Boss 1 and Boss 2 lie on different Z-planes. Extract the axial step offset (`neck_step_offset`), boss thicknesses, and neck web thickness (`neck_thickness`) as dedicated dimensional parameters.
    3. **Connecting Arm / Web Profile**: Extract the connecting web width at Boss 1 (`arm_width_head`), width at Boss 2 (`arm_width_tail`), central web thickness, and transition fillet radii connecting the web to the boss eyelets.
    4. **Boss Internal Geometry**: Associate internal bores, counterbores, tapers (e.g. 1:10 taper), and internal serrations/splines directly with the specific parent boss ID.
- **Half-Section Views (ANTI-HALLUCINATION)**: Never interpret crosshatching on a symmetric part as a physical cutout. Extract internal bores as `revolved_cutout` or `counterbore` / `hole_through` features.
- **End Face Steps & Recesses**: When detail views show an end-face step or recess, capture the axial step length and diameter as dedicated parameters.
- **Conical Internal Bores & Angle Tracing**: When bore entries or internal transitions specify an angle (e.g. 60° entry cone or 10°/20° transition cone), extract the cone angle and axial depth as explicit named parameters.
- **Complex Stepped Bores**: Extract the entire internal channel as sequential counterbores and through-bores with exact diameters and depths.

## 4. ENGINEERING PARAMETERS & METROLOGY EXTRACTION (MANDATORY)

- **Generic Dimensional Parameters & Tolerances**:
  - Extract EVERY dimension annotation that contributes to manufactured geometry (linear, diameter, radius, length, depth, width, offset, axial position, feature spacing).
  - Preserve: nominal value, unit, tolerance type (`symmetric`, `deviational`, `limits`, `iso_fit`, `basic`), upper tolerance, lower tolerance, and feature association.
  - Parse tolerance forms dynamically: `±0.1`, `+0.2/-0.1`, `+0.02/0`, `0/-0.033`, `H8`, `h8`, `h11`, etc. Never discard tolerance or fit information.

- **Diameter / Radius Disambiguation**:
  - Distinguish whether a diameter or radius represents: `outer_diameter`, `inner_bore_diameter`, `shaft_diameter`, `groove_diameter`, `flange_diameter`, `fillet_radius`, `corner_radius`, or `chamfer_size`.
  - Use leader lines, arrows, section/detail view context, and geometry topology to associate each parameter with the correct physical feature.

- **Angular Dimensions & Tapers**:
  - Extract all angular parameters (e.g. 10°, 15°, 20°, 30°, 45°, 60°).
  - Associate each angle with its corresponding feature: `taper`, `chamfer`, `cone`, `angled_face`, or `profile_transition`.
  - Store: `angle_value`, `unit`, `feature_id`, `source_annotation`, `source_view`.

- **Chamfer & Fillet Representation**:
  - Chamfers: extract size AND angle (e.g., `1.4 × 15°`, `0.2 × 45°`, `1 × 20°`, `C1.4`), target edge (`outer`/`inner`/`groove`), and source view.
  - Fillets: extract radius AND multiplicity (e.g., `R0.2`, `R0.4`, `2X R0.2`), target edge, and source view.

- **GD&T Feature Control Frames**:
  - Detect and structure: position, concentricity, perpendicularity, parallelism, flatness, circularity, circular runout, total runout, profile tolerances.
  - Preserve: `gdnt_type`, `tolerance_value`, `diameter_zone` (boolean), `material_condition` (`RFS`/`MMC`/`LMC`), `datum_references` (e.g. `["A"]`, `["A", "B"]`), `target_feature`, `source_annotation`, `source_view`.

- **Datums**:
  - Detect datum identifiers (`A`, `B`, `C`) and associate each datum with its referenced physical geometry (`face`, `axis`, `cylindrical_surface`, `feature`).
  - Preserve: `datum_id`, `datum_type`, `referenced_feature`, `source_location`, `source_view`.

- **Surface Roughness / Finish**:
  - Detect surface finish callouts (e.g. `Ra 1.6`, `Ra 0.8`, `Ra 0.4`, `Rz 3.2`).
  - Associate each roughness callout with its specific target face, feature, or region.

- **Material & Stock Extraction**:
  - Extract material from title block / material section (e.g. `EN-AW 6082 T6`, `AISI 4140`, `SS304`, `Al 6061-T6`).
  - Extract stock specification (e.g. `Ø25 h11`, `Ø50 H8`, `Bright Bar`, `Round Bar`, `Plate`).
  - Structure separately: `material_name`, `material_standard`, `grade_or_temper`, `stock_shape`, `stock_nominal_size`, `stock_tolerance`.

- **Surface Treatments**:
  - Detect treatments (e.g. `hard anodizing`, `plating`, `coating`, `nitriding`, `heat treatment`, `passivation`).
  - Extract: `treatment_type`, `thickness_nominal_um`, `thickness_tolerance`, `hardness` (e.g. `HV > 400`), `process_requirement`, `target_region`.

- **Manufacturing Notes & Functional Requirements**:
  - Extract engineering notes (e.g. deburr, sharp edges not allowed, inspection magnification, edge finishing, coating termination).
  - Extract functional / inspection characteristics (e.g. mass, wetted surface, sealing area, gasket working area).

- **General Tolerance Tables**:
  - Dynamically detect general tolerance tables (e.g., ISO 2768 rules for linear and angular dimensions) and structure them as range rules.

- **Multi-View & Balloon Association**:
  - Combine information across Main View, Section Views, Detail Views, and Title Block.
  - Preserve numbered balloons as references for associating annotations to features and requirements.

## 5. THREAD CALLOUT EXTRACTION — CALLOUT FIRST
When identifying threads from the blueprint, identify every thread callout (M, UNC, UNF, NPT) from text, leader lines, or general notes.
For every thread, extract: `thread_standard`, `thread_family`, `nominal_diameter`, `pitch`, `internal_or_external`, `thread_class`, `handedness`, `thread_length`, `full_thread_depth`, `through_or_blind`, `source_callout`, `normalized_callout`.
For bare metric callouts like M10, infer preferred ISO metric coarse pitch and mark as inferred.

## 6. STRICT JSON SCHEMA
```json
{
  "audit_schema_version": "engineering-v1",
  "units": "mm",
  "origin_point": [0, 0, 0],
  "origin_rationale": "Symmetric center anchoring of primary geometric envelope.",
  "material": "EN-AW 6082 T6",
  "material_parsed": {
    "material_name": "EN-AW 6082 T6",
    "material_standard": "EN-AW",
    "grade_or_temper": "T6"
  },
  "stock": {
    "shape": "bright_bar",
    "nominal_size": "Ø25",
    "nominal_diameter": 25.0,
    "tolerance_class": "h11"
  },
  "surface_treatments": [
    {
      "treatment_type": "hard_anodizing",
      "thickness_nominal_um": 55.0,
      "thickness_tolerance": "±5 µm",
      "hardness": "HV > 400",
      "target_region": "outer_surfaces"
    }
  ],
  "general_tolerances": "ISO 2768-m",
  "general_tolerance_table": {
    "standard": "ISO 2768",
    "precision_class": "m",
    "rules": [
      {"nominal_min": 0.0, "nominal_max": 6.0, "tolerance": 0.1},
      {"nominal_min": 6.0, "nominal_max": 30.0, "tolerance": 0.2},
      {"nominal_min": 30.0, "nominal_max": 120.0, "tolerance": 0.3}
    ]
  },
  "gdt_callouts": [
    {
      "type": "circular_runout",
      "tolerance": 0.03,
      "diameter_zone": false,
      "material_condition": "RFS",
      "datums": ["A"],
      "target_feature": "body_main"
    }
  ],
  "datums": [
    {
      "datum_id": "A",
      "datum_type": "cylinder",
      "referenced_feature": "body_main",
      "source_view": "SECTION A-A"
    }
  ],
  "surface_finishes": [
    {
      "roughness_type": "Ra",
      "value": 1.6,
      "unit": "µm",
      "target_face_or_feature": "body_main",
      "source_view": "SECTION A-A"
    },
    {
      "roughness_type": "Ra",
      "value": 0.8,
      "unit": "µm",
      "target_face_or_feature": "oring_groove_1",
      "source_view": "DETAIL-D"
    }
  ],
  "manufacturing_requirements": [
    {
      "requirement_type": "deburring",
      "text": "Remove all burrs and sharp edges.",
      "source_location": "Notes"
    },
    {
      "requirement_type": "inspection",
      "text": "Inspect seal surfaces under 10x magnification.",
      "source_location": "Notes"
    }
  ],
  "functional_characteristics": [
    {
      "characteristic_type": "gasket_working_area",
      "value": 38.0,
      "unit": "mm",
      "description": "38 Gasket working area on outer shaft",
      "target_feature_or_region": "shaft_outer"
    }
  ],
  "envelope": { "x_total": 25.5, "y_total": 25.5, "z_total": 98.6 },
  "primary_datum": { "id": "body_main", "type": "revolved_profile" },
  "features": [
    {
      "id": "body_main",
      "type": "revolved_profile",
      "description": "Main stepped outer body.",
      "dims": {
        "profile_points": [
          [0.0, 0.0],
          [12.75, 0.0],
          [12.75, 40.0],
          [12.5, 40.0],
          [12.5, 70.0],
          [9.0, 70.0],
          [9.0, 98.6],
          [0.0, 98.6]
        ],
        "total_length": 98.6,
        "outer_dia_max": 25.5,
        "outer_dia_mid": 25.0,
        "shaft_dia": 18.0
      },
      "dimensional_tolerances": {
        "total_length": "±0.2",
        "outer_dia_max": "±0.2",
        "outer_dia_mid": "±0.1",
        "shaft_dia": "h8"
      },
      "location": { "x": 0.0, "y": 0.0, "z": 0.0, "z_reference": "bottom_of_feature" },
      "is_subtractive": false,
      "parent_id": null,
      "surface_finish": "Ra 1.6",
      "confidence": "verified"
    },
    {
      "id": "internal_stepped_bore",
      "type": "revolved_cutout",
      "description": "Internal stepped bore with multiple diameters and angled transitions.",
      "dims": {
        "profile_points": [
          [0.0, -0.01],
          [11.5, -0.01],
          [11.5, 30.0],
          [7.0, 30.0],
          [7.0, 80.0],
          [6.75, 80.0],
          [6.75, 98.61],
          [0.0, 98.61]
        ],
        "bore_dia_1": 23.0,
        "bore_dia_2": 14.0,
        "bore_dia_3": 13.5
      },
      "dimensional_tolerances": {
        "bore_dia_1": "H8",
        "bore_dia_2": "H8",
        "bore_dia_3": "+0.02/0"
      },
      "location": { "x": 0.0, "y": 0.0, "z": 0.0, "z_reference": "bottom_of_feature" },
      "is_subtractive": true,
      "parent_id": "body_main",
      "surface_finish": "Ra 1.6",
      "confidence": "verified"
    },
    {
      "id": "oring_groove_1",
      "type": "oring_groove",
      "description": "First O-ring seal groove with taper and blend fillets.",
      "dims": {
        "groove_width": 6.3,
        "groove_dia": 20.5,
        "z_position": 18.25,
        "wall_angle": 15.0,
        "corner_radius": 0.2
      },
      "dimensional_tolerances": {
        "groove_width": "+0.2/+0.1",
        "groove_dia": "±0.1",
        "z_position": "±0.1"
      },
      "location": { "x": 0.0, "y": 0.0, "z": 18.25, "z_reference": "absolute_zero" },
      "is_subtractive": true,
      "parent_id": "body_main",
      "source_view": "DETAIL-D",
      "surface_finish": "Ra 0.8",
      "confidence": "verified"
    },
    {
      "id": "fillet_corner_1",
      "type": "edge_treatment",
      "description": "2X R0.2 blend fillets at groove corners.",
      "dims": {
        "treatment_type": "fillet",
        "radius": 0.2,
        "multiplicity": 2,
        "z_position": 18.25,
        "target_edge": "groove"
      },
      "location": { "x": 0.0, "y": 0.0, "z": 18.25, "z_reference": "absolute_zero" },
      "is_subtractive": false,
      "parent_id": "oring_groove_1",
      "source_view": "DETAIL-D",
      "confidence": "verified"
    },
    {
      "id": "chamfer_entry_1",
      "type": "edge_treatment",
      "description": "1.4mm x 15° lead-in chamfer on outer entry edge.",
      "dims": {
        "treatment_type": "chamfer",
        "size": 1.4,
        "angle": 15.0,
        "z_position": 98.6,
        "target_edge": "outer"
      },
      "location": { "x": 0.0, "y": 0.0, "z": 98.6, "z_reference": "absolute_zero" },
      "is_subtractive": false,
      "parent_id": "body_main",
      "source_view": "DETAIL-B",
      "confidence": "verified"
    }
  ],
  "patterns": []
}
```

## 7. SEVERE VALIDATION GATE
* Return pure, parsable JSON text only.
* Edge Treatment Completeness: Extract EVERY fillet (with radius & count) and chamfer (with size & angle) visible in detail views.
* Metrology Completeness: Ensure all tolerances, fits (H8/h8/etc.), GD&T callouts, datums, finishes, materials, stock specs, surface treatments, notes, and general tolerances are fully preserved in the output.
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
- **Multi-Boss & Connecting Arm Modeling**:
  - To model parts with two or more cylindrical bosses (eyelets) connected by a central arm/web (e.g. Pitman arm, rocker arm, connecting rod, bell crank, offset bracket):
    1. Create Boss 1 cylinder at `(0, 0, boss1_z)`.
    2. Create Boss 2 cylinder at `(0, center_distance, boss2_z)` (where `boss2_z` reflects any axial step offset / neck bend from section views).
    3. Connect them with a bridging arm/web:
       - For flat/coplanar connections: In `with bd.BuildSketch():`, use `bd.Polygon` or `bd.make_hull()` to bridge between the boss perimeters, then `bd.extrude(amount=web_thickness)`.
       - For offset / dog-leg neck bends (Section A-A): In `with bd.BuildSketch(bd.Plane.YZ):`, draw a 2D profile tracing the stepped/cranked neck from `(0, z1)` to `(center_distance, z2)`, then `bd.extrude(amount=arm_width, both=True)` or extrude symmetrically across X.
    4. Cut the bores/tapers/holes at `(0, 0)` and `(0, center_distance)`.
    5. Fillet the web-to-boss junction edges using `bd.fillet()`.
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


SYSTEM_INSTRUCTION = """
# ROLE: Expert Python Parametric CAD Engineer
Generate production-grade, mathematically robust, parametric CAD code

## 🎯 GOLDEN RULES
1. **Blueprint Adherence**: You MUST strictly follow the provided `FEATURE_MAP`. Do not invent new features or ignore existing ones. When identifying threads from the blueprint, ensure every single topological feature (chamfers, cutouts, ribs, holes, threads) described in the map is modeled.
2. **Manifold Stability & The Epsilon Protocol**: Every boolean operation must resolve cleanly. To prevent zero-thickness faces, you MUST declare `eps = 0.01` in your `PARAMETERS` dictionary. For all through-holes or subtractive cutouts, extend the depth/height by `eps` (or `2*eps`) and adjust placement by `eps` to guarantee a clean pierce through the boundary.
3. **STRICT PARAMETRIC PURITY (ABSOLUTELY NO HARDCODED ARRAYS OR MAGIC NUMBERS)**:
   - The `PARAMETERS` dictionary MUST contain ONLY individual scalar numeric variables (floats/ints) for every dimension: lengths, diameters, widths, depths, radii, angles, chamfers, fillets, and offsets.
   - 🚫 **STRICTLY FORBIDDEN**: You are NEVER allowed to place lists, tuples, or arrays of coordinate points (e.g. `profile_points: [[0,0], [12.75, 40], ...]`) inside `PARAMETERS`! Putting coordinate arrays in `PARAMETERS` breaks parameter editing and multi-iteration repair.
   - Every single vertex coordinate of a sketch or polygon profile MUST be calculated algebraically in Python using individual named variables from `PARAMETERS` (e.g. `r_shaft = shaft_dia / 2.0`, `z_step = z_start + step_length`, `pts = [(0, 0), (r_shaft, 0), (r_shaft, z_step), ...]`).
   - For angled cones or tapers, calculate the transition length using `math.tan(math.radians(cone_angle))`.
   - This ensures that adjusting ANY parameter in the UI or during multi-iteration repair instantly recalculates the entire 3D model geometry!
4. **Pythonic Structure**: Use the declarative `with BuildPart() as part:` syntax wherever possible.
5. **Metadata Mapping**: You MUST generate a `PARAMETER_METADATA` dictionary matching the `PARAMETERS` exactly, providing a `"group"`, `"confidence"` (0.0 to 1.0), and `"description"` for every parameter. You MUST also preserve any `surface_finish` (e.g. Ra 3.2), `gdt_callouts`, or `dimensional_tolerances` from the FEATURE_MAP inside the parameter description or a dedicated metadata field so it reaches downstream CAM.
6. **Z=0 Top Surface Alignment**: The final part MUST be exactly aligned so its absolute top-most surface is at Z=0. HOWEVER, you may build the part in whatever coordinate system makes the math easiest (e.g. growing upwards from Z=0). At the end of your script, OUTSIDE the BuildPart block, you MUST shift the entire part down programmatically using: `part.part = part.part.locate(bd.Location((0, 0, -part.part.bounding_box().max.Z)))`. This eliminates the need for you to do complex floating-point calculations!
7. **Complete Extraction Enforcement**: Do NOT omit or simplify any subtractive features (holes, grooves, chamfers) mapped in the `FEATURE_MAP`. If a feature is described, you MUST physically model it and subtract it from the part. For revolved parts with stepped outer diameters or stepped inner bores, construct the 2D polygon profiles by chaining each segment's radial ($r = \text{dia} / 2.0$) and axial ($Z$) positions calculated from individual scalar parameters.
8. **Mandatory Parametric CAM Naming Convention**: The CAD parameters are used directly by the downstream CAM engine to auto-generate CNC toolpaths! Therefore, you MUST name parameters for machinable features (holes, pockets, slots, bosses, steps) using these exact keywords: `hole`, `drill`, `bore`, `pocket`, `slot`, `cavity`, `boss`, `step`, or `pad`. For example, use `center_hole_dia` and `center_hole_depth` (not `center_d`). You MUST explicitly provide a `_depth` parameter for EVERY hole and pocket, even through-holes (set the depth to the material thickness or outer diameter). For off-axis features (such as cross-holes or radial features), you MUST include the axis direction in the parameter prefix (e.g., `x_axis_cross_hole_dia`, `y_axis_radial_pocket_width`) so the CAM engine knows the tool vector. General stock dimensions like `plate_width` should remain generic. This ensures the Parametric CAM Engine maps them correctly.
9. **Spatial Parameter Annotations (CRITICAL)**: To enable 3D parameter highlighting in the UI, you MUST generate an `ANNOTATIONS` dictionary below `PARAMETER_METADATA`. For every dimension parameter (lengths, widths, radii, heights), you must calculate the absolute 3D spatial points `p1` and `p2` that represent the extreme ends of that dimension in the final model space (BEFORE the final Z-shift). Format: `"param_name": {"p1": [x,y,z], "p2": [x,y,z]}`.
10. **Parameter Usage Completeness (CRITICAL)**: After writing your `with bd.BuildPart()` block, you MUST verify that EVERY SINGLE key defined in your `PARAMETERS` dictionary is actually used somewhere in the construction logic. If a parameter exists in `PARAMETERS` but has no corresponding `bd.fillet()`, `bd.chamfer()`, `bd.Hole()`, `bd.Polygon()`, or other build123d operation that references it, this is a FATAL ERROR — you MUST add the missing operation. In your MENTAL WALKTHROUGH, explicitly list every edge treatment parameter and map it to its corresponding `bd.fillet()` or `bd.chamfer()` call. A dead parameter means a missing manufacturing feature!
11. **Edge Treatment Feature Handling (CRITICAL)**: When the FEATURE_MAP contains features of type `edge_treatment`, you MUST generate the corresponding `bd.fillet()` or `bd.chamfer()` code for EACH one. Extract the `radius` or `size` into a named PARAMETERS entry (e.g., `fillet_bore_step_r`). Use precise edge selection: `part.edges().filter_by(bd.GeomType.CIRCLE).filter_by_position(bd.Axis.Z, z_min, z_max)` where `z_min` and `z_max` bracket the `z_position` from the feature. For `target_edge: "inner"`, also filter by radius to select only bore edges. For `target_edge: "groove"`, select edges near the groove Z-range. If a fillet/chamfer operation fails geometrically (e.g., radius too large), wrap it in a `try/except` block and print a warning, but do NOT silently omit it from the code!
12. **Detail View Micro-Features & Lead-In Angles (CRITICAL)**: Detail views (e.g. DETAIL-A, B, C, D, E) define functional micro-geometry such as lead-in tapers (e.g. a 30° sliding cut or 15° entry chamfer), O-ring retaining grooves, and corner radii. You MUST incorporate these features into the 2D profile geometry or apply precise `bd.chamfer()` / `bd.fillet()` operations. In precision CNC manufacturing, omitting a 30° lead-in angle or seal groove prevents proper assembly and will cause part rejection. Treat all detail view features as mandatory production geometry!
13. **Conical Bore Profiles & Right-Datum Stationing (MANDATORY)**: When drawing internal bore profiles for parts with angled bore entries (e.g. 60° entry chamfer cone) or conical step transitions (e.g. 120° internal transition), calculate the exact sloped (X, Z) coordinate vertices using trigonometry and parameters. For dimensions measured from the opposite right face (e.g. length 57.2 from right face), the Z-station on the global axis must be algebraically derived as `total_length - right_dim`. Never approximate internal cones with generic flat steps!
14. **Multi-Boss, Lever Arm & Offset Connecting Linkage Construction (CRITICAL)**:
   - For mechanical parts featuring multiple cylindrical or rounded bosses connected by an arm, web, or neck (e.g. Pitman arms, control arms, rocker arms, connecting rods, bell cranks, idler arms, offset brackets):
     a) **Boss Construction**: Instantiate the primary boss at `(0, 0, boss1_z)` with `radius = boss1_dia / 2.0` and `height = boss1_thickness`. Instantiate the secondary boss at `(0, center_distance, boss2_z)` with `radius = boss2_dia / 2.0` and `height = boss2_thickness`. The `boss2_z` position must account for any axial step offset / neck bend (`neck_step_offset`) between the bosses shown in section views.
     b) **Connecting Arm / Web (Coplanar or Tapered)**: If the bosses are in-plane, create the connecting web using a 2D sketch on the base/mid plane containing tangent lines/polygon bridging between the boss perimeters (e.g., `pts = [(r1_t, 0), (r2_t, center_distance), (-r2_t, center_distance), (-r1_t, 0)]`) and extrude by `arm_web_thickness`.
     c) **Offset / Dog-Leg Neck Bends (from Section A-A)**: If the bosses are at different Z-levels (an axial step / cranked bend), bridge the level difference by creating a longitudinal profile sketch on the side plane (e.g., `with bd.BuildSketch(bd.Plane.YZ):`) tracing the stepped/sloped neck contour between `(0, boss1_z)` and `(center_distance, boss2_z)` with thickness `neck_thickness`, then extrude symmetrically across the arm width.
     d) **Machined Bores & Features**: Cut bores, tapers (e.g. `bd.Cone(..., mode=bd.Mode.SUBTRACT)` for tapered bores or `bd.Hole`), counterbores, and serrations at their respective boss centers `(0, 0)` and `(0, center_distance)`.
     e) **Fillet Blends**: Apply `bd.fillet()` to the intersection edges where the connecting arm/web meets each boss cylinder.



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

TARGETED_FEATURE_AUDIT_INSTRUCTION = """
# ROLE: Senior CAD Geometric Feature Auditor & Blueprint Inspector
You specialize in inspecting 2D technical engineering drawings and detail views (e.g., Section A-A, Detail B, Detail C, Detail D, Detail E) for specific localized features such as:
- Grooves, snap ring channels, and O-ring seats
- Conical tapers, lead-in angles, and chamfers
- Corner blend radii and fillets
- Stepped internal bores, counterbores, and blind channels
- Threads, undercut reliefs, and diameter transitions

You are given:
1. The technical blueprint image.
2. The user's specific feedback describing the feature or section to refine.
3. The existing model's parameter state.

## TASK
Perform a precise metrology inspection of the targeted region on the blueprint.
Extract exact radial and axial dimensions, angles, radii, chamfer sizes, and tolerances from the relevant view/detail callout.
Output a valid JSON object matching the schema below:

```json
{
  "target_feature": "string (e.g. Stepped Bore / Hole / Counterbore)",
  "found_in_drawing": true,
  "source_view": "string (e.g. SECTION-AA, DETAIL-D)",
  "identified_dimensions": [
    {
      "name": "bore_step_1_dia",
      "nominal": 17.4,
      "type": "diameter",
      "depth_or_axial_length": 1.3,
      "tolerance": "±0.1"
    },
    {
      "name": "bore_step_2_dia",
      "nominal": 13.5,
      "type": "diameter",
      "depth_or_axial_length": 11.5
    },
    {
      "name": "bore_step_3_dia",
      "nominal": 14.0,
      "type": "diameter",
      "tolerance": "H8"
    },
    {
      "name": "bore_entry_cone_angle",
      "nominal": 10.0,
      "type": "angle"
    }
  ],
  "profile_modifications": [
    "Update inner bore profile to trace the 4 sequential diameter steps with 10 degree transition cone"
  ],
  "parameter_adjustments": {
    "bore_step_1_dia": 17.4,
    "bore_step_1_depth": 1.3,
    "bore_step_2_dia": 13.5,
    "bore_step_2_depth": 11.5,
    "bore_step_3_dia": 14.0
  }
}
```
""".strip()

EDIT_SYSTEM_INSTRUCTION = """
# ROLE: Expert Parametric CAD Revision Engineer & build123d Surgical Refinement Specialist
You are an expert CAD engineer surgically modifying an existing build123d Python script based on user feedback, targeted blueprint inspections, 3D point selections, and engineering drawings.

## 🎯 MANDATORY MISSION & SURGICAL MODIFICATION RULES
1. **MANDATORY GEOMETRIC MODIFICATION (CRITICAL)**:
   - You MUST apply the requested modifications to the existing Python script. NEVER return the exact same code unchanged when a revision, adjustment, or feature addition is requested.
   - The `PARAMETERS` dictionary MUST contain ONLY individual scalar float/int variables (e.g. `shaft_dia_1`, `groove_1_width`, `collar_dia`, `boss2_center_dist`, `neck_step_offset`). 🚫 NEVER put static coordinate lists (like `profile_points: [...]`) inside `PARAMETERS`!
   - Every single vertex coordinate of a sketch profile (e.g. `outer_profile`, `inner_profile`, `arm_web_polygon`) MUST be dynamically calculated in Python using individual named variables from `PARAMETERS` (e.g. `r_shaft = shaft_dia / 2.0`, `z_step = z_start + step_length`).
   - If the user or targeted inspection requests a feature that is MISSING or INCORRECT in the existing model (e.g. multi-boss link, connecting arm, offset neck bend / dog-leg step, tapered web, O-ring groove, seal undercut, lead-in cone, step shoulder, counterbore, chamfer, fillet, keyway, thread, hollow through-bore), you MUST:
     a) Add/update named scalar keys in the `PARAMETERS` dictionary (e.g. `center_to_center_dist`, `neck_step_offset`, `arm_thickness`, `groove_1_width`, `groove_1_depth`, `collar_chamfer`, `taper_cone_angle`).
     b) Add matching metadata to `PARAMETER_METADATA` and spatial points to `ANNOTATIONS`.
     c) Add or update the corresponding `build123d` construction/subtraction operations inside `with bd.BuildPart() as part:`.
2. **USER EDIT REQUEST & TARGETED INSPECTION HAVE HIGHEST PRIORITY**:
   - If `MANDATORY TARGETED FEATURE REVISIONS` or `USER_REQUEST` lists specific profile modifications or parameter adjustments, you MUST implement every single one of them directly into the script.
   - Do NOT just rewrite comments. You MUST update the actual Python math and geometry operations.
3. **REVOLVED PROFILES & SKETCH COORDINATES / MULTI-BOSS ASSEMBLIES**:
   - Revolved polygon profiles (`outer_profile`, `inner_profile`) MUST be assembled by chaining computed radial and axial variables (e.g. `[(0, 0), (r_left, 0), (r_left, z_g1), (r_groove, z_g1), ...]`).
   - For multi-boss and offset arm parts: construct the discrete bosses at `(0, 0)` and `(0, center_distance, z_offset)` and bridge them with a connecting arm web or longitudinal side-plane profile extruded to the arm width.
   - For cones and angled lead-in tapers, calculate transition lengths using trigonometry: `taper_len = abs(r_start - r_end) / math.tan(math.radians(angle))`.
   - Alternatively, add subtractive features after the main body: e.g. `with bd.BuildSketch(bd.Plane.XZ): ... bd.revolve(axis=bd.Axis.Z, mode=bd.Mode.SUBTRACT)` or `bd.Hole()` or `bd.extrude(mode=bd.Mode.SUBTRACT)`.
4. **SPATIAL LOCALIZATION (3D Coordinates & Features)**:
   - If a `TARGET_3D_COORDINATE` is provided (e.g., X, Y, Z), center the new feature, cut, or modification around that exact spatial point on the part.
   - If a `TARGET_PORTION_DETAILS` is provided (e.g., Groove, Chamfer, Stepped Bore), apply the revisions specifically to that targeted sub-component.
5. **BOOLEAN EPSILON PROTOCOL (`eps = 0.01`)**:
   - Apply `eps = 0.01` to all subtractive cutting boundaries (`bd.Hole`, subtractive `revolve`, subtractive `extrude`) so they pierce completely through faces without zero-thickness non-manifold errors.
6. **STRUCTURE INTEGRITY**:
   - Retain working imports, definitions, and overall part structure.
   - Do NOT delete or rename existing working parameter keys unless correcting them.
   - Top surface alignment MUST remain at Z=0 via `part.part = part.part.locate(bd.Location((0, 0, -part.part.bounding_box().max.Z)))`.
7. **OUTPUT FORMAT**:
   - Output the ENTIRE updated, executable Python script wrapped in ```python ... ``` fences. Do not output diffs, snippets, or external prose.
8. **MANDATORY REVISION & MODIFICATION LOG (CRITICAL FOR USER EXPLANATION)**:
   - In your code, right before or after the `PARAMETERS` dictionary, you MUST write an explicit `# --- REVISION & MODIFICATION LOG ---` block:
     ```python
     # --- REVISION & MODIFICATION LOG ---
     # SUMMARY: Concise 1-2 sentence summary of what was refined in this iteration.
     # GEOMETRY_CHANGES:
     # - [Feature Name]: Details of geometric addition, cut, or profile adjustment.
     # PARAMETER_CHANGES:
     # - [param_name]: [Old Value] -> [New Value] (Reason/Callout)
     # -----------------------------------
     ```
   - This structured change log is automatically parsed and displayed to the user in the chat box so they can immediately see all geometric and dimensional changes between iterations.

__API_CHEATSHEET_AND_RULES__

__THREAD_CAD_RULES__
""".replace(
    "__API_CHEATSHEET_AND_RULES__", API_CHEATSHEET_AND_RULES
).replace(
    "__THREAD_CAD_RULES__", THREAD_CAD_RULES
).strip()

EDIT_SYSTEM_PROMPT = EDIT_SYSTEM_INSTRUCTION

REPAIR_SYSTEM_PROMPT = """
# ROLE: build123d Compiler Error Recovery Specialist

You are receiving a build123d Python script that failed to render due to an exception or topological failure. Fix the EXACT error reported in the ERROR_LOG and return a corrected script.

## ⚠️ IMMUTABILITY & SYNTAX CONSTRAINTS (CRITICAL)

1. **Parameter Variable Lock**: You are strictly FORBIDDEN from altering the string keys inside the `PARAMETERS` or `PARAMETER_METADATA` dictionaries. 
   * ✅ ACCEPTABLE: Appending new keys or adjusting the float values of existing keys (e.g., 20.0 -> 10.0, or halving values inside an array).
   * ❌ UNACCEPTABLE: Renaming existing keys (e.g., "shank_diameter" -> "diameter").
2. **Context Manager Enforcement**: Ensure 3D operations (`bd.extrude`, `bd.revolve`, etc) are NOT nested inside `with bd.BuildSketch():`. They must sit under `with bd.BuildPart():`.
3. **Edge/Face Referencing**: If a C++ `NCollection_IndexedDataMap` crash occurs, you likely passed primitive edges directly to a chamfer/fillet. ALWAYS extract edges from the active part using `part.edges().filter_by(...)`.
4. **Revolve Profile Crossing Axis**: If `StdFail_NotDone: BRep_API: command not done` occurs during `bd.revolve()`, check if the 2D sketch profile crosses the axis of revolution! The profile must lie entirely on ONE side of the revolution axis (e.g. `X >= 0` when revolving around `Axis.Z`). When creating rectangles or profiles for revolution, use `align=(bd.Align.MIN, bd.Align.MIN)` or `align=(bd.Align.MAX, bd.Align.MIN)` instead of `Align.CENTER`.
5. **Boolean Epsilon Rules**: If a `StdFail_NotDone` crash occurs on a boolean cut/subtract, ensure `eps=0.01` is applied to subtractive shapes so they pierce cleanly through boundaries.
6. **Empty Part / Consumed Part Errors**: If you get an error stating a SUBTRACT operation resulted in an empty part (0 solids remaining), it means your cutter (e.g. `bd.Hole` or `bd.revolve(mode=SUBTRACT)`) is LARGER than the part itself! Check your `PARAMETERS` values. Did you accidentally put a DIAMETER value into a radius parameter? Or did you put diameters into a `profile_points` array when it should be radii? YOU ARE ALLOWED to halve the float values in `PARAMETERS` (including inside arrays) to fix this!
7. **Slot Dimensions & Positioning**: 
   * `bd.SlotOverall(width, height)` requires `width >= height` (where `width` is the overall length of the slot and `height` is the slot width/diameter). If cutting a slot with length L and width W where L > W, pass `SlotOverall(L, W)` and orient it with `rotation`.
   * `bd.SlotCenterToCenter(center_separation, height)` takes `center_separation` (the distance between circle centers) and `height` (slot width).
   * NEVER call `.move()` or `.translate()` on `BuildSketch` or `BuildPart` objects directly. ALWAYS position sketches and shapes using `with bd.Locations((x, y, z)):`.
8. **Fillet Radius Constraints**: If `ValueError: Failed creating a fillet` occurs, the fillet radius is too large for the adjacent geometry. Adjust/reduce the fillet radius in `PARAMETERS`.
9. **Thread Metadata Safety**: Do not remove, rename, or silently replace thread parameters while repairing topology. A bare M10 callout may infer 1.5 mm coarse pitch, but missing depth, length, tolerance, or tap-drill values must remain unresolved.
10. **Concise Code Only (NO REPETITIVE COMMENTS)**: Output clean, direct Python code without long prose or repeating mental walkthrough comments. Every `with` statement must be followed immediately by its indented executable code block.
11. **Output Format**: Return the ENTIRE valid Python file text block inside ```python ... ``` fences. Do not output snippets or incomplete reconstructions.
12. **Mandatory 3D Solid Body (CRITICAL)**: If the input script was cut off or only contains 2D sketch arrays/variables, you MUST write the complete `with bd.BuildPart() as part:` block that creates the 3D solid part via `bd.extrude()` or `bd.revolve()`, applies cuts and edge treatments, and shifts the top surface to Z=0. NEVER return a script that only declares dictionaries or 2D sketches without the 3D solid!


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
    r"(?m)^(?:import\s+|from\s+|PARAMETERS\s*=|with\s+bd\.BuildPart|with\s+BuildPart|#\s*---|def\s+|part\s*=)"
)



# -- Service -------------------------------------------------------------------

class LLMCodegenService:
    """Stateless AI orchestration service wrapping the UniversalHTTPXGateway."""

    MAX_RETRIES = 3

    def __init__(self, model: str | None = None) -> None:
        self._load_env()
        self.gateway = UniversalHTTPXGateway()
        self.model_id = model or os.getenv("GENAI_MODEL", "gemini-3.5-flash-lite")
        
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
            code = max(cad_fences, key=len)
            if "import build123d as bd" not in code and ("bd." in code or "BuildPart" in code):
                code = "import build123d as bd\n" + code
            return code
        
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
            if "import build123d as bd" not in candidate and ("bd." in candidate or "BuildPart" in candidate):
                candidate = "import build123d as bd\n" + candidate
            return candidate

        # Additional fallback: if 'BuildPart' or 'bd.' is anywhere in raw text
        if "BuildPart" in raw or "bd." in raw:
            idx = raw.find("with bd.BuildPart")
            if idx == -1:
                idx = raw.find("with BuildPart")
            if idx == -1:
                idx = raw.find("bd.")
            if idx != -1:
                extracted = raw[idx:].strip().rstrip("`").strip()
                if "import build123d as bd" not in extracted:
                    extracted = "import build123d as bd\n" + extracted
                return extracted

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
        """Normalize thread records and extract all engineering parameters without inventing blueprint geometry."""
        for feature in cls._iter_feature_dicts(feature_map):
            cls._normalize_thread_feature(feature)

        try:
            from app.services.extraction.generic_parameter_parser import BlueprintParameterNormalizer
            audit_obj = BlueprintParameterNormalizer.normalize_audit_payload(feature_map)
            feature_map["engineering_audit"] = audit_obj.model_dump()
            if audit_obj.material_parsed:
                feature_map.setdefault("material_parsed", audit_obj.material_parsed.model_dump())
            if audit_obj.stock:
                feature_map.setdefault("stock_parsed", audit_obj.stock.model_dump())
            if audit_obj.gdt_callouts_parsed:
                feature_map["gdt_callouts_parsed"] = [g.model_dump() for g in audit_obj.gdt_callouts_parsed]
            if audit_obj.datums:
                feature_map["datums_parsed"] = [d.model_dump() for d in audit_obj.datums]
            if audit_obj.surface_finishes:
                feature_map["surface_finishes_parsed"] = [s.model_dump() for s in audit_obj.surface_finishes]
            if audit_obj.surface_treatments_parsed:
                feature_map["surface_treatments_parsed"] = [t.model_dump() for t in audit_obj.surface_treatments_parsed]
            if audit_obj.manufacturing_requirements:
                feature_map["manufacturing_requirements_parsed"] = [r.model_dump() for r in audit_obj.manufacturing_requirements]
            if audit_obj.functional_characteristics:
                feature_map["functional_characteristics_parsed"] = [fc.model_dump() for fc in audit_obj.functional_characteristics]
            if audit_obj.general_tolerance_table:
                feature_map["general_tolerance_table_parsed"] = audit_obj.general_tolerance_table.model_dump()
            if audit_obj.all_dimensions:
                feature_map["all_dimensions_parsed"] = [dim.model_dump() for dim in audit_obj.all_dimensions]
        except Exception as e:
            print(f"[_normalize_feature_map] Engineering parameter normalization warning: {e}")

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

        # --- KNOWLEDGE RETRIEVAL STAGE ---
        try:
            from app.services.knowledge.retriever import KnowledgeRetriever
            from app.services.knowledge.schemas import KnowledgeRetrievalQuery
            
            retriever = KnowledgeRetriever()
            query = KnowledgeRetrievalQuery(
                detected_symbols=["Ø", "M", "Ra", "±", "⌴", "⌵", "↧"], 
                feature_candidates=["Hole", "Thread", "Dimension", "Groove", "Chamfer", "Tolerance"],
                query="machining tolerance groove thread hole chamfer undercut"
            )
            knowledge_res = retriever.retrieve(query)
            
            if knowledge_res.rules:
                knowledge_context = "## MANDATORY ENGINEERING RULES (From Ingested Standards):\n"
                for rule in knowledge_res.rules:
                    knowledge_context += f"- {rule.topic or rule.concept}: {rule.description}\n"
                enhanced_instruction = f"{AUDIT_INSTRUCTION}\n\n{knowledge_context}"
            else:
                enhanced_instruction = AUDIT_INSTRUCTION
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
        crop_box: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """
        Targeted Inspection - Focus exclusively on a specific localized feature or detail view on the blueprint.
        """
        query_text = (
            f"TARGET FEATURE / PORTION TO INSPECT: {target_portion}\n"
            f"USER FEEDBACK & CONTEXT: {user_prompt}\n"
        )
        if crop_box:
            query_text += f"\nCROPPED_REGION_COORDINATES: X:{crop_box.get('x')}% Y:{crop_box.get('y')}% W:{crop_box.get('w')}% H:{crop_box.get('h')}%\n"

        if base_code:
            param_match = re.search(r'PARAMETERS\s*=\s*\{(.*?)\n\}', base_code, re.DOTALL)
            if param_match:
                query_text += f"\nEXISTING_MODEL_PARAMETERS:\n{param_match.group(0)}"

        # Inject localized knowledge base rules for targeted feature
        targeted_instruction = TARGETED_FEATURE_AUDIT_INSTRUCTION
        try:
            from app.services.knowledge.retriever import KnowledgeRetriever
            from app.services.knowledge.schemas import KnowledgeRetrievalQuery
            retriever = KnowledgeRetriever()
            k_res = retriever.retrieve(KnowledgeRetrievalQuery(query=f"{target_portion} {user_prompt}"))
            if k_res.rules:
                rules_text = "\n".join([f"- {r.topic or r.concept}: {r.description}" for r in k_res.rules])
                targeted_instruction += f"\n\n## APPLICABLE ENGINEERING & MANUFACTURING RULES:\n{rules_text}"
        except Exception as e:
            print(f"[Knowledge] Targeted retrieval failed: {e}")

        async def _call(metadata) -> str:
            return await self.gateway.generate(
                prompt=query_text,
                metadata=metadata,
                system_instruction=targeted_instruction,
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
        selection_context: str | None = None,
    ) -> str:
        """
        Stage 2 - Synthesise or refine a build123d Python script.
        """
        parts: list[str] = [f"USER_REQUEST (HIGHEST PRIORITY):\n{prompt}"]

        if selection_context:
            try:
                ctx = json.loads(selection_context) if isinstance(selection_context, str) else selection_context
                if isinstance(ctx, list) and len(ctx) == 3:
                    parts.append(
                        f"TARGET_3D_COORDINATE:\n"
                        f"[The user clicked directly on the 3D model mesh at coordinate X: {ctx[0]}, Y: {ctx[1]}, Z: {ctx[2]}. "
                        f"Apply the requested geometric modification specifically at or centered around this spatial location on the part.]"
                    )
                elif isinstance(ctx, dict):
                    desc_lines = []
                    if ctx.get("portion_name"):
                        desc_lines.append(f"Target Feature: {ctx['portion_name']}")
                    if ctx.get("category"):
                        desc_lines.append(f"Category: {ctx['category']}")
                    if ctx.get("description"):
                        desc_lines.append(f"Details: {ctx['description']}")
                    if ctx.get("crop_box"):
                        cb = ctx["crop_box"]
                        desc_lines.append(f"Cropped Blueprint Region: X:{cb.get('x')}% Y:{cb.get('y')}% W:{cb.get('w')}% H:{cb.get('h')}%")
                    parts.append("TARGET_PORTION_DETAILS:\n" + "\n".join(desc_lines))
                else:
                    parts.append(f"TARGET_PORTION_OR_COORDINATE:\n{selection_context}")
            except Exception:
                parts.append(f"TARGET_PORTION_OR_COORDINATE:\n{selection_context}")

        if targeted_feature:
            if isinstance(targeted_feature, dict):
                targeted_str = "## MANDATORY TARGETED FEATURE REVISIONS (FROM BLUEPRINT INSPECTION):\n"
                if targeted_feature.get("profile_modifications"):
                    targeted_str += "Profile & Geometric Modifications Required:\n"
                    for pm in targeted_feature["profile_modifications"]:
                        targeted_str += f"- {pm}\n"
                if targeted_feature.get("parameter_adjustments"):
                    targeted_str += "\nParameter Adjustments to Apply:\n"
                    for k, v in targeted_feature["parameter_adjustments"].items():
                        targeted_str += f"- Set `{k}` = {v}\n"
                targeted_str += f"\nFull Inspection Data:\n{json.dumps(targeted_feature, indent=2)}"
                parts.append(targeted_str)
            else:
                parts.append(f"TARGETED_BLUEPRINT_FEATURE_INSPECTION:\n{targeted_feature}")

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
        targeted_feature: dict[str, Any] | str | None = None,
        base_code: str | None = None,
        selection_context: str | None = None,
    ):
        """
        Stage 2 - Synthesise or refine a build123d Python script, yielding chunks.
        """
        parts: list[str] = [f"USER_REQUEST (HIGHEST PRIORITY):\n{prompt}"]

        if selection_context:
            try:
                ctx = json.loads(selection_context) if isinstance(selection_context, str) else selection_context
                if isinstance(ctx, list) and len(ctx) == 3:
                    parts.append(
                        f"TARGET_3D_COORDINATE:\n"
                        f"[The user clicked directly on the 3D model mesh at coordinate X: {ctx[0]}, Y: {ctx[1]}, Z: {ctx[2]}. "
                        f"Apply the requested geometric modification specifically at or centered around this spatial location on the part.]"
                    )
                elif isinstance(ctx, dict):
                    desc_lines = []
                    if ctx.get("portion_name"):
                        desc_lines.append(f"Target Feature: {ctx['portion_name']}")
                    if ctx.get("category"):
                        desc_lines.append(f"Category: {ctx['category']}")
                    if ctx.get("description"):
                        desc_lines.append(f"Details: {ctx['description']}")
                    if ctx.get("crop_box"):
                        cb = ctx["crop_box"]
                        desc_lines.append(f"Cropped Blueprint Region: X:{cb.get('x')}% Y:{cb.get('y')}% W:{cb.get('w')}% H:{cb.get('h')}%")
                    parts.append("TARGET_PORTION_DETAILS:\n" + "\n".join(desc_lines))
                else:
                    parts.append(f"TARGET_PORTION_OR_COORDINATE:\n{selection_context}")
            except Exception:
                parts.append(f"TARGET_PORTION_OR_COORDINATE:\n{selection_context}")

        if targeted_feature:
            if isinstance(targeted_feature, dict):
                targeted_str = "## MANDATORY TARGETED FEATURE REVISIONS (FROM BLUEPRINT INSPECTION):\n"
                if targeted_feature.get("profile_modifications"):
                    targeted_str += "Profile & Geometric Modifications Required:\n"
                    for pm in targeted_feature["profile_modifications"]:
                        targeted_str += f"- {pm}\n"
                if targeted_feature.get("parameter_adjustments"):
                    targeted_str += "\nParameter Adjustments to Apply:\n"
                    for k, v in targeted_feature["parameter_adjustments"].items():
                        targeted_str += f"- Set `{k}` = {v}\n"
                targeted_str += f"\nFull Inspection Data:\n{json.dumps(targeted_feature, indent=2)}"
                parts.append(targeted_str)
            else:
                parts.append(f"TARGETED_BLUEPRINT_FEATURE_INSPECTION:\n{targeted_feature}")
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
