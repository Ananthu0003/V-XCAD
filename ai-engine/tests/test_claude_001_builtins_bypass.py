"""Tests for CLAUDE-001 / VEX-001: __builtins__ dict subscript bypass.

This test suite verifies that the two-layer fix for the AST sandbox bypass
works correctly:

Layer 1 (AST validator): validate_script_security() now catches:
  - ast.Name nodes for dangerous identifiers (__builtins__, open, etc.)
  - ast.Subscript with dangerous string constant keys ("open", "__import__", etc.)

Layer 2 (Restricted builtins): The harness template injects a restricted
  builtins mapping into ns["__builtins__"] before exec(script_content, ns),
  so that even if AST validation is bypassed, dangerous builtins are unavailable.

The original vulnerability:
  __builtins__["open"]("/etc/hostname")
  __builtins__["__import__"]("os")
Both passed the old AST validator (which only checked ast.Attribute + ast.Subscript
on ast.Attribute targets) and executed successfully because exec() auto-injects
the full builtins dict into the namespace.
"""
import os
import sys
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.llm.parameter_render import (
    validate_script_security,
    _build_sandbox_env,
    RESTRICTED_BUILTINS,
)


# ---------------------------------------------------------------------------
# 1. AST Validator: ast.Name checks (CLAUDE-001)
# ---------------------------------------------------------------------------

class TestClaude001_ASTNameChecks:
    """Verify that dangerous bare identifiers are blocked as ast.Name nodes."""

    def test_bare_builtins_blocked(self):
        script = "x = __builtins__"
        ok, err = validate_script_security(script)
        assert not ok, "__builtins__ as bare name must be blocked"
        assert "identifier" in err.lower() or "builtins" in err.lower()

    def test_bare_open_blocked(self):
        script = "f = open"
        ok, err = validate_script_security(script)
        assert not ok, "bare 'open' must be blocked"
        assert "open" in err.lower()

    def test_bare_import_blocked(self):
        script = "f = __import__"
        ok, err = validate_script_security(script)
        assert not ok, "bare '__import__' must be blocked"

    def test_bare_eval_blocked(self):
        script = "x = eval"
        ok, err = validate_script_security(script)
        assert not ok, "bare 'eval' must be blocked"

    def test_bare_exec_blocked(self):
        script = "x = exec"
        ok, err = validate_script_security(script)
        assert not ok, "bare 'exec' must be blocked"

    def test_bare_getattr_blocked(self):
        script = "x = getattr"
        ok, err = validate_script_security(script)
        assert not ok, "bare 'getattr' must be blocked"

    def test_bare_setattr_blocked(self):
        script = "x = setattr"
        ok, err = validate_script_security(script)
        assert not ok, "bare 'setattr' must be blocked"

    def test_bare_delattr_blocked(self):
        script = "x = delattr"
        ok, err = validate_script_security(script)
        assert not ok, "bare 'delattr' must be blocked"

    def test_bare_input_blocked(self):
        script = "x = input"
        ok, err = validate_script_security(script)
        assert not ok, "bare 'input' must be blocked"

    def test_bare_compile_blocked(self):
        script = "x = compile"
        ok, err = validate_script_security(script)
        assert not ok, "bare 'compile' must be blocked"

    def test_bare_globals_blocked(self):
        script = "x = globals"
        ok, err = validate_script_security(script)
        assert not ok, "bare 'globals' must be blocked"

    def test_bare_locals_blocked(self):
        script = "x = locals"
        ok, err = validate_script_security(script)
        assert not ok, "bare 'locals' must be blocked"

    def test_bare_exit_blocked(self):
        script = "x = exit"
        ok, err = validate_script_security(script)
        assert not ok, "bare 'exit' must be blocked"

    def test_bare_quit_blocked(self):
        script = "x = quit"
        ok, err = validate_script_security(script)
        assert not ok, "bare 'quit' must be blocked"

    def test_bare_breakpoint_blocked(self):
        script = "x = breakpoint"
        ok, err = validate_script_security(script)
        assert not ok, "bare 'breakpoint' must be blocked"

    def test_bare_help_blocked(self):
        script = "x = help"
        ok, err = validate_script_security(script)
        assert not ok, "bare 'help' must be blocked"


# ---------------------------------------------------------------------------
# 2. AST Validator: ast.Subscript string key checks (CLAUDE-001)
# ---------------------------------------------------------------------------

class TestClaude001_ASTSubscriptKeyChecks:
    """Verify that subscript with dangerous string constant keys are blocked."""

    def test_dict_subscript_open(self):
        """The original CLAUDE-001 bypass vector."""
        script = '__builtins__["open"]("/etc/hostname")'
        ok, err = validate_script_security(script)
        assert not ok, "dict subscript 'open' must be blocked"
        assert "subscript" in err.lower()

    def test_dict_subscript_import(self):
        script = '__builtins__["__import__"]("os")'
        ok, err = validate_script_security(script)
        assert not ok, "dict subscript '__import__' must be blocked"

    def test_dict_subscript_eval(self):
        script = '__builtins__["eval"]("1+1")'
        ok, err = validate_script_security(script)
        assert not ok, "dict subscript 'eval' must be blocked"

    def test_dict_subscript_exec(self):
        script = '__builtins__["exec"]("pass")'
        ok, err = validate_script_security(script)
        assert not ok, "dict subscript 'exec' must be blocked"

    def test_dict_subscript_compile(self):
        script = '__builtins__["compile"]("1", "x", "eval")'
        ok, err = validate_script_security(script)
        assert not ok, "dict subscript 'compile' must be blocked"

    def test_dict_subscript_environ(self):
        """Catches os.environ['SECRET'] via dict subscript."""
        script = 'x = {"environ": 1}'
        ok, err = validate_script_security(script)
        # environ as a dict key is harmless — only blocked as ast.Attribute target
        # This test documents that dict literals are allowed (false positives = good)
        assert ok, "harmless dict literal with 'environ' key should be allowed"

    def test_dict_subscript_system(self):
        script = 'x = {"system": 1}'
        ok, err = validate_script_security(script)
        assert ok, "harmless dict literal with 'system' key should be allowed"

    def test_subscript_on_non_attribute(self):
        """obj["open"] where obj is a Name, not Attribute — should be caught."""
        script = 'x["open"]("cmd")'
        ok, err = validate_script_security(script)
        assert not ok, "subscript 'open' on any target must be blocked"

    def test_subscript_on_attribute_open(self):
        """ns["open"] — subscript on an attribute node."""
        script = 'ns["open"]("file")'
        ok, err = validate_script_security(script)
        assert not ok, "subscript 'open' on attribute must be blocked"


# ---------------------------------------------------------------------------
# 3. Restricted Builtins: Runtime enforcement
# ---------------------------------------------------------------------------

class TestClaude001_RestrictedBuiltins:
    """Verify that RESTRICTED_BUILTINS is restricted to safe builtins only."""

    def test_restricted_builtins_exists(self):
        """The RESTRICTED_BUILTINS constant must exist in parameter_render."""
        assert isinstance(RESTRICTED_BUILTINS, dict)

    def test_restricted_builtins_missing_open(self):
        """open must not be in restricted builtins."""
        assert "open" not in RESTRICTED_BUILTINS

    def test_restricted_builtins_import_is_the_guarded_importer(self):
        """The real __import__ must never be in restricted builtins; only the guard."""
        import builtins
        guard = RESTRICTED_BUILTINS["__import__"]
        assert guard is not builtins.__import__
        assert guard.__name__ == "_guarded_import"

    def test_restricted_builtins_missing_eval(self):
        assert "eval" not in RESTRICTED_BUILTINS

    def test_restricted_builtins_missing_exec(self):
        assert "exec" not in RESTRICTED_BUILTINS

    def test_restricted_builtins_missing_compile(self):
        assert "compile" not in RESTRICTED_BUILTINS

    def test_restricted_builtins_missing_globals(self):
        assert "globals" not in RESTRICTED_BUILTINS

    def test_restricted_builtins_missing_locals(self):
        assert "locals" not in RESTRICTED_BUILTINS

    def test_restricted_builtins_missing_getattr(self):
        assert "getattr" not in RESTRICTED_BUILTINS

    def test_restricted_builtins_missing_setattr(self):
        assert "setattr" not in RESTRICTED_BUILTINS

    def test_restricted_builtins_missing_input(self):
        assert "input" not in RESTRICTED_BUILTINS

    def test_restricted_builtins_missing_breakpoint(self):
        assert "breakpoint" not in RESTRICTED_BUILTINS

    def test_restricted_builtins_has_safe_builtins(self):
        """Essential safe builtins for CAD scripts must be present."""
        required = [
            "int", "float", "str", "bool", "len", "range", "min", "max",
            "abs", "sum", "round", "pow", "print", "isinstance", "type",
            "list", "tuple", "dict", "set", "enumerate", "zip", "map",
            "filter", "sorted", "reversed", "iter", "next", "hasattr",
            "__name__", "True", "False", "None",
        ]
        missing = [k for k in required if k not in RESTRICTED_BUILTINS]
        assert not missing, f"Safe builtins missing from restricted set: {missing}"

    def test_restricted_builtins_has_build_class(self):
        """__build_class__ is needed by build123d class definitions."""
        assert "__build_class__" in RESTRICTED_BUILTINS

    def test_restricted_builtins_has_exceptions(self):
        """Exception classes must be available for try/except."""
        for exc in ["Exception", "TypeError", "ValueError", "KeyError",
                     "IndexError", "AttributeError", "RuntimeError",
                     "StopIteration", "ZeroDivisionError", "ImportError",
                     "OSError", "MemoryError"]:
            assert exc in RESTRICTED_BUILTINS, f"Exception '{exc}' must be in restricted builtins"


# ---------------------------------------------------------------------------
# 4. Harness template: ns["__builtins__"] is set before user script exec
# ---------------------------------------------------------------------------

class TestClaude001_HarnessTemplate:
    """Verify that the harness template enforces restricted builtins."""

    def test_harness_sets_restricted_builtins(self):
        """The harness template must contain the ns[__builtins__] = _RESTRICTED_BUILTINS line."""
        from app.services.llm import parameter_render
        harness = parameter_render.RENDER_HARNESS_TEMPLATE
        assert "ns[\"__builtins__\"] = _RESTRICTED_BUILTINS" in harness, \
            "Harness template must inject restricted builtins before exec(script)"

    def test_harness_imports_builtins(self):
        """The harness template must import builtins."""
        from app.services.llm import parameter_render
        harness = parameter_render.RENDER_HARNESS_TEMPLATE
        assert "import builtins as _builtins_mod" in harness, \
            "Harness template must import builtins"

    def test_harness_defines_restricted_builtins(self):
        """The harness template must define _RESTRICTED_BUILTINS."""
        from app.services.llm import parameter_render
        harness = parameter_render.RENDER_HARNESS_TEMPLATE
        assert "_RESTRICTED_BUILTINS = {" in harness, \
            "Harness template must define _RESTRICTED_BUILTINS dict"

    def test_harness_restricted_builtins_excludes_open(self):
        """The restricted builtins dict in the harness must not include 'open'."""
        from app.services.llm import parameter_render
        harness = parameter_render.RENDER_HARNESS_TEMPLATE
        # Find the _RESTRICTED_BUILTINS block
        start = harness.find("_RESTRICTED_BUILTINS = {")
        end = harness.find("}", start) + 1
        restricted_block = harness[start:end]
        assert '"open"' not in restricted_block, \
            "Restricted builtins must not include 'open'"
        assert '"__import__": _guarded_import' in restricted_block, \
            "Restricted builtins must map '__import__' to the guarded importer"
        assert "_builtins_mod.__import__" not in restricted_block, \
            "Restricted builtins must not include the real '__import__'"
        assert '"eval"' not in restricted_block, \
            "Restricted builtins must not include 'eval'"
        assert '"exec"' not in restricted_block, \
            "Restricted builtins must not include 'exec'"

    def test_harness_restricted_builtins_includes_safe(self):
        """The restricted builtins dict must include safe builtins."""
        from app.services.llm import parameter_render
        harness = parameter_render.RENDER_HARNESS_TEMPLATE
        start = harness.find("_RESTRICTED_BUILTINS = {")
        end = harness.find("}", start) + 1
        restricted_block = harness[start:end]
        for builtin in ["int", "float", "str", "bool", "len", "range",
                         "min", "max", "print", "__build_class__"]:
            assert f'"{builtin}"' in restricted_block, \
                f"Restricted builtins must include '{builtin}'"


# ---------------------------------------------------------------------------
# 5. End-to-end: Subprocess execution with restricted builtins
# ---------------------------------------------------------------------------

class TestClaude001_EndToEnd:
    """Verify that restricted builtins block exploitation at runtime."""

    @pytest.fixture
    def sandbox_env(self):
        return _build_sandbox_env("test_session", "test_job", {})

    def test_builtins_dict_subscript_fails_at_runtime(self):
        """__builtins__["open"] must fail at runtime with restricted builtins."""
        ns = {"__builtins__": RESTRICTED_BUILTINS, "PARAMETERS": {}, "__name__": "__main__"}
        try:
            exec('__builtins__["open"]("/etc/hostname")', ns)
            # If we get here, it's a problem — but the KeyError means it's safe
            # (dict doesn't have "open" key)
            assert False, "Should have raised KeyError"
        except KeyError:
            pass  # Expected — "open" not in restricted builtins dict

    def test_builtins_import_subscript_fails(self):
        """__builtins__["__import__"]("os") must fail: the entry is the guard, not the real importer."""
        ns = {"__builtins__": RESTRICTED_BUILTINS, "PARAMETERS": {}, "__name__": "__main__"}
        with pytest.raises(ImportError):
            exec('__builtins__["__import__"]("os")', ns)

    def test_builtins_eval_subscript_fails(self):
        """__builtins__["eval"] must fail with restricted builtins."""
        ns = {"__builtins__": RESTRICTED_BUILTINS, "PARAMETERS": {}, "__name__": "__main__"}
        try:
            exec('__builtins__["eval"]("1+1")', ns)
            assert False, "Should have raised KeyError"
        except KeyError:
            pass

    def test_safe_builtins_still_work(self):
        """Safe builtins (int, float, min, max, range) must still work."""
        ns = {"__builtins__": RESTRICTED_BUILTINS, "PARAMETERS": {}, "__name__": "__main__"}
        exec('x = int(42) + float(3.14) + min(1, 2) + max(3, 4)', ns)
        assert ns["x"] == 42 + 3.14 + 1 + 4

    def test_range_and_loop_still_work(self):
        ns = {"__builtins__": RESTRICTED_BUILTINS, "PARAMETERS": {}, "__name__": "__main__"}
        exec('total = 0\nfor i in range(5):\n    total += i', ns)
        assert ns["total"] == 10

    def test_list_operations_still_work(self):
        ns = {"__builtins__": RESTRICTED_BUILTINS, "PARAMETERS": {}, "__name__": "__main__"}
        exec('edges = [3, 1, 4, 1, 5]\nn = len(edges)\ns = sorted(edges)', ns)
        assert ns["n"] == 5
        assert ns["s"] == [1, 1, 3, 4, 5]

    def test_try_except_still_works(self):
        ns = {"__builtins__": RESTRICTED_BUILTINS, "PARAMETERS": {}, "__name__": "__main__"}
        exec('result = "ok"\ntry:\n    x = 1/0\nexcept ZeroDivisionError:\n    result = "caught"', ns)
        assert ns["result"] == "caught"

    def test_indirect_open_fails(self):
        """Assigning open to a variable then calling it must fail at runtime."""
        ns = {"__builtins__": RESTRICTED_BUILTINS, "PARAMETERS": {}, "__name__": "__main__"}
        with pytest.raises((NameError, KeyError)):
            exec('f = open\nf("/etc/hostname")', ns)

    def test_indirect_import_fails(self):
        ns = {"__builtins__": RESTRICTED_BUILTINS, "PARAMETERS": {}, "__name__": "__main__"}
        with pytest.raises(ImportError):
            exec('imp = __import__\nimp("os")', ns)


# ---------------------------------------------------------------------------
# 6. Object-graph escape paths — AST rejection
# ---------------------------------------------------------------------------

class TestClaude001_ObjectGraphEscapes:
    """Verify that dunder attribute object-graph escape paths are blocked by AST.

    These paths reach dangerous functionality (os, sys, subprocess) through
    __globals__ on build123d functions or through object.__subclasses__().
    The AST validator blocks them via FORBIDDEN_ATTR_SUBSTRINGS = ("__",).
    """

    def test_object_subclasses(self):
        ok, err = validate_script_security("object.__subclasses__()")
        assert not ok, "object.__subclasses__() must be blocked"

    def test_object_subclasses_indexed(self):
        ok, _ = validate_script_security("object.__subclasses__()[0]")
        assert not ok

    def test_object_class(self):
        ok, _ = validate_script_security("object.__class__")
        assert not ok

    def test_object_mro(self):
        ok, _ = validate_script_security("object.__mro__")
        assert not ok

    def test_object_bases(self):
        ok, _ = validate_script_security("object.__bases__")
        assert not ok

    def test_import_brep_globals(self):
        ok, _ = validate_script_security("import_brep.__globals__")
        assert not ok

    def test_import_step_globals(self):
        ok, _ = validate_script_security("import_step.__globals__")
        assert not ok

    def test_any_object_globals(self):
        ok, _ = validate_script_security("x.__globals__")
        assert not ok

    def test_any_object_init(self):
        ok, _ = validate_script_security("x.__init__")
        assert not ok

    def test_any_object_code(self):
        ok, _ = validate_script_security("x.__code__")
        assert not ok

    def test_any_object_closure(self):
        ok, _ = validate_script_security("x.__closure__")
        assert not ok

    def test_any_object_func(self):
        ok, _ = validate_script_security("x.__func__")
        assert not ok

    def test_any_object_self(self):
        ok, _ = validate_script_security("x.__self__")
        assert not ok

    def test_any_object_traceback(self):
        ok, _ = validate_script_security("x.__traceback__")
        assert not ok

    def test_any_object_frame(self):
        ok, _ = validate_script_security("x.__frame__")
        assert not ok

    def test_any_object_builtins(self):
        ok, _ = validate_script_security("x.__builtins__")
        assert not ok

    def test_any_object_import_attr(self):
        ok, _ = validate_script_security("x.__import__")
        assert not ok

    def test_full_escape_chain(self):
        script = 'object.__subclasses__()[0].__init__.__globals__["os"].system("id")'
        ok, _ = validate_script_security(script)
        assert not ok

    def test_globals_os_subscript(self):
        ok, _ = validate_script_security('x.__globals__["os"]')
        assert not ok

    def test_globals_sys_subscript(self):
        ok, _ = validate_script_security('x.__globals__["sys"]')
        assert not ok


# ---------------------------------------------------------------------------
# 7. Runtime boundary — dynamic builtin key attacks fail safely
# ---------------------------------------------------------------------------

class TestClaude001_RuntimeDynamicKeyAttacks:
    """Verify that dynamic subscript key attacks fail at runtime.

    These attacks pass AST validation (non-constant key), but the restricted
    builtins dict raises KeyError/NameError, proving the runtime boundary
    independently prevents exploitation.
    """

    def test_dynamic_key_open_fails(self):
        ns = {"__builtins__": RESTRICTED_BUILTINS, "key": "open"}
        with pytest.raises(KeyError):
            exec('__builtins__[key]', ns)

    def test_dynamic_key_import_yields_only_the_guard(self):
        """A dynamic '__import__' lookup finds the guard; using it on os still fails."""
        ns = {"__builtins__": RESTRICTED_BUILTINS, "key": "__import__"}
        with pytest.raises(ImportError):
            exec('__builtins__[key]("os")', ns)

    def test_dynamic_key_eval_fails(self):
        ns = {"__builtins__": RESTRICTED_BUILTINS, "key": "eval"}
        with pytest.raises(KeyError):
            exec('__builtins__[key]', ns)

    def test_dynamic_key_exec_fails(self):
        ns = {"__builtins__": RESTRICTED_BUILTINS, "key": "exec"}
        with pytest.raises(KeyError):
            exec('__builtins__[key]', ns)

    def test_from_build123d_import_os_fails(self):
        """AST allows 'from build123d import os' (whitelisted), but the runtime
        guard hands out a facade without it (or, if build123d is absent, fails)."""
        ns = {"__builtins__": RESTRICTED_BUILTINS, "__name__": "__main__"}
        with pytest.raises(ImportError):
            exec('from build123d import os', ns)

    def test_getattr_unavailable(self):
        ns = {"__builtins__": RESTRICTED_BUILTINS}
        with pytest.raises(NameError):
            exec('x = getattr', ns)

    def test_vars_unavailable(self):
        ns = {"__builtins__": RESTRICTED_BUILTINS}
        with pytest.raises(NameError):
            exec('x = vars', ns)

    def test_globals_unavailable(self):
        ns = {"__builtins__": RESTRICTED_BUILTINS}
        with pytest.raises(NameError):
            exec('x = globals', ns)

    def test_locals_unavailable(self):
        ns = {"__builtins__": RESTRICTED_BUILTINS}
        with pytest.raises(NameError):
            exec('x = locals', ns)


# ---------------------------------------------------------------------------
# 8. Legitimate CAD syntax validation — must remain allowed
# ---------------------------------------------------------------------------

class TestClaude001_LegitimateCADAccess:
    """Verify that normal build123d / CAD patterns pass validation.

    The object-graph restrictions must NOT break legitimate CAD generation.
    """

    def test_box_creation(self):
        ok, _ = validate_script_security("Box(10, 20, 30)")
        assert ok

    def test_cylinder_creation(self):
        ok, _ = validate_script_security("Cylinder(5, 20)")
        assert ok

    def test_edges_method(self):
        ok, _ = validate_script_security("part.edges()")
        assert ok

    def test_faces_method(self):
        ok, _ = validate_script_security("part.faces()")
        assert ok

    def test_export_stl(self):
        ok, _ = validate_script_security('export_stl(part, "out.stl")')
        assert ok

    def test_fillet_call(self):
        ok, _ = validate_script_security("fillet(edges, 1.0)")
        assert ok

    def test_chamfer_call(self):
        ok, _ = validate_script_security("chamfer(edges, 0.5)")
        assert ok

    def test_build_part_context(self):
        ok, _ = validate_script_security("with BuildPart() as p: pass")
        assert ok

    def test_parameter_access(self):
        ok, _ = validate_script_security('x = float(PARAMETERS["length"])')
        assert ok

    def test_math_usage(self):
        ok, _ = validate_script_security("v = math.sqrt(x)")
        assert ok


# ===========================================================================
# 9. Guarded __import__ — legitimate CAD imports WITHOUT unrestricted imports
# ===========================================================================
#
# Regression: 3c5298e removed __import__ from the runtime builtins while the code
# generation contract (prompt + _normalize_script) still emits `import build123d as bd`,
# so every /render failed with "ImportError: __import__ not found" and auto-heal could
# never converge.  The harness now installs a guarded importer that only ever returns
# curated, module-free facades.  These tests run the REAL harness (subprocess) so they
# prove behaviour at runtime, not just in the static validator.
#
# Backends: "stub" is a minimal build123d stand-in that reproduces the real package's
# namespace leaks (os / sys / ctypes / Path / a submodule / a raw-OCP-style class outside
# __all__); it needs no CAD kernel.  "real" uses the installed build123d and is skipped
# when it is not installed (e.g. plain host venv; it runs inside the ai-engine image).
# bd_warehouse is not a project dependency, so both backends use a tiny stand-in for it.

import ast
import asyncio
import builtins
import importlib.util
import inspect
import subprocess
import tempfile
import types
from pathlib import Path

from app.services.llm import parameter_render as _pr
from app.services.llm.llm_codegen import LLMCodegenService, SYSTEM_INSTRUCTION
from app.services.llm.parameter_render import (
    ParameterRenderService,
    validate_script_syntax,
)

_STUB_BUILD123D = {
    "build123d/geometry.py": "import os\n\n\nclass Vector:\n    def __init__(self, *a):\n        self.X = self.Y = self.Z = 0.0\n",
    "build123d/__init__.py": '''\
import ctypes
import json
import os
import sys
from pathlib import Path

from . import geometry
from .geometry import Vector


def _noop(*a, **k):
    return None


class _Lenient(type):
    """Class attributes the harness monkeypatches (revolve, fillet, ...) resolve to no-ops."""

    def __getattr__(cls, name):
        if name.startswith("__"):
            raise AttributeError(name)
        return _noop


class STEPControl_Reader:  # raw-OCP-style helper: imported by build123d, not in __all__
    pass


class _Size:
    X = Y = Z = 10.0


class _Box3:
    size = _Size()


class Part(metaclass=_Lenient):
    is_valid = True

    def solids(self):
        return [self]

    def faces(self):
        return [self, self]

    def bounding_box(self):
        return _Box3()


class BuildPart:
    def __init__(self, *a, **k):
        self.part = Part()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class Location(metaclass=_Lenient):
    def __init__(self, *a, **k):
        pass


class ShapeList(list):
    pass


def Box(*a, **k):
    return Part()


Rectangle = Square = Box
chamfer = fillet = extrude = revolve = loft = sweep = export_step = export_stl = _noop
Locations = GridLocations = PolarLocations = Rotation = Plane = Axis = Location
Solid = Face = Edge = Shape = Part


class GeomType:
    CIRCLE = "CIRCLE"
    CYLINDER = "CYLINDER"


class Unit:
    MM = "MM"


# Filesystem-capable API the real build123d publishes in __all__.
import_step = import_stl = import_brep = import_svg = import_svg_as_buildline_code = _noop
export_brep = export_gltf = _noop


class Mesher:
    pass


class Export2D:
    pass


class ExportDXF(Export2D):
    pass


class ExportSVG(Export2D):
    pass


__all__ = [
    "BuildPart", "Box", "Vector", "Rectangle", "Square", "chamfer", "fillet", "Locations",
    "Location", "Rotation", "Axis", "Plane", "GeomType", "Part", "Solid", "Face", "Edge",
    "ShapeList", "export_step", "export_stl", "extrude", "revolve", "loft", "sweep",
    "GridLocations", "PolarLocations", "Unit",
    "import_step", "import_stl", "import_brep", "import_svg", "import_svg_as_buildline_code",
    "export_brep", "export_gltf", "Mesher", "Export2D", "ExportDXF", "ExportSVG",
]
''',
}

_STUB_BD_WAREHOUSE = {
    "bd_warehouse/__init__.py": "import os\n",
    "bd_warehouse/thread.py": "import os\n\n\nclass IsoThread:\n    def __init__(self, *a, **k):\n        pass\n\n\nclass AcmeThread:\n    pass\n",
}

_REAL_BUILD123D = importlib.util.find_spec("build123d") is not None
_HEAD = "import build123d as bd\n"
_BODY = "with bd.BuildPart() as part:\n    bd.Box(10, 10, 10)\n"


def _write_tree(root: Path, files: dict) -> None:
    for rel, text in files.items():
        target = root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")


@pytest.fixture(scope="module", params=["stub", "real"])
def pythonpath(request, tmp_path_factory):
    """PYTHONPATH for the harness subprocess for each build123d backend."""
    if request.param == "real" and not _REAL_BUILD123D:
        pytest.skip("real build123d is not installed in this environment")
    root = tmp_path_factory.mktemp(f"cad_{request.param}")
    # The stand-in bd_warehouse is only needed where the real package can't be used: with the
    # stub kernel (the real package needs the real build123d) or when it is not installed.
    if request.param == "stub" or importlib.util.find_spec("bd_warehouse") is None:
        _write_tree(root, _STUB_BD_WAREHOUSE)
    if request.param == "stub":
        _write_tree(root, _STUB_BUILD123D)
    return os.pathsep.join(filter(None, [str(root), os.environ.get("PYTHONPATH", "")]))


def _run_harness(script: str, pythonpath: str) -> tuple[bool, str]:
    """Run the REAL harness on `script`, bypassing the static validator (runtime layer only)."""
    with tempfile.TemporaryDirectory(prefix="guard_test_") as tmp:
        tmp_path = Path(tmp)
        (tmp_path / "user_script.py").write_text(script, encoding="utf-8")
        (tmp_path / "harness.py").write_text(_pr.RENDER_HARNESS_TEMPLATE, encoding="utf-8")
        env = _build_sandbox_env(extra={
            "CAD_PARAMETERS_JSON": "{}",
            "CAD_CAM_PARAMETERS_JSON": "{}",
            "OUTPUT_DIR": tmp,
            "OUTPUT_BASENAME": "guard_test",
            "VALIDATION_MODE": "1",
            "PYTHONPATH": pythonpath,
        })
        proc = subprocess.run(
            [sys.executable, "harness.py"],
            cwd=tmp, env=env, capture_output=True, text=True, timeout=180,
        )
    out = proc.stdout + proc.stderr
    return proc.returncode == 0 and "VALIDATION_SUCCESS" in out, out


def _validate_full(script: str, pythonpath: str, monkeypatch, tmp_path) -> tuple[bool, str]:
    """The production path: syntax check -> security check -> real harness subprocess."""
    monkeypatch.setenv("PYTHONPATH", pythonpath)
    monkeypatch.chdir(tmp_path)  # validate_script writes ./logs on failure
    svc = ParameterRenderService(outputs_dir=tmp_path / "outputs")
    return asyncio.run(svc.validate_script(script, {}))


# --- 9a. Legitimate imports execute through the real harness ---------------------------

class TestGuardedImport_LegitimateScriptsRun:
    @pytest.mark.parametrize("label,script", [
        ("import build123d as bd + Box", _HEAD + _BODY),
        ("from build123d import *", "from build123d import *\nwith BuildPart() as part:\n    Box(10, 10, 10)\n"),
        ("import math", _HEAD + "import math\nradius = math.sqrt(4.0) + math.pi\n" + _BODY),
        ("bd_warehouse IsoThread", _HEAD + "from bd_warehouse.thread import IsoThread\nthread_cls = IsoThread\n" + _BODY),
        ("ocp_vscode try/except", _HEAD + _BODY + "try:\n    from ocp_vscode import show\n    show(part)\nexcept ImportError:\n    pass\n"),
        ("import re / typing", _HEAD + "import re\nfrom typing import Optional\nn: Optional[str] = re.sub('a', 'b', 'aaa')\n" + _BODY),
        ("hallucinated bd.cut polyfill still resolves", _HEAD + _BODY + "helper = bd.cut\n"),
    ])
    def test_full_pipeline(self, label, script, pythonpath, monkeypatch, tmp_path):
        ok, msg = _validate_full(script, pythonpath, monkeypatch, tmp_path)
        assert ok, f"{label}: {msg}"

    def test_normalized_template_style_script(self, pythonpath, monkeypatch, tmp_path):
        raw = (
            "```python\n" + _HEAD + "import math\n\nPARAMETERS = {\"size\": 10.0}\n\n"
            + _BODY + "\nif __name__ == '__main__':\n    try:\n        from ocp_vscode import show\n"
            "        show(part)\n    except ImportError:\n        pass\n```"
        )
        script = LLMCodegenService._normalize_script(raw)
        assert "__name__" not in script
        ok, msg = _validate_full(script, pythonpath, monkeypatch, tmp_path)
        assert ok, msg

    def test_normalizer_injected_import_executes(self, pythonpath, monkeypatch, tmp_path):
        """_normalize_script prepends `import build123d as bd` when the model forgot it."""
        script = LLMCodegenService._normalize_script("```python\n" + _BODY + "```")
        assert script.startswith("import build123d as bd")
        ok, msg = _validate_full(script, pythonpath, monkeypatch, tmp_path)
        assert ok, msg


# --- 9b. Everything else stays blocked AT RUNTIME (static validator bypassed) -----------

_RUNTIME_BLOCKED = [
    # (label, script body after the standard import, expected error text)
    ("import os", "import os\n", "ImportError: this import is not permitted"),
    ("import sys", "import sys\n", "ImportError: this import is not permitted"),
    ("import subprocess", "import subprocess\n", "ImportError: this import is not permitted"),
    ("import ctypes", "import ctypes\n", "ImportError: this import is not permitted"),
    ("from build123d import os", "from build123d import os\n", "cannot import name 'os'"),
    ("from build123d import Path", "from build123d import Path\n", "cannot import name 'Path'"),
    # build123d.geometry is a REAL loaded submodule: CPython's `from pkg import x` falls
    # back to sys.modules['pkg.x'] when pkg has no attribute x, unless pkg has no __name__.
    ("from build123d import geometry", "from build123d import geometry\n", "cannot import name 'geometry'"),
    ("bd.os", "x = bd.os\n", "AttributeError"),
    ("bd.Path", "x = bd.Path\n", "AttributeError"),
    ("bd.ctypes", "x = bd.ctypes\n", "AttributeError"),
    ("bd.sys", "x = bd.sys\n", "AttributeError"),
    ("bd.geometry", "x = bd.geometry\n", "AttributeError"),
    ("import build123d.geometry", "import build123d.geometry\n", "ImportError: this import is not permitted"),
    ("import build123d.geometry as g", "import build123d.geometry as g\n", "ImportError: this import is not permitted"),
    ("from build123d.geometry import Vector", "from build123d.geometry import Vector\n", "ImportError: this import is not permitted"),
    ("__import__('os')", "x = __import__('os')\n", "ImportError: this import is not permitted"),
    ("__import__('build123d.geometry')", "x = __import__('build123d.geometry')\n", "ImportError: this import is not permitted"),
    ("relative import", "from . import x\n", "ImportError: relative imports are not permitted"),
    ("relative import of an approved name", "from .build123d import Box\n", "ImportError: relative imports are not permitted"),
    ("dotted bd_warehouse without from", "import bd_warehouse.thread\n", "ImportError: this import is not permitted"),
    ("bd_warehouse top level", "from bd_warehouse import thread\n", "ImportError: this import is not permitted"),
    ("other bd_warehouse.thread names", "from bd_warehouse.thread import AcmeThread\n", "ImportError: this import is not permitted"),
    ("star import of bd_warehouse.thread", "from bd_warehouse.thread import *\n", "ImportError: this import is not permitted"),
    ("typing.ForwardRef (eval gadget)", "import typing\nx = typing.ForwardRef\n", "AttributeError"),
    ("typing.get_type_hints (eval gadget)", "import typing\nx = typing.get_type_hints\n", "AttributeError"),
    ("re.enum module leak", "import re\nx = re.enum\n", "AttributeError"),
    ("facade is read-only", "bd.Box = 1\n", "AttributeError: sandbox API objects are read-only"),
    # Pre-existing bare-name leak: the harness used to bind dir(build123d) into the script
    # namespace, handing generated code os/sys/ctypes/Path/raw OCP classes without any import.
    ("bare os", "x = os.getcwd()\n", "NameError"),
    ("bare sys", "x = sys.version\n", "NameError"),
    ("bare ctypes", "x = ctypes.CDLL\n", "NameError"),
    ("bare Path", "x = Path('/etc/hostname').read_text()\n", "NameError"),
    ("bare raw-OCP-style class outside __all__", "x = STEPControl_Reader\n", "NameError"),
    # Filesystem-capable build123d API: unreachable through the facade AND the bare namespace.
    ("bd.import_step", "x = bd.import_step\n", "AttributeError"),
    ("bd.import_stl", "x = bd.import_stl\n", "AttributeError"),
    ("bd.import_brep", "x = bd.import_brep\n", "AttributeError"),
    ("bd.import_svg", "x = bd.import_svg\n", "AttributeError"),
    ("bd.import_svg_as_buildline_code", "x = bd.import_svg_as_buildline_code\n", "AttributeError"),
    ("bd.export_step", "x = bd.export_step\n", "AttributeError"),
    ("bd.export_stl", "x = bd.export_stl\n", "AttributeError"),
    ("bd.export_brep", "x = bd.export_brep\n", "AttributeError"),
    ("bd.export_gltf", "x = bd.export_gltf\n", "AttributeError"),
    ("bd.Mesher", "x = bd.Mesher\n", "AttributeError"),
    ("bd.Export2D", "x = bd.Export2D\n", "AttributeError"),
    ("bd.ExportDXF", "x = bd.ExportDXF\n", "AttributeError"),
    ("bd.ExportSVG", "x = bd.ExportSVG\n", "AttributeError"),
    ("from build123d import import_step", "from build123d import import_step\n", "cannot import name 'import_step'"),
    ("from build123d import export_step", "from build123d import export_step\n", "cannot import name 'export_step'"),
    ("from build123d import Mesher", "from build123d import Mesher\n", "cannot import name 'Mesher'"),
    ("from build123d import ExportDXF", "from build123d import ExportDXF\n", "cannot import name 'ExportDXF'"),
    ("bare import_step", "x = import_step\n", "NameError"),
    ("bare import_stl", "x = import_stl\n", "NameError"),
    ("bare import_brep", "x = import_brep\n", "NameError"),
    ("bare import_svg", "x = import_svg\n", "NameError"),
    ("bare import_svg_as_buildline_code", "x = import_svg_as_buildline_code\n", "NameError"),
    ("bare export_step", "x = export_step\n", "NameError"),
    ("bare export_stl", "x = export_stl\n", "NameError"),
    ("bare export_brep", "x = export_brep\n", "NameError"),
    ("bare export_gltf", "x = export_gltf\n", "NameError"),
    ("bare Mesher", "x = Mesher\n", "NameError"),
    ("bare Export2D", "x = Export2D\n", "NameError"),
    ("bare ExportDXF", "x = ExportDXF\n", "NameError"),
    ("bare ExportSVG", "x = ExportSVG\n", "NameError"),
]


class TestGuardedImport_RuntimeBoundary:
    @pytest.mark.parametrize("label,body,expected", _RUNTIME_BLOCKED, ids=[c[0] for c in _RUNTIME_BLOCKED])
    def test_blocked_by_the_real_harness(self, label, body, expected, pythonpath):
        ok, out = _run_harness(_HEAD + body + _BODY, pythonpath)
        assert not ok, f"{label} must not execute successfully"
        assert "---TRACEBACK_START---" in out, out
        assert expected in out, f"{label}: expected {expected!r} in harness output:\n{out}"

    @pytest.mark.parametrize("script", [
        "import os\n", "import sys\n", "import subprocess\n", "import ctypes\n",
        "x = __import__('os')\n", "from . import x\n",
    ])
    def test_still_rejected_by_the_static_validator_too(self, script):
        """Defense in depth: the static layer is unchanged and independently blocks these."""
        ok, _ = validate_script_security(_HEAD + script + _BODY)
        assert not ok

    def test_full_pipeline_rejects_bd_os_statically(self, pythonpath, monkeypatch, tmp_path):
        ok, msg = _validate_full(_HEAD + "x = bd.os\n" + _BODY, pythonpath, monkeypatch, tmp_path)
        assert not ok and "Security" in msg


# --- 9c. Structure / contract ----------------------------------------------------------

def _template_builtins_keys() -> set:
    tree = ast.parse(_pr.RENDER_HARNESS_TEMPLATE)
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and any(
            isinstance(t, ast.Name) and t.id == "_RESTRICTED_BUILTINS" for t in node.targets
        ):
            return {k.value for k in node.value.keys}
    raise AssertionError("_RESTRICTED_BUILTINS not found in harness template")


def _fresh_guard(real_import):
    """Instantiate the guard source with an injected (spy) trusted importer."""
    ns = {"_real_import": real_import}
    exec(_pr._GUARDED_IMPORT_SOURCE, ns)
    return ns


class _SpyImporter:
    """Stands in for the trusted importer; returns fake modules and records every call."""

    def __init__(self):
        self.calls = []

    def __call__(self, name, globals=None, locals=None, fromlist=(), level=0):
        self.calls.append((name, tuple(fromlist or ()), level))
        if name == "build123d":
            mod = types.ModuleType("build123d")
            mod.Box = lambda *a, **k: None
            mod.Path = Path                     # public non-__all__ leak
            mod.os = os                         # module leak
            mod.geometry_alias = types.ModuleType("build123d.geometry")  # module in __all__
            mod._private = 1
            mod.__all__ = ["Box", "geometry_alias", "_private", "missing_name"]
            return mod
        if name == "bd_warehouse.thread":
            mod = types.ModuleType("bd_warehouse.thread")
            mod.IsoThread = type("IsoThread", (), {})
            mod.AcmeThread = type("AcmeThread", (), {})
            return mod
        return __import__(name, globals, locals, fromlist, level)


class TestGuardedImport_Structure:
    def test_module_level_and_harness_builtins_have_identical_keys(self):
        assert _template_builtins_keys() == set(RESTRICTED_BUILTINS)

    def test_both_copies_use_the_guard_for_import(self):
        assert "__import__" in _template_builtins_keys()
        assert RESTRICTED_BUILTINS["__import__"].__name__ == "_guarded_import"

    def test_harness_embeds_the_exact_shared_guard_source(self):
        assert repr(_pr._GUARDED_IMPORT_SOURCE) in _pr.RENDER_HARNESS_TEMPLATE
        assert "__GUARDED_IMPORT_SOURCE_LITERAL__" not in _pr.RENDER_HARNESS_TEMPLATE

    def test_guard_is_the_only_import_capability(self):
        guard = RESTRICTED_BUILTINS["__import__"]
        assert guard is not builtins.__import__
        # The importer's own globals hold no os/sys/importlib/pathlib handles.
        assert not {"os", "sys", "importlib", "pathlib", "subprocess", "ctypes"} & set(guard.__globals__)
        assert "importlib" not in _pr._GUARDED_IMPORT_SOURCE
        assert "importlib" not in _pr.RENDER_HARNESS_TEMPLATE
        for forbidden in ("open", "eval", "exec", "compile", "getattr", "globals", "vars"):
            assert forbidden not in RESTRICTED_BUILTINS

    def test_real_importer_never_called_for_unapproved_names(self):
        spy = _SpyImporter()
        guard = _fresh_guard(spy)["_guarded_import"]
        for name, kwargs in [
            ("os", {}), ("sys", {}), ("subprocess", {}), ("ctypes", {}), ("importlib", {}),
            ("pathlib", {}), ("socket", {}), ("shutil", {}), ("build123d.geometry", {}),
            ("build123d.geometry", {"fromlist": ("Vector",)}), ("bd_warehouse", {}),
            ("bd_warehouse.thread", {}),                                   # dotted, no from-list
            ("bd_warehouse.thread", {"fromlist": ("AcmeThread",)}),
            ("bd_warehouse.thread", {"fromlist": ("IsoThread", "AcmeThread")}),
            ("bd_warehouse.thread", {"fromlist": ("*",)}),
            ("bd_warehouse.thread.extra", {"fromlist": ("IsoThread",)}),
            ("build123d", {"level": 1}), ("", {}), ("..", {"level": 2}),
        ]:
            with pytest.raises(ImportError):
                guard(name, **kwargs)
        for weird in (b"os", None, 1, ("os",), object()):
            with pytest.raises(ImportError):
                guard(weird)

        class Impostor(str):
            def __eq__(self, other):
                return True

            def __hash__(self):
                return hash("build123d")

        with pytest.raises(ImportError):
            guard(Impostor("os"))
        assert spy.calls == []

    def test_real_importer_only_sees_fixed_table_names(self):
        spy = _SpyImporter()
        guard = _fresh_guard(spy)["_guarded_import"]
        guard("build123d")
        guard("math")
        guard("re")
        guard("typing")
        guard("ocp_vscode")
        guard("bd_warehouse.thread", fromlist=("IsoThread",))
        assert {c[0] for c in spy.calls} == {"build123d", "math", "re", "typing", "bd_warehouse.thread"}
        assert all(c[2] == 0 for c in spy.calls)

    def test_facade_exposes_only_declared_non_module_names(self):
        guard = _fresh_guard(_SpyImporter())["_guarded_import"]
        facade = guard("build123d")
        assert facade.__all__ == ("Box",)            # no os/Path/_private/module/missing name
        assert not hasattr(facade, "os") and not hasattr(facade, "Path")
        assert not hasattr(facade, "geometry_alias") and not hasattr(facade, "_private")
        for name in facade.__all__:
            assert not isinstance(getattr(facade, name), types.ModuleType)

    def test_facade_is_not_a_module_and_is_read_only(self):
        facade = _fresh_guard(_SpyImporter())["_guarded_import"]("build123d")
        assert not isinstance(facade, types.ModuleType)
        assert not hasattr(facade, "__name__")       # blocks the sys.modules import-from fallback
        with pytest.raises(AttributeError):
            facade.Box = None
        with pytest.raises(AttributeError):
            del facade.Box

    @pytest.mark.parametrize("name", ["math", "re", "typing"])
    def test_stdlib_facades_contain_no_module_typed_attributes(self, name):
        facade = _fresh_guard(__import__)["_guarded_import"](name)
        leaked = [k for k, v in vars(facade).items() if isinstance(v, types.ModuleType)]
        assert leaked == []
        assert facade.__all__

    def test_typing_facade_has_no_eval_gadgets(self):
        facade = _fresh_guard(__import__)["_guarded_import"]("typing")
        for gadget in ("ForwardRef", "get_type_hints", "evaluate_forward_ref", "sys", "re", "collections"):
            assert not hasattr(facade, gadget)

    def test_ocp_vscode_facade_is_inert(self):
        spy = _SpyImporter()
        facade = _fresh_guard(spy)["_guarded_import"]("ocp_vscode")
        assert facade.show("anything") is None
        assert spy.calls == []                       # the real package (and its socket) is never touched

    def test_runtime_facades_cover_every_statically_allowed_module(self):
        """Static policy and runtime policy must not drift: whatever the validator lets
        through as an import must be resolvable by the guard (and vice versa)."""
        guard = _fresh_guard(_SpyImporter())["_guarded_import"]
        for stmt in ("import build123d", "import math", "import re", "import typing",
                     "import ocp_vscode", "from bd_warehouse.thread import IsoThread"):
            ok, err = validate_script_security(stmt + "\n")
            assert ok, err
        for name in ("build123d", "math", "re", "typing", "ocp_vscode"):
            guard(name)
        guard("bd_warehouse.thread", fromlist=("IsoThread",))
        for name in _fresh_guard(_SpyImporter())["_FACADE_BUILDERS"]:
            ok, err = validate_script_security(f"import {name}\n")
            assert ok, f"runtime facade {name!r} is not in the static allowlist: {err}"


class TestGuardedImport_GenerationContract:
    """The generation contract (prompt, normalizer) and both security layers must agree."""

    @staticmethod
    def _template_example() -> str:
        blocks = SYSTEM_INSTRUCTION.split("```python\n")
        assert len(blocks) == 2, "expected exactly one python example in the prompt template"
        return blocks[1].split("```")[0]

    def test_prompt_template_example_no_longer_uses_dunder_name(self):
        example = self._template_example()
        assert "__name__" not in example
        ok, err = validate_script_security(example)
        assert ok, err

    def test_normalized_template_passes_both_validators(self):
        normalized = LLMCodegenService._normalize_script("```python\n" + self._template_example() + "```")
        ok, err = validate_script_syntax(normalized)
        assert ok, err
        ok, err = validate_script_security(normalized)
        assert ok, err

    def test_every_import_in_the_template_is_accepted_by_the_guard(self):
        normalized = LLMCodegenService._normalize_script("```python\n" + self._template_example() + "```")
        imports = [n for n in ast.walk(ast.parse(normalized)) if isinstance(n, (ast.Import, ast.ImportFrom))]
        assert imports, "template must contain imports for this test to mean anything"
        guard = _fresh_guard(_SpyImporter())["_guarded_import"]
        module = ast.Module(body=imports, type_ignores=[])
        ast.fix_missing_locations(module)
        exec(compile(module, "<template imports>", "exec"), {"__builtins__": {"__import__": guard}})

    def test_prompt_mandated_imports_are_all_supported(self):
        """The imports the prompts tell the model to write must run through the guard."""
        guard = _fresh_guard(_SpyImporter())["_guarded_import"]
        ns = {"__builtins__": {"__import__": guard, "ImportError": ImportError}}
        exec(
            "import build123d as bd\nimport math\nfrom bd_warehouse.thread import IsoThread\n"
            "try:\n    from ocp_vscode import show\nexcept ImportError:\n    pass\n",
            ns,
        )
        assert "bd" in ns and "IsoThread" in ns and "show" in ns

    @pytest.mark.parametrize("raw,expected_absent", [
        ("```python\nimport build123d as bd\nx = 1\nif __name__ == '__main__':\n    print(x)\n```", "__name__"),
        ("import build123d as bd\nx = 1\nif __name__ == \"__main__\":\n    print(x)\n\n\ny = 2\n", "__name__"),
        ("import build123d as bd\nx = 1\nif __name__ == '__main__': print(x)\n", "__name__"),
    ])
    def test_normalizer_strips_main_guard(self, raw, expected_absent):
        out = LLMCodegenService._normalize_script(raw)
        assert expected_absent not in out
        ok, err = validate_script_security(out)
        assert ok, err

    def test_normalizer_keeps_code_after_main_guard(self):
        out = LLMCodegenService._normalize_script(
            "import build123d as bd\nif __name__ == '__main__':\n    print(1)\n\ny = 2\n"
        )
        assert "y = 2" in out and "print(1)" not in out

    def test_normalizer_leaves_nested_name_checks_alone(self):
        """Only top-level guards are removed; anything else is still caught by the validator."""
        script = "import build123d as bd\ndef f():\n    if __name__ == '__main__':\n        pass\n"
        assert LLMCodegenService._normalize_script(script) == script.strip()
        ok, _ = validate_script_security(script)
        assert not ok  # the forbidden `__name__` identifier rule is intact

    def test_dunder_name_rule_is_not_weakened(self):
        ok, msg = validate_script_security("x = __name__\n")
        assert not ok and "__name__" in msg

    @pytest.mark.skipif(not _REAL_BUILD123D, reason="needs the real build123d kernel")
    def test_prompt_template_example_renders_with_real_build123d(self, monkeypatch, tmp_path):
        normalized = LLMCodegenService._normalize_script("```python\n" + self._template_example() + "```")
        ok, msg = _validate_full(normalized, os.environ.get("PYTHONPATH", ""), monkeypatch, tmp_path)
        assert ok, msg


# ===========================================================================
# 10. build123d filesystem-capable API is unavailable to generated scripts
# ===========================================================================
#
# Generated scripts describe geometry; they must not read or write files (another session's
# STEP/STL/DXF in the shared outputs volume, any file the render user can write).  The
# harness performs its own exports from its own module-level names.  ONE deny set
# (_FILESYSTEM_API_DENY, inside the shared guard source) feeds both the `bd` facade and the
# bare-name namespace.  All file fixtures below are dummy files in pytest temp directories.

_EXPECTED_FILESYSTEM_DENY = frozenset({
    "import_step", "import_stl", "import_brep", "import_svg", "import_svg_as_buildline_code",
    "export_step", "export_stl", "export_brep", "export_gltf",
    "Mesher", "Export2D", "ExportDXF", "ExportSVG",
})

_real_only = pytest.mark.skipif(not _REAL_BUILD123D, reason="needs the real build123d kernel")
_real_thread_only = pytest.mark.skipif(
    not (_REAL_BUILD123D and importlib.util.find_spec("bd_warehouse")),
    reason="needs the real build123d kernel and the real bd_warehouse package",
)


@pytest.fixture(scope="module")
def real_pythonpath():
    """Environment PYTHONPATH untouched: real build123d, and the real bd_warehouse if installed."""
    if not _REAL_BUILD123D:
        pytest.skip("real build123d is not installed in this environment")
    return os.environ.get("PYTHONPATH", "")


def _run_harness_export(script: str, pythonpath: str) -> tuple[bool, str, dict]:
    """Run the harness in NORMAL mode (the trusted STEP/STL/DXF export path) in a temp dir."""
    with tempfile.TemporaryDirectory(prefix="guard_export_") as tmp:
        tmp_path = Path(tmp)
        (tmp_path / "user_script.py").write_text(script, encoding="utf-8")
        (tmp_path / "harness.py").write_text(_pr.RENDER_HARNESS_TEMPLATE, encoding="utf-8")
        env = _build_sandbox_env(extra={
            "CAD_PARAMETERS_JSON": "{}", "CAD_CAM_PARAMETERS_JSON": "{}",
            "OUTPUT_DIR": tmp, "OUTPUT_BASENAME": "trusted", "VALIDATION_MODE": "0",
            "PYTHONPATH": pythonpath,
        })
        proc = subprocess.run([sys.executable, "harness.py"], cwd=tmp, env=env,
                              capture_output=True, text=True, timeout=180)
        files = {p.name: p.stat().st_size for p in tmp_path.glob("trusted*")}
    return proc.returncode == 0 and "RENDER_SUCCESS" in proc.stdout, proc.stdout + proc.stderr, files


class TestFilesystemApi_CentralDenyMechanism:
    def test_deny_set_is_exactly_the_documented_filesystem_api(self):
        assert _pr._guard_ns["_FILESYSTEM_API_DENY"] == _EXPECTED_FILESYSTEM_DENY

    def test_deny_set_is_defined_once_and_shared_by_the_harness(self):
        assert _pr._GUARDED_IMPORT_SOURCE.count("_FILESYSTEM_API_DENY = frozenset(") == 1
        assert '_FILESYSTEM_API_DENY = _GUARD_NS["_FILESYSTEM_API_DENY"]' in _pr.RENDER_HARNESS_TEMPLATE
        assert "ns.pop(_denied_name, None)" in _pr.RENDER_HARNESS_TEMPLATE

    def test_facade_source_filters_the_deny_set(self):
        fake = types.ModuleType("build123d")
        for name in _EXPECTED_FILESYSTEM_DENY:
            setattr(fake, name, lambda *a, **k: None)
        fake.Box = lambda *a, **k: None
        fake.__all__ = sorted(_EXPECTED_FILESYSTEM_DENY) + ["Box"]
        values = _pr._guard_ns["_public_build123d_values"](fake)
        assert set(values) == {"Box"}

    def test_facade_all_excludes_every_filesystem_name(self):
        class Importer(_SpyImporter):
            def __call__(self, name, *a, **k):
                if name == "build123d":
                    mod = types.ModuleType("build123d")
                    for n in _EXPECTED_FILESYSTEM_DENY:
                        setattr(mod, n, lambda *a, **k: None)
                    mod.Box = lambda *a, **k: None
                    mod.__all__ = sorted(_EXPECTED_FILESYSTEM_DENY) + ["Box"]
                    return mod
                return super().__call__(name, *a, **k)

        facade = _fresh_guard(Importer())["_guarded_import"]("build123d")
        assert set(facade.__all__) == {"Box"}
        for name in _EXPECTED_FILESYSTEM_DENY:
            assert not hasattr(facade, name)

    def test_harness_keeps_its_own_export_calls_untouched(self):
        """The trusted exports use the harness module's own names, which the filter never touches."""
        template = _pr.RENDER_HARNESS_TEMPLATE
        assert "export_step(shape, str(out_dir" in template
        assert "export_stl(shape, str(out_dir" in template
        assert "from build123d.exporters import ExportDXF" in template

    def test_static_validator_is_unchanged_by_this_layer(self):
        ok, _ = validate_script_security(_HEAD + "x = bd.import_step\n" + _BODY)
        assert ok, "the runtime layer, not the AST allowlist, is what removes these names"
        ok, _ = validate_script_security(_HEAD + "x = bd.os\n" + _BODY)
        assert not ok


class TestFilesystemApi_RealKernel:
    """Needs real build123d.  Dummy files only, all inside pytest temp directories."""

    @_real_only
    def test_normal_geometry_api_still_works(self, real_pythonpath, monkeypatch, tmp_path):
        ok, msg = _validate_full(_HEAD + _BODY, real_pythonpath, monkeypatch, tmp_path)
        assert ok, msg

    @_real_only
    def test_trusted_harness_exports_step_stl_dxf(self, real_pythonpath):
        ok, out, files = _run_harness_export(_HEAD + _BODY, real_pythonpath)
        assert ok, out
        for suffix in (".step", ".stl", ".dxf"):
            assert files.get(f"trusted{suffix}", 0) > 0, f"trusted harness must still write {suffix}: {files}"

    @_real_only
    def test_generated_script_cannot_read_a_dummy_step_file(self, real_pythonpath, tmp_path):
        import build123d as bd
        dummy = tmp_path / "dummy_model.step"
        bd.export_step(bd.Box(3, 4, 5), str(dummy))     # trusted test code creating a dummy file
        assert dummy.stat().st_size > 0
        ok, out = _run_harness(_HEAD + f"solid = bd.import_step({str(dummy)!r})\n" + _BODY, real_pythonpath)
        assert not ok and "AttributeError" in out and "import_step" in out
        ok, out = _run_harness(_HEAD + f"solid = import_step({str(dummy)!r})\n" + _BODY, real_pythonpath)
        assert not ok and "NameError" in out

    @_real_only
    @pytest.mark.parametrize("call", [
        "bd.export_step(part.part, {p!r})", "bd.export_stl(part.part, {p!r})",
        "bd.export_brep(part.part, {p!r})", "bd.export_gltf(part.part, {p!r})",
        "export_step(part.part, {p!r})", "export_stl(part.part, {p!r})",
    ])
    def test_generated_script_cannot_write_a_dummy_file(self, call, real_pythonpath, tmp_path):
        target = tmp_path / "must_not_exist.out"
        ok, out = _run_harness(_HEAD + _BODY + call.format(p=str(target)) + "\n", real_pythonpath)
        assert not ok, out
        assert not target.exists()

    @_real_only
    def test_part_export_shim_is_inert(self, real_pythonpath, tmp_path):
        """The harness's hallucination shim for `part.export_step(path)` must not write files."""
        target = tmp_path / "shim_must_not_write.step"
        script = _HEAD + _BODY + f"part.part.export_step({str(target)!r})\npart.part.export_stl({str(target)!r})\n"
        ok, out = _run_harness(script, real_pythonpath)
        assert ok, out
        assert not target.exists()

    @_real_only
    @pytest.mark.parametrize("call", [
        "bd.Text('A', 5, font_path={f!r})",
        "bd.Text('A', 5, 'Arial', {f!r})",
        "bd.Compound.make_text('A', 5, font_path={f!r})",
        "bd.Compound.make_text('A', 5, 'Arial', {f!r})",       # positional: Text forwards by keyword, this doesn't
    ])
    def test_text_font_path_is_rejected_before_any_file_is_opened(self, call, real_pythonpath, tmp_path):
        font = tmp_path / "dummy_font.ttf"
        font.write_bytes(b"not a font")
        script = _HEAD + "with bd.BuildSketch():\n    " + call.format(f=str(font)) + "\n" + _BODY
        ok, out = _run_harness(script, real_pythonpath)
        assert not ok
        assert "ValueError: font_path is not permitted" in out, out

    @_real_only
    def test_text_without_font_path_still_reaches_the_original_implementation(self, real_pythonpath):
        """Plain text stays available.  (The stock ai-engine image ships no fonts, so build123d itself
        may fail to render it there; what matters is that OUR guard does not reject it.)"""
        script = _HEAD + "with bd.BuildSketch():\n    bd.Text('A', 5, font='Arial')\n" + _BODY
        ok, out = _run_harness(script, real_pythonpath)
        assert ok or "font_path is not permitted" not in out, out
        script = _HEAD + "c = bd.Compound.make_text('A', 5)\n" + _BODY
        ok, out = _run_harness(script, real_pythonpath)
        assert ok or "font_path is not permitted" not in out, out

    @_real_only
    def test_text_and_compound_stay_in_the_facade(self):
        import build123d
        values = _pr._guard_ns["_public_build123d_values"](build123d)
        assert "Text" in values and "Compound" in values and "Box" in values

    @_real_thread_only
    @pytest.mark.parametrize("external", [True, False])
    def test_real_isothread_renders_through_the_production_path(self, external, real_pythonpath, monkeypatch, tmp_path):
        """Real bd_warehouse.IsoThread, external and internal(SUBTRACT), full validate + export."""
        if external:
            body = ("with bd.BuildPart() as part:\n    bd.Cylinder(4.5, 20)\n"
                    "    IsoThread(major_diameter=10.0, pitch=1.5, length=12.0, external=True, end_finishes=('fade', 'fade'))\n")
        else:
            body = ("with bd.BuildPart() as part:\n    bd.Box(30, 30, 20)\n    bd.Hole(4.25, 20)\n"
                    "    IsoThread(major_diameter=10.0, pitch=1.5, length=12.0, external=False, "
                    "end_finishes=('fade', 'fade'), mode=bd.Mode.SUBTRACT)\n")
        script = _HEAD + "from bd_warehouse.thread import IsoThread\n" + body
        ok, msg = _validate_full(script, real_pythonpath, monkeypatch, tmp_path)
        assert ok, msg
        ok, out, files = _run_harness_export(script, real_pythonpath)
        assert ok, out
        assert all(files.get(f"trusted{s}", 0) > 0 for s in (".step", ".stl", ".dxf")), files


# --- Drift guard: a future build123d upgrade must not silently reintroduce file access -------

_PATH_TOKENS = frozenset({"path", "file", "filename", "filepath", "fname", "folder", "directory", "url", "uri"})
# `path`-style parameters must be geometric (an Edge/Wire/Curve annotation) or numeric (e.g.
# `position_on_path: float`): anything that could hold a filename (str, Path, PathLike, or an
# unannotated parameter) is flagged.  `font_path` is only
# tolerated on Text / make_text because the harness rejects a non-None font_path there (see the
# runtime tests above); make_text is inherited by every Compound subclass.


def _pathlike_params(func):
    try:
        params = inspect.signature(func).parameters.values()
    except (TypeError, ValueError):
        return []
    return [p for p in params if _PATH_TOKENS & set(p.name.lower().split("_"))]


def _cannot_carry_a_filename(param) -> bool:
    text = str(param.annotation).strip("'\"")
    if text in {"float", "int", "bool"}:
        return True
    return any(word in text for word in ("Edge", "Wire", "Curve", "Line"))



class TestFilesystemApi_DriftGuard:
    @_real_only
    def test_no_new_path_or_file_parameters_reachable_from_the_facade(self):
        import build123d
        values = _pr._guard_ns["_public_build123d_values"](build123d)
        offenders = []
        for name, obj in values.items():
            candidates = [(name, obj)]
            if inspect.isclass(obj):
                candidates = [(f"{name}.__init__", obj.__init__)] + [
                    (f"{name}.{m}", fn) for m, fn in inspect.getmembers(obj)
                    if not m.startswith("_") and callable(fn)
                ]
            for qual, fn in candidates:
                for param in _pathlike_params(fn):
                    if param.name == "font_path":
                        if qual == "Text.__init__" or qual.endswith(".make_text"):
                            continue
                    elif _cannot_carry_a_filename(param):
                        continue
                    offenders.append((qual, param.name, str(param.annotation)))
        assert not offenders, (
            "build123d exposes a new callable with a path/file-like parameter to generated scripts. "
            "Add it to _FILESYSTEM_API_DENY (or, if it is provably geometry-only, to this test's "
            f"allowances): {offenders}"
        )

    @_real_only
    def test_no_export_import_or_writer_named_api_survives_in_the_facade(self):
        import build123d
        values = _pr._guard_ns["_public_build123d_values"](build123d)
        suspicious = [
            n for n in values
            if n.lower().startswith(("import_", "export_")) or n in {"Mesher"} or n.startswith(("Export", "Import"))
        ]
        assert not suspicious, suspicious

    @_real_only
    def test_every_denied_name_really_exists_in_this_build123d(self):
        """Keeps the deny set honest: a stale name (renamed upstream) should be noticed."""
        import build123d
        missing = [n for n in _EXPECTED_FILESYSTEM_DENY if n not in build123d.__all__]
        assert not missing, f"deny-set names no longer in build123d.__all__ (renamed?): {missing}"
