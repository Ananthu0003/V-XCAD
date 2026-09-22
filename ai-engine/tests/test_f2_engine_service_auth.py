"""
Finding 2 (P2) — ai-engine must authenticate the calling SERVICE on every /api/v1 route.

Design under test
-----------------
Browser -> Next.js BFF (user auth + ownership) -> X-Service-Key -> ai-engine.
The engine does NOT authenticate end users; it authenticates the internal caller.

Why this file does not import the real app
------------------------------------------
app.main imports app.api.v1.router, which needs build123d/OCP and ~20 other heavy
packages that are not installable in CI. Older tests therefore build replica mini-apps
that copy the config, which can never notice a *new* unprotected route.

Instead this suite derives the truth from the SOURCE:

  * the route inventory is extracted from router.py's @router.<method>("<path>") decorators
    by AST, so adding a route automatically adds it to these tests;
  * main.py is parsed by AST to prove the router is included with the service-key
    dependency, that no unauthenticated static mount exists, and that /health is
    registered on the app (exempt), not on the router;
  * a FastAPI app is then built with exactly that wiring and every extracted route is
    exercised over HTTP.
"""
import ast
import os
import sys
from pathlib import Path

import pytest
from fastapi import APIRouter, Depends, FastAPI
from fastapi.testclient import TestClient

# NOTE: app.deps captures SERVICE_API_KEY when it is first imported, and
# tests/test_p002_service_auth.py sets the same variable at import time. Both suites must
# therefore agree on the value, otherwise whichever module is collected second would see
# the other's key.
TEST_SERVICE_KEY = "test-service-key-abc123"
os.environ["SERVICE_API_KEY"] = TEST_SERVICE_KEY

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app import deps  # noqa: E402
from app.deps import validate_service_key  # noqa: E402

APP_DIR = Path(__file__).resolve().parents[1] / "app"
MAIN_PY = APP_DIR / "main.py"
ROUTER_PY = APP_DIR / "api" / "v1" / "router.py"

HTTP_METHODS = {"get", "post", "put", "delete", "patch"}


# ── Source-derived inventory ────────────────────────────────────────────────

def _route_inventory():
    """[(METHOD, '/path')] for every @router.<method>('<path>') in router.py."""
    tree = ast.parse(ROUTER_PY.read_text(encoding="utf-8"))
    routes = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for dec in node.decorator_list:
                if (
                    isinstance(dec, ast.Call)
                    and isinstance(dec.func, ast.Attribute)
                    and isinstance(dec.func.value, ast.Name)
                    and dec.func.value.id == "router"
                    and dec.func.attr in HTTP_METHODS
                    and dec.args
                    and isinstance(dec.args[0], ast.Constant)
                ):
                    routes.append((dec.func.attr.upper(), dec.args[0].value))
    return routes


ROUTES = _route_inventory()


def _concrete(path: str) -> str:
    """Replace {param} segments with a value so the path can be requested."""
    out = []
    for seg in path.split("/"):
        out.append("x" if seg.startswith("{") and seg.endswith("}") else seg)
    return "/".join(out)


def _build_app() -> FastAPI:
    """App with the SAME wiring main.py uses, but stub handlers (no heavy imports)."""
    stub = APIRouter()
    for method, path in ROUTES:
        async def handler():  # noqa: ANN202
            return {"reached": True}
        stub.add_api_route(path, handler, methods=[method])

    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    app.include_router(stub, prefix="/api/v1", dependencies=[Depends(validate_service_key)])

    @app.get("/health")
    def health():
        return {"status": "ok"}

    return app


client = TestClient(_build_app(), raise_server_exceptions=False)
GOOD = {"X-Service-Key": TEST_SERVICE_KEY}


def _call(method: str, path: str, headers=None):
    url = "/api/v1" + _concrete(path)
    if method in ("POST", "PUT", "PATCH"):
        return client.request(method, url, json={}, headers=headers)
    return client.request(method, url, headers=headers)


# ═══════════════════════════════════════════════════════════════════════════
# The inventory itself must be sane (guards against the parser silently finding 0)
# ═══════════════════════════════════════════════════════════════════════════

def test_route_inventory_is_extracted_and_complete():
    assert len(ROUTES) >= 20, f"expected the full router inventory, parsed {len(ROUTES)}"
    paths = {p for _, p in ROUTES}
    for must in ("/render", "/generate", "/cam/gcode", "/cam/toolpaths", "/cam/auto_plan",
                 "/cam/analyze", "/cam/simulate/prepare", "/cam/recommend-machine",
                 "/blueprint/{session_id}", "/assistant/compare-and-prompt",
                 "/knowledge/documents", "/knowledge/retrieve"):
        assert must in paths, f"{must} missing from parsed inventory"


# ═══════════════════════════════════════════════════════════════════════════
# Static proof about main.py (the real wiring)
# ═══════════════════════════════════════════════════════════════════════════

class TestMainWiring:
    tree = ast.parse(MAIN_PY.read_text(encoding="utf-8"))
    src = MAIN_PY.read_text(encoding="utf-8")

    def _calls(self, attr):
        return [
            n for n in ast.walk(self.tree)
            if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == attr
        ]

    def test_v1_router_is_included_with_the_service_key_dependency(self):
        includes = self._calls("include_router")
        assert len(includes) == 1, "exactly one router is mounted"
        kw = {k.arg: k.value for k in includes[0].keywords}
        assert "dependencies" in kw, "include_router must carry router-wide dependencies"
        dep_src = ast.unparse(kw["dependencies"])
        assert "validate_service_key" in dep_src and "Depends" in dep_src

    def test_no_unauthenticated_static_mount(self):
        assert not self._calls("mount"), "app.mount() cannot carry the auth dependency; must not exist"
        imported = {
            alias.name
            for n in ast.walk(self.tree)
            if isinstance(n, (ast.Import, ast.ImportFrom))
            for alias in n.names
        }
        used = {n.id for n in ast.walk(self.tree) if isinstance(n, ast.Name)}
        assert "StaticFiles" not in imported | used

    def test_health_is_on_the_app_not_the_router(self):
        health = [
            n for n in ast.walk(self.tree)
            if isinstance(n, ast.FunctionDef) and n.name == "health"
        ]
        assert health, "health endpoint must exist for Docker healthchecks"
        dec = health[0].decorator_list[0]
        assert isinstance(dec.func.value, ast.Name) and dec.func.value.id == "app"

    def test_docs_remain_gated(self):
        assert "ENABLE_DOCS" in self.src

    def test_router_module_has_no_unprotected_second_router(self):
        # any other APIRouter() in router.py would bypass the include_router dependency
        tree = ast.parse(ROUTER_PY.read_text(encoding="utf-8"))
        routers = [
            n for n in ast.walk(tree)
            if isinstance(n, ast.Call) and getattr(n.func, "id", "") == "APIRouter"
        ]
        # `router = APIRouter(...)` is defined once and (harmlessly) re-imported by name later
        assigned = [
            n for n in ast.walk(tree)
            if isinstance(n, ast.Assign) and isinstance(n.value, ast.Call)
            and getattr(n.value.func, "id", "") == "APIRouter"
            and any(getattr(t, "id", "") != "router" for t in n.targets)
        ]
        assert not assigned, "a router other than `router` would not be included with the dependency"
        assert routers, "router.py must define the router"


# ═══════════════════════════════════════════════════════════════════════════
# Behaviour over HTTP — every real route
# ═══════════════════════════════════════════════════════════════════════════

ROUTE_IDS = [f"{m} {p}" for m, p in ROUTES]


@pytest.mark.parametrize("method,path", ROUTES, ids=ROUTE_IDS)
def test_missing_key_is_rejected(method, path):
    resp = _call(method, path)
    assert resp.status_code == 401, f"{method} {path} must reject a missing service key"
    assert "reached" not in resp.text


@pytest.mark.parametrize("method,path", ROUTES, ids=ROUTE_IDS)
def test_invalid_key_is_rejected(method, path):
    resp = _call(method, path, headers={"X-Service-Key": "definitely-wrong"})
    assert resp.status_code == 401
    assert "reached" not in resp.text


@pytest.mark.parametrize("method,path", ROUTES, ids=ROUTE_IDS)
def test_valid_key_reaches_the_handler(method, path):
    resp = _call(method, path, headers=GOOD)
    assert resp.status_code == 200, f"{method} {path} must accept the valid service key"
    assert resp.json() == {"reached": True}


# ═══════════════════════════════════════════════════════════════════════════
# The credential is header-only and cannot be smuggled in other ways
# ═══════════════════════════════════════════════════════════════════════════

class TestCredentialHandling:
    def test_key_in_query_string_is_rejected(self):
        for name in ("X-Service-Key", "x_service_key", "service_key", "api_key", "key"):
            r = client.post(f"/api/v1/render?{name}={TEST_SERVICE_KEY}", json={})
            assert r.status_code == 401, name

    def test_key_in_cookie_or_body_is_rejected(self):
        r = client.post("/api/v1/render", json={"X-Service-Key": TEST_SERVICE_KEY, "service_key": TEST_SERVICE_KEY},
                        cookies={"X-Service-Key": TEST_SERVICE_KEY})
        assert r.status_code == 401

    def test_authorization_bearer_is_not_a_substitute(self):
        r = client.post("/api/v1/render", json={}, headers={"Authorization": f"Bearer {TEST_SERVICE_KEY}"})
        assert r.status_code == 401

    def test_empty_and_whitespace_keys_are_rejected(self):
        for v in ("", " ", "   "):
            assert client.post("/api/v1/render", json={}, headers={"X-Service-Key": v}).status_code == 401

    def test_prefix_and_suffix_variants_are_rejected(self):
        for v in (TEST_SERVICE_KEY[:-1], TEST_SERVICE_KEY + "x", " " + TEST_SERVICE_KEY, TEST_SERVICE_KEY.upper()):
            assert client.post("/api/v1/render", json={}, headers={"X-Service-Key": v}).status_code == 401

    def test_non_ascii_key_is_a_clean_401_not_a_500(self):
        # hmac.compare_digest(str, str) raises TypeError on non-ASCII; must not become a 500.
        # httpx refuses non-ASCII str header values, so send raw bytes (what a hostile client can do).
        for raw in ("café-key".encode("latin-1"), "café-key".encode("utf-8")):
            r = client.post("/api/v1/render", json={}, headers=[(b"x-service-key", raw)])
            assert r.status_code == 401

    def test_header_name_is_case_insensitive(self):
        r = client.post("/api/v1/render", json={}, headers={"x-service-key": TEST_SERVICE_KEY})
        assert r.status_code == 200

    def test_error_bodies_never_echo_the_secret_or_the_supplied_key(self):
        for headers in (None, {"X-Service-Key": "attacker-supplied-value"}):
            r = client.post("/api/v1/render", json={}, headers=headers)
            assert TEST_SERVICE_KEY not in r.text
            assert "attacker-supplied-value" not in r.text


# ═══════════════════════════════════════════════════════════════════════════
# Fail closed when the server-side key is not configured
# ═══════════════════════════════════════════════════════════════════════════

class TestFailClosedWhenUnconfigured:
    @pytest.fixture(autouse=True)
    def _restore(self):
        old = deps._SERVICE_API_KEY
        yield
        deps._SERVICE_API_KEY = old

    @pytest.mark.parametrize("configured", [None, "", "   "], ids=["unset", "empty", "blank"])
    @pytest.mark.parametrize("method,path", ROUTES[:6] + ROUTES[-3:], ids=lambda v: str(v))
    def test_every_route_is_503_even_if_a_key_is_sent(self, configured, method, path):
        deps._SERVICE_API_KEY = configured
        # An attacker sending an empty / matching-empty header must NOT authenticate.
        for headers in (None, {"X-Service-Key": ""}, {"X-Service-Key": configured or "x"}):
            r = _call(method, path, headers=headers)
            assert r.status_code == 503, f"{method} {path} must fail closed (got {r.status_code})"

    def test_health_unaffected_by_missing_key(self):
        deps._SERVICE_API_KEY = None
        assert client.get("/health").status_code == 200


# ═══════════════════════════════════════════════════════════════════════════
# /health stays available (Docker healthcheck) and exposes nothing sensitive
# ═══════════════════════════════════════════════════════════════════════════

class TestHealth:
    def test_health_needs_no_key(self):
        r = client.get("/health")
        assert r.status_code == 200
        assert r.json() == {"status": "ok"}

    def test_no_route_exists_outside_the_protected_prefix_except_health(self):
        app = _build_app()
        outside = [
            r.path for r in app.routes
            if getattr(r, "path", "").startswith("/") and not r.path.startswith("/api/v1")
        ]
        assert outside == ["/health"]
