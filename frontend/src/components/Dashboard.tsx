import { useEffect, useState } from 'react';
import { getWeather, getSoil, runSimulation, type WeatherResponse, type SoilResponse, type SimulationResult } from '../services/api';

const DEFAULT_LAT = 18.52;
const DEFAULT_LON = 73.85;

export default function Dashboard() {
  const [weather, setWeather] = useState<WeatherResponse | null>(null);
  const [soil, setSoil] = useState<SoilResponse | null>(null);
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [simLoading, setSimLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.allSettled([
      getWeather(DEFAULT_LAT, DEFAULT_LON),
      getSoil(DEFAULT_LAT, DEFAULT_LON),
    ]).then(([wResult, sResult]) => {
      if (wResult.status === 'fulfilled') setWeather(wResult.value);
      if (sResult.status === 'fulfilled') setSoil(sResult.value);
      if (wResult.status === 'rejected' && sResult.status === 'rejected') {
        setError('Failed to load data');
      }
    }).finally(() => setLoading(false));
  }, []);

  const runQuickSim = async (crop: string) => {
    setSimLoading(true);
    try {
      const res = await runSimulation({ latitude: DEFAULT_LAT, longitude: DEFAULT_LON, crop });
      setSimulation(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Simulation failed');
    } finally {
      setSimLoading(false);
    }
  };

  if (loading) return <div className="loading">Loading Pune farm data...</div>;

  // Find last day with actual data (not all nulls)
  const latest = weather?.data.slice().reverse().find(
    (d) => d.temperature_max !== null
  ) ?? weather?.data[weather.data.length - 1];

  return (
    <section className="dashboard">
      <h2>Farm Data Dashboard</h2>
      <p>Location: Pune, Maharashtra ({DEFAULT_LAT}°N, {DEFAULT_LON}°E)</p>

      {error && <div style={{ color: '#c62828', margin: '0.5rem 0' }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem' }}>
        {/* Weather Card */}
        <div style={{ background: '#fff', padding: '1rem', borderRadius: '8px' }}>
          <h3 style={{ marginTop: 0 }}>Latest Weather</h3>
          {latest ? (
            <table>
              <tbody>
                <tr><td>Date</td><td>{latest.date}</td></tr>
                <tr><td>Temperature</td><td>{latest.temperature_max ?? '—'}°C / {latest.temperature_min ?? '—'}°C</td></tr>
                <tr><td>Precipitation</td><td>{latest.precipitation ?? '—'} mm</td></tr>
                <tr><td>Solar Radiation</td><td>{latest.solar_radiation ?? '—'} MJ/m²/day</td></tr>
                <tr><td>Humidity</td><td>{latest.relative_humidity ?? '—'}%</td></tr>
                <tr><td>Wind Speed</td><td>{latest.wind_speed ?? '—'} m/s</td></tr>
              </tbody>
            </table>
          ) : <p>Weather data unavailable</p>}
          {weather && <small style={{ color: '#999' }}>{weather.data.length} days from {weather.source}</small>}
        </div>

        {/* Soil Card */}
        <div style={{ background: '#fff', padding: '1rem', borderRadius: '8px' }}>
          <h3 style={{ marginTop: 0 }}>Soil Profile</h3>
          {soil ? (
            <table>
              <thead>
                <tr><th>Depth</th><th>Clay</th><th>Sand</th><th>pH</th><th>OC</th></tr>
              </thead>
              <tbody>
                {soil.layers.map((l) => (
                  <tr key={l.depth_label}>
                    <td>{l.depth_label}</td>
                    <td>{l.clay ?? '—'}</td>
                    <td>{l.sand ?? '—'}</td>
                    <td>{l.ph ?? '—'}</td>
                    <td>{l.organic_carbon ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p>Soil data unavailable (SoilGrids may be down)</p>}
          {soil && <small style={{ color: '#999' }}>Source: {soil.source}</small>}
        </div>
      </div>

      {/* Quick Simulation */}
      <div style={{ marginTop: '1rem', background: '#fff', padding: '1rem', borderRadius: '8px' }}>
        <h3 style={{ marginTop: 0 }}>Quick Crop Simulation</h3>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {['rice', 'wheat', 'maize', 'chickpea', 'cotton', 'sorghum'].map((crop) => (
            <button key={crop} onClick={() => runQuickSim(crop)}
              disabled={simLoading}
              style={{ padding: '6px 14px', borderRadius: '6px', cursor: 'pointer' }}>
              {crop.charAt(0).toUpperCase() + crop.slice(1)}
            </button>
          ))}
        </div>
        {simLoading && <p style={{ color: '#666', marginTop: '0.5rem' }}>Running WOFOST simulation...</p>}
        {simulation && !simLoading && (
          <div style={{ marginTop: '0.75rem' }}>
            <strong>{simulation.metadata.crop}</strong> ({simulation.metadata.variety}) —{' '}
            {simulation.metadata.days_simulated} days simulated
            <div style={{ display: 'flex', gap: '2rem', marginTop: '0.5rem' }}>
              <div>
                <span style={{ color: '#666', fontSize: '0.85rem' }}>Yield: </span>
                <strong>{((simulation.summary.TWSO as number) ?? 0).toFixed(0)} kg/ha</strong>
              </div>
              <div>
                <span style={{ color: '#666', fontSize: '0.85rem' }}>Biomass: </span>
                <strong>{((simulation.summary.TAGP as number) ?? 0).toFixed(0)} kg/ha</strong>
              </div>
              <div>
                <span style={{ color: '#666', fontSize: '0.85rem' }}>Max LAI: </span>
                <strong>{((simulation.summary.LAIMAX as number) ?? 0).toFixed(2)}</strong>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
