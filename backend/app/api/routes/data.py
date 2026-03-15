"""Data endpoints — weather and soil data for a given location."""

from datetime import date

from fastapi import APIRouter, HTTPException, Query

from app.models.schemas import WeatherResponse, SoilResponse
from app.services.nasa_power import fetch_weather
from app.services.soilgrids import fetch_soil

router = APIRouter()


@router.get("/weather", response_model=WeatherResponse)
async def get_weather(
    lat: float = Query(..., ge=-90, le=90, description="Latitude"),
    lon: float = Query(..., ge=-180, le=180, description="Longitude"),
    start: date | None = Query(None, description="Start date (YYYY-MM-DD)"),
    end: date | None = Query(None, description="End date (YYYY-MM-DD)"),
):
    """Fetch daily weather data from NASA POWER for crop modeling."""
    try:
        return await fetch_weather(lat, lon, start, end)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"NASA POWER API error: {e}")


@router.get("/soil", response_model=SoilResponse)
async def get_soil(
    lat: float = Query(..., ge=-90, le=90, description="Latitude"),
    lon: float = Query(..., ge=-180, le=180, description="Longitude"),
):
    """Fetch soil properties from SoilGrids for crop modeling."""
    try:
        return await fetch_soil(lat, lon)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"SoilGrids API error: {e}")
