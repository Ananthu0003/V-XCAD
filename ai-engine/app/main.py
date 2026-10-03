"""VEXCAD AI Engine — FastAPI entry point."""
from pathlib import Path

# Load .env before importing anything that needs it
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
except Exception:
    pass

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.api.v1.router import router as v1_router
from app.deps import validate_service_key

# Ensure the outputs directory exists before mounting
OUTPUTS_DIR = Path(__file__).resolve().parents[1] / "outputs"
OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)

import os

app = FastAPI(
    title="VEXCAD AI Engine",
    version="2.0.0",
    docs_url="/docs" if os.getenv("ENABLE_DOCS", "").lower() in ("1", "true", "yes") else None,
    redoc_url=None,
    openapi_url="/openapi.json" if os.getenv("ENABLE_DOCS", "").lower() in ("1", "true", "yes") else None,
)

# Service-to-service authentication for EVERY /api/v1 route (default-deny: routes added
# to the router later are protected automatically). The engine authenticates the calling
# *service* (the web-ui BFF, via X-Service-Key); end-user authentication and resource
# ownership remain the BFF's responsibility. /health (below) is intentionally exempt.
app.include_router(v1_router, prefix="/api/v1", dependencies=[Depends(validate_service_key)])

# NOTE: the former unauthenticated `/outputs` StaticFiles mount was removed. It exposed every
# user's artifacts (scripts, logs, blueprints) to any caller that could reach the engine, and
# nothing uses it: the BFF serves artifacts itself from the shared volume with per-session
# ownership checks (web-ui /api/outputs).


# ── Global exception handlers ─────────────────────────────────────────────────

@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={"error": {"message": "Invalid request.", "detail": exc.errors()}},
    )


@app.exception_handler(HTTPException)
async def http_handler(request: Request, exc: HTTPException) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content=exc.detail)


@app.get("/health", tags=["system"])
def health() -> dict:
    return {"status": "ok", "version": "2.0.0"}
