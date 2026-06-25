```python
import build123d as bd

PARAMETERS = {
    "eps": 0.01,
    "block_len": 32.0,
    "block_width": 24.0,
    "block_height": 15.0,
    "shaft_dia": 14.0,
    "shaft_len": 11.5,
    "thread_dia": 10.0,
    "thread_len": 10.0,
    "hole_dia": 13.0,
    "chamfer_size": 1.0
}

PARAMETER_METADATA = {
    "eps": {"group": "Tolerance", "confidence": 1.0, "description": "Epsilon for boolean stability"},
    "block_len": {"group": "Main", "confidence": 1.0, "description": "Length of central block"},
    "block_width": {"group": "Main", "confidence": 1.0, "description": "Width of central block"},
    "block_height": {"group": "Main", "confidence": 1.0, "description": "Height of central block"},
    "shaft_dia": {"group": "Shaft", "confidence": 1.0, "description": "Diameter of shaft base"},
    "shaft_len": {"group": "Shaft", "confidence": 1.0, "description": "Length of shaft base"},
    "thread_dia": {"group": "Thread", "confidence": 1.0, "description": "Diameter of M10 thread section"},
    "thread_len": {"group": "Thread", "confidence": 1.0, "description": "Length of M10 thread section"},
    "hole_dia": {"group": "Hole", "confidence": 1.0, "description": "Diameter of central through hole"},
    "chamfer_size": {"group": "Detail", "confidence": 1.0, "description": "Chamfer size on thread ends"}
}

# --- SPATIAL PLAN ---
# Main Block: Centered at (0,0,0), Z-range [-7.5, 7.5].
# Shafts: Centered on Y=0, Z=0. Left shaft starts at X = -block_len/2, extends left.
# Threaded sections: Attached to the end of shafts, extending further left/right.
# Through Hole: Drilled along Y-axis through the center of the block.
# --- MENTAL WALKTHROUGH ---
# 1. Create main block centered at origin.
# 2. Create shafts: To ensure fusion, overlap them by 'eps' into the block.
# 3. Create thread sections: Attached to the outer face of the shafts.
# 4. Chamfer the thread ends.
# 5. Cut the central hole: Use a cylinder oriented along Y-axis.
# --------------------

with bd.BuildPart() as part:
    # Main Block
    bd.Box(length=PARAMETERS["block_len"], width=PARAMETERS["block_width"], height=PARAMETERS["block_height"])
    
    # Shafts (Left and Right)
    for x_sign in [-1, 1]:
        with bd.Locations((x_sign * (PARAMETERS["block_len"] / 2 - PARAMETERS["eps"]), 0, 0)):
            with bd.Locations(bd.Rotation(0, 90, 0)):
                # Extrude shaft from block surface
                bd.Cylinder(radius=PARAMETERS["shaft_dia"] / 2, height=PARAMETERS["shaft_len"], align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN))
                
                # Threaded section
                with bd.Locations((0, 0, PARAMETERS["shaft_len"])):
                    thread = bd.Cylinder(radius=PARAMETERS["thread_dia"] / 2, height=PARAMETERS["thread_len"], align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN))
                    
                    # Chamfer thread end
                    bd.chamfer(thread.edges().filter_by(bd.GeomType.CIRCLE).sort_by(bd.Axis.Z)[-1], length=PARAMETERS["chamfer_size"])

    # Central Through Hole (along Y-axis)
    with bd.Locations(bd.Rotation(90, 0, 0)):
        bd.Cylinder(radius=PARAMETERS["hole_dia"] / 2, height=PARAMETERS["block_width"] + 2 * PARAMETERS["eps"], mode=bd.Mode.SUBTRACT)

if __name__ == '__main__':
    try:
        from ocp_vscode import show
        show(part)
    except ImportError:
        pass
```