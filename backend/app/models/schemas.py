from pydantic import BaseModel, Field


# --- Weather ---

class DailyWeather(BaseModel):
    date: str
    temperature_max: float | None = Field(None, description="Max temp (°C)")
    temperature_min: float | None = Field(None, description="Min temp (°C)")
    precipitation: float | None = Field(None, description="Precipitation (mm/day)")
    solar_radiation: float | None = Field(None, description="Solar radiation (MJ/m²/day)")
    relative_humidity: float | None = Field(None, description="Relative humidity (%)")
    wind_speed: float | None = Field(None, description="Wind speed at 2m (m/s)")


class WeatherResponse(BaseModel):
    latitude: float
    longitude: float
    start_date: str
    end_date: str
    source: str = "NASA POWER"
    data: list[DailyWeather]


# --- Soil ---

class SoilLayer(BaseModel):
    depth_label: str = Field(..., description="e.g. '0-5cm', '5-15cm'")
    clay: float | None = Field(None, description="Clay content (g/kg)")
    sand: float | None = Field(None, description="Sand content (g/kg)")
    silt: float | None = Field(None, description="Silt content (g/kg)")
    organic_carbon: float | None = Field(None, description="Organic carbon (g/kg)")
    ph: float | None = Field(None, description="Soil pH (H2O)")
    bulk_density: float | None = Field(None, description="Bulk density (kg/dm³)")


class SoilResponse(BaseModel):
    latitude: float
    longitude: float
    source: str = "SoilGrids v2.0"
    layers: list[SoilLayer]
