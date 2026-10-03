"""
P0-02 Regression Tests — ai-engine Knowledge Endpoint Service Authentication

Verifies that all four knowledge endpoints reject requests missing or
carrying an invalid X-Service-Key header, and accept requests with the
correct key. Tests use a minimal FastAPI app to avoid importing the full
application (which pulls in heavy dependencies like build123d).
"""
import os
import hmac
import pytest
from unittest.mock import patch
from fastapi import FastAPI, Depends, Header, HTTPException, status
from fastapi.testclient import TestClient

# ── Set SERVICE_API_KEY before importing the dependency ──────────────────────

TEST_SERVICE_KEY = "test-service-key-abc123"
os.environ["SERVICE_API_KEY"] = TEST_SERVICE_KEY

from app.deps import validate_service_key


# ── Minimal test app ────────────────────────────────────────────────────────

app = FastAPI()


@app.get("/knowledge/documents")
async def list_documents(_auth: None = Depends(validate_service_key)):
    return {"documents": []}


@app.post("/knowledge/documents/ingest")
async def ingest_document(_auth: None = Depends(validate_service_key)):
    return {"success": True}


@app.post("/knowledge/retrieve")
async def retrieve_knowledge(_auth: None = Depends(validate_service_key)):
    return {"rules": []}


@app.delete("/knowledge/documents/{doc_id}")
async def delete_document(doc_id: str, _auth: None = Depends(validate_service_key)):
    return {"success": True, "deleted": doc_id}


client = TestClient(app, raise_server_exceptions=False)


# ── Tests ───────────────────────────────────────────────────────────────────

class TestServiceAuthDependency:
    """Unit tests for the validate_service_key dependency."""

    def test_missing_header_returns_401(self):
        """Request without X-Service-Key must be rejected."""
        for method, path in [
            ("GET", "/knowledge/documents"),
            ("POST", "/knowledge/documents/ingest"),
            ("POST", "/knowledge/retrieve"),
            ("DELETE", "/knowledge/documents/doc-1"),
        ]:
            if method == "POST":
                resp = client.request(method, path, json={})
            else:
                resp = client.request(method, path)
            assert resp.status_code == 401, f"{method} {path} should return 401"

    def test_invalid_key_returns_401(self):
        """Request with wrong X-Service-Key must be rejected."""
        headers = {"X-Service-Key": "wrong-key"}
        for method, path in [
            ("GET", "/knowledge/documents"),
            ("POST", "/knowledge/documents/ingest"),
            ("POST", "/knowledge/retrieve"),
            ("DELETE", "/knowledge/documents/doc-1"),
        ]:
            if method == "POST":
                resp = client.request(method, path, json={}, headers=headers)
            else:
                resp = client.request(method, path, headers=headers)
            assert resp.status_code == 401, f"{method} {path} should return 401"

    def test_empty_key_returns_401(self):
        """Request with empty X-Service-Key must be rejected."""
        headers = {"X-Service-Key": ""}
        resp = client.get("/knowledge/documents", headers=headers)
        assert resp.status_code == 401

    def test_correct_key_accepted(self):
        """Request with valid X-Service-Key must succeed."""
        headers = {"X-Service-Key": TEST_SERVICE_KEY}
        resp = client.get("/knowledge/documents", headers=headers)
        assert resp.status_code == 200
        assert resp.json() == {"documents": []}

    def test_correct_key_accepted_all_endpoints(self):
        """Valid key must work on all four knowledge endpoints."""
        headers = {"X-Service-Key": TEST_SERVICE_KEY}
        resp = client.get("/knowledge/documents", headers=headers)
        assert resp.status_code == 200

        resp = client.post("/knowledge/documents/ingest", headers=headers)
        assert resp.status_code == 200

        resp = client.post("/knowledge/retrieve", json={"query": "test"}, headers=headers)
        assert resp.status_code == 200

        resp = client.delete("/knowledge/documents/doc-1", headers=headers)
        assert resp.status_code == 200

    def test_503_when_service_key_not_configured(self):
        """If SERVICE_API_KEY env var is missing, endpoints return 503."""
        from app import deps
        old_val = deps._SERVICE_API_KEY
        deps._SERVICE_API_KEY = None
        try:
            resp = client.get("/knowledge/documents")
            assert resp.status_code == 503
        finally:
            deps._SERVICE_API_KEY = old_val

    def test_error_response_does_not_leak_secret(self):
        """Error responses must not contain the expected secret value."""
        resp = client.get("/knowledge/documents")
        assert resp.status_code == 401
        body = resp.text
        assert TEST_SERVICE_KEY not in body
        assert "test-service-key" not in body

    def test_rejects_key_from_query_parameter(self):
        """Key must be in header, not query string."""
        resp = client.get(f"/knowledge/documents?X-Service-Key={TEST_SERVICE_KEY}")
        assert resp.status_code == 401
