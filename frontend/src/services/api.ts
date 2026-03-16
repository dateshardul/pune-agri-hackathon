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
