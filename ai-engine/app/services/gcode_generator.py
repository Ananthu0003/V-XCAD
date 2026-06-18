import math
from typing import Any, Dict, List, Tuple

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _offset_point(
    px: float, py: float,
    nx: float, ny: float,
    offset: float
) -> Tuple[float, float]:
    """
    Offset a 2-D point (px, py) by `offset` along the outward normal (nx, ny).
    Normal should already be unit-length; if not it is normalised here.
    """
    length = math.hypot(nx, ny)
    if length < 1e-9:
        return px, py
    return px + offset * nx / length, py + offset * ny / length


def _compute_offsets(
    points: List[Tuple[float, float]],
    offset: float
) -> List[Tuple[float, float]]:
    """
    Apply a constant radial offset to a closed or open polyline.
    For each interior vertex the average normal of its two adjacent edges
    is used (miter), giving clean corners without gaps or overlaps.

    Args:
        points:  Ordered (x, y) vertices.  May be closed (first == last).
        offset:  Signed distance.  Positive = expand outward (climb-mill
                 exterior profile); negative = shrink inward (pocket).

    Returns:
        Offset polyline with the same number of vertices.
    """
    if len(points) < 2:
        return list(points)

    # Ensure the ring is closed for normal computation
    closed = (
        abs(points[0][0] - points[-1][0]) < 1e-6 and
        abs(points[0][1] - points[-1][1]) < 1e-6
    )
    ring = list(points)
    if not closed:
        ring.append(ring[0])

    n = len(ring) - 1          # number of unique vertices
    offsets: List[Tuple[float, float]] = []

    for i in range(n):
        # Edges entering and leaving vertex i
        prev_i = (i - 1) % n
        next_i = (i + 1) % n

        x0, y0 = ring[prev_i]
        x1, y1 = ring[i]
        x2, y2 = ring[next_i]

        # Edge normals (left-hand perpendicular = outward for CCW winding)
        dx1, dy1 = x1 - x0, y1 - y0
        dx2, dy2 = x2 - x1, y2 - y1

        len1 = math.hypot(dx1, dy1) or 1.0
        len2 = math.hypot(dx2, dy2) or 1.0

        # Left-hand normal of each edge
        nx1, ny1 = -dy1 / len1,  dx1 / len1
        nx2, ny2 = -dy2 / len2,  dx2 / len2

        # Average (bisector) normal
        bnx = (nx1 + nx2) / 2.0
        bny = (ny1 + ny2) / 2.0
        bn_len = math.hypot(bnx, bny) or 1.0

        # Scale to maintain constant offset width
        # (miter = offset / sin(half-angle); approximate via dot product)
        dot = nx1 * nx2 + ny1 * ny2
        miter_scale = 1.0 / max(bn_len, 0.1)          # guard division by zero
        dist = offset * miter_scale

        offsets.append((x1 + dist * bnx / bn_len,
                        y1 + dist * bny / bn_len))

    # Re-close if original was closed
    if closed:
        offsets.append(offsets[0])

    return offsets


def _build_depth_list(cutting_depth: float, stepdown: float) -> List[float]:
    """
    Return an explicit list of Z-depths (negative values) for each pass.

    Example: cutting_depth=5, stepdown=2  →  [-2.0, -4.0, -5.0]
    The final entry is always exactly -cutting_depth so the full depth is
    always reached without over-cutting.
    """
    depths: List[float] = []
    z = stepdown
    while z < cutting_depth - 1e-9:
        depths.append(-z)
        z += stepdown
    depths.append(-cutting_depth)          # guaranteed final pass
    return depths


def _sample_wire_points(wire: Any, steps: int = 60) -> List[Tuple[float, float]]:
    """
    Sample (x, y) points along a build123d wire.

    Strategy (vertex-aware):
      1. Collect all hard vertices first so sharp corners are never skipped.
      2. Fill inter-vertex segments by parameter interpolation.

    Falls back to pure vertex sampling if position_at() is unavailable.
    """
    points: List[Tuple[float, float]] = []

    # ---- Step 1: collect vertex positions (guaranteed corner points) -------
    vertex_pts: List[Tuple[float, float]] = []
    try:
        verts = wire.vertices() if callable(wire.vertices) else wire.vertices
        vertex_pts = [(v.X, v.Y) for v in verts]
    except Exception:
        pass

    # ---- Step 2: dense parametric sampling ---------------------------------
    try:
        sampled: List[Tuple[float, float]] = []
        for s in range(steps + 1):
            t = s / float(steps)
            pt = wire.position_at(t) if hasattr(wire, "position_at") else (wire @ t)
            sampled.append((pt.X, pt.Y))

        # Merge vertices into the sampled list (insert if not close to any sample)
        merged = list(sampled)
        for vx, vy in vertex_pts:
            if not any(abs(vx - sx) < 1e-3 and abs(vy - sy) < 1e-3
                       for sx, sy in merged):
                merged.append((vx, vy))

        # Sort merged points by their closest parametric position
        # (simple approach: keep sampled order + appended vertices at end)
        points = merged

    except Exception:
        # Fallback: vertices only
        if vertex_pts:
            points = vertex_pts + [vertex_pts[0]]   # close the path

    return points


# ---------------------------------------------------------------------------
# Main generator
# ---------------------------------------------------------------------------

class GCodeGenerator:
    """
    Programmatically translates build123d shapes into toolpaths and
    machine-ready G-code.

    Supported strategies
    --------------------
    profile  – Contour the outer boundary of each XY face (default).
               Tool offset is applied outward so the part edge is exact.
    pocket   – Clear the interior of each XY face with a spiral/zigzag
               approximated by concentric inward offsets.
    drill    – Canned-cycle drilling at every circular-face centroid.
    """

    def __init__(
        self,
        tool_diameter: float = 3.175,
        stepdown: float = 1.0,
        feed_rate: float = 800.0,
        plunge_rate: float = 200.0,
        cutting_depth: float = 5.0,
        safe_z: float = 5.0,
        spindle_speed: float = 12000.0,
        strategy: str = "profile",
    ):
        self.tool_diameter = tool_diameter
        self.tool_radius = tool_diameter / 2.0
        self.stepdown = stepdown
        self.feed_rate = feed_rate
        self.plunge_rate = plunge_rate
        self.cutting_depth = cutting_depth
        self.safe_z = safe_z
        self.spindle_speed = spindle_speed
        self.strategy = strategy.lower()

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------

    def generate(self, shape: Any) -> Dict[str, Any]:
        """
        Process a build123d shape → G-code string + toolpath coordinates.
        """
        toolpaths: List[List[Tuple[float, float, float]]] = []

        # ---- Programme header -------------------------------------------
        gcode_lines: List[str] = [
            "%",
            "O0001 (CAD COPILOT GENERATED CNC PROGRAM)",
            "; --- CAD Copilot CAM Generated G-code ---",
            f"; Strategy      : {self.strategy}",
            f"; Tool Diameter : {self.tool_diameter} mm",
            f"; Tool Radius   : {self.tool_radius} mm  (applied as XY offset)",
            f"; Stepdown      : {self.stepdown} mm",
            f"; Feed Rate     : {self.feed_rate} mm/min",
            f"; Plunge Rate   : {self.plunge_rate} mm/min",
            f"; Cutting Depth : {self.cutting_depth} mm",
            "",
            # FIX 1 ▸ Safety block — G90 set ONCE here, never repeated later
            "G17 G21 G40 G49 G80 G90 G94 ; XY plane | mm | cancel comps | absolute | feed/min",
            "T1 M6                        ; Tool change: Tool 1 (End Mill)",
            "G54                          ; Work Coordinate System 1",
            f"M3 S{int(self.spindle_speed)}               ; Spindle ON clockwise at {int(self.spindle_speed)} RPM",
            "M8                           ; Flood coolant ON",
            f"G43 H1 Z{self.safe_z:.3f}          ; Tool length offset, rapid to safe Z",
        ]

        # ---- Extract geometry ------------------------------------------
        wires, centroids = self._extract_geometry(shape, gcode_lines)

        # ---- Route to the correct strategy ----------------------------
        if self.strategy == "drill":
            self._strategy_drill(centroids, gcode_lines, toolpaths)
        elif self.strategy == "pocket":
            self._strategy_pocket(wires, gcode_lines, toolpaths)
        else:
            # Default: profile
            self._strategy_profile(wires, gcode_lines, toolpaths)

        # ---- Programme footer ------------------------------------------
        # FIX 2 ▸ Correct G28 sequence:
        #   a) Switch to incremental (G91) on its own line
        #   b) G28 Z0  – retract Z through the current position (safe)
        #   c) G28 X0 Y0 – home XY
        #   d) G90 restore absolute AFTER all G28 moves are done
        gcode_lines.extend([
            "",
            "; --- End of machining ---",
            "M9                ; Coolant OFF",
            "M5                ; Spindle STOP",
            f"G0 Z{self.safe_z:.3f}    ; Rapid clear to safe Z before homing",
            "G91               ; Switch to incremental for G28 retract",
            "G28 Z0            ; Home Z axis through current incremental position",
            "G28 X0 Y0         ; Home X and Y axes",
            "G90               ; Restore absolute coordinate mode",
            "M30               ; End of programme – rewind",
            "%",
        ])

        return {
            "gcode": "\n".join(gcode_lines),
            "toolpaths": toolpaths,
        }

    # ------------------------------------------------------------------
    # Geometry extraction
    # ------------------------------------------------------------------

    def _extract_geometry(
        self,
        shape: Any,
        gcode_lines: List[str],
    ) -> Tuple[List[Any], List[Tuple[float, float]]]:
        """
        Walk the build123d shape tree and collect:
          - wires: boundary wires from XY-parallel faces
          - centroids: (cx, cy) for circular/drill faces
        """
        wires: List[Any] = []
        centroids: List[Tuple[float, float]] = []

        try:
            faces = []
            if hasattr(shape, "faces"):
                f_list = shape.faces() if callable(shape.faces) else shape.faces
                for f in f_list:
                    try:
                        n = f.normal_at() if callable(f.normal_at) else f.normal_at
                        if abs(n.Z) > 0.9:
                            faces.append(f)
                    except Exception:
                        faces.append(f)

            if faces:
                for f in faces:
                    # Collect centroid for drill strategy
                    try:
                        c = f.center()
                        centroids.append((c.X, c.Y))
                    except Exception:
                        pass

                    if hasattr(f, "outer_wire"):
                        wires.append(f.outer_wire())
                    elif hasattr(f, "wires"):
                        w_list = f.wires() if callable(f.wires) else f.wires
                        wires.extend(w_list)
            else:
                if hasattr(shape, "wires"):
                    wires = shape.wires() if callable(shape.wires) else shape.wires

        except Exception as exc:
            gcode_lines.append(f"; Wire extraction error: {exc}")

        if not wires:
            gcode_lines.append("; WARNING: No valid XY-planar boundaries found.")

        return wires, centroids

    # ------------------------------------------------------------------
    # Strategy: PROFILE
    # ------------------------------------------------------------------

    def _strategy_profile(
        self,
        wires: List[Any],
        gcode_lines: List[str],
        toolpaths: List[List[Tuple[float, float, float]]],
    ) -> None:
        """
        Contour each wire boundary.
        FIX 3 ▸ Tool radius offset applied to every (x, y) point so the
                 cutter edge—not its centre—follows the boundary.
        FIX 4 ▸ Depth list is explicit; final pass always hits exact depth.
        """
        depths = _build_depth_list(self.cutting_depth, self.stepdown)

        for idx, wire in enumerate(wires):
            raw_pts = _sample_wire_points(wire)
            if not raw_pts:
                continue

            # FIX 3 ▸ Offset points outward by tool radius
            pts = _compute_offsets(raw_pts, self.tool_radius)

            gcode_lines.append(f"\n; === Profile: Contour {idx + 1} ===")

            # Rapid to start XY at safe Z
            sx, sy = pts[0]
            gcode_lines.append(f"G0 X{sx:.3f} Y{sy:.3f}   ; Rapid to contour start")

            # FIX 4 ▸ Iterate explicit depth list
            for pass_idx, z in enumerate(depths):
                gcode_lines.append(f"; Pass {pass_idx + 1}/{len(depths)}  Z = {z:.3f} mm")
                gcode_lines.append(
                    f"G1 Z{z:.3f} F{self.plunge_rate:.1f}   ; Plunge"
                )

                pass_path: List[Tuple[float, float, float]] = [(sx, sy, z)]

                for px, py in pts[1:]:
                    gcode_lines.append(
                        f"G1 X{px:.3f} Y{py:.3f} F{self.feed_rate:.1f}"
                    )
                    pass_path.append((px, py, z))

                toolpaths.append(pass_path)

            gcode_lines.append(f"G0 Z{self.safe_z:.3f}   ; Lift to safe Z")

    # ------------------------------------------------------------------
    # Strategy: POCKET
    # ------------------------------------------------------------------

    def _strategy_pocket(
        self,
        wires: List[Any],
        gcode_lines: List[str],
        toolpaths: List[List[Tuple[float, float, float]]],
    ) -> None:
        """
        Clear each closed boundary using concentric inward offsets spaced
        by (tool_diameter * 0.5) — a 50 % stepover.
        FIX 3 ▸ Inward offset applied; tool centre stays inside boundary.
        FIX 4 ▸ Explicit depth list used.
        """
        depths = _build_depth_list(self.cutting_depth, self.stepdown)
        stepover = self.tool_diameter * 0.5

        for idx, wire in enumerate(wires):
            raw_pts = _sample_wire_points(wire)
            if not raw_pts:
                continue

            gcode_lines.append(f"\n; === Pocket: Interior {idx + 1} ===")

            # Build concentric rings inward until polygon collapses
            rings: List[List[Tuple[float, float]]] = []
            current_pts = raw_pts
            cumulative_inset = self.tool_radius  # first ring: tool-radius inset

            while True:
                inset = _compute_offsets(current_pts, -cumulative_inset)
                if len(inset) < 3:
                    break
                # Stop if the ring has collapsed (all points nearly identical)
                xs = [p[0] for p in inset]
                ys = [p[1] for p in inset]
                span = max(max(xs) - min(xs), max(ys) - min(ys))
                if span < self.tool_diameter:
                    break
                rings.append(inset)
                cumulative_inset += stepover

            if not rings:
                gcode_lines.append("; Pocket too small for tool — skipped")
                continue

            for pass_idx, z in enumerate(depths):
                gcode_lines.append(f"; Pass {pass_idx + 1}/{len(depths)}  Z = {z:.3f} mm")
                for ring_idx, ring in enumerate(rings):
                    sx, sy = ring[0]
                    if ring_idx == 0:
                        gcode_lines.append(
                            f"G0 X{sx:.3f} Y{sy:.3f}   ; Rapid to pocket ring start"
                        )
                        gcode_lines.append(
                            f"G1 Z{z:.3f} F{self.plunge_rate:.1f}   ; Plunge"
                        )
                    else:
                        gcode_lines.append(
                            f"G1 X{sx:.3f} Y{sy:.3f} F{self.feed_rate:.1f}   ; Next ring"
                        )

                    pass_path: List[Tuple[float, float, float]] = [(sx, sy, z)]
                    for px, py in ring[1:]:
                        gcode_lines.append(
                            f"G1 X{px:.3f} Y{py:.3f} F{self.feed_rate:.1f}"
                        )
                        pass_path.append((px, py, z))
                    toolpaths.append(pass_path)

            gcode_lines.append(f"G0 Z{self.safe_z:.3f}   ; Lift to safe Z")

    # ------------------------------------------------------------------
    # Strategy: DRILL
    # ------------------------------------------------------------------

    def _strategy_drill(
        self,
        centroids: List[Tuple[float, float]],
        gcode_lines: List[str],
        toolpaths: List[List[Tuple[float, float, float]]],
    ) -> None:
        """
        Peck-drill at every face centroid using G83 canned cycle.
        FIX 5 ▸ Strategy is now actually implemented (was dead code before).
        """
        if not centroids:
            gcode_lines.append("; WARNING: No drill targets found.")
            return

        peck = min(self.stepdown, self.cutting_depth / 2.0)

        gcode_lines.append("\n; === Drill: Peck canned cycle (G83) ===")
        gcode_lines.append(
            f"G83 Z{-self.cutting_depth:.3f} R{self.safe_z:.3f} "
            f"Q{peck:.3f} F{self.plunge_rate:.1f}   ; G83 peck drill cycle"
        )

        for cx, cy in centroids:
            gcode_lines.append(
                f"X{cx:.3f} Y{cy:.3f}   ; Drill hole at ({cx:.3f}, {cy:.3f})"
            )
            toolpaths.append(
                [(cx, cy, 0.0), (cx, cy, -self.cutting_depth)]
            )

        gcode_lines.append("G80   ; Cancel canned cycle")
        gcode_lines.append(f"G0 Z{self.safe_z:.3f}   ; Lift to safe Z")