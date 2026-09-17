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

    def test_restricted_builtins_missing_import(self):
        """__import__ must not be in restricted builtins."""
        assert "__import__" not in RESTRICTED_BUILTINS

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
        assert '"__import__"' not in restricted_block, \
            "Restricted builtins must not include '__import__'"
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
        """__builtins__["__import__"] must fail with restricted builtins."""
        ns = {"__builtins__": RESTRICTED_BUILTINS, "PARAMETERS": {}, "__name__": "__main__"}
        try:
            exec('__builtins__["__import__"]("os")', ns)
            assert False, "Should have raised KeyError"
        except KeyError:
            pass

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
        with pytest.raises((NameError, KeyError)):
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

    def test_dynamic_key_import_fails(self):
        ns = {"__builtins__": RESTRICTED_BUILTINS, "key": "__import__"}
        with pytest.raises(KeyError):
            exec('__builtins__[key]', ns)

    def test_dynamic_key_eval_fails(self):
        ns = {"__builtins__": RESTRICTED_BUILTINS, "key": "eval"}
        with pytest.raises(KeyError):
            exec('__builtins__[key]', ns)

    def test_dynamic_key_exec_fails(self):
        ns = {"__builtins__": RESTRICTED_BUILTINS, "key": "exec"}
        with pytest.raises(KeyError):
            exec('__builtins__[key]', ns)

    def test_from_build123d_import_os_fails(self):
        """AST allows 'from build123d import os' (whitelisted), but runtime
        has no __import__ in restricted builtins."""
        ns = {"__builtins__": RESTRICTED_BUILTINS, "__name__": "__main__"}
        with pytest.raises((ImportError, NameError)):
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
