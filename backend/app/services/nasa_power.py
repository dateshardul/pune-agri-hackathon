"""NASA POWER API client — free daily weather data for agriculture."""

from datetime import date, timedelta

import httpx

from app.models.schemas import DailyWeather, WeatherResponse

BASE_URL = "https://power.larc.nasa.gov/api/temporal/daily/point"

# Parameters relevant for crop modeling
PARAMETERS = [
    "T2M_MAX",      # Max temperature at 2m (°C)
    "T2M_MIN",      # Min temperature at 2m (°C)
    "PRECTOTCORR",  # Precipitation corrected (mm/day)
    "ALLSKY_SFC_SW_DWN",  # Solar radiation (MJ/m²/day)
    "RH2M",         # Relative humidity at 2m (%)
    "WS2M",         # Wind speed at 2m (m/s)
]

PARAM_MAP = {
    "T2M_MAX": "temperature_max",
    "T2M_MIN": "temperature_min",
    "PRECTOTCORR": "precipitation",
    "ALLSKY_SFC_SW_DWN": "solar_radiation",
    "RH2M": "relative_humidity",
    "WS2M": "wind_speed",
}


async def fetch_weather(
    lat: float,
    lon: float,
    start: date | None = None,
    end: date | None = None,
) -> WeatherResponse:
    """Fetch daily weather from NASA POWER for a given location.

    Defaults to the last 30 days if no dates are provided.
    """
    if end is None:
        end = date.today() - timedelta(days=1)
    if start is None:
        start = end - timedelta(days=29)

    params = {
        "parameters": ",".join(PARAMETERS),
        "community": "AG",
        "longitude": lon,
        "latitude": lat,
        "start": start.strftime("%Y%m%d"),
        "end": end.strftime("%Y%m%d"),
        "format": "JSON",
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(BASE_URL, params=params)
        resp.raise_for_status()
        body = resp.json()

    properties = body["properties"]["parameter"]

    # Build per-day records — NASA POWER keys dates as "YYYYMMDD"
    dates = sorted(properties[PARAMETERS[0]].keys())
    daily: list[DailyWeather] = []

    for d in dates:
        values: dict = {"date": f"{d[:4]}-{d[4:6]}-{d[6:]}"}
        for nasa_key, field_name in PARAM_MAP.items():
            raw = properties[nasa_key].get(d)
            # NASA POWER uses -999.0 as fill value for missing data
            values[field_name] = None if raw is None or raw == -999.0 else raw
        daily.append(DailyWeather(**values))

    return WeatherResponse(
        latitude=lat,
        longitude=lon,
        start_date=start.isoformat(),
        end_date=end.isoformat(),
        data=daily,
    )
