"""
Centralized constants for VexCAD.

This module exists to remove hardcoded shape, stock, and feature type strings
(and other magic literals) that were previously duplicated across many services.
All modules should reference these constants instead of embedding raw string
tuples or numeric literals in business logic.
"""
from typing import FrozenSet

# ---------------------------------------------------------------------------
# Stock geometry type identifiers
# ---------------------------------------------------------------------------
CYLINDER_STOCK_TYPE = "cylinder"
RELATIVE_CYLINDER_STOCK_TYPE = "relative_cylinder"
FIXED_CYLINDER_STOCK_TYPE = "fixed_cylinder"
BOX_STOCK_TYPE = "box"
BLOCK_STOCK_TYPE = "block"

# Stock types whose cross-section is a true circle (bar / rod stock).
CYLINDRICAL_STOCK_TYPES: FrozenSet[str] = frozenset(
    {
        CYLINDER_STOCK_TYPE,
        RELATIVE_CYLINDER_STOCK_TYPE,
        FIXED_CYLINDER_STOCK_TYPE,
    }
)

# Stock types with a prismatic (rectangular) envelope.
PRISMATIC_STOCK_TYPES: FrozenSet[str] = frozenset(
    {
        BOX_STOCK_TYPE,
        BLOCK_STOCK_TYPE,
    }
)

# Every stock shape the planner currently understands.
RECOGNIZED_STOCK_TYPES: FrozenSet[str] = CYLINDRICAL_STOCK_TYPES | PRISMATIC_STOCK_TYPES

# ---------------------------------------------------------------------------
# Feature type identifiers
# ---------------------------------------------------------------------------
# Features whose machining footprint is circular (revolved / round cross-section).
CIRCULAR_FEATURE_TYPES: FrozenSet[str] = frozenset(
    {
        "cylinder",
        "external_cylinder",
        "shaft",
        "boss",
        "circular_boss",
        "round_boss",
        "hole",
        "bore",
        "circle",
    }
)

# Features that are produced on a lathe / turning center.
TURNING_FEATURE_TYPES: FrozenSet[str] = frozenset(
    {
        "external_cylinder",
        "shaft",
        "turned_od",
        "od_diameter",
        "shoulder",
        "turned_profile",
        "side_protrusion",
    }
)

# ---------------------------------------------------------------------------
# Toolpath tessellation defaults
# ---------------------------------------------------------------------------
# Number of segments used to approximate a full circular arc when profiling a
# cylindrical / circular feature boundary.
DEFAULT_CIRCLE_SEGMENTS: int = 24

# Number of segments used to approximate each concentric shell inside a pocket.
POCKET_CIRCLE_SEGMENTS: int = 16

# ---------------------------------------------------------------------------
# CAD compiler fallbacks (used only when parametric data is absent)
# ---------------------------------------------------------------------------
DEFAULT_BASE_DIAMETER: float = 10.0
DEFAULT_BASE_LENGTH: float = 20.0
DEFAULT_BASE_WIDTH: float = 10.0
DEFAULT_BASE_HEIGHT: float = 10.0
DEFAULT_BASE_DEPTH: float = 10.0
DEFAULT_HOLE_DIAMETER: float = 5.0
DEFAULT_HOLE_DEPTH: float = 10.0
