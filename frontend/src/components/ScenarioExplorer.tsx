import { useEffect, useState } from 'react';
import {
  getCrops, getPresetScenarios, runScenario,
  type PresetScenario, type ScenarioResult,
} from '../services/api';

const DEFAULT_LAT = 18.52;
const DEFAULT_LON = 73.85;

export default function ScenarioExplorer() {
  const [crops, setCrops] = useState<Record<string, string>>({});
  const [presets, setPresets] = useState<PresetScenario[]>([]);
  const [selectedCrop, setSelectedCrop] = useState('rice');
  const [selectedPreset, setSelectedPreset] = useState<PresetScenario | null>(null);
  const [result, setResult] = useState<ScenarioResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getCrops(), getPresetScenarios()])
      .then(([c, s]) => {
        setCrops(c.crops);
        setPresets(s.scenarios);
        setSelectedPreset(s.scenarios[0]);
      })
      .catch((e) => setError(e.message));
  }, []);

  const runAnalysis = async () => {
    if (!selectedPreset) return;
    setLoading(true);
    setError(null);
    try {
      const res = await runScenario({
        latitude: DEFAULT_LAT,
        longitude: DEFAULT_LON,
        crop: selectedCrop,
        temp_offset: selectedPreset.temp_offset,
        precip_multiplier: selectedPreset.precip_multiplier,
        scenario_name: selectedPreset.name,
      });
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Scenario failed');
    } finally {
      setLoading(false);
    }
  };

  const yieldChange = result?.comparison.yield_change_percent ?? 0;
  const changeColor = yieldChange > 0 ? '#2e7d32' : yieldChange < -5 ? '#c62828' : '#f57f17';

  return (
    <section>
      <h2>What-If Scenario Explorer</h2>
      <p>Compare crop yield under different climate scenarios for Pune</p>

      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', margin: '1rem 0' }}>
        <label>
          Crop:
          <select value={selectedCrop} onChange={(e) => setSelectedCrop(e.target.value)}
            style={{ marginLeft: '0.5rem', padding: '4px 8px' }}>
            {Object.keys(crops).map((c) => (
              <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
            ))}
          </select>
        </label>

        <label>
          Scenario:
          <select
            value={selectedPreset?.name ?? ''}
            onChange={(e) => setSelectedPreset(presets.find((p) => p.name === e.target.value) ?? null)}
            style={{ marginLeft: '0.5rem', padding: '4px 8px' }}>
            {presets.map((p) => (
              <option key={p.name} value={p.name}>{p.name}</option>
            ))}
          </select>
        </label>

        <button onClick={runAnalysis} disabled={loading}
          style={{ padding: '6px 16px', cursor: loading ? 'wait' : 'pointer' }}>
          {loading ? 'Simulating...' : 'Run Scenario'}
        </button>
      </div>

      {selectedPreset && (
        <div style={{ background: '#e3f2fd', padding: '0.75rem', borderRadius: '6px', marginBottom: '1rem' }}>
          <strong>{selectedPreset.name}</strong>: {selectedPreset.description}
          <br />
          <small>
            Temp: {selectedPreset.temp_offset > 0 ? '+' : ''}{selectedPreset.temp_offset}°C |
            Rain: {Math.round(selectedPreset.precip_multiplier * 100)}% of normal
          </small>
        </div>
      )}

      {error && <div style={{ color: '#c62828', margin: '1rem 0' }}>Error: {error}</div>}

      {result && (
        <div>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem',
            margin: '1rem 0',
          }}>
            <div style={{ background: '#fff', padding: '1rem', borderRadius: '8px', textAlign: 'center' }}>
              <div style={{ fontSize: '0.85rem', color: '#666' }}>Baseline Yield</div>
              <div style={{ fontSize: '1.8rem', fontWeight: 'bold' }}>
                {result.comparison.baseline_yield_kg_ha.toFixed(0)}
              </div>
              <div style={{ fontSize: '0.8rem', color: '#999' }}>kg/ha</div>
            </div>
            <div style={{ background: '#fff', padding: '1rem', borderRadius: '8px', textAlign: 'center' }}>
              <div style={{ fontSize: '0.85rem', color: '#666' }}>Scenario Yield</div>
              <div style={{ fontSize: '1.8rem', fontWeight: 'bold' }}>
                {result.comparison.scenario_yield_kg_ha.toFixed(0)}
              </div>
              <div style={{ fontSize: '0.8rem', color: '#999' }}>kg/ha</div>
            </div>
            <div style={{ background: '#fff', padding: '1rem', borderRadius: '8px', textAlign: 'center' }}>
              <div style={{ fontSize: '0.85rem', color: '#666' }}>Yield Change</div>
              <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: changeColor }}>
                {yieldChange > 0 ? '+' : ''}{yieldChange.toFixed(1)}%
              </div>
              <div style={{ fontSize: '0.8rem', color: '#999' }}>{result.scenario_name}</div>
            </div>
          </div>

          <details>
            <summary style={{ cursor: 'pointer', marginTop: '1rem' }}>
              Simulation Details ({result.baseline.metadata.days_simulated} days)
            </summary>
            <table style={{ marginTop: '0.5rem' }}>
              <thead>
                <tr><th>Metric</th><th>Baseline</th><th>Scenario</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td>Max LAI</td>
                  <td>{(result.baseline.summary.LAIMAX as number)?.toFixed(2)}</td>
                  <td>{(result.scenario.summary.LAIMAX as number)?.toFixed(2)}</td>
                </tr>
                <tr>
                  <td>Total Biomass (kg/ha)</td>
                  <td>{(result.baseline.summary.TAGP as number)?.toFixed(0)}</td>
                  <td>{(result.scenario.summary.TAGP as number)?.toFixed(0)}</td>
                </tr>
                <tr>
                  <td>Development Stage</td>
                  <td>{(result.baseline.summary.DVS as number)?.toFixed(1)}</td>
                  <td>{(result.scenario.summary.DVS as number)?.toFixed(1)}</td>
                </tr>
              </tbody>
            </table>
          </details>
        </div>
      )}
    </section>
  );
}
