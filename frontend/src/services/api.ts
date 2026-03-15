const API_BASE = '/api';

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

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

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
