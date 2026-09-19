"""Shared FastAPI dependencies for service-to-service authentication."""
from __future__ import annotations

import hmac
import os
from typing import Annotated

from fastapi import Header, HTTPException, status


_SERVICE_API_KEY: str | None = os.environ.get("SERVICE_API_KEY")


def _get_expected_key() -> str:
    """Return the configured service API key, or raise if missing."""
    if not _SERVICE_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"error": {"message": "Service authentication is not configured."}},
        )
    return _SERVICE_API_KEY


def validate_service_key(x_service_key: str | None = Header(default=None)) -> None:
    """FastAPI dependency: validate X-Service-Key header.

    Uses constant-time comparison to prevent timing attacks.
    Raises 401 if the key is missing or incorrect.
    """
    expected = _get_expected_key()

    if x_service_key is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": {"message": "Missing service authentication credential."}},
        )

    if not hmac.compare_digest(x_service_key, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": {"message": "Invalid service authentication credential."}},
        )
