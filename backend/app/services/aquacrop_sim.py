"""AquaCrop simulation service — water-stress and irrigation advisory.

Uses FAO AquaCrop model for water productivity analysis, drought impact,
and irrigation scheduling. Best for: "what if rainfall drops?", "how much
irrigation do I need?", water-scarce region planning.
"""

import math
from datetime import date, datetime, timedelta

import pandas as pd
from aquacrop import AquaCropModel, Soil, Crop, InitialWaterContent

from app.models.schemas import DailyWeather
from app.services.wofost import _estimate_et0, CROP_CALENDAR, get_default_sowing_date

# Map our crop names to AquaCrop crop names (case-sensitive)
AQUACROP_CROPS: dict[str, str] = {
    "wheat": "Wheat",
    "rice": "PaddyRice",
    "maize": "Maize",
    "cotton": "Cotton",
    "sorghum": "Sorghum",
    "soybean": "Soybean",
    "sugarcane": "SugarCane",
    "potato": "Potato",
}

# Map our crop names to AquaCrop planting date format (MM/DD)
# AquaCrop uses planting_date as string "MM/DD"

# Soil type mapping based on clay content from SoilGrids
def _classify_soil(clay_pct: float | None) -> str:
    """Map clay percentage to AquaCrop soil type."""
    if clay_pct is None:
        return "ClayLoam"  # Pune default (Deccan vertisol)
    if clay_pct > 50:
        return "Clay"
    if clay_pct > 35:
        return "SiltyClay"
    if clay_pct > 27:
        return "ClayLoam"
    if clay_pct > 20:
        return "Loam"
    if clay_pct > 10:
        return "SandyLoam"
    return "Sand"


def _build_weather_df(
    weather_data: list[DailyWeather],
    latitude: float,
) -> pd.DataFrame:
    """Convert our NASA POWER weather data to AquaCrop format.

    AquaCrop needs: MinTemp, MaxTemp, Precipitation, ReferenceET, Date
    """
    lat_rad = math.radians(latitude)
    min_temps, max_temps, precips, ets, dates = [], [], [], [], []

    for w in weather_data:
        day = datetime.strptime(w.date, "%Y-%m-%d").date()
        tmin = w.temperature_min if w.temperature_min is not None else 20.0
        tmax = w.temperature_max if w.temperature_max is not None else 30.0
        precip = w.precipitation if w.precipitation is not None else 0.0
        irrad_mj = w.solar_radiation if w.solar_radiation is not None else 15.0
        rh = w.relative_humidity if w.relative_humidity is not None else 60.0
        wind = w.wind_speed if w.wind_speed is not None else 2.0
        doy = day.timetuple().tm_yday

        et0 = _estimate_et0(tmin, tmax, irrad_mj, wind, rh, lat_rad, doy)

        min_temps.append(tmin)
        max_temps.append(tmax)
        precips.append(precip)
        ets.append(et0)
        dates.append(day)

    # Build DataFrame with proper datetime index for AquaCrop compatibility
    df = pd.DataFrame({
        "MinTemp": min_temps,
        "MaxTemp": max_temps,
        "Precipitation": precips,
        "ReferenceET": ets,
        "Date": pd.to_datetime(dates),
    })

    # AquaCrop divides by ET0 internally (biomass_accumulation.py) — zero causes
    # ZeroDivisionError.  Floor at 0.1 mm/day which is physically reasonable.
    df["ReferenceET"] = df["ReferenceET"].clip(lower=0.1)

    # Ensure column order matches AquaCrop expectation
    return df[["MinTemp", "MaxTemp", "Precipitation", "ReferenceET", "Date"]]


def get_aquacrop_crops() -> list[str]:
    """Return list of crops supported by AquaCrop."""
    return list(AQUACROP_CROPS.keys())


def run_aquacrop(
    latitude: float,
    longitude: float,
    weather_data: list[DailyWeather],
    crop: str = "wheat",
    sowing_date: date | None = None,
    clay_pct: float | None = None,
    precip_multiplier: float = 1.0,
    irrigation_mm: float = 0.0,
) -> dict:
    """Run AquaCrop water-limited simulation.

    Args:
        latitude, longitude: Location coordinates
        weather_data: Daily weather from NASA POWER
        crop: Crop name (must be in AQUACROP_CROPS)
        sowing_date: Sowing date (defaults from Indian crop calendar)
        clay_pct: Clay percentage for soil classification
        precip_multiplier: Scale precipitation (e.g. 0.7 = 30% less rain)
        irrigation_mm: Total seasonal irrigation to apply (mm)

    Returns:
        dict with yield, water productivity, irrigation advisory
    """
    if crop not in AQUACROP_CROPS:
        raise ValueError(
            f"Crop '{crop}' not supported by AquaCrop. "
            f"Available: {list(AQUACROP_CROPS.keys())}"
        )

    aquacrop_crop_name = AQUACROP_CROPS[crop]

    # Build weather DataFrame
    wdf = _build_weather_df(weather_data, latitude)

    # Apply precipitation modification for scenario analysis
    if precip_multiplier != 1.0:
        wdf["Precipitation"] = wdf["Precipitation"] * precip_multiplier

    # Dates
    if sowing_date is None:
        sowing_date = get_default_sowing_date(crop)

    _, _, duration = CROP_CALENDAR.get(crop, (11, 1, 120))

    # AquaCrop sim window: start well before sowing, end well after harvest
    # AquaCrop needs generous margins to initialize soil water balance
    sim_start = sowing_date - timedelta(days=120)
    sim_end = sowing_date + timedelta(days=duration + 60)

    # Cap to available weather, padding if needed so the full season is covered
    weather_start = wdf["Date"].min().date()
    weather_end = wdf["Date"].max().date()
    if sim_start < weather_start:
        sim_start = weather_start
    if sim_end > weather_end:
        # Pad weather by repeating last 30 days cyclically (covers near-future gap)
        gap_days = (sim_end - weather_end).days
        if gap_days <= 90:
            tail = wdf.tail(30).copy()
            pad_rows = []
            for i in range(1, gap_days + 1):
                src = tail.iloc[i % len(tail)].copy()
                src["Date"] = pd.Timestamp(weather_end + timedelta(days=i))
                pad_rows.append(src)
            if pad_rows:
                wdf = pd.concat([wdf, pd.DataFrame(pad_rows)], ignore_index=True)
        else:
            sim_end = weather_end

    # Planting date as MM/DD string
    planting_str = f"{sowing_date.month:02d}/{sowing_date.day:02d}"

    # Soil
    soil_type = _classify_soil(clay_pct)
    soil = Soil(soil_type=soil_type)

    # Crop
    ac_crop = Crop(aquacrop_crop_name, planting_date=planting_str)

    # Initial water content at field capacity
    iwc = InitialWaterContent(value=["FC"])

    # Run model
    model = AquaCropModel(
        sim_start_time=sim_start.strftime("%Y/%m/%d"),
        sim_end_time=sim_end.strftime("%Y/%m/%d"),
        weather_df=wdf,
        soil=soil,
        crop=ac_crop,
        initial_water_content=iwc,
    )
    model.run_model(till_termination=True)

    # Extract results
    sim_results = model.get_simulation_results()

    if sim_results is None or len(sim_results) == 0:
        raise RuntimeError("AquaCrop simulation produced no results")

    row = sim_results.iloc[0]

    def _safe_float(val, default=0.0):
        """Convert to float, treating NaN/None as default."""
        v = float(val) if val is not None else default
        return default if math.isnan(v) else v

    dry_yield = _safe_float(row.get("Dry yield (tonne/ha)", 0))
    fresh_yield = _safe_float(row.get("Fresh yield (tonne/ha)", 0))
    yield_potential = _safe_float(row.get("Yield potential (tonne/ha)", 0))
    seasonal_irrigation = _safe_float(row.get("Seasonal irrigation (mm)", 0))

    # Water productivity calculation
    total_precip = _safe_float(wdf["Precipitation"].sum())
    total_et = _safe_float(wdf["ReferenceET"].sum())
    effective_water = total_precip + irrigation_mm
    water_productivity = (
        round(dry_yield * 1000 / effective_water, 2)
        if effective_water > 0 else 0
    )  # kg/m3

    # Drought risk assessment
    drought_risk = "low"
    if total_precip < total_et * 0.3:
        drought_risk = "severe"
    elif total_precip < total_et * 0.5:
        drought_risk = "high"
    elif total_precip < total_et * 0.75:
        drought_risk = "moderate"

    # Irrigation deficit
    water_deficit = max(0, total_et - total_precip)
    irrigation_need = round(water_deficit * 0.8, 1)  # 80% application efficiency

    # Generate weekly irrigation schedule
    schedule = _build_irrigation_schedule(
        crop, sowing_date, duration, water_deficit, wdf
    )

    return {
        "yield": {
            "dry_yield_tonnes_per_ha": round(dry_yield, 3),
            "fresh_yield_tonnes_per_ha": round(fresh_yield, 3),
            "yield_potential_tonnes_per_ha": round(yield_potential, 3),
            "yield_gap_pct": round(
                (1 - dry_yield / yield_potential) * 100, 1
            ) if yield_potential > 0 else 0,
        },
        "water_advisory": {
            "model": "AquaCrop",
            "total_water_need_mm": round(total_et, 1),
            "irrigation_need_mm": irrigation_need,
            "rain_contribution_mm": round(total_precip, 1),
            "drought_risk": drought_risk,
            "water_productivity_kg_m3": water_productivity,
            "schedule": schedule,
        },
        "metadata": {
            "model": "FAO AquaCrop v7",
            "crop": crop,
            "aquacrop_crop": aquacrop_crop_name,
            "soil_type": soil_type,
            "sowing_date": sowing_date.isoformat(),
            "sim_start": sim_start.isoformat(),
            "sim_end": sim_end.isoformat(),
            "precip_multiplier": precip_multiplier,
            "latitude": latitude,
            "longitude": longitude,
        },
    }


# Crop growth stages for irrigation scheduling
CROP_STAGES = {
    "wheat":     ["Establishment", "Tillering", "Stem elongation", "Heading", "Grain fill", "Maturity"],
    "rice":      ["Nursery", "Transplanting", "Tillering", "Panicle init", "Flowering", "Grain fill"],
    "maize":     ["Emergence", "Vegetative", "Tasseling", "Silking", "Grain fill", "Maturity"],
    "cotton":    ["Emergence", "Squaring", "Flowering", "Boll formation", "Boll opening", "Harvest"],
    "sorghum":   ["Emergence", "Vegetative", "Boot", "Heading", "Grain fill", "Maturity"],
    "soybean":   ["Emergence", "Vegetative", "Flowering", "Pod set", "Seed fill", "Maturity"],
    "sugarcane": ["Germination", "Tillering", "Grand growth", "Grand growth", "Maturation", "Harvest"],
    "potato":    ["Emergence", "Vegetative", "Tuber init", "Tuber bulking", "Tuber bulking", "Maturity"],
}


def _build_irrigation_schedule(
    crop: str,
    sowing_date: date,
    duration: int,
    total_deficit_mm: float,
    wdf: pd.DataFrame,
) -> list[dict]:
    """Build a weekly irrigation schedule with crop stage context."""
    stages = CROP_STAGES.get(crop, ["Early", "Vegetative", "Reproductive", "Late", "Maturity", "Harvest"])
    stage_len = duration // len(stages)

    # Critical water periods (fraction of total need) by stage
    # Reproductive stages get more water
    stage_weights = [0.10, 0.15, 0.25, 0.25, 0.20, 0.05]
    if len(stages) != 6:
        stage_weights = [1.0 / len(stages)] * len(stages)

    schedule = []
    weeks = max(1, duration // 7)

    for week in range(weeks):
        day_offset = week * 7
        week_start = sowing_date + timedelta(days=day_offset)
        week_end = week_start + timedelta(days=6)

        # Determine crop stage
        stage_idx = min(day_offset // stage_len, len(stages) - 1)
        crop_stage = stages[stage_idx]
        weight = stage_weights[min(stage_idx, len(stage_weights) - 1)]

        # Weekly allocation from total deficit
        week_amount = round(total_deficit_mm * weight / max(1, stage_len // 7), 1)
        week_amount = max(0, min(week_amount, 80))  # cap at 80mm/week

        # Priority based on stage importance
        if stage_idx in (2, 3):  # reproductive stages
            priority = "critical"
        elif stage_idx in (1, 4):
            priority = "recommended"
        else:
            priority = "optional"

        # Skip if negligible
        if week_amount < 2:
            continue

        schedule.append({
            "week": week + 1,
            "date_range": f"{week_start.isoformat()} to {week_end.isoformat()}",
            "amount_mm": week_amount,
            "crop_stage": crop_stage,
            "priority": priority,
        })

    return schedule
