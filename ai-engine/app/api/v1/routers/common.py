"""Shared utilities, caching, and validation helpers for API v1."""
from __future__ import annotations

import os
import re
import time
import uuid
from pathlib import Path
from typing import Any, Optional
from fastapi import HTTPException

# Security and cache settings
SAFE_ID_REGEX = re.compile(r"^[a-zA-Z0-9_\-\.]+$")
MAX_UPLOAD_SIZE = 50 * 1024 * 1024  # 50 MB
OPENSCAD_FN_CAP = int(os.getenv("OPENSCAD_FN_CAP", "32"))
CSG_EPS = float(os.getenv("CSG_EPS", "0.02"))
BLUEPRINT_DXF_VIEW_SPACING = float(os.getenv("BLUEPRINT_DXF_VIEW_SPACING", "120.0"))
DEFAULT_GENAI_MODEL = os.getenv("GENAI_MODEL", "gemini-3.5-flash-lite")

_ALLOWED_MIME_PREFIXES = ()
_ALLOWED_MIME_EXACT = {"application/pdf", "image/jpeg", "image/png", "image/gif", "image/webp"}

# Standard outputs directories
OUTPUTS_DIR = Path(__file__).resolve().parents[4] / "outputs"
BLUEPRINTS_DIR = OUTPUTS_DIR / "blueprints"
BLUEPRINTS_DIR.mkdir(parents=True, exist_ok=True)
JOBS_DIR = Path(__file__).resolve().parents[4] / "storage" / "jobs"
JOBS_DIR.mkdir(parents=True, exist_ok=True)


class ShapeCache:
    """In-memory shape cache with bounded capacity and TTL-based LRU eviction."""
    _cache: dict[str, dict[str, Any]] = {}
    MAX_CACHE_SIZE: int = 50
    CACHE_TTL_SECONDS: int = 1800  # 30 minutes

    @classmethod
    def get(cls, asset_id: str) -> Any:
        entry = cls._cache.get(asset_id)
        if entry:
            now = time.time()
            if now - entry.get("last_accessed", now) > cls.CACHE_TTL_SECONDS:
                cls.evict(asset_id)
                return None
            entry["last_accessed"] = now
            return entry["shape"]
        return None

    @classmethod
    def set(cls, asset_id: str, shape: Any):
        cls.evict(asset_id)
        now = time.time()
        # Evict expired entries
        for aid, data in list(cls._cache.items()):
            if now - data.get("last_accessed", now) > cls.CACHE_TTL_SECONDS:
                cls.evict(aid)
        # If still at capacity, evict oldest accessed (LRU)
        if len(cls._cache) >= cls.MAX_CACHE_SIZE:
            oldest_id = min(cls._cache.keys(), key=lambda k: cls._cache[k].get("last_accessed", 0))
            cls.evict(oldest_id)
        cls._cache[asset_id] = {
            "shape": shape,
            "last_accessed": now,
        }

    @classmethod
    def evict(cls, asset_id: str):
        if asset_id in cls._cache:
            entry = cls._cache.pop(asset_id)
            shape = entry.get("shape")
            if shape:
                try:
                    if hasattr(shape, "wrapped"):
                        shape.wrapped = None
                except Exception:
                    pass
                del shape

    @classmethod
    def clear(cls):
        for asset_id in list(cls._cache.keys()):
            cls.evict(asset_id)


def validate_safe_id(val: Any, field_name: str = "id") -> str:
    """Validate that an ID string only contains safe characters and doesn't traverse directories."""
    if not val:
        raise HTTPException(status_code=400, detail=f"{field_name} cannot be empty.")
    val_str = str(val).strip()
    if len(val_str) > 128 or not SAFE_ID_REGEX.match(val_str) or ".." in val_str:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid {field_name}. Must be alphanumeric with hyphens/underscores/dots only (max 128 chars)."
        )
    return val_str


def sanitize_safe_filename(filename: Any) -> str:
    """Strip directory path components to prevent path traversal."""
    if not filename:
        return f"upload_{uuid.uuid4().hex[:8]}"
    clean_name = Path(str(filename)).name.strip()
    clean_name = re.sub(r'[^a-zA-Z0-9_\-\.]', '_', clean_name)
    if not clean_name or clean_name.startswith('.'):
        clean_name = f"upload_{uuid.uuid4().hex[:8]}_{clean_name}"
    return clean_name


def resolve_mime(content_type: str, filename: str) -> str | None:
    """Infer and validate MIME type from header or file extension."""
    ct = (content_type or "").lower().split(";")[0].strip()
    if ct in _ALLOWED_MIME_EXACT:
        return ct

    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext == "pdf":
        return "application/pdf"
    if ext in ("jpg", "jpeg"):
        return "image/jpeg"
    if ext == "png":
        return "image/png"
    if ext == "gif":
        return "image/gif"
    if ext == "webp":
        return "image/webp"
    return None
