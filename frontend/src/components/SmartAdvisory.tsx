import { useState, useEffect } from 'react';
import {
  getCrops, getSmartAdvisory,
  type SmartAdvisoryResponse, type IrrigationWeek, type FertilizerApplication,
} from '../services/api';

interface Props {
  lat: number;
  lon: number;
}

const cardStyle = { background: '#fff', padding: '1rem', borderRadius: '8px', textAlign: 'center' as const, border: '1px solid #eee' };

const modelColors: Record<string, { bg: string; color: string; label: string }> = {
  WOFOST:   { bg: '#e3f2fd', color: '#1565c0', label: 'WOFOST' },
  AquaCrop: { bg: '#e0f2f1', color: '#00695c', label: 'AquaCrop (FAO)' },
  DSSAT:    { bg: '#fff3e0', color: '#ef6c00', label: 'DSSAT' },
};

const priorityColors: Record<string, { bg: string; color: string }> = {
  critical:    { bg: '#ffebee', color: '#c62828' },
  recommended: { bg: '#fff8e1', color: '#f57f17' },
  optional:    { bg: '#e8f5e9', color: '#2e7d32' },
};

const droughtColors: Record<string, { bg: string; color: string }> = {
  low:      { bg: '#e8f5e9', color: '#2e7d32' },
  moderate: { bg: '#fff8e1', color: '#f57f17' },
  high:     { bg: '#fff3e0', color: '#e65100' },
  severe:   { bg: '#ffebee', color: '#c62828' },
};

function ModelBadge({ model }: { model: string }) {
  const m = modelColors[model] ?? { bg: '#f5f5f5', color: '#666', label: model };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      padding: '2px 10px', borderRadius: '12px', fontSize: '0.7rem',
      fontWeight: 600, letterSpacing: '0.3px', textTransform: 'uppercase',
      background: m.bg, color: m.color,
    }}>
      {m.label}
    </span>
  );
}

// Mock data used when backend endpoint isn't ready
function getMockData(crop: string, lat: number, lon: number): SmartAdvisoryResponse {
  return {
    crop,
    location: { latitude: lat, longitude: lon },
    yield_forecast: {
      model: 'WOFOST',
      yield_kg_ha: 4280,
      growth_days: 120,
      confidence: 'high',
    },
    water_advisory: {
      model: 'AquaCrop',
      total_water_need_mm: 480,
      irrigation_need_mm: 340,
      rain_contribution_mm: 140,
      drought_risk: 'moderate',
      water_productivity_kg_m3: 1.12,
      schedule: [
        { week: 1, date_range: 'Week 1-2', amount_mm: 30, crop_stage: 'Germination', priority: 'critical' },
        { week: 3, date_range: 'Week 3-4', amount_mm: 25, crop_stage: 'Seedling', priority: 'critical' },
        { week: 5, date_range: 'Week 5-6', amount_mm: 45, crop_stage: 'Tillering', priority: 'recommended' },
        { week: 7, date_range: 'Week 7-8', amount_mm: 50, crop_stage: 'Booting', priority: 'critical' },
        { week: 9, date_range: 'Week 9-10', amount_mm: 55, crop_stage: 'Flowering', priority: 'critical' },
        { week: 11, date_range: 'Week 11-12', amount_mm: 40, crop_stage: 'Grain filling', priority: 'recommended' },
        { week: 13, date_range: 'Week 13-14', amount_mm: 35, crop_stage: 'Ripening', priority: 'optional' },
        { week: 15, date_range: 'Week 15-16', amount_mm: 0, crop_stage: 'Maturity', priority: 'optional' },
      ],
    },
    nutrient_advisory: {
      model: 'DSSAT',
      nitrogen_kg_ha: 120,
      phosphorus_kg_ha: 60,
      potassium_kg_ha: 40,
      applications: [
        { timing: 'Basal (at sowing)', day_after_sowing: 0, n_kg: 40, p_kg: 60, k_kg: 40, product_suggestion: 'DAP (18:46:0) + MOP (0:0:60)' },
        { timing: 'First top dress', day_after_sowing: 25, n_kg: 40, p_kg: 0, k_kg: 0, product_suggestion: 'Urea (46:0:0)' },
        { timing: 'Second top dress', day_after_sowing: 50, n_kg: 40, p_kg: 0, k_kg: 0, product_suggestion: 'Urea (46:0:0)' },
      ],
      soil_health_note: 'Soil organic carbon is moderate. Consider adding farmyard manure (5 t/ha) before sowing to improve soil structure and water retention.',
    },
    recommendations: [
      'Start irrigation within 3 days of sowing — soil moisture is below field capacity.',
      'Apply basal fertilizer (DAP + MOP) at sowing for strong root establishment.',
      'Flowering stage (week 9-10) is the most water-sensitive — do not skip irrigation.',
      'Split nitrogen into 3 doses to reduce leaching and improve uptake efficiency.',
      'Monitor for drought stress during booting — consider mulching to conserve moisture.',
    ],
    data_sources: {
      weather: 'NASA POWER (30-day)',
      soil: 'SoilGrids + ICAR profiles',
      yield: 'WOFOST crop model',
      water: 'AquaCrop simulation',
      nutrients: 'DSSAT nutrient model',
    },
  };
}

export default function SmartAdvisory({ lat, lon }: Props) {
  const [crops, setCrops] = useState<Record<string, string>>({});
  const [selectedCrop, setSelectedCrop] = useState('wheat');
  const [result, setResult] = useState<SmartAdvisoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usingMock, setUsingMock] = useState(false);

  useEffect(() => {
    getCrops().then((c) => setCrops(c.crops)).catch(() => {});
  }, []);

  const runAdvisory = async () => {
    setLoading(true);
    setError(null);
    setUsingMock(false);
    try {
      const res = await getSmartAdvisory({ latitude: lat, longitude: lon, crop: selectedCrop });
      setResult(res);
    } catch {
      // Backend not ready — use mock data
      setResult(getMockData(selectedCrop, lat, lon));
      setUsingMock(true);
    } finally {
      setLoading(false);
    }
  };

  const water = result?.water_advisory;
  const nutrients = result?.nutrient_advisory;
  const yld = result?.yield_forecast;
  const drought = water ? droughtColors[water.drought_risk] ?? droughtColors.moderate : null;

  return (
    <section id="smart-advisory" className="accent-teal">
      <h2>Smart Farm Advisory</h2>
      <p>Combined recommendations from 3 crop simulation models ({lat.toFixed(2)}&deg;N, {lon.toFixed(2)}&deg;E)</p>

      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', margin: '1rem 0' }}>
        <label>
          Crop:
          <select value={selectedCrop} onChange={(e) => setSelectedCrop(e.target.value)}
            style={{ marginLeft: '0.5rem' }}>
            {Object.keys(crops).map((c) => (
              <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
            ))}
          </select>
        </label>

        <button onClick={runAdvisory} disabled={loading}>
          {loading ? 'Analyzing...' : 'Get Farm Advisory'}
        </button>
      </div>

      {error && <div style={{ color: '#c62828', margin: '1rem 0' }}>Error: {error}</div>}

      {usingMock && (
        <div style={{
          background: '#fff8e1', padding: '0.5rem 0.75rem', borderRadius: '6px',
          fontSize: '0.85rem', color: '#f57f17', marginBottom: '1rem',
        }}>
          Smart advisory endpoint coming soon — showing simulated recommendations for demo purposes.
        </div>
      )}

      {result && (
        <div>
          {/* Summary Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: yld && water && nutrients ? '1fr 1fr 1fr' : water || nutrients ? '1fr 1fr' : '1fr', gap: '1rem', margin: '1rem 0' }}>
            {yld && (
              <div style={{ ...cardStyle, opacity: yld.yield_kg_ha > 0 ? 1 : 0.55 }}>
                <div style={{ fontSize: '0.8rem', color: '#666', marginBottom: '4px' }}>Expected Yield</div>
                <div style={{ fontSize: '1.8rem', fontWeight: 'bold' }}>
                  {yld.yield_kg_ha > 0 ? yld.yield_kg_ha.toLocaleString() : '—'}
                </div>
                <div style={{ fontSize: '0.8rem', color: '#999' }}>
                  {yld.yield_kg_ha > 0 ? `kg/ha in ${yld.growth_days} days` : 'Season in progress'}
                </div>
                <div style={{ marginTop: '6px' }}><ModelBadge model={yld.model} /></div>
              </div>
            )}
            {water && (
              <div style={cardStyle}>
                <div style={{ fontSize: '0.8rem', color: '#666', marginBottom: '4px' }}>Water Needed</div>
                <div style={{ fontSize: '1.8rem', fontWeight: 'bold' }}>{water.irrigation_need_mm}</div>
                <div style={{ fontSize: '0.8rem', color: '#999' }}>mm irrigation ({water.rain_contribution_mm} mm from rain)</div>
                <div style={{ marginTop: '6px' }}><ModelBadge model={water.model} /></div>
              </div>
            )}
            {nutrients && (
              <div style={cardStyle}>
                <div style={{ fontSize: '0.8rem', color: '#666', marginBottom: '4px' }}>Nitrogen Recommended</div>
                <div style={{ fontSize: '1.8rem', fontWeight: 'bold' }}>{nutrients.nitrogen_kg_ha}</div>
                <div style={{ fontSize: '0.8rem', color: '#999' }}>kg N/ha (P: {nutrients.phosphorus_kg_ha}, K: {nutrients.potassium_kg_ha})</div>
                <div style={{ marginTop: '6px' }}><ModelBadge model={nutrients.model} /></div>
              </div>
            )}
            {!yld && !water && !nutrients && (
              <div style={{ ...cardStyle, color: '#999' }}>No model results available for this crop.</div>
            )}
          </div>

          {/* Drought Risk Indicator */}
          {drought && water && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '0.75rem',
              padding: '0.6rem 1rem', borderRadius: '8px',
              background: drought.bg, marginBottom: '1rem',
            }}>
              <span style={{ fontWeight: 600, color: drought.color, fontSize: '0.9rem' }}>
                Drought Risk: {water.drought_risk.charAt(0).toUpperCase() + water.drought_risk.slice(1)}
              </span>
              <span style={{ fontSize: '0.85rem', color: '#555' }}>
                Water productivity: {water.water_productivity_kg_m3.toFixed(2)} kg grain per m&sup3; water
              </span>
            </div>
          )}

          {/* Irrigation Schedule */}
          {water && water.schedule && (
            <div style={{ background: '#fff', padding: '1rem', borderRadius: '8px', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <h3 style={{ margin: 0, fontSize: '1rem' }}>Irrigation Schedule</h3>
                <ModelBadge model="AquaCrop" />
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Period</th>
                    <th>Crop Stage</th>
                    <th>Water (mm)</th>
                    <th>Priority</th>
                  </tr>
                </thead>
                <tbody>
                  {water.schedule.filter((w: IrrigationWeek) => w.amount_mm > 0).map((w: IrrigationWeek) => {
                    const pc = priorityColors[w.priority] ?? priorityColors.optional;
                    return (
                      <tr key={w.week}>
                        <td>{w.date_range}</td>
                        <td>{w.crop_stage}</td>
                        <td><strong>{w.amount_mm}</strong> mm</td>
                        <td>
                          <span style={{
                            padding: '2px 8px', borderRadius: '10px', fontSize: '0.75rem',
                            fontWeight: 600, background: pc.bg, color: pc.color,
                          }}>
                            {w.priority}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div style={{ fontSize: '0.8rem', color: '#666', marginTop: '0.5rem' }}>
                Total irrigation: <strong>{water.irrigation_need_mm} mm</strong> | Rain: {water.rain_contribution_mm} mm |
                Total need: {water.total_water_need_mm} mm
              </div>
            </div>
          )}

          {/* Nutrient Plan */}
          {nutrients && nutrients.applications && (
            <div style={{ background: '#fff', padding: '1rem', borderRadius: '8px', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <h3 style={{ margin: 0, fontSize: '1rem' }}>Nutrient Management Plan</h3>
                <ModelBadge model="DSSAT" />
              </div>

              {/* NPK summary bar */}
              <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '0.75rem' }}>
                {[
                  { label: 'Nitrogen (N)', value: nutrients.nitrogen_kg_ha, color: '#1565c0' },
                  { label: 'Phosphorus (P)', value: nutrients.phosphorus_kg_ha, color: '#e65100' },
                  { label: 'Potassium (K)', value: nutrients.potassium_kg_ha, color: '#6a1b9a' },
                ].map((n) => (
                  <div key={n.label} style={{ flex: 1, textAlign: 'center' }}>
                    <div style={{ fontSize: '0.75rem', color: '#666' }}>{n.label}</div>
                    <div style={{
                      fontSize: '1.4rem', fontWeight: 'bold', color: n.color,
                      margin: '2px 0',
                    }}>
                      {n.value}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: '#999' }}>kg/ha</div>
                  </div>
                ))}
              </div>

              <table>
                <thead>
                  <tr>
                    <th>When to Apply</th>
                    <th>Day</th>
                    <th>N</th>
                    <th>P</th>
                    <th>K</th>
                    <th>Suggested Product</th>
                  </tr>
                </thead>
                <tbody>
                  {nutrients.applications.map((a: FertilizerApplication, i: number) => (
                    <tr key={i}>
                      <td><strong>{a.timing}</strong></td>
                      <td>Day {a.day_after_sowing}</td>
                      <td>{a.n_kg} kg</td>
                      <td>{a.p_kg} kg</td>
                      <td>{a.k_kg} kg</td>
                      <td style={{ fontSize: '0.85rem', color: '#555' }}>{a.product_suggestion}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {nutrients.soil_health_note && (
                <div style={{
                  marginTop: '0.75rem', padding: '0.6rem 0.75rem', borderRadius: '6px',
                  background: '#f1f8e9', fontSize: '0.85rem', color: '#33691e',
                }}>
                  <strong>Soil health tip:</strong> {nutrients.soil_health_note}
                </div>
              )}
            </div>
          )}

          {/* Combined Recommendations */}
          {result.recommendations.length > 0 && (
            <div style={{
              background: '#e8f5e9', padding: '1rem', borderRadius: '8px', marginBottom: '1rem',
            }}>
              <strong style={{ fontSize: '0.95rem' }}>Your Farm Action Plan</strong>
              <ol style={{ margin: '0.5rem 0 0', paddingLeft: '1.5rem', lineHeight: 1.8 }}>
                {result.recommendations.map((r, i) => (
                  <li key={i} style={{ fontSize: '0.9rem' }}>{r}</li>
                ))}
              </ol>
            </div>
          )}

          {/* Data Sources */}
          <div style={{ fontSize: '0.8rem', color: '#666', marginBottom: '0.5rem' }}>
            <strong>Data sources: </strong>
            {Object.entries(result.data_sources).map(([key, val], i) => (
              <span key={key}>
                {i > 0 && ' · '}
                <span style={{ color: '#2e7d32' }}>{key}: {val}</span>
              </span>
            ))}
          </div>

          {/* Transparency */}
          <details>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>How does this work?</summary>
            <div style={{ marginTop: '0.5rem', lineHeight: 1.7, fontSize: '0.85rem', color: '#555' }}>
              <p>
                <strong>Three complementary models:</strong> WOFOST simulates daily crop growth
                using physics-based photosynthesis and phenology. AquaCrop (developed by FAO)
                focuses on water productivity — it models soil water balance, crop transpiration,
                and irrigation scheduling under water-limited conditions. DSSAT models nutrient
                dynamics — nitrogen mineralization, phosphorus fixation, and fertilizer response
                curves calibrated to Indian soils.
              </p>
              <p>
                <strong>Smart routing:</strong> The system automatically selects which model to
                consult for each aspect of the advisory. Yield predictions come from WOFOST,
                irrigation schedules from AquaCrop, and nutrient plans from DSSAT. The combined
                recommendations merge insights from all three models.
              </p>
              <p style={{ color: '#999', fontStyle: 'italic' }}>
                Each model badge shows which engine produced that specific recommendation.
              </p>
            </div>
          </details>
        </div>
      )}
    </section>
  );
}
