"""
Regression tests for the 2026-09-22 remediation, Findings 5 and 6.

Finding 5 — AST sandbox defense-in-depth (informational, not a confirmed exploit):
    A prior empirical validation proved the specific claimed bypass
    (generator.gi_frame -> f_back -> f_globals['os']) does not work, and that
    build123d.os does not yield a usable module reference at runtime, because
    the restricted builtins omit __import__ and the trusted bootstrap only
    exports build123d's curated __all__. No filesystem/process/network
    capability was demonstrated. This is NOT architectural remediation — the
    restricted execution environment remains the actual security boundary.
    These are low-risk, additive defense-in-depth tightenings to the AST
    layer only:
      A. "os" is now a forbidden attribute name.
      B. The os.spawn*/os.posix_spawn* family is now blocked by prefix,
         fixing the previous exact-match "spawn" entry which matched no
         real attribute name (os has no bare `.spawn` attribute).

Finding 6 — SyntaxError handling in validate_script_security():
    Both current callers run validate_script_syntax() first, so this path is
    not known to be reachable through the real call graph today. Still,
    validate_script_security() must fail closed if ever called directly and
    ast.parse() raises SyntaxError, rather than silently reporting "secure".
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.llm.parameter_render import (
    validate_script_security,
    validate_script_syntax,
)


# ---------------------------------------------------------------------------
# Finding 5A — "os" forbidden attribute
# ---------------------------------------------------------------------------

class TestFinding5A_OsAttributeBlocked:
    def test_bare_os_attribute_capture_blocked(self):
        """Capturing build123d.os as a reference (no call) must now be rejected."""
        script = "import build123d\ncaptured = build123d.os\n"
        is_secure, err = validate_script_security(script)
        assert not is_secure, "build123d.os attribute capture must be blocked"
        assert "os" in err

    def test_os_attribute_blocked_via_any_base(self):
        """The 'os' attribute name is blocked regardless of which allowed module it's accessed on."""
        for base in ("build123d", "typing", "re"):
            script = f"import {base}\nx = {base}.os\n"
            is_secure, _ = validate_script_security(script)
            assert not is_secure, f"{base}.os must be blocked"

    def test_os_attribute_blocked_as_call_target(self):
        """captured_os.getenv(...) style call must be blocked at the attribute-capture step."""
        script = "import build123d\nbuild123d.os.getenv('X')\n"
        is_secure, _ = validate_script_security(script)
        assert not is_secure

    def test_legitimate_scripts_do_not_use_os_attribute(self):
        """Sanity: ordinary CAD scripts never touch a bare .os attribute, so this is safe to add."""
        script = """
from build123d import *
import math
with BuildPart() as part:
    Box(math.sqrt(100), 20, 30)
"""
        is_secure, err = validate_script_security(script)
        assert is_secure, f"Legitimate script unexpectedly blocked: {err}"


# ---------------------------------------------------------------------------
# Finding 5B — os.spawn*/os.posix_spawn* family blocked by prefix
# ---------------------------------------------------------------------------

class TestFinding5B_SpawnFamilyBlocked:
    SPAWN_VARIANTS = [
        "spawnv", "spawnl", "spawnve", "spawnvp", "spawnle", "spawnlp", "spawnlpe",
        "posix_spawn", "posix_spawnp",
    ]

    def test_old_exact_match_spawn_entry_matched_nothing_real(self):
        """Regression guard: the literal attribute name 'spawn' is not a real os
        function, so an exact-match denylist entry for it was always dead. This
        documents why prefix matching was required, independent of the fix below.
        """
        assert not hasattr(os, "spawn"), "os module unexpectedly has a bare 'spawn' attribute"

    def test_each_spawn_variant_is_blocked_as_attribute_call(self):
        # Isolated from the "os" rule (Finding 5A) by not routing through a
        # '.os' attribute at all — this checks the spawn-prefix rule alone,
        # on an arbitrary base expression.
        for variant in self.SPAWN_VARIANTS:
            script = f"import build123d\ncaptured = build123d\ncaptured.{variant}(0, '/bin/true', [])\n"
            is_secure, err = validate_script_security(script)
            assert not is_secure, f".{variant} must be blocked"
            assert variant in err

    def test_each_spawn_variant_is_blocked_as_bare_attribute(self):
        """Even without calling it, referencing the attribute must be blocked."""
        for variant in self.SPAWN_VARIANTS:
            script = f"import build123d\nx = build123d.{variant}\n"
            is_secure, _ = validate_script_security(script)
            assert not is_secure, f".{variant} attribute reference must be blocked"

    def test_spawn_family_also_blocked_when_chained_through_os(self):
        """End-to-end: build123d.os.spawnv(...) is blocked (by the 'os' rule
        first, which is fine — the point is the whole chain is rejected)."""
        script = "import build123d\nbuild123d.os.spawnv(0, '/bin/true', [])\n"
        is_secure, _ = validate_script_security(script)
        assert not is_secure

    def test_legitimate_names_containing_spawn_prefix_boundary(self):
        """Sanity: no legitimate build123d CAD API name starts with 'spawn' or
        'posix_spawn', so this prefix rule cannot collide with real usage."""
        script = """
from build123d import *
with BuildPart() as part:
    Box(10, 20, 30)
    fillet(part.edges(), radius=1.0)
"""
        is_secure, err = validate_script_security(script)
        assert is_secure, f"Legitimate script unexpectedly blocked: {err}"


# ---------------------------------------------------------------------------
# Finding 5 (mutation guard) — the previously tested frame/generator syntax
# remains rejected/harmless. This does not re-litigate the runtime analysis
# (see the standalone empirical validation); it only pins the *validator's*
# behavior so it can't silently regress.
# ---------------------------------------------------------------------------

class TestFinding5_FrameGeneratorSyntaxHarmless:
    def test_generator_gi_frame_walk_script_is_syntactically_unremarkable(self):
        """This script uses no forbidden names/attributes at the AST level (gi_frame,
        f_back, f_globals are ordinary non-dunder attribute names) — the validator
        is not expected to catch it, and does not claim to. The actual protection
        against this pattern is that _RESTRICTED_BUILTINS omits __import__ and the
        bootstrap never binds a module object into the user script's namespace, so
        the walk can never reach a frame containing a real module reference. That
        runtime behavior is exercised by the standalone f5 empirical validation,
        not here — this test only documents the split of responsibility.
        """
        script = """
def g():
    yield 1
gen = g()
next(gen)
fr = gen.gi_frame
while fr is not None:
    fr = fr.f_back
"""
        is_secure, _ = validate_script_security(script)
        # Intentionally not asserted False: the AST layer does not block this,
        # and is not expected to. Documented, not silently assumed.
        assert is_secure is True


# ---------------------------------------------------------------------------
# Finding 6 — validate_script_security() fails closed on SyntaxError
# ---------------------------------------------------------------------------

class TestFinding6_SecurityValidatorFailsClosedOnSyntaxError:
    def test_invalid_syntax_is_not_reported_secure(self):
        """If validate_script_security() is ever called directly (bypassing the
        validate_script_syntax() pre-check both current callers perform), a
        SyntaxError from its own ast.parse() must not be reported as 'secure'.
        """
        script = "def foo(:\n  pass"
        is_secure, err = validate_script_security(script)
        assert is_secure is False
        assert err is not None
        assert "syntax" in err.lower()

    def test_syntax_error_message_includes_location(self):
        script = "x = (\n"
        is_secure, err = validate_script_security(script)
        assert is_secure is False
        assert "line" in err.lower()

    def test_valid_script_still_passes(self):
        """Preserve current behavior for valid scripts (no regression)."""
        script = "from build123d import *\nBox(10, 20, 30)\n"
        is_secure, err = validate_script_security(script)
        assert is_secure is True, f"Valid script unexpectedly rejected: {err}"

    def test_validate_script_syntax_unaffected(self):
        """This finding only touches validate_script_security(); the sibling
        function's own SyntaxError handling (already correct) is untouched."""
        is_valid, err = validate_script_syntax("def foo(:\n  pass")
        assert is_valid is False
        assert "syntax" in err.lower()
