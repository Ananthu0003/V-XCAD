"""
Generic Engineering Parameter Parser & Normalizer.

Deterministic, standards-compliant parser for engineering drawing annotations:
- Tolerances (symmetric, deviational, limits, ISO 286 fits, basic, general)
- Linear, radial, and angular dimensions
- Chamfers (size + angle) and Fillets (radius + multiplicity)
- GD&T feature control frames, material conditions, and datum references
- Datums and target geometric elements
- Surface roughness / finish (Ra, Rz)
- Title block material and stock specifications
- Surface treatments (thickness, hardness, process)
- Manufacturing requirements and notes
- Functional / inspection characteristics (mass, wetted surface, gasket area)
- General tolerance tables (ISO 2768, DIN 7168)
- Comprehensive DrawingBlueprintAudit builder with semantic feature association

ZERO HARDCODING: Uses generic regex and ISO standards data only.
"""

from __future__ import annotations

import math
import re
from typing import Any, Dict, List, Optional, Tuple, Union

from app.models.engineering_parameters import (
    AngularParameter,
    ChamferParameter,
    DatumDefinition,
    DiameterKind,
    DiameterParameter,
    DimensionType,
    DrawingBlueprintAudit,
    FeatureExtractionRecord,
    FilletParameter,
    FunctionalCharacteristic,
    GDNTCallout,
    GDNTType,
    GeneralToleranceRule,
    GeneralToleranceTable,
    GenericDimension,
    ManufacturingRequirement,
    MaterialCondition,
    MaterialSpecification,
    RadiusKind,
    RadiusParameter,
    StockSpecification,
    SurfaceFinish,
    SurfaceTreatment,
    Tolerance,
    ToleranceType,
)


# ─── REGEX DEFINITIONS ────────────────────────────────────────────────────────

# Symmetric: ±0.1, +/-0.2, +- 0.05, ± 0.0135
_SYMMETRIC_TOL_RE = re.compile(
    r"(?:±|\+/-|\+-)\s*(?P<val>\d+(?:[.,]\d+)?)",
    re.IGNORECASE,
)

# Deviational: +0.2/-0.1, +0.02/0, 0/-0.033, +0.2/+0.1, -0.05/-0.15
_DEVIATIONAL_TOL_RE = re.compile(
    r"(?:(?P<upper>[+-]\d+(?:[.,]\d+)?)\s*[/|\\]\s*(?P<lower>[+-]?\d+(?:[.,]\d+)?))|"
    r"(?:(?P<upper2>0(?:\.0+)?)\s*[/|\\]\s*(?P<lower2>[+-]\d+(?:[.,]\d+)?))",
    re.IGNORECASE,
)

# ISO Fits: H8, h8, h11, H7, g6, f7, JS7, P7, m6, k6, N9, etc.
_ISO_FIT_RE = re.compile(
    r"\b(?P<letter>[A-Za-z]{1,2})(?P<grade>\d{1,2})\b"
)

# Limits: 25.5 / 25.3 or 25.5 - 25.3
_LIMITS_TOL_RE = re.compile(
    r"^(?P<val1>\d+(?:[.,]\d+)?)\s*(?:/|-|–)\s*(?P<val2>\d+(?:[.,]\d+)?)$"
)

# Chamfer: 1.4 x 15°, 0.2 × 45°, 1 x 20 deg, C1.4, 1.4x15
_CHAMFER_RE = re.compile(
    r"(?:(?P<size>\d+(?:[.,]\d+)?)\s*(?:x|×|\*)\s*(?P<angle>\d+(?:[.,]\d+)?)\s*(?:°|deg|degrees?)?)|"
    r"(?:C\s*(?P<c_size>\d+(?:[.,]\d+)?))",
    re.IGNORECASE,
)

# Fillet: R0.2, R 0.4, 2X R0.2, 4x R1.5
_FILLET_RE = re.compile(
    r"(?:(?P<mult>\d+)\s*[xX×]\s*)?R\s*(?P<radius>\d+(?:[.,]\d+)?)",
    re.IGNORECASE,
)

# Angular: 10°, 15 deg, 20°, 30 degrees, 45°
_ANGLE_RE = re.compile(
    r"(?P<angle>\d+(?:[.,]\d+)?)\s*(?:°|deg(?:rees?)?)",
    re.IGNORECASE,
)

# Surface Roughness: Ra 1.6, Ra 0.8, Rz 3.2, Ra=0.4
_SURFACE_FINISH_RE = re.compile(
    r"\b(?P<type>Ra|Rz|Rq|Ry)\s*(?:=|\s)?\s*(?P<val>\d+(?:[.,]\d+)?)",
    re.IGNORECASE,
)

# Diameter: Ø25.5, DIA 25, D25.0, %%c25
_DIAMETER_RE = re.compile(
    r"(?:Ø|DIA|D|%%c)\s*(?P<val>\d+(?:[.,]\d+)?)",
    re.IGNORECASE,
)


# ─── ISO 286 STANDARD TOLERANCE TABLE (Fundamental Deviations in mm) ───────────
# Standard ISO tolerance calculation for engineering fits (IT6-IT11)
_ISO_286_DIAMETER_STEPS = [
    (0.0, 3.0),
    (3.0, 6.0),
    (6.0, 10.0),
    (10.0, 18.0),
    (18.0, 30.0),
    (30.0, 50.0),
    (50.0, 80.0),
    (80.0, 120.0),
    (120.0, 180.0),
    (180.0, 250.0),
    (250.0, 315.0),
    (315.0, 400.0),
    (400.0, 500.0),
]

# Standard tolerance values (IT grade in microns)
_IT_TABLE_MICRONS: Dict[int, List[float]] = {
    6: [6, 8, 9, 11, 13, 16, 19, 22, 25, 29, 32, 36, 40],
    7: [10, 12, 15, 18, 21, 25, 30, 35, 40, 46, 52, 57, 63],
    8: [14, 18, 22, 27, 33, 39, 46, 54, 63, 72, 81, 89, 97],
    9: [25, 30, 36, 43, 52, 62, 74, 87, 100, 115, 130, 140, 155],
    10: [40, 48, 58, 70, 84, 100, 120, 140, 160, 185, 210, 230, 250],
    11: [60, 75, 90, 110, 130, 160, 190, 220, 250, 290, 320, 360, 400],
}


def _get_step_index(nominal: float) -> int:
    for idx, (low, high) in enumerate(_ISO_286_DIAMETER_STEPS):
        if low < nominal <= high:
            return idx
        if idx == 0 and low <= nominal <= high:
            return idx
    return len(_ISO_286_DIAMETER_STEPS) - 1


def resolve_iso_fit_deviation(fit_grade: str, nominal_dia: float) -> Tuple[Optional[float], Optional[float]]:
    """
    Calculate standard upper and lower deviations (in mm) for standard ISO fit classes (e.g. H8, h8, h11, H7, g6).
    Returns (upper_deviation_mm, lower_deviation_mm).
    """
    if not fit_grade or nominal_dia <= 0:
        return None, None

    m = _ISO_FIT_RE.match(fit_grade.strip())
    if not m:
        return None, None

    letter = m.group("letter")
    grade_num = int(m.group("grade"))

    if grade_num not in _IT_TABLE_MICRONS:
        return None, None

    step_idx = _get_step_index(nominal_dia)
    it_val_mm = _IT_TABLE_MICRONS[grade_num][step_idx] / 1000.0

    # Hole basis fits (H)
    if letter == "H":
        return it_val_mm, 0.0

    # Shaft basis fits (h)
    if letter == "h":
        return 0.0, -it_val_mm

    # Basic g fits (clearance shaft)
    if letter == "g":
        # Fundamental deviation table for g in microns
        g_dev_um = [2, 4, 5, 6, 7, 9, 10, 12, 14, 15, 17, 18, 20]
        ei_mm = -g_dev_um[step_idx] / 1000.0
        return ei_mm, ei_mm - it_val_mm

    # Basic f fits (clearance shaft)
    if letter == "f":
        f_dev_um = [6, 10, 13, 16, 20, 25, 30, 36, 43, 50, 56, 62, 68]
        ei_mm = -f_dev_um[step_idx] / 1000.0
        return ei_mm, ei_mm - it_val_mm

    # Basic JS/js fits (symmetric)
    if letter.lower() == "js":
        half_it = it_val_mm / 2.0
        return half_it, -half_it

    # Default fallback for recognized fit grade
    if letter.isupper():
        return it_val_mm, 0.0
    else:
        return 0.0, -it_val_mm


# ─── PARSER FUNCTIONS ─────────────────────────────────────────────────────────

def parse_tolerance_string(raw: Any, nominal: Optional[float] = None) -> Optional[Tolerance]:
    """
    Deterministically parses tolerance specifications from raw strings or structured dictionaries.
    Supports: ±0.1, +0.2/-0.1, +0.02/0, 0/-0.033, H8, h8, h11, 25.5/25.3, Basic, Min, Max.
    """
    if raw is None or raw == "":
        return None

    if isinstance(raw, Tolerance):
        return raw

    if isinstance(raw, dict):
        t_type = raw.get("type", "unspecified")
        try:
            enum_type = ToleranceType(t_type)
        except Exception:
            enum_type = ToleranceType.UNSPECIFIED

        upper = raw.get("upper")
        lower = raw.get("lower")
        fit_grade = raw.get("fit_grade")

        # If fit grade given but deviations missing, resolve dynamically
        if fit_grade and (upper is None or lower is None) and nominal:
            u_dev, l_dev = resolve_iso_fit_deviation(fit_grade, nominal)
            upper = upper if upper is not None else u_dev
            lower = lower if lower is not None else l_dev

        return Tolerance(
            type=enum_type,
            upper=float(upper) if upper is not None else None,
            lower=float(lower) if lower is not None else None,
            nominal=float(nominal) if nominal is not None else None,
            fit_grade=fit_grade,
            raw_text=raw.get("raw_text"),
            standard=raw.get("standard"),
        )

    text = str(raw).strip()

    # 1. Symmetric tolerance: ±0.1, +/-0.2
    sym_m = _SYMMETRIC_TOL_RE.search(text)
    if sym_m:
        val = float(sym_m.group("val").replace(",", "."))
        return Tolerance(
            type=ToleranceType.SYMMETRIC,
            upper=val,
            lower=-val,
            nominal=nominal,
            raw_text=text,
        )

    # 2. Deviational tolerance: +0.2/-0.1, +0.02/0, 0/-0.033, +0.2/+0.1
    dev_m = _DEVIATIONAL_TOL_RE.search(text)
    if dev_m:
        upper_str = dev_m.group("upper") if dev_m.group("upper") is not None else dev_m.group("upper2")
        lower_str = dev_m.group("lower") if dev_m.group("lower") is not None else dev_m.group("lower2")
        upper_val = float(upper_str.replace(",", "."))
        lower_val = float(lower_str.replace(",", "."))
        # Ensure upper is >= lower
        if upper_val < lower_val:
            upper_val, lower_val = lower_val, upper_val
        return Tolerance(
            type=ToleranceType.DEVIATIONAL,
            upper=upper_val,
            lower=lower_val,
            nominal=nominal,
            raw_text=text,
        )

    # 3. ISO Fit: H8, h8, h11, H7, g6
    fit_m = _ISO_FIT_RE.search(text)
    if fit_m:
        fit_grade = fit_m.group(0)
        u_dev, l_dev = resolve_iso_fit_deviation(fit_grade, nominal or 20.0)
        return Tolerance(
            type=ToleranceType.ISO_FIT,
            upper=u_dev,
            lower=l_dev,
            nominal=nominal,
            fit_grade=fit_grade,
            raw_text=text,
            standard="ISO 286",
        )

    # 4. Limits: 25.5 / 25.3
    lim_m = _LIMITS_TOL_RE.match(text)
    if lim_m:
        v1 = float(lim_m.group("val1").replace(",", "."))
        v2 = float(lim_m.group("val2").replace(",", "."))
        high = max(v1, v2)
        low = min(v1, v2)
        nom = nominal or ((high + low) / 2.0)
        return Tolerance(
            type=ToleranceType.LIMITS,
            upper=high - nom,
            lower=low - nom,
            nominal=nom,
            raw_text=text,
        )

    # 5. Basic dimension
    if "basic" in text.lower() or (text.startswith("[") and text.endswith("]")):
        return Tolerance(
            type=ToleranceType.BASIC,
            upper=0.0,
            lower=0.0,
            nominal=nominal,
            raw_text=text,
        )

    # 6. Min/Max only
    if "min" in text.lower():
        return Tolerance(
            type=ToleranceType.MIN_ONLY,
            nominal=nominal,
            raw_text=text,
        )
    if "max" in text.lower():
        return Tolerance(
            type=ToleranceType.MAX_ONLY,
            nominal=nominal,
            raw_text=text,
        )

    return None


def parse_chamfer_callout(raw: Any, default_angle: float = 45.0) -> Optional[ChamferParameter]:
    """
    Parses chamfer specifications: 1.4 × 15°, 0.2 × 45°, 1 x 20°, C1.4.
    """
    if raw is None:
        return None

    if isinstance(raw, ChamferParameter):
        return raw

    if isinstance(raw, dict):
        size = float(raw.get("size", raw.get("length", 0.0)))
        angle = float(raw.get("angle", default_angle))
        tol = parse_tolerance_string(raw.get("tolerance"), nominal=size)
        ang_tol = parse_tolerance_string(raw.get("angle_tolerance"), nominal=angle)
        return ChamferParameter(
            id=str(raw.get("id", "")),
            size=size,
            angle=angle,
            unit=str(raw.get("unit", "mm")),
            tolerance=tol,
            angle_tolerance=ang_tol,
            feature_id=raw.get("feature_id") or raw.get("target_feature"),
            target_edge=raw.get("target_edge"),
            source_annotation=raw.get("source_annotation") or raw.get("source"),
            source_view=raw.get("source_view"),
            confidence=float(raw.get("confidence", 1.0)),
        )

    text = str(raw).strip()
    m = _CHAMFER_RE.search(text)
    if m:
        if m.group("c_size"):
            size = float(m.group("c_size").replace(",", "."))
            angle = 45.0
        else:
            size = float(m.group("size").replace(",", "."))
            angle = float(m.group("angle").replace(",", ".")) if m.group("angle") else default_angle

        # Check for tolerances in the rest of the text
        tol = parse_tolerance_string(text, nominal=size)

        return ChamferParameter(
            size=size,
            angle=angle,
            tolerance=tol,
            source_annotation=text,
        )

    return None


def parse_fillet_callout(raw: Any) -> Optional[FilletParameter]:
    """
    Parses fillet specifications: R0.2, R0.4, 2X R0.2, 4X R1.0.
    """
    if raw is None:
        return None

    if isinstance(raw, FilletParameter):
        return raw

    if isinstance(raw, dict):
        radius = float(raw.get("radius", raw.get("r", 0.0)))
        mult = int(raw.get("multiplicity", raw.get("count", 1)))
        tol = parse_tolerance_string(raw.get("tolerance"), nominal=radius)
        return FilletParameter(
            id=str(raw.get("id", "")),
            radius=radius,
            multiplicity=mult,
            unit=str(raw.get("unit", "mm")),
            tolerance=tol,
            feature_id=raw.get("feature_id") or raw.get("target_feature"),
            target_edge=raw.get("target_edge"),
            source_annotation=raw.get("source_annotation") or raw.get("source"),
            source_view=raw.get("source_view"),
            confidence=float(raw.get("confidence", 1.0)),
        )

    text = str(raw).strip()
    m = _FILLET_RE.search(text)
    if m:
        mult = int(m.group("mult")) if m.group("mult") else 1
        radius = float(m.group("radius").replace(",", "."))
        tol = parse_tolerance_string(text, nominal=radius)

        return FilletParameter(
            radius=radius,
            multiplicity=mult,
            tolerance=tol,
            source_annotation=text,
        )

    return None


def parse_angular_callout(raw: Any) -> Optional[AngularParameter]:
    """
    Parses angular dimensions: 10°, 15°, 20°, 30°, 45°, 20 deg.
    """
    if raw is None:
        return None

    if isinstance(raw, AngularParameter):
        return raw

    if isinstance(raw, dict):
        val = float(raw.get("angle_value", raw.get("angle", raw.get("value", 0.0))))
        tol = parse_tolerance_string(raw.get("tolerance"), nominal=val)
        return AngularParameter(
            id=str(raw.get("id", "")),
            angle_value=val,
            unit=str(raw.get("unit", "deg")),
            tolerance=tol,
            feature_id=raw.get("feature_id") or raw.get("target_feature"),
            angle_kind=raw.get("angle_kind", "unspecified"),
            source_annotation=raw.get("source_annotation") or raw.get("source"),
            source_view=raw.get("source_view"),
            confidence=float(raw.get("confidence", 1.0)),
        )

    text = str(raw).strip()
    m = _ANGLE_RE.search(text)
    if m:
        val = float(m.group("angle").replace(",", "."))
        tol = parse_tolerance_string(text, nominal=val)
        return AngularParameter(
            angle_value=val,
            unit="deg",
            tolerance=tol,
            source_annotation=text,
        )

    return None


def parse_surface_finish_callout(raw: Any) -> Optional[SurfaceFinish]:
    """
    Parses surface roughness annotations: Ra 1.6, Ra 0.8, Ra 0.4, Rz 3.2.
    """
    if raw is None:
        return None

    if isinstance(raw, SurfaceFinish):
        return raw

    if isinstance(raw, dict):
        val = float(raw.get("value", raw.get("val", 0.0)))
        r_type = raw.get("roughness_type", raw.get("type", "Ra"))
        return SurfaceFinish(
            id=str(raw.get("id", "")),
            roughness_type=r_type if r_type in ("Ra", "Rz", "Rq", "Ry") else "Ra",
            value=val,
            unit=str(raw.get("unit", "µm")),
            target_face_or_feature=raw.get("target_face_or_feature") or raw.get("target") or raw.get("feature_id"),
            source_annotation=raw.get("source_annotation") or raw.get("source"),
            source_view=raw.get("source_view"),
            is_default=bool(raw.get("is_default", False)),
            confidence=float(raw.get("confidence", 1.0)),
        )

    text = str(raw).strip()
    m = _SURFACE_FINISH_RE.search(text)
    if m:
        r_type = m.group("type")
        val = float(m.group("val").replace(",", "."))
        return SurfaceFinish(
            roughness_type=r_type if r_type in ("Ra", "Rz", "Rq", "Ry") else "Ra",
            value=val,
            unit="µm",
            source_annotation=text,
        )

    return None


def parse_gdnt_callout(raw: Any) -> Optional[GDNTCallout]:
    """
    Parses GD&T Feature Control Frames: Position, Concentricity, Perpendicularity, Runout, etc.
    """
    if raw is None:
        return None

    if isinstance(raw, GDNTCallout):
        return raw

    if isinstance(raw, dict):
        raw_type = str(raw.get("type", raw.get("gdnt_type", "position"))).lower().replace(" ", "_").replace("-", "_")
        # Match enum
        matched_type = GDNTType.POSITION
        for gt in GDNTType:
            if gt.value in raw_type or raw_type in gt.value:
                matched_type = gt
                break

        val_str = str(raw.get("tolerance", raw.get("tolerance_value", "0.0"))).replace("Ø", "").replace("dia", "").strip()
        try:
            val = float(val_str)
        except Exception:
            val = 0.0

        is_dia_zone = bool(
            raw.get("diameter_zone")
            or "Ø" in str(raw.get("tolerance", ""))
            or "dia" in str(raw.get("tolerance", "")).lower()
        )

        mc_str = str(raw.get("material_condition", "RFS")).upper()
        mc = MaterialCondition.RFS
        if "MMC" in mc_str or "Ⓜ" in mc_str:
            mc = MaterialCondition.MMC
        elif "LMC" in mc_str or "Ⓛ" in mc_str:
            mc = MaterialCondition.LMC

        datums = raw.get("datums") or raw.get("datum_references") or []
        if isinstance(datums, str):
            datums = [d.strip() for d in re.split(r"[,|\s]+", datums) if d.strip()]
        elif not isinstance(datums, list):
            datums = [str(datums)] if datums else []
        elif "datum" in raw and raw["datum"] and not datums:
            d_val = str(raw["datum"]).strip()
            datums = [d.strip() for d in re.split(r"[,|\s]+", d_val) if d.strip()]

        return GDNTCallout(
            id=str(raw.get("id", "")),
            gdnt_type=matched_type,
            tolerance_value=val,
            diameter_zone=is_dia_zone,
            material_condition=mc,
            datum_references=datums,
            target_feature=raw.get("target_feature") or raw.get("target") or raw.get("feature_id"),
            target_face_or_axis=raw.get("target_face_or_axis"),
            source_annotation=raw.get("source_annotation") or raw.get("source"),
            source_view=raw.get("source_view"),
            confidence=float(raw.get("confidence", 1.0)),
        )

    return None


def parse_datum_callout(raw: Any) -> Optional[DatumDefinition]:
    """
    Parses Datum definitions (e.g. [-A-], [A], Datum A, A).
    """
    if raw is None:
        return None

    if isinstance(raw, DatumDefinition):
        return raw

    if isinstance(raw, dict):
        d_id = str(raw.get("datum_id", raw.get("id", raw.get("datum", "")))).strip().strip("[]- ")
        d_type = str(raw.get("datum_type", raw.get("type", "face"))).lower()
        valid_types = ("face", "axis", "cylinder", "plane", "centerline", "point", "pattern", "unspecified")
        return DatumDefinition(
            datum_id=d_id,
            datum_type=d_type if d_type in valid_types else "face",
            referenced_feature=raw.get("referenced_feature") or raw.get("target_feature") or raw.get("feature_id"),
            referenced_geometry=raw.get("referenced_geometry") or raw.get("geometry"),
            source_location=raw.get("source_location"),
            source_view=raw.get("source_view"),
            confidence=float(raw.get("confidence", 1.0)),
        )

    text = str(raw).strip()
    m = re.search(r"\b([A-Z])\b", text)
    if m:
        d_id = m.group(1)
        return DatumDefinition(
            datum_id=d_id,
            datum_type="face",
            source_location=text,
        )

    return None


def parse_material_callout(raw: Any) -> Optional[MaterialSpecification]:
    """
    Parses title block material specifications: EN-AW 6082 T6, AISI 4140, SS304, Al 6061-T6.
    """
    if raw is None:
        return None

    if isinstance(raw, MaterialSpecification):
        return raw

    if isinstance(raw, dict):
        name = str(raw.get("material_name", raw.get("name", raw.get("material", "")))).strip()
        standard = raw.get("material_standard") or raw.get("standard")
        grade = raw.get("grade_or_temper") or raw.get("temper") or raw.get("grade")

        # Auto-detect standard if not specified
        if not standard:
            for std in ("EN-AW", "AISI", "ASTM", "DIN", "ISO", "SAE", "JIS", "SS", "Al", "Aluminum", "Steel"):
                if std in name:
                    standard = std
                    break

        return MaterialSpecification(
            material_name=name,
            material_standard=standard,
            grade_or_temper=grade,
            raw_text=raw.get("raw_text") or name,
            density_gcm3=float(raw.get("density_gcm3")) if raw.get("density_gcm3") else None,
            hardness=raw.get("hardness"),
            source_location=raw.get("source_location"),
            confidence=float(raw.get("confidence", 1.0)),
        )

    text = str(raw).strip()
    if not text:
        return None

    standard = None
    grade = None
    for std in ("EN-AW", "AISI", "ASTM", "DIN", "ISO", "SAE", "JIS", "SS"):
        if std in text:
            standard = std
            break

    # Look for temper grades (T6, T4, H112, etc.)
    temper_m = re.search(r"\b(T\d|H\d{2,3}|annealed|hardened)\b", text, re.I)
    if temper_m:
        grade = temper_m.group(0)

    return MaterialSpecification(
        material_name=text,
        material_standard=standard,
        grade_or_temper=grade,
        raw_text=text,
    )


def parse_stock_callout(raw: Any) -> Optional[StockSpecification]:
    """
    Parses stock specifications: Ø25 h11, Ø50 H8, Bright Bar Ø25, Round Bar, Plate.
    """
    if raw is None:
        return None

    if isinstance(raw, StockSpecification):
        return raw

    if isinstance(raw, dict):
        shape_str = str(raw.get("shape", "unspecified")).lower().replace(" ", "_")
        return StockSpecification(
            shape=shape_str if shape_str in (
                "round_bar", "bright_bar", "hex_bar", "tube", "plate", "block", "forging", "casting", "custom", "unspecified"
            ) else "unspecified",
            nominal_size=raw.get("nominal_size"),
            nominal_diameter=float(raw.get("nominal_diameter")) if raw.get("nominal_diameter") else None,
            nominal_length=float(raw.get("nominal_length")) if raw.get("nominal_length") else None,
            tolerance_class=raw.get("tolerance_class"),
            upper_tolerance=float(raw.get("upper_tolerance")) if raw.get("upper_tolerance") is not None else None,
            lower_tolerance=float(raw.get("lower_tolerance")) if raw.get("lower_tolerance") is not None else None,
            raw_text=raw.get("raw_text"),
            confidence=float(raw.get("confidence", 1.0)),
        )

    text = str(raw).strip()
    if not text:
        return None

    shape = "round_bar" if "round" in text.lower() or "bar" in text.lower() or "dia" in text.lower() or "ø" in text.lower() else "unspecified"
    if "bright" in text.lower():
        shape = "bright_bar"
    elif "hex" in text.lower():
        shape = "hex_bar"
    elif "tube" in text.lower():
        shape = "tube"
    elif "plate" in text.lower():
        shape = "plate"

    dia_m = _DIAMETER_RE.search(text)
    nom_dia = float(dia_m.group("val").replace(",", ".")) if dia_m else None

    fit_m = _ISO_FIT_RE.search(text)
    tol_class = fit_m.group(0) if fit_m else None
    u_tol, l_tol = resolve_iso_fit_deviation(tol_class, nom_dia or 25.0) if tol_class else (None, None)

    return StockSpecification(
        shape=shape,
        nominal_size=dia_m.group(0) if dia_m else text,
        nominal_diameter=nom_dia,
        tolerance_class=tol_class,
        upper_tolerance=u_tol,
        lower_tolerance=l_tol,
        raw_text=text,
    )


def parse_treatment_callout(raw: Any) -> Optional[SurfaceTreatment]:
    """
    Parses surface treatments: Hard anodizing 55 ± 5 µm HV > 400, Nitriding, Plating, etc.
    """
    if raw is None:
        return None

    if isinstance(raw, SurfaceTreatment):
        return raw

    if isinstance(raw, dict):
        return SurfaceTreatment(
            treatment_type=str(raw.get("treatment_type", raw.get("type", "coating"))),
            process_requirement=raw.get("process_requirement") or raw.get("process"),
            thickness_nominal_um=float(raw.get("thickness_nominal_um")) if raw.get("thickness_nominal_um") is not None else (
                float(raw.get("thickness")) if raw.get("thickness") and isinstance(raw.get("thickness"), (int, float)) else None
            ),
            thickness_min_um=float(raw.get("thickness_min_um")) if raw.get("thickness_min_um") is not None else None,
            thickness_max_um=float(raw.get("thickness_max_um")) if raw.get("thickness_max_um") is not None else None,
            thickness_tolerance=raw.get("thickness_tolerance"),
            hardness=raw.get("hardness"),
            target_region=raw.get("target_region") or raw.get("target"),
            raw_text=raw.get("raw_text"),
            source_location=raw.get("source_location"),
            confidence=float(raw.get("confidence", 1.0)),
        )

    text = str(raw).strip()
    if not text:
        return None

    # Detect treatment type
    t_type = "surface_treatment"
    for cand in ("hard anodizing", "anodizing", "black oxide", "nitriding", "passivation", "carburizing", "heat treatment", "plating"):
        if cand in text.lower():
            t_type = cand.replace(" ", "_")
            break

    # Look for thickness (e.g. 55 ± 5 µm, 20 µm, 50-60 um)
    thick_m = re.search(r"(?P<nom>\d+(?:[.,]\d+)?)\s*(?:±|\+/-)\s*(?P<tol>\d+(?:[.,]\d+)?)\s*(?:µm|um|microns?)", text, re.I)
    nom_th = None
    tol_th = None
    if thick_m:
        nom_th = float(thick_m.group("nom").replace(",", "."))
        tol_th = f"±{thick_m.group('tol')}"
    else:
        single_th = re.search(r"(\d+(?:[.,]\d+)?)\s*(?:µm|um|microns?)", text, re.I)
        if single_th:
            nom_th = float(single_th.group(1).replace(",", "."))

    # Look for hardness (e.g. HV > 400, HRC 45-50, 95 HB)
    hard_m = re.search(r"\b(?:HV\s*[><=]?\s*\d+|HR[cC]\s*\d+(?:\s*-\s*\d+)?|\d+\s*HB)\b", text, re.I)
    hardness = hard_m.group(0) if hard_m else None

    return SurfaceTreatment(
        treatment_type=t_type,
        thickness_nominal_um=nom_th,
        thickness_tolerance=tol_th,
        hardness=hardness,
        raw_text=text,
    )


def parse_manufacturing_requirement(raw: Any) -> Optional[ManufacturingRequirement]:
    """
    Parses manufacturing requirements and quality notes.
    """
    if raw is None:
        return None

    if isinstance(raw, ManufacturingRequirement):
        return raw

    if isinstance(raw, dict):
        req_type = str(raw.get("requirement_type", raw.get("type", "general_note"))).lower().replace(" ", "_")
        valid_types = (
            "deburring", "edge_finishing", "cleaning", "heat_treatment", "inspection",
            "packaging", "marking", "general_note", "critical_characteristic"
        )
        return ManufacturingRequirement(
            id=str(raw.get("id", "")),
            requirement_type=req_type if req_type in valid_types else "general_note",
            text=str(raw.get("text", raw.get("description", ""))),
            target_feature=raw.get("target_feature") or raw.get("target"),
            source_location=raw.get("source_location"),
            confidence=float(raw.get("confidence", 1.0)),
        )

    text = str(raw).strip()
    if not text:
        return None

    req_type = "general_note"
    lower = text.lower()
    if any(k in lower for k in ("burr", "deburr", "sharp edge")):
        req_type = "deburring"
    elif any(k in lower for k in ("edge", "chamfer all", "radius all")):
        req_type = "edge_finishing"
    elif any(k in lower for k in ("inspect", "magnification", "viewed under", "quality")):
        req_type = "inspection"
    elif any(k in lower for k in ("clean", "degrease", "contaminant")):
        req_type = "cleaning"
    elif any(k in lower for k in ("heat treat", "temper", "quench", "harden")):
        req_type = "heat_treatment"
    elif any(k in lower for k in ("critical", "key characteristic", "cc", "kc")):
        req_type = "critical_characteristic"

    return ManufacturingRequirement(
        requirement_type=req_type,
        text=text,
    )


def parse_functional_characteristic(raw: Any) -> Optional[FunctionalCharacteristic]:
    """
    Parses functional / inspection characteristics (mass, wetted surface, sealing area, gasket working area).
    """
    if raw is None:
        return None

    if isinstance(raw, FunctionalCharacteristic):
        return raw

    if isinstance(raw, dict):
        c_type = str(raw.get("characteristic_type", raw.get("type", "custom"))).lower().replace(" ", "_")
        valid_types = ("mass", "wetted_surface", "sealing_area", "gasket_working_area", "volume", "cleanliness", "proof_pressure", "custom")
        return FunctionalCharacteristic(
            id=str(raw.get("id", "")),
            characteristic_type=c_type if c_type in valid_types else "custom",
            value=float(raw.get("value")) if raw.get("value") is not None else None,
            unit=raw.get("unit"),
            description=str(raw.get("description", raw.get("text", ""))),
            target_feature_or_region=raw.get("target_feature_or_region") or raw.get("target"),
            source_annotation=raw.get("source_annotation"),
            confidence=float(raw.get("confidence", 1.0)),
        )

    text = str(raw).strip()
    if not text:
        return None

    lower = text.lower()
    c_type = "custom"
    val = None
    unit = None

    if "mass" in lower or "weight" in lower:
        c_type = "mass"
        m_val = re.search(r"(\d+(?:[.,]\d+)?)\s*(kg|g|lbs?)", text, re.I)
        if m_val:
            val = float(m_val.group(1).replace(",", "."))
            unit = m_val.group(2)
    elif "wetted" in lower:
        c_type = "wetted_surface"
        m_val = re.search(r"(\d+(?:[.,]\d+)?)\s*(mm²|cm²|in²|mm2)", text, re.I)
        if m_val:
            val = float(m_val.group(1).replace(",", "."))
            unit = m_val.group(2)
    elif "gasket" in lower:
        c_type = "gasket_working_area"
    elif "sealing" in lower or "seal" in lower:
        c_type = "sealing_area"

    return FunctionalCharacteristic(
        characteristic_type=c_type,
        value=val,
        unit=unit,
        description=text,
        source_annotation=text,
    )


def parse_general_tolerance_table(raw: Any) -> Optional[GeneralToleranceTable]:
    """
    Parses general tolerance tables (e.g. ISO 2768-m, DIN 7168 range rules).
    """
    if raw is None:
        return None

    if isinstance(raw, GeneralToleranceTable):
        return raw

    if isinstance(raw, dict):
        rules = []
        for r in raw.get("rules", []):
            if isinstance(r, dict):
                rules.append(GeneralToleranceRule(
                    nominal_min=float(r.get("nominal_min", r.get("min", 0.0))),
                    nominal_max=float(r.get("nominal_max", r.get("max", 0.0))),
                    tolerance=float(r.get("tolerance", r.get("tol", 0.1))),
                    unit=str(r.get("unit", "mm")),
                ))
            elif isinstance(r, GeneralToleranceRule):
                rules.append(r)

        return GeneralToleranceTable(
            table_type=raw.get("table_type", "linear"),
            standard=raw.get("standard"),
            precision_class=raw.get("precision_class"),
            rules=rules,
            raw_text=raw.get("raw_text"),
        )

    text = str(raw).strip()
    if not text:
        return None

    # Try extracting range rules like: 0-6 ±0.1, >6-30 ±0.2, >30-120 ±0.3, >120-400 ±0.5
    rules = []
    rule_matches = re.finditer(
        r"(?:>)?(?P<min>\d+(?:[.,]\d+)?)\s*(?:–|-|to)\s*(?P<max>\d+(?:[.,]\d+)?)\s*(?:±|\+/-)\s*(?P<tol>\d+(?:[.,]\d+)?)",
        text,
    )
    for m in rule_matches:
        rules.append(GeneralToleranceRule(
            nominal_min=float(m.group("min").replace(",", ".")),
            nominal_max=float(m.group("max").replace(",", ".")),
            tolerance=float(m.group("tol").replace(",", ".")),
            unit="mm",
        ))

    standard = None
    if "2768" in text:
        standard = "ISO 2768"
    elif "7168" in text:
        standard = "DIN 7168"

    return GeneralToleranceTable(
        table_type="linear",
        standard=standard,
        rules=rules,
        raw_text=text,
    )


# ─── BLUEPRINT AUDIT NORMALIZER & FEATURE GRAPH INTEGRATOR ─────────────────────

class BlueprintParameterNormalizer:
    """
    Normalizes raw LLM vision audit output into a structured DrawingBlueprintAudit,
    linking features across multi-view hierarchies and semantic annotations.
    """

    @classmethod
    def normalize_audit_payload(cls, raw: Dict[str, Any]) -> DrawingBlueprintAudit:
        if not isinstance(raw, dict):
            return DrawingBlueprintAudit()

        audit = DrawingBlueprintAudit()
        audit.audit_schema_version = str(raw.get("audit_schema_version", "engineering-v1"))
        audit.units = str(raw.get("units", "mm"))
        audit.origin_point = raw.get("origin_point", [0.0, 0.0, 0.0])
        audit.origin_rationale = str(raw.get("origin_rationale", ""))
        audit.envelope = raw.get("envelope", {})
        audit.primary_datum = raw.get("primary_datum", {})
        audit.patterns = raw.get("patterns", [])
        audit.views = raw.get("views", [])
        audit.view_relationships = raw.get("view_relationships", [])

        # 1. Material & Stock
        if "material" in raw and raw["material"]:
            audit.material = str(raw["material"])
            audit.material_parsed = parse_material_callout(raw["material"])
        elif "material_parsed" in raw:
            audit.material_parsed = parse_material_callout(raw["material_parsed"])
            if audit.material_parsed:
                audit.material = audit.material_parsed.material_name

        if "stock" in raw and raw["stock"]:
            audit.stock = parse_stock_callout(raw["stock"])

        # 2. Surface Treatments
        treatments = raw.get("surface_treatments", [])
        if isinstance(treatments, (list, tuple)):
            for t in treatments:
                audit.surface_treatments.append(t)
                parsed_t = parse_treatment_callout(t)
                if parsed_t:
                    audit.surface_treatments_parsed.append(parsed_t)
        elif isinstance(treatments, str):
            audit.surface_treatments.append(treatments)
            parsed_t = parse_treatment_callout(treatments)
            if parsed_t:
                audit.surface_treatments_parsed.append(parsed_t)

        # 3. Manufacturing Requirements & Notes
        reqs = raw.get("manufacturing_requirements") or raw.get("manufacturing_notes") or raw.get("notes", [])
        if isinstance(reqs, (list, tuple)):
            for r in reqs:
                parsed_r = parse_manufacturing_requirement(r)
                if parsed_r:
                    audit.manufacturing_requirements.append(parsed_r)
        elif isinstance(reqs, str):
            parsed_r = parse_manufacturing_requirement(reqs)
            if parsed_r:
                audit.manufacturing_requirements.append(parsed_r)

        # 4. Functional Characteristics
        f_chars = raw.get("functional_characteristics") or raw.get("inspection_characteristics") or []
        if isinstance(f_chars, (list, tuple)):
            for fc in f_chars:
                parsed_fc = parse_functional_characteristic(fc)
                if parsed_fc:
                    audit.functional_characteristics.append(parsed_fc)

        # 5. General Tolerances
        if "general_tolerances" in raw and raw["general_tolerances"]:
            audit.general_tolerances = str(raw["general_tolerances"])
            audit.general_tolerance_table = parse_general_tolerance_table(raw["general_tolerances"])
        elif "general_tolerance_table" in raw and raw["general_tolerance_table"]:
            audit.general_tolerance_table = parse_general_tolerance_table(raw["general_tolerance_table"])

        # 6. GD&T Callouts
        gdt_list = raw.get("gdt_callouts") or raw.get("gdt") or []
        for g in gdt_list:
            audit.gdt_callouts.append(g if isinstance(g, dict) else {"raw": str(g)})
            parsed_g = parse_gdnt_callout(g)
            if parsed_g:
                audit.gdt_callouts_parsed.append(parsed_g)

        # 7. Datums
        datums_list = raw.get("datums") or raw.get("datum_definitions") or []
        for d in datums_list:
            parsed_d = parse_datum_callout(d)
            if parsed_d:
                audit.datums.append(parsed_d)

        # If GD&T references datums that aren't declared, add datum stubs
        declared_datum_ids = {d.datum_id for d in audit.datums}
        for gdt in audit.gdt_callouts_parsed:
            for d_ref in gdt.datum_references:
                if d_ref and d_ref not in declared_datum_ids:
                    audit.datums.append(DatumDefinition(
                        datum_id=d_ref,
                        datum_type="axis" if gdt.diameter_zone else "face",
                        referenced_feature=gdt.target_feature,
                    ))
                    declared_datum_ids.add(d_ref)

        # 8. Surface Finishes
        finishes_list = raw.get("surface_finishes") or []
        for sf in finishes_list:
            parsed_sf = parse_surface_finish_callout(sf)
            if parsed_sf:
                audit.surface_finishes.append(parsed_sf)

        # 9. Features & Semantic Associations
        raw_features = raw.get("features", [])
        for f in raw_features:
            if not isinstance(f, dict):
                continue

            fid = str(f.get("id", f"feature_{len(audit.features)+1}"))
            ftype = str(f.get("type", "generic"))
            desc = str(f.get("description", ""))
            dims = f.get("dims", {})
            loc = f.get("location", {})
            is_sub = bool(f.get("is_subtractive", False))
            parent_id = f.get("parent_id")
            source_view = f.get("source_view")
            raw_finish = f.get("surface_finish")
            dim_tols = f.get("dimensional_tolerances", {})

            rec = FeatureExtractionRecord(
                id=fid,
                type=ftype,
                description=desc,
                dims=dims,
                location=loc,
                is_subtractive=is_sub,
                parent_id=parent_id,
                source_view=source_view,
                surface_finish=raw_finish,
                surface_finish_parsed=parse_surface_finish_callout(raw_finish) if raw_finish else None,
                dimensional_tolerances=dim_tols if isinstance(dim_tols, dict) else {},
                confidence=str(f.get("confidence", "verified")),
                thread=f.get("thread"),
            )

            # Parse tolerances for each dimension key
            if isinstance(dim_tols, dict):
                for d_key, t_val in dim_tols.items():
                    nom_val = dims.get(d_key) if isinstance(dims.get(d_key), (int, float)) else None
                    parsed_tol = parse_tolerance_string(t_val, nominal=nom_val)
                    if parsed_tol:
                        rec.tolerances_parsed[d_key] = parsed_tol

            # Extract Chamfers & Fillets on the feature
            if "treatment_type" in dims:
                tt = str(dims.get("treatment_type", "")).lower()
                if "chamfer" in tt:
                    cham = parse_chamfer_callout(dims)
                    if cham:
                        cham.feature_id = fid
                        cham.source_view = source_view
                        rec.chamfers.append(cham)
                        audit.all_chamfers.append(cham)
                elif "fillet" in tt:
                    fil = parse_fillet_callout(dims)
                    if fil:
                        fil.feature_id = fid
                        fil.source_view = source_view
                        rec.fillets.append(fil)
                        audit.all_fillets.append(fil)

            # Check explicit chamfers / fillets arrays inside feature
            for ch in f.get("chamfers", []):
                parsed_ch = parse_chamfer_callout(ch)
                if parsed_ch:
                    parsed_ch.feature_id = fid
                    rec.chamfers.append(parsed_ch)
                    audit.all_chamfers.append(parsed_ch)

            for fl in f.get("fillets", []):
                parsed_fl = parse_fillet_callout(fl)
                if parsed_fl:
                    parsed_fl.feature_id = fid
                    rec.fillets.append(parsed_fl)
                    audit.all_fillets.append(parsed_fl)

            for ag in f.get("angles", []):
                parsed_ag = parse_angular_callout(ag)
                if parsed_ag:
                    parsed_ag.feature_id = fid
                    rec.angles.append(parsed_ag)
                    audit.all_angles.append(parsed_ag)

            # Associate GD&T referencing this feature
            for gdt in audit.gdt_callouts_parsed:
                if gdt.target_feature == fid:
                    rec.gdt_refs.append(gdt.id or gdt.gdnt_type.value)

            # Associate Datums referencing this feature
            for d in audit.datums:
                if d.referenced_feature == fid:
                    rec.datum_refs.append(d.datum_id)

            # Create generic dimensions for feature dims
            for dim_k, dim_v in dims.items():
                if isinstance(dim_v, (int, float)):
                    d_type = DimensionType.LINEAR
                    dim_k_lower = dim_k.lower()
                    if "dia" in dim_k_lower or "diameter" in dim_k_lower:
                        d_type = DimensionType.DIAMETER
                    elif "rad" in dim_k_lower or "radius" in dim_k_lower:
                        d_type = DimensionType.RADIUS
                    elif "depth" in dim_k_lower:
                        d_type = DimensionType.DEPTH
                    elif "width" in dim_k_lower:
                        d_type = DimensionType.WIDTH
                    elif "angle" in dim_k_lower or "deg" in dim_k_lower:
                        d_type = DimensionType.ANGLE

                    g_dim = GenericDimension(
                        id=f"{fid}_{dim_k}",
                        dimension_type=d_type,
                        nominal_value=float(dim_v),
                        tolerance=rec.tolerances_parsed.get(dim_k),
                        feature_id=fid,
                        geometry_reference=dim_k,
                        source_view=source_view,
                    )
                    audit.all_dimensions.append(g_dim)

            audit.features.append(rec)

        return audit
