import { useEffect, useState, useRef } from 'react';
import { getWeather, getSoil, runSimulation, type WeatherResponse, type SoilResponse, type SimulationResult } from '../services/api';

interface Props {
  lat: number;
  lon: number;
}

const cardStyle = { background: '#fff', padding: '1rem', borderRadius: '8px' } as const;

export default function Dashboard({ lat, lon }: Props) {
  const [weather, setWeather] = useState<WeatherResponse | null>(null);
  const [soil, setSoil] = useState<SoilResponse | null>(null);
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [simLoading, setSimLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    const w: string[] = [];
    Promise.allSettled([
      getWeather(lat, lon),
      getSoil(lat, lon),
    ]).then(([wResult, sResult]) => {
      if (controller.signal.aborted) return;
      if (wResult.status === 'fulfilled') {
        setWeather(wResult.value);
      } else {
        w.push('Weather data unavailable — NASA POWER may be slow');
      }
      if (sResult.status === 'fulfilled') {
        setSoil(sResult.value);
      } else {
        w.push('Soil data unavailable — SoilGrids may be down');
      }
      if (wResult.status === 'rejected' && sResult.status === 'rejected') {
        setError('Both data sources failed. Check backend connectivity.');
      }
      setWarnings(w);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });

    return () => controller.abort();
  }, [lat, lon]);

  const runQuickSim = async (crop: string) => {
    setSimLoading(true);
    setError(null);
    try {
      const res = await runSimulation({ latitude: lat, longitude: lon, crop });
      setSimulation(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Simulation failed');
    } finally {
      setSimLoading(false);
    }
  };

  if (loading) return <div className="loading">Loading farm data for ({lat}, {lon})...</div>;

  const latest = weather?.data.slice().reverse().find(
    (d) => d.temperature_max !== null
  ) ?? weather?.data[weather.data.length - 1];

  const meta = simulation?.metadata;

  return (
    <section className="dashboard">
      <h2>Farm Data Dashboard</h2>
      <p>Location: {lat.toFixed(2)}&deg;N, {lon.toFixed(2)}&deg;E</p>

      {error && <div className="error" style={{ margin: '0.5rem 0', padding: '0.5rem', borderRadius: '6px', background: '#ffebee' }}>{error}</div>}
      {warnings.map((w, i) => (
        <div key={i} style={{ color: '#e65100', margin: '0.25rem 0', fontSize: '0.9rem' }}>{w}</div>
      ))}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem' }}>
        {/* Weather Card */}
        <div style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>Latest Weather</h3>
          {latest ? (
            <table>
              <tbody>
                <tr><td>Date</td><td>{latest.date}</td></tr>
                <tr><td>Temperature</td><td>{latest.temperature_max ?? '—'}°C / {latest.temperature_min ?? '—'}°C</td></tr>
                <tr><td>Rainfall</td><td>{latest.precipitation ?? '—'} mm</td></tr>
                <tr><td>Sunlight</td><td>{latest.solar_radiation ?? '—'} MJ/m²/day</td></tr>
                <tr><td>Humidity</td><td>{latest.relative_humidity ?? '—'}%</td></tr>
                <tr><td>Wind Speed</td><td>{latest.wind_speed ?? '—'} m/s</td></tr>
              </tbody>
            </table>
          ) : <p style={{ color: '#999' }}>Weather data unavailable</p>}
          {weather && <small style={{ color: '#999' }}>{weather.data.length} days from {weather.source}</small>}
        </div>

        {/* Soil Card */}
        <div style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>Soil Profile</h3>
          {soil ? (
            <>
              <table>
                <thead>
                  <tr><th>Depth</th><th>Clay</th><th>Sand</th><th>pH</th><th>Organic Carbon</th></tr>
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
              <small style={{ color: '#999' }}>Source: {soil.source}</small>
            </>
          ) : <p style={{ color: '#999' }}>Soil data unavailable</p>}
        </div>
      </div>

      {/* Quick Simulation */}
      <div style={{ marginTop: '1rem', ...cardStyle }}>
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
        {simLoading && <p style={{ color: '#666', marginTop: '0.5rem' }}>Running crop simulation...</p>}
        {simulation && !simLoading && (
          <div style={{ marginTop: '0.75rem' }}>
            <strong>{simulation.metadata.crop}</strong> ({simulation.metadata.variety}) —{' '}
            {simulation.metadata.days_simulated} days simulated
            <div style={{ display: 'flex', gap: '2rem', marginTop: '0.5rem' }}>
              <div>
                <span style={{ color: '#666', fontSize: '0.85rem' }}>Grain Harvest: </span>
                <strong>{((simulation.summary.TWSO as number) ?? 0).toFixed(0)} kg/ha</strong>
              </div>
              <div>
                <span style={{ color: '#666', fontSize: '0.85rem' }}>Total Plant Growth: </span>
                <strong>{((simulation.summary.TAGP as number) ?? 0).toFixed(0)} kg/ha</strong>
              </div>
              <div>
                <span style={{ color: '#666', fontSize: '0.85rem' }} title="Peak leaf area — higher means more photosynthesis">Leaf Coverage: </span>
                <strong>{((simulation.summary.LAIMAX as number) ?? 0).toFixed(2)}</strong>
              </div>
            </div>

            {/* Simulation transparency — B2 */}
            {meta && (
              <details style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: '#555' }}>
                <summary style={{ cursor: 'pointer', fontWeight: 600 }}>What went into this simulation?</summary>
                <div style={{ marginTop: '0.5rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  <div>
                    <strong>Weather:</strong>{' '}
                    {meta.inputs ? (
                      <>
                        {meta.inputs.weather_days} days
                        ({meta.inputs.weather_start} to {meta.inputs.weather_end}),
                        avg {meta.inputs.avg_temp_c}°C,
                        {' '}{meta.inputs.total_precip_mm} mm total rain,
                        {' '}{meta.inputs.avg_solar_rad_mj} MJ/m²/day sunlight
                      </>
                    ) : 'NASA POWER daily data'}
                  </div>
                  <div>
                    <strong>Soil:</strong>{' '}
                    {meta.inputs?.soil_source ?? 'Standard soil profile'}
                  </div>
                  <div>
                    <strong>Model:</strong> {meta.model}
                    {meta.inputs && <>, elevation {meta.inputs.elevation_m} m</>}
                  </div>
                  <div>
                    <strong>Dates:</strong> Sowing {meta.sowing_date} → Harvest {meta.harvest_date}, variety {meta.variety}
                  </div>
                </div>
              </details>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
