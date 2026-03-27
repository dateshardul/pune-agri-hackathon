"""Copernicus Climate Data Store (CDS) integration.

Fetches ERA5 reanalysis weather data and satellite-derived products via cdsapi.
All calls are cached locally to minimize API usage.

Datasets used:
- ERA5 single-level reanalysis: high-quality 0.25° historical weather
- Satellite soil moisture (future)
- Satellite ozone (future)
"""

import asyncio
import json
import logging
import os
import tempfile
from datetime import date, datetime, timedelta
from pathlib import Path

import numpy as np

from app.services.api_cache import get_cached, set_cached

logger = logging.getLogger(__name__)

# ERA5 variables relevant for agriculture
ERA5_VARIABLES = [
    "2m_temperature",           # Temperature at 2m (K → °C)
    "total_precipitation",      # Precipitation (m → mm)
    "surface_solar_radiation_downwards",  # Solar radiation (J/m² → MJ/m²)
    "2m_dewpoint_temperature",  # Dewpoint (K → °C, for RH calculation)
    "10m_u_component_of_wind",  # U-wind component (m/s)
    "10m_v_component_of_wind",  # V-wind component (m/s)
]


def _get_cds_client():
    """Create CDS API client. Returns None if not configured."""
    try:
        import cdsapi
        return cdsapi.Client(quiet=True)
    except Exception as e:
        logger.warning("CDS API not available: %s", e)
        return None


def _kelvin_to_celsius(k: float) -> float:
    return round(k - 273.15, 2)


def _calc_rh(temp_c: float, dewpoint_c: float) -> float:
    """Calculate relative humidity from temp and dewpoint (Magnus formula)."""
    a, b = 17.27, 237.3
    gamma_t = (a * temp_c) / (b + temp_c)
    gamma_d = (a * dewpoint_c) / (b + dewpoint_c)
    rh = 100 * np.exp(gamma_d - gamma_t)
    return round(min(100, max(0, float(rh))), 1)


async def fetch_era5_weather(
    lat: float, lon: float,
    start: date, end: date,
) -> dict | None:
    """Fetch ERA5 reanalysis daily weather data for a location.

    Returns dict matching our WeatherResponse format, or None if unavailable.
    Cached for 24 hours per (lat, lon, date range).
    """
    # Round coords to 0.25° grid (ERA5 resolution)
    lat_r = round(round(lat * 4) / 4, 2)
    lon_r = round(round(lon * 4) / 4, 2)

    cache_params = {
        "lat": lat_r, "lon": lon_r,
        "start": start.isoformat(), "end": end.isoformat(),
    }

    # Check cache first (24h TTL for reanalysis — data doesn't change)
    cached = get_cached("era5_weather", ttl=86400, **cache_params)
    if cached:
        return cached

    client = _get_cds_client()
    if client is None:
        return None

    # ERA5 data has ~5 day latency — don't request recent dates
    safe_end = min(end, date.today() - timedelta(days=6))
    if safe_end < start:
        logger.info("ERA5: requested dates too recent (start=%s, safe_end=%s)", start, safe_end)
        return None

    # Build request — fetch daily aggregates via hourly data at noon
    years = sorted(set(str(d.year) for d in _date_range(start, safe_end)))
    months = sorted(set(f"{d.month:02d}" for d in _date_range(start, safe_end)))
    days = sorted(set(f"{d.day:02d}" for d in _date_range(start, safe_end)))

    request = {
        "product_type": ["reanalysis"],
        "variable": ERA5_VARIABLES,
        "year": years,
        "month": months,
        "day": days,
        "time": ["06:00", "12:00", "18:00"],  # 3 times for daily min/max
        "data_format": "netcdf",
        "download_format": "unarchived",
        "area": [lat_r + 0.25, lon_r - 0.25, lat_r - 0.25, lon_r + 0.25],  # N, W, S, E
    }

    try:
        # Run synchronous CDS call in thread executor
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, lambda: _download_era5(client, request))
        if result is None:
            return None

        # Cache the result
        set_cached("era5_weather", result, **cache_params)
        return result

    except Exception as e:
        logger.warning("ERA5 fetch failed: %s", e)
        return None


def _download_era5(client, request: dict) -> dict | None:
    """Synchronous ERA5 download and parse."""
    try:
        import netCDF4  # noqa: N813

        with tempfile.NamedTemporaryFile(suffix=".nc", delete=False) as f:
            tmp_path = f.name

        logger.info("Fetching ERA5 data (this may take 30-60s)...")
        client.retrieve("reanalysis-era5-single-levels", request, tmp_path)

        # Parse NetCDF
        ds = netCDF4.Dataset(tmp_path)
        try:
            times = netCDF4.num2date(ds.variables["time"][:], ds.variables["time"].units)

            # Group by date for daily aggregation
            daily_data: dict[str, dict] = {}
            for i, t in enumerate(times):
                day_str = t.strftime("%Y-%m-%d") if hasattr(t, 'strftime') else str(t)[:10]
                if day_str not in daily_data:
                    daily_data[day_str] = {"temps": [], "precip": 0, "rad": 0, "dewp": [], "u": [], "v": []}

                dd = daily_data[day_str]
                dd["temps"].append(float(ds.variables["t2m"][i, 0, 0]))
                dd["precip"] += float(ds.variables["tp"][i, 0, 0])
                dd["rad"] += float(ds.variables["ssrd"][i, 0, 0])
                dd["dewp"].append(float(ds.variables["d2m"][i, 0, 0]))
                dd["u"].append(float(ds.variables["u10"][i, 0, 0]))
                dd["v"].append(float(ds.variables["v10"][i, 0, 0]))

            # Convert to our format
            weather_days = []
            for day_str in sorted(daily_data.keys()):
                dd = daily_data[day_str]
                temps_c = [_kelvin_to_celsius(t) for t in dd["temps"]]
                dewps_c = [_kelvin_to_celsius(d) for d in dd["dewp"]]
                wind_speeds = [np.sqrt(u**2 + v**2) for u, v in zip(dd["u"], dd["v"])]

                temp_max = max(temps_c)
                temp_min = min(temps_c)
                temp_mean = sum(temps_c) / len(temps_c)
                dewp_mean = sum(dewps_c) / len(dewps_c)

                weather_days.append({
                    "date": day_str,
                    "temperature_max": round(temp_max, 1),
                    "temperature_min": round(temp_min, 1),
                    "precipitation": round(dd["precip"] * 1000, 2),  # m → mm
                    "solar_radiation": round(dd["rad"] / 1e6, 2),    # J/m² → MJ/m²
                    "relative_humidity": _calc_rh(temp_mean, dewp_mean),
                    "wind_speed": round(sum(wind_speeds) / len(wind_speeds), 2),
                })

            result = {
                "source": "ERA5 Reanalysis (Copernicus CDS)",
                "resolution": "0.25° (~31km)",
                "days": len(weather_days),
                "data": weather_days,
            }
            return result

        finally:
            ds.close()
            os.unlink(tmp_path)

    except ImportError:
        logger.warning("netCDF4 not installed — pip install netCDF4")
        return None
    except Exception as e:
        logger.warning("ERA5 parse failed: %s", e)
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        return None


def _date_range(start: date, end: date) -> list[date]:
    """Generate list of dates from start to end inclusive."""
    dates = []
    current = start
    while current <= end:
        dates.append(current)
        current += timedelta(days=1)
    return dates


async def get_era5_summary(lat: float, lon: float, days: int = 30) -> dict | None:
    """Get a quick ERA5 weather summary for the last N days.

    Returns summary stats (avg temp, total precip, etc.) or None.
    """
    end = date.today() - timedelta(days=6)
    start = end - timedelta(days=days)
    result = await fetch_era5_weather(lat, lon, start, end)
    if not result or not result.get("data"):
        return None

    data = result["data"]
    return {
        "source": result["source"],
        "period": f"{start.isoformat()} to {end.isoformat()}",
        "days": len(data),
        "avg_temp_max": round(sum(d["temperature_max"] for d in data) / len(data), 1),
        "avg_temp_min": round(sum(d["temperature_min"] for d in data) / len(data), 1),
        "total_precip_mm": round(sum(d["precipitation"] for d in data), 1),
        "avg_solar_rad": round(sum(d["solar_radiation"] for d in data) / len(data), 2),
        "avg_humidity": round(sum(d["relative_humidity"] for d in data) / len(data), 1),
        "avg_wind": round(sum(d["wind_speed"] for d in data) / len(data), 2),
    }
