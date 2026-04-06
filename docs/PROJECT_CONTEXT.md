# KrishiDisha — Complete Project Context

> Use this document to give any AI assistant full context about the project.

## Identity
- **Project**: KrishiDisha — "New Direction to Smart Agriculture"
- **Team**: DISHA (दिशा)
- **Hackathon**: Pune Agriculture Hackathon 2026, Theme 7: Climate Resilient Digital Agriculture
- **Code**: github.com/dateshardul/pune-agri-hackathon

## Architecture

### 3 Crop Simulation Models
1. **WOFOST 7.2** (via PCSE Python) — physics-based daily crop growth, yield prediction. 13 Indian crops. Water-limited production mode.
2. **AquaCrop** (via aquacrop pip package) — FAO water productivity model. Irrigation scheduling, drought analysis. 8 crops.
3. **DSSAT-CSM v4.8** (via DSSATTools pip) — nutrient dynamics, N/P/K fertilizer optimization. Pest stress indicators. 9 crops.

### ML Ensemble
- GradientBoostingRegressor (scikit-learn), 28 features from all 3 models + environmental data
- Features include: 10 weather, 6 soil, 3 stress (ozone/groundwater), 3 crop identity, 3 location, 3 model outputs (WOFOST yield, AquaCrop water productivity, DSSAT N stress)
- Trained on synthetic agronomic response functions at startup (~1 second)
- Architecture accepts real ICAR district yield data with zero code changes

### 7 Real-Time Data Sources
1. **NASA POWER** — daily weather (temp, precipitation, solar radiation, humidity, wind)
2. **Copernicus ERA5** — high-quality climate reanalysis (0.25° resolution, via cdsapi)
3. **SoilGrids v2.0** — soil properties (clay, sand, pH, organic carbon, bulk density) at 5 depth layers
4. **Copernicus GLO-30 DEM** — 30m elevation terrain (Cloud Optimized GeoTIFF on AWS S3, via rasterio)
5. **ESA WorldCover** — 10m land use/land cover classification (cropland, trees, built-up, water)
6. **CGWB/GRACE-FO** — groundwater aquifer status, depletion trends, crop-switching advisory
7. **Open-Meteo** — 7-day weather forecast with farming tips

### API Cache
- File-based cache with JSONL call log (`/tmp/krishitwin_cache/`)
- Configurable TTL per service (6h weather, 24h elevation/soil)
- `GET /api/data/api-stats` returns cache hit rates

## Backend Structure (Python/FastAPI)

```
backend/app/
  main.py                    # FastAPI app, router registration, ML startup
  models/schemas.py          # Pydantic request/response models
  api/routes/
    farm.py                  # POST /api/farm/analyze — unified analysis
    simulation.py            # WOFOST, AquaCrop, DSSAT, smart-advisory, sowing-optimizer
    prediction.py            # ML multi-modal prediction
    data.py                  # Weather, soil, forecast, ERA5, landcover
    elevation.py             # Copernicus DEM
    groundwater.py           # Groundwater analysis
    ozone.py                 # Ozone exposure
    advisory.py              # AI chat (Claude)
  services/
    unified_analysis.py      # Main orchestrator — multi-crop parallel analysis
    wofost.py                # WOFOST 7.2 wrapper + Indian crop calendar
    aquacrop_sim.py          # AquaCrop wrapper + irrigation schedule
    dssat_sim.py             # DSSAT wrapper + fertilizer schedule + soil hydraulics
    sowing_optimizer.py      # Hierarchical season→month→week optimization
    ml_predictor.py          # ML ensemble (28 features, GradientBoosting)
    elevation.py             # Copernicus DEM + hillshade + fallbacks
    landcover.py             # ESA WorldCover LULC
    nasa_power.py            # NASA POWER weather
    copernicus_cds.py        # ERA5 climate data
    soilgrids.py             # SoilGrids soil (with Pune fallback)
    groundwater.py           # CGWB/GRACE-FO regional aquifer data
    ozone_sight.py           # Ozone AOT40 exposure-response functions
    forecast.py              # Open-Meteo 7-day forecast + farming tips
    advisory_llm.py          # Claude AI with real-time farm context injection
    api_cache.py             # File-based API cache + call logging
```

## Frontend Structure (React-TS/Vite)

```
frontend/src/
  App.tsx                    # Router (2 tabs: Farm Analysis, AI Chat)
  App.css                    # Global styles
  components/
    FarmAnalysis.tsx          # Main 5-step wizard (~1500 lines)
                              # Step 1: Input (lat/lon, field area)
                              # Step 2: Environment analysis (progressive loading)
                              # Step 3: Crop recommendation
                              # Step 4: Simulation (3 models in parallel)
                              # Step 5: Results dashboard
    MapView.tsx               # 3D terrain (holographic-core engine)
                              # Real elevation, crop zone overlays, compass, layers
    AdvisoryChat.tsx          # AI chat with farm context
    Dashboard.tsx             # Weather + soil + forecast display
    SowingOptimizer.tsx       # Sowing period optimization UI
    SmartAdvisory.tsx         # Smart model-routed advisory
    YieldPredictor.tsx        # ML vs WOFOST comparison
    ScenarioExplorer.tsx      # Climate what-if scenarios
    OzoneSight.tsx            # Ozone crop damage analysis
    GroundwaterView.tsx       # Groundwater + crop switching
  services/api.ts             # All API types + fetch functions
```

## Key Technical Decisions

1. **Parallel execution**: All crops + all models run concurrently via asyncio.gather + ThreadPoolExecutor(12). Achieved 18-second response for 3 crops (was >3 minutes sequential).

2. **Planning vs simulation dates**: Display shows NEXT upcoming season (2026) for recommendations. Models run on PAST season weather data for accuracy.

3. **Elevation-based zone assignment**: DEM percentiles (p33/p66) classify terrain into valley/slope/hilltop. Crops sorted by water need: highest water → valley, drought-tolerant → hilltop.

4. **Season mismatch detection**: If user overrides wheat to kharif, system detects natural season conflict, marks feasibility as "critical" with warning.

5. **LULC early warning**: ESA WorldCover checked after land analysis (Step 2). If built-up >50%, farming blocked before running expensive simulations.

6. **Pest/disease risk**: Uses DSSAT N-stress + AquaCrop drought risk + crop-specific pest calendars (temperature + humidity thresholds) for IPM recommendations.

7. **Crop calendar**: Indian agricultural calendar with rabi (Oct-Mar), kharif (Jun-Oct), summer (Feb-May) seasons. 13 crops with specific sowing months and durations.

## Unified Analysis Flow (`POST /api/farm/analyze`)

```
Phase 1 (5s): Parallel data fetch
  ├─ NASA POWER weather (365 days)
  ├─ SoilGrids soil profile
  ├─ Copernicus DEM elevation (64×64)
  ├─ CGWB groundwater
  ├─ OzoneSight ozone
  ├─ ESA WorldCover landcover
  └─ Open-Meteo forecast

Phase 2 (0.1s): Land analysis
  ├─ Elevation stats + slope
  ├─ Hillshade (sun exposure)
  ├─ Landcover summary
  ├─ LULC feasibility check
  └─ Zone assignment

Phase 3 (10s): All crops in parallel
  For EACH crop (concurrently):
    ├─ Sowing date from crop calendar
    ├─ WOFOST yield (ThreadPoolExecutor)
    ├─ AquaCrop irrigation (ThreadPoolExecutor)
    ├─ DSSAT nutrients (ThreadPoolExecutor)
    ├─ Hazard analysis (weekly)
    ├─ Pest risk assessment
    ├─ Feasibility check
    └─ Unified score

Phase 4 (0ms): Timeline + recommendations
```

## Deployment

- **Backend**: uvicorn on port 8001
- **Frontend**: Vite dev server on 5173, production build served by nginx on port 80
- **Nginx**: `try_files $uri /index.html` for SPA routing, `/api/` proxied to 8001
- **Production build**: `cd frontend && npm run build` → copy `dist/` to nginx root

## Competitive Position

No Indian platform combines crop simulation + ML + ozone + groundwater + 3D terrain:
- CropIn: satellite monitoring only, no simulation
- Fasal: requires IoT hardware, not scalable
- BharatAgri: advisory only, no physics models
- SatSure: bank analytics, not farmer-facing
- **OzoneSight is unique** — $923M wheat losses, zero competitors

## Production Roadmap

### Near-term
- Train ML on real data.gov.in district yields (Maharashtra subset)
- Integrate Sentinel-2 real NDVI via Copernicus Data Space
- OpenAQ real-time ozone data
- User login + farm profiles

### Medium-term
- Multi-language support (Hindi, Marathi, 22 Indian languages)
- Mobile app / PWA
- Farmer yield reporting (feeds ML training)
- Market price integration

### Long-term
- IoT sensor integration
- Pest/disease image classification
- Supply chain optimization
- B2B SaaS for insurance companies + state agriculture departments
