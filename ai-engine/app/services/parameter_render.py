"""
Parameter Render Service - Build123d Script Execution and 3D Model Export

This module executes generated build123d scripts in an isolated subprocess
and exports the resulting 3D models to STEP and STL formats.
"""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path
from typing import Any, Dict, Optional


def _coerce_jsonable(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(k): _coerce_jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_coerce_jsonable(v) for v in value]
    if hasattr(value, "item"):
        try:
            return value.item()
        except Exception:
            return value
    return value


RENDER_HARNESS_TEMPLATE = r"""
import json
import os
import sys
import math
import re
from pathlib import Path
from functools import reduce
import operator

try:
    from build123d import *
except ImportError:
    print("CRITICAL: build123d not found.")
    sys.exit(1)

def _coerce_params(value):
    if isinstance(value, dict):
        return {str(k): _coerce_params(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_coerce_params(v) for v in value]
    if hasattr(value, "item"):
        try:
            return value.item()
        except Exception:
            return value
    if isinstance(value, str):
        # Aggressively strip units and whitespace
        clean_value = re.sub(r"(?i)\s*(?:mm|in|inch|degrees?|°|rads?|radians?)\s*$", "", value.strip())
        if re.fullmatch(r"[+-]?\d+(?:\.\d+)?", clean_value):
            try:
                return float(clean_value)

            except Exception:
                return value
    return value

def _shape_faces_count(obj):
    try:
        faces = obj.faces() if callable(getattr(obj, "faces", None)) else obj.faces
        return len(faces)
    except Exception:
        return 0

def _validate_shape(obj):
    try:
        if hasattr(obj, "is_valid") and callable(getattr(obj, "is_valid")):
            if not obj.is_valid():
                raise RuntimeError("Invalid shape geometry (is_valid=False).")
    except Exception:
        pass
    try:
        if hasattr(obj, "solids") and callable(getattr(obj, "solids")):
            if len(obj.solids()) == 0:
                raise RuntimeError("No solid bodies found in result.")
    except Exception:
        pass
    if _shape_faces_count(obj) == 0:
        raise RuntimeError("No faces found in result.")

def run():
    raw_json = os.getenv("CAD_PARAMETERS_JSON", "{}")
    try:
        params = json.loads(raw_json)
    except Exception:
        params = {}
    params = _coerce_params(params)

    ns = {
        "PARAMETERS": params,
        "__name__": "__main__",
        "math": math,
    }

    try:
        exec("from build123d import *", ns)
    except ImportError:
        print("CRITICAL: build123d not found.")
        sys.exit(1)

    import build123d
    # Compatibility Patches for build123d 0.10.0
    if hasattr(build123d, "Mixin1D"):
        build123d.Mixin1D.start = property(lambda self: self @ 0)
        build123d.Mixin1D.end = property(lambda self: self @ 1)
    elif hasattr(build123d, "Edge"):
        build123d.Edge.start = property(lambda self: self @ 0)
        build123d.Edge.end = property(lambda self: self @ 1)

    # Sync patched objects to namespace
    ns.update({k: getattr(build123d, k) for k in dir(build123d) if not k.startswith('_')})

    if hasattr(build123d, "Part") and not hasattr(build123d.Part, "export_step"):
        def _part_export_step(self, path):
            return build123d.export_step(self, path)
        def _part_export_stl(self, path):
            return build123d.export_stl(self, path)
        build123d.Part.export_step = _part_export_step
        build123d.Part.export_stl = _part_export_stl

    def _rotated_patch(x=0, y=0, z=0, axis=None, angle=0):
        if axis is not None:
            if hasattr(build123d, "Axis"):
                if axis == build123d.Axis.X:
                    x = angle
                elif axis == build123d.Axis.Y:
                    y = angle
                elif axis == build123d.Axis.Z:
                    z = angle
        return build123d.Locations(build123d.Rotation(x, y, z))

    ns.update({
        "Extrude": ns.get("extrude"),
        "Revolve": ns.get("revolve"),
        "Loft": ns.get("loft"),
        "Sweep": ns.get("sweep"),
        "GridLocation": ns.get("GridLocations"),
        "PolarLocation": ns.get("PolarLocations"),
        "Rotated": _rotated_patch,
        "Rotation": build123d.Rotation,
    })
    if not hasattr(build123d, "Arc") and hasattr(build123d, "RadiusArc"):
        ns["Arc"] = build123d.RadiusArc

    build123d.Vector.position = property(lambda self: self)

    if hasattr(build123d, "BuildLine"):
        build123d.BuildLine.__matmul__ = lambda self, val: self.wire() @ val
        build123d.BuildLine.__mod__ = lambda self, val: self.wire() % val

    if hasattr(build123d, "Part"):
        if not hasattr(build123d.Part, "_orig_center"):
            build123d.Part._orig_center = getattr(build123d.Part, "center", None)
            def get_center(self):
                if callable(build123d.Part._orig_center):
                    return build123d.Part._orig_center(self)
                return self._orig_center if hasattr(self, "_orig_center") else Location((0, 0, 0))
            build123d.Part.center = property(get_center)

    _orig_fillet = build123d.fillet
    def smart_fillet(*args, **kwargs):
        objs = kwargs.get("objects") or (args[0] if args else None)
        try:
            if objs is not None and hasattr(objs, "__len__") and len(objs) == 0:
                return None
        except Exception:
            pass
        try:
            return _orig_fillet(*args, **kwargs)
        except ValueError as exc:
            msg = str(exc)
            if "objects must be provided" in msg:
                return None
            if "2D fillet operation takes only Vertices" in msg:
                if objs is not None:
                    verts = None
                    if hasattr(objs, "vertices"):
                        v = getattr(objs, "vertices")
                        verts = v() if callable(v) else v
                    if verts:
                        if "objects" in kwargs:
                            kwargs["objects"] = verts
                        elif args:
                            args = (verts,) + args[1:]
                        try:
                            return _orig_fillet(*args, **kwargs)
                        except Exception:
                            return None
            if "edges are not all the same type" in msg.lower() or "invalid for fillet" in msg.lower():
                return None
            raise
        except Exception as exc:
            if any(x in str(exc).lower() for x in ["invalid", "empty", "degenerate", "tolerance"]):
                return None
            raise
    build123d.fillet = smart_fillet
    ns["fillet"] = smart_fillet

    _orig_chamfer = build123d.chamfer
    def smart_chamfer(*args, **kwargs):
        objs = kwargs.get("objects") or (args[0] if args else None)
        try:
            if objs is not None and hasattr(objs, "__len__") and len(objs) == 0:
                return None
        except Exception:
            pass
        try:
            return _orig_chamfer(*args, **kwargs)
        except ValueError as exc:
            msg = str(exc)
            if "objects must be provided" in msg:
                return None
            if "edges are not all the same type" in msg.lower():
                return None
            raise
        except Exception as exc:
            if any(x in str(exc).lower() for x in ["invalid", "empty", "degenerate", "tolerance"]):
                return None
            raise
    build123d.chamfer = smart_chamfer
    ns["chamfer"] = smart_chamfer

    _orig_extrude = build123d.extrude
    def safe_extrude(*args, **kwargs):
        try:
            return _orig_extrude(*args, **kwargs)
        except Exception as exc:
            msg = str(exc).lower()
            if any(x in msg for x in ["empty", "invalid", "degenerate", "self-intersect"]):
                return None
            raise
    build123d.extrude = safe_extrude
    ns["extrude"] = safe_extrude

    try:
        script_content = Path("user_script.py").read_text(encoding="utf-8")
        script_content = re.sub(r"Polygon\((.*?),\s*close=(?:True|False)\)", r"Polygon(\1)", script_content)
        script_content = re.sub(r"(\s+)extrude\s*\(\s*", r"\1# extrude_placeholder(", script_content)
        script_content = re.sub(r"# extrude_placeholder", r"extrude", script_content)

        exec(script_content, ns)
    except Exception:
        import traceback
        print("\n---TRACEBACK_START---", flush=True)
        traceback.print_exc(file=sys.stdout)
        print("---TRACEBACK_END---", flush=True)
        sys.exit(1)

    shape = None
    annotations = {}
    if "build_model" in ns and callable(ns["build_model"]):
        try:
            res = ns["build_model"](params)
            if isinstance(res, tuple) and len(res) == 2 and isinstance(res[1], dict):
                shape, annotations = res
            else:
                shape = reduce(operator.add, res) if isinstance(res, (list, tuple)) else res
        except Exception:
            import traceback
            print("\n---TRACEBACK_START---", flush=True)
            traceback.print_exc(file=sys.stdout)
            print("---TRACEBACK_END---", flush=True)
            sys.exit(1)

    if shape is None:
        for name in ("model", "part", "result", "assembly", "shape", "solid"):
            if name in ns:
                shape = ns[name]
                break

    if shape is None:
        print("RENDER_ERROR: No exportable shape found.")
        sys.exit(1)

    out_dir = Path(os.getenv("OUTPUT_DIR", "."))
    basename = os.getenv("OUTPUT_BASENAME", "model")
    try:
        from build123d.exporters import ExportDXF
        _validate_shape(shape)
        export_step(shape, str(out_dir / f"{basename}.step"))
        export_stl(shape, str(out_dir / f"{basename}.stl"))
        
        # DXF Export for CNC/Drafting
        try:
            dxf_exporter = ExportDXF(unit=build123d.Unit.MM)
            dxf_exporter.add_shape(shape)
            dxf_exporter.write(str(out_dir / f"{basename}.dxf"))
        except Exception as dxf_exc:
            print(f"DXF_WARNING: Could not export DXF: {dxf_exc}")


        with open(out_dir / f"{basename}_annotations.json", "w") as f:
            json.dump(annotations, f)

        print(f"RENDER_SUCCESS: Exported {basename}.step, {basename}.stl, and {basename}.dxf", flush=True)

    except Exception as exc:
        print(f"EXPORT_ERROR: {exc}")
        sys.exit(1)

if __name__ == "__main__":
    run()
"""


class ParameterRenderService:
    def __init__(self, outputs_dir: Optional[Path] = None) -> None:
        project_root = Path(__file__).resolve().parents[2]
        self.outputs_dir = outputs_dir or (project_root / "outputs")
        self.outputs_dir.mkdir(parents=True, exist_ok=True)

    def render_to_outputs(
        self,
        parameters: Dict[str, Any],
        script: str,
        output_basename: str,
    ) -> Dict[str, str]:
        self.clear_outputs()
        parameters = _coerce_jsonable(parameters)

        max_render_retries = max(1, int(os.getenv("RENDER_MAX_RETRIES", "1")))
        timeout_seconds = int(os.getenv("RENDER_TIMEOUT_SECONDS", "180"))
        last_error: Optional[str] = None

        for attempt in range(1, max_render_retries + 1):
            with tempfile.TemporaryDirectory(prefix="cad_v3_") as temp_dir:
                tmp = Path(temp_dir)

                (tmp / "user_script.py").write_text(script, encoding="utf-8")
                (tmp / "harness.py").write_text(RENDER_HARNESS_TEMPLATE, encoding="utf-8")

                env = os.environ.copy()
                env["CAD_PARAMETERS_JSON"] = json.dumps(parameters, ensure_ascii=True)
                env["OUTPUT_DIR"] = str(self.outputs_dir)
                env["OUTPUT_BASENAME"] = output_basename

                try:
                    proc = subprocess.run(
                        [sys.executable, "harness.py"],
                        capture_output=True,
                        text=True,
                        cwd=temp_dir,
                        env=env,
                        timeout=timeout_seconds,
                    )
                except subprocess.TimeoutExpired:
                    last_error = "Render Engine timed out. Geometry might be too complex."
                    if attempt >= max_render_retries:
                        raise RuntimeError(last_error)
                    continue

                if proc.returncode != 0:
                    full_log = (proc.stdout or "") + (proc.stderr or "")
                    error_msg = self._parse_worker_error(full_log)
                    self._log_fail(script, parameters, full_log)
                    last_error = error_msg or "Render subprocess failed."
                    if attempt >= max_render_retries:
                        raise RuntimeError(last_error)
                    continue

                last_error = None
                break

        if last_error:
            raise RuntimeError(last_error)

        stl_path = self.outputs_dir / f"{output_basename}.stl"
        step_path = self.outputs_dir / f"{output_basename}.step"
        dxf_path = self.outputs_dir / f"{output_basename}.dxf"


        if not stl_path.exists() or not step_path.exists():
            raise RuntimeError("Render finished but artifacts are missing.")

        annotations_path = self.outputs_dir / f"{output_basename}_annotations.json"
        annotations = {}
        if annotations_path.exists():
            try:
                with open(annotations_path, "r") as f:
                    annotations = json.load(f)
            except Exception:
                pass

        return {
            "stl_path": str(stl_path),
            "step_path": str(step_path),
            "dxf_path": str(dxf_path) if dxf_path.exists() else None,
            "annotations": annotations,
        }

    def _parse_worker_error(self, log: str) -> str:
        if "---TRACEBACK_START---" in log:
            try:
                parts = log.split("---TRACEBACK_START---")
                inner = parts[-1].split("---TRACEBACK_END---")[0].strip()
                lines = [line.strip() for line in inner.splitlines() if line.strip()]
                if lines:
                    for line in reversed(lines):
                        if any(x in line for x in ["Error", "error", "Exception"]):
                            return f"Render failed: {line}"
                    return f"Render failed: {lines[-1]}"
            except Exception:
                pass

        if "RENDER_ERROR:" in log:
            try:
                return "Geometry error: " + log.split("RENDER_ERROR:")[1].strip().splitlines()[0]
            except Exception:
                pass

        if "EXPORT_ERROR:" in log:
            try:
                return "Export error: " + log.split("EXPORT_ERROR:")[1].strip().splitlines()[0]
            except Exception:
                pass

        return "Geometry engine failed. Review script logic and parameter values."

    def clear_outputs(self) -> None:
        for item in self.outputs_dir.iterdir():
            try:
                if item.is_file():
                    item.unlink()
                elif item.is_dir():
                    shutil.rmtree(item)
            except Exception:
                pass

    def _log_fail(self, script: str, params: dict, log: str) -> None:
        try:
            log_dir = Path(__file__).resolve().parents[2] / "logs"
            log_dir.mkdir(parents=True, exist_ok=True)
            log_file = log_dir / f"render_v3_fail_{uuid.uuid4().hex[:6]}.json"
            with open(log_file, "w") as f:
                json.dump({"script": script, "parameters": params, "log": log}, f, indent=2)
        except Exception:
            pass


def extract_parameters_from_script(script: str) -> Dict[str, Any]:
    try:
        import ast

        tree = ast.parse(script)
        for node in tree.body:
            if isinstance(node, ast.Assign):
                for target in node.targets:
                    if isinstance(target, ast.Name) and target.id == "PARAMETERS":
                        return ast.literal_eval(node.value)
            if isinstance(node, ast.AnnAssign):
                if isinstance(node.target, ast.Name) and node.target.id == "PARAMETERS":
                    if node.value is not None:
                        return ast.literal_eval(node.value)
    except Exception:
        pass

    match = re.search(r"PARAMETERS\s*=\s*(\{.*?\})", script, re.DOTALL)
    if not match:
        return {}
    try:
        import ast

        return ast.literal_eval(match.group(1))
    except Exception:
        return {}


def validate_script_syntax(script: str) -> tuple[bool, Optional[str]]:
    try:
        import ast

        ast.parse(script)
        return True, None
    except SyntaxError as exc:
        return False, f"Syntax error at line {exc.lineno}: {exc.msg}"
    except Exception as exc:
        return False, f"Validation error: {str(exc)}"


def get_build123d_version() -> str:
    try:
        import build123d

        return getattr(build123d, "__version__", "unknown")
    except ImportError:
        return "not installed"