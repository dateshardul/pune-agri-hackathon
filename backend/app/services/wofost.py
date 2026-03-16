"""WOFOST crop simulation service using PCSE.

Runs WOFOST 7.2 water-limited production simulations.
Converts NASA POWER weather data into PCSE-compatible format and returns
daily crop growth output + summary yield/biomass.
"""

import math
from datetime import date, datetime, timedelta

import numpy as np
from pcse.base import ParameterProvider, WeatherDataContainer, WeatherDataProvider
from pcse.input import DummySoilDataProvider, YAMLCropDataProvider
from pcse.models import Wofost72_WLP_FD

from app.models.schemas import DailyWeather

# Crops available in PCSE with their default varieties (India-relevant subset)
CROP_VARIETIES: dict[str, str] = {
    "wheat": "Winter_wheat_101",
    "rice": "Rice_IR72",
    "maize": "Grain_maize_201",
    "chickpea": "Chickpea_VanHeemst_1988",
    "cotton": "Cotton_VanHeemst_1988",
    "sorghum": "Sorghum_VanHeemst_1988",
    "millet": "Millet_VanHeemst_1988",
    "groundnut": "Groundnut_VanHeemst_1988",
    "soybean": "Soybean_VanHeemst_1988",
    "sugarcane": "Sugarcane_VanHeemst_1988",
    "potato": "Potato_701",
    "mungbean": "Mungbean_VanHeemst_1988",
    "pigeonpea": "Pigeonpea_VanHeemst_1988",
}


def _saturated_vapour_pressure(temp_c: float) -> float:
    """Tetens formula: saturation vapour pressure (kPa) from temperature (°C)."""
    return 0.6108 * math.exp((17.27 * temp_c) / (temp_c + 237.3))


def _estimate_et0(tmin: float, tmax: float, irrad_mj: float, wind: float,
                  rh: float, lat_rad: float, doy: int) -> float:
    """Simplified Penman-Monteith FAO-56 reference ET (mm/day).

    This is a reduced form — good enough for hackathon-grade simulation.
    """
    tmean = (tmin + tmax) / 2.0
    es = (_saturated_vapour_pressure(tmax) + _saturated_vapour_pressure(tmin)) / 2.0
    ea = es * (rh / 100.0)
    delta = (4098 * _saturated_vapour_pressure(tmean)) / ((tmean + 237.3) ** 2)
    gamma = 0.0665  # psychrometric constant at ~100kPa (kPa/°C)

    # Net radiation approximation (MJ/m²/day)
    rns = (1 - 0.23) * irrad_mj  # net shortwave
    # Simplified net longwave (Brunt-type approximation)
    sigma_t = 4.903e-9 * (((tmax + 273.16) ** 4 + (tmin + 273.16) ** 4) / 2.0)
    rnl = sigma_t * (0.34 - 0.14 * math.sqrt(max(ea, 0.01))) * (1.35 * min(irrad_mj / max(irrad_mj * 0.75, 0.1), 1.0) - 0.35)
    rn = rns - rnl

    et0 = ((0.408 * delta * rn + gamma * (900 / (tmean + 273)) * wind * (es - ea))
           / (delta + gamma * (1 + 0.34 * wind)))
    return max(et0, 0.0)


class NASAPowerWeatherAdapter(WeatherDataProvider):
    """Adapts our NASA POWER weather data into PCSE WeatherDataProvider format."""

    def __init__(self, latitude: float, longitude: float,
                 weather_data: list[DailyWeather], elevation: float = 500.0):
        super().__init__()
        self.latitude = latitude
        self.longitude = longitude
        self.elevation = elevation

        # PCSE base class uses self.store = {} with (date, member_id) keys
        # and computes first_date/last_date as properties from self.store

        lat_rad = math.radians(latitude)

        for w in weather_data:
            day = datetime.strptime(w.date, "%Y-%m-%d").date()
            tmax = w.temperature_max if w.temperature_max is not None else 30.0
            tmin = w.temperature_min if w.temperature_min is not None else 20.0
            rain = w.precipitation if w.precipitation is not None else 0.0
            irrad_mj = w.solar_radiation if w.solar_radiation is not None else 15.0
            rh = w.relative_humidity if w.relative_humidity is not None else 60.0
            wind = w.wind_speed if w.wind_speed is not None else 2.0

            # PCSE wants irradiation in J/m²/day (not MJ)
            irrad = irrad_mj * 1e6

            # Vapour pressure (kPa) from relative humidity
            es = (_saturated_vapour_pressure(tmax) + _saturated_vapour_pressure(tmin)) / 2.0
            vap = es * (rh / 100.0)

            # Reference evapotranspiration
            doy = day.timetuple().tm_yday
            et0 = _estimate_et0(tmin, tmax, irrad_mj, wind, rh, lat_rad, doy)

            # E0 (open water) ≈ 1.2 * ET0, ES0 (bare soil) ≈ ET0
            e0 = et0 * 1.2
            es0 = et0

            wdc = WeatherDataContainer(
                LAT=latitude, LON=longitude, ELEV=elevation,
                DAY=day,
                IRRAD=irrad,
                TMIN=tmin,
                TMAX=tmax,
                VAP=vap,
                RAIN=rain / 10.0,  # PCSE expects cm/day
                WIND=wind,
                E0=e0 / 10.0,     # cm/day
                ES0=es0 / 10.0,
                ET0=et0 / 10.0,
                TEMP=(tmin + tmax) / 2.0,
            )
            # Use the PCSE base class store mechanism
            self._store_WeatherDataContainer(wdc, day)


def _build_agromanagement(crop: str, variety: str,
                          sowing_date: date, harvest_date: date,
                          first_weather_date: date | None = None) -> list:
    """Build PCSE agromanagement calendar."""
    # Campaign start must be within available weather data
    campaign_start = sowing_date - timedelta(days=30)
    if first_weather_date and campaign_start < first_weather_date:
        campaign_start = first_weather_date
    return [{
        campaign_start: {
            "CropCalendar": {
                "crop_name": crop,
                "variety_name": variety,
                "crop_start_date": sowing_date,
                "crop_start_type": "emergence",
                "crop_end_date": harvest_date,
                "crop_end_type": "harvest",
                "max_duration": (harvest_date - sowing_date).days + 30,
            },
            "TimedEvents": None,
            "StateEvents": None,
        }
    }]


def get_available_crops() -> dict[str, str]:
    """Return dict of crop_name -> default_variety."""
    return dict(CROP_VARIETIES)


def run_wofost(
    latitude: float,
    longitude: float,
    weather_data: list[DailyWeather],
    crop: str = "wheat",
    sowing_date: date | None = None,
    harvest_date: date | None = None,
    elevation: float = 500.0,
) -> dict:
    """Run a WOFOST 7.2 water-limited simulation.

    Args:
        latitude, longitude: Location coordinates
        weather_data: Daily weather from NASA POWER (our format)
        crop: Crop name (must be in CROP_VARIETIES)
        sowing_date: Crop sowing date (defaults to first weather date + 7 days)
        harvest_date: Expected harvest (defaults to sowing + 120 days)
        elevation: Site elevation in meters

    Returns:
        dict with 'daily_output', 'summary', and 'metadata'
    """
    if crop not in CROP_VARIETIES:
        raise ValueError(f"Unknown crop '{crop}'. Available: {list(CROP_VARIETIES.keys())}")

    variety = CROP_VARIETIES[crop]

    # Default dates based on weather data range
    weather_dates = [datetime.strptime(w.date, "%Y-%m-%d").date() for w in weather_data]
    if sowing_date is None:
        sowing_date = min(weather_dates) + timedelta(days=7)
    if harvest_date is None:
        harvest_date = sowing_date + timedelta(days=120)

    # Weather provider
    wdp = NASAPowerWeatherAdapter(latitude, longitude, weather_data, elevation)

    # Crop data
    cropd = YAMLCropDataProvider()
    cropd.set_active_crop(crop, variety)

    # Soil — using dummy for now, future: derive from SoilGrids data
    soild = DummySoilDataProvider()

    # Site data
    sited = {"WAV": 100, "NOTINF": 0, "SMLIM": 0.4, "SSI": 0, "SSMAX": 0, "IFUNRN": 0}

    params = ParameterProvider(cropdata=cropd, soildata=soild, sitedata=sited)
    agro = _build_agromanagement(crop, variety, sowing_date, harvest_date,
                                first_weather_date=wdp.first_date)

    # Run simulation
    model = Wofost72_WLP_FD(params, wdp, agro)
    model.run_till_terminate()

    output = model.get_output()
    summary = model.get_summary_output()

    # Convert output to serializable format
    daily_output = []
    for row in output:
        day_data = {}
        for k, v in row.items():
            if k == "day":
                day_data["date"] = v.isoformat()
            elif isinstance(v, (int, float)):
                day_data[k] = round(float(v), 4) if not np.isnan(v) else None
            else:
                day_data[k] = v
        daily_output.append(day_data)

    # Extract key summary metrics
    summary_data = {}
    if summary:
        s = summary[0]
        summary_data = {
            k: (v.isoformat() if isinstance(v, date) else
                round(float(v), 2) if isinstance(v, (int, float)) and not np.isnan(v) else v)
            for k, v in s.items()
        }

    return {
        "daily_output": daily_output,
        "summary": summary_data,
        "metadata": {
            "crop": crop,
            "variety": variety,
            "sowing_date": sowing_date.isoformat(),
            "harvest_date": harvest_date.isoformat(),
            "latitude": latitude,
            "longitude": longitude,
            "model": "WOFOST 7.2 (Water-Limited)",
            "days_simulated": len(daily_output),
        },
    }
