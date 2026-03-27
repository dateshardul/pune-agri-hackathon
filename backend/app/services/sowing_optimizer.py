"""Sowing Period Optimizer — hierarchical sowing date optimization.

Three-level analysis:
  Level 1 (SEASON): Instant crop-calendar lookup
  Level 2 (MONTH): Weather + soil scoring within best season
  Level 3 (WEEK): Full multi-model pipeline for weekly candidates
"""

import asyncio
import calendar
import logging
from datetime import date, timedelta

from app.models.schemas import DailyWeather
from app.services.wofost import CROP_CALENDAR, run_wofost, get_default_harvest_date
from app.services.aquacrop_sim import run_aquacrop, AQUACROP_CROPS
from app.services.dssat_sim import run_dssat, DSSAT_CROPS
from app.services.ozone_sight import estimate_aot40, estimate_yield_loss
from app.services.groundwater import fetch_groundwater_analysis
from app.services.soilgrids import fetch_soil

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Crop-specific agronomic parameters
# ---------------------------------------------------------------------------

CROP_SEASONS: dict[str, str] = {
    "wheat": "rabi", "chickpea": "rabi", "mungbean": "rabi", "potato": "rabi",
    "rice": "kharif", "maize": "kharif", "cotton": "kharif", "sorghum": "kharif",
    "millet": "kharif", "groundnut": "kharif", "soybean": "kharif", "pigeonpea": "kharif",
    "sugarcane": "summer",
}

SEASON_MONTHS: dict[str, list[int]] = {
    "rabi": [10, 11, 12, 1, 2],
    "kharif": [6, 7, 8, 9, 10],
    "summer": [2, 3, 4, 5],
}

SEASON_SUITABILITY_MAP: dict[str, dict[str, str]] = {
    "rabi":    {"rabi": "excellent", "kharif": "poor",      "summer": "marginal"},
    "kharif":  {"rabi": "poor",      "kharif": "excellent", "summer": "marginal"},
    "summer":  {"rabi": "marginal",  "kharif": "marginal",  "summer": "excellent"},
}

CROP_TEMP_RANGES: dict[str, dict] = {
    "wheat":     {"germination": (10, 25), "optimal": (15, 22), "frost_limit": 0},
    "rice":      {"germination": (20, 35), "optimal": (25, 32), "frost_limit": 10},
    "maize":     {"germination": (18, 33), "optimal": (22, 30), "frost_limit": 5},
    "chickpea":  {"germination": (10, 30), "optimal": (15, 25), "frost_limit": 0},
    "cotton":    {"germination": (20, 35), "optimal": (25, 32), "frost_limit": 10},
    "sorghum":   {"germination": (20, 35), "optimal": (25, 30), "frost_limit": 8},
    "millet":    {"germination": (20, 35), "optimal": (25, 32), "frost_limit": 8},
    "groundnut": {"germination": (20, 35), "optimal": (25, 30), "frost_limit": 8},
    "soybean":   {"germination": (15, 30), "optimal": (20, 28), "frost_limit": 5},
    "sugarcane": {"germination": (20, 35), "optimal": (25, 33), "frost_limit": 10},
    "potato":    {"germination": (10, 25), "optimal": (15, 22), "frost_limit": -2},
    "mungbean":  {"germination": (15, 35), "optimal": (25, 32), "frost_limit": 5},
    "pigeonpea": {"germination": (18, 35), "optimal": (22, 30), "frost_limit": 5},
}

CROP_PH_RANGE: dict[str, tuple[float, float]] = {
    "wheat": (6.0, 7.5), "rice": (5.0, 7.0), "maize": (5.5, 7.5),
    "chickpea": (6.0, 8.0), "cotton": (6.0, 8.0), "sorghum": (5.5, 8.0),
    "millet": (5.5, 7.5), "groundnut": (5.5, 7.0), "soybean": (6.0, 7.0),
    "sugarcane": (6.0, 7.5), "potato": (4.8, 6.5), "mungbean": (6.0, 7.5),
    "pigeonpea": (5.0, 7.5),
}

MONTH_NAMES = [
    "", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]


# ---------------------------------------------------------------------------
# Weather fetching (ERA5 → NASA POWER fallback)
# ---------------------------------------------------------------------------

async def _fetch_weather_for_range(
    lat: float, lon: float, start: date, end: date,
) -> tuple[list[DailyWeather], str]:
    """Fetch weather data, trying ERA5 first then NASA POWER."""
    # Try ERA5 with a tight timeout (don't block optimizer on slow CDS API)
    try:
        from app.services.copernicus_cds import fetch_era5_weather
        era5 = await asyncio.wait_for(
            fetch_era5_weather(lat, lon, start, end),
            timeout=15,
        )
        if era5 and era5.get("data"):
            days = []
            for d in era5["data"]:
                days.append(DailyWeather(
                    date=d["date"],
                    temperature_max=d.get("temperature_max"),
                    temperature_min=d.get("temperature_min"),
                    precipitation=d.get("precipitation"),
                    solar_radiation=d.get("solar_radiation"),
                    relative_humidity=d.get("relative_humidity"),
                    wind_speed=d.get("wind_speed"),
                ))
            return days, "ERA5 Reanalysis"
    except (asyncio.TimeoutError, Exception) as e:
        logger.debug("ERA5 unavailable, falling back to NASA POWER: %s", e)

    # Fallback to NASA POWER
    from app.services.nasa_power import fetch_weather
    resp = await fetch_weather(lat, lon, start, end)
    return resp.data, "NASA POWER"


# ---------------------------------------------------------------------------
# Level 1 — SEASON (instant)
# ---------------------------------------------------------------------------

def _analyze_season(crop: str) -> dict:
    """Pure agronomic lookup — which season suits this crop."""
    primary = CROP_SEASONS.get(crop, "rabi")
    suitability = SEASON_SUITABILITY_MAP.get(primary, SEASON_SUITABILITY_MAP["rabi"])

    all_seasons = [
        {"season": s, "suitability": suitability.get(s, "marginal")}
        for s in ["rabi", "kharif", "summer"]
    ]
    # Sort: excellent > marginal > poor
    order = {"excellent": 0, "marginal": 1, "poor": 2}
    all_seasons.sort(key=lambda x: order.get(x["suitability"], 1))

    cal = CROP_CALENDAR.get(crop, (11, 1, 120))
    reason = (
        f"{crop.capitalize()} is a {primary}-season crop, traditionally sown in "
        f"{MONTH_NAMES[cal[0]]} (day {cal[1]}) with a {cal[2]}-day growing period."
    )

    return {
        "season": primary,
        "reason": reason,
        "all_seasons": all_seasons,
    }


# ---------------------------------------------------------------------------
# Level 2 — MONTH (weather + soil scoring)
# ---------------------------------------------------------------------------

def _score_month_weather(
    weather: list[DailyWeather], month: int, year: int, crop: str,
    soil_clay: float | None, soil_ph: float | None,
) -> dict:
    """Score a single month for sowing suitability (0-100)."""
    temp_range = CROP_TEMP_RANGES.get(crop, CROP_TEMP_RANGES["wheat"])
    ph_range = CROP_PH_RANGE.get(crop, (5.5, 7.5))

    # Filter weather to this month
    month_str_prefix = f"{year}-{month:02d}"
    month_days = [
        w for w in weather
        if w.date and w.date.startswith(month_str_prefix)
    ]

    if not month_days:
        return {"month": MONTH_NAMES[month], "score": 0, "risk": "high",
                "note": "No weather data available"}

    # --- Temperature fit (0-30 points) ---
    temps = [(w.temperature_max, w.temperature_min) for w in month_days
             if w.temperature_max is not None and w.temperature_min is not None]
    temp_score = 0
    frost_days = 0
    if temps:
        avg_tmax = sum(t[0] for t in temps) / len(temps)
        avg_tmin = sum(t[1] for t in temps) / len(temps)
        avg_temp = (avg_tmax + avg_tmin) / 2
        germ_lo, germ_hi = temp_range["germination"]
        if germ_lo <= avg_temp <= germ_hi:
            # Within germination range — score by closeness to optimal
            opt_lo, opt_hi = temp_range["optimal"]
            opt_mid = (opt_lo + opt_hi) / 2
            dist = abs(avg_temp - opt_mid)
            temp_score = max(0, 30 - dist * 2)
        elif avg_temp < germ_lo:
            temp_score = max(0, 15 - (germ_lo - avg_temp) * 3)
        else:
            temp_score = max(0, 15 - (avg_temp - germ_hi) * 3)

        frost_limit = temp_range["frost_limit"]
        frost_days = sum(1 for t in temps if t[1] < frost_limit)

    # --- Frost risk penalty (0-15 points) ---
    frost_score = max(0, 15 - frost_days * 5)

    # --- Rainfall adequacy (0-25 points) ---
    precip = [w.precipitation for w in month_days if w.precipitation is not None]
    total_precip = sum(precip) if precip else 0
    rain_score = 0
    if 30 <= total_precip <= 150:
        rain_score = 25  # ideal moisture
    elif 15 <= total_precip < 30 or 150 < total_precip <= 250:
        rain_score = 15
    elif total_precip < 15:
        rain_score = 8  # too dry but irrigable
    else:
        rain_score = 5  # waterlogging risk

    # --- Soil workability (0-15 points) ---
    soil_work_score = 15
    if soil_clay is not None and total_precip > 100 and soil_clay > 40:
        soil_work_score = 3  # too wet + heavy clay
    elif soil_clay is not None and soil_clay > 50:
        soil_work_score = 8

    # --- Soil pH (0-15 points) ---
    ph_score = 15
    if soil_ph is not None:
        if ph_range[0] <= soil_ph <= ph_range[1]:
            ph_score = 15
        else:
            dist = min(abs(soil_ph - ph_range[0]), abs(soil_ph - ph_range[1]))
            ph_score = max(0, 15 - dist * 5)

    total = round(temp_score + frost_score + rain_score + soil_work_score + ph_score)
    total = min(100, max(0, total))

    # Determine risk level
    if total >= 75:
        risk = "low"
    elif total >= 50:
        risk = "moderate"
    else:
        risk = "high"

    # Build note
    notes = []
    if frost_days > 0:
        notes.append(f"{frost_days} frost-risk days")
    if total_precip < 15:
        notes.append("very dry — irrigation needed")
    elif total_precip > 200:
        notes.append("waterlogging risk")
    if soil_clay and soil_clay > 40 and total_precip > 100:
        notes.append("heavy clay + wet — difficult tillage")
    if not notes:
        notes.append("favorable conditions")
    note = "; ".join(notes)

    return {
        "month": MONTH_NAMES[month],
        "score": total,
        "risk": risk,
        "note": note,
    }


async def _analyze_months(
    lat: float, lon: float, crop: str, best_season: str,
) -> tuple[dict, list[DailyWeather], str]:
    """Score months within the best season using weather + soil data."""
    months = SEASON_MONTHS.get(best_season, [10, 11, 12, 1, 2])

    # Determine year range for weather fetch
    today = date.today()
    # Use the most recent completed season
    if best_season == "kharif":
        year = today.year if today.month >= 6 else today.year - 1
    elif best_season == "rabi":
        year = today.year if today.month >= 10 else today.year - 1
    else:  # summer
        year = today.year if today.month >= 2 else today.year - 1

    # Build date range spanning all candidate months
    start_month = months[0]
    end_month = months[-1]
    if start_month > end_month:  # crosses year boundary (rabi: Oct→Feb)
        fetch_start = date(year, start_month, 1)
        fetch_end = date(year + 1, end_month, 28)
    else:
        fetch_start = date(year, start_month, 1)
        fetch_end = date(year, end_month, 28)

    # Extend range to cover full growing season (for Level 3)
    cal = CROP_CALENDAR.get(crop, (11, 1, 120))
    duration = cal[2]
    extended_end = min(fetch_end + timedelta(days=duration + 40),
                       date.today() - timedelta(days=1))

    # Fetch weather + soil concurrently
    weather_task = _fetch_weather_for_range(lat, lon,
                                            fetch_start - timedelta(days=35),
                                            extended_end)
    soil_task = fetch_soil(lat, lon)
    (weather_data, weather_source), soil_resp = await asyncio.gather(
        weather_task, soil_task
    )

    # Extract topsoil properties
    soil_clay = None
    soil_ph = None
    if soil_resp and hasattr(soil_resp, "layers") and soil_resp.layers:
        top = soil_resp.layers[0]
        soil_clay = top.clay / 10 if top.clay and top.clay > 10 else top.clay  # g/kg → %
        soil_ph = top.ph

    # Score each month
    all_months = []
    for m in months:
        y = year if m >= start_month or start_month <= end_month else year + 1
        scored = _score_month_weather(weather_data, m, y, crop, soil_clay, soil_ph)
        all_months.append(scored)

    all_months.sort(key=lambda x: x["score"], reverse=True)

    best = all_months[0]
    reason = (
        f"{best['month']} scores highest ({best['score']}/100) with {best['risk']} risk. "
        f"{best['note'].capitalize()}."
    )

    result = {
        "month": best["month"],
        "reason": reason,
        "all_months": all_months,
    }

    return result, weather_data, weather_source


# ---------------------------------------------------------------------------
# Level 3 — WEEK (full multi-model pipeline)
# ---------------------------------------------------------------------------

def _get_candidate_sowing_dates(best_months: list[dict], year: int, season: str) -> list[date]:
    """Generate weekly candidate dates from the top 2 months."""
    top_months = [m for m in best_months[:2]]
    candidates = []
    for m_info in top_months:
        month_num = MONTH_NAMES.index(m_info["month"])
        # Determine year for this month
        if season == "rabi" and month_num <= 2:
            y = year + 1
        else:
            y = year
        # Bi-weekly candidates: 1st, 15th (keep fast for demo)
        for day in [1, 15]:
            try:
                d = date(y, month_num, day)
                if d < date.today():
                    candidates.append(d)
            except ValueError:
                pass
    return candidates[:6]  # cap at 6 candidates for reasonable response time


async def _score_single_week(
    lat: float, lon: float, crop: str, sowing: date,
    weather_data: list[DailyWeather], elevation: float,
) -> dict:
    """Run multi-model pipeline for a single candidate sowing date."""
    cal = CROP_CALENDAR.get(crop, (11, 1, 120))
    duration = cal[2]
    harvest = sowing + timedelta(days=duration)

    scores = {}
    yield_kg_ha = 0

    # --- WOFOST yield ---
    try:
        wofost = run_wofost(
            latitude=lat, longitude=lon,
            weather_data=weather_data, crop=crop,
            sowing_date=sowing, harvest_date=harvest,
            elevation=elevation,
        )
        summary = wofost.get("summary", {})
        # TWSO = grain; if 0 (DVS didn't reach maturity), use TAGP as proxy
        yield_kg_ha = summary.get("TWSO", 0) or 0
        if yield_kg_ha == 0:
            yield_kg_ha = (summary.get("TAGP", 0) or 0) * 0.45  # harvest index
        scores["yield"] = yield_kg_ha
    except Exception as e:
        logger.debug("WOFOST failed for %s: %s", sowing, e)
        scores["yield"] = 0

    # --- AquaCrop water ---
    water_eff = 0.5
    drought_risk_val = 0.3
    if crop in AQUACROP_CROPS:
        try:
            ac = run_aquacrop(
                latitude=lat, longitude=lon,
                weather_data=weather_data, crop=crop,
                sowing_date=sowing,
            )
            wa = ac.get("water_advisory", {})
            wp = wa.get("water_productivity_kg_m3", 0)
            water_eff = min(1.0, wp / 2.0)  # normalize: 2 kg/m³ = 1.0
            dr = wa.get("drought_risk", "low")
            drought_risk_val = {"low": 0.1, "moderate": 0.3, "high": 0.6, "severe": 0.9}.get(dr, 0.3)
        except Exception as e:
            logger.debug("AquaCrop failed for %s: %s", sowing, e)

    # --- DSSAT nutrients ---
    nutrient_eff = 0.5
    if crop in DSSAT_CROPS:
        try:
            ds = run_dssat(
                latitude=lat, longitude=lon,
                weather_data=weather_data, crop=crop,
                sowing_date=sowing, elevation=elevation,
            )
            nu = ds.get("nutrient_uptake", {})
            n_stress = nu.get("n_stress_total", 0.5)
            nutrient_eff = 1.0 - min(1.0, n_stress)
        except Exception as e:
            logger.debug("DSSAT failed for %s: %s", sowing, e)

    # --- Ozone yield loss ---
    ozone_loss = 0.0
    try:
        aot40 = estimate_aot40(lat, lon, sowing, duration)
        ol = estimate_yield_loss(crop, aot40.get("aot40_ppb_h", 0))
        ozone_loss = min(1.0, ol.get("yield_loss_percent", 0) / 100)
    except Exception as e:
        logger.debug("Ozone analysis failed for %s: %s", sowing, e)

    # --- Groundwater sustainability ---
    gw_sustainability = 0.5
    try:
        gw = await fetch_groundwater_analysis(lat, lon)
        cat = gw.get("aquifer", {}).get("category", "semi-critical")
        gw_sustainability = {"safe": 0.9, "semi-critical": 0.5, "over-exploited": 0.1}.get(cat, 0.5)
    except Exception as e:
        logger.debug("Groundwater check failed for %s: %s", sowing, e)

    # --- Soil workability + moisture (from weather around sowing date) ---
    sow_str = sowing.isoformat()
    nearby_days = [
        w for w in weather_data
        if w.date and abs((date.fromisoformat(w.date) - sowing).days) <= 7
    ]
    soil_workability = 0.7
    soil_moisture = 0.5
    if nearby_days:
        precip_7d = sum(w.precipitation or 0 for w in nearby_days)
        if 10 <= precip_7d <= 50:
            soil_workability = 0.9
            soil_moisture = 0.8
        elif precip_7d < 10:
            soil_workability = 0.8
            soil_moisture = 0.3
        else:
            soil_workability = 0.4
            soil_moisture = 0.6

    # --- Composite score ---
    # Normalize yield to 0-1 (assume max ~6000 kg/ha for most crops)
    max_yield = 6000
    norm_yield = min(1.0, yield_kg_ha / max_yield) if yield_kg_ha > 0 else 0

    composite = (
        0.30 * norm_yield
        + 0.20 * water_eff
        + 0.15 * (1 - drought_risk_val)
        + 0.10 * (1 - ozone_loss)
        + 0.10 * nutrient_eff
        + 0.05 * gw_sustainability
        + 0.05 * soil_workability
        + 0.05 * soil_moisture
    )
    score = round(composite * 100)

    # Risk level
    if score >= 75:
        risk = "low"
    elif score >= 50:
        risk = "moderate"
    else:
        risk = "high"

    period_start = sowing
    period_end = sowing + timedelta(days=6)

    return {
        "period": f"{sowing.strftime('%b %d')} – {period_end.strftime('%b %d')}",
        "sowing_date": sowing.isoformat(),
        "score": score,
        "yield_kg_ha": round(yield_kg_ha, 1),
        "risk": risk,
        "recommended": False,  # set later for the best
        "_components": {
            "norm_yield": round(norm_yield, 3),
            "water_efficiency": round(water_eff, 3),
            "drought_risk": round(drought_risk_val, 3),
            "ozone_loss": round(ozone_loss, 3),
            "nutrient_efficiency": round(nutrient_eff, 3),
            "gw_sustainability": round(gw_sustainability, 3),
            "soil_workability": round(soil_workability, 3),
            "soil_moisture": round(soil_moisture, 3),
        },
    }


async def _analyze_weeks(
    lat: float, lon: float, crop: str, elevation: float,
    month_results: dict, weather_data: list[DailyWeather],
    best_season: str,
) -> dict:
    """Test weekly candidates with full multi-model pipeline."""
    all_months = month_results["all_months"]

    # Determine base year
    today = date.today()
    if best_season == "kharif":
        year = today.year if today.month >= 6 else today.year - 1
    elif best_season == "rabi":
        year = today.year if today.month >= 10 else today.year - 1
    else:
        year = today.year if today.month >= 2 else today.year - 1

    candidates = _get_candidate_sowing_dates(all_months, year, best_season)

    if not candidates:
        return {
            "period": "N/A",
            "reason": "Could not generate valid candidate dates",
            "all_weeks": [],
        }

    # Run all candidates concurrently
    tasks = [
        _score_single_week(lat, lon, crop, d, weather_data, elevation)
        for d in candidates
    ]
    week_results = await asyncio.gather(*tasks)

    # Sort by score descending
    week_results.sort(key=lambda x: x["score"], reverse=True)

    # Mark best as recommended
    if week_results:
        week_results[0]["recommended"] = True

    best = week_results[0] if week_results else None

    # Clean up internal fields for response
    for w in week_results:
        w.pop("_components", None)
        w.pop("sowing_date", None)

    reason = ""
    if best:
        reason = (
            f"Optimal sowing window with score {best['score']}/100. "
            f"Expected yield {best['yield_kg_ha']:.0f} kg/ha with {best['risk']} risk."
        )

    return {
        "period": best["period"] if best else "N/A",
        "reason": reason,
        "all_weeks": week_results,
    }


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

async def optimize_sowing_period(
    lat: float, lon: float, crop: str,
    elevation: float = 500.0,
) -> dict:
    """Hierarchical sowing date optimizer.

    Level 1: Season selection (instant, agronomic lookup)
    Level 2: Month ranking (weather + soil, ~1s)
    Level 3: Week optimization (full multi-model, ~8s)
    """
    crop = crop.lower().strip()
    if crop not in CROP_CALENDAR:
        available = ", ".join(sorted(CROP_CALENDAR.keys()))
        raise ValueError(f"Unsupported crop '{crop}'. Available: {available}")

    # Level 1 — SEASON
    season_result = _analyze_season(crop)
    best_season = season_result["season"]

    # Level 2 — MONTH (fetches weather + soil)
    month_result, weather_data, weather_source = await _analyze_months(
        lat, lon, crop, best_season,
    )

    # Level 3 — WEEK (full pipeline)
    week_result = await _analyze_weeks(
        lat, lon, crop, elevation,
        month_result, weather_data, best_season,
    )

    # Build optimal_period summary
    best_week = next(
        (w for w in week_result.get("all_weeks", []) if w.get("recommended")),
        None,
    )

    # Compute vs_standard_pct
    cal = CROP_CALENDAR.get(crop, (11, 1, 120))
    standard_yield = best_week["yield_kg_ha"] if best_week else 0
    # Find the standard sowing date's yield from results
    all_weeks = week_result.get("all_weeks", [])
    if len(all_weeks) > 1 and best_week:
        avg_yield = sum(w["yield_kg_ha"] for w in all_weeks) / len(all_weeks)
        if avg_yield > 0:
            vs_pct = ((best_week["yield_kg_ha"] - avg_yield) / avg_yield) * 100
            vs_standard_str = f"+{vs_pct:.1f}%" if vs_pct >= 0 else f"{vs_pct:.1f}%"
        else:
            vs_standard_str = "+0.0%"
    else:
        vs_standard_str = "+0.0%"

    # Parse best week period to get start/end dates
    optimal_start = ""
    optimal_end = ""
    if best_week:
        # period is like "Nov 08 – Nov 14"
        period = best_week["period"]
        parts = period.split(" – ")
        if len(parts) == 2:
            # Reconstruct ISO dates from the period
            today = date.today()
            # Use the season's year
            if best_season == "kharif":
                yr = today.year if today.month >= 6 else today.year - 1
            elif best_season == "rabi":
                yr = today.year if today.month >= 10 else today.year - 1
            else:
                yr = today.year if today.month >= 2 else today.year - 1
            try:
                from datetime import datetime
                s = datetime.strptime(f"{parts[0].strip()} {yr}", "%b %d %Y").date()
                e = datetime.strptime(f"{parts[1].strip()} {yr}", "%b %d %Y").date()
                # Handle year boundary for rabi
                if best_season == "rabi" and s.month <= 2:
                    s = s.replace(year=yr + 1)
                    e = e.replace(year=yr + 1)
                optimal_start = s.isoformat()
                optimal_end = e.isoformat()
            except Exception:
                optimal_start = period
                optimal_end = period

    optimal_period = {
        "start": optimal_start,
        "end": optimal_end,
        "expected_yield_kg_ha": best_week["yield_kg_ha"] if best_week else 0,
        "vs_standard_pct": vs_standard_str,
        "risk_level": best_week["risk"] if best_week else "unknown",
    }

    return {
        "crop": crop,
        "location": {"latitude": lat, "longitude": lon},
        "analysis": {
            "best_season": season_result,
            "best_month": month_result,
            "best_week": week_result,
            "optimal_period": optimal_period,
        },
        "factors_considered": [
            "temperature", "rainfall", "soil_moisture", "frost_risk",
            "monsoon_retreat", "soil_type", "soil_pH", "soil_workability",
            "organic_carbon", "groundwater_depth", "ozone_exposure",
        ],
        "weather_source": weather_source,
    }
