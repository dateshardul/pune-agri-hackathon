"""Unified farm analysis — multi-crop spatial planner with hazard analysis.

Runs complete farm analysis:
  Phase 1: Parallel data fetch (weather, soil, elevation, groundwater, ozone, landcover, forecast)
  Phase 2: Land analysis (elevation stats, hillshade, landcover)
  Phase 3: Per-crop analysis (zone assignment, sowing, models, hazards, feasibility)
  Phase 4: Planting timeline
  Phase 5: Combined recommendations
"""

import asyncio
import logging
from datetime import date, timedelta

from app.models.schemas import DailyWeather
from app.services.aquacrop_sim import AQUACROP_CROPS, run_aquacrop
from app.services.dssat_sim import DSSAT_CROPS, run_dssat
from app.services.elevation import compute_hillshade, fetch_elevation_grid
from app.services.forecast import fetch_forecast
from app.services.groundwater import fetch_groundwater_analysis
from app.services.landcover import fetch_landcover
from app.services.ml_predictor import CROP_BASE_YIELDS, extract_features, predictor
from app.services.ozone_sight import fetch_ozone_analysis
from app.services.soilgrids import fetch_soil
from app.services.sowing_optimizer import CROP_SEASONS, CROP_TEMP_RANGES, optimize_sowing_period
from app.services.wofost import CROP_CALENDAR, get_default_harvest_date, run_wofost

logger = logging.getLogger(__name__)

# Water needs (mm/season) — used for zone assignment (high water → valley)
CROP_WATER_NEED = {
    "wheat": 400, "rice": 1200, "maize": 600, "chickpea": 250,
    "cotton": 700, "sorghum": 350, "millet": 300, "groundnut": 450,
    "soybean": 500, "sugarcane": 1800, "potato": 500, "mungbean": 250,
    "pigeonpea": 350,
}

# Zone colors for terrain visualization
ZONE_COLORS = [
    "#4caf50", "#2196f3", "#ff9800", "#9c27b0", "#e91e63",
    "#00bcd4", "#8bc34a", "#ffc107", "#3f51b5", "#795548",
]


# ── Helpers ──────────────────────────────────────────────────────────────────

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


# ── Phase 2: Land Analysis ──────────────────────────────────────────────────

def _compute_land_analysis(elev_data: dict | None, landcover: dict | None, field_area_ha: float) -> dict:
    """Compute elevation stats, slope, hillshade, and landcover summary."""
    elevation = {"min": 500, "max": 500, "mean": 500, "slope_pct": 0.0}
    hillshade = {"sun_exposure_pct": 75.0, "shaded_pct": 25.0}

    if elev_data and elev_data.get("height_data"):
        import numpy as np
        arr = np.array(elev_data["height_data"])
        w = elev_data.get("width", 1)
        h = elev_data.get("height", 1)
        elevation["min"] = round(float(np.min(arr)), 1)
        elevation["max"] = round(float(np.max(arr)), 1)
        elevation["mean"] = round(float(np.mean(arr)), 1)
        # Slope: rise/run as percentage
        if w > 1 and h > 1:
            elev_range = float(np.max(arr) - np.min(arr))
            # Approximate ground distance from pixel count * 30m
            diag_m = max(1, ((w * 30) ** 2 + (h * 30) ** 2) ** 0.5)
            elevation["slope_pct"] = round(elev_range / diag_m * 100, 1)

        # Hillshade
        hs = compute_hillshade(elev_data["height_data"], w, h)
        hillshade = {
            "sun_exposure_pct": hs["sun_exposure_pct"],
            "shaded_pct": hs["shaded_pct"],
        }

    lc_summary = {
        "cropland_pct": 70.0, "trees_pct": 15.0, "built_pct": 8.0,
        "water_pct": 3.0, "bare_pct": 2.0, "grass_pct": 2.0,
        "usable_area_ha": round(0.7 * field_area_ha, 2),
    }
    if landcover:
        lc_summary = {
            "cropland_pct": landcover.get("cropland_pct", 70),
            "trees_pct": landcover.get("trees_pct", 15),
            "built_pct": landcover.get("built_pct", 8),
            "water_pct": landcover.get("water_pct", 3),
            "bare_pct": landcover.get("bare_pct", 2),
            "grass_pct": landcover.get("grass_pct", 2),
            "usable_area_ha": landcover.get("usable_area_ha", round(0.7 * field_area_ha, 2)),
        }

    return {
        "elevation": elevation,
        "hillshade": hillshade,
        "landcover": lc_summary,
    }


# ── Phase 3a: Zone Assignment ───────────────────────────────────────────────

def _assign_crop_zones(
    crops: list[str],
    elev_data: dict | None,
    landcover: dict | None,
    weather_data: list[DailyWeather],
    gw_result: dict | None,
    field_area_ha: float,
) -> dict[str, dict]:
    """Assign each crop to a terrain zone based on water needs and hazards.

    Strategy:
    - Sort crops by water need (highest water → valley, lowest → hilltop)
    - Check for flood risk in valley → move water-hungry crop to slope
    - Only assign to cropland area
    """
    if not crops:
        return {}

    # Get elevation range
    elev_min = 500.0
    elev_max = 600.0
    if elev_data:
        elev_min = elev_data.get("min_elevation", 500)
        elev_max = elev_data.get("max_elevation", 600)
    elev_range = max(1, elev_max - elev_min)

    # Compute usable area — user's stated field_area_ha is authoritative
    # (LULC at 10m may misclassify small farms as built-up)
    cropland_frac = 0.7
    if landcover:
        cropland_frac = landcover.get("cropland_pct", 70) / 100
    usable_ha = max(field_area_ha * 0.5, cropland_frac * field_area_ha)  # at least 50% usable

    # Check flood risk: >150mm in any week of monsoon months
    has_flood_risk = False
    if weather_data:
        weekly_precip = {}
        for w in weather_data:
            if w.precipitation and w.date:
                try:
                    d = date.fromisoformat(w.date)
                    week_key = d.isocalendar()[1]
                    weekly_precip[week_key] = weekly_precip.get(week_key, 0) + (w.precipitation or 0)
                except (ValueError, TypeError):
                    pass
        has_flood_risk = any(p > 150 for p in weekly_precip.values())

    # Sort crops by water need descending
    sorted_crops = sorted(crops, key=lambda c: CROP_WATER_NEED.get(c, 500), reverse=True)

    # Define zone types based on number of crops
    n = len(sorted_crops)
    zone_defs = []
    if n == 1:
        zone_defs = [("valley-slope", 0.0, 1.0)]
    elif n == 2:
        zone_defs = [("valley", 0.0, 0.5), ("hilltop", 0.5, 1.0)]
    else:
        # valley, slope, hilltop — then cycle
        base_zones = [
            ("valley", 0.0, 0.25),
            ("slope", 0.25, 0.75),
            ("hilltop", 0.75, 1.0),
        ]
        if n <= 3:
            zone_defs = base_zones[:n]
            # Adjust ranges for equal split
            step = 1.0 / n
            zone_defs = [
                (base_zones[i][0] if i < 3 else f"zone-{i+1}", i * step, (i + 1) * step)
                for i in range(n)
            ]
        else:
            step = 1.0 / n
            for i in range(n):
                if i == 0:
                    ztype = "valley"
                elif i == n - 1:
                    ztype = "hilltop"
                else:
                    ztype = "slope"
                zone_defs.append((ztype, i * step, (i + 1) * step))

    zones = {}
    for i, crop in enumerate(sorted_crops):
        ztype, frac_lo, frac_hi = zone_defs[i]

        # Flood hazard override: if valley and flood risk, move to slope
        reason = f"High water need ({CROP_WATER_NEED.get(crop, 500)}mm) — assigned to {ztype}"
        if ztype == "valley" and has_flood_risk:
            ztype = "slope"
            reason += " (moved from valley due to flood risk >150mm/week)"

        elev_lo = round(elev_min + frac_lo * elev_range, 1)
        elev_hi = round(elev_min + frac_hi * elev_range, 1)
        area_frac = frac_hi - frac_lo
        area_ha = round(usable_ha * area_frac, 2)

        zones[crop] = {
            "type": ztype,
            "elevation_range": [elev_lo, elev_hi],
            "area_ha": area_ha,
            "area_fraction": round(area_frac, 2),
            "color": ZONE_COLORS[i % len(ZONE_COLORS)],
            "reason": reason,
        }

    return zones


# ── Phase 3d: Crop-Cycle Hazard Analysis ────────────────────────────────────

def _analyze_crop_cycle_hazards(
    weather_data: list[DailyWeather],
    crop: str,
    sowing_date: date,
    harvest_date: date,
    zone_type: str,
    soil_clay_pct: float | None,
) -> dict:
    """Week-by-week hazard analysis across the sowing→harvest period.

    Checks: flood, drought, heat waves, frost, waterlogging, leaching.
    Returns weekly calendar and mitigations.
    """
    temp_range = CROP_TEMP_RANGES.get(crop, {"frost_limit": 5, "optimal": (20, 30)})
    frost_limit = temp_range.get("frost_limit", 5)
    duration_days = (harvest_date - sowing_date).days
    num_weeks = max(1, duration_days // 7)

    # Filter weather to crop cycle
    cycle_weather = []
    for w in weather_data:
        if not w.date:
            continue
        try:
            d = date.fromisoformat(w.date)
            if sowing_date <= d <= harvest_date:
                cycle_weather.append(w)
        except (ValueError, TypeError):
            pass

    # Build weekly buckets
    weekly_calendar = []
    mitigations = set()
    overall_risks = {"flood": 0, "drought": 0, "heat": 0, "frost": 0, "waterlogging": 0}

    for week_num in range(num_weeks):
        week_start = sowing_date + timedelta(days=week_num * 7)
        week_end = week_start + timedelta(days=6)

        week_days = [
            w for w in cycle_weather
            if w.date and week_start <= date.fromisoformat(w.date) <= week_end
        ]

        risk = "low"
        notes = []

        if not week_days:
            weekly_calendar.append({"week": week_num + 1, "risk": "low", "note": "No data"})
            continue

        week_precip = sum(w.precipitation or 0 for w in week_days)
        week_tmax = [w.temperature_max or 30 for w in week_days]
        week_tmin = [w.temperature_min or 20 for w in week_days]

        # Flood: >150mm in a week
        if week_precip > 150:
            risk = "high"
            notes.append(f"Flood risk — {week_precip:.0f}mm rainfall")
            overall_risks["flood"] += 1
            mitigations.add("Ensure field drainage channels are clear before monsoon weeks")

        # Drought: check if this + previous week are both <5mm
        if week_precip < 5:
            prev_precip = weekly_calendar[-1].get("_precip", 999) if weekly_calendar else 999
            if prev_precip < 5:
                risk = max(risk, "moderate", key=lambda r: ["low", "moderate", "high"].index(r))
                # Only escalate to high after 3+ consecutive dry weeks
                consecutive_dry = 1
                for prev_entry in reversed(weekly_calendar):
                    if prev_entry.get("_precip", 999) < 5:
                        consecutive_dry += 1
                    else:
                        break
                if consecutive_dry >= 3:
                    risk = "high"
                    overall_risks["drought"] += 1
                notes.append(f"Drought risk — {consecutive_dry + 1} consecutive weeks below 5mm")
                mitigations.add("Arrange supplemental irrigation for dry spells")
            else:
                notes.append("Dry week — monitor soil moisture")

        # Heat: 3+ days >40C
        hot_days = sum(1 for t in week_tmax if t > 40)
        if hot_days >= 3:
            risk = max(risk, "high", key=lambda r: ["low", "moderate", "high"].index(r))
            notes.append(f"Heat wave — {hot_days} days above 40°C")
            overall_risks["heat"] += 1
            mitigations.add("Apply mulch and increase irrigation frequency during heat waves")

        # Frost: Tmin below crop threshold
        frost_days = sum(1 for t in week_tmin if t < frost_limit)
        if frost_days > 0:
            risk = max(risk, "moderate", key=lambda r: ["low", "moderate", "high"].index(r))
            notes.append(f"Frost risk — {frost_days} days below {frost_limit}°C")
            overall_risks["frost"] += 1
            mitigations.add(f"Protect seedlings from frost (min temp threshold: {frost_limit}°C)")

        # Waterlogging: heavy rain + high clay
        if soil_clay_pct and soil_clay_pct > 35 and week_precip > 80:
            risk = max(risk, "moderate", key=lambda r: ["low", "moderate", "high"].index(r))
            notes.append("Waterlogging risk — heavy clay + high rainfall")
            overall_risks["waterlogging"] += 1
            mitigations.add("Improve field drainage; consider raised bed planting in clay soils")

        # Leaching: heavy rain near fertilizer timing (weeks 3-4 or 8-9)
        fert_weeks = {3, 4, 8, 9}
        if week_num + 1 in fert_weeks and week_precip > 80:
            notes.append("Nutrient leaching risk — delay fertilizer application")
            mitigations.add("Split fertilizer applications; delay top-dress if heavy rain forecast")

        if not notes:
            growth_stage = "germination" if week_num < 3 else ("vegetative" if week_num < num_weeks * 0.6 else "maturation")
            notes.append(f"Good conditions for {growth_stage}")

        entry = {"week": week_num + 1, "risk": risk, "note": "; ".join(notes)}
        entry["_precip"] = week_precip  # internal, for drought continuity check
        weekly_calendar.append(entry)

    # Clean internal fields
    for entry in weekly_calendar:
        entry.pop("_precip", None)

    # Determine overall risk
    total_high = sum(1 for w in weekly_calendar if w["risk"] == "high")
    total_mod = sum(1 for w in weekly_calendar if w["risk"] == "moderate")
    if total_high >= 3:
        overall_risk = "high"
    elif total_high >= 1 or total_mod >= 3:
        overall_risk = "moderate"
    else:
        overall_risk = "low"

    return {
        "overall_risk": overall_risk,
        "risk_summary": overall_risks,
        "weekly_calendar": weekly_calendar[:20],  # cap at 20 weeks
        "mitigations": sorted(mitigations),
    }


# ── Phase 3e: Feasibility Check ─────────────────────────────────────────────

def _check_feasibility(
    crop: str,
    wofost_result: dict | None,
    aquacrop_result: dict | None,
    hazards: dict,
    gw_result: dict | None,
) -> dict:
    """Check if the crop is viable at this location. Returns feasibility dict."""
    viable = True
    severity = None
    reasons = []
    alternatives = []

    # Check yield
    yield_kg = 0
    if wofost_result:
        s = wofost_result.get("summary", {})
        yield_kg = s.get("TWSO", 0) or 0
        if yield_kg == 0:
            yield_kg = (s.get("TAGP", 0) or 0) * 0.45

    if yield_kg == 0:
        viable = False
        severity = "impossible"
        reasons.append(f"{crop.capitalize()} yielded 0 kg/ha — conditions too unfavorable for growth")

    # Check drought risk
    if aquacrop_result:
        dr = aquacrop_result.get("water_advisory", {}).get("drought_risk", "low")
        if dr == "severe":
            viable = False
            severity = severity or "critical"
            water_need = CROP_WATER_NEED.get(crop, 500)
            reasons.append(f"Severe drought risk — {crop} needs {water_need}mm but water is insufficient")

    # Check groundwater
    if gw_result:
        cat = gw_result.get("aquifer", {}).get("category", "safe")
        extraction = gw_result.get("aquifer", {}).get("stage_of_extraction_pct", 0)
        water_need = CROP_WATER_NEED.get(crop, 500)
        if cat == "over-exploited" and water_need > 600:
            viable = False
            severity = severity or "critical"
            reasons.append(
                f"Groundwater over-exploited (extraction {extraction}%) "
                f"— {crop} needs {water_need}mm which requires heavy irrigation"
            )

    # Check hazard severity
    if hazards.get("overall_risk") == "high":
        high_weeks = sum(1 for w in hazards.get("weekly_calendar", []) if w["risk"] == "high")
        total_weeks = len(hazards.get("weekly_calendar", []))
        if high_weeks > total_weeks * 0.3:
            if severity is None:
                severity = "warning"
            reasons.append(f"{high_weeks}/{total_weeks} weeks have high risk — yield may be 30%+ below potential")

    # Suggest alternatives if not viable
    if not viable:
        # Recommend low-water, hardy crops
        alt_candidates = [
            ("millet", "Drought-tolerant (300mm), fast-growing (90 days)"),
            ("sorghum", "Low water need (350mm), heat-resistant"),
            ("chickpea", "Nitrogen-fixing, only 250mm water needed"),
            ("pigeonpea", "Deep roots, tolerates poor soils"),
            ("groundnut", "Moderate water (450mm), good for sandy soils"),
        ]
        alternatives = [
            {"crop": c, "reason": r}
            for c, r in alt_candidates
            if c != crop and c not in reasons
        ][:3]

    return {
        "viable": viable,
        "severity": severity,
        "reasons": reasons,
        "alternatives": alternatives,
    }


# ── Per-crop model simulation ───────────────────────────────────────────────

async def _run_crop_models(
    crop: str,
    lat: float, lon: float,
    weather_data: list[DailyWeather],
    sowing_date: date,
    harvest_date: date,
    elevation: float,
    soil_resp,
    soil_layers,
) -> tuple[dict | None, dict | None, dict | None]:
    """Run WOFOST + AquaCrop + DSSAT for a single crop."""
    loop = asyncio.get_event_loop()

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

    futures = [wofost_future]
    idx_ac = None
    idx_ds = None
    if aquacrop_future:
        idx_ac = len(futures)
        futures.append(aquacrop_future)
    if dssat_future:
        idx_ds = len(futures)
        futures.append(dssat_future)

    results = await asyncio.gather(*futures)
    wofost = results[0]
    aquacrop = results[idx_ac] if idx_ac is not None else None
    dssat = results[idx_ds] if idx_ds is not None else None
    return wofost, aquacrop, dssat


def _format_model_outputs(
    crop: str,
    wofost_result: dict | None,
    aquacrop_result: dict | None,
    dssat_result: dict | None,
) -> dict:
    """Format model outputs for response."""
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

    aquacrop_out = None
    if aquacrop_result:
        wa = aquacrop_result.get("water_advisory", {})
        aquacrop_out = {
            "irrigation_need_mm": wa.get("irrigation_need_mm", 0),
            "drought_risk": wa.get("drought_risk", "unknown"),
            "water_productivity_kg_m3": wa.get("water_productivity_kg_m3", 0),
            "schedule": wa.get("schedule", [])[:5],
            "model": "AquaCrop v7",
        }

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

    return {"wofost": wofost_out, "aquacrop": aquacrop_out, "dssat": dssat_out}


def _compute_unified_score(
    wofost_result: dict | None,
    aquacrop_result: dict | None,
    dssat_result: dict | None,
    ozone_result: dict | None,
    gw_result: dict | None,
    crop: str,
) -> dict:
    """Compute 0-100 composite score from all model outputs."""
    yield_score = 50
    if wofost_result:
        summary = wofost_result.get("summary", {})
        twso = summary.get("TWSO", 0) or 0
        if twso == 0:
            twso = (summary.get("TAGP", 0) or 0) * 0.45
        base = CROP_BASE_YIELDS.get(crop, 3000)
        yield_score = min(100, max(0, int(twso / base * 80)))

    water_score = 50
    if aquacrop_result:
        wa = aquacrop_result.get("water_advisory", {})
        dr = wa.get("drought_risk", "moderate")
        water_score = {"low": 85, "moderate": 60, "high": 35, "severe": 15}.get(dr, 50)
        wp = wa.get("water_productivity_kg_m3", 0)
        water_score = min(100, water_score + int(wp * 5))

    nutrient_score = 50
    if dssat_result:
        nu = dssat_result.get("nutrient_uptake", {})
        n_stress = nu.get("n_stress_total")
        if n_stress is not None:
            nutrient_score = min(100, max(0, int((1.0 - n_stress) * 100)))
        else:
            nutrient_score = 65

    risk_score = 70
    if ozone_result:
        ozone_loss = ozone_result.get("yield_impact", {}).get("yield_loss_percent", 0)
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


# ── Phase 4: Planting Timeline ──────────────────────────────────────────────

def _build_planting_timeline(crop_plans: list[dict]) -> list[dict]:
    """Build chronological planting timeline from all crop plans."""
    events = []
    for plan in crop_plans:
        crop = plan["crop"]
        sowing = plan.get("sowing", {})
        season = sowing.get("season", "unknown")

        sow_date = plan.get("_sowing_date")
        harv_date = plan.get("_harvest_date")

        if sow_date:
            events.append({
                "date": sow_date.isoformat(),
                "month": sow_date.strftime("%B"),
                "crop": crop,
                "action": f"Sow {crop} ({season})",
                "type": "sowing",
            })
        if harv_date:
            events.append({
                "date": harv_date.isoformat(),
                "month": harv_date.strftime("%B"),
                "crop": crop,
                "action": f"Harvest {crop}",
                "type": "harvest",
            })

    events.sort(key=lambda e: e["date"])
    return events


# ── Phase 5: Combined Recommendations ───────────────────────────────────────

def _build_combined_recommendations(
    crop_plans: list[dict],
    ozone_result: dict | None,
    gw_result: dict | None,
) -> list[str]:
    """Merge recommendations from all crops + add rotation advice."""
    recs = []

    for plan in crop_plans:
        crop = plan["crop"]
        sowing = plan.get("sowing", {})
        op = sowing.get("optimal_period", {})
        if op.get("start"):
            recs.append(
                f"Sow {crop} during {op['start']} to {op['end']} "
                f"for optimal yield ({op.get('vs_standard_pct', '')} vs average)."
            )

        models = plan.get("models", {})
        ac = models.get("aquacrop")
        if ac and ac.get("irrigation_need_mm", 0) > 50:
            recs.append(f"{crop.capitalize()}: plan {ac['irrigation_need_mm']:.0f}mm irrigation over the season.")

        if ac and ac.get("drought_risk") in ("high", "severe"):
            recs.append(f"{crop.capitalize()}: high drought risk — consider drip irrigation or mulching.")

        ds = models.get("dssat")
        if ds and ds.get("nitrogen_kg_ha", 0) > 0:
            recs.append(f"{crop.capitalize()}: apply {ds['nitrogen_kg_ha']}kg/ha nitrogen in 3 splits.")

    # Ozone
    if ozone_result:
        sev = ozone_result.get("yield_impact", {}).get("severity", "low")
        if sev in ("moderate", "high", "severe"):
            recs.append(f"Ozone exposure risk is {sev} — consider tolerant varieties or adjusted sowing dates.")

    # Groundwater
    if gw_result:
        cat = gw_result.get("aquifer", {}).get("category", "safe")
        if cat == "over-exploited":
            recs.append("Groundwater is over-exploited — switch to low-water crops or adopt micro-irrigation.")
        elif cat == "semi-critical":
            recs.append("Groundwater is semi-critical — monitor usage and consider rainwater harvesting.")

    # Crop rotation advice
    if len(crop_plans) >= 2:
        crop_names = [p["crop"] for p in crop_plans]
        seasons = set(p.get("sowing", {}).get("season", "") for p in crop_plans)
        if "kharif" in seasons and "rabi" in seasons:
            recs.append(
                f"Good crop rotation: {' → '.join(crop_names)} covers both kharif and rabi seasons, "
                "maintaining soil fertility year-round."
            )
        # Legume rotation advice
        legumes = {"chickpea", "mungbean", "soybean", "groundnut", "pigeonpea"}
        if any(c in legumes for c in crop_names):
            leg = [c for c in crop_names if c in legumes][0]
            recs.append(f"Including {leg} (legume) fixes atmospheric nitrogen, reducing fertilizer needs for subsequent crops.")

    return recs[:10]


# ── Main Entry Point ────────────────────────────────────────────────────────

async def analyze_farm(
    lat: float,
    lon: float,
    crops: list[str],
    field_area_ha: float = 1.0,
    elevation: float = 500.0,
    preferred_sowing: str | None = None,
    water_budget_mm: float | None = None,
) -> dict:
    """Run complete multi-crop farm analysis.

    Orchestrates:
    1. Parallel data fetch: weather, soil, elevation, groundwater, ozone, landcover, forecast
    2. Land analysis: elevation stats, hillshade, landcover
    3. Per-crop: zone assignment, sowing optimization, model runs, hazard analysis, feasibility
    4. Planting timeline
    5. Combined recommendations
    """
    crops = [c.lower().strip() for c in crops]
    # Validate crops against known calendar
    valid_crops = [c for c in crops if c in CROP_CALENDAR]
    if not valid_crops:
        valid_crops = ["rice"]  # fallback
    crops = valid_crops

    data_sources = {}

    # ── Phase 1: Parallel data fetch ──
    today = date.today()
    weather_start = today - timedelta(days=365)
    weather_end = today - timedelta(days=1)

    from app.services.sowing_optimizer import _fetch_weather_for_range

    weather_task = _fetch_weather_for_range(lat, lon, weather_start, weather_end)
    soil_task = _safe(fetch_soil(lat, lon), "SoilGrids")
    elevation_task = _safe(fetch_elevation_grid(lat, lon, size_px=64), "Elevation")
    gw_task = _safe(fetch_groundwater_analysis(lat, lon), "Groundwater")
    ozone_task = _safe(fetch_ozone_analysis(lat, lon, crops[0]), "Ozone")
    forecast_task = _safe(fetch_forecast(lat, lon), "Forecast")
    landcover_task = _safe(fetch_landcover(lat, lon, field_area_ha), "Landcover")

    (
        (weather_data, weather_source),
        soil_resp, elev_data, gw_result, ozone_result, forecast_result, landcover_result,
    ) = await asyncio.gather(
        weather_task, soil_task, elevation_task, gw_task, ozone_task, forecast_task, landcover_task,
    )

    data_sources["weather"] = weather_source
    data_sources["soil"] = "SoilGrids v2.0" if soil_resp else "unavailable"
    data_sources["elevation"] = elev_data.get("source", "unavailable") if elev_data else "unavailable"
    data_sources["groundwater"] = "CGWB/GRACE-FO" if gw_result else "unavailable"
    data_sources["ozone"] = "OzoneSight v0.1" if ozone_result else "unavailable"
    data_sources["forecast"] = "Open-Meteo" if forecast_result else "unavailable"
    data_sources["landcover"] = landcover_result.get("source", "unavailable") if landcover_result else "unavailable"

    # Use elevation from DEM if available
    if elev_data and elev_data.get("min_elevation"):
        if elevation == 500.0:
            elevation = round((elev_data["min_elevation"] + elev_data["max_elevation"]) / 2, 1)

    # Extract soil properties
    soil_layers = None
    soil_clay_pct = None
    if soil_resp and hasattr(soil_resp, "layers") and soil_resp.layers:
        soil_layers = soil_resp.layers
        c = soil_resp.layers[0].clay
        soil_clay_pct = c / 10 if c and c > 10 else c

    # ── Phase 2: Land Analysis ──
    land_analysis = _compute_land_analysis(elev_data, landcover_result, field_area_ha)

    # ── Phase 3: Per-Crop Analysis ──
    # 3a: Zone assignment
    zones = _assign_crop_zones(crops, elev_data, landcover_result, weather_data, gw_result, field_area_ha)

    # 3b-e: For each crop — sowing, models, hazards, feasibility
    crop_plans = []
    for crop in crops:
        plan = {"crop": crop}

        # Zone
        plan["zone"] = zones.get(crop, {
            "type": "slope", "elevation_range": [elevation, elevation],
            "area_ha": round(field_area_ha / len(crops), 2),
            "area_fraction": round(1.0 / len(crops), 2),
            "color": ZONE_COLORS[0], "reason": "Default assignment",
        })

        # 3b: Sowing optimization
        sowing_out = None
        sowing_date = None
        try:
            sowing_result = await optimize_sowing_period(lat, lon, crop, elevation)
            analysis = sowing_result.get("analysis", {})
            op = analysis.get("optimal_period", {})
            sowing_out = {
                "optimal_period": op,
                "season": analysis.get("best_season", {}).get("season", CROP_SEASONS.get(crop, "unknown")),
                "best_month": analysis.get("best_month", {}).get("month", "unknown"),
                "best_week": analysis.get("best_week", {}).get("period", "N/A"),
            }
            # Parse sowing date
            if preferred_sowing:
                sowing_date = date.fromisoformat(preferred_sowing)
            elif op.get("start"):
                try:
                    sowing_date = date.fromisoformat(op["start"])
                except (ValueError, TypeError):
                    pass
        except Exception as e:
            logger.warning("Sowing optimizer failed for %s: %s", crop, e)

        if sowing_date is None:
            cal = CROP_CALENDAR.get(crop, (11, 1, 120))
            sowing_date = date(today.year - 1, cal[0], cal[1])

        harvest_date = get_default_harvest_date(crop, sowing_date)
        # Cap harvest to available weather
        if weather_data:
            last_weather_date = date.fromisoformat(weather_data[-1].date)
            if harvest_date > last_weather_date:
                harvest_date = last_weather_date

        plan["sowing"] = sowing_out or {
            "optimal_period": {},
            "season": CROP_SEASONS.get(crop, "unknown"),
            "best_month": "unknown",
            "best_week": "N/A",
        }

        # Store dates for timeline (internal, removed from final output)
        plan["_sowing_date"] = sowing_date
        plan["_harvest_date"] = harvest_date

        # 3c: Model simulations
        wofost_result, aquacrop_result, dssat_result = await _run_crop_models(
            crop, lat, lon, weather_data, sowing_date, harvest_date,
            elevation, soil_resp, soil_layers,
        )
        plan["models"] = _format_model_outputs(crop, wofost_result, aquacrop_result, dssat_result)

        # 3d: Crop-cycle hazard analysis
        zone_type = plan["zone"].get("type", "slope")
        plan["hazards"] = _analyze_crop_cycle_hazards(
            weather_data, crop, sowing_date, harvest_date, zone_type, soil_clay_pct,
        )

        # 3e: Feasibility check
        plan["feasibility"] = _check_feasibility(
            crop, wofost_result, aquacrop_result, plan["hazards"], gw_result,
        )

        # Unified score
        plan["unified_score"] = _compute_unified_score(
            wofost_result, aquacrop_result, dssat_result, ozone_result, gw_result, crop,
        )

        crop_plans.append(plan)

    # ── Phase 4: Planting Timeline ──
    planting_timeline = _build_planting_timeline(crop_plans)

    # ── Phase 5: Combined Recommendations ──
    recommendations = _build_combined_recommendations(crop_plans, ozone_result, gw_result)

    # ── Build response ──
    # Soil summary
    soil_out = None
    if soil_resp and hasattr(soil_resp, "layers") and soil_resp.layers:
        top = soil_resp.layers[0]
        soil_out = {
            "clay_g_kg": top.clay, "sand_g_kg": top.sand,
            "organic_carbon_g_kg": top.organic_carbon,
            "ph": top.ph, "bulk_density": top.bulk_density, "depth": top.depth_label,
        }

    gw_out = None
    if gw_result:
        aq = gw_result.get("aquifer", {})
        gw_out = {
            "category": aq.get("category"), "current_depth_m": aq.get("current_depth_m"),
            "annual_decline_m": aq.get("annual_decline_m"),
            "extraction_pct": aq.get("stage_of_extraction_pct"), "region": aq.get("region_name"),
        }

    ozone_out = None
    if ozone_result:
        yi = ozone_result.get("yield_impact", {})
        ozone_out = {
            "yield_loss_pct": yi.get("yield_loss_percent", 0),
            "severity": yi.get("severity", "low"),
            "mean_ozone_ppb": ozone_result.get("exposure", {}).get("mean_ozone_ppb"),
        }

    # Clean internal fields from crop plans
    for plan in crop_plans:
        plan.pop("_sowing_date", None)
        plan.pop("_harvest_date", None)

    return {
        "farm": {
            "latitude": lat,
            "longitude": lon,
            "field_area_ha": field_area_ha,
            "elevation_range": land_analysis["elevation"],
            "crops": crops,
        },
        "land_analysis": land_analysis,
        "environment": {
            "weather_summary": _build_weather_summary(weather_data),
            "forecast": forecast_result.get("days", []) if forecast_result else [],
            "soil": soil_out,
            "groundwater": gw_out,
            "ozone": ozone_out,
        },
        "crop_plans": crop_plans,
        "planting_timeline": planting_timeline,
        "recommendations": recommendations,
        "data_sources": data_sources,
    }
