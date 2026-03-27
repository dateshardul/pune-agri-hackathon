"""Unified farm analysis — single-call orchestrator for all data + models.

Runs complete farm analysis: parallel data fetch, sowing optimization,
parallel model simulations (WOFOST + AquaCrop + DSSAT), ML prediction,
and combined recommendations.
"""

import asyncio
import logging
from datetime import date, timedelta

from app.models.schemas import DailyWeather
from app.services.aquacrop_sim import AQUACROP_CROPS, run_aquacrop
from app.services.dssat_sim import DSSAT_CROPS, run_dssat
from app.services.elevation import fetch_elevation_grid
from app.services.forecast import fetch_forecast
from app.services.groundwater import fetch_groundwater_analysis
from app.services.ml_predictor import extract_features, predictor
from app.services.ozone_sight import fetch_ozone_analysis
from app.services.soilgrids import fetch_soil
from app.services.sowing_optimizer import optimize_sowing_period
from app.services.wofost import CROP_CALENDAR, get_default_harvest_date, run_wofost

logger = logging.getLogger(__name__)


async def _safe(coro, label: str, default=None):
    """Run a coroutine, returning default on failure."""
    try:
        return await coro
    except Exception as e:
        logger.warning("%s failed: %s", label, e)
        return default


def _run_wofost_safe(weather_data, **kwargs):
    try:
        return run_wofost(weather_data=weather_data, **kwargs)
    except Exception as e:
        logger.warning("WOFOST failed: %s", e)
        return None


def _run_aquacrop_safe(weather_data, **kwargs):
    try:
        return run_aquacrop(weather_data=weather_data, **kwargs)
    except Exception as e:
        logger.warning("AquaCrop failed: %s", e)
        return None


def _run_dssat_safe(weather_data, **kwargs):
    try:
        return run_dssat(weather_data=weather_data, **kwargs)
    except Exception as e:
        logger.warning("DSSAT failed: %s", e)
        return None


def _build_weather_summary(weather_data: list[DailyWeather]) -> dict:
    """Summarize weather data into key stats."""
    if not weather_data:
        return {}
    temps_max = [w.temperature_max or 30.0 for w in weather_data]
    temps_min = [w.temperature_min or 20.0 for w in weather_data]
    precips = [w.precipitation or 0.0 for w in weather_data]
    rads = [w.solar_radiation or 15.0 for w in weather_data]
    n = len(weather_data)
    return {
        "days": n,
        "avg_temp_max": round(sum(temps_max) / n, 1),
        "avg_temp_min": round(sum(temps_min) / n, 1),
        "total_precip_mm": round(sum(precips), 1),
        "avg_solar_rad_mj": round(sum(rads) / n, 1),
    }


def _compute_unified_score(
    wofost_result: dict | None,
    aquacrop_result: dict | None,
    dssat_result: dict | None,
    ozone_result: dict | None,
    gw_result: dict | None,
    crop: str,
) -> dict:
    """Compute 0-100 composite score from all model outputs."""
    # Yield score (from WOFOST)
    yield_score = 50
    if wofost_result:
        summary = wofost_result.get("summary", {})
        twso = summary.get("TWSO", 0) or 0
        if twso == 0:
            twso = (summary.get("TAGP", 0) or 0) * 0.45
        from app.services.ml_predictor import CROP_BASE_YIELDS
        base = CROP_BASE_YIELDS.get(crop, 3000)
        yield_score = min(100, max(0, int(twso / base * 80)))

    # Water score (from AquaCrop)
    water_score = 50
    if aquacrop_result:
        wa = aquacrop_result.get("water_advisory", {})
        dr = wa.get("drought_risk", "moderate")
        water_score = {"low": 85, "moderate": 60, "high": 35, "severe": 15}.get(dr, 50)
        wp = wa.get("water_productivity_kg_m3", 0)
        water_score = min(100, water_score + int(wp * 5))

    # Nutrient score (from DSSAT)
    nutrient_score = 50
    if dssat_result:
        nu = dssat_result.get("nutrient_uptake", {})
        n_stress = nu.get("n_stress_total")
        if n_stress is not None:
            nutrient_score = min(100, max(0, int((1.0 - n_stress) * 100)))
        else:
            nutrient_score = 65

    # Risk score (ozone + groundwater)
    risk_score = 70
    if ozone_result:
        yl = ozone_result.get("yield_impact", {})
        ozone_loss = yl.get("yield_loss_percent", 0)
        risk_score = max(0, 100 - int(ozone_loss * 5))
    if gw_result:
        cat = gw_result.get("aquifer", {}).get("category", "semi-critical")
        gw_penalty = {"safe": 0, "semi-critical": 10, "over-exploited": 25}.get(cat, 10)
        risk_score = max(0, risk_score - gw_penalty)

    overall = int(0.35 * yield_score + 0.25 * water_score + 0.20 * nutrient_score + 0.20 * risk_score)
    return {
        "overall": min(100, max(0, overall)),
        "yield_score": yield_score,
        "water_score": water_score,
        "nutrient_score": nutrient_score,
        "risk_score": risk_score,
    }


def _build_recommendations(
    wofost_result: dict | None,
    aquacrop_result: dict | None,
    dssat_result: dict | None,
    ozone_result: dict | None,
    gw_result: dict | None,
    sowing_result: dict | None,
    unified_score: dict,
    crop: str,
) -> list[str]:
    """Generate top plain-language action items."""
    recs = []

    # Sowing recommendation
    if sowing_result:
        analysis = sowing_result.get("analysis", {})
        op = analysis.get("optimal_period", {})
        if op.get("start"):
            recs.append(
                f"Sow {crop} during {op['start']} to {op['end']} "
                f"for optimal yield ({op.get('vs_standard_pct', '')} vs average)."
            )

    # Water recommendations
    if aquacrop_result:
        wa = aquacrop_result.get("water_advisory", {})
        irr = wa.get("irrigation_need_mm", 0)
        if irr > 50:
            recs.append(f"Plan {irr:.0f} mm irrigation over the season to meet crop water demand.")
        dr = wa.get("drought_risk", "low")
        if dr in ("high", "severe"):
            recs.append("High drought risk — consider drip irrigation or mulching to conserve moisture.")

    # Nutrient recommendations
    if dssat_result:
        adv = dssat_result.get("nutrient_advisory", {})
        if adv:
            n = adv.get("nitrogen_kg_ha", 0)
            recs.append(f"Apply {n} kg/ha nitrogen in 3 splits (basal + 2 top-dress) for optimal nutrition.")

    # Ozone warning
    if ozone_result:
        sev = ozone_result.get("yield_impact", {}).get("severity", "low")
        if sev in ("moderate", "high", "severe"):
            recs.append(f"Ozone exposure risk is {sev} — consider tolerant varieties or adjusted sowing dates.")

    # Groundwater warning
    if gw_result:
        cat = gw_result.get("aquifer", {}).get("category", "safe")
        if cat == "over-exploited":
            recs.append("Groundwater is over-exploited — switch to low-water crops or adopt micro-irrigation.")
        elif cat == "semi-critical":
            recs.append("Groundwater is semi-critical — monitor usage and consider rainwater harvesting.")

    # Overall score context
    if unified_score["overall"] >= 75:
        recs.append("Conditions are favorable for a good harvest. Monitor weather forecasts weekly.")
    elif unified_score["overall"] < 50:
        recs.append("Multiple risk factors detected. Consider diversifying crops or adjusting management.")

    return recs[:7]


async def analyze_farm(
    lat: float,
    lon: float,
    crop: str,
    field_area_ha: float = 1.0,
    elevation: float = 500.0,
    preferred_sowing: str | None = None,
    water_budget_mm: float | None = None,
) -> dict:
    """Run complete farm analysis — all data sources + all models.

    Orchestrates:
    1. Parallel data fetch: weather, soil, elevation, groundwater, ozone, forecast
    2. Sowing optimization (season -> month -> week)
    3. Parallel model runs: WOFOST, AquaCrop, DSSAT
    4. Unified ML prediction using all model outputs as features
    5. Combined recommendations
    """
    crop = crop.lower().strip()
    data_sources = {}

    # ── Phase 1: Parallel data fetch ──
    cal = CROP_CALENDAR.get(crop, (11, 1, 120))
    duration = cal[2]

    # Determine weather range needed (sowing optimizer fetches its own, but we
    # need weather for model runs too)
    today = date.today()
    weather_start = today - timedelta(days=365)
    weather_end = today - timedelta(days=1)

    from app.services.sowing_optimizer import _fetch_weather_for_range

    weather_task = _fetch_weather_for_range(lat, lon, weather_start, weather_end)
    soil_task = _safe(fetch_soil(lat, lon), "SoilGrids")
    elevation_task = _safe(fetch_elevation_grid(lat, lon, size_px=64), "Elevation")
    gw_task = _safe(fetch_groundwater_analysis(lat, lon), "Groundwater")
    ozone_task = _safe(fetch_ozone_analysis(lat, lon, crop), "Ozone")
    forecast_task = _safe(fetch_forecast(lat, lon), "Forecast")

    (weather_data, weather_source), soil_resp, elev_data, gw_result, ozone_result, forecast_result = (
        await asyncio.gather(
            weather_task, soil_task, elevation_task, gw_task, ozone_task, forecast_task,
        )
    )

    data_sources["weather"] = weather_source
    data_sources["soil"] = "SoilGrids v2.0" if soil_resp else "unavailable"
    data_sources["elevation"] = elev_data.get("source", "unavailable") if elev_data else "unavailable"
    data_sources["groundwater"] = "CGWB/GRACE-FO" if gw_result else "unavailable"
    data_sources["ozone"] = "OzoneSight v0.1" if ozone_result else "unavailable"
    data_sources["forecast"] = "Open-Meteo" if forecast_result else "unavailable"

    # Use elevation from DEM if available
    if elev_data and elev_data.get("min_elevation"):
        elev_range = {
            "min": round(elev_data["min_elevation"], 1),
            "max": round(elev_data["max_elevation"], 1),
        }
        # Use midpoint for simulations if not overridden
        if elevation == 500.0:
            elevation = round((elev_data["min_elevation"] + elev_data["max_elevation"]) / 2, 1)
    else:
        elev_range = {"min": elevation, "max": elevation}

    # ── Phase 2: Sowing optimization ──
    sowing_result = None
    try:
        sowing_result = await optimize_sowing_period(lat, lon, crop, elevation)
        data_sources["sowing_optimizer"] = "multi-model (WOFOST+AquaCrop+DSSAT)"
    except Exception as e:
        logger.warning("Sowing optimizer failed: %s", e)
        data_sources["sowing_optimizer"] = "unavailable"

    # Determine sowing date for model runs
    if preferred_sowing:
        sowing_date = date.fromisoformat(preferred_sowing)
    elif sowing_result:
        op = sowing_result.get("analysis", {}).get("optimal_period", {})
        if op.get("start"):
            try:
                sowing_date = date.fromisoformat(op["start"])
            except (ValueError, TypeError):
                sowing_date = date(today.year - 1, cal[0], cal[1])
        else:
            sowing_date = date(today.year - 1, cal[0], cal[1])
    else:
        sowing_date = date(today.year - 1, cal[0], cal[1])

    harvest_date = get_default_harvest_date(crop, sowing_date)
    # Cap harvest to available weather
    if weather_data:
        last_weather_date = date.fromisoformat(weather_data[-1].date)
        if harvest_date > last_weather_date:
            harvest_date = last_weather_date

    # ── Phase 3: Parallel model simulations ──
    loop = asyncio.get_event_loop()

    # Extract soil layers for DSSAT
    soil_layers = None
    if soil_resp and hasattr(soil_resp, "layers"):
        soil_layers = soil_resp.layers

    wofost_future = loop.run_in_executor(None, lambda: _run_wofost_safe(
        weather_data, latitude=lat, longitude=lon, crop=crop,
        sowing_date=sowing_date, harvest_date=harvest_date, elevation=elevation,
    ))

    aquacrop_future = None
    if crop in AQUACROP_CROPS:
        clay_pct = None
        if soil_resp and hasattr(soil_resp, "layers") and soil_resp.layers:
            c = soil_resp.layers[0].clay
            clay_pct = c / 10 if c and c > 10 else c
        aquacrop_future = loop.run_in_executor(None, lambda: _run_aquacrop_safe(
            weather_data, latitude=lat, longitude=lon, crop=crop,
            sowing_date=sowing_date, clay_pct=clay_pct,
        ))

    dssat_future = None
    if crop in DSSAT_CROPS:
        dssat_future = loop.run_in_executor(None, lambda: _run_dssat_safe(
            weather_data, latitude=lat, longitude=lon, crop=crop,
            sowing_date=sowing_date, soil_layers=soil_layers, elevation=elevation,
        ))

    # Gather model results
    futures = [wofost_future]
    idx_aquacrop = None
    idx_dssat = None
    if aquacrop_future:
        idx_aquacrop = len(futures)
        futures.append(aquacrop_future)
    if dssat_future:
        idx_dssat = len(futures)
        futures.append(dssat_future)

    results = await asyncio.gather(*futures)

    wofost_result = results[0]
    aquacrop_result = results[idx_aquacrop] if idx_aquacrop is not None else None
    dssat_result = results[idx_dssat] if idx_dssat is not None else None

    data_sources["wofost"] = "WOFOST 7.2" if wofost_result else "unavailable"
    data_sources["aquacrop"] = "AquaCrop v7" if aquacrop_result else ("not supported for " + crop if crop not in AQUACROP_CROPS else "unavailable")
    data_sources["dssat"] = "DSSAT-CSM v4.8" if dssat_result else ("not supported for " + crop if crop not in DSSAT_CROPS else "unavailable")

    # ── Phase 4: ML prediction + unified score ──
    # Build features for ML predictor
    weather_dicts = [
        {
            "temperature_max": w.temperature_max,
            "temperature_min": w.temperature_min,
            "precipitation": w.precipitation,
            "solar_radiation": w.solar_radiation,
            "relative_humidity": w.relative_humidity,
            "wind_speed": w.wind_speed,
        }
        for w in weather_data
    ]
    soil_dicts = None
    if soil_resp and hasattr(soil_resp, "layers"):
        soil_dicts = [
            {
                "clay": l.clay, "sand": l.sand, "organic_carbon": l.organic_carbon,
                "ph": l.ph, "bulk_density": l.bulk_density,
            }
            for l in soil_resp.layers
        ]

    ozone_loss = 0.0
    if ozone_result:
        ozone_loss = ozone_result.get("yield_impact", {}).get("yield_loss_percent", 0.0)

    gw_stage = 50.0
    gw_depth = 10.0
    if gw_result:
        aq = gw_result.get("aquifer", {})
        gw_stage = aq.get("stage_of_extraction_pct", 50.0)
        gw_depth = aq.get("current_depth_m", 10.0)

    features = extract_features(
        weather_data=weather_dicts, soil_layers=soil_dicts, crop=crop,
        lat=lat, lon=lon, elevation=elevation,
        ozone_loss_pct=ozone_loss, gw_extraction_stage=gw_stage, gw_depth_m=gw_depth,
    )

    # Add model output features if available
    if wofost_result:
        summary = wofost_result.get("summary", {})
        features["wofost_yield_estimate"] = float(summary.get("TWSO", 0) or 0)
    else:
        features["wofost_yield_estimate"] = 0.0

    if aquacrop_result:
        wa = aquacrop_result.get("water_advisory", {})
        features["aquacrop_water_productivity"] = float(wa.get("water_productivity_kg_m3", 0))
    else:
        features["aquacrop_water_productivity"] = 0.0

    if dssat_result:
        nu = dssat_result.get("nutrient_uptake", {})
        features["dssat_n_stress"] = float(nu.get("n_stress_total") or 0.5)
    else:
        features["dssat_n_stress"] = 0.5

    ml_prediction = None
    try:
        ml_prediction = predictor.predict(features)
        data_sources["ml_predictor"] = "GradientBoosting (multi-modal)"
    except Exception as e:
        logger.warning("ML prediction failed: %s", e)
        data_sources["ml_predictor"] = "unavailable"

    # Unified score
    unified_score = _compute_unified_score(
        wofost_result, aquacrop_result, dssat_result, ozone_result, gw_result, crop,
    )

    # Recommendations
    recommendations = _build_recommendations(
        wofost_result, aquacrop_result, dssat_result,
        ozone_result, gw_result, sowing_result, unified_score, crop,
    )

    # ── Build response ──
    # WOFOST summary
    wofost_out = None
    if wofost_result:
        s = wofost_result.get("summary", {})
        twso = s.get("TWSO", 0) or 0
        tagp = s.get("TAGP", 0) or 0
        if twso == 0 and tagp > 0:
            twso = tagp * 0.45
        wofost_out = {
            "yield_kg_ha": round(float(twso), 1),
            "total_biomass_kg_ha": round(float(tagp), 1),
            "growth_days": wofost_result.get("metadata", {}).get("days_simulated", 0),
            "model": "WOFOST 7.2",
        }

    # AquaCrop summary
    aquacrop_out = None
    if aquacrop_result:
        wa = aquacrop_result.get("water_advisory", {})
        aquacrop_out = {
            "irrigation_need_mm": wa.get("irrigation_need_mm", 0),
            "drought_risk": wa.get("drought_risk", "unknown"),
            "water_productivity_kg_m3": wa.get("water_productivity_kg_m3", 0),
            "schedule": wa.get("schedule", [])[:5],  # top 5 entries
            "model": "AquaCrop v7",
        }

    # DSSAT summary
    dssat_out = None
    if dssat_result:
        adv = dssat_result.get("nutrient_advisory", {})
        dssat_out = {
            "nitrogen_kg_ha": adv.get("nitrogen_kg_ha", 0),
            "phosphorus_kg_ha": adv.get("phosphorus_kg_ha", 0),
            "potassium_kg_ha": adv.get("potassium_kg_ha", 0),
            "applications": adv.get("applications", []),
            "n_stress": dssat_result.get("nutrient_uptake", {}).get("n_stress_total"),
            "model": "DSSAT-CSM v4.8",
        }

    # Sowing summary
    sowing_out = None
    if sowing_result:
        analysis = sowing_result.get("analysis", {})
        sowing_out = {
            "optimal_period": analysis.get("optimal_period", {}),
            "season": analysis.get("best_season", {}).get("season", "unknown"),
            "best_month": analysis.get("best_month", {}).get("month", "unknown"),
            "best_week": analysis.get("best_week", {}).get("period", "N/A"),
        }

    # Soil summary
    soil_out = None
    if soil_resp and hasattr(soil_resp, "layers") and soil_resp.layers:
        top = soil_resp.layers[0]
        soil_out = {
            "clay_g_kg": top.clay,
            "sand_g_kg": top.sand,
            "organic_carbon_g_kg": top.organic_carbon,
            "ph": top.ph,
            "bulk_density": top.bulk_density,
            "depth": top.depth_label,
        }

    # Groundwater summary
    gw_out = None
    if gw_result:
        aq = gw_result.get("aquifer", {})
        gw_out = {
            "category": aq.get("category"),
            "current_depth_m": aq.get("current_depth_m"),
            "annual_decline_m": aq.get("annual_decline_m"),
            "extraction_pct": aq.get("stage_of_extraction_pct"),
            "region": aq.get("region_name"),
        }

    # Ozone summary
    ozone_out = None
    if ozone_result:
        yi = ozone_result.get("yield_impact", {})
        ozone_out = {
            "yield_loss_pct": yi.get("yield_loss_percent", 0),
            "severity": yi.get("severity", "low"),
            "mean_ozone_ppb": ozone_result.get("exposure", {}).get("mean_ozone_ppb"),
        }

    return {
        "farm": {
            "latitude": lat,
            "longitude": lon,
            "field_area_ha": field_area_ha,
            "elevation_range": elev_range,
            "crop": crop,
            "sowing_date": sowing_date.isoformat(),
            "harvest_date": harvest_date.isoformat(),
        },
        "environment": {
            "weather_summary": _build_weather_summary(weather_data),
            "forecast": forecast_result.get("days", []) if forecast_result else [],
            "soil": soil_out,
            "groundwater": gw_out,
            "ozone": ozone_out,
        },
        "sowing": sowing_out,
        "models": {
            "wofost": wofost_out,
            "aquacrop": aquacrop_out,
            "dssat": dssat_out,
        },
        "ml_prediction": ml_prediction,
        "unified_score": unified_score,
        "recommendations": recommendations,
        "data_sources": data_sources,
    }
