"""Pydantic schemas for the CAD Copilot API."""
from __future__ import annotations
from typing import Any, Optional
from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class GenerateResponse(StrictModel):
    """Payload returned after a successful two-stage generation run."""
    openscad_script: str
    parameters: dict[str, Any] = Field(default_factory=dict)


class EditRequest(StrictModel):
    """Payload sent to request surgical editing of existing code."""
    prompt: str
    current_code: str
    target_point: list[float] | None = None
    model: str = "gemini-3.5-flash"


class StepRequest(StrictModel):
    """Payload containing compiled CSG tree to convert to STEP."""
    csg_tree: str


class RenderRequest(BaseModel):
    """Payload sent to /api/v1/render to execute and export a CAD script."""
    python_script: str
    parameters: dict[str, Any] = Field(default_factory=dict)
    session_id: Optional[str] = None
    cam_parameters: Optional[dict[str, Any]] = None


class RenderArtifacts(BaseModel):
    """URLs and inline data for all exported artifacts."""
    stl_url: Optional[str] = None
    step_url: Optional[str] = None
    dxf_url: Optional[str] = None
    gcode_url: Optional[str] = None
    gcode_content: Optional[str] = None
    toolpaths: Optional[list] = None
    annotations: Optional[dict[str, Any]] = None


class RenderResponse(BaseModel):
    """Payload returned after a successful /api/v1/render call."""
    status: str = "ok"
    session_id: str
    artifacts: RenderArtifacts

