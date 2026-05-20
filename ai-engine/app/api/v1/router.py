import json
import uuid
import asyncio
import os
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse

from app.models.schemas import RenderRequest, RenderResponse, RenderedCadArtifacts, GeneratedCadParameter
from app.services.llm_codegen import LLMCodegenService
from app.services.parameter_render import ParameterRenderService, extract_parameters_from_script

router = APIRouter(tags=["cad"])
render_service = ParameterRenderService()
DEFAULT_MODEL = os.getenv("GENAI_MODEL", "gemini-3.1-flash-lite")


def _error_payload(message: str, hint: str | None = None) -> dict[str, Any]:
    error: dict[str, Any] = {"message": message}
    if hint:
        error["hint"] = hint
    return {"error": error}


def _coerce_error_message(exc: Exception, fallback: str) -> str:
    message = str(exc).strip()
    return message or fallback


def _as_sse(event: str, payload: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(payload)}\n\n"

@router.post("/generate")
async def generate(
    request: Request,
    prompt: str = Form(...),
    image: UploadFile = File(...),
    details: list[UploadFile] = File(default=[]),
    model_name: str = Form(DEFAULT_MODEL),
) -> StreamingResponse:

    content_type = (image.content_type or "").lower()
    is_image = content_type.startswith("image/")
    is_pdf = content_type == "application/pdf" or (
        bool(image.filename) and image.filename.lower().endswith(".pdf")
    )

    if content_type and not (is_image or is_pdf):
        raise HTTPException(
            status_code=400,
            detail=_error_payload("Uploaded file must be an image or PDF."),
        )

    # Load main image
    image_bytes = await image.read()
    mime_type = content_type if content_type else ("application/pdf" if image.filename and image.filename.lower().endswith(".pdf") else "image/png")
    
    images_payload = [(image_bytes, mime_type)]

    # Load detail crops if provided
    for detail_file in details:
        det_content_type = (detail_file.content_type or "").lower()
        det_is_image = det_content_type.startswith("image/")
        det_is_pdf = det_content_type == "application/pdf" or (
            bool(detail_file.filename) and detail_file.filename.lower().endswith(".pdf")
        )
        if det_content_type and (det_is_image or det_is_pdf):
            det_bytes = await detail_file.read()
            det_mime = det_content_type if det_content_type else ("application/pdf" if detail_file.filename and detail_file.filename.lower().endswith(".pdf") else "image/png")
            images_payload.append((det_bytes, det_mime))

    try:
        codegen_service = LLMCodegenService(model=model_name)
    except RuntimeError as exc:
        raise HTTPException(
            status_code=500,
            detail=_error_payload(_coerce_error_message(exc, "Failed to initialize AI model.")),
        ) from exc

    async def event_stream():
        try:
            yield _as_sse("metadata", {
                "token_budget": codegen_service.max_prompt_tokens,
                "model": codegen_service.model,
                "max_output": codegen_service.max_output_tokens
            })

            yield _as_sse("status", {"message": "Scanning blueprint for features..."})

            # Stage 1: Summarisation (Analysis)
            try:
                summary = await asyncio.to_thread(
                    codegen_service.summarise_blueprint,
                    images_payload
                )
                yield _as_sse("status", {"message": "Analysis complete. Generating precision script..."})
            except Exception:
                summary = None
                yield _as_sse("status", {"message": "Generating build123d script..."})

            script_chunks: list[str] = []

            for chunk in codegen_service.stream_build123d_script(
                prompt=prompt,
                images=images_payload,
                summary=summary,
            ):
                if await request.is_disconnected():
                    return

                script_chunks.append(chunk)
                yield _as_sse("token", {"chunk": chunk})

            if not script_chunks:
                raise RuntimeError("Model returned no script output.")

            script = codegen_service.normalize_script("".join(script_chunks))
            parsed_parameters = extract_parameters_from_script(script)
            yield _as_sse(
                "done",
                {
                    "script": script,
                    "parameters": parsed_parameters,
                    "hint": "Call /api/v1/render with parameters + script to produce STL/STEP.",
                },
            )
        except asyncio.CancelledError:
            # Client disconnected gracefully
            return
        except Exception as exc:
            yield _as_sse(
                "error",
                {
                    "message": _coerce_error_message(exc, "Generation failed."),
                    "hint": "Adjust the prompt or model and try again.",
                },
            )
            return

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/render", response_model=RenderResponse)
async def render(request: RenderRequest) -> RenderResponse:
    # 1. Generate IDs
    job_id = request.session_id or uuid.uuid4().hex
    output_basename = f"cad_{job_id}"

    # 2. Execute the render asynchronously (Zero 404 race conditions)
    try:
        paths = await render_service.render_to_outputs(
            parameters=request.parameters,
            script=request.python_script,
            output_basename=output_basename,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=_error_payload(
                _coerce_error_message(exc, "Render failed."),
                "Check script and parameter values, then retry.",
            ),
        )

    # 3. Format parameters back for the response UI
    reconstructed_params = [
        GeneratedCadParameter(
            name=k,
            value=str(v),
            kind="number" if isinstance(v, (int, float)) else "string"
        )
        for k, v in request.parameters.items()
    ]

    # 4. Return exact schema Next.js expects
    return RenderResponse(
        session_id=job_id,
        status="SUCCESS",
        artifacts=RenderedCadArtifacts(
            session_id=job_id,
            step_file_path=paths["step_path"],
            stl_file_path=paths["stl_path"],
            dxf_file_path=paths.get("dxf_path"),
            step_url=f"/outputs/{output_basename}.step",
            stl_url=f"/outputs/{output_basename}.stl",
            dxf_url=f"/outputs/{output_basename}.dxf" if paths.get("dxf_path") else None,
            script_url=f"/outputs/{output_basename}.py",
            python_script=request.python_script,
            parameters=reconstructed_params,
            annotations=paths.get("annotations", {}),
        )
    )
