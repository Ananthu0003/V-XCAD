import build123d as bd
import math

PARAMETERS = {
    "eps": 0.01,
    "base_len": 72.0,
    "base_wid": 35.0,
    "base_h": 10.0,
    "upright_wid": 30.0,
    "upright_thick": 13.0,
    "upright_h": 65.0,
    "upright_y_offset": 11.0,
    "hole_dia": 12.0,
    "base_hole_spacing": 48.0,
    "top_hole_z": 60.0,
    "rib_thick": 10.0,
    "rib_angle": 60.0,
    "rib_base_h": 9.0,
    "rib_offset_y": 5.0
}

PARAMETER_METADATA = {
    "eps": {"group": "Global", "confidence": 1.0, "description": "Epsilon for boolean stability"},
    "base_len": {"group": "Base", "confidence": 1.0, "description": "Total length of base plate"},
    "base_wid": {"group": "Base", "confidence": 1.0, "description": "Total width of base plate"},
    "base_h": {"group": "Base", "confidence": 1.0, "description": "Height of base plate"},
    "upright_wid": {"group": "Upright", "confidence": 1.0, "description": "Width of vertical support"},
    "upright_thick": {"group": "Upright", "confidence": 1.0, "description": "Thickness of vertical support"},
    "upright_h": {"group": "Upright", "confidence": 1.0, "description": "Height of vertical support"},
    "upright_y_offset": {"group": "Upright", "confidence": 1.0, "description": "Y-offset of upright from center"},
    "hole_dia": {"group": "Holes", "confidence": 1.0, "description": "Diameter of all holes"},
    "base_hole_spacing": {"group": "Holes", "confidence": 1.0, "description": "Distance between base holes"},
    "top_hole_z": {"group": "Holes", "confidence": 1.0, "description": "Z-height of top hole"},
    "rib_thick": {"group": "Rib", "confidence": 1.0, "description": "Thickness of reinforcement rib"},
    "rib_angle": {"group": "Rib", "confidence": 1.0, "description": "Angle of rib slope"},
    "rib_base_h": {"group": "Rib", "confidence": 1.0, "description": "Height of rib base"},
    "rib_offset_y": {"group": "Rib", "confidence": 1.0, "description": "Y-offset of rib from upright"}
}

# --- SPATIAL PLAN ---
# Base: Box centered at (0,0,5), size (72, 35, 10).
# Upright: Box centered at (0, 11, 10+32.5), size (30, 13, 65).
# Rib: Polygon extruded to 10mm, placed at Y = 11 - 6.5 - 5 = -0.5.
# Holes: Base holes at (+/- 24, 0, 0). Top hole at (0, 11, 60).
# --- MENTAL WALKTHROUGH ---
# 1. Create base plate.
# 2. Create upright on top of base.
# 3. Create rib using a polygon that overlaps the base and upright by eps.
# 4. Cut base holes through the base plate.
# 5. Cut top hole through the upright.
# --------------------

with bd.BuildPart() as part:
    eps = PARAMETERS["eps"]
    
    # Base
    bd.Box(PARAMETERS["base_len"], PARAMETERS["base_wid"], PARAMETERS["base_h"], 
           align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN))
    
    # Upright
    with bd.Locations((0, PARAMETERS["upright_y_offset"], PARAMETERS["base_h"])):
        bd.Box(PARAMETERS["upright_wid"], PARAMETERS["upright_thick"], PARAMETERS["upright_h"],
               align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN))
        # Rounded top
        with bd.Locations((0, 0, PARAMETERS["upright_h"])):
            bd.Cylinder(radius=PARAMETERS["upright_wid"]/2, height=PARAMETERS["upright_thick"],
                        align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN))
    
    # Rib
    rib_x_start = -PARAMETERS["rib_thick"]/2
    rib_x_end = PARAMETERS["rib_thick"]/2
    rib_y_start = PARAMETERS["upright_y_offset"] - PARAMETERS["upright_thick"]/2 - eps
    rib_y_end = rib_y_start - PARAMETERS["rib_base_h"]
    rib_z_start = PARAMETERS["base_h"]
    rib_z_end = PARAMETERS["base_h"] + (PARAMETERS["rib_base_h"] / math.tan(math.radians(PARAMETERS["rib_angle"])))
    
    with bd.Locations((0, rib_y_start, PARAMETERS["base_h"])):
        with bd.BuildSketch(bd.Plane(z_dir=(0, -1, 0))):
            bd.Polygon([(0, 0), (0, PARAMETERS["rib_base_h"]), (PARAMETERS["rib_base_h"]/math.tan(math.radians(PARAMETERS["rib_angle"])), 0)])
        bd.extrude(amount=PARAMETERS["rib_thick"], both=True)

    # Base Holes
    with bd.Locations((PARAMETERS["base_hole_spacing"]/2, 0, 0)):
        bd.Hole(radius=PARAMETERS["hole_dia"]/2, depth=PARAMETERS["base_h"] + eps)
    with bd.Locations((-PARAMETERS["base_hole_spacing"]/2, 0, 0)):
        bd.Hole(radius=PARAMETERS["hole_dia"]/2, depth=PARAMETERS["base_h"] + eps)
        
    # Top Hole
    with bd.Locations((0, PARAMETERS["upright_y_offset"], PARAMETERS["top_hole_z"])):
        with bd.Locations(bd.Rotation(0, 90, 0)):
            bd.Hole(radius=PARAMETERS["hole_dia"]/2, depth=PARAMETERS["upright_thick"] + 2*eps)

if __name__ == '__main__':
    try:
        from ocp_vscode import show
        show(part)
    except ImportError:
        pass