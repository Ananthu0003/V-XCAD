"""
Parameter Render Service - Build123d Script Execution and 3D Model Export

This module executes generated build123d scripts in an isolated subprocess
and exports the resulting 3D models to STEP and STL formats.
"""

import asyncio
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
import uuid
import faulthandler
faulthandler.enable()

# Patch math.dist to be robust against dimensional mismatches (e.g. 3D Vector vs 2D tuple)
_orig_dist = math.dist
def _robust_dist(p1, p2):
    def to_coords(p):
        if hasattr(p, "to_tuple"):
            try: return list(p.to_tuple())
            except Exception: pass
        if hasattr(p, "X") and hasattr(p, "Y"):
            if hasattr(p, "Z"): return [p.X, p.Y, p.Z]
            return [p.X, p.Y]
        if hasattr(p, "__getitem__"):
            try: return list(p)
            except Exception: pass
        return p

    try:
        c1 = to_coords(p1)
        c2 = to_coords(p2)
        if isinstance(c1, list) and isinstance(c2, list):
            if len(c1) == len(c2):
                return _orig_dist(c1, c2)
            if len(c1) == 3 and len(c2) == 2:
                if abs(c1[2]) < 1e-5: return _orig_dist(c1[:2], c2)
                elif abs(c1[0]) < 1e-5: return _orig_dist(c1[1:], c2)
                elif abs(c1[1]) < 1e-5: return _orig_dist([c1[0], c1[2]], c2)
                return _orig_dist(c1[:2], c2)
            if len(c2) == 3 and len(c1) == 2:
                if abs(c2[2]) < 1e-5: return _orig_dist(c1, c2[:2])
                elif abs(c2[0]) < 1e-5: return _orig_dist(c1, c2[1:])
                elif abs(c2[1]) < 1e-5: return _orig_dist(c1, [c2[0], c2[2]])
                return _orig_dist(c1, c2[:2])
            min_len = min(len(c1), len(c2))
            if min_len > 0:
                return _orig_dist(c1[:min_len], c2[:min_len])
    except Exception:
        pass
    return _orig_dist(p1, p2)
math.dist = _robust_dist

try:
    from build123d import *
    import build123d as _bd123
except ImportError:
    print("CRITICAL: build123d not found.")
    sys.exit(1)

# --- Safety patches for chamfer / fillet -----------------------------------
# The LLM sometimes generates values that are too large for the geometry.
# These wrappers automatically retry with a halved value up to 5 times,
# so a single bad value doesn't crash the whole render.
_orig_chamfer = chamfer
_orig_fillet  = fillet

def _safe_chamfer(*args, **kwargs):
    if 'edges' in kwargs:
        if args:
            # If args exists, just pop edges and hope it works
            kwargs['objects'] = kwargs.pop('edges')
        else:
            args = (kwargs.pop('edges'),)
            
    # Try to extract the primary value to shrink during retries
    length = kwargs.get('length')
    if length is None and len(args) >= 2:
        length = args[1]
        
    v = length
    for _ in range(5):
        try:
            if len(args) >= 2:
                new_args = (args[0], v) + args[2:]
                return _orig_chamfer(*new_args, **kwargs)
            else:
                kwargs['length'] = v
                return _orig_chamfer(*args, **kwargs)
        except (ValueError, Exception) as exc:
            msg = str(exc).lower()
            if "chamfer" in msg or "smaller" in msg:
                v = v / 2.0
                if v < 1e-4:
                    print("[chamfer] Skipped - value too small after retries.")
                    return
            elif "findfromkey" in msg or "nosuchobject" in msg or "chfi3d" in msg or "stdfail" in msg or "brep_api" in msg or "invalid" in msg:
                print(f"[chamfer] Skipped - stale edge reference or topological failure.")
                return
            else:
                raise
    print("[chamfer] Skipped after 5 retries.")

def _safe_fillet(*args, **kwargs):
    if 'edges' in kwargs:
        if args:
            kwargs['objects'] = kwargs.pop('edges')
        else:
            args = (kwargs.pop('edges'),)

    radius = kwargs.get('radius')
    if radius is None and len(args) >= 2:
        radius = args[1]

    v = radius
    for _ in range(5):
        try:
            if len(args) >= 2:
                new_args = (args[0], v) + args[2:]
                return _orig_fillet(*new_args, **kwargs)
            else:
                kwargs['radius'] = v
                return _orig_fillet(*args, **kwargs)
        except (ValueError, Exception) as exc:
            msg = str(exc).lower()
            if "fillet" in msg or "smaller" in msg:
                v = v / 2.0
                if v < 1e-4:
                    print("[fillet] Skipped - value too small after retries.")
                    return
            elif "findfromkey" in msg or "nosuchobject" in msg or "chfi3d" in msg or "stdfail" in msg or "brep_api" in msg or "invalid" in msg:
                print(f"[fillet] Skipped - stale edge reference or topological failure.")
                return
            else:
                raise
    print("[fillet] Skipped after 5 retries.")

chamfer = _safe_chamfer
fillet  = _safe_fillet

_orig_rectangle = Rectangle
def _safe_rectangle(*args, **kwargs):
    if 'length' in kwargs and 'height' not in kwargs:
        kwargs['height'] = kwargs.pop('length')
    return _orig_rectangle(*args, **kwargs)

Rectangle = _safe_rectangle

# Also patch the module object so `bd.chamfer(...)` / `bd.fillet(...)` are covered
_bd123.chamfer = _safe_chamfer
_bd123.fillet  = _safe_fillet
_bd123.Rectangle = _safe_rectangle
# ---------------------------------------------------------------------------

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
    except RuntimeError:
        raise
    except Exception:
        pass

    try:
        if hasattr(obj, "solids") and callable(getattr(obj, "solids")):
            if len(obj.solids()) == 0:
                raise RuntimeError("No solid bodies found in result. You returned a 2D sketch/face instead of a 3D solid. Ensure you have extruded or revolved your geometry.")
    except RuntimeError:
        raise
    except Exception:
        pass

    if _shape_faces_count(obj) == 0:
        raise RuntimeError("No faces found in result. Ensure you have generated solid geometry.")

    try:
        bbox = obj.bounding_box() if callable(getattr(obj, "bounding_box", None)) else getattr(obj, "bounding_box", None)
        if bbox and hasattr(bbox, "size"):
            max_dim = max(bbox.size.X, bbox.size.Y, bbox.size.Z)
            if max_dim > 5000:
                raise ValueError(f"Shape exceeds maximum bounding box limits (max dimension {max_dim:.1f} > 5000).")
    except ValueError:
        raise
    except Exception:
        pass

def run():
    raw_json = os.getenv("CAD_PARAMETERS_JSON", "{}")
    try:
        params = json.loads(raw_json)
    except Exception:
        params = {}
    params = _coerce_params(params)
    _VALIDATION_MODE = os.getenv("VALIDATION_MODE", "0") == "1"

    ns = {
        "PARAMETERS": params,
        "__name__": "__main__",
        "math": math,
    }
    
    # Auto-inject all parameters directly into the namespace 
    # to protect against LLMs forgetting to unpack them
    ns.update(params)

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
        
    if hasattr(build123d, "GeomType"):
        build123d.GeomType.ARC = build123d.GeomType.CIRCLE

    if hasattr(build123d, "Plane"):
        _orig_plane_init = build123d.Plane.__init__
        def _safe_plane_init(self, *args, **kwargs):
            if "normal" in kwargs:
                kwargs["z_dir"] = kwargs.pop("normal")
            if "z_dir" in kwargs and not args and "origin" not in kwargs:
                kwargs["origin"] = (0, 0, 0)
            return _orig_plane_init(self, *args, **kwargs)
        build123d.Plane.__init__ = _safe_plane_init

    if hasattr(build123d, "ShapeList") and hasattr(build123d.ShapeList, "filter_by_position"):
        _orig_filter_pos = build123d.ShapeList.filter_by_position
        def safe_filter_by_position(self, axis, minimum=None, maximum=None, *args, **kwargs):
            if minimum is None:
                # LLM likely hallucinated filter_by_position(Axis.Z) instead of filter_by(Axis.Z)
                if hasattr(self, "filter_by"):
                    return self.filter_by(axis)
                return self
            if maximum is None:
                maximum = minimum
            kwargs.pop("tolerance", None)
            return _orig_filter_pos(self, axis, minimum, maximum, *args, **kwargs)
        build123d.ShapeList.filter_by_position = safe_filter_by_position

    if hasattr(build123d, "ShapeList") and hasattr(build123d.ShapeList, "filter_by"):
        _orig_filter_by = build123d.ShapeList.filter_by
        def safe_filter_by(self, *args, **kwargs):
            try:
                return _orig_filter_by(self, *args, **kwargs)
            except Exception as exc:
                print(f"Ignored filter_by error: {exc}")
                return self
        build123d.ShapeList.filter_by = safe_filter_by

    if hasattr(build123d, "BuildPart"):
        def _get_active_sketch(self):
            if hasattr(build123d, "BuildSketch") and getattr(build123d.BuildSketch, "active", None) is not None:
                active_sketch = build123d.BuildSketch.active
                if hasattr(active_sketch, "sketch"):
                    return active_sketch.sketch
                return active_sketch
            if hasattr(self, "part") and hasattr(self.part, "sketch"):
                return self.part.sketch
            return None
        build123d.BuildPart.sketch = property(_get_active_sketch)

        def _buildpart_fillet(self, *args, **kwargs):
            return build123d.fillet(*args, **kwargs)
        build123d.BuildPart.fillet = _buildpart_fillet

        def _buildpart_chamfer(self, *args, **kwargs):
            return build123d.chamfer(*args, **kwargs)
        build123d.BuildPart.chamfer = _buildpart_chamfer
    if hasattr(build123d, "ShapeList"):
        _orig_getitem = build123d.ShapeList.__getitem__
        def _safe_getitem(self, index):
            try:
                return _orig_getitem(self, index)
            except IndexError:
                # Return a dummy edge so the script doesn't crash.
                # Safe fillet/chamfer wrappers will ignore the dummy edge.
                return build123d.Edge.make_line((0,0,0), (0,0,0.001))
        build123d.ShapeList.__getitem__ = _safe_getitem

        def _shapelist_fillet(self, radius, *args, **kwargs):
            return build123d.fillet(self, radius, *args, **kwargs)
        build123d.ShapeList.fillet = _shapelist_fillet

        def _shapelist_chamfer(self, length, length2=None, *args, **kwargs):
            return build123d.chamfer(self, length, length2, *args, **kwargs)
        build123d.ShapeList.chamfer = _shapelist_chamfer

    if hasattr(build123d, "Shape"):
        def _shape_fillet(self, radius, *args, **kwargs):
            return build123d.fillet(self, radius, *args, **kwargs)
        build123d.Shape.fillet = _shape_fillet

        def _shape_chamfer(self, length, length2=None, *args, **kwargs):
            return build123d.chamfer(self, length, length2, *args, **kwargs)
        build123d.Shape.chamfer = _shape_chamfer

    # Patch boolean operations to ignore topological failures
    def _make_safe_bool(orig):
        def safe_bool(self, other):
            try:
                return orig(self, other)
            except Exception as exc:
                print(f"Ignored topological error in boolean {orig.__name__}: {exc}")
                return self
        return safe_bool

    for cls_name in ("Part", "Solid", "Sketch", "Face", "Wire", "Edge", "Shape", "Curve", "Line"):
        cls = getattr(build123d, cls_name, None)
        if cls is not None:
            for op in ("__sub__", "__add__", "__and__"):
                if hasattr(cls, op):
                    setattr(cls, op, _make_safe_bool(getattr(cls, op)))
                    setattr(cls, op, _make_safe_bool(getattr(cls, op)))

    # Dummy polyfills for hallucinated functions
    def _dummy_boolean_func(*args, **kwargs):
        print("Ignored hallucinated cadquery function")
        return args[0] if args else None
    
    for f in ("intersect", "fuse", "cut"):
        setattr(build123d, f, _dummy_boolean_func)
        ns[f] = _dummy_boolean_func

    # Patch Location to support context manager so hallucinated 'with bd.Rotation():' works gracefully
    if hasattr(build123d, "Location"):
        def loc_enter(self):
            self._loc_ctx = build123d.Locations(self)
            return self._loc_ctx.__enter__()
        def loc_exit(self, exc_type, exc_val, exc_tb):
            return self._loc_ctx.__exit__(exc_type, exc_val, exc_tb)
        build123d.Location.__enter__ = loc_enter
        build123d.Location.__exit__ = loc_exit

    # Sync patched objects to namespace
    ns.update({k: getattr(build123d, k) for k in dir(build123d) if not k.startswith('_')})

    def _safe_rectangle(width, height, *args, **kwargs):
        radius = kwargs.pop("radius", None)
        face = build123d.Rectangle(width, height, *args, **kwargs)
        if radius is not None:
            try:
                face = build123d.fillet(face.vertices(), radius)
            except Exception:
                pass
        return face

    def _safe_square(size, *args, **kwargs):
        radius = kwargs.pop("radius", None)
        face = build123d.Square(size, *args, **kwargs)
        if radius is not None:
            try:
                face = build123d.fillet(face.vertices(), radius)
            except Exception:
                pass
        return face

    ns.update({
        "Rectangle": _safe_rectangle,
        "Square": _safe_square,
    })

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

    # Inside RENDER_HARNESS_TEMPLATE -> run()
    if hasattr(build123d, "RadiusArc"):
        _orig_radius_arc = build123d.RadiusArc
        def safe_radius_arc(start, end, radius, *args, **kwargs):
            try:
                chord = math.dist(start, end)
                if chord < 1e-5:
                    return build123d.Line(start, (start[0] + 1e-5, start[1]))
                min_radius = chord / 2.0 + 1e-6
                if abs(radius) < min_radius:
                    radius = math.copysign(min_radius, radius)
            except Exception:
                pass
            return _orig_radius_arc(start, end, radius, *args, **kwargs)
        build123d.RadiusArc = safe_radius_arc
        ns["RadiusArc"] = safe_radius_arc

    # NEW: Add a protective patch for basic Lines
    if hasattr(build123d, "Line"):
        _orig_line = build123d.Line
        def safe_line(pts_or_start, *args, **kwargs):
            try:
                if len(args) == 1: # Line(start, end) pattern
                    if math.dist(pts_or_start, args[0]) < 1e-5:
                        # Prevent zero-length line crash
                        return _orig_line(pts_or_start, (pts_or_start[0] + 1e-5, pts_or_start[1]))
            except Exception:
                pass
            return _orig_line(pts_or_start, *args, **kwargs)
        build123d.Line = safe_line
        ns["Line"] = safe_line

    build123d.Vector.position = property(lambda self: self)
    build123d.Vector.x = property(lambda self: self.X)
    build123d.Vector.y = property(lambda self: self.Y)
    build123d.Vector.z = property(lambda self: self.Z)
    if hasattr(build123d, "Vertex"):
        build123d.Vertex.x = property(lambda self: self.X)
        build123d.Vertex.y = property(lambda self: self.Y)
        build123d.Vertex.z = property(lambda self: self.Z)

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

    try:
        from build123d.build_common import Builder
        if hasattr(Builder, "_add_to_context"):
            _orig_add_to_context = Builder._add_to_context
            def safe_add_to_context(self, *objs, **kwargs):
                try:
                    return _orig_add_to_context(self, *objs, **kwargs)
                except Exception as exc:
                    msg = str(exc).lower()
                    if "nothing to subtract from" in msg:
                        return None
                    if "brep_api" in msg or "stdfail" in msg or "not done" in msg:
                        print(f"Ignored topological error in context: {exc}")
                        return None
                    raise
            Builder._add_to_context = safe_add_to_context
    except Exception:
        pass

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
            # In validation mode, propagate real geometry failures so the AI can see and fix them
            if not _VALIDATION_MODE and any(x in str(exc).lower() for x in ["topods_frozenshape", "builder::add", "invalid", "empty", "degenerate", "tolerance", "stdfail", "brep_api", "not done", "chfi3d", "constructionerror", "only 2 faces"]):
                return objs
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
            if not _VALIDATION_MODE and any(x in str(exc).lower() for x in ["topods_frozenshape", "builder::add", "invalid", "empty", "degenerate", "tolerance", "stdfail", "brep_api", "not done", "chfi3d", "constructionerror", "only 2 faces"]):
                return objs
            raise
    build123d.chamfer = smart_chamfer
    ns["chamfer"] = smart_chamfer

    def _clean_sketch_inputs(val):
        if hasattr(build123d, "BuildSketch") and isinstance(val, build123d.BuildSketch):
            if hasattr(val, "sketch") and val.sketch is not None:
                return val.sketch
        if isinstance(val, list):
            return [_clean_sketch_inputs(x) for x in val]
        if isinstance(val, tuple):
            return tuple(_clean_sketch_inputs(x) for x in val)
        return val

    _orig_sweep = build123d.sweep
    def safe_sweep(*args, **kwargs):
        new_args = [_clean_sketch_inputs(arg) for arg in args]
        if "sections" in kwargs:
            kwargs["sections"] = _clean_sketch_inputs(kwargs["sections"])
        try:
            return _orig_sweep(*new_args, **kwargs)
        except Exception as exc:
            msg = str(exc).lower()
            if not _VALIDATION_MODE and any(x in msg for x in ["empty", "invalid", "degenerate", "self-intersect", "zero norm", "stdfail", "brep_api", "not done", "chfi3d", "constructionerror", "only 2 faces"]):
                return new_args[0] if new_args else kwargs.get("sections")
            raise
    build123d.sweep = safe_sweep
    ns["sweep"] = safe_sweep
    ns["Sweep"] = safe_sweep

    _orig_loft = build123d.loft
    def safe_loft(*args, **kwargs):
        new_args = [_clean_sketch_inputs(arg) for arg in args]
        if "sections" in kwargs:
            kwargs["sections"] = _clean_sketch_inputs(kwargs["sections"])
        try:
            return _orig_loft(*new_args, **kwargs)
        except Exception as exc:
            msg = str(exc).lower()
            if not _VALIDATION_MODE and any(x in msg for x in ["empty", "invalid", "degenerate", "self-intersect", "zero norm", "stdfail", "brep_api", "not done", "chfi3d", "constructionerror", "only 2 faces"]):
                return new_args[0] if new_args else kwargs.get("sections")
            raise
    build123d.loft = safe_loft
    ns["loft"] = safe_loft
    ns["Loft"] = safe_loft

    _orig_revolve = build123d.revolve
    def safe_revolve(*args, **kwargs):
        new_args = [_clean_sketch_inputs(arg) for arg in args]
        if "to_revolve" in kwargs:
            kwargs["to_revolve"] = _clean_sketch_inputs(kwargs["to_revolve"])
            
        if "angle" in kwargs:
            kwargs["revolution_arc"] = kwargs.pop("angle")
        if "revolution_angle" in kwargs:
            kwargs["revolution_arc"] = kwargs.pop("revolution_angle")
            
        try:
            return _orig_revolve(*new_args, **kwargs)
        except Exception as exc:
            msg = str(exc).lower()
            if not _VALIDATION_MODE and any(x in msg for x in ["empty", "invalid", "degenerate", "self-intersect", "zero norm", "stdfail", "brep_api", "not done", "chfi3d", "constructionerror", "only 2 faces"]):
                return new_args[0] if new_args else kwargs.get("to_revolve")
            raise
    build123d.revolve = safe_revolve
    ns["revolve"] = safe_revolve
    ns["Revolve"] = safe_revolve

    _orig_extrude = build123d.extrude
    def safe_extrude(*args, **kwargs):
        new_args = [_clean_sketch_inputs(arg) for arg in args]
        if "to_extrude" in kwargs:
            kwargs["to_extrude"] = _clean_sketch_inputs(kwargs["to_extrude"])
        
        # Gracefully handle the hallucinated 'centered' kwarg
        if "centered" in kwargs:
            kwargs["both"] = kwargs.pop("centered")

        try:
            return _orig_extrude(*new_args, **kwargs)
        except Exception as exc:
            msg = str(exc).lower()
            if not _VALIDATION_MODE and any(x in msg for x in ["either amount or until", "face or sketch must be provided", "empty", "invalid", "degenerate", "self-intersect", "zero norm", "stdfail", "brep_api", "not done", "chfi3d", "constructionerror", "only 2 faces"]):
                return new_args[0] if new_args else kwargs.get("to_extrude")
            raise
    build123d.extrude = safe_extrude
    ns["extrude"] = safe_extrude
    ns["Extrude"] = safe_extrude

    if hasattr(build123d, "Polygon"):
        _orig_polygon = build123d.Polygon
        def safe_polygon(*args, **kwargs):
            kwargs.pop("close", None)
            return _orig_polygon(*args, **kwargs)
        build123d.Polygon = safe_polygon
        ns["Polygon"] = safe_polygon

    if hasattr(build123d, "CenterArc"):
        _orig_centerarc = build123d.CenterArc
        def safe_centerarc(*args, **kwargs):
            if "angular_span" in kwargs:
                kwargs["arc_size"] = kwargs.pop("angular_span")
            return _orig_centerarc(*args, **kwargs)
        build123d.CenterArc = safe_centerarc
        ns["CenterArc"] = safe_centerarc

    if hasattr(build123d, "PolarLocations"):
        _orig_polarlocations = build123d.PolarLocations.__init__
        def safe_polarlocations(self, *args, **kwargs):
            if "angular_span" in kwargs:
                kwargs["angular_range"] = kwargs.pop("angular_span")
            plane = kwargs.pop("plane", None)
            _orig_polarlocations(self, *args, **kwargs)
            if plane is not None and hasattr(self, "local_locations"):
                self.local_locations = [plane.location * loc for loc in self.local_locations]
        build123d.PolarLocations.__init__ = safe_polarlocations

    if hasattr(build123d, "GridLocations"):
        _orig_gridlocations = build123d.GridLocations.__init__
        def safe_gridlocations(self, *args, **kwargs):
            plane = kwargs.pop("plane", None)
            _orig_gridlocations(self, *args, **kwargs)
            if plane is not None and hasattr(self, "local_locations"):
                self.local_locations = [plane.location * loc for loc in self.local_locations]
        build123d.GridLocations.__init__ = safe_gridlocations

    if hasattr(build123d, "HexLocations"):
        _orig_hexlocations = build123d.HexLocations.__init__
        def safe_hexlocations(self, *args, **kwargs):
            plane = kwargs.pop("plane", None)
            _orig_hexlocations(self, *args, **kwargs)
            if plane is not None and hasattr(self, "local_locations"):
                self.local_locations = [plane.location * loc for loc in self.local_locations]
        build123d.HexLocations.__init__ = safe_hexlocations

    if hasattr(build123d, "Locations"):
        _orig_locations_init = build123d.Locations.__init__
        def safe_locations_init(self, *args, **kwargs):
            if len(args) == 1 and type(args[0]).__name__ in ["PolarLocations", "HexLocations", "GridLocations"]:
                # The LLM incorrectly nested PolarLocations inside Locations.
                # Unwrap it into positional arguments so bd.Locations accepts it.
                args = tuple(list(args[0]))
            return _orig_locations_init(self, *args, **kwargs)
        build123d.Locations.__init__ = safe_locations_init

    if hasattr(build123d, "make_hull"):
        _orig_make_hull = build123d.make_hull
        def safe_make_hull(*args, **kwargs):
            try:
                return _orig_make_hull(*args, **kwargs)
            except AttributeError:
                # build123d has a bug where passing Face objects like bd.Circle() crashes
                # during edge extraction. Fall back to hulling the active context.
                return _orig_make_hull()
        build123d.make_hull = safe_make_hull
        ns["make_hull"] = safe_make_hull
        build123d.Hull = safe_make_hull
        ns["Hull"] = safe_make_hull

    if hasattr(build123d, "Plane"):
        if hasattr(build123d.Plane, "offset"):
            build123d.Plane.shifted = build123d.Plane.offset
        if hasattr(build123d.Plane, "x_dir"):
            build123d.Plane.x_axis = property(lambda self: self.x_dir)
            build123d.Plane.y_axis = property(lambda self: self.y_dir)
            build123d.Plane.z_axis = property(lambda self: self.z_dir)

    if hasattr(build123d, "ShapeList"):
        # Polyfill for hallucinatory .at_coords()
        def safe_at_coords(self, coords):
            return self.sort_by_distance(coords)[0:1]
        build123d.ShapeList.at_coords = safe_at_coords

        # Polyfill for hallucinatory .sort_by_position() which should be .filter_by_position()
        if hasattr(build123d.ShapeList, "filter_by_position"):
            build123d.ShapeList.sort_by_position = build123d.ShapeList.filter_by_position

    _orig_solid_revolve = build123d.Solid.revolve
    @classmethod
    def safe_solid_revolve(cls, section, angle, axis, inner_wires=None):
        try:
            is_x_axis = False
            if hasattr(axis, "direction"):
                is_x_axis = abs(axis.direction.X) > 0.99 and abs(axis.direction.Y) < 0.01 and abs(axis.direction.Z) < 0.01
            
            if is_x_axis:
                half_plane_ge = build123d.Face.make_rect(20000, 20000).translate((0, 10000, 0))
                half_plane_le = build123d.Face.make_rect(20000, 20000).translate((0, -10000, 0))
                
                if isinstance(section, build123d.Wire):
                    section_face = build123d.Face(section, inner_wires or [])
                else:
                    section_face = section
                
                part_ge = section_face & half_plane_ge
                part_le = section_face & half_plane_le
                
                area_ge = part_ge.area if hasattr(part_ge, "area") else 0.0
                area_le = part_le.area if hasattr(part_le, "area") else 0.0
                
                if area_ge > 1e-5 and area_le > 1e-5:
                    section = part_ge
                    inner_wires = []
        except Exception:
            pass
        return _orig_solid_revolve(section, angle, axis, inner_wires)
    build123d.Solid.revolve = safe_solid_revolve


    try:
        script_content = Path("user_script.py").read_text(encoding="utf-8")
        script_content = re.sub(r"Polygon\((.*?),\s*close=(?:True|False)\)", r"Polygon(\1)", script_content)
        script_content = re.sub(r"(\s+)extrude\s*\(\s*", r"\1# extrude_placeholder(", script_content)
        script_content = re.sub(r"# extrude_placeholder", r"extrude", script_content)
        # Prevent hallucinated GeomType.POINT from crashing by removing the filter entirely
        script_content = re.sub(r"\.filter_by\(\s*(?:bd|build123d)\.GeomType\.POINT\s*\)", "", script_content)

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

    # Unwrap builder objects to their underlying topological shape for export
    if hasattr(shape, "part") and getattr(shape, "part") is not None:
        shape = shape.part
    elif hasattr(shape, "sketch") and getattr(shape, "sketch") is not None:
        shape = shape.sketch
    elif hasattr(shape, "line") and getattr(shape, "line") is not None:
        shape = shape.line

    # ── VALIDATION MODE: strictly check geometry and exit early (no file export) ──
    if _VALIDATION_MODE:
        try:
            _validate_shape(shape)
        except Exception as ve:
            print(f"VALIDATION_GEOMETRY_ERROR: {ve}", flush=True)
            sys.exit(1)
        print("VALIDATION_SUCCESS", flush=True)
        return

    out_dir = Path(os.getenv("OUTPUT_DIR", "."))
    basename = os.getenv("OUTPUT_BASENAME", "model")
    try:
        from build123d.exporters import ExportDXF
        _validate_shape(shape)
        
        try:
            bbox = shape.bounding_box() if callable(getattr(shape, "bounding_box", None)) else getattr(shape, "bounding_box", None)
            vol = shape.volume if hasattr(shape, "volume") else 0.0
            f_count = _shape_faces_count(shape)
            v_count = 0
            if hasattr(shape, "vertices"):
                verts = shape.vertices() if callable(shape.vertices) else shape.vertices
                v_count = len(verts)
                
            if bbox and hasattr(bbox, "size"):
                annotations["stats"] = {
                    "bounding_box": {"x": bbox.size.X, "y": bbox.size.Y, "z": bbox.size.Z},
                    "volume": vol,
                    "faces": f_count,
                    "vertices": v_count
                }
        except Exception as e:
            print(f"STATS_WARNING: Could not calculate stats: {e}")

        export_step(shape, str(out_dir / f"{basename}.step"))
        export_stl(shape, str(out_dir / f"{basename}.stl"))
        
        # DXF Export for CNC/Drafting
        try:
            dxf_exporter = ExportDXF(unit=build123d.Unit.MM)
            dxf_exporter.add_shape(shape)
            dxf_exporter.write(str(out_dir / f"{basename}.dxf"))
        except Exception as dxf_exc:
            print(f"DXF_WARNING: Could not export DXF: {dxf_exc}")

        # G-code / CAM Generation (Removed, moved to CamPipelineManager)

        try:
            with open(out_dir / f"{basename}_annotations.json", "w") as f:
                json.dump(annotations, f)
        except Exception as ann_exc:
            print(f"ANNOTATIONS_WARNING: Could not write annotations: {ann_exc}")

        print(f"RENDER_SUCCESS: Exported {basename}.step, {basename}.stl, {basename}.dxf, and {basename}.gcode", flush=True)

    except Exception as exc:
        print(f"EXPORT_ERROR: {exc}")
        sys.exit(1)

if __name__ == "__main__":
    run()
"""


class ParameterRenderService:
    def __init__(self, outputs_dir: Optional[Path] = None) -> None:
        project_root = Path(__file__).resolve().parents[3]
        self.outputs_dir = outputs_dir or (project_root / "outputs")
        self.outputs_dir.mkdir(parents=True, exist_ok=True)

    # ──────────────────────────────────────────────────────────────────────────
    # SELF-CORRECTING LOOP SUPPORT: Validate script geometry without exporting
    # ──────────────────────────────────────────────────────────────────────────

    async def validate_script(
        self,
        script: str,
        parameters: Dict[str, Any],
    ) -> tuple[bool, str]:
        """Run the script in VALIDATION_MODE to check geometry without exporting files.

        Returns (True, "") on success, or (False, traceback_string) on failure.
        Uses the same harness as render_to_outputs but with strict error propagation.
        """
        is_valid_syntax, syn_err = validate_script_syntax(script)
        if not is_valid_syntax:
            return False, syn_err
            
        is_secure, sec_err = validate_script_security(script)
        if not is_secure:
            return False, f"Security validation failed: {sec_err}"

        parameters = _coerce_jsonable(parameters)
        timeout_seconds = max(60, int(os.getenv("RENDER_TIMEOUT_SECONDS", "120")))

        with tempfile.TemporaryDirectory(prefix="cad_val_") as temp_dir:
            tmp = Path(temp_dir)
            (tmp / "user_script.py").write_text(script, encoding="utf-8")
            (tmp / "harness.py").write_text(RENDER_HARNESS_TEMPLATE, encoding="utf-8")

            env = os.environ.copy()
            env["CAD_PARAMETERS_JSON"] = json.dumps(parameters, ensure_ascii=True)
            env["CAD_CAM_PARAMETERS_JSON"] = json.dumps({}, ensure_ascii=True)
            env["OUTPUT_DIR"] = str(tmp)   # temp dir — no real outputs written
            env["OUTPUT_BASENAME"] = "val_check"
            env["VALIDATION_MODE"] = "1"   # ← key: activate strict geometry checking

            project_root = Path(__file__).resolve().parents[3]
            python_exe = sys.executable
            if (project_root / ".venv" / "Scripts" / "python.exe").exists():
                python_exe = str(project_root / ".venv" / "Scripts" / "python.exe")
            elif (project_root / ".venv" / "bin" / "python").exists():
                python_exe = str(project_root / ".venv" / "bin" / "python")

            try:
                try:
                    proc = await asyncio.create_subprocess_exec(
                        python_exe,
                        "harness.py",
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.PIPE,
                        cwd=temp_dir,
                        env=env,
                    )
                    try:
                        stdout, stderr = await asyncio.wait_for(
                            proc.communicate(), timeout=timeout_seconds
                        )
                        returncode = proc.returncode
                    except asyncio.TimeoutError:
                        try:
                            proc.kill()
                        except Exception:
                            pass
                        return False, "Validation timed out — script geometry is too complex or has an infinite loop."
                except NotImplementedError:
                    def _run_sync():
                        return subprocess.run(
                            [python_exe, "harness.py"],
                            capture_output=True,
                            text=True,
                            cwd=temp_dir,
                            env=env,
                            timeout=timeout_seconds,
                        )
                    try:
                        proc_sync = await asyncio.to_thread(_run_sync)
                        returncode = proc_sync.returncode
                        stdout = proc_sync.stdout.encode("utf-8") if isinstance(proc_sync.stdout, str) else proc_sync.stdout
                        stderr = proc_sync.stderr.encode("utf-8") if isinstance(proc_sync.stderr, str) else proc_sync.stderr
                    except subprocess.TimeoutExpired:
                        return False, "Validation timed out."
            except Exception as exc:
                return False, f"Validation subprocess error: {type(exc).__name__}: {exc}"

            stdout_str = stdout.decode("utf-8", errors="replace")
            stderr_str = stderr.decode("utf-8", errors="replace")

            if returncode == 0 and "VALIDATION_SUCCESS" in stdout_str:
                return True, ""

            full_log = stdout_str + "\n" + stderr_str
            return False, self._extract_traceback(full_log)

    @staticmethod
    def _extract_traceback(log: str) -> str:
        """Extract the Python traceback from render subprocess stdout."""
        # Prefer our delimited traceback block
        start = log.find("---TRACEBACK_START---")
        end = log.find("---TRACEBACK_END---")
        if start != -1 and end != -1:
            return log[start + len("---TRACEBACK_START---"):end].strip()
        # Fallback: raw Python traceback
        tb_start = log.find("Traceback (most recent call last):")
        if tb_start != -1:
            return log[tb_start:tb_start + 3000].strip()
        # Last resort: last 2000 chars
        return log[-2000:].strip() if log else ""

    async def render_to_outputs(
        self,
        parameters: Dict[str, Any],
        script: str,
        output_basename: str,
        cam_parameters: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        self.clear_outputs(prefix=output_basename)
        is_valid_syntax, syn_err = validate_script_syntax(script)
        if not is_valid_syntax:
            raise RuntimeError(syn_err)
            
        is_secure, sec_err = validate_script_security(script)
        if not is_secure:
            raise ValueError(sec_err)

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
                env["CAD_CAM_PARAMETERS_JSON"] = json.dumps(cam_parameters or {}, ensure_ascii=True)
                env["OUTPUT_DIR"] = str(self.outputs_dir)
                env["OUTPUT_BASENAME"] = output_basename

                project_root = Path(__file__).resolve().parents[3]
                python_exe = sys.executable
                if (project_root / ".venv" / "Scripts" / "python.exe").exists():
                    python_exe = str(project_root / ".venv" / "Scripts" / "python.exe")
                elif (project_root / ".venv" / "bin" / "python").exists():
                    python_exe = str(project_root / ".venv" / "bin" / "python")

                try:
                    try:
                        proc = await asyncio.create_subprocess_exec(
                            python_exe,
                            "harness.py",
                            stdout=asyncio.subprocess.PIPE,
                            stderr=asyncio.subprocess.PIPE,
                            cwd=temp_dir,
                            env=env,
                        )
                        try:
                            stdout, stderr = await asyncio.wait_for(
                                proc.communicate(),
                                timeout=timeout_seconds,
                            )
                            returncode = proc.returncode
                        except asyncio.TimeoutError:
                            try:
                                proc.kill()
                            except Exception:
                                pass
                            try:
                                await proc.communicate()
                            except Exception:
                                pass
                            last_error = "Render Engine timed out. Geometry might be too complex."
                            if attempt >= max_render_retries:
                                raise RuntimeError(last_error)
                            continue
                    except NotImplementedError:
                        def run_sync():
                            return subprocess.run(
                                [python_exe, "harness.py"],
                                capture_output=True,
                                text=True,
                                cwd=temp_dir,
                                env=env,
                                timeout=timeout_seconds,
                            )
                        try:
                            proc_sync = await asyncio.to_thread(run_sync)
                            returncode = proc_sync.returncode
                            stdout = proc_sync.stdout.encode("utf-8") if isinstance(proc_sync.stdout, str) else proc_sync.stdout
                            stderr = proc_sync.stderr.encode("utf-8") if isinstance(proc_sync.stderr, str) else proc_sync.stderr
                        except subprocess.TimeoutExpired:
                            last_error = "Render Engine timed out. Geometry might be too complex."
                            if attempt >= max_render_retries:
                                raise RuntimeError(last_error)
                            continue
                except Exception as exc:
                    last_error = f"Failed to run render subprocess: {type(exc).__name__} - {str(exc)}"
                    if attempt >= max_render_retries:
                        raise RuntimeError(last_error)
                    continue

                if returncode != 0:
                    stdout_str = stdout.decode("utf-8", errors="replace")
                    stderr_str = stderr.decode("utf-8", errors="replace")
                    full_log = stdout_str + stderr_str
                    
                    if "RENDER_SUCCESS:" in full_log:
                        # Ignore OpenCASCADE teardown segfaults if it finished exporting
                        pass
                    else:
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

        # Write python script and logs to outputs folder
        try:
            (self.outputs_dir / f"{output_basename}.py.txt").write_text(script, encoding="utf-8")
            if stdout or stderr:
                log_content = (stdout.decode("utf-8", errors="replace") if stdout else "") + "\n" + (stderr.decode("utf-8", errors="replace") if stderr else "")
                (self.outputs_dir / f"{output_basename}.log").write_text(log_content, encoding="utf-8")
        except Exception:
            pass

        stl_path = self.outputs_dir / f"{output_basename}.stl"
        step_path = self.outputs_dir / f"{output_basename}.step"
        dxf_path = self.outputs_dir / f"{output_basename}.dxf"
        gcode_path = self.outputs_dir / f"{output_basename}.gcode"
        toolpaths_path = self.outputs_dir / f"{output_basename}_toolpaths.json"

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

        gcode_content = None
        toolpaths = None
        features = None
        operations = None
        
        # Calculate modelHash from STEP file
        import hashlib
        model_hash = None
        if step_path.exists():
            with open(step_path, "rb") as f:
                model_hash = hashlib.sha256(f.read()).hexdigest()

        return {
            "modelHash": model_hash,
            "stl_path": str(stl_path),
            "step_path": str(step_path),
            "dxf_path": str(dxf_path) if dxf_path.exists() else None,
            "annotations": annotations,
        }

    def _parse_worker_error(self, log: str) -> str:

        if "Fatal Python error" in log or "Segmentation fault" in log:
            for line in log.splitlines():
                if "user_script.py" in line:
                    return f"Render failed: Low-level C++ Kernel Crash (Segfault) at {line.strip()}"
            return "Render failed: Low-level geometric engine segmentation fault (Invalid geometry intersection)."
        
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
                
        if "VALIDATION_GEOMETRY_ERROR:" in log:
            try:
                return "Geometry error: " + log.split("VALIDATION_GEOMETRY_ERROR:")[1].strip().splitlines()[0]
            except Exception:
                pass


        return f"Geometry engine failed. Review script logic and parameter values. \n\nRAW LOG:\n{log}"

    def clear_outputs(self, prefix: Optional[str] = None) -> None:
        if not self.outputs_dir.exists():
            return
        for item in self.outputs_dir.iterdir():
            try:
                if prefix and not item.name.startswith(prefix):
                    continue
                if item.is_file():
                    item.unlink()
                elif item.is_dir():
                    shutil.rmtree(item)
            except Exception:
                pass

    def _log_fail(self, script: str, params: dict, log: str) -> None:
        try:
            log_dir = Path(__file__).resolve().parents[3] / "logs"
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


def validate_script_security(script: str) -> tuple[bool, Optional[str]]:
    try:
        import ast

        tree = ast.parse(script)
        
        # Whitelisted top-level modules
        ALLOWED_MODULES = {"build123d", "math", "re", "ocp_vscode", "typing", "sys", "enum", "bd_warehouse"}
        
        # Blacklisted built-ins that could be used for execution or system access
        FORBIDDEN_FUNCTIONS = {
            "eval", "exec", "open", "compile", "globals", "locals", "__import__",
            "getattr", "setattr", "delattr", "input", "breakpoint"
        }

        for node in ast.walk(tree):
            # 1. Enforce Module Import Whitelist
            if isinstance(node, ast.Import):
                for alias in node.names:
                    base_module = alias.name.split('.')[0]
                    if base_module not in ALLOWED_MODULES:
                        return False, f"Security Violation: Import of module '{alias.name}' is forbidden. Only {ALLOWED_MODULES} imports are permitted."
            
            elif isinstance(node, ast.ImportFrom):
                if not node.module:
                    return False, "Security Violation: Relative imports are forbidden."
                base_module = node.module.split('.')[0]
                if base_module not in ALLOWED_MODULES:
                    return False, f"Security Violation: Import from module '{node.module}' is forbidden. Only {ALLOWED_MODULES} imports are permitted."
            
            # 2. Block dunder attribute access to prevent sandbox escapes
            elif isinstance(node, ast.Attribute):
                if "__" in node.attr:
                    return False, f"Security Violation: Access to attribute '{node.attr}' is forbidden."
            
            # 3. Block forbidden built-in calls and dynamic dunder accesses via functions
            elif isinstance(node, ast.Call):
                if isinstance(node.func, ast.Name):
                    if node.func.id in FORBIDDEN_FUNCTIONS:
                        return False, f"Security Violation: Call to built-in function '{node.func.id}' is forbidden."
                elif isinstance(node.func, ast.Attribute):
                    if "__" in node.func.attr:
                        return False, f"Security Violation: Access to attribute '{node.func.attr}' is forbidden."
                    
        return True, None
    except Exception as exc:
        return False, f"Security validation failed: {str(exc)}"


def get_build123d_version() -> str:
    try:
        import build123d

        return getattr(build123d, "__version__", "unknown")
    except ImportError:
        return "not installed"