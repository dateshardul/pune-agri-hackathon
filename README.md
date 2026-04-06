# KrishiDisha — New Direction to Smart Agriculture

> **Team DISHA** | Pune Agriculture Hackathon 2026 | Theme 7: Climate Resilient Digital Agriculture

## What is KrishiDisha?

A multi-model farm digital twin platform that combines **3 crop simulation engines**, **7 real-time data sources**, **3D terrain visualization**, and **ML ensemble prediction** to give Indian farmers a complete farming plan — from land preparation to post-harvest.

## The Problem

- 70% of Indian farmers lack weather-based crop guidance
- $923M annual wheat losses from ground-level ozone — zero tools address this
- Groundwater depleting 0.3m/year — farmers don't know when to switch crops
- No platform combines yield prediction + water management + nutrient planning + climate risk

## Our Solution

### 3 Crop Simulation Engines (running in parallel)

| Engine | Developer | What it does | Crops |
|--------|-----------|-------------|-------|
| **WOFOST 7.2** | Wageningen | Physics-based yield prediction, daily growth curves | 13 |
| **AquaCrop** | FAO | Water productivity, irrigation scheduling, drought analysis | 8 |
| **DSSAT-CSM v4.8** | IFDC/UF | Nutrient management, N/P/K fertilizer optimization | 9 |

### 7 Real-Time Data Sources

NASA POWER (weather), Copernicus ERA5 (climate reanalysis), SoilGrids v2.0 (soil), Copernicus GLO-30 DEM (30m terrain), ESA WorldCover (10m land cover), CGWB/GRACE-FO (groundwater), Open-Meteo (7-day forecast)

### Key Innovations

- **OzoneSight**: First platform tracking crop damage from ground-level ozone
- **3-Model Ensemble**: Nobody combines WOFOST + AquaCrop + DSSAT in one platform
- **Elevation-based crop zone planning** on real 30m 3D terrain
- **Season mismatch detection**: Warns if planting wrong crop in wrong season
- **Pest/disease risk** from DSSAT stress indicators + weather-based rules

## User Flow

1. Input farm location + area
2. Auto-analyze terrain, weather, soil, groundwater, ozone, land cover
3. AI recommends crops ranked by suitability
4. Run 3 models in parallel (18 seconds for 3 crops)
5. Get complete farming plan: sowing dates, irrigation, fertilizer, pest risk, activity timeline

## Tech Stack

**Backend**: Python/FastAPI, PCSE, aquacrop, DSSATTools, scikit-learn, rasterio, cdsapi
**Frontend**: React 19/TypeScript/Vite, holographic-core 3D engine, Three.js
**APIs**: NASA POWER, ERA5, SoilGrids, Copernicus DEM, ESA WorldCover, CGWB, Open-Meteo

## Running Locally

```bash
# Backend
cd backend && source venv/bin/activate && uvicorn app.main:app --reload --port 8001

# Frontend
cd frontend && npm run dev
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/farm/analyze` | Unified multi-crop farm analysis |
| POST | `/api/simulate/` | WOFOST crop simulation |
| POST | `/api/simulate/water-advisory` | AquaCrop irrigation advisory |
| POST | `/api/simulate/nutrient-advisory` | DSSAT fertilizer advisory |
| POST | `/api/simulate/smart-advisory` | Smart model router |
| POST | `/api/simulate/sowing-optimizer` | Sowing period optimizer |
| POST | `/api/predict/` | ML yield prediction |
| GET | `/api/data/weather` | NASA POWER weather |
| GET | `/api/data/era5` | ERA5 reanalysis |
| GET | `/api/data/soil` | SoilGrids soil |
| GET | `/api/data/forecast` | 7-day forecast |
| GET | `/api/data/landcover` | ESA WorldCover |
| GET | `/api/elevation/dem` | Copernicus 30m DEM |
| GET | `/api/groundwater/` | Groundwater analysis |
| GET | `/api/ozone/` | Ozone analysis |
| POST | `/api/advisory/chat` | AI farm advisory |

## Competitive Landscape

| Feature | KrishiDisha | CropIn | Fasal | BharatAgri |
|---------|------------|--------|-------|------------|
| Yield Simulation | WOFOST + ML | No | No | No |
| Water Optimization | AquaCrop (FAO) | No | IoT sensors | No |
| Nutrient Planning | DSSAT | No | No | No |
| Ozone Tracking | OzoneSight | No | No | No |
| 3D Terrain | Real 30m DEM | No | No | No |
| No Hardware Needed | Yes | Yes | No (IoT) | Yes |

## Team

**Team DISHA** (दिशा — "direction") | Pune Agriculture Hackathon 2026
