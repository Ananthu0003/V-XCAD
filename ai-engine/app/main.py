"""VEXCAD AI Engine — FastAPI entry point."""
from pathlib import Path

# Load .env before importing anything that needs it
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
except Exception:
    pass

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api.v1.router import router as v1_router

# Ensure the outputs directory exists before mounting
OUTPUTS_DIR = Path(__file__).resolve().parents[1] / "outputs"
OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(
    title="VEXCAD AI Engine",
    version="2.0.0",
    docs_url="/docs",
    redoc_url=None,
)

app.include_router(v1_router, prefix="/api/v1")

# Serve generated CAD artifacts (STL, STEP, DXF, G-code) from /outputs
app.mount("/outputs", StaticFiles(directory=str(OUTPUTS_DIR)), name="outputs")


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
