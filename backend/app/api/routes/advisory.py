"""LLM advisory endpoints — Claude-powered farm advisory with real-time context."""

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.services.advisory_llm import get_advisory_response, reset_conversation

router = APIRouter()


class ChatRequest(BaseModel):
    message: str
    latitude: float | None = Field(None, description="Farm latitude for context")
    longitude: float | None = Field(None, description="Farm longitude for context")
    crop: str | None = Field(None, description="Crop for model-aware advice")


class ChatResponse(BaseModel):
    response: str
    context_summary: str | None = None


@router.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    """Chat with the KrishiTwin AI farm advisor (powered by Claude).

    When latitude/longitude are provided, fetches real-time farm data
    (weather, soil, groundwater, ozone) and injects it as context.
    """
    reply, context_summary = await get_advisory_response(
        req.message, req.latitude, req.longitude, req.crop
    )
    return ChatResponse(response=reply, context_summary=context_summary)


@router.post("/reset")
async def reset():
    """Reset conversation history."""
    reset_conversation()
    return {"status": "ok", "message": "Conversation history cleared"}
