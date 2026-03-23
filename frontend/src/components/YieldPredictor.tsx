import { useState, useEffect } from 'react';
import { getCrops, runPrediction, type PredictionComparison, type FeatureImportance, type SimulationResult } from '../services/api';

interface Props {
  lat: number;
  lon: number;
  onSimulationResult?: (result: SimulationResult) => void;
}

const cardStyle = { background: '#fff', padding: '1rem', borderRadius: '8px', textAlign: 'center' as const };

const sourceColors: Record<string, string> = {
  weather: '#1565c0',
  soil: '#8b6914',
  stress: '#c62828',
  crop: '#2e7d32',
  location: '#666',
};

const sourceLabels: Record<string, string> = {
  weather: 'Weather',
  soil: 'Soil',
  stress: 'Stress',
  crop: 'Crop',
  location: 'Location',
};

function FeatureBar({ item, maxImportance }: { item: FeatureImportance; maxImportance: number }) {
  const widthPct = (item.importance / maxImportance) * 100;
  const color = sourceColors[item.source] ?? '#666';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', fontSize: '0.8rem' }}>
      <div style={{ width: '140px', textAlign: 'right', color: '#555', flexShrink: 0 }}>
        {item.label}
      </div>
      <div style={{ flex: 1, position: 'relative', height: '18px', background: '#f0f0f0', borderRadius: '3px' }}>
        <div style={{
          width: `${widthPct}%`, height: '100%', borderRadius: '3px',
          background: color, transition: 'width 0.3s',
        }} />
      </div>
      <div style={{ width: '50px', fontSize: '0.75rem', color: '#999', flexShrink: 0 }}>
        {(item.importance * 100).toFixed(1)}%
      </div>
      <div style={{
        width: '16px', height: '16px', borderRadius: '3px',
        background: color, flexShrink: 0,
      }} title={sourceLabels[item.source] ?? item.source} />
    </div>
  );
}

export default function YieldPredictor({ lat, lon, onSimulationResult }: Props) {
  const [crops, setCrops] = useState<Record<string, string>>({});
  const [selectedCrop, setSelectedCrop] = useState('wheat');
  const [result, setResult] = useState<PredictionComparison | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCrops().then((c) => setCrops(c.crops)).catch(() => {});
  }, []);

  const runAnalysis = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await runPrediction({
        latitude: lat,
        longitude: lon,
        crop: selectedCrop,
      });
      setResult(res);
      // Pass WOFOST simulation result to 3D terrain if available
      if (res.wofost && onSimulationResult) {
        onSimulationResult(res.wofost);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Prediction failed');
    } finally {
      setLoading(false);
    }
  };

  const comp = result?.comparison;
  const ml = result?.ml_prediction;
  const agreementColor = comp
    ? comp.agreement_pct > 85 ? '#2e7d32'
      : comp.agreement_pct > 70 ? '#f57f17'
      : '#c62828'
    : '#666';

  const topFeatures = ml?.feature_importance.slice(0, 8) ?? [];
  const maxImp = topFeatures.length > 0 ? topFeatures[0].importance : 1;

  return (
    <section>
      <h2>Multi-Modal Yield Prediction</h2>
      <p>
        CropNet-inspired: compares physics simulation (WOFOST) with ML prediction
        using weather + soil + ozone + groundwater data ({lat.toFixed(2)}&deg;N, {lon.toFixed(2)}&deg;E)
      </p>

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

        <button onClick={runAnalysis} disabled={loading}
          style={{ padding: '6px 16px', cursor: loading ? 'wait' : 'pointer' }}>
          {loading ? 'Predicting...' : 'Run Prediction'}
        </button>
      </div>

      {error && <div style={{ color: '#c62828', margin: '1rem 0' }}>Error: {error}</div>}

      {result && comp && ml && (
        <div>
          {/* Comparison cards */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', margin: '1rem 0' }}>
            <div style={cardStyle}>
              <div style={{ fontSize: '0.85rem', color: '#666' }}>WOFOST (Physics Model)</div>
              <div style={{ fontSize: '1.8rem', fontWeight: 'bold' }}>
                {comp.wofost_yield_kg_ha > 0 ? comp.wofost_yield_kg_ha.toFixed(0) : '—'}
              </div>
              <div style={{ fontSize: '0.8rem', color: '#999' }}>kg/ha</div>
              <div style={{ fontSize: '0.7rem', color: '#aaa', marginTop: '4px' }}>
                Mechanistic crop growth model
              </div>
            </div>
            <div style={cardStyle}>
              <div style={{ fontSize: '0.85rem', color: '#666' }}>ML Ensemble (Multi-Modal)</div>
              <div style={{ fontSize: '1.8rem', fontWeight: 'bold' }}>
                {ml.yield_kg_ha.toFixed(0)}
              </div>
              <div style={{ fontSize: '0.8rem', color: '#999' }}>
                kg/ha (±{ml.std_kg_ha.toFixed(0)})
              </div>
              <div style={{ fontSize: '0.7rem', color: '#aaa', marginTop: '4px' }}>
                {ml.features_used} features from {Object.keys(result.data_sources).length} data sources
              </div>
            </div>
            <div style={cardStyle}>
              <div style={{ fontSize: '0.85rem', color: '#666' }}>Model Agreement</div>
              <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: agreementColor }}>
                {comp.agreement_pct.toFixed(0)}%
              </div>
              <div style={{ fontSize: '0.8rem', color: '#999' }}>
                {comp.agreement_pct > 85 ? 'High confidence'
                  : comp.agreement_pct > 70 ? 'Moderate confidence'
                  : 'Models diverge — investigate factors'}
              </div>
            </div>
          </div>

          {/* Confidence interval bar */}
          <div style={{ background: '#fff', padding: '1rem', borderRadius: '8px', marginBottom: '1rem' }}>
            <div style={{ fontSize: '0.85rem', color: '#666', marginBottom: '8px' }}>
              ML Prediction Range (95% confidence)
            </div>
            <div style={{ position: 'relative', height: '24px', background: '#f0f0f0', borderRadius: '4px' }}>
              {(() => {
                const lo = ml.confidence_lower;
                const hi = ml.confidence_upper;
                const maxBar = hi * 1.15;
                const loFrac = (lo / maxBar) * 100;
                const hiFrac = (hi / maxBar) * 100;
                const midFrac = (ml.yield_kg_ha / maxBar) * 100;
                return (
                  <>
                    <div style={{
                      position: 'absolute', left: `${loFrac}%`, width: `${hiFrac - loFrac}%`,
                      height: '100%', background: '#bbdefb', borderRadius: '4px',
                    }} />
                    <div style={{
                      position: 'absolute', left: `${midFrac}%`, top: 0, bottom: 0,
                      width: '3px', background: '#1565c0', borderRadius: '2px',
                    }} />
                    {comp.wofost_yield_kg_ha > 0 && (
                      <div style={{
                        position: 'absolute', left: `${(comp.wofost_yield_kg_ha / maxBar) * 100}%`,
                        top: 0, bottom: 0, width: '3px', background: '#c62828', borderRadius: '2px',
                      }} title={`WOFOST: ${comp.wofost_yield_kg_ha.toFixed(0)} kg/ha`} />
                    )}
                  </>
                );
              })()}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#999', marginTop: '4px' }}>
              <span>{ml.confidence_lower.toFixed(0)} kg/ha</span>
              <span style={{ color: '#1565c0' }}>ML: {ml.yield_kg_ha.toFixed(0)}</span>
              {comp.wofost_yield_kg_ha > 0 && (
                <span style={{ color: '#c62828' }}>WOFOST: {comp.wofost_yield_kg_ha.toFixed(0)}</span>
              )}
              <span>{ml.confidence_upper.toFixed(0)} kg/ha</span>
            </div>
          </div>

          {/* Feature importance */}
          {topFeatures.length > 0 && (
            <div style={{ background: '#fff', padding: '1rem', borderRadius: '8px', marginBottom: '1rem' }}>
              <div style={{ fontSize: '0.85rem', color: '#666', marginBottom: '8px' }}>
                What Matters Most for This Prediction
              </div>
              {topFeatures.map((f) => (
                <FeatureBar key={f.feature} item={f} maxImportance={maxImp} />
              ))}
              <div style={{ display: 'flex', gap: '12px', marginTop: '8px', fontSize: '0.7rem' }}>
                {Object.entries(sourceColors).map(([src, color]) => (
                  <span key={src} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ width: 10, height: 10, borderRadius: 2, background: color, display: 'inline-block' }} />
                    {sourceLabels[src]}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Data sources */}
          <div style={{ background: '#fff', padding: '0.75rem 1rem', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.8rem' }}>
            <strong>Data sources used: </strong>
            {Object.entries(result.data_sources).map(([key, val], i) => (
              <span key={key}>
                {i > 0 && ' · '}
                <span style={{ color: val.includes('unavailable') ? '#c62828' : '#2e7d32' }}>
                  {key}: {val}
                </span>
              </span>
            ))}
          </div>

          {/* Transparency */}
          <details style={{ fontSize: '0.85rem', color: '#555' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>How does this work?</summary>
            <div style={{ marginTop: '0.5rem', lineHeight: 1.7 }}>
              <p>
                <strong>Two complementary approaches:</strong> WOFOST is a physics-based crop growth model
                that simulates daily photosynthesis, water uptake, and phenology. The ML model (Gradient Boosting
                with {ml.features_used} features) learns patterns across weather, soil, ozone stress,
                and groundwater status — capturing cross-domain interactions that no single physics model handles.
              </p>
              <p>
                <strong>Training data:</strong> Currently trained on {ml.training_samples.toLocaleString()} synthetic
                samples generated from agronomic response functions calibrated to Indian crop statistics (ICAR).
                This architecture is designed to accept real observed yield data (ICAR district statistics,
                farmer-reported yields, or satellite-derived estimates) with zero pipeline changes —
                only the training labels need to be replaced.
              </p>
              <p>
                <strong>When models agree</strong> (agreement &gt; 85%), both the physics and data-driven
                approaches point to the same outcome — high confidence. <strong>When they diverge</strong>,
                the feature importance chart reveals which factors are driving the ML prediction differently
                (often ozone stress or groundwater constraints that WOFOST does not model).
              </p>
              <p style={{ color: '#999', fontStyle: 'italic' }}>
                Inspired by CropNet (KDD 2024) multi-modal fusion architecture,
                adapted for Indian agriculture and available data sources.
              </p>
            </div>
          </details>
        </div>
      )}
    </section>
  );
}
