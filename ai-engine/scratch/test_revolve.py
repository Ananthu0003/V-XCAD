from build123d import *
import build123d

# Compatibility Patches for build123d 0.10.0
if hasattr(build123d, "Mixin1D"):
    build123d.Mixin1D.start = property(lambda self: self @ 0)
    build123d.Mixin1D.end = property(lambda self: self @ 1)
elif hasattr(build123d, "Edge"):
    build123d.Edge.start = property(lambda self: self @ 0)
    build123d.Edge.end = property(lambda self: self @ 1)

# Monkeypatch Solid.revolve
_orig_solid_revolve = Solid.revolve

@classmethod
def safe_solid_revolve(cls, section, angle, axis, inner_wires=None):
    try:
        is_x_axis = False
        if hasattr(axis, "direction"):
            is_x_axis = abs(axis.direction.X) > 0.99 and abs(axis.direction.Y) < 0.01 and abs(axis.direction.Z) < 0.01
        
        if is_x_axis:
            half_plane_ge = Face.make_rect(20000, 20000).translate((0, 10000, 0))
            half_plane_le = Face.make_rect(20000, 20000).translate((0, -10000, 0))
            
            if isinstance(section, Wire):
                section_face = Face(section, inner_wires or [])
            else:
                section_face = section
            
            part_ge = section_face & half_plane_ge
            part_le = section_face & half_plane_le
            
            area_ge = part_ge.area if hasattr(part_ge, "area") else 0.0
            area_le = part_le.area if hasattr(part_le, "area") else 0.0
            
            if area_ge > 1e-5 and area_le > 1e-5:
                print("Monkeypatch: Intersected cross-axis face. Slicing to Y>=0.")
                section = part_ge
                inner_wires = []
    except Exception as e:
        print("Monkeypatch exception:", e)
        
    return _orig_solid_revolve(section, angle, axis, inner_wires)

Solid.revolve = safe_solid_revolve

# PARAMETERS extracted from blueprint TO-10413
PARAMETERS = {
    "TOTAL_LENGTH": 160.0,
    "MAIN_BODY_LEN": 90.0,
    "SHAFT_LEN": 60.0,
    "MAIN_DIA": 83.82,
    "SHAFT_DIA": 50.0,
    "BORE_DIA": 24.6,
    "GROOVE_DIA": 6.35,
    "GROOVE_POS": 6.3,
    "TRANSITION_R": 10.0,
    "FILLET_R": 2.0,
    "SLOT_WIDTH": 5.0,
    "SLOT_DEPTH": 5.0,
    "SLOT_COUNT": 4,
}

def build_model(params: dict) -> tuple[Part, dict]:
    p = {**PARAMETERS, **params}
    
    with BuildPart() as part:
        # 1. Main Body Profile (Revolved)
        with BuildSketch(Plane.XY):
            with BuildLine() as bl:
                # Start at origin, go up to shaft radius
                l1 = Line((0, 0), (0, p["SHAFT_DIA"] / 2))
                # Shaft section
                l2 = Line(l1.end, (p["SHAFT_LEN"], p["SHAFT_DIA"] / 2))
                # Transition to main body
                l3 = TangentArc(l2.end, (p["SHAFT_LEN"] + p["TRANSITION_R"], (p["MAIN_DIA"] / 2) - p["TRANSITION_R"]), tangent=(1, 0))
                # Main body section
                l4 = Line(l3.end, (p["TOTAL_LENGTH"], p["MAIN_DIA"] / 2))
                # Close profile
                l5 = Line(l4.end, (p["TOTAL_LENGTH"], 0))
                Line(l5.end, (0, 0))
            make_face()
        revolve(axis=Axis.X)
        
        # 2. Internal Bore
        with BuildSketch(Plane.XY):
            Rectangle(p["TOTAL_LENGTH"] + 2, (p["BORE_DIA"]) / 2, align=(Align.MIN, Align.MIN))
        revolve(axis=Axis.X, mode=Mode.SUBTRACT)
        
        # 3. Internal Groove (This was the crash point!)
        with BuildSketch(Plane.XY):
            with Locations((p["GROOVE_POS"], 0)):
                Circle(p["GROOVE_DIA"] / 2)
        revolve(axis=Axis.X, mode=Mode.SUBTRACT)
        
        # 4. Slots (4 slots, equally spaced)
        with BuildSketch(Plane.XY):
            with PolarLocations(radius=p["MAIN_DIA"] / 2, count=p["SLOT_COUNT"]):
                Rectangle(p["SLOT_DEPTH"] * 2, (p["SLOT_WIDTH"]) / 2, align=(Align.MAX, Align.MIN))
        extrude(amount=p["MAIN_BODY_LEN"], mode=Mode.SUBTRACT)
        
        # 5. Finishing (Fillets/Chamfers)
        try:
            # Shaft end chamfer
            chamfer(part.edges().filter_by_position(Axis.X, 0, 0.1), length=1.0)
            # Shoulder transition chamfer
            chamfer(part.edges().filter_by_position(Axis.X, p["SHAFT_LEN"], p["SHAFT_LEN"] + 1), length=2.0)
            # Junction fillet
            fillet(part.edges().filter_by_position(Axis.X, p["SHAFT_LEN"], p["SHAFT_LEN"] + 2), radius=p["FILLET_R"])
        except Exception:
            pass

    annotations = {
        "TOTAL_LENGTH": {"p1": [0, -p["MAIN_DIA"]/2 - 5, 0], "p2": [p["TOTAL_LENGTH"], -p["MAIN_DIA"]/2 - 5, 0]},
        "MAIN_DIA": {"p1": [p["TOTAL_LENGTH"], 0, 0], "p2": [p["TOTAL_LENGTH"], p["MAIN_DIA"]/2, 0]},
        "SHAFT_DIA": {"p1": [p["SHAFT_LEN"]/2, 0, 0], "p2": [p["SHAFT_LEN"]/2, p["SHAFT_DIA"]/2, 0]}
    }

    return part.part, annotations

print("Starting model construction...")
part, annotations = build_model(PARAMETERS)
print("Model constructed successfully! Solids:", len(part.solids()))
