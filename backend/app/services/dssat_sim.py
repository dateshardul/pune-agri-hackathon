"""DSSAT simulation service — nutrient management and fertilizer advisory.

Uses DSSAT-CSM (Cropping System Model) for nitrogen/phosphorus optimization,
fertilizer scheduling, and cultivar comparison. Best for: "what's optimal
N fertilizer?", "compare cultivar performance", multi-season nutrient planning.
"""

import logging
import math
from datetime import date, datetime, timedelta

import numpy as np

from app.models.schemas import DailyWeather, SoilLayer
from app.services.wofost import CROP_CALENDAR, get_default_sowing_date

logger = logging.getLogger(__name__)

# Import DSSAT v3 components
from DSSATTools import (  # noqa: E402
    DSSAT,
    SoilLayer as DSSATSoilLayer,
    SoilProfile,
    WeatherRecord,
    WeatherStation,
)
from DSSATTools.filex import (  # noqa: E402
    Field,
    Fertilizer,
    FertilizerEvent,
    Planting,
    SCGeneral,
    SimulationControls,
)
from DSSATTools.crop import (  # noqa: E402
    Wheat as DSSATWheat,
    Rice as DSSATRice,
    Maize as DSSATMaize,
    Soybean as DSSATSoybean,
    Sorghum as DSSATSorghum,
    Potato as DSSATPotato,
    Sugarcane as DSSATSugarcane,
    PearlMillet as DSSATPearlMillet,
    DryBean as DSSATDryBean,
    Sunflower as DSSATSunflower,
)

# Map our crop names to DSSAT crop classes and default cultivar codes
DSSAT_CROPS: dict[str, tuple] = {
    "wheat":     (DSSATWheat,       "IB0488"),
    "rice":      (DSSATRice,        "IB0001"),
    "maize":     (DSSATMaize,       "IB0001"),
    "soybean":   (DSSATSoybean,     "IB0001"),
    "sorghum":   (DSSATSorghum,     "IB0001"),
    "potato":    (DSSATPotato,      "IB0001"),
    "sugarcane": (DSSATSugarcane,   "IB0001"),
    "millet":    (DSSATPearlMillet,  "IB0001"),
    "mungbean":  (DSSATDryBean,     "IB0001"),  # closest proxy
}

# Default planting parameters per crop
PLANTING_PARAMS: dict[str, dict] = {
    "wheat":     {"ppop": 200.0, "plrs": 20.0, "pldp": 5.0},
    "rice":      {"ppop": 75.0,  "plrs": 20.0, "pldp": 3.0},
    "maize":     {"ppop": 7.5,   "plrs": 75.0, "pldp": 5.0},
    "soybean":   {"ppop": 30.0,  "plrs": 45.0, "pldp": 4.0},
    "sorghum":   {"ppop": 15.0,  "plrs": 60.0, "pldp": 4.0},
    "potato":    {"ppop": 5.0,   "plrs": 75.0, "pldp": 15.0},
    "sugarcane": {"ppop": 10.0,  "plrs": 120.0, "pldp": 20.0},
    "millet":    {"ppop": 12.0,  "plrs": 45.0, "pldp": 3.0},
    "mungbean":  {"ppop": 25.0,  "plrs": 30.0, "pldp": 4.0},
}


def _estimate_dewpoint(tmin: float, rh: float) -> float:
    """Estimate dewpoint temperature from Tmin and RH using Magnus formula."""
    a, b = 17.27, 237.3
    tmean = tmin  # dewpoint approximates Tmin in humid conditions
    alpha = (a * tmean) / (b + tmean) + math.log(max(rh, 1) / 100.0)
    return (b * alpha) / (a - alpha)


def _build_weather_station(
    weather_data: list[DailyWeather],
    latitude: float,
    longitude: float,
    elevation: float = 500.0,
) -> WeatherStation:
    """Convert NASA POWER weather to DSSAT WeatherStation."""
    records = []
    for w in weather_data:
        day = datetime.strptime(w.date, "%Y-%m-%d").date()
        tmax = w.temperature_max if w.temperature_max is not None else 30.0
        tmin = w.temperature_min if w.temperature_min is not None else 20.0
        rain = w.precipitation if w.precipitation is not None else 0.0
        srad = w.solar_radiation if w.solar_radiation is not None else 15.0
        rh = w.relative_humidity if w.relative_humidity is not None else 60.0
        wind = w.wind_speed if w.wind_speed is not None else 2.0

        dewp = _estimate_dewpoint(tmin, rh)
        wind_km_day = wind * 86.4  # m/s to km/day

        records.append(WeatherRecord(
            date=day,
            srad=srad,
            tmax=tmax,
            tmin=tmin,
            rain=rain,
            dewp=dewp,
            wind=wind_km_day,
            rhum=rh,
        ))

    return WeatherStation(
        records, lat=latitude, long=longitude, elev=elevation
    )


def _build_soil_profile(
    soil_layers: list[SoilLayer] | None = None,
) -> SoilProfile:
    """Build DSSAT SoilProfile from SoilGrids data or defaults.

    Uses Saxton-Rawls pedotransfer functions to estimate hydraulic
    properties from texture (clay, sand) and organic carbon.
    """
    if soil_layers is None:
        # Default Pune vertisol
        soil_layers = [
            SoilLayer(depth_label="0-5cm", clay=45.2, sand=22.1, silt=32.7,
                       organic_carbon=8.6, ph=7.8, bulk_density=1.32),
            SoilLayer(depth_label="5-15cm", clay=46.8, sand=21.3, silt=31.9,
                       organic_carbon=7.1, ph=7.9, bulk_density=1.35),
            SoilLayer(depth_label="15-30cm", clay=48.5, sand=20.0, silt=31.5,
                       organic_carbon=5.4, ph=8.0, bulk_density=1.38),
            SoilLayer(depth_label="30-60cm", clay=50.1, sand=19.2, silt=30.7,
                       organic_carbon=3.2, ph=8.1, bulk_density=1.42),
            SoilLayer(depth_label="60-100cm", clay=51.3, sand=18.5, silt=30.2,
                       organic_carbon=1.8, ph=8.2, bulk_density=1.45),
        ]

    # Depth mapping from SoilGrids labels to DSSAT slb (base of layer, cm)
    depth_map = {
        "0-5cm": 5, "5-15cm": 15, "15-30cm": 30,
        "30-60cm": 60, "60-100cm": 100,
    }

    dssat_layers = []
    for i, sl in enumerate(soil_layers):
        slb = depth_map.get(sl.depth_label, (i + 1) * 20)
        clay = (sl.clay or 45.0) / 10.0 if (sl.clay or 0) > 10 else (sl.clay or 45.0)  # handle g/kg vs %
        sand = (sl.sand or 22.0) / 10.0 if (sl.sand or 0) > 10 else (sl.sand or 22.0)
        oc = (sl.organic_carbon or 5.0) / 10.0 if (sl.organic_carbon or 0) > 5 else (sl.organic_carbon or 0.5)
        bd = sl.bulk_density or 1.35

        # Saxton-Rawls pedotransfer (simplified)
        # Wilting point (1500 kPa)
        slll = 0.026 + 0.005 * clay + 0.0058 * oc * 10
        slll = max(0.05, min(0.35, slll))
        # Field capacity (33 kPa)
        sdul = slll + 0.15 + 0.001 * clay
        sdul = max(slll + 0.05, min(0.45, sdul))
        # Saturation
        ssat = 1.0 - (bd / 2.65)
        ssat = max(sdul + 0.03, min(0.55, ssat))

        # Root growth factor (decreases with depth)
        srgf = max(0.1, 1.0 - (slb / 150.0))

        dssat_layers.append(DSSATSoilLayer(
            slb=slb, slll=round(slll, 3), sdul=round(sdul, 3),
            ssat=round(ssat, 3), srgf=round(srgf, 2),
            sbdm=bd, sloc=round(oc, 2),
            slcl=round(clay, 1), slsi=round((100 - clay - sand), 1),
        ))

    return SoilProfile(
        table=dssat_layers,
        name="KRISHI_SOL",  # exactly 10 chars
        salb=0.13, slu1=6.0, sldr=0.3, slro=85.0, slnf=1.0, slpf=0.92,
    )


def _build_fertilizer_schedule(
    sowing_date: date,
    n_total_kg_ha: float = 120.0,
    p_total_kg_ha: float = 60.0,
    k_total_kg_ha: float = 40.0,
    splits: int = 3,
) -> Fertilizer:
    """Build a split fertilizer application schedule.

    Default: 3-split N application (basal + 2 top-dress), all P/K at basal.
    """
    events = []

    # Basal application at sowing
    n_basal = n_total_kg_ha / splits
    events.append(FertilizerEvent(
        fdate=sowing_date,
        fmcd="FE005",  # Urea
        facd="AP001",  # Broadcast, not incorporated
        fdep=10.0,
        famn=round(n_basal, 1),
        famp=round(p_total_kg_ha, 1),
        famk=round(k_total_kg_ha, 1),
    ))

    # Top-dress applications
    for i in range(1, splits):
        td_date = sowing_date + timedelta(days=30 * i)
        events.append(FertilizerEvent(
            fdate=td_date,
            fmcd="FE005",
            facd="AP001",
            fdep=5.0,
            famn=round(n_basal, 1),
        ))

    return Fertilizer(table=events)


def get_dssat_crops() -> list[str]:
    """Return list of crops supported by DSSAT."""
    return list(DSSAT_CROPS.keys())


def run_dssat(
    latitude: float,
    longitude: float,
    weather_data: list[DailyWeather],
    crop: str = "wheat",
    sowing_date: date | None = None,
    soil_layers: list[SoilLayer] | None = None,
    elevation: float = 500.0,
    n_kg_ha: float = 120.0,
    p_kg_ha: float = 60.0,
    k_kg_ha: float = 40.0,
) -> dict:
    """Run DSSAT crop simulation with nutrient management.

    Args:
        latitude, longitude: Location coordinates
        weather_data: Daily weather from NASA POWER
        crop: Crop name (must be in DSSAT_CROPS)
        sowing_date: Sowing date (defaults from Indian crop calendar)
        soil_layers: Soil data from SoilGrids (defaults to Pune vertisol)
        elevation: Site elevation in meters
        n_kg_ha: Total nitrogen application (kg/ha)
        p_kg_ha: Total phosphorus application (kg/ha)
        k_kg_ha: Total potassium application (kg/ha)

    Returns:
        dict with yield, nutrient uptake, fertilizer advisory
    """
    if crop not in DSSAT_CROPS:
        raise ValueError(
            f"Crop '{crop}' not supported by DSSAT. "
            f"Available: {list(DSSAT_CROPS.keys())}"
        )

    crop_class, cultivar_code = DSSAT_CROPS[crop]

    # Build components
    ws = _build_weather_station(weather_data, latitude, longitude, elevation)
    soil = _build_soil_profile(soil_layers)

    # Crop
    dssat_crop = crop_class(cultivar_code)

    # Dates
    if sowing_date is None:
        sowing_date = get_default_sowing_date(crop)

    # Field (connects weather + soil)
    field = Field(id_field="KRSH0001", wsta=ws, id_soil=soil)

    # Planting
    params = PLANTING_PARAMS.get(crop, {"ppop": 100.0, "plrs": 30.0, "pldp": 5.0})
    planting = Planting(pdate=sowing_date, **params)

    # Simulation controls
    sc = SimulationControls(
        general=SCGeneral(sdate=sowing_date - timedelta(days=15))
    )

    # Fertilizer
    fert = _build_fertilizer_schedule(sowing_date, n_kg_ha, p_kg_ha, k_kg_ha)

    # Run DSSAT
    dssat = DSSAT()
    try:
        dssat.run_treatment(
            field=field,
            cultivar=dssat_crop,
            planting=planting,
            simulation_controls=sc,
            fertilizer=fert,
        )

        # Parse outputs
        output_tables = dssat.output_tables or {}
        plant_gro = output_tables.get("PlantGro")
        soil_org = output_tables.get("SoilOrg")

        # Extract key metrics from PlantGro
        yield_data = {}
        nutrient_data = {}
        growth_summary = []

        if plant_gro is not None and len(plant_gro) > 0:
            last = plant_gro.iloc[-1]

            # Yield metrics (HWAD = harvested weight above ground, kg/ha)
            hwad = float(last.get("HWAD", 0)) if "HWAD" in plant_gro.columns else None
            cwad = float(last.get("CWAD", 0)) if "CWAD" in plant_gro.columns else None
            twad = float(last.get("TWAD", 0)) if "TWAD" in plant_gro.columns else None
            laid = float(last.get("LAID", 0)) if "LAID" in plant_gro.columns else None

            yield_data = {
                "harvest_weight_kg_ha": hwad,
                "crop_weight_kg_ha": cwad,
                "total_biomass_kg_ha": twad,
                "max_lai": round(laid, 2) if laid else None,
            }

            # Nutrient uptake
            nuprd = float(last.get("NUPRD", 0)) if "NUPRD" in plant_gro.columns else None
            nutrient_data = {
                "n_uptake_rate_kg_ha_day": round(nuprd, 3) if nuprd else None,
            }

            # N stress indicators
            nftd = float(last.get("NFTD", 0)) if "NFTD" in plant_gro.columns else None
            nfpd = float(last.get("NFPD", 0)) if "NFPD" in plant_gro.columns else None
            nfgd = float(last.get("NFGD", 0)) if "NFGD" in plant_gro.columns else None
            nutrient_data["n_stress_total"] = round(nftd, 3) if nftd else None
            nutrient_data["n_stress_photo"] = round(nfpd, 3) if nfpd else None
            nutrient_data["n_stress_growth"] = round(nfgd, 3) if nfgd else None

            # Growth time series (sampled)
            step = max(1, len(plant_gro) // 20)
            for _, row in plant_gro.iloc[::step].iterrows():
                entry = {"das": int(row.get("DAS", 0))}
                if "TWAD" in plant_gro.columns:
                    entry["biomass_kg_ha"] = float(row["TWAD"])
                if "LAID" in plant_gro.columns:
                    entry["lai"] = round(float(row["LAID"]), 2)
                growth_summary.append(entry)

        # Soil organic matter from SoilOrg
        soil_carbon = {}
        if soil_org is not None and len(soil_org) > 0:
            last_soil = soil_org.iloc[-1]
            socd = float(last_soil.get("SOCD", 0)) if "SOCD" in soil_org.columns else None
            soil_carbon["soil_organic_c_kg_ha"] = round(socd, 1) if socd else None

        # Nutrient advisory
        n_stress = nutrient_data.get("n_stress_total")
        advisory = _generate_nutrient_advisory(
            crop, n_kg_ha, p_kg_ha, k_kg_ha, n_stress,
            yield_data.get("harvest_weight_kg_ha"), sowing_date,
        )

        return {
            "yield": yield_data,
            "nutrient_uptake": nutrient_data,
            "soil_carbon": soil_carbon,
            "growth_curve": growth_summary,
            "nutrient_advisory": advisory,
            "metadata": {
                "model": "DSSAT-CSM v4.8",
                "crop": crop,
                "cultivar": cultivar_code,
                "sowing_date": sowing_date.isoformat(),
                "fertilizer_applied": {
                    "n_kg_ha": n_kg_ha,
                    "p_kg_ha": p_kg_ha,
                    "k_kg_ha": k_kg_ha,
                },
                "latitude": latitude,
                "longitude": longitude,
            },
        }
    finally:
        dssat.close()


def _generate_nutrient_advisory(
    crop: str,
    n_applied: float,
    p_applied: float,
    k_applied: float,
    n_stress: float | None,
    yield_kg_ha: float | None,
    sowing_date: date,
) -> dict:
    """Generate fertilizer recommendation in frontend-expected format."""
    # Recommended rates for Indian conditions (kg/ha)
    recommended_n = {
        "wheat": 120, "rice": 150, "maize": 120, "soybean": 25,
        "sorghum": 80, "potato": 150, "sugarcane": 200,
        "millet": 60, "mungbean": 20,
    }
    rec_n = recommended_n.get(crop, 100)
    rec_p = rec_n // 2
    rec_k = rec_n // 3

    # Soil health note based on stress
    soil_health_note = "Soil nutrient levels appear adequate for this crop."
    if n_stress is not None and n_stress < 0.8:
        soil_health_note = (
            f"Nitrogen stress detected (stress factor {n_stress:.2f}). "
            "Consider soil testing and increasing organic matter through "
            "green manure or compost application."
        )

    # Build application schedule
    applications = [
        {
            "timing": "Basal (at sowing)",
            "day_after_sowing": 0,
            "n_kg": round(rec_n * 0.33, 1),
            "p_kg": round(rec_p, 1),
            "k_kg": round(rec_k, 1),
            "product_suggestion": "DAP (18:46:0) + MOP (0:0:60)",
        },
        {
            "timing": "First top-dress (tillering/vegetative)",
            "day_after_sowing": 30,
            "n_kg": round(rec_n * 0.33, 1),
            "p_kg": 0,
            "k_kg": 0,
            "product_suggestion": "Urea (46:0:0)",
        },
        {
            "timing": "Second top-dress (reproductive)",
            "day_after_sowing": 60,
            "n_kg": round(rec_n * 0.34, 1),
            "p_kg": 0,
            "k_kg": 0,
            "product_suggestion": "Urea (46:0:0)",
        },
    ]

    return {
        "model": "DSSAT",
        "nitrogen_kg_ha": rec_n,
        "phosphorus_kg_ha": rec_p,
        "potassium_kg_ha": rec_k,
        "applications": applications,
        "soil_health_note": soil_health_note,
    }
