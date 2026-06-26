```python
import build123d as bd

# --- PARAMETERS ---
PARAMETERS = {
    "eps": 0.01,
    "base_dia": 8.0,
    "base_height": 2.2,
    "shaft_dia": 6.0,
    "shaft_height": 20.5,
    "tip_dia": 4.74,
    "tip_height": 2.2,
    "tip_radius_top": 1.0,
    "tip_radius_shoulder": 0.5
}

PARAMETER_METADATA = {
    "eps": {"group": "Tolerance", "confidence": 1.0, "description": "Epsilon for boolean stability"},
    "base_dia": {"group": "Base", "confidence": 1.0, "description": "Diameter of the bottom mounting base"},
    "base_height": {"group": "Base", "confidence": 1.0, "description": "Height of the bottom mounting base"},
    "shaft_dia": {"group": "Shaft", "confidence": 1.0, "description": "Diameter of the central shaft"},
    "shaft_height": {"group": "Shaft", "confidence": 1.0, "description": "Height of the central shaft"},
    "tip_dia": {"group": "Tip", "confidence": 1.0, "description": "Diameter of the top punch tip"},
    "tip_height": {"group": "Tip", "confidence": 1.0, "description": "Height of the top punch tip"},
    "tip_radius_top": {"group": "Fillet", "confidence": 1.0, "description": "Radius of the top dome"},
    "tip_radius_shoulder": {"group": "Fillet", "confidence": 1.0, "description": "Radius of the shoulder transition"}
}

# --- SPATIAL PLAN ---
# Base Cylinder: Centered at (0,0,0), Z-range [0, 2.2]
# Main Shaft: Centered at (0,0,2.2), Z-range [2.2, 22.7]
# Top Tip: Centered at (0,0,20.5), Z-range [20.5, 22.7]
# Note: Total height is 22.7. The tip height is 2.2, starting at 20.5.
# Fillets: Applied to the top circular edge and the shoulder edge at Z=20.5.
# --- MENTAL WALKTHROUGH ---
# 1. Create base cylinder at origin.
# 2. Create main shaft on top of base.
# 3. Create top tip on top of main shaft.
# 4. Use fillet on the top edge (radius 1.0).
# 5. Use fillet on the shoulder edge (radius 0.5).
# --------------------

with bd.BuildPart() as part:
    # Base
    with bd.BuildSketch():
        bd.Circle(radius=PARAMETERS["base_dia"] / 2)
    bd.extrude(amount=PARAMETERS["base_height"])

    # Shaft
    with bd.Locations((0, 0, PARAMETERS["base_height"])):
        with bd.BuildSketch():
            bd.Circle(radius=PARAMETERS["shaft_dia"] / 2)
        bd.extrude(amount=PARAMETERS["shaft_height"])

    # Tip
    with bd.Locations((0, 0, PARAMETERS["base_height"] + PARAMETERS["shaft_height"])):
        with bd.BuildSketch():
            bd.Circle(radius=PARAMETERS["tip_dia"] / 2)
        bd.extrude(amount=PARAMETERS["tip_height"])

    # Fillets
    # Top edge is at the very top of the part
    top_edge = part.edges().filter_by(bd.GeomType.CIRCLE).sort_by(bd.Axis.Z)[-1]
    bd.fillet(top_edge, radius=PARAMETERS["tip_radius_top"])

    # Shoulder edge is at the transition between shaft and tip (Z = 22.7 - 2.2 = 20.5)
    # We look for the circular edge at that specific Z height
    shoulder_edge = part.edges().filter_by(bd.GeomType.CIRCLE).sort_by(bd.Axis.Z)[-2]
    bd.fillet(shoulder_edge, radius=PARAMETERS["tip_radius_shoulder"])

if __name__ == '__main__':
    try:
        from ocp_vscode import show
        show(part)
    except ImportError:
        pass
```