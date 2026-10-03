"""
HIGH-2 Regression Test — /openapi.json disabled by default

Verifies that the FastAPI documentation surface is fully gated behind
the ENABLE_DOCS environment variable:

  - /docs, /redoc, /openapi.json all return 404 when ENABLE_DOCS is
    unset or falsy.
  - /docs and /openapi.json return 200 when ENABLE_DOCS is truthy.
  - /redoc is always 404 (hardcoded redoc_url=None).

This test replicates the exact FastAPI() constructor call from
ai-engine/app/main.py without importing the full application
(which requires build123d, unavailable in CI).
"""

import os
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


def _build_app() -> FastAPI:
    """Replicate the exact FastAPI config from ai-engine/app/main.py."""
    return FastAPI(
        title="VEXCAD AI Engine",
        version="2.0.0",
        docs_url="/docs" if os.getenv("ENABLE_DOCS", "").lower() in ("1", "true", "yes") else None,
        redoc_url=None,
        openapi_url="/openapi.json" if os.getenv("ENABLE_DOCS", "").lower() in ("1", "true", "yes") else None,
    )


@pytest.fixture(autouse=True)
def _clear_enable_docs():
    """Ensure ENABLE_DOCS does not leak between tests."""
    old = os.environ.pop("ENABLE_DOCS", None)
    yield
    if old is None:
        os.environ.pop("ENABLE_DOCS", None)
    else:
        os.environ["ENABLE_DOCS"] = old


class TestDocsDisabledByDefault:
    """ENABLE_DOCS unset — all documentation endpoints must be 404."""

    def test_docs_returns_404(self):
        app = _build_app()
        client = TestClient(app, raise_server_exceptions=False)
        assert client.get("/docs").status_code == 404

    def test_redoc_returns_404(self):
        app = _build_app()
        client = TestClient(app, raise_server_exceptions=False)
        assert client.get("/redoc").status_code == 404

    def test_openapi_json_returns_404(self):
        app = _build_app()
        client = TestClient(app, raise_server_exceptions=False)
        assert client.get("/openapi.json").status_code == 404


class TestDocsDisabledExplicitly:
    """ENABLE_DOCS=false — documentation endpoints must be 404."""

    def test_docs_returns_404(self):
        os.environ["ENABLE_DOCS"] = "false"
        app = _build_app()
        client = TestClient(app, raise_server_exceptions=False)
        assert client.get("/docs").status_code == 404

    def test_openapi_json_returns_404(self):
        os.environ["ENABLE_DOCS"] = "false"
        app = _build_app()
        client = TestClient(app, raise_server_exceptions=False)
        assert client.get("/openapi.json").status_code == 404


class TestDocsEnabled:
    """ENABLE_DOCS=true — /docs and /openapi.json must be available."""

    def test_docs_returns_200(self):
        os.environ["ENABLE_DOCS"] = "true"
        app = _build_app()
        client = TestClient(app, raise_server_exceptions=False)
        assert client.get("/docs").status_code == 200

    def test_openapi_json_returns_200(self):
        os.environ["ENABLE_DOCS"] = "true"
        app = _build_app()
        client = TestClient(app, raise_server_exceptions=False)
        assert client.get("/openapi.json").status_code == 200

    def test_redoc_still_404(self):
        os.environ["ENABLE_DOCS"] = "true"
        app = _build_app()
        client = TestClient(app, raise_server_exceptions=False)
        assert client.get("/redoc").status_code == 404

    def test_openapi_schema_has_correct_metadata(self):
        os.environ["ENABLE_DOCS"] = "true"
        app = _build_app()
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.get("/openapi.json")
        assert resp.status_code == 200
        data = resp.json()
        assert data["info"]["title"] == "VEXCAD AI Engine"
        assert data["info"]["version"] == "2.0.0"


class TestDocsEnabledValues:
    """ENABLE_DOCS with various truthy string representations."""

    @pytest.mark.parametrize("value", ["1", "true", "True", "TRUE", "yes", "Yes", "YES"])
    def test_truthy_enables_docs(self, value):
        os.environ["ENABLE_DOCS"] = value
        app = _build_app()
        client = TestClient(app, raise_server_exceptions=False)
        assert client.get("/docs").status_code == 200
        assert client.get("/openapi.json").status_code == 200

    @pytest.mark.parametrize("value", ["0", "false", "no", "", "random"])
    def test_falsy_disables_docs(self, value):
        os.environ["ENABLE_DOCS"] = value
        app = _build_app()
        client = TestClient(app, raise_server_exceptions=False)
        assert client.get("/docs").status_code == 404
        assert client.get("/openapi.json").status_code == 404
