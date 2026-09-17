"""Multimodal Prompt Assistant and mechanical dictionary endpoints."""
from __future__ import annotations

import traceback
from fastapi import APIRouter

from app.models.schemas import CADPromptAssistantRequest, CADPromptAssistantResponse

router = APIRouter(prefix="/assistant", tags=["assistant"])


@router.post("/compare-and-prompt", response_model=CADPromptAssistantResponse)
async def assistant_compare_and_prompt(req: CADPromptAssistantRequest):
    """
    Multimodal CAD Prompt Assistant: Compares reference 2D blueprint with live 3D canvas snapshot,
    pinpoints geometric discrepancies, and constructs precision build123d prompts.
    """
    try:
        from app.services.agents.cad_prompt_assistant import CADPromptAssistantService
        service = CADPromptAssistantService()
        result = await service.compare_and_suggest_prompt(
            blueprint_image=req.blueprint_image,
            model_snapshot=req.model_snapshot,
            model_snapshots=req.model_snapshots,
            user_message=req.message,
            chat_history=req.history,
            model_override=req.model,
        )
        return CADPromptAssistantResponse(
            reply=result.get("reply", ""),
            analysis=result.get("analysis"),
            suggested_prompt=result.get("suggested_prompt"),
            error=result.get("error"),
        )
    except Exception as exc:
        traceback.print_exc()
        return CADPromptAssistantResponse(
            reply=f"Error in prompt assistant: {exc}",
            analysis=None,
            suggested_prompt=None,
            error=str(exc),
        )


@router.get("/dictionary")
async def assistant_dictionary():
    """Returns active mechanical vocabulary taxonomy used by the Prompt Assistant."""
    try:
        from app.services.agents.cad_prompt_assistant import CADPromptAssistantService
        service = CADPromptAssistantService()
        entries = service.get_parts_dictionary()
        return {
            "count": len(entries),
            "entries": entries,
        }
    except Exception as exc:
        return {"count": 0, "entries": [], "error": str(exc)}
