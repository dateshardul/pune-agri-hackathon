import { useEffect, useState } from 'react';
import { getOzone, getCrops, type OzoneResult } from '../services/api';

interface Props {
  lat: number;
  lon: number;
}

const severityColors: Record<string, string> = {
  low: '#2e7d32',
  moderate: '#f57f17',
  high: '#e65100',
  severe: '#c62828',
};

export default function OzoneSight({ lat, lon }: Props) {
  const [crops, setCrops] = useState<string[]>([]);
  const [selectedCrop, setSelectedCrop] = useState('wheat');
  const [result, setResult] = useState<OzoneResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCrops().then((c) => setCrops(Object.keys(c.crops))).catch(() => {});
    loadOzone(selectedCrop);
  }, [lat, lon]);

  const loadOzone = async (crop: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await getOzone(lat, lon, crop);
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load ozone data');
    } finally {
      setLoading(false);
    }
  };

  const handleCropChange = (crop: string) => {
    setSelectedCrop(crop);
    loadOzone(crop);
  };

  const severity = result?.yield_impact.severity ?? 'low';
  const sevColor = severityColors[severity] ?? '#666';

  return (
    <section>
      <h2>OzoneSight</h2>
      <p>Tropospheric ozone exposure analysis and crop yield impact ({lat.toFixed(2)}&deg;N, {lon.toFixed(2)}&deg;E)</p>

      <label>
        Crop:
        <select value={selectedCrop} onChange={(e) => handleCropChange(e.target.value)}
          style={{ marginLeft: '0.5rem', padding: '4px 8px' }}>
          {crops.map((c) => (
            <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
          ))}
        </select>
      </label>

      {loading && <p>Loading ozone analysis...</p>}
      {error && <p style={{ color: '#c62828' }}>Error: {error}</p>}

      {result && !loading && (
        <div style={{ marginTop: '1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
            <div style={{ background: '#fff', padding: '1rem', borderRadius: '8px', textAlign: 'center' }}>
              <div style={{ fontSize: '0.85rem', color: '#666' }}>Mean Ozone</div>
              <div style={{ fontSize: '1.8rem', fontWeight: 'bold' }}>
                {result.exposure.mean_ozone_ppb}
              </div>
              <div style={{ fontSize: '0.8rem', color: '#999' }}>ppb ({result.exposure.season} season)</div>
            </div>
            <div style={{ background: '#fff', padding: '1rem', borderRadius: '8px', textAlign: 'center' }}>
              <div style={{ fontSize: '0.85rem', color: '#666' }}>AOT40 Exposure</div>
              <div style={{ fontSize: '1.8rem', fontWeight: 'bold' }}>
                {result.exposure.aot40_ppb_h.toLocaleString()}
              </div>
              <div style={{ fontSize: '0.8rem', color: '#999' }}>ppb·hours</div>
            </div>
            <div style={{ background: '#fff', padding: '1rem', borderRadius: '8px', textAlign: 'center' }}>
              <div style={{ fontSize: '0.85rem', color: '#666' }}>Yield Loss</div>
              <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: sevColor }}>
                {result.yield_impact.yield_loss_percent}%
              </div>
              <div style={{
                fontSize: '0.75rem', color: '#fff', background: sevColor,
                padding: '2px 8px', borderRadius: '12px', display: 'inline-block',
              }}>
                {severity.toUpperCase()}
              </div>
            </div>
          </div>

          <div style={{ marginTop: '1rem' }}>
            <strong>Region:</strong> {result.exposure.region.replace(/_/g, ' ')} |{' '}
            <strong>Peak Ozone:</strong> {result.exposure.peak_ozone_ppb} ppb |{' '}
            <strong>Threshold:</strong> {result.yield_impact.threshold_ppb_h.toLocaleString()} ppb·h
          </div>

          {result.recommendations.length > 0 && (
            <div style={{ marginTop: '1rem', background: '#fff3e0', padding: '0.75rem', borderRadius: '6px' }}>
              <strong>Recommendations:</strong>
              <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.5rem' }}>
                {result.recommendations.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>
          )}

          <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#999' }}>
            Source: {result.source}
          </div>
        </div>
      )}
    </section>
  );
}
