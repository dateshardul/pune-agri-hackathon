"""SoilGrids REST API client — global soil property data at 250m resolution."""

import logging
import math

import httpx

from app.models.schemas import SoilLayer, SoilResponse

logger = logging.getLogger(__name__)

BASE_URL = "https://rest.isric.org/soilgrids/v2.0/properties/query"

# Properties we care about for crop simulation
PROPERTIES = ["clay", "sand", "silt", "ocd", "phh2o", "bdod"]

# SoilGrids depth labels
DEPTHS = ["0-5cm", "5-15cm", "15-30cm", "30-60cm", "60-100cm"]

# Map SoilGrids property names to our schema fields + unit conversion divisors
# SoilGrids returns values in mapped units that need dividing
PROP_MAP = {
    "clay": ("clay", 10),       # g/kg (stored as g/kg * 10 → divide by 10)
    "sand": ("sand", 10),
    "silt": ("silt", 10),
    "ocd": ("organic_carbon", 10),  # g/kg
    "phh2o": ("ph", 10),       # pH * 10
    "bdod": ("bulk_density", 100),  # kg/dm³ * 100
}

# Cached soil data for Pune (18.52°N, 73.85°E) — black cotton vertisol typical of Deccan Plateau.
# Used as fallback when SoilGrids API is unavailable (frequent 503 errors).
# Values sourced from NBSS&LUP Pune soil survey reports.
PUNE_FALLBACK = SoilResponse(
    latitude=18.52,
    longitude=73.85,
    source="SoilGrids v2.0 (cached — Pune fallback)",
    layers=[
        SoilLayer(depth_label="0-5cm", clay=45.2, sand=22.1, silt=32.7, organic_carbon=8.6, ph=7.8, bulk_density=1.32),
        SoilLayer(depth_label="5-15cm", clay=46.8, sand=21.3, silt=31.9, organic_carbon=7.1, ph=7.9, bulk_density=1.35),
        SoilLayer(depth_label="15-30cm", clay=48.5, sand=20.0, silt=31.5, organic_carbon=5.4, ph=8.0, bulk_density=1.38),
        SoilLayer(depth_label="30-60cm", clay=50.1, sand=19.2, silt=30.7, organic_carbon=3.2, ph=8.1, bulk_density=1.42),
        SoilLayer(depth_label="60-100cm", clay=51.3, sand=18.5, silt=30.2, organic_carbon=1.8, ph=8.2, bulk_density=1.45),
    ],
)

# If request is within ~20km of Pune, use the cached fallback on failure
PUNE_LAT, PUNE_LON = 18.52, 73.85
PUNE_RADIUS_DEG = 0.2  # ~20km


def _is_near_pune(lat: float, lon: float) -> bool:
    return math.hypot(lat - PUNE_LAT, lon - PUNE_LON) <= PUNE_RADIUS_DEG


async def fetch_soil(lat: float, lon: float) -> SoilResponse:
    """Fetch soil properties for a location from SoilGrids v2.0.

    Falls back to cached Pune data when the API is down and the request
    is near Pune (the primary demo location).
    """
    params = {
        "lon": lon,
        "lat": lat,
        "property": PROPERTIES,
        "depth": DEPTHS,
        "value": "mean",
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(BASE_URL, params=params)
            resp.raise_for_status()
            body = resp.json()
    except Exception as exc:
        if _is_near_pune(lat, lon):
            logger.warning("SoilGrids API failed (%s), using Pune cached fallback", exc)
            return PUNE_FALLBACK
        raise

    # Parse the nested SoilGrids response into flat layers
    # Structure: body["properties"]["layers"] = [{ "name": "clay", "depths": [...] }, ...]
    raw_layers = body.get("properties", {}).get("layers", [])

    # Build a {depth_label: {field: value}} dict
    depth_data: dict[str, dict] = {d: {} for d in DEPTHS}

    for layer in raw_layers:
        prop_name = layer["name"]
        if prop_name not in PROP_MAP:
            continue
        field_name, divisor = PROP_MAP[prop_name]

        for depth_entry in layer.get("depths", []):
            depth_label = depth_entry["label"]
            if depth_label not in depth_data:
                continue
            raw_val = depth_entry.get("values", {}).get("mean")
            depth_data[depth_label][field_name] = (
                None if raw_val is None else round(raw_val / divisor, 2)
            )

    layers = [
        SoilLayer(depth_label=d, **depth_data[d])
        for d in DEPTHS
        if depth_data[d]  # skip empty depths
    ]

    return SoilResponse(latitude=lat, longitude=lon, layers=layers)
