"""Multi-modal ML yield prediction endpoints.

CropNet-inspired architecture: fuses weather + soil + ozone + groundwater
features and compares ML predictions with WOFOST mechanistic simulation.
"""

import asyncio
from datetime import date, timedelta

from fastapi import APIRouter, HTTPException

from app.models.schemas import SimulationRequest
from app.services.ml_predictor import predictor, extract_features, CROP_BASE_YIELDS
from app.services.nasa_power import fetch_weather
from app.services.soilgrids import fetch_soil
from app.services.ozone_sight import estimate_aot40, estimate_yield_loss
from app.services.groundwater import fetch_groundwater_analysis
from app.services.wofost import run_wofost

router = APIRouter()


@router.post("/")
async def predict_yield(req: SimulationRequest):
    """Run multi-modal ML yield prediction alongside WOFOST.

    Fetches all available data sources (weather, soil, ozone, groundwater),
    extracts features, runs both ML and WOFOST models, returns comparison.
    """
    if req.crop not in CROP_BASE_YIELDS:
        raise HTTPException(status_code=400, detail=f"Unknown crop '{req.crop}'")

    if not predictor.is_trained:
        raise HTTPException(status_code=503, detail="ML model not yet trained — server starting up")

    try:
        # Parse dates
        sowing = date.fromisoformat(req.sowing_date) if req.sowing_date else None
        harvest = date.fromisoformat(req.harvest_date) if req.harvest_date else None

        if sowing and harvest:
            weather_start = sowing - timedelta(days=35)
            weather_end = harvest + timedelta(days=10)
        else:
            weather_end = date.today() - timedelta(days=1)
            weather_start = weather_end - timedelta(days=180)

        # Fetch all data sources in parallel
        weather_task = fetch_weather(req.latitude, req.longitude, weather_start, weather_end)
        soil_task = fetch_soil(req.latitude, req.longitude)
        gw_task = fetch_groundwater_analysis(req.latitude, req.longitude)

        results = await asyncio.gather(
            weather_task, soil_task, gw_task,
            return_exceptions=True,
        )

        weather_resp = results[0] if not isinstance(results[0], Exception) else None
        soil_resp = results[1] if not isinstance(results[1], Exception) else None
        gw_resp = results[2] if not isinstance(results[2], Exception) else None

        # Track which data sources were available
        data_sources: dict[str, str] = {}
        data_sources["weather"] = "NASA POWER" if weather_resp else "unavailable (using defaults)"
        data_sources["soil"] = (soil_resp.source if soil_resp else "unavailable (using defaults)")
        data_sources["groundwater"] = "CGWB/GRACE-FO" if gw_resp else "unavailable (using defaults)"

        # Ozone analysis (sync, no API call needed)
        sowing_for_ozone = sowing or (date.today() - timedelta(days=60))
        ozone_exposure = estimate_aot40(req.latitude, req.longitude, sowing_for_ozone)
        ozone_loss = estimate_yield_loss(req.crop, ozone_exposure["aot40_ppb_h"])
        data_sources["ozone"] = "OzoneSight regional climatology"

        # Extract features for ML
        weather_dicts = [w.model_dump() for w in weather_resp.data] if weather_resp else []
        soil_dicts = [l.model_dump() for l in soil_resp.layers] if soil_resp else None

        gw_extraction = gw_resp.get("aquifer", {}).get("stage_of_extraction_pct", 50.0) if isinstance(gw_resp, dict) else 50.0
        gw_depth = gw_resp.get("aquifer", {}).get("current_depth_m", 10.0) if isinstance(gw_resp, dict) else 10.0

        features = extract_features(
            weather_data=weather_dicts,
            soil_layers=soil_dicts,
            crop=req.crop,
            lat=req.latitude,
            lon=req.longitude,
            elevation=req.elevation,
            ozone_loss_pct=ozone_loss["yield_loss_percent"],
            gw_extraction_stage=gw_extraction,
            gw_depth_m=gw_depth,
        )

        # Run ML prediction
        ml_result = predictor.predict(features)

        # Run WOFOST for comparison
        wofost_result = None
        wofost_yield = 0.0
        if weather_resp and weather_resp.data:
            try:
                wofost_result = run_wofost(
                    latitude=req.latitude,
                    longitude=req.longitude,
                    weather_data=weather_resp.data,
                    crop=req.crop,
                    sowing_date=sowing,
                    harvest_date=harvest,
                    elevation=req.elevation,
                )
                wofost_yield = wofost_result.get("summary", {}).get("TWSO", 0)
            except Exception:
                data_sources["wofost"] = "simulation failed"
        else:
            data_sources["wofost"] = "skipped (no weather data)"

        if wofost_result:
            data_sources["wofost"] = "WOFOST 7.2 water-limited"

        # Compute agreement
        ml_yield = ml_result["yield_kg_ha"]
        if wofost_yield > 0 and ml_yield > 0:
            max_val = max(wofost_yield, ml_yield)
            diff = abs(wofost_yield - ml_yield)
            agreement_pct = round(max(0, (1 - diff / max_val) * 100), 1)
        else:
            agreement_pct = 0.0

        return {
            "wofost": wofost_result,
            "ml_prediction": ml_result,
            "comparison": {
                "wofost_yield_kg_ha": round(wofost_yield, 1),
                "ml_yield_kg_ha": ml_yield,
                "agreement_pct": agreement_pct,
            },
            "ozone_impact": ozone_loss,
            "data_sources": data_sources,
            "extensibility_note": (
                "This multi-modal architecture is designed to accept real observed yield data "
                "(e.g., ICAR district statistics, farmer-reported yields, or satellite-derived "
                "estimates) with zero code changes — only the training labels need to be replaced."
            ),
        }

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Prediction error: {e}")


@router.get("/feature-importance")
async def get_feature_importance():
    """Return global feature importance ranking from the trained ML model."""
    if not predictor.is_trained:
        raise HTTPException(status_code=503, detail="ML model not yet trained")
    return {"features": predictor.get_global_feature_importance()}
