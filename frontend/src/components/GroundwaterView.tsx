import { useEffect, useState } from 'react';
import { getGroundwater, type GroundwaterResult, type CropRecommendation } from '../services/api';

interface Props {
  lat: number;
  lon: number;
}

const categoryColors: Record<string, string> = {
  safe: '#2e7d32',
  'semi-critical': '#f57f17',
  'over-exploited': '#c62828',
};

const sustainColors: Record<string, string> = {
  highly_sustainable: '#2e7d32',
  sustainable: '#4caf50',
  marginal: '#ff9800',
  unsustainable: '#c62828',
};

function DepthChart({ historical, projections, thickness }: {
  historical: { year: number; depth_m: number }[];
  projections: { year: number; projected_depth_m: number; pct_depleted: number }[];
  thickness: number;
}) {
  const allPoints = [
    ...historical.map((h) => ({ year: h.year, depth: h.depth_m, projected: false })),
    ...projections.map((p) => ({ year: p.year, depth: p.projected_depth_m, projected: true })),
  ];

  const maxDepth = Math.max(thickness * 0.5, ...allPoints.map((p) => p.depth));
  const chartW = 600;
  const chartH = 200;
  const padL = 45;
  const padR = 10;
  const padT = 10;
  const padB = 30;
  const w = chartW - padL - padR;
  const h = chartH - padT - padB;

  const minYear = allPoints[0]?.year ?? 2015;
  const maxYear = allPoints[allPoints.length - 1]?.year ?? 2035;
  const yearSpan = maxYear - minYear || 1;

  const x = (year: number) => padL + ((year - minYear) / yearSpan) * w;
  const y = (depth: number) => padT + (depth / maxDepth) * h;

  const histPath = allPoints.filter((p) => !p.projected);
  const projPath = allPoints.filter((p) => p.projected);
  // Connect projection to last historical point
  const lastHist = histPath[histPath.length - 1];

  const toPath = (pts: typeof allPoints) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.year).toFixed(1)},${y(p.depth).toFixed(1)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${chartW} ${chartH}`} style={{ width: '100%', maxWidth: 600, display: 'block' }}>
      {/* Grid lines */}
      {[0, maxDepth * 0.25, maxDepth * 0.5, maxDepth * 0.75, maxDepth].map((d, i) => (
        <g key={i}>
          <line x1={padL} y1={y(d)} x2={chartW - padR} y2={y(d)}
            stroke="#e0e0e0" strokeWidth={0.5} />
          <text x={padL - 4} y={y(d) + 3} textAnchor="end" fontSize="9" fill="#999">
            {d.toFixed(0)}m
          </text>
        </g>
      ))}

      {/* Year labels */}
      {allPoints.filter((_, i) => i % 3 === 0).map((p) => (
        <text key={p.year} x={x(p.year)} y={chartH - 5} textAnchor="middle" fontSize="9" fill="#999">
          {p.year}
        </text>
      ))}

      {/* Historical line */}
      <path d={toPath(histPath)} fill="none" stroke="#1565c0" strokeWidth={2} />

      {/* Projection line (dashed) */}
      {lastHist && projPath.length > 0 && (
        <path
          d={toPath([lastHist, ...projPath])}
          fill="none" stroke="#c62828" strokeWidth={2} strokeDasharray="6,3"
        />
      )}

      {/* Dots */}
      {histPath.map((p) => (
        <circle key={p.year} cx={x(p.year)} cy={y(p.depth)} r={3} fill="#1565c0" />
      ))}
      {projPath.map((p) => (
        <circle key={p.year} cx={x(p.year)} cy={y(p.depth)} r={3} fill="#c62828" fillOpacity={0.6} />
      ))}

      {/* Legend */}
      <line x1={padL + 10} y1={padT + 4} x2={padL + 30} y2={padT + 4} stroke="#1565c0" strokeWidth={2} />
      <text x={padL + 34} y={padT + 7} fontSize="9" fill="#666">Historical</text>
      <line x1={padL + 100} y1={padT + 4} x2={padL + 120} y2={padT + 4} stroke="#c62828" strokeWidth={2} strokeDasharray="4,2" />
      <text x={padL + 124} y={padT + 7} fontSize="9" fill="#666">Projected</text>
    </svg>
  );
}

function CropTable({ recommendations }: { recommendations: CropRecommendation[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Crop</th>
          <th>Water Need</th>
          <th>Season</th>
          <th>Drought Tolerance</th>
          <th>Sustainability</th>
        </tr>
      </thead>
      <tbody>
        {recommendations.slice(0, 8).map((r) => (
          <tr key={r.crop} style={{ opacity: r.viable ? 1 : 0.45 }}>
            <td>
              {r.label}
              {!r.viable && <span style={{ color: '#c62828', fontSize: '0.8rem' }}> (not viable)</span>}
            </td>
            <td>{r.water_need_mm} mm</td>
            <td>{r.season}</td>
            <td>{r.drought_tolerance.replace('_', ' ')}</td>
            <td>
              <span style={{
                color: sustainColors[r.sustainability] ?? '#666',
                fontWeight: 600,
                fontSize: '0.85rem',
              }}>
                {r.sustainability.replace('_', ' ')}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function GroundwaterView({ lat, lon }: Props) {
  const [result, setResult] = useState<GroundwaterResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    getGroundwater(lat, lon)
      .then(setResult)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load groundwater data'))
      .finally(() => setLoading(false));
  }, [lat, lon]);

  if (loading) return <div className="loading">Loading groundwater analysis...</div>;
  if (error) return <div className="error">Groundwater error: {error}</div>;
  if (!result) return null;

  const { aquifer, historical_depths, projections, years_to_critical, crop_recommendations, advisory } = result;
  const catColor = categoryColors[aquifer.category] ?? '#666';
  const extractionRatio = aquifer.stage_of_extraction_pct;

  return (
    <section>
      <h2>Groundwater & Crop Advisory</h2>
      <p>Aquifer depletion tracking and water-smart crop recommendations ({lat.toFixed(2)}&deg;N, {lon.toFixed(2)}&deg;E)</p>

      {/* Aquifer Status Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '0.75rem', marginTop: '1rem' }}>
        <div style={{ background: '#fff', padding: '0.75rem', borderRadius: '8px', textAlign: 'center' }}>
          <div style={{ fontSize: '0.8rem', color: '#666' }}>Water Table Depth</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 'bold' }}>{aquifer.current_depth_m} m</div>
          <div style={{ fontSize: '0.75rem', color: '#999' }}>below ground level</div>
        </div>
        <div style={{ background: '#fff', padding: '0.75rem', borderRadius: '8px', textAlign: 'center' }}>
          <div style={{ fontSize: '0.8rem', color: '#666' }}>Annual Decline</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 'bold', color: aquifer.annual_decline_m > 0.5 ? '#c62828' : '#f57f17' }}>
            {aquifer.annual_decline_m} m/yr
          </div>
          <div style={{ fontSize: '0.75rem', color: '#999' }}>GRACE: {aquifer.grace_trend_cm_yr} cm/yr</div>
        </div>
        <div style={{ background: '#fff', padding: '0.75rem', borderRadius: '8px', textAlign: 'center' }}>
          <div style={{ fontSize: '0.8rem', color: '#666' }}>Extraction Rate</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 'bold', color: extractionRatio > 100 ? '#c62828' : extractionRatio > 70 ? '#f57f17' : '#2e7d32' }}>
            {extractionRatio}%
          </div>
          <div style={{ fontSize: '0.75rem', color: '#999' }}>of recharge</div>
        </div>
        <div style={{ background: '#fff', padding: '0.75rem', borderRadius: '8px', textAlign: 'center' }}>
          <div style={{ fontSize: '0.8rem', color: '#666' }}>Status</div>
          <div style={{
            fontSize: '0.85rem', fontWeight: 'bold', color: '#fff',
            background: catColor, padding: '4px 10px', borderRadius: '12px',
            display: 'inline-block', marginTop: '0.3rem',
          }}>
            {aquifer.category.replace('-', ' ').toUpperCase()}
          </div>
          {years_to_critical !== null && (
            <div style={{ fontSize: '0.75rem', color: '#999', marginTop: '0.25rem' }}>
              ~{years_to_critical} yrs to critical
            </div>
          )}
        </div>
      </div>

      {/* Aquifer Info */}
      <div style={{ background: '#fff', padding: '1rem', borderRadius: '8px', marginTop: '0.75rem' }}>
        <h3 style={{ marginTop: 0 }}>{aquifer.region_name}</h3>
        <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', fontSize: '0.9rem' }}>
          <div><strong>Type:</strong> {aquifer.aquifer_type}</div>
          <div><strong>Thickness:</strong> {aquifer.aquifer_thickness_m} m</div>
          <div><strong>Recharge:</strong> {aquifer.recharge_rate_mm_yr} mm/yr</div>
          <div><strong>Extraction:</strong> {aquifer.extraction_rate_mm_yr} mm/yr</div>
          <div><strong>Wells monitored:</strong> {aquifer.wells_monitored}</div>
          <div><strong>Seasonal range:</strong> {aquifer.post_monsoon_depth_m}–{aquifer.pre_monsoon_depth_m} m</div>
        </div>
      </div>

      {/* Depth Trend Chart */}
      <div style={{ background: '#fff', padding: '1rem', borderRadius: '8px', marginTop: '0.75rem' }}>
        <h3 style={{ marginTop: 0 }}>Water Table Depth Trend (m below ground)</h3>
        <DepthChart
          historical={historical_depths}
          projections={projections}
          thickness={aquifer.aquifer_thickness_m}
        />
      </div>

      {/* Crop Recommendations */}
      <div style={{ background: '#fff', padding: '1rem', borderRadius: '8px', marginTop: '0.75rem' }}>
        <h3 style={{ marginTop: 0 }}>Crop Switching Advisory</h3>
        <p style={{ color: '#666', fontSize: '0.9rem', marginBottom: '0.75rem' }}>
          Based on aquifer status ({aquifer.category}) and available recharge ({aquifer.recharge_rate_mm_yr} mm/yr)
        </p>
        <CropTable recommendations={crop_recommendations} />
      </div>

      {/* Advisory */}
      {advisory.length > 0 && (
        <div style={{
          marginTop: '0.75rem', padding: '0.75rem', borderRadius: '8px',
          background: aquifer.category === 'over-exploited' ? '#ffebee' :
                     aquifer.category === 'semi-critical' ? '#fff3e0' : '#e8f5e9',
        }}>
          <strong>Management Advisory:</strong>
          <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.5rem' }}>
            {advisory.map((a, i) => <li key={i} style={{ marginBottom: '0.25rem' }}>{a}</li>)}
          </ul>
        </div>
      )}

      <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#999' }}>
        Source: {result.source}
      </div>
    </section>
  );
}
