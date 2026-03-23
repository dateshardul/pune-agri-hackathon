import { useEffect, useState } from 'react';
import {
  getCrops, getPresetScenarios, runScenario,
  type PresetScenario, type ScenarioResult, type SimulationResult,
} from '../services/api';

interface Props {
  lat: number;
  lon: number;
  onSimulationResult?: (result: SimulationResult) => void;
}

const cardStyle = { background: '#fff', padding: '1rem', borderRadius: '8px', textAlign: 'center' as const };

export default function ScenarioExplorer({ lat, lon, onSimulationResult }: Props) {
  const [crops, setCrops] = useState<Record<string, string>>({});
  const [presets, setPresets] = useState<PresetScenario[]>([]);
  const [selectedCrop, setSelectedCrop] = useState('rice');
  const [selectedPreset, setSelectedPreset] = useState<PresetScenario | null>(null);
  const [result, setResult] = useState<ScenarioResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [terrainView, setTerrainView] = useState<'scenario' | 'baseline'>('scenario');

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
        latitude: lat,
        longitude: lon,
        crop: selectedCrop,
        temp_offset: selectedPreset.temp_offset,
        precip_multiplier: selectedPreset.precip_multiplier,
        scenario_name: selectedPreset.name,
      });
      setResult(res);
      // Pass scenario result to 3D terrain
      if (onSimulationResult) {
        onSimulationResult(terrainView === 'baseline' ? res.baseline : res.scenario);
      }
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
      <h2>What-If Climate Explorer</h2>
      <p>See how your crop yield changes under different climate futures ({lat.toFixed(2)}&deg;N, {lon.toFixed(2)}&deg;E)</p>

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
          Climate Scenario:
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
            Temperature: {selectedPreset.temp_offset > 0 ? '+' : ''}{selectedPreset.temp_offset}°C |
            Rainfall: {Math.round(selectedPreset.precip_multiplier * 100)}% of normal
          </small>
        </div>
      )}

      {error && <div style={{ color: '#c62828', margin: '1rem 0' }}>Error: {error}</div>}

      {result && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', margin: '1rem 0' }}>
            <div style={cardStyle}>
              <div style={{ fontSize: '0.85rem', color: '#666' }}>Normal Yield</div>
              <div style={{ fontSize: '1.8rem', fontWeight: 'bold' }}>
                {result.comparison.baseline_yield_kg_ha.toFixed(0)}
              </div>
              <div style={{ fontSize: '0.8rem', color: '#999' }}>kg/ha</div>
            </div>
            <div style={cardStyle}>
              <div style={{ fontSize: '0.85rem', color: '#666' }}>Yield Under This Scenario</div>
              <div style={{ fontSize: '1.8rem', fontWeight: 'bold' }}>
                {result.comparison.scenario_yield_kg_ha.toFixed(0)}
              </div>
              <div style={{ fontSize: '0.8rem', color: '#999' }}>kg/ha</div>
            </div>
            <div style={cardStyle}>
              <div style={{ fontSize: '0.85rem', color: '#666' }}>Change in Yield</div>
              <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: changeColor }}>
                {yieldChange > 0 ? '+' : ''}{yieldChange.toFixed(1)}%
              </div>
              <div style={{ fontSize: '0.8rem', color: '#999' }}>{result.scenario_name}</div>
            </div>
          </div>

          {/* Terrain view toggle */}
          {onSimulationResult && (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', margin: '0.5rem 0 1rem' }}>
              <span style={{ fontSize: '0.85rem', color: '#555' }}>Show on terrain:</span>
              {(['baseline', 'scenario'] as const).map((view) => (
                <button
                  key={view}
                  onClick={() => {
                    setTerrainView(view);
                    onSimulationResult(view === 'baseline' ? result.baseline : result.scenario);
                  }}
                  style={{
                    padding: '4px 12px', borderRadius: '4px', border: 'none',
                    cursor: 'pointer', fontSize: '0.8rem',
                    background: terrainView === view ? '#1976d2' : '#e0e0e0',
                    color: terrainView === view ? '#fff' : '#333',
                  }}
                >
                  {view === 'baseline' ? 'Baseline' : 'Scenario'}
                </button>
              ))}
            </div>
          )}

          <details>
            <summary style={{ cursor: 'pointer', marginTop: '1rem' }}>
              Detailed Comparison ({result.baseline.metadata.days_simulated} days simulated)
            </summary>
            <table style={{ marginTop: '0.5rem' }}>
              <thead>
                <tr><th>Metric</th><th>Normal</th><th>This Scenario</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td title="Peak leaf area — higher means more photosynthesis">Leaf Coverage</td>
                  <td>{(result.baseline.summary.LAIMAX as number)?.toFixed(2)}</td>
                  <td>{(result.scenario.summary.LAIMAX as number)?.toFixed(2)}</td>
                </tr>
                <tr>
                  <td>Total Plant Growth (kg/ha)</td>
                  <td>{(result.baseline.summary.TAGP as number)?.toFixed(0)}</td>
                  <td>{(result.scenario.summary.TAGP as number)?.toFixed(0)}</td>
                </tr>
                <tr>
                  <td title="0 = just sowed, 1 = flowering, 2 = mature">Growth Stage</td>
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
