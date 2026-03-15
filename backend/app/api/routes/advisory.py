"""LLM advisory endpoints — Claude-powered farm advisory (stub)."""

from fastapi import APIRouter

router = APIRouter()


@router.post("/chat")
async def chat():
    """Chat with the AI farm advisor. (Coming in feat/llm-advisory)"""
    return {"status": "stub", "message": "LLM advisory not yet implemented"}
