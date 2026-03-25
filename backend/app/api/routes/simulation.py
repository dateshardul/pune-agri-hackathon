"""Simulation endpoints — WOFOST, AquaCrop, DSSAT crop simulation + smart advisory."""

from datetime import date, timedelta

from fastapi import APIRouter, HTTPException

from app.models.schemas import (
    DailyWeather,
    NutrientAdvisoryRequest,
    ScenarioRequest,
    SimulationRequest,
    SmartAdvisoryRequest,
    WaterAdvisoryRequest,
)
from app.services.nasa_power import fetch_weather
from app.services.wofost import get_available_crops, run_wofost, get_default_sowing_date, get_default_harvest_date
from app.services.aquacrop_sim import run_aquacrop, get_aquacrop_crops, AQUACROP_CROPS
from app.services.dssat_sim import run_dssat, get_dssat_crops, DSSAT_CROPS

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


# --- AquaCrop Water Advisory ---

@router.post("/water-advisory")
async def water_advisory(req: WaterAdvisoryRequest):
    """Run AquaCrop water-stress simulation for irrigation advisory.

    Best for: drought impact analysis, irrigation scheduling,
    water productivity optimization.
    """
    try:
        sowing = date.fromisoformat(req.sowing_date) if req.sowing_date else None
        if sowing is None:
            sowing = get_default_sowing_date(req.crop)

        weather_start = sowing - timedelta(days=150)
        weather_end = min(sowing + timedelta(days=250), date.today() - timedelta(days=1))

        weather_resp = await fetch_weather(req.latitude, req.longitude, weather_start, weather_end)

        result = run_aquacrop(
            latitude=req.latitude,
            longitude=req.longitude,
            weather_data=weather_resp.data,
            crop=req.crop,
            sowing_date=sowing,
            precip_multiplier=req.precip_multiplier,
            irrigation_mm=req.irrigation_mm,
        )
        return result

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AquaCrop error: {e}")


@router.get("/water-advisory/crops")
async def list_water_crops():
    """List crops supported by AquaCrop water advisory."""
    return {"crops": get_aquacrop_crops(), "model": "AquaCrop"}


# --- DSSAT Nutrient Advisory ---

@router.post("/nutrient-advisory")
async def nutrient_advisory(req: NutrientAdvisoryRequest):
    """Run DSSAT simulation for nutrient management advisory.

    Best for: fertilizer optimization, N/P/K scheduling,
    cultivar comparison, soil nutrient dynamics.
    """
    try:
        sowing = date.fromisoformat(req.sowing_date) if req.sowing_date else None
        if sowing is None:
            sowing = get_default_sowing_date(req.crop)

        weather_start = sowing - timedelta(days=30)
        weather_end = min(sowing + timedelta(days=200), date.today() - timedelta(days=1))

        weather_resp = await fetch_weather(req.latitude, req.longitude, weather_start, weather_end)

        result = run_dssat(
            latitude=req.latitude,
            longitude=req.longitude,
            weather_data=weather_resp.data,
            crop=req.crop,
            sowing_date=sowing,
            elevation=req.elevation,
            n_kg_ha=req.n_kg_ha,
            p_kg_ha=req.p_kg_ha,
            k_kg_ha=req.k_kg_ha,
        )
        return result

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DSSAT error: {e}")


@router.get("/nutrient-advisory/crops")
async def list_nutrient_crops():
    """List crops supported by DSSAT nutrient advisory."""
    return {"crops": get_dssat_crops(), "model": "DSSAT-CSM"}


# --- Smart Multi-Model Advisory ---

@router.post("/smart-advisory")
async def smart_advisory(req: SmartAdvisoryRequest):
    """Smart multi-model advisory — runs WOFOST + AquaCrop + DSSAT as appropriate.

    Returns a unified response matching the frontend SmartAdvisory component format.
    Models are selected based on crop support:
    - WOFOST: always runs (all 13 crops)
    - AquaCrop: runs if crop is supported (8 crops)
    - DSSAT: runs if crop is supported (9 crops)
    Unsupported model sections are set to null.
    """
    try:
        sowing = date.fromisoformat(req.sowing_date) if req.sowing_date else None
        if sowing is None:
            sowing = get_default_sowing_date(req.crop)

        harvest = get_default_harvest_date(req.crop, sowing)

        weather_start = sowing - timedelta(days=150)
        weather_end = min(sowing + timedelta(days=250), date.today() - timedelta(days=1))

        weather_resp = await fetch_weather(req.latitude, req.longitude, weather_start, weather_end)

        # --- WOFOST (always runs) ---
        yield_forecast = None
        try:
            wofost_result = run_wofost(
                latitude=req.latitude, longitude=req.longitude,
                weather_data=weather_resp.data, crop=req.crop,
                sowing_date=sowing, harvest_date=harvest,
            )
            twso = wofost_result.get("summary", {}).get("TWSO", 0)
            days_sim = wofost_result.get("metadata", {}).get("days_simulated", 0)
            yield_forecast = {
                "model": "WOFOST",
                "yield_kg_ha": round(twso, 1) if twso else 0,
                "growth_days": days_sim,
                "confidence": "high" if days_sim > 60 else "medium" if days_sim > 30 else "low",
            }
        except Exception as e:
            yield_forecast = {
                "model": "WOFOST",
                "yield_kg_ha": 0,
                "growth_days": 0,
                "confidence": "low",
                "error": str(e),
            }

        # --- AquaCrop (water advisory) ---
        water_advisory_data = None
        if req.crop in AQUACROP_CROPS:
            try:
                ac_result = run_aquacrop(
                    latitude=req.latitude, longitude=req.longitude,
                    weather_data=weather_resp.data, crop=req.crop,
                    sowing_date=sowing,
                    precip_multiplier=req.precip_multiplier,
                )
                water_advisory_data = ac_result.get("water_advisory")
            except Exception as e:
                water_advisory_data = None  # graceful fallback

        # --- DSSAT (nutrient advisory) ---
        nutrient_advisory_data = None
        if req.crop in DSSAT_CROPS:
            try:
                dssat_result = run_dssat(
                    latitude=req.latitude, longitude=req.longitude,
                    weather_data=weather_resp.data, crop=req.crop,
                    sowing_date=sowing,
                    n_kg_ha=req.n_kg_ha, p_kg_ha=req.p_kg_ha, k_kg_ha=req.k_kg_ha,
                )
                nutrient_advisory_data = dssat_result.get("nutrient_advisory")
            except Exception as e:
                nutrient_advisory_data = None  # graceful fallback

        # --- Build recommendations ---
        recommendations = _build_recommendations(
            req.crop, yield_forecast, water_advisory_data, nutrient_advisory_data,
        )

        # --- Build data sources ---
        data_sources = {
            "weather": "NASA POWER (daily, satellite-derived)",
            "soil": "ISRIC SoilGrids v2.0 (250m resolution)",
            "water_model": "FAO AquaCrop" if water_advisory_data else "Not available for this crop",
            "nutrient_model": "DSSAT-CSM v4.8" if nutrient_advisory_data else "Not available for this crop",
        }

        return {
            "crop": req.crop,
            "location": {"latitude": req.latitude, "longitude": req.longitude},
            "yield_forecast": yield_forecast,
            "water_advisory": water_advisory_data,
            "nutrient_advisory": nutrient_advisory_data,
            "recommendations": recommendations,
            "data_sources": data_sources,
        }

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Smart advisory error: {e}")


def _build_recommendations(
    crop: str,
    yield_forecast: dict | None,
    water_advisory: dict | None,
    nutrient_advisory: dict | None,
) -> list[str]:
    """Generate combined plain-language recommendations."""
    recs = []

    # Yield-based
    if yield_forecast and yield_forecast.get("yield_kg_ha", 0) > 0:
        yield_t = yield_forecast["yield_kg_ha"] / 1000
        recs.append(
            f"Expected yield for {crop}: {yield_t:.1f} tonnes/ha "
            f"({yield_forecast['growth_days']} day growing season)."
        )

    # Water-based
    if water_advisory:
        drought = water_advisory.get("drought_risk", "low")
        irr_need = water_advisory.get("irrigation_need_mm", 0)
        if drought in ("high", "severe"):
            recs.append(
                f"Drought risk is {drought}. Plan {irr_need:.0f}mm supplemental irrigation "
                f"to prevent yield loss."
            )
        elif irr_need > 50:
            recs.append(
                f"Moderate water deficit expected. Schedule {irr_need:.0f}mm irrigation "
                f"across the growing season, prioritizing reproductive stages."
            )
        else:
            recs.append("Rainfall appears sufficient. Monitor soil moisture weekly.")
    else:
        recs.append(
            f"Water advisory not available for {crop} — WOFOST yield forecast used instead. "
            "Monitor soil moisture manually."
        )

    # Nutrient-based
    if nutrient_advisory:
        n = nutrient_advisory.get("nitrogen_kg_ha", 0)
        note = nutrient_advisory.get("soil_health_note", "")
        recs.append(
            f"Apply {n} kg/ha nitrogen in 3 splits (basal + 2 top-dress at 30 and 60 DAS)."
        )
        if "stress" in note.lower():
            recs.append(note)
    else:
        recs.append(
            f"Nutrient advisory not available for {crop} — follow local agricultural "
            "extension recommendations for fertilizer application."
        )

    return recs


@router.get("/smart-advisory/models")
async def list_models():
    """List all available simulation models and their crop coverage."""
    return {
        "models": {
            "wofost": {
                "name": "WOFOST 7.2",
                "focus": "Baseline yield prediction, daily growth curves",
                "crops": list(get_available_crops().keys()),
            },
            "aquacrop": {
                "name": "FAO AquaCrop",
                "focus": "Water productivity, drought impact, irrigation scheduling",
                "crops": get_aquacrop_crops(),
            },
            "dssat": {
                "name": "DSSAT-CSM v4.8",
                "focus": "Nutrient management, fertilizer optimization, cultivar comparison",
                "crops": get_dssat_crops(),
            },
        }
    }
