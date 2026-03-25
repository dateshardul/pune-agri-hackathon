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


# --- Simulation ---

class SimulationRequest(BaseModel):
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    crop: str = Field("wheat", description="Crop name (wheat, rice, maize, etc.)")
    sowing_date: str | None = Field(None, description="Sowing date (YYYY-MM-DD)")
    harvest_date: str | None = Field(None, description="Expected harvest date (YYYY-MM-DD)")
    elevation: float = Field(500.0, description="Site elevation (m)")


class ScenarioRequest(BaseModel):
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    crop: str = Field("wheat")
    sowing_date: str | None = None
    harvest_date: str | None = None
    temp_offset: float = Field(0.0, description="Temperature change (°C) to apply")
    precip_multiplier: float = Field(1.0, description="Precipitation multiplier (e.g. 0.8 = 20% less rain)")
    scenario_name: str = Field("custom", description="Scenario label")


# --- Water Advisory (AquaCrop) ---

class WaterAdvisoryRequest(BaseModel):
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    crop: str = Field("wheat", description="Crop name")
    sowing_date: str | None = Field(None, description="Sowing date (YYYY-MM-DD)")
    precip_multiplier: float = Field(1.0, description="Precipitation multiplier (e.g. 0.7 = 30% less rain)")
    irrigation_mm: float = Field(0.0, description="Planned seasonal irrigation (mm)")


# --- Nutrient Advisory (DSSAT) ---

class NutrientAdvisoryRequest(BaseModel):
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    crop: str = Field("wheat", description="Crop name")
    sowing_date: str | None = Field(None, description="Sowing date (YYYY-MM-DD)")
    elevation: float = Field(500.0, description="Site elevation (m)")
    n_kg_ha: float = Field(120.0, description="Total nitrogen application (kg/ha)")
    p_kg_ha: float = Field(60.0, description="Total phosphorus application (kg/ha)")
    k_kg_ha: float = Field(40.0, description="Total potassium application (kg/ha)")


# --- Smart Advisory (Multi-model router) ---

class SmartAdvisoryRequest(BaseModel):
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    crop: str = Field("wheat", description="Crop name")
    sowing_date: str | None = Field(None, description="Sowing date (YYYY-MM-DD)")
    advisory_type: str = Field(
        "full",
        description="Advisory focus: 'water', 'nutrient', 'yield', or 'full'"
    )
    precip_multiplier: float = Field(1.0, description="Precipitation scenario multiplier")
    n_kg_ha: float = Field(120.0, description="Nitrogen application (kg/ha)")
    p_kg_ha: float = Field(60.0, description="Phosphorus application (kg/ha)")
    k_kg_ha: float = Field(40.0, description="Potassium application (kg/ha)")
