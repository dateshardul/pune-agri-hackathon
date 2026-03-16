"""LLM advisory endpoints — Claude-powered farm advisory."""

from fastapi import APIRouter
from pydantic import BaseModel

from app.services.advisory_llm import get_advisory_response, reset_conversation

router = APIRouter()


class ChatRequest(BaseModel):
    message: str


class ChatResponse(BaseModel):
    response: str


@router.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    """Chat with the KrishiTwin AI farm advisor (powered by Claude)."""
    reply = await get_advisory_response(req.message)
    return ChatResponse(response=reply)


@router.post("/reset")
async def reset():
    """Reset conversation history."""
    reset_conversation()
    return {"status": "ok", "message": "Conversation history cleared"}
