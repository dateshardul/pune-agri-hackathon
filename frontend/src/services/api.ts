const API_BASE = '/api';

// --- Types ---

export interface DailyWeather {
  date: string;
  temperature_max: number | null;
  temperature_min: number | null;
  precipitation: number | null;
  solar_radiation: number | null;
  relative_humidity: number | null;
  wind_speed: number | null;
}

export interface WeatherResponse {
  latitude: number;
  longitude: number;
  start_date: string;
  end_date: string;
  source: string;
  data: DailyWeather[];
}

export interface SoilLayer {
  depth_label: string;
  clay: number | null;
  sand: number | null;
  silt: number | null;
  organic_carbon: number | null;
  ph: number | null;
  bulk_density: number | null;
}

export interface SoilResponse {
  latitude: number;
  longitude: number;
  source: string;
  layers: SoilLayer[];
}

export interface SimulationResult {
  daily_output: Record<string, unknown>[];
  summary: Record<string, unknown>;
  metadata: {
    crop: string;
    variety: string;
    sowing_date: string;
    harvest_date: string;
    latitude: number;
    longitude: number;
    model: string;
    days_simulated: number;
    inputs?: {
      weather_days: number;
      weather_start: string;
      weather_end: string;
      avg_temp_c: number;
      total_precip_mm: number;
      avg_solar_rad_mj: number;
      soil_source: string;
      model_mode: string;
      elevation_m: number;
    };
  };
}

export interface ScenarioResult {
  scenario_name: string;
  modifications: { temp_offset_c: number; precip_multiplier: number };
  baseline: SimulationResult;
  scenario: SimulationResult;
  comparison: {
    baseline_yield_kg_ha: number;
    scenario_yield_kg_ha: number;
    yield_change_percent: number;
  };
}

export interface PresetScenario {
  name: string;
  description: string;
  temp_offset: number;
  precip_multiplier: number;
}

export interface OzoneResult {
  latitude: number;
  longitude: number;
  exposure: {
    region: string;
    season: string;
    mean_ozone_ppb: number;
    peak_ozone_ppb: number;
    aot40_ppb_h: number;
    growing_days: number;
  };
  yield_impact: {
    crop: string;
    aot40_ppb_h: number;
    threshold_ppb_h: number;
    yield_loss_percent: number;
    severity: string;
  };
  recommendations: string[];
  source: string;
}

// --- Fetcher ---

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

// --- Data endpoints ---

export function getWeather(lat: number, lon: number, start?: string, end?: string) {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon) });
  if (start) params.set('start', start);
  if (end) params.set('end', end);
  return fetchJSON<WeatherResponse>(`${API_BASE}/data/weather?${params}`);
}

export function getSoil(lat: number, lon: number) {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon) });
  return fetchJSON<SoilResponse>(`${API_BASE}/data/soil?${params}`);
}

// --- Simulation endpoints ---

export function getCrops() {
  return fetchJSON<{ crops: Record<string, string> }>(`${API_BASE}/simulate/crops`);
}

export function runSimulation(params: {
  latitude: number;
  longitude: number;
  crop: string;
  sowing_date?: string;
  harvest_date?: string;
}) {
  return postJSON<SimulationResult>(`${API_BASE}/simulate/`, params);
}

export function getPresetScenarios() {
  return fetchJSON<{ scenarios: PresetScenario[] }>(`${API_BASE}/simulate/scenarios`);
}

export function runScenario(params: {
  latitude: number;
  longitude: number;
  crop: string;
  sowing_date?: string;
  harvest_date?: string;
  temp_offset: number;
  precip_multiplier: number;
  scenario_name: string;
}) {
  return postJSON<ScenarioResult>(`${API_BASE}/simulate/scenario`, params);
}

// --- Ozone endpoints ---

export function getOzone(lat: number, lon: number, crop: string = 'wheat') {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon), crop });
  return fetchJSON<OzoneResult>(`${API_BASE}/ozone/?${params}`);
}

// --- Groundwater endpoints ---

export interface AquiferInfo {
  region_name: string;
  aquifer_type: string;
  category: string;
  stage_of_extraction_pct: number;
  current_depth_m: number;
  pre_monsoon_depth_m: number;
  post_monsoon_depth_m: number;
  annual_decline_m: number;
  aquifer_thickness_m: number;
  recharge_rate_mm_yr: number;
  extraction_rate_mm_yr: number;
  specific_yield: number;
  wells_monitored: number;
  grace_trend_cm_yr: number;
}

export interface DepthRecord {
  year: number;
  depth_m: number;
}

export interface Projection {
  year: number;
  projected_depth_m: number;
  pct_depleted: number;
}

export interface CropRecommendation {
  crop: string;
  label: string;
  water_need_mm: number;
  season: string;
  drought_tolerance: string;
  viable: boolean;
  sustainability: string;
  gw_needed_mm: number;
}

export interface GroundwaterResult {
  latitude: number;
  longitude: number;
  aquifer: AquiferInfo;
  historical_depths: DepthRecord[];
  projections: Projection[];
  years_to_critical: number | null;
  crop_recommendations: CropRecommendation[];
  advisory: string[];
  source: string;
}

export function getGroundwater(lat: number, lon: number) {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon) });
  return fetchJSON<GroundwaterResult>(`${API_BASE}/groundwater/?${params}`);
}

// --- Multi-modal ML prediction ---

export interface MLPrediction {
  yield_kg_ha: number;
  confidence_lower: number;
  confidence_upper: number;
  std_kg_ha: number;
  model: string;
  features_used: number;
  training_samples: number;
  feature_importance: FeatureImportance[];
}

export interface FeatureImportance {
  feature: string;
  label: string;
  importance: number;
  value_used: number;
  source: string;
}

export interface PredictionComparison {
  wofost: SimulationResult | null;
  ml_prediction: MLPrediction;
  comparison: {
    wofost_yield_kg_ha: number;
    ml_yield_kg_ha: number;
    agreement_pct: number;
  };
  ozone_impact: {
    yield_loss_percent: number;
    severity: string;
  };
  model_insights?: {
    aquacrop?: {
      drought_risk: string;
      water_need_mm: number;
      irrigation_need_mm: number;
      water_productivity: number;
    };
    dssat?: {
      nitrogen_kg_ha: number;
      phosphorus_kg_ha: number;
      potassium_kg_ha: number;
      soil_health_note: string;
    };
  };
  data_sources: Record<string, string>;
  extensibility_note: string;
}

export function runPrediction(params: {
  latitude: number;
  longitude: number;
  crop: string;
}) {
  return postJSON<PredictionComparison>(`${API_BASE}/predict/`, params);
}

// --- Elevation ---

export interface ElevationData {
  height_data: number[];
  width: number;
  height: number;
  min_elevation: number;
  max_elevation: number;
  source: string;
}

export function getElevation(lat: number, lon: number, size?: number) {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon) });
  if (size) params.set('size', String(size));
  return fetchJSON<ElevationData>(`${API_BASE}/elevation/dem?${params}`);
}

// --- Forecast ---

export interface ForecastDay {
  date: string;
  temp_max: number;
  temp_min: number;
  precipitation_mm: number;
  weather_code: number;
  condition: string;
  farming_tip: string;
}

export interface ForecastResponse {
  latitude: number;
  longitude: number;
  days: ForecastDay[];
  source: string;
}

export function getForecast(lat: number, lon: number) {
  return fetchJSON<ForecastResponse>(`${API_BASE}/data/forecast?lat=${lat}&lon=${lon}`);
}

// --- Smart Advisory (multi-model) ---

export interface IrrigationWeek {
  week: number;
  date_range: string;
  amount_mm: number;
  crop_stage: string;
  priority: 'critical' | 'recommended' | 'optional';
}

export interface FertilizerApplication {
  timing: string;
  day_after_sowing: number;
  n_kg: number;
  p_kg: number;
  k_kg: number;
  product_suggestion: string;
}

export interface SmartAdvisoryResponse {
  crop: string;
  location: { latitude: number; longitude: number };
  yield_forecast: {
    model: string;
    yield_kg_ha: number;
    growth_days: number;
    confidence: string;
  };
  water_advisory: {
    model: string;
    total_water_need_mm: number;
    irrigation_need_mm: number;
    rain_contribution_mm: number;
    drought_risk: string;
    water_productivity_kg_m3: number;
    schedule: IrrigationWeek[];
  };
  nutrient_advisory: {
    model: string;
    nitrogen_kg_ha: number;
    phosphorus_kg_ha: number;
    potassium_kg_ha: number;
    applications: FertilizerApplication[];
    soil_health_note: string;
  };
  recommendations: string[];
  data_sources: Record<string, string>;
}

export function getSmartAdvisory(params: {
  latitude: number;
  longitude: number;
  crop: string;
}) {
  return postJSON<SmartAdvisoryResponse>(`${API_BASE}/simulate/smart-advisory`, params);
}

// --- Sowing Optimizer ---

export interface SowingOptimizerResponse {
  crop: string;
  location: { latitude: number; longitude: number };
  analysis: {
    best_season: {
      season: string;
      reason: string;
      all_seasons: Array<{ season: string; suitability: string }>;
    };
    best_month: {
      month: string;
      reason: string;
      all_months: Array<{ month: string; score: number; risk: string; note: string }>;
    };
    best_week: {
      period: string;
      reason: string;
      all_weeks: Array<{ period: string; score: number; yield_kg_ha: number; risk: string; recommended: boolean }>;
    };
    optimal_period: {
      start: string;
      end: string;
      expected_yield_kg_ha: number;
      vs_standard_pct: string;
      risk_level: string;
    };
  };
  factors_considered: string[];
  weather_source: string;
}

export function optimizeSowing(params: {
  latitude: number;
  longitude: number;
  crop: string;
}) {
  return postJSON<SowingOptimizerResponse>(`${API_BASE}/simulate/sowing-optimizer`, params);
}

// --- Farm Analysis (unified) ---

export interface LandAnalysis {
  elevation: { min: number; max: number; mean: number; slope_pct: number };
  hillshade: { sun_exposure_pct: number; shaded_pct: number };
  landcover: {
    cropland_pct: number; trees_pct: number; built_pct: number;
    water_pct: number; bare_pct: number; grass_pct: number;
    usable_area_ha: number;
  };
}

export interface CropZone {
  type: string;  // "valley" | "slope" | "hilltop"
  elevation_range: [number, number];
  area_ha: number;
  area_fraction: number;
  color: string;
  reason: string;
}

export interface HazardWeek {
  week: number;
  risk: 'low' | 'moderate' | 'high';
  note: string;
}

export interface CropFeasibility {
  viable: boolean;
  severity: 'ok' | 'warning' | 'critical' | 'impossible';
  reasons: string[];
  alternatives: Array<{ crop: string; reason: string }>;
}

export interface PestEntry {
  name: string;
  risk: string;
  peak_period: string;
  reason: string;
  mitigation: string;
}

export interface PestRisk {
  overall_risk: string;
  pests: PestEntry[];
  stress_vulnerability: {
    water_stress: number;
    nutrient_stress: number;
    note: string;
  };
}

export interface CropPlan {
  crop: string;
  zone: CropZone;
  feasibility: CropFeasibility;
  sowing: {
    optimal_period: { start: string; end: string; expected_yield_kg_ha: number; vs_standard_pct: string; risk_level: string };
    season: string;
    best_month: string;
  };
  models: {
    wofost: Record<string, unknown> | null;
    aquacrop: Record<string, unknown> | null;
    dssat: Record<string, unknown> | null;
  };
  hazards: {
    overall_risk: string;
    weekly_calendar: HazardWeek[];
    mitigations: string[];
  };
  pest_risk?: PestRisk;
}

export interface TimelineEvent {
  month: string;
  crops: string[];
  action: string;
}

export interface FarmAnalysisRequest {
  latitude: number;
  longitude: number;
  crops: string[];
  field_area_ha?: number;
  elevation?: number;
  preferred_sowing?: string;
  water_budget_mm?: number;
}

export interface FarmAnalysisResponse {
  farm: {
    latitude: number;
    longitude: number;
    field_area_ha: number;
    elevation_range: { min: number; max: number };
  };
  land_analysis: LandAnalysis;
  environment: {
    weather_summary: Record<string, unknown>;
    forecast: Array<Record<string, unknown>>;
    soil: Record<string, unknown>;
    groundwater: Record<string, unknown>;
    ozone: Record<string, unknown>;
  };
  crop_plans: CropPlan[];
  planting_timeline: TimelineEvent[];
  // Legacy single-crop fields (used as fallback)
  sowing?: {
    optimal_period: { start: string; end: string; expected_yield_kg_ha: number; vs_standard_pct: string; risk_level: string };
    season: string;
    best_month: string;
    best_week: string;
  };
  models?: {
    wofost: Record<string, unknown> | null;
    aquacrop: Record<string, unknown> | null;
    dssat: Record<string, unknown> | null;
  };
  unified_score: {
    overall: number;
    yield_score: number;
    water_score: number;
    nutrient_score: number;
    risk_score: number;
  };
  recommendations: string[];
  data_sources: Record<string, string>;
}

export function analyzeFarm(params: FarmAnalysisRequest) {
  // Backend may still expect `crop` (string) — send both for compatibility
  const body: Record<string, unknown> = { ...params };
  if (params.crops.length === 1) {
    body.crop = params.crops[0];
  }
  return postJSON<FarmAnalysisResponse>(`${API_BASE}/farm/analyze`, body);
}
