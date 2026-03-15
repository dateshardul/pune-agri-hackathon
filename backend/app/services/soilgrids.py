"""SoilGrids REST API client — global soil property data at 250m resolution."""

import httpx

from app.models.schemas import SoilLayer, SoilResponse

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


async def fetch_soil(lat: float, lon: float) -> SoilResponse:
    """Fetch soil properties for a location from SoilGrids v2.0."""
    params = {
        "lon": lon,
        "lat": lat,
        "property": PROPERTIES,
        "depth": DEPTHS,
        "value": "mean",
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(BASE_URL, params=params)
        resp.raise_for_status()
        body = resp.json()

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
