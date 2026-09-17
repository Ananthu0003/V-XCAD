"""
API Key authentication middleware for the ai-engine.
Validates the X-Api-Key header against the INTERNAL_API_KEY env var.
"""
import os
from fastapi import Request, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response


# Endpoints that don't require authentication (health, docs)
PUBLIC_PATHS = {"/health", "/docs", "/openapi.json", "/redoc"}


class ApiKeyMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, api_key: str | None = None):
        super().__init__(app)
        self.api_key = api_key or os.getenv("INTERNAL_API_KEY", "")

    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        # Allow public endpoints without auth
        if path in PUBLIC_PATHS or path.startswith("/outputs/"):
            return await call_next(request)

        # If no API key is configured, deny all requests
        if not self.api_key:
            return Response(
                content='{"error": "API key not configured"}',
                status_code=500,
                media_type="application/json",
            )

        # Check the X-Api-Key header
        provided_key = request.headers.get("X-Api-Key", "")
        if not provided_key or provided_key != self.api_key:
            return Response(
                content='{"error": "Invalid or missing API key"}',
                status_code=401,
                media_type="application/json",
            )

        return await call_next(request)
