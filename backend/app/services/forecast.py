"""7-day weather forecast from Open-Meteo (free, no API key)."""

import httpx

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"

# WMO weather code -> condition label
_WMO_CONDITIONS: dict[int, str] = {
    0: "Sunny", 1: "Sunny", 2: "Partly Cloudy", 3: "Overcast",
    45: "Foggy", 48: "Foggy",
    51: "Drizzle", 53: "Drizzle", 55: "Drizzle",
    61: "Rain", 63: "Rain", 65: "Heavy Rain",
    71: "Snow", 73: "Snow", 75: "Heavy Snow",
    80: "Showers", 81: "Showers", 82: "Heavy Showers",
    95: "Thunderstorm", 96: "Thunderstorm", 99: "Thunderstorm",
}


def _condition(code: int) -> str:
    return _WMO_CONDITIONS.get(code, "Unknown")


def _farming_tip(temp_max: float, precip: float, code: int) -> str:
    if precip > 10:
        return "Avoid spraying \u2014 rain expected"
    if temp_max > 40:
        return "Heat stress risk \u2014 ensure irrigation"
    if 95 <= code <= 99:
        return "Thunderstorm risk \u2014 protect nursery crops"
    if 0 <= precip <= 5 and code <= 3 and temp_max <= 35:
        return "Good for spraying/fieldwork"
    if 0 < precip <= 5:
        return "Light rain \u2014 good for sowing"
    if temp_max > 35:
        return "High heat \u2014 irrigate in evening"
    return "Normal conditions \u2014 routine fieldwork OK"


async def fetch_forecast(lat: float, lon: float) -> dict:
    """Fetch 7-day daily forecast from Open-Meteo."""
    params = {
        "latitude": lat,
        "longitude": lon,
        "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode",
        "timezone": "auto",
        "forecast_days": 7,
    }
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(OPEN_METEO_URL, params=params)
        resp.raise_for_status()
        data = resp.json()

    daily = data["daily"]
    days = []
    for i, date_str in enumerate(daily["time"]):
        t_max = daily["temperature_2m_max"][i] or 0.0
        t_min = daily["temperature_2m_min"][i] or 0.0
        precip = daily["precipitation_sum"][i] or 0.0
        code = daily["weathercode"][i] or 0
        days.append({
            "date": date_str,
            "temp_max": round(t_max, 1),
            "temp_min": round(t_min, 1),
            "precipitation_mm": round(precip, 1),
            "weather_code": code,
            "condition": _condition(code),
            "farming_tip": _farming_tip(t_max, precip, code),
        })

    return {
        "latitude": lat,
        "longitude": lon,
        "days": days,
        "source": "Open-Meteo",
    }
