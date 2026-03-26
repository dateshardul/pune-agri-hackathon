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
