"""Tests for VEX-2A-001: AST sandbox bypass / arbitrary code execution.

This test suite verifies:
1. The improved AST validator rejects previously-identified bypass patterns
2. The sandbox environment builder isolates secrets from subprocess execution
3. Legitimate build123d/CadQuery scripts still pass validation
4. Regression tests for the specific exploits documented in the audit
"""
import os
import sys
import pytest

# Ensure the ai-engine app is importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.llm.parameter_render import (
    validate_script_security,
    validate_script_syntax,
    _build_sandbox_env,
)


# ---------------------------------------------------------------------------
# 1. AST Validator: Previously-identified bypass patterns (MUST be rejected)
# ---------------------------------------------------------------------------

class TestVEX2A001_BypassPatterns:
    """Verify that the specific bypass patterns from the audit are now rejected."""

    def test_build123d_os_system_bypass(self):
        """Audit bypass: build123d.os.system('id') — attribute-call omission."""
        script = 'import build123d\nbuild123d.os.system("id")'
        is_secure, err = validate_script_security(script)
        assert not is_secure, "Must block build123d.os.system() bypass"
        assert "forbidden" in err.lower() or "violation" in err.lower()

    def test_typing_sys_modules_os_bypass(self):
        """Audit bypass: typing.sys.modules['os'].system('id')."""
        script = "import typing\ntyping.sys.modules['os'].system('id')"
        is_secure, err = validate_script_security(script)
        assert not is_secure, "Must block typing.sys.modules bypass"

    def test_enum_sys_modules_bypass(self):
        """Audit bypass: enum.sys.modules['os'].system('id')."""
        script = "import enum\nenum.sys.modules['os'].system('id')"
        is_secure, err = validate_script_security(script)
        assert not is_secure, "Must block enum.sys.modules bypass"

    def test_sys_module_not_in_allowlist(self):
        """sys is no longer in the allowed modules list."""
        script = "import sys"
        is_secure, err = validate_script_security(script)
        assert not is_secure, "sys import must be blocked"

    def test_enum_module_not_in_allowlist(self):
        """enum is no longer in the allowed modules list."""
        script = "import enum"
        is_secure, err = validate_script_security(script)
        assert not is_secure, "enum import must be blocked"

    def test_direct_os_import_blocked(self):
        """Direct os import should be blocked."""
        script = "import os"
        is_secure, err = validate_script_security(script)
        assert not is_secure

    def test_direct_subprocess_import_blocked(self):
        """Direct subprocess import should be blocked."""
        script = "import subprocess"
        is_secure, err = validate_script_security(script)
        assert not is_secure

    def test_dunder_class_bypass(self):
        """Type introspection bypass:().__class__.__bases__[0].__subclasses__()"""
        script = "()\
.__class__.__bases__[0].__subclasses__()"
        is_secure, err = validate_script_security(script)
        assert not is_secure, "Must block dunder attribute access"

    def test_dunder_import_bypass(self):
        """Dynamic import bypass: __import__('os')"""
        script = '__import__("os")'
        is_secure, err = validate_script_security(script)
        assert not is_secure

    def test_eval_blocked(self):
        """eval() must be blocked."""
        script = 'eval("__import__(\'os\').system(\'id\')")'
        is_secure, err = validate_script_security(script)
        assert not is_secure

    def test_exec_blocked(self):
        """exec() must be blocked."""
        script = 'exec("import os; os.system(\'id\')")'
        is_secure, err = validate_script_security(script)
        assert not is_secure

    def test_open_function_blocked(self):
        """open() must be blocked."""
        script = 'open("/etc/passwd")'
        is_secure, err = validate_script_security(script)
        assert not is_secure

    def test_compile_blocked(self):
        """compile() must be blocked."""
        script = 'compile("import os", "<string>", "exec")'
        is_secure, err = validate_script_security(script)
        assert not is_secure

    def test_getattr_blocked(self):
        """getattr() must be blocked."""
        script = 'getattr(__builtins__, "__import__")("os")'
        is_secure, err = validate_script_security(script)
        assert not is_secure

    def test_globals_blocked(self):
        """globals() must be blocked."""
        script = 'globals()["__builtins__"].__import__("os")'
        is_secure, err = validate_script_security(script)
        assert not is_secure

    def test_locals_blocked(self):
        """locals() must be blocked."""
        script = 'locals()["__builtins__"]'
        is_secure, err = validate_script_security(script)
        assert not is_secure

    def test_subscript_modules_access(self):
        """Subscript access on 'modules' attribute should be blocked."""
        script = "import typing\ntyping.sys.modules['os']"
        is_secure, err = validate_script_security(script)
        assert not is_secure

    def test_subscript_environ_access(self):
        """Subscript access on 'environ' attribute should be blocked."""
        script = "import typing\ntyping.environ['SECRET']"
        is_secure, err = validate_script_security(script)
        assert not is_secure

    def test_dunder_builtins_attribute(self):
        """__builtins__ attribute access must be blocked."""
        script = "x = __builtins__.__import__('os')"
        is_secure, err = validate_script_security(script)
        assert not is_secure

    def test_dunder_class_attribute(self):
        """__class__ attribute access must be blocked."""
        script = "type(obj).__class__"
        is_secure, err = validate_script_security(script)
        assert not is_secure

    def test_system_attribute_blocked(self):
        """'system' attribute access on any object must be blocked."""
        script = "import build123d\nbuild123d.os.system('id')"
        is_secure, err = validate_script_security(script)
        assert not is_secure

    def test_popen_attribute_blocked(self):
        """'popen' attribute access must be blocked."""
        script = "import build123d\nbuild123d.os.popen('id')"
        is_secure, err = validate_script_security(script)
        assert not is_secure

    def test_environ_attribute_blocked(self):
        """'environ' attribute access must be blocked."""
        script = "import build123d\nbuild123d.os.environ"
        is_secure, err = validate_script_security(script)
        assert not is_secure

    def test_typing_sys_attribute_blocked(self):
        """'sys' attribute on typing module must be blocked."""
        script = "import typing\ntyping.sys"
        is_secure, err = validate_script_security(script)
        assert not is_secure

    def test_import_from_dangerous_module(self):
        """from os import system must be blocked."""
        script = "from os import system"
        is_secure, err = validate_script_security(script)
        assert not is_secure

    def test_relative_import_blocked(self):
        """Relative imports must be blocked."""
        script = "from . import something"
        is_secure, err = validate_script_security(script)
        assert not is_secure

    def test_nested_dangerous_access(self):
        """Nested dangerous attribute chains must be blocked."""
        script = "import typing\ntyping.sys.modules['subprocess'].call(['id'])"
        is_secure, err = validate_script_security(script)
        assert not is_secure


# ---------------------------------------------------------------------------
# 2. AST Validator: Variant exploit patterns (should also be blocked)
# ---------------------------------------------------------------------------

class TestVEX2A001_ExploitVariants:
    """Test variants of the bypass patterns, not just the exact audit strings."""

    def test_variant_typing_sys_with_variable(self):
        """Variant: assign typing.sys to variable first."""
        script = "import typing\ns = typing.sys\ns.modules['os'].system('id')"
        is_secure, err = validate_script_security(script)
        assert not is_secure

    def test_variant_build123d_os_environ_dict(self):
        """Variant: access os.environ as dict."""
        script = "import build123d\nfor k,v in build123d.os.environ.items():\n    pass"
        is_secure, err = validate_script_security(script)
        assert not is_secure

    def test_variant_import_subprocess_via_modules(self):
        """Variant: access subprocess through sys.modules."""
        script = "import typing\ntyping.sys.modules['subprocess'].run(['id'])"
        is_secure, err = validate_script_security(script)
        assert not is_secure

    def test_variant_os_environ_get(self):
        """Variant: os.environ.get() for secret extraction."""
        script = "import build123d\nv = build123d.os.environ.get('SECRET')"
        is_secure, err = validate_script_security(script)
        assert not is_secure

    def test_variant_two_step_typing_sys(self):
        """Variant: two-step import to evade detection."""
        script = "import typing\nts = typing.sys\nv = ts.modules"
        is_secure, err = validate_script_security(script)
        # ts.modules access hits the FORBIDDEN_ATTRIBUTES check
        assert not is_secure

    def test_variant_build123d_os_execv(self):
        """Variant: execv for code execution."""
        script = "import build123d\nbuild123d.os.execv('/bin/sh', ['sh'])"
        is_secure, err = validate_script_security(script)
        assert not is_secure


# ---------------------------------------------------------------------------
# 3. AST Validator: Legitimate CAD scripts (MUST pass validation)
# ---------------------------------------------------------------------------

class TestVEX2A001_LegitimateScripts:
    """Verify that normal build123d CAD scripts still pass validation."""

    def test_simple_box(self):
        """Basic build123d box creation."""
        script = """
from build123d import *
with BuildPart() as part:
    Box(10, 20, 30)
"""
        is_secure, err = validate_script_security(script)
        assert is_secure, f"Legitimate script blocked: {err}"

    def test_box_with_parameters(self):
        """Parameterized box creation."""
        script = """
from build123d import *
with BuildPart() as part:
    Box(length, width, height)
"""
        is_secure, err = validate_script_security(script)
        assert is_secure, f"Legitimate script blocked: {err}"

    def test_import_typing(self):
        """typing is a legitimate import for build123d type hints."""
        script = """
from typing import List
from build123d import *
with BuildPart() as part:
    Box(10, 20, 30)
"""
        is_secure, err = validate_script_security(script)
        assert is_secure, f"Legitimate script blocked: {err}"

    def test_import_math(self):
        """math is a legitimate import for CAD calculations."""
        script = """
import math
from build123d import *
radius = math.sqrt(100)
with BuildPart() as part:
    Cylinder(radius, 30)
"""
        is_secure, err = validate_script_security(script)
        assert is_secure, f"Legitimate script blocked: {err}"

    def test_import_re(self):
        """re is a legitimate import for string processing."""
        script = """
import re
from build123d import *
with BuildPart() as part:
    Box(10, 20, 30)
"""
        is_secure, err = validate_script_security(script)
        assert is_secure, f"Legitimate script blocked: {err}"

    def test_build123d_direct_import(self):
        """Direct build123d import."""
        script = """
from build123d import *
with BuildPart() as part:
    with Locations((0, 0, 0)):
        Box(10, 10, 10)
"""
        is_secure, err = validate_script_security(script)
        assert is_secure, f"Legitimate script blocked: {err}"

    def test_build123d_with_extrude(self):
        """build123d with sketch and extrude."""
        script = """
from build123d import *
with BuildSketch() as sketch:
    Rectangle(20, 30)
    Circle(5)
extrude(amount=10)
"""
        is_secure, err = validate_script_security(script)
        assert is_secure, f"Legitimate script blocked: {err}"

    def test_build123d_with_fillet(self):
        """build123d with fillet operation."""
        script = """
from build123d import *
with BuildPart() as part:
    Box(10, 20, 30)
    fillet(part.edges(), radius=1.0)
"""
        is_secure, err = validate_script_security(script)
        assert is_secure, f"Legitimate script blocked: {err}"

    def test_build123d_with_chamfer(self):
        """build123d with chamfer operation."""
        script = """
from build123d import *
with BuildPart() as part:
    Box(10, 20, 30)
    chamfer(part.edges(), length=0.5)
"""
        is_secure, err = validate_script_security(script)
        assert is_secure, f"Legitimate script blocked: {err}"

    def test_complex_valid_script(self):
        """A more complex but legitimate CAD script."""
        script = """
from build123d import *
import math

params = {"length": 50.0, "width": 30.0, "height": 10.0}

with BuildPart() as part:
    Box(params["length"], params["width"], params["height"])
    # Round the vertical edges
    edges = part.edges().filter_by(Axis.Z)
    fillet(edges, radius=min(params["height"] / 4, 3.0))

# Export
export_stl(part.part, "/tmp/test.stl")
"""
        is_secure, err = validate_script_security(script)
        assert is_secure, f"Legitimate script blocked: {err}"

    def test_empty_script(self):
        """Empty script should pass (syntax validation catches it)."""
        script = ""
        is_secure, err = validate_script_security(script)
        assert is_secure, f"Empty script blocked: {err}"

    def test_comment_only_script(self):
        """Comment-only script should pass."""
        script = "# This is a comment\n# Another comment"
        is_secure, err = validate_script_security(script)
        assert is_secure, f"Comment-only script blocked: {err}"


# ---------------------------------------------------------------------------
# 4. Sandbox Environment Builder Tests
# ---------------------------------------------------------------------------

class TestVEX2A001_SandboxEnv:
    """Verify that _build_sandbox_env isolates secrets."""

    def test_sandbox_excludes_google_api_key(self):
        """GOOGLE_API_KEY must not be in sandbox env."""
        os.environ["GOOGLE_API_KEY"] = "test-secret-key-12345"
        try:
            env = _build_sandbox_env()
            assert "GOOGLE_API_KEY" not in env, "GOOGLE_API_KEY leaked to sandbox"
        finally:
            del os.environ["GOOGLE_API_KEY"]

    def test_sandbox_excludes_database_url(self):
        """DATABASE_URL must not be in sandbox env."""
        os.environ["DATABASE_URL"] = "postgresql://user:pass@host:5432/db"
        try:
            env = _build_sandbox_env()
            assert "DATABASE_URL" not in env, "DATABASE_URL leaked to sandbox"
        finally:
            del os.environ["DATABASE_URL"]

    def test_sandbox_excludes_jwt_secret(self):
        """JWT_SECRET must not be in sandbox env."""
        os.environ["JWT_SECRET"] = "super-secret-jwt-token"
        try:
            env = _build_sandbox_env()
            assert "JWT_SECRET" not in env, "JWT_SECRET leaked to sandbox"
        finally:
            del os.environ["JWT_SECRET"]

    def test_sandbox_excludes_openrouter_api_key(self):
        """OPENROUTER_API_KEY must not be in sandbox env."""
        os.environ["OPENROUTER_API_KEY"] = "sk-or-12345"
        try:
            env = _build_sandbox_env()
            assert "OPENROUTER_API_KEY" not in env, "OPENROUTER_API_KEY leaked to sandbox"
        finally:
            del os.environ["OPENROUTER_API_KEY"]

    def test_sandbox_includes_path(self):
        """PATH must be in sandbox env for Python to find binaries."""
        env = _build_sandbox_env()
        assert "PATH" in env, "PATH missing from sandbox env"

    def test_sandbox_includes_pythonpath(self):
        """PYTHONPATH should be forwarded if set."""
        os.environ["PYTHONPATH"] = "/app:/usr/lib/python3"
        try:
            env = _build_sandbox_env()
            assert env.get("PYTHONPATH") == "/app:/usr/lib/python3"
        finally:
            del os.environ["PYTHONPATH"]

    def test_sandbox_includes_cad_parameters(self):
        """CAD_PARAMETERS_JSON must be passable via extra."""
        params = '{"length": 10.0}'
        env = _build_sandbox_env(extra={"CAD_PARAMETERS_JSON": params})
        assert env["CAD_PARAMETERS_JSON"] == params

    def test_sandbox_includes_output_dir(self):
        """OUTPUT_DIR must be passable via extra."""
        env = _build_sandbox_env(extra={"OUTPUT_DIR": "/tmp/outputs"})
        assert env["OUTPUT_DIR"] == "/tmp/outputs"

    def test_sandbox_includes_render_timeout(self):
        """RENDER_TIMEOUT_SECONDS should be forwarded."""
        os.environ["RENDER_TIMEOUT_SECONDS"] = "300"
        try:
            env = _build_sandbox_env()
            assert env.get("RENDER_TIMEOUT_SECONDS") == "300"
        finally:
            del os.environ["RENDER_TIMEOUT_SECONDS"]

    def test_sandbox_extra_overrides_system(self):
        """Extra values can override system values."""
        env = _build_sandbox_env(extra={"PATH": "/custom/path"})
        assert env["PATH"] == "/custom/path"

    def test_sandbox_provides_default_path(self):
        """If PATH is not in parent env, a default is provided."""
        old_path = os.environ.pop("PATH", None)
        try:
            env = _build_sandbox_env()
            assert "PATH" in env
            assert len(env["PATH"]) > 0
        finally:
            if old_path is not None:
                os.environ["PATH"] = old_path

    def test_sandbox_excludes_arbitrary_app_secrets(self):
        """Any key not in the allowlist must be excluded."""
        os.environ["MY_CUSTOM_SECRET"] = "should-not-leak"
        os.environ["INTERNAL_API_TOKEN"] = "also-should-not-leak"
        try:
            env = _build_sandbox_env()
            assert "MY_CUSTOM_SECRET" not in env
            assert "INTERNAL_API_TOKEN" not in env
        finally:
            del os.environ["MY_CUSTOM_SECRET"]
            del os.environ["INTERNAL_API_TOKEN"]


# ---------------------------------------------------------------------------
# 5. Syntax validation still works correctly
# ---------------------------------------------------------------------------

class TestVEX2A001_SyntaxValidation:
    """Verify that syntax validation is unaffected by security changes."""

    def test_valid_syntax(self):
        script = "x = 1\ny = 2"
        is_valid, err = validate_script_syntax(script)
        assert is_valid

    def test_invalid_syntax(self):
        script = "def foo(:\n  pass"
        is_valid, err = validate_script_syntax(script)
        assert not is_valid
        assert "syntax" in err.lower()

    def test_valid_build123d_syntax(self):
        script = """
from build123d import *
with BuildPart() as part:
    Box(10, 20, 30)
"""
        is_valid, err = validate_script_syntax(script)
        assert is_valid

    def test_empty_script_syntax(self):
        is_valid, err = validate_script_syntax("")
        assert is_valid


# ---------------------------------------------------------------------------
# 6. Integration: AST validator + sandbox env together
# ---------------------------------------------------------------------------

class TestVEX2A001_Integration:
    """Test the combined effect of AST validation + sandbox env."""

    def test_rejected_script_and_env_isolation(self):
        """A rejected script should not even need env isolation, but verify both work."""
        script = "import os\nos.system('id')"
        is_secure, _ = validate_script_security(script)
        assert not is_secure

        env = _build_sandbox_env()
        assert "GOOGLE_API_KEY" not in env
        assert "DATABASE_URL" not in env

    def test_validator_catches_before_env_matters(self):
        """AST validation should reject dangerous scripts before they reach env."""
        dangerous_scripts = [
            "import os",
            "import subprocess",
            "import sys",
            "import socket",
            "import ctypes",
            "import importlib",
            "from os import system",
            "from subprocess import call",
            '__import__("os")',
            "eval('1+1')",
            "exec('pass')",
        ]
        for script in dangerous_scripts:
            is_secure, err = validate_script_security(script)
            assert not is_secure, f"Failed to block: {script}"

    def test_safe_script_passes_validation(self):
        """Safe scripts should pass both syntax and security checks."""
        safe_scripts = [
            "from build123d import *\nBox(10, 20, 30)",
            "import math\nx = math.sqrt(4)",
            "import re\npattern = re.compile('test')",
            "from typing import List\nitems: List[int] = []",
        ]
        for script in safe_scripts:
            is_syntax_valid, _ = validate_script_syntax(script)
            is_secure, err = validate_script_security(script)
            assert is_syntax_valid, f"Syntax check failed for: {script}"
            assert is_secure, f"Security check failed for: {script} — {err}"
