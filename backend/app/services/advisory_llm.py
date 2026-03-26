"""Claude-powered LLM advisory service for KrishiTwin.

Injects real-time farm context (weather, soil, groundwater, ozone) from
the user's location so Claude gives advice grounded in actual conditions.
"""

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
- **Use the real-time farm data** provided in the conversation to give specific, \
location-aware advice. Reference actual temperature, soil pH, groundwater status, \
ozone risk when relevant — don't give generic answers when you have real data.
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
_cached_context: str | None = None
_cached_context_key: tuple[float, float] | None = None


async def _build_farm_context(lat: float, lon: float) -> str:
    """Fetch real-time farm data and build context string for Claude."""
    context_parts = []

    # Weather (latest days)
    try:
        from app.services.nasa_power import fetch_weather
        from datetime import date, timedelta
        weather = await fetch_weather(lat, lon, date.today() - timedelta(days=7), date.today())
        if weather and weather.data:
            latest = weather.data[-1]
            context_parts.append(
                f"Weather ({latest.date}): "
                f"Temp {latest.temperature_max}°C / {latest.temperature_min}°C, "
                f"Rain: {latest.precipitation} mm, "
                f"Humidity: {latest.relative_humidity}%, "
                f"Solar: {latest.solar_radiation} MJ/m²/day, "
                f"Wind: {latest.wind_speed} m/s"
            )
    except Exception as e:
        logger.debug("Weather context fetch failed: %s", e)

    # 7-day forecast
    try:
        from app.services.forecast import fetch_forecast
        forecast = await fetch_forecast(lat, lon)
        if forecast and forecast.get("days"):
            days = forecast["days"][:3]  # next 3 days
            forecast_str = ", ".join(
                f"{d['date']}: {d['condition']} {d['temp_max']}°C/{d['temp_min']}°C rain:{d['precipitation_mm']}mm"
                for d in days
            )
            context_parts.append(f"3-day forecast: {forecast_str}")
    except Exception as e:
        logger.debug("Forecast context fetch failed: %s", e)

    # Soil
    try:
        from app.services.soilgrids import fetch_soil
        soil = await fetch_soil(lat, lon)
        if soil and soil.layers:
            top = soil.layers[0]
            context_parts.append(
                f"Soil (topsoil {top.depth_label}): "
                f"Clay {top.clay}%, Sand {top.sand}%, "
                f"pH {top.ph}, Organic Carbon {top.organic_carbon} g/kg, "
                f"Source: {soil.source}"
            )
    except Exception as e:
        logger.debug("Soil context fetch failed: %s", e)

    # Groundwater
    try:
        from app.services.groundwater import fetch_groundwater_analysis
        gw = await fetch_groundwater_analysis(lat, lon)
        aq = gw.get("aquifer", {})
        context_parts.append(
            f"Groundwater: {aq.get('category', 'unknown')} status, "
            f"depth {aq.get('current_depth_m')}m below ground, "
            f"extraction {aq.get('stage_of_extraction_pct')}% of recharge, "
            f"declining {aq.get('annual_decline_m')}m/year"
        )
    except Exception as e:
        logger.debug("Groundwater context fetch failed: %s", e)

    # Ozone
    try:
        from app.services.ozone_sight import fetch_ozone_analysis
        ozone = await fetch_ozone_analysis(lat, lon)
        loss = ozone.get("yield_impact", {})
        exp = ozone.get("exposure", {})
        context_parts.append(
            f"Ozone: mean {exp.get('mean_ozone_ppb')} ppb, "
            f"yield loss risk {loss.get('yield_loss_percent', 0)}% "
            f"({loss.get('severity', 'unknown')})"
        )
    except Exception as e:
        logger.debug("Ozone context fetch failed: %s", e)

    if context_parts:
        return (
            f"REAL-TIME FARM DATA for ({lat:.2f}°N, {lon:.2f}°E):\n"
            + "\n".join(f"• {p}" for p in context_parts)
        )
    return ""


def _get_context_summary(context: str) -> str | None:
    """Extract a short summary from context for the UI indicator."""
    if not context:
        return None
    lines = [l.strip("• ") for l in context.split("\n") if l.startswith("•")]
    # First line has location, grab key facts
    parts = []
    for line in lines:
        if line.startswith("Weather"):
            # Extract temp
            import re
            temp = re.search(r"Temp (\S+°C)", line)
            if temp:
                parts.append(temp.group(1))
        elif line.startswith("Soil"):
            ph = re.search(r"pH (\S+)", line)
            if ph:
                parts.append(f"pH {ph.group(1)}")
        elif line.startswith("Groundwater"):
            status = re.search(r"(\w[\w-]*) status", line)
            if status:
                parts.append(f"GW: {status.group(1)}")
        elif line.startswith("Ozone"):
            sev = re.search(r"\((\w+)\)", line)
            if sev:
                parts.append(f"O₃: {sev.group(1)}")
    return ", ".join(parts) if parts else None


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
    """Clear conversation history and cached context."""
    global _cached_context, _cached_context_key
    _conversation_history.clear()
    _cached_context = None
    _cached_context_key = None


async def get_advisory_response(
    user_message: str,
    latitude: float | None = None,
    longitude: float | None = None,
) -> tuple[str, str | None]:
    """Send user message to Claude and return (reply, context_summary).

    When lat/lon are provided, fetches real-time farm data and injects
    it as conversation context so Claude gives location-specific advice.
    """
    global _cached_context, _cached_context_key

    client = _get_client()
    if client is None:
        return (
            "API key not configured — set ANTHROPIC_API_KEY environment "
            "variable to enable AI advisory. You can get a key at "
            "https://console.anthropic.com/",
            None,
        )

    # Build/cache farm context (fetch once per location, not per message)
    context_summary = None
    if latitude is not None and longitude is not None:
        context_key = (round(latitude, 2), round(longitude, 2))
        if _cached_context_key != context_key:
            _cached_context = await _build_farm_context(latitude, longitude)
            _cached_context_key = context_key
            logger.info("Built farm context for (%.2f, %.2f): %d chars",
                       latitude, longitude, len(_cached_context or ""))
        context_summary = _get_context_summary(_cached_context or "")

    # Append user turn
    _conversation_history.append({"role": "user", "content": user_message})

    try:
        # Build messages with context injection
        messages = []
        if _cached_context:
            messages.append({
                "role": "user",
                "content": (
                    f"[System context — use this data to inform your advice, "
                    f"but do not repeat it verbatim unless asked]\n\n"
                    f"{_cached_context}"
                ),
            })
            messages.append({
                "role": "assistant",
                "content": (
                    "I have your real-time farm data including weather, soil, "
                    "groundwater, and ozone conditions. How can I help you today?"
                ),
            })
        messages.extend(_conversation_history)

        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            messages=messages,
        )
        assistant_text = response.content[0].text

        # Append assistant turn for conversation continuity
        _conversation_history.append(
            {"role": "assistant", "content": assistant_text}
        )
        return assistant_text, context_summary

    except Exception as e:
        # Remove the user message we just added so history stays clean
        _conversation_history.pop()
        logger.exception("Claude API error")
        return (
            f"Sorry, I encountered an error while processing your question. "
            f"Please try again. (Error: {type(e).__name__})",
            context_summary,
        )
