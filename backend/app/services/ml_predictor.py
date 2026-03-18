"""Multi-modal ML yield predictor — CropNet-inspired architecture.

Fuses weather, soil, ozone, groundwater, and crop features into a single
prediction using Gradient Boosting. Trained on synthetic agronomic response
data at startup; architecture is designed to accept real ICAR yield
observations with zero code changes.

References:
- CropNet (KDD 2024): Multi-modal fusion approach
- ICAR national crop yield averages for India
- Mills et al. (2007): Ozone exposure-response functions
- CGWB 2023: Groundwater extraction impact on agriculture
"""

import logging
import math
from dataclasses import dataclass

import numpy as np
from sklearn.ensemble import GradientBoostingRegressor

logger = logging.getLogger(__name__)

# ── Indian crop base yields (ICAR national averages, kg/ha) ──────────

CROP_BASE_YIELDS: dict[str, float] = {
    "wheat": 3200,
    "rice": 3500,
    "maize": 2800,
    "chickpea": 1100,
    "cotton": 1600,
    "sorghum": 900,
    "millet": 1200,
    "groundnut": 1500,
    "soybean": 1100,
    "sugarcane": 70000,  # kg/ha (cane, not sugar)
    "potato": 22000,
    "mungbean": 500,
    "pigeonpea": 800,
}

# Crop grouping for feature encoding
CROP_GROUPS: dict[str, int] = {
    "wheat": 0, "rice": 0, "maize": 0, "sorghum": 0, "millet": 0,  # cereals
    "chickpea": 1, "mungbean": 1, "pigeonpea": 1, "soybean": 1, "groundnut": 1,  # pulses/oilseeds
    "cotton": 2, "sugarcane": 2, "potato": 2,  # cash crops
}

# Water requirement categories (mm/season)
CROP_WATER_NEED: dict[str, float] = {
    "wheat": 400, "rice": 1200, "maize": 600, "chickpea": 250,
    "cotton": 700, "sorghum": 350, "millet": 300, "groundnut": 450,
    "soybean": 500, "sugarcane": 1800, "potato": 500, "mungbean": 250,
    "pigeonpea": 350,
}

FEATURE_NAMES = [
    # Weather (10)
    "gdd_total", "precip_total_mm", "precip_cv", "drought_days",
    "avg_solar_rad", "temp_range_avg", "heat_stress_days",
    "cold_stress_days", "humidity_mean", "wind_mean",
    # Soil (6)
    "clay_pct", "sand_pct", "organic_carbon", "ph",
    "bulk_density", "water_holding_capacity",
    # Stress (3)
    "ozone_yield_loss_pct", "gw_extraction_stage", "gw_depth_m",
    # Crop (3)
    "crop_group", "water_requirement", "base_yield",
    # Location (3)
    "latitude", "longitude", "elevation",
]

FEATURE_SOURCES = {
    "gdd_total": "weather", "precip_total_mm": "weather", "precip_cv": "weather",
    "drought_days": "weather", "avg_solar_rad": "weather", "temp_range_avg": "weather",
    "heat_stress_days": "weather", "cold_stress_days": "weather",
    "humidity_mean": "weather", "wind_mean": "weather",
    "clay_pct": "soil", "sand_pct": "soil", "organic_carbon": "soil",
    "ph": "soil", "bulk_density": "soil", "water_holding_capacity": "soil",
    "ozone_yield_loss_pct": "stress", "gw_extraction_stage": "stress",
    "gw_depth_m": "stress",
    "crop_group": "crop", "water_requirement": "crop", "base_yield": "crop",
    "latitude": "location", "longitude": "location", "elevation": "location",
}

FEATURE_LABELS = {
    "gdd_total": "Growing Degree Days",
    "precip_total_mm": "Total Rainfall (mm)",
    "precip_cv": "Rainfall Variability",
    "drought_days": "Drought Days",
    "avg_solar_rad": "Avg Sunlight (MJ/m²/day)",
    "temp_range_avg": "Avg Day-Night Temp Range",
    "heat_stress_days": "Heat Stress Days (>38°C)",
    "cold_stress_days": "Cold Stress Days (<5°C)",
    "humidity_mean": "Avg Humidity (%)",
    "wind_mean": "Avg Wind Speed (m/s)",
    "clay_pct": "Clay Content (%)",
    "sand_pct": "Sand Content (%)",
    "organic_carbon": "Organic Carbon (g/kg)",
    "ph": "Soil pH",
    "bulk_density": "Soil Density",
    "water_holding_capacity": "Water Holding Capacity",
    "ozone_yield_loss_pct": "Ozone Damage (%)",
    "gw_extraction_stage": "Groundwater Use (%)",
    "gw_depth_m": "Water Table Depth (m)",
    "crop_group": "Crop Type",
    "water_requirement": "Crop Water Need (mm)",
    "base_yield": "Typical Yield (kg/ha)",
    "latitude": "Latitude",
    "longitude": "Longitude",
    "elevation": "Elevation (m)",
}


# ── Agronomic response functions ─────────────────────────────────────

def _f_thermal(gdd: float, crop_gdd_optimal: float = 1800) -> float:
    """Thermal response — sigmoid around optimal GDD."""
    x = gdd / crop_gdd_optimal
    if x < 0.3:
        return 0.2 + 0.8 * (x / 0.3)
    elif x > 1.5:
        return max(0.3, 1.0 - 0.4 * (x - 1.5))
    return 0.8 + 0.2 * math.exp(-2 * (x - 1.0) ** 2)


def _f_water(precip_mm: float, water_need_mm: float) -> float:
    """Water response — diminishing returns above need, steep drop below."""
    ratio = precip_mm / max(water_need_mm, 1)
    if ratio < 0.3:
        return 0.2 + 0.6 * (ratio / 0.3)
    elif ratio < 1.0:
        return 0.8 + 0.2 * ((ratio - 0.3) / 0.7)
    elif ratio > 2.0:
        return max(0.6, 1.0 - 0.1 * (ratio - 2.0))  # waterlogging
    return 1.0


def _f_solar(rad: float) -> float:
    """Solar radiation response — plateau above ~18 MJ/m²/day."""
    return min(1.0, 0.4 + 0.6 * (rad / 18.0))


def _f_stress(heat_days: float, drought_days: float) -> float:
    """Combined heat+drought stress penalty."""
    heat_penalty = max(0.5, 1.0 - 0.015 * heat_days)
    drought_penalty = max(0.4, 1.0 - 0.01 * drought_days)
    return heat_penalty * drought_penalty


def _f_ozone(loss_pct: float) -> float:
    """Ozone damage factor."""
    return max(0.5, 1.0 - loss_pct / 100.0)


def _f_soil(ph: float, organic_carbon: float, clay_pct: float) -> float:
    """Soil quality factor from pH, organic carbon, clay content."""
    # pH optimum around 6.5 for most crops
    ph_factor = max(0.5, 1.0 - 0.08 * abs(ph - 6.5))
    # OC > 10 g/kg is good
    oc_factor = min(1.0, 0.6 + 0.04 * organic_carbon)
    # Clay 20-40% is optimal for most crops
    clay_factor = max(0.6, 1.0 - 0.005 * abs(clay_pct - 30))
    return ph_factor * oc_factor * clay_factor


# ── Feature extraction ───────────────────────────────────────────────

def extract_features(
    weather_data: list[dict],
    soil_layers: list[dict] | None,
    crop: str,
    lat: float, lon: float, elevation: float,
    ozone_loss_pct: float = 0.0,
    gw_extraction_stage: float = 50.0,
    gw_depth_m: float = 10.0,
) -> dict[str, float]:
    """Extract ~25 features from multi-modal raw data."""

    # ── Weather features ──
    temps_max = [d.get("temperature_max") or 30.0 for d in weather_data]
    temps_min = [d.get("temperature_min") or 20.0 for d in weather_data]
    precips = [d.get("precipitation") or 0.0 for d in weather_data]
    rads = [d.get("solar_radiation") or 15.0 for d in weather_data]
    humids = [d.get("relative_humidity") or 60.0 for d in weather_data]
    winds = [d.get("wind_speed") or 2.0 for d in weather_data]

    n = max(len(weather_data), 1)
    tmeans = [(mx + mn) / 2.0 for mx, mn in zip(temps_max, temps_min)]

    gdd_total = sum(max(0, t - 10.0) for t in tmeans)
    precip_total = sum(precips)
    precip_mean = precip_total / n
    precip_cv = (np.std(precips) / max(precip_mean, 0.01)) if precip_mean > 0.01 else 0.0
    drought_days = sum(1 for p, t in zip(precips, temps_max) if p < 1.0 and t > 35.0)
    avg_solar = sum(rads) / n
    temp_range_avg = sum(mx - mn for mx, mn in zip(temps_max, temps_min)) / n
    heat_stress = sum(1 for t in temps_max if t > 38.0)
    cold_stress = sum(1 for t in temps_min if t < 5.0)
    humidity_mean = sum(humids) / n
    wind_mean = sum(winds) / n

    # ── Soil features (average top 3 layers = ~0-30cm) ──
    if soil_layers and len(soil_layers) > 0:
        top = soil_layers[:min(3, len(soil_layers))]
        clay = np.mean([l.get("clay") or 30.0 for l in top])
        sand = np.mean([l.get("sand") or 40.0 for l in top])
        oc = np.mean([l.get("organic_carbon") or 8.0 for l in top])
        ph = np.mean([l.get("ph") or 6.5 for l in top])
        bd = np.mean([l.get("bulk_density") or 1.4 for l in top])
    else:
        clay, sand, oc, ph, bd = 30.0, 40.0, 8.0, 6.5, 1.4

    # Water holding capacity estimate from clay content (Saxton & Rawls PTF)
    whc = 0.15 + 0.005 * clay  # simplified

    # ── Crop features ──
    crop_group = float(CROP_GROUPS.get(crop, 0))
    water_req = CROP_WATER_NEED.get(crop, 500)
    base_yield = CROP_BASE_YIELDS.get(crop, 2000)

    return {
        "gdd_total": round(gdd_total, 1),
        "precip_total_mm": round(precip_total, 1),
        "precip_cv": round(float(precip_cv), 3),
        "drought_days": float(drought_days),
        "avg_solar_rad": round(avg_solar, 2),
        "temp_range_avg": round(temp_range_avg, 2),
        "heat_stress_days": float(heat_stress),
        "cold_stress_days": float(cold_stress),
        "humidity_mean": round(humidity_mean, 1),
        "wind_mean": round(wind_mean, 2),
        "clay_pct": round(float(clay), 1),
        "sand_pct": round(float(sand), 1),
        "organic_carbon": round(float(oc), 2),
        "ph": round(float(ph), 2),
        "bulk_density": round(float(bd), 3),
        "water_holding_capacity": round(whc, 3),
        "ozone_yield_loss_pct": round(ozone_loss_pct, 2),
        "gw_extraction_stage": round(gw_extraction_stage, 1),
        "gw_depth_m": round(gw_depth_m, 1),
        "crop_group": crop_group,
        "water_requirement": float(water_req),
        "base_yield": base_yield,
        "latitude": lat,
        "longitude": lon,
        "elevation": elevation,
    }


# ── Predictor class ──────────────────────────────────────────────────

class CropYieldPredictor:
    """Multi-modal ML yield predictor using Gradient Boosting."""

    def __init__(self):
        self.model: GradientBoostingRegressor | None = None
        self.is_trained = False
        self.training_samples = 0

    def _generate_training_data(self, n_samples: int = 2000) -> tuple[np.ndarray, np.ndarray]:
        """Generate synthetic training data using agronomic response functions."""
        rng = np.random.RandomState(42)
        X = np.zeros((n_samples, len(FEATURE_NAMES)))
        y = np.zeros(n_samples)

        crops = list(CROP_BASE_YIELDS.keys())

        for i in range(n_samples):
            crop = crops[rng.randint(len(crops))]
            base = CROP_BASE_YIELDS[crop]
            water_need = CROP_WATER_NEED[crop]

            # Sample Indian climate distributions
            gdd = rng.uniform(800, 3500)
            precip = rng.uniform(100, 2000)
            precip_cv = rng.uniform(0.3, 2.5)
            drought_days = rng.uniform(0, 60)
            solar = rng.uniform(10, 25)
            temp_range = rng.uniform(6, 18)
            heat_stress = rng.uniform(0, 40)
            cold_stress = rng.uniform(0, 20)
            humidity = rng.uniform(30, 90)
            wind = rng.uniform(0.5, 6)

            clay = rng.uniform(5, 60)
            sand = rng.uniform(10, 80)
            oc = rng.uniform(1, 25)
            ph = rng.uniform(4.5, 9.0)
            bd = rng.uniform(1.0, 1.8)
            whc = 0.15 + 0.005 * clay

            ozone_loss = rng.uniform(0, 15)
            gw_stage = rng.uniform(20, 150)
            gw_depth = rng.uniform(2, 30)

            crop_group = float(CROP_GROUPS.get(crop, 0))
            lat = rng.uniform(8, 35)
            lon = rng.uniform(68, 97)
            elev = rng.uniform(0, 1500)

            # Compute yield via response functions
            yield_val = base
            yield_val *= _f_thermal(gdd)
            yield_val *= _f_water(precip, water_need)
            yield_val *= _f_solar(solar)
            yield_val *= _f_stress(heat_stress, drought_days)
            yield_val *= _f_ozone(ozone_loss)
            yield_val *= _f_soil(ph, oc, clay)

            # Groundwater stress: high extraction → reduced irrigation → lower yield
            if gw_stage > 100:
                yield_val *= max(0.6, 1.0 - 0.003 * (gw_stage - 100))

            # Add noise (8% CV)
            yield_val *= (1.0 + rng.normal(0, 0.08))
            yield_val = max(50, yield_val)

            X[i] = [
                gdd, precip, precip_cv, drought_days, solar, temp_range,
                heat_stress, cold_stress, humidity, wind,
                clay, sand, oc, ph, bd, whc,
                ozone_loss, gw_stage, gw_depth,
                crop_group, water_need, base,
                lat, lon, elev,
            ]
            y[i] = yield_val

        return X, y

    def train(self):
        """Train the model on synthetic data. Called once at startup."""
        logger.info("Training multi-modal yield prediction model...")
        X, y = self._generate_training_data(n_samples=2000)

        self.model = GradientBoostingRegressor(
            n_estimators=200,
            max_depth=5,
            learning_rate=0.1,
            subsample=0.8,
            random_state=42,
        )
        self.model.fit(X, y)
        self.is_trained = True
        self.training_samples = len(y)

        # Log training stats
        train_pred = self.model.predict(X)
        rmse = float(np.sqrt(np.mean((train_pred - y) ** 2)))
        r2 = float(self.model.score(X, y))
        logger.info(f"ML model trained: {self.training_samples} samples, R²={r2:.3f}, RMSE={rmse:.0f} kg/ha")

    def predict(self, features: dict[str, float]) -> dict:
        """Predict yield with confidence estimate."""
        if not self.is_trained or self.model is None:
            raise RuntimeError("ML model not trained yet")

        x = np.array([[features[f] for f in FEATURE_NAMES]])
        prediction = float(self.model.predict(x)[0])

        # Estimate confidence from individual tree predictions
        tree_preds = np.array([
            tree[0].predict(x)[0] for tree in self.model.estimators_
        ])
        std = float(np.std(tree_preds))

        # Feature importance with actual values
        importances = self.model.feature_importances_
        feature_importance = []
        for fname, imp in sorted(zip(FEATURE_NAMES, importances), key=lambda x: -x[1]):
            if imp > 0.005:  # skip negligible features
                feature_importance.append({
                    "feature": fname,
                    "label": FEATURE_LABELS.get(fname, fname),
                    "importance": round(float(imp), 4),
                    "value_used": round(features.get(fname, 0), 2),
                    "source": FEATURE_SOURCES.get(fname, "unknown"),
                })

        return {
            "yield_kg_ha": round(max(0, prediction), 1),
            "confidence_lower": round(max(0, prediction - 1.96 * std), 1),
            "confidence_upper": round(prediction + 1.96 * std, 1),
            "std_kg_ha": round(std, 1),
            "model": "GradientBoosting (200 trees, multi-modal)",
            "features_used": len(FEATURE_NAMES),
            "training_samples": self.training_samples,
            "feature_importance": feature_importance,
        }

    def get_global_feature_importance(self) -> list[dict]:
        """Return global feature importances (not per-prediction)."""
        if not self.is_trained or self.model is None:
            return []
        importances = self.model.feature_importances_
        return [
            {
                "feature": fname,
                "label": FEATURE_LABELS.get(fname, fname),
                "importance": round(float(imp), 4),
                "source": FEATURE_SOURCES.get(fname, "unknown"),
            }
            for fname, imp in sorted(zip(FEATURE_NAMES, importances), key=lambda x: -x[1])
            if imp > 0.001
        ]


# Module-level singleton
predictor = CropYieldPredictor()
