from __future__ import annotations

from typing import Literal, Any

from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class UploadedDrawingInfo(StrictModel):
    session_id: str
    file_name: str
    mime_type: str
    image_format: str
    width: int
    height: int


class GeneratedCadParameter(StrictModel):
    name: str
    value: str
    kind: Literal["number", "string"]


class PromptUsage(StrictModel):
    user_prompt_chars: int
    context_chars: int
    chat_turn_count: int
    parameter_hint_count: int
    max_output_tokens: int
    intent: Literal["generate", "modify", "analyze", "repair"]
    include_raw_response: bool


class GeneratedCadArtifacts(StrictModel):
    session_id: str
    provider: Literal["gemini"]
    model_name: str
    file_name: str
    mime_type: str
    image_format: str
    width: int
    height: int
    step_file_path: str
    stl_file_path: str
    dxf_file_path: str | None = None
    step_url: str
    stl_url: str
    dxf_url: str | None = None
    annotations: dict[str, dict[str, Any]] | None = None

    script_url: str
    stdout: str = ""
    stderr: str = ""
    raw_response: str = ""
    python_script: str = ""
    parameters: list[GeneratedCadParameter] = Field(default_factory=list)
    prompt_usage: PromptUsage | None = None


class GeneratedCadResponse(StrictModel):
    session_id: str
    status: Literal["SUCCESS"]
    provider: Literal["gemini"]
    model_name: str
    drawing: UploadedDrawingInfo
    artifacts: GeneratedCadArtifacts


class RenderRequest(StrictModel):
    python_script: str = Field(min_length=1)
    parameters: dict[str, Any] = Field(default_factory=dict)
    session_id: str | None = None


class RenderedCadArtifacts(StrictModel):
    session_id: str
    step_file_path: str
    stl_file_path: str
    dxf_file_path: str | None = None
    step_url: str
    stl_url: str
    dxf_url: str | None = None
    annotations: dict[str, dict[str, Any]] | None = None

    script_url: str
    stdout: str = ""
    stderr: str = ""
    python_script: str
    parameters: list[GeneratedCadParameter] = Field(default_factory=list)


class RenderResponse(StrictModel):
    session_id: str
    status: Literal["SUCCESS"]
    artifacts: RenderedCadArtifacts
