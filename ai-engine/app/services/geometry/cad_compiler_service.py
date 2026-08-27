from app.models.efg import EngineeringFeatureGraph
from app.services.geometry.cad_planner_service import CADFeaturePlan
from app.constants import (
    DEFAULT_BASE_DIAMETER,
    DEFAULT_BASE_LENGTH,
    DEFAULT_BASE_WIDTH,
    DEFAULT_BASE_HEIGHT,
    DEFAULT_BASE_DEPTH,
    DEFAULT_HOLE_DIAMETER,
    DEFAULT_HOLE_DEPTH,
)

class CADCompilerService:
    """
    Translates the deterministic CADFeaturePlan into build123d Python syntax.
    Replaces the previous architecture where the LLM generated Python code directly.
    """
    
    def __init__(self):
        pass

    def compile(self, plan: CADFeaturePlan) -> str:
        """
        Generates Python code for build123d execution.
        """
        lines = [
            "import build123d as bd",
            "from bd_warehouse.thread import IsoThread",
            "",
            "def build_geometry():",
            "    with bd.BuildPart() as part:"
        ]
        
        # This is a stub implementation.
        # A full implementation would map each operation_type to specific build123d API calls,
        # e.g. mapping BASE_FEATURE to bd.Cylinder or bd.Box.
        for op in plan.operations:
            lines.append(f"        # Execute {op.operation_id}: {op.operation_type}")
            params = op.parameters or {}
            if op.operation_type == "BASE_FEATURE":
                # The primitive is derived from the operation parameters rather than
                # being hardcoded. A prismatic envelope uses width/height/depth, while a
                # revolved envelope uses diameter/length.
                shape = str(params.get("shape", params.get("primitive", ""))).lower()
                if shape in ("box", "block", "rectangular", "prismatic"):
                    w = float(params.get("width", DEFAULT_BASE_WIDTH))
                    h = float(params.get("height", DEFAULT_BASE_HEIGHT))
                    d = float(params.get("depth", DEFAULT_BASE_DEPTH))
                    lines.append(f"        bd.Box(width={w}, height={h}, depth={d})")
                else:
                    dia = float(params.get("diameter", DEFAULT_BASE_DIAMETER))
                    length = float(params.get("length", params.get("height", DEFAULT_BASE_LENGTH)))
                    lines.append(f"        bd.Cylinder(radius={dia/2}, height={length})")
            elif op.operation_type == "HOLE":
                dia = params.get("diameter", DEFAULT_HOLE_DIAMETER)
                depth = params.get("depth", DEFAULT_HOLE_DEPTH)
                lines.append(f"        # Stub hole: diameter={dia}, depth={depth}")
                lines.append(f"        pass")
            else:
                lines.append(f"        pass")
                
        lines.append("")
        lines.append("    return part.part")
        lines.append("")
        lines.append("if __name__ == '__main__':")
        lines.append("    shape = build_geometry()")
        lines.append("    shape.export_step('cad_output.step')")
        
        return "\n".join(lines)
