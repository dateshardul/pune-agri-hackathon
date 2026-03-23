"""Simulation endpoints — WOFOST crop simulation + what-if scenarios."""

from datetime import date, timedelta

from fastapi import APIRouter, HTTPException

from app.models.schemas import (
    DailyWeather,
    SimulationRequest,
    ScenarioRequest,
)
from app.services.nasa_power import fetch_weather
from app.services.wofost import get_available_crops, run_wofost, get_default_sowing_date, get_default_harvest_date

router = APIRouter()


@router.get("/crops")
async def list_crops():
    """List available crops for simulation."""
    return {"crops": get_available_crops()}


@router.post("/")
async def run_simulation(req: SimulationRequest):
    """Run a WOFOST crop growth simulation.

    Fetches weather data for the location, then runs WOFOST 7.2
    water-limited production model for the specified crop and dates.
    """
    try:
        # Parse dates
        sowing = date.fromisoformat(req.sowing_date) if req.sowing_date else None
        harvest = date.fromisoformat(req.harvest_date) if req.harvest_date else None

        # Determine weather fetch range — need data from before sowing to after harvest
        if sowing and harvest:
            weather_start = sowing - timedelta(days=35)
            weather_end = harvest + timedelta(days=10)
        else:
            # Use Indian crop calendar for correct season
            sowing = get_default_sowing_date(req.crop)
            harvest = get_default_harvest_date(req.crop, sowing)
            weather_start = sowing - timedelta(days=35)
            weather_end = min(harvest + timedelta(days=10), date.today() - timedelta(days=1))

        # Fetch weather
        weather_resp = await fetch_weather(req.latitude, req.longitude, weather_start, weather_end)

        # Run simulation
        result = run_wofost(
            latitude=req.latitude,
            longitude=req.longitude,
            weather_data=weather_resp.data,
            crop=req.crop,
            sowing_date=sowing,
            harvest_date=harvest,
            elevation=req.elevation,
        )

        return result

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Simulation error: {e}")


@router.post("/scenario")
async def run_scenario(req: ScenarioRequest):
    """Run a what-if climate scenario.

    Fetches real weather data, applies the specified modifications
    (temperature offset, precipitation change), then runs WOFOST
    to show the impact on crop yield.
    """
    try:
        sowing = date.fromisoformat(req.sowing_date) if req.sowing_date else None
        harvest = date.fromisoformat(req.harvest_date) if req.harvest_date else None

        if sowing and harvest:
            weather_start = sowing - timedelta(days=35)
            weather_end = harvest + timedelta(days=10)
        else:
            sowing = get_default_sowing_date(req.crop)
            harvest = get_default_harvest_date(req.crop, sowing)
            weather_start = sowing - timedelta(days=35)
            weather_end = min(harvest + timedelta(days=10), date.today() - timedelta(days=1))

        # Fetch baseline weather
        weather_resp = await fetch_weather(req.latitude, req.longitude, weather_start, weather_end)

        # Run baseline
        baseline = run_wofost(
            latitude=req.latitude, longitude=req.longitude,
            weather_data=weather_resp.data, crop=req.crop,
            sowing_date=sowing, harvest_date=harvest,
        )

        # Apply scenario modifications to weather
        modified_weather = [
            DailyWeather(
                date=w.date,
                temperature_max=(w.temperature_max + req.temp_offset) if w.temperature_max else None,
                temperature_min=(w.temperature_min + req.temp_offset) if w.temperature_min else None,
                precipitation=(w.precipitation * req.precip_multiplier) if w.precipitation else None,
                solar_radiation=w.solar_radiation,
                relative_humidity=w.relative_humidity,
                wind_speed=w.wind_speed,
            )
            for w in weather_resp.data
        ]

        # Run scenario
        scenario = run_wofost(
            latitude=req.latitude, longitude=req.longitude,
            weather_data=modified_weather, crop=req.crop,
            sowing_date=sowing, harvest_date=harvest,
        )

        # Compare results
        baseline_yield = baseline["summary"].get("TWSO", 0)
        scenario_yield = scenario["summary"].get("TWSO", 0)
        yield_change_pct = (
            round(((scenario_yield - baseline_yield) / baseline_yield) * 100, 2)
            if baseline_yield > 0 else 0
        )

        return {
            "scenario_name": req.scenario_name,
            "modifications": {
                "temp_offset_c": req.temp_offset,
                "precip_multiplier": req.precip_multiplier,
            },
            "baseline": baseline,
            "scenario": scenario,
            "comparison": {
                "baseline_yield_kg_ha": round(baseline_yield, 2),
                "scenario_yield_kg_ha": round(scenario_yield, 2),
                "yield_change_percent": yield_change_pct,
            },
        }

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Scenario error: {e}")


PRESET_SCENARIOS = [
    {
        "name": "RCP 4.5 Mid-Century",
        "description": "Moderate emissions — +1.5°C warming, 5% less monsoon rain",
        "temp_offset": 1.5,
        "precip_multiplier": 0.95,
    },
    {
        "name": "RCP 8.5 Mid-Century",
        "description": "High emissions — +2.5°C warming, 10% less rain",
        "temp_offset": 2.5,
        "precip_multiplier": 0.90,
    },
    {
        "name": "Drought Year",
        "description": "Severe drought — +1°C, 40% less rain",
        "temp_offset": 1.0,
        "precip_multiplier": 0.60,
    },
    {
        "name": "Good Monsoon",
        "description": "Above-average monsoon — normal temp, 20% more rain",
        "temp_offset": 0.0,
        "precip_multiplier": 1.20,
    },
    {
        "name": "Heat Wave",
        "description": "Extreme heat event — +4°C, 15% less rain",
        "temp_offset": 4.0,
        "precip_multiplier": 0.85,
    },
]


@router.get("/scenarios")
async def list_scenarios():
    """List preset climate scenarios for what-if analysis."""
    return {"scenarios": PRESET_SCENARIOS}
