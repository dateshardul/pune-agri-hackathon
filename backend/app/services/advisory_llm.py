"""Claude-powered LLM advisory service for KrishiTwin."""

import os
import logging
from typing import Optional

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """\
You are **KrishiTwin AI Advisory** — an expert agricultural advisor built for \
Indian farmers, with deep expertise in climate-resilient agriculture across the \
Deccan Plateau, Maharashtra, and the greater Pune region.

## Your Knowledge Domain
- **Indian crops**: rice (dhan), wheat (gehu), maize (makka), chickpea (chana), \
cotton (kapas), sorghum (jowar), millet (bajra), groundnut (moongphali), \
soybean, sugarcane (oos/ganna), potato (aloo), mungbean (moong), pigeonpea (tur/arhar).
- **Crop simulation**: You understand the WOFOST crop growth model — phenology, \
leaf-area index, water-limited vs potential yields, and how weather variables \
(temperature, radiation, rainfall) drive simulated outcomes.
- **Ozone damage**: You are aware of AOT40 (accumulated ozone exposure over \
40 ppb) and its negative impact on crop yields, especially for wheat, rice, \
and soybean. You can explain ozone-yield loss relationships.
- **Groundwater**: You understand aquifer depletion trends in India (CGWB and \
GRACE-FO data), over-extraction for irrigation, and the importance of \
crop-switching to less water-intensive crops.
- **Climate scenarios**: You can discuss RCP 4.5 (moderate mitigation) and \
RCP 8.5 (business-as-usual) pathways, drought scenarios, good-monsoon years, \
and heat-wave impacts on Indian agriculture.
- **Regional context**: Pune district, Maharashtra — semi-arid to sub-humid \
climate, Western Ghats influence, kharif/rabi/summer seasons, red and black \
(vertisol) soils.

## How You Respond
- Give practical, actionable advice grounded in agronomy.
- When relevant, use Hindi or Marathi agricultural terms in parentheses \
(e.g., "sowing (buvai/berni)") to help farmers connect with the terminology.
- Keep responses concise but informative — farmers are busy.
- If asked about something outside agriculture, politely redirect.
- Reference KrishiTwin platform features (scenarios, ozone analysis, \
groundwater view, crop simulation) when they can help the farmer.
- Be encouraging and supportive — Indian farmers face real challenges and \
deserve respect and empathy.
"""

# Simple in-memory conversation history (fine for hackathon demo)
_conversation_history: list[dict] = []


def _get_client():
    """Lazily create Anthropic client; returns None if no API key."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return None
    try:
        import anthropic
        return anthropic.Anthropic(api_key=api_key)
    except Exception as e:
        logger.error("Failed to create Anthropic client: %s", e)
        return None


def reset_conversation() -> None:
    """Clear conversation history."""
    _conversation_history.clear()


async def get_advisory_response(user_message: str) -> str:
    """Send user message to Claude and return the assistant reply.

    Maintains in-memory conversation history for multi-turn context.
    """
    client = _get_client()
    if client is None:
        return (
            "API key not configured — set ANTHROPIC_API_KEY environment "
            "variable to enable AI advisory. You can get a key at "
            "https://console.anthropic.com/"
        )

    # Append user turn
    _conversation_history.append({"role": "user", "content": user_message})

    try:
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            messages=_conversation_history,
        )
        assistant_text = response.content[0].text

        # Append assistant turn for conversation continuity
        _conversation_history.append(
            {"role": "assistant", "content": assistant_text}
        )
        return assistant_text

    except Exception as e:
        # Remove the user message we just added so history stays clean
        _conversation_history.pop()
        logger.exception("Claude API error")
        return (
            f"Sorry, I encountered an error while processing your question. "
            f"Please try again. (Error: {type(e).__name__})"
        )
