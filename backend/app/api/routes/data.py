"""Data endpoints — weather, soil, forecast, and ERA5 climate data."""

from datetime import date

from fastapi import APIRouter, HTTPException, Query

from app.models.schemas import WeatherResponse, SoilResponse
from app.services.nasa_power import fetch_weather
from app.services.soilgrids import fetch_soil
from app.services.forecast import fetch_forecast
from app.services.copernicus_cds import fetch_era5_weather, get_era5_summary
from app.services.api_cache import get_call_stats

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


@router.get("/forecast")
async def get_forecast(
    lat: float = Query(..., ge=-90, le=90, description="Latitude"),
    lon: float = Query(..., ge=-180, le=180, description="Longitude"),
):
    """Fetch 7-day weather forecast from Open-Meteo."""
    try:
        return await fetch_forecast(lat, lon)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Open-Meteo API error: {e}")


@router.get("/soil", response_model=SoilResponse)
async def get_soil(
    lat: float = Query(..., ge=-90, le=90, description="Latitude"),
    lon: float = Query(..., ge=-180, le=180, description="Longitude"),
):
    """Fetch soil properties from SoilGrids for crop modeling.

    Automatically falls back to cached data for Pune when SoilGrids is down.
    """
    try:
        return await fetch_soil(lat, lon)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"SoilGrids API error: {e}")


@router.get("/era5")
async def get_era5(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    start: date | None = Query(None, description="Start date"),
    end: date | None = Query(None, description="End date"),
):
    """Fetch ERA5 reanalysis weather data from Copernicus CDS.

    Higher quality than NASA POWER (0.25° resolution, validated reanalysis).
    Results are cached for 24 hours. ERA5 has ~5 day latency.
    """
    from datetime import timedelta
    if end is None:
        end = date.today() - timedelta(days=6)
    if start is None:
        start = end - timedelta(days=29)
    try:
        result = await fetch_era5_weather(lat, lon, start, end)
        if result is None:
            raise HTTPException(status_code=503, detail="ERA5 data unavailable — CDS API not configured or dates too recent")
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"CDS API error: {e}")


@router.get("/era5/summary")
async def get_era5_summary_endpoint(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    days: int = Query(30, ge=7, le=365),
):
    """Get ERA5 weather summary for the last N days."""
    try:
        result = await get_era5_summary(lat, lon, days)
        if result is None:
            raise HTTPException(status_code=503, detail="ERA5 summary unavailable")
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"CDS API error: {e}")


@router.get("/api-stats")
async def api_stats():
    """Return API call statistics — cache hit rates, call counts by service."""
    return get_call_stats()
