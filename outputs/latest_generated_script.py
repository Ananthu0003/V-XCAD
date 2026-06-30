```python
import build123d as bd

PARAMETERS = {
    "eps": 0.01,
    "cyl_dia": 75.0,
    "cyl_height": 75.0,
    "bore_dia": 38.0,
    "plate_len": 75.5,
    "plate_width": 56.0,
    "plate_height": 28.0,
    "slot_width": 19.0,
    "slot_depth": 25.0,
    "slot_rad": 9.5,
    "fillet_rad": 10.0
}

PARAMETER_METADATA = {
    "eps": {"group": "Tolerance", "confidence": 1.0, "description": "Epsilon for boolean stability"},
    "cyl_dia": {"group": "Cylinder", "confidence": 1.0, "description": "Diameter of main boss"},
    "cyl_height": {"group": "Cylinder", "confidence": 1.0, "description": "Height of main boss"},
    "bore_dia": {"group": "Cylinder", "confidence": 1.0, "description": "Diameter of central bore"},
    "plate_len": {"group": "Plate", "confidence": 1.0, "description": "Length of rectangular extension"},
    "plate_width": {"group": "Plate", "confidence": 1.0, "description": "Width of rectangular extension"},
    "plate_height": {"group": "Plate", "confidence": 1.0, "description": "Height of rectangular extension"},
    "slot_width": {"group": "Slot", "confidence": 1.0, "description": "Width of U-slot"},
    "slot_depth": {"group": "Slot", "confidence": 1.0, "description": "Depth of U-slot"},
    "slot_rad": {"group": "Slot", "confidence": 1.0, "description": "Radius of U-slot base"},
    "fillet_rad": {"group": "Fillet", "confidence": 1.0, "description": "Transition fillet radius"}
}

# --- SPATIAL PLAN ---
# Main Cylinder: Centered at (0,0,0), height 75.
# Base Plate: Attached to cylinder, centered Y, extending from X=0 to X=75.5.
#             To ensure fusion, plate starts at X = cyl_dia/2 - eps.
# U-Slot: Cut into the plate at X=94.0 (relative to origin), Z=28.0.
# --- MENTAL WALKTHROUGH ---
# 1. Create Main Cylinder.
# 2. Create Base Plate as a Box. Position it so it overlaps the cylinder by 'eps'.
# 3. Union Cylinder and Plate.
# 4. Cut the central bore through the cylinder.
# 5. Cut the U-slot into the plate. The slot is a rectangle + circle, 
#    subtracted from the top face of the plate.
# 6. Apply fillets to the transition between cylinder and plate.
# --------------------

with bd.BuildPart() as part:
    # Main Cylinder
    bd.Cylinder(radius=PARAMETERS["cyl_dia"]/2, height=PARAMETERS["cyl_height"], align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN))
    
    # Base Plate
    # Plate starts at X = cyl_dia/2 - eps to ensure overlap
    plate_x_start = PARAMETERS["cyl_dia"]/2 - PARAMETERS["eps"]
    plate_len = PARAMETERS["plate_len"]
    with bd.Locations((plate_x_start + plate_len/2, 0, 0)):
        bd.Box(length=plate_len, width=PARAMETERS["plate_width"], height=PARAMETERS["plate_height"], align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN))
    
    # Central Bore
    bd.Hole(radius=PARAMETERS["bore_dia"]/2, depth=PARAMETERS["cyl_height"])
    
    # U-Slot
    # Located at X=94.0, Z=28.0. 
    # Slot is 19 wide, 25 deep.
    slot_x_pos = 94.0
    with bd.Locations((slot_x_pos, 0, PARAMETERS["plate_height"])):
        with bd.BuildSketch(bd.Plane.XY):
            # Rectangle for the vertical part of the slot
            bd.Rectangle(width=PARAMETERS["slot_width"], height=PARAMETERS["slot_depth"] - PARAMETERS["slot_rad"], align=(bd.Align.CENTER, bd.Align.MIN))
            # Circle for the bottom radius
            with bd.Locations((0, PARAMETERS["slot_depth"] - PARAMETERS["slot_rad"])):
                bd.Circle(radius=PARAMETERS["slot_rad"])
        bd.extrude(amount=-PARAMETERS["slot_depth"], mode=bd.Mode.SUBTRACT)

    # Fillet transition
    # Select edges where plate meets cylinder
    edges_to_fillet = part.edges().filter_by(bd.GeomType.CIRCLE).sort_by(bd.Axis.Z)
    # We target the vertical edges at the junction
    bd.fillet(part.edges().filter_by_position(bd.Axis.X, 37.5, 38.0), radius=PARAMETERS["fillet_rad"])

if __name__ == '__main__':
    try:
        from ocp_vscode import show
        show(part)
    except ImportError:
        pass
```