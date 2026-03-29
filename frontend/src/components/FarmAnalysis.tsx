import { useState, useEffect, useRef, useCallback, Component, type ReactNode } from 'react';
import {
  getCrops, analyzeFarm, getWeather, getSoil, getGroundwater, getOzone, getElevation,
  type FarmAnalysisRequest, type FarmAnalysisResponse,
  type IrrigationWeek, type FertilizerApplication,
  type WeatherResponse, type SoilResponse, type GroundwaterResult,
  type CropPlan, type CropActivity, type CropZone, type HazardWeek, type TimelineEvent, type LandAnalysis,
  type PestRisk,
} from '../services/api';
import MapView from './MapView';
import AdvisoryChat from './AdvisoryChat';

// Error boundary to catch render crashes and show error instead of blank screen
class ResultsErrorBoundary extends Component<{ children: ReactNode; onReset: () => void }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error('Results render crash:', error); }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '2rem', background: '#ffebee', borderRadius: 10, margin: '1rem 0' }}>
          <h3 style={{ color: '#c62828', marginTop: 0 }}>Results display error</h3>
          <p style={{ color: '#555' }}>{this.state.error.message}</p>
          <pre style={{ fontSize: '0.75rem', color: '#888', overflow: 'auto', maxHeight: 200 }}>{this.state.error.stack}</pre>
          <button onClick={() => { this.setState({ error: null }); this.props.onReset(); }}
            style={{ padding: '8px 20px', background: '#c62828', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', marginTop: '0.5rem' }}>
            Start Over
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Location presets ─────────────────────────────────────────────────

interface LocationPreset { name: string; lat: number; lon: number; }
const PRESETS: LocationPreset[] = [
  { name: 'Pune', lat: 18.52, lon: 73.85 },
  { name: 'Delhi', lat: 28.61, lon: 77.23 },
  { name: 'Jaipur', lat: 26.91, lon: 75.78 },
  { name: 'Nagpur', lat: 21.15, lon: 79.09 },
];

// ── Styling ──────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: '#fff', padding: '1rem', borderRadius: '8px',
  textAlign: 'center', border: '1px solid #eee',
};

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

const severityStyles: Record<string, { border: string; bg: string; color: string }> = {
  ok:         { border: '#4caf50', bg: '#e8f5e9', color: '#1b5e20' },
  warning:    { border: '#ff9800', bg: '#fff8e1', color: '#e65100' },
  critical:   { border: '#f44336', bg: '#ffebee', color: '#b71c1c' },
  impossible: { border: '#b71c1c', bg: '#ffcdd2', color: '#b71c1c' },
};

function ModelBadge({ model }: { model: string }) {
  const m = modelColors[model] ?? { bg: '#f5f5f5', color: '#666', label: model };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      padding: '2px 10px', borderRadius: '12px', fontSize: '0.7rem',
      fontWeight: 600, letterSpacing: '0.3px', textTransform: 'uppercase',
      background: m.bg, color: m.color,
    }}>{m.label}</span>
  );
}

// ── Pipeline animation ───────────────────────────────────────────────

type StepStatus = 'pending' | 'running' | 'done' | 'error';
interface PipelineStep { label: string; detail: string; status: StepStatus; }

const checkCircle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 22, height: 22, borderRadius: '50%', background: '#2e7d32',
  color: '#fff', fontSize: '0.75rem', fontWeight: 700, flexShrink: 0,
};
const spinnerStyle: React.CSSProperties = {
  display: 'inline-block', width: 20, height: 20, borderRadius: '50%',
  border: '2.5px solid #c8e6c9', borderTopColor: '#2e7d32',
  animation: 'farm-spin 0.7s linear infinite', flexShrink: 0,
};
const pendingCircle: React.CSSProperties = {
  display: 'inline-block', width: 20, height: 20, borderRadius: '50%',
  border: '2px solid #e0e0e0', flexShrink: 0,
};

function StepIcon({ status }: { status: StepStatus }) {
  if (status === 'done') return <span style={checkCircle}>&#10003;</span>;
  if (status === 'running') return <span style={spinnerStyle} />;
  return <span style={pendingCircle} />;
}

function ProgressBar({ pct }: { pct: number }) {
  return (
    <div style={{ height: 8, background: '#e0e0e0', borderRadius: 4, overflow: 'hidden', width: '100%', marginTop: 8 }}>
      <div style={{
        height: '100%', borderRadius: 4,
        background: 'linear-gradient(90deg, #43a047, #66bb6a)',
        width: `${pct}%`, transition: 'width 0.5s ease',
      }} />
    </div>
  );
}

// ── Score ring ────────────────────────────────────────────────────────

function ScoreRing({ score, size = 80 }: { score: number; size?: number }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score));
  const color = pct >= 70 ? '#2e7d32' : pct >= 40 ? '#f57f17' : '#c62828';
  return (
    <svg width={size} height={size} style={{ display: 'block' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e0e0e0" strokeWidth={6} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={6}
        strokeDasharray={`${(pct / 100) * c} ${c}`} strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dasharray 0.8s ease' }} />
      <text x="50%" y="50%" textAnchor="middle" dy="0.35em"
        style={{ fontSize: size * 0.28, fontWeight: 700, fill: color }}>{pct}</text>
    </svg>
  );
}

// ── Crop recommendation logic ────────────────────────────────────────

interface CropRecommendation {
  crop: string;
  score: number;
  reason: string;
  supported: boolean;
}

function recommendCrops(
  weather: WeatherResponse | null,
  soil: SoilResponse | null,
  gw: GroundwaterResult | null,
): CropRecommendation[] {
  const allCrops = [
    { crop: 'rice', waterNeed: 1200, season: 'kharif', minTemp: 20, maxTemp: 38, phRange: [5.5, 7.5] },
    { crop: 'wheat', waterNeed: 400, season: 'rabi', minTemp: 10, maxTemp: 28, phRange: [6.0, 8.0] },
    { crop: 'maize', waterNeed: 600, season: 'kharif', minTemp: 18, maxTemp: 35, phRange: [5.5, 7.5] },
    { crop: 'soybean', waterNeed: 500, season: 'kharif', minTemp: 20, maxTemp: 35, phRange: [6.0, 7.5] },
    { crop: 'cotton', waterNeed: 700, season: 'kharif', minTemp: 20, maxTemp: 40, phRange: [6.0, 8.0] },
    { crop: 'sorghum', waterNeed: 350, season: 'kharif', minTemp: 20, maxTemp: 40, phRange: [5.5, 8.5] },
    { crop: 'millet', waterNeed: 300, season: 'kharif', minTemp: 20, maxTemp: 40, phRange: [5.5, 8.0] },
    { crop: 'chickpea', waterNeed: 250, season: 'rabi', minTemp: 10, maxTemp: 30, phRange: [6.0, 8.5] },
    { crop: 'potato', waterNeed: 500, season: 'rabi', minTemp: 10, maxTemp: 25, phRange: [5.0, 6.5] },
    { crop: 'groundnut', waterNeed: 450, season: 'kharif', minTemp: 20, maxTemp: 35, phRange: [5.5, 7.0] },
    { crop: 'sugarcane', waterNeed: 1800, season: 'annual', minTemp: 20, maxTemp: 40, phRange: [5.5, 8.0] },
    { crop: 'pigeonpea', waterNeed: 350, season: 'kharif', minTemp: 18, maxTemp: 38, phRange: [5.0, 8.0] },
    { crop: 'mungbean', waterNeed: 250, season: 'kharif', minTemp: 20, maxTemp: 40, phRange: [6.0, 8.0] },
  ];

  const gwCategory = gw?.aquifer?.category ?? 'safe';
  const gwRecharge = gw?.aquifer?.recharge_rate_mm_yr ?? 500;
  const ph = soil?.layers?.[0]?.ph ?? 7.0;
  const avgTemp = weather?.data?.length
    ? weather.data.reduce((s, d) => s + ((d.temperature_max ?? 30) + (d.temperature_min ?? 20)) / 2, 0) / weather.data.length
    : 28;

  return allCrops.map(c => {
    let score = 50;
    const reasons: string[] = [];

    if (avgTemp >= c.minTemp && avgTemp <= c.maxTemp) {
      score += 15; reasons.push('Good temperature range');
    } else {
      score -= 15; reasons.push('Temperature outside optimal range');
    }

    if (ph >= c.phRange[0] && ph <= c.phRange[1]) {
      score += 10; reasons.push('Soil pH suitable');
    } else {
      score -= 10; reasons.push('Soil pH outside optimal range');
    }

    if (gwCategory === 'over-exploited' && c.waterNeed > 600) {
      score -= 20; reasons.push('High water need — groundwater stressed');
    } else if (gwCategory === 'safe' || c.waterNeed < gwRecharge * 0.5) {
      score += 10; reasons.push('Water availability adequate');
    }

    if (gwCategory !== 'safe' && c.waterNeed < 400) {
      score += 10; reasons.push('Drought-tolerant — good for water-stressed area');
    }

    score = Math.max(10, Math.min(100, score));
    return { crop: c.crop, score, reason: reasons.slice(0, 2).join('. '), supported: true };
  }).sort((a, b) => b.score - a.score);
}

// ── Planting Timeline (Gantt) ────────────────────────────────────────

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function monthIndex(m: string): number {
  const idx = MONTHS.findIndex(x => m.toLowerCase().startsWith(x.toLowerCase()));
  return idx >= 0 ? idx : 0;
}

function PlantingTimeline({ events, cropPlans }: { events: TimelineEvent[]; cropPlans: CropPlan[] }) {
  // Build bars: each crop gets a sow→harvest span
  const bars: { crop: string; start: number; end: number; color: string }[] = [];

  for (const plan of cropPlans) {
    if (plan.feasibility && !plan.feasibility.viable && plan.feasibility.severity === 'impossible') continue;
    const sowMonth = plan.sowing?.best_month ?? '';
    const sowIdx = monthIndex(sowMonth);
    const harvestEvent = events.find(e => e.crops?.includes(plan.crop) && e.action?.toLowerCase().includes('harvest'));
    const endIdx = harvestEvent ? monthIndex(harvestEvent.month) : Math.min(11, sowIdx + 4);
    bars.push({ crop: plan.crop, start: sowIdx, end: endIdx, color: plan.zone?.color ?? '#4caf50' });
  }

  if (bars.length === 0) return null;

  return (
    <div style={{ overflowX: 'auto' }}>
      {/* Month headers */}
      <div style={{ display: 'flex', borderBottom: '1px solid #e0e0e0', marginBottom: 4 }}>
        {MONTHS.map(m => (
          <div key={m} style={{ flex: '0 0 calc(100%/12)', fontSize: '0.7rem', color: '#666', textAlign: 'center', padding: '2px 0' }}>{m}</div>
        ))}
      </div>
      {/* Bars */}
      {bars.map(bar => {
        const start = bar.start;
        const span = bar.end >= bar.start ? bar.end - bar.start + 1 : (12 - bar.start) + bar.end + 1;
        return (
          <div key={bar.crop} style={{ display: 'flex', alignItems: 'center', height: 28, position: 'relative' }}>
            <div style={{
              position: 'absolute',
              left: `${(start / 12) * 100}%`,
              width: `${(span / 12) * 100}%`,
              height: 20, borderRadius: 4,
              background: bar.color, opacity: 0.85,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.72rem', fontWeight: 600, color: '#fff',
              textTransform: 'capitalize', whiteSpace: 'nowrap', overflow: 'hidden',
            }}>
              {bar.crop}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Weekly Hazard Calendar ───────────────────────────────────────────

const hazardColors: Record<string, string> = { low: '#4caf50', moderate: '#ff9800', high: '#f44336' };

function HazardCalendar({ weeks }: { weeks: HazardWeek[] }) {
  const [hoveredWeek, setHoveredWeek] = useState<number | null>(null);
  return (
    <div>
      <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        {weeks.map(w => (
          <div key={w.week}
            onMouseEnter={() => setHoveredWeek(w.week)}
            onMouseLeave={() => setHoveredWeek(null)}
            style={{
              width: 20, height: 20, borderRadius: 3,
              background: hazardColors[w.risk] ?? '#ccc',
              cursor: 'pointer', transition: 'transform 0.15s',
              transform: hoveredWeek === w.week ? 'scale(1.3)' : 'scale(1)',
            }}
            title={`Week ${w.week}: ${w.note}`}
          />
        ))}
      </div>
      {hoveredWeek !== null && (
        <div style={{ fontSize: '0.78rem', color: '#555', marginTop: 4 }}>
          Week {hoveredWeek}: {weeks.find(w => w.week === hoveredWeek)?.note ?? ''}
        </div>
      )}
      <div style={{ display: 'flex', gap: '0.75rem', marginTop: 4 }}>
        {(['low', 'moderate', 'high'] as const).map(r => (
          <span key={r} style={{ fontSize: '0.65rem', color: '#666', display: 'flex', alignItems: 'center', gap: 3 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: hazardColors[r], display: 'inline-block' }} />
            {r}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Pest & Disease Risk ─────────────────────────────────────────────

const pestRiskColors: Record<string, { bg: string; color: string }> = {
  low: { bg: '#e8f5e9', color: '#2e7d32' },
  moderate: { bg: '#fff8e1', color: '#f57f17' },
  high: { bg: '#ffebee', color: '#c62828' },
};

function PestRiskSection({ pestRisk }: { pestRisk: PestRisk }) {
  const overall = pestRiskColors[pestRisk.overall_risk?.toLowerCase()] ?? pestRiskColors.moderate;
  return (
    <div style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
        <strong style={{ fontSize: '0.9rem' }}>Pest &amp; Disease Risk</strong>
        <span style={{
          padding: '2px 10px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600,
          background: overall.bg, color: overall.color, textTransform: 'capitalize',
        }}>{pestRisk.overall_risk}</span>
      </div>
      {pestRisk.pests?.length > 0 && (
        <table><thead><tr><th>Pest/Disease</th><th>Risk</th><th>Peak Period</th><th>Mitigation</th></tr></thead>
          <tbody>{pestRisk.pests.map((p, i) => {
            const rc = pestRiskColors[p.risk?.toLowerCase()] ?? pestRiskColors.moderate;
            return (
              <tr key={i}>
                <td><strong>{p.name}</strong></td>
                <td><span style={{ padding: '2px 8px', borderRadius: 10, fontSize: '0.75rem', fontWeight: 600, background: rc.bg, color: rc.color, textTransform: 'capitalize' }}>{p.risk}</span></td>
                <td style={{ fontSize: '0.85rem' }}>{p.peak_period}</td>
                <td style={{ fontSize: '0.85rem', color: '#555' }}>{p.mitigation}</td>
              </tr>
            );
          })}</tbody></table>
      )}
      {pestRisk.stress_vulnerability && (
        <div style={{ marginTop: 8, fontSize: '0.82rem', color: '#555', background: '#f5f5f5', padding: '0.5rem 0.75rem', borderRadius: 6 }}>
          <span style={{ fontWeight: 600 }}>Stress vulnerability: </span>
          Water {pestRisk.stress_vulnerability.water_stress}/10 · Nutrient {pestRisk.stress_vulnerability.nutrient_stress}/10
          {pestRisk.stress_vulnerability.note && <span> — {pestRisk.stress_vulnerability.note}</span>}
        </div>
      )}
    </div>
  );
}

// ── Detailed Activity Timeline ────────────────────────────────────────

// Farming phases in order
const PHASES: { key: string; label: string; icon: string; color: string }[] = [
  { key: 'land_prep', label: 'Land Preparation', icon: '🔨', color: '#5d4037' },
  { key: 'sowing', label: 'Sowing', icon: '🌱', color: '#2e7d32' },
  { key: 'irrigation', label: 'Irrigation', icon: '💧', color: '#1565c0' },
  { key: 'fertilizer', label: 'Fertilizer', icon: '🧪', color: '#e65100' },
  { key: 'weeding', label: 'Weeding & Care', icon: '🌿', color: '#6a1b9a' },
  { key: 'monitoring', label: 'Monitoring', icon: '👁', color: '#00695c' },
  { key: 'pest_management', label: 'Pest Management', icon: '🐛', color: '#c62828' },
  { key: 'harvest', label: 'Harvest', icon: '🌾', color: '#f57f17' },
  { key: 'post_harvest', label: 'Post-Harvest', icon: '📦', color: '#455a64' },
];

function DetailedTimeline({ activities }: { activities: CropActivity[] }) {
  const [showAll, setShowAll] = useState(false);
  const [expandedPhase, setExpandedPhase] = useState<string | null>(null);
  const displayed = showAll ? activities : activities.filter(a => a.priority === 'critical' || a.category === 'sowing' || a.category === 'harvest');

  // Group by phase
  const grouped: Record<string, CropActivity[]> = {};
  displayed.forEach(a => {
    if (!grouped[a.category]) grouped[a.category] = [];
    grouped[a.category].push(a);
  });
  const activePhases = PHASES.filter(p => grouped[p.key]?.length);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <h4 style={{ margin: 0, fontSize: '0.95rem' }}>Activity Schedule</h4>
        <button onClick={() => setShowAll(!showAll)} style={{
          background: 'none', border: '1px solid #ccc', borderRadius: 4,
          padding: '2px 10px', fontSize: '0.75rem', cursor: 'pointer', color: '#555',
        }}>
          {showAll ? 'Critical only' : `All ${activities.length} activities`}
        </button>
      </div>

      {/* Left-rail vertical timeline with phase blocks */}
      <div style={{ position: 'relative', paddingLeft: 32 }}>
        {/* Vertical line */}
        <div style={{ position: 'absolute', left: 14, top: 0, bottom: 0, width: 2, background: '#e0e0e0' }} />

        {activePhases.map((phase) => {
          const items = grouped[phase.key];
          const isOpen = expandedPhase === phase.key;
          const firstDate = items[0]?.date ?? '';
          const lastDate = items[items.length - 1]?.date ?? '';
          const hasCritical = items.some(a => a.priority === 'critical');

          return (
            <div key={phase.key} style={{ marginBottom: '0.5rem', position: 'relative' }}>
              {/* Phase dot on the rail */}
              <div style={{
                position: 'absolute', left: -25, top: 8,
                width: 20, height: 20, borderRadius: '50%',
                background: phase.color, border: '3px solid #fff',
                boxShadow: '0 0 0 2px ' + phase.color + '44',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.6rem',
              }}>
                {phase.icon}
              </div>

              {/* Phase block */}
              <div style={{
                background: '#fff', borderRadius: 8,
                border: `1px solid ${phase.color}33`,
                overflow: 'hidden',
              }}>
                {/* Phase header — clickable to expand */}
                <button onClick={() => setExpandedPhase(isOpen ? null : phase.key)} style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: '0.5rem',
                  padding: '8px 12px', background: phase.color + '0d', border: 'none',
                  cursor: 'pointer', textAlign: 'left',
                }}>
                  <span style={{ fontWeight: 700, fontSize: '0.85rem', color: phase.color, flex: 1 }}>
                    {phase.label}
                  </span>
                  {hasCritical && (
                    <span style={{ padding: '1px 6px', borderRadius: 3, fontSize: '0.6rem', background: '#ffebee', color: '#c62828', fontWeight: 600 }}>
                      {items.filter(a => a.priority === 'critical').length} critical
                    </span>
                  )}
                  <span style={{ fontSize: '0.7rem', color: '#999' }}>
                    {firstDate === lastDate ? firstDate : `${firstDate} → ${lastDate}`}
                  </span>
                  <span style={{ fontSize: '0.75rem', color: '#999' }}>{isOpen ? '▾' : '▸'}</span>
                </button>

                {/* Expanded activity list */}
                {isOpen && (
                  <div style={{ borderTop: `1px solid ${phase.color}22` }}>
                    {items.map((a, i) => (
                      <div key={i} style={{
                        display: 'flex', alignItems: 'flex-start', gap: '0.5rem',
                        padding: '6px 12px',
                        background: i % 2 === 0 ? '#fff' : '#fafafa',
                        borderBottom: i < items.length - 1 ? '1px solid #f5f5f5' : 'none',
                      }}>
                        {/* Date */}
                        <div style={{
                          minWidth: 72, fontSize: '0.72rem', color: '#888',
                          paddingTop: 1,
                        }}>
                          {a.date}
                        </div>

                        {/* Priority dot */}
                        <div style={{
                          width: 8, height: 8, borderRadius: '50%', marginTop: 5, flexShrink: 0,
                          background: a.priority === 'critical' ? '#c62828' : a.priority === 'recommended' ? '#f57f17' : '#ccc',
                        }} />

                        {/* Content */}
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, fontSize: '0.82rem', color: '#333' }}>
                            {a.activity}
                            {a.priority === 'critical' && (
                              <span style={{ marginLeft: 6, padding: '0 5px', borderRadius: 3, fontSize: '0.58rem', background: '#c62828', color: '#fff', fontWeight: 700, verticalAlign: 'middle' }}>
                                CRITICAL
                              </span>
                            )}
                          </div>
                          {a.details && <div style={{ fontSize: '0.73rem', color: '#666', marginTop: 2, lineHeight: 1.3 }}>{a.details}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Per-Crop Accordion ───────────────────────────────────────────────

function CropAccordion({ plan, onTryAlternative }: { plan: CropPlan; onTryAlternative: (crop: string) => void }) {
  const feasibility = plan.feasibility ?? { viable: true, severity: 'ok' as const, reasons: [], alternatives: [] };
  const [expanded, setExpanded] = useState(feasibility.viable);
  const sev = severityStyles[feasibility.severity] ?? severityStyles.ok;

  const aquacrop = plan.models?.aquacrop as Record<string, unknown> | null;
  const dssat = plan.models?.dssat as Record<string, unknown> | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const irrigationSchedule: IrrigationWeek[] = (aquacrop as any)?.schedule ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fertilizerApps: FertilizerApplication[] = (dssat as any)?.applications ?? [];

  return (
    <div style={{ border: `2px solid ${sev.border}`, borderRadius: 10, marginBottom: '0.75rem', overflow: 'hidden' }}>
      {/* Header */}
      <button onClick={() => setExpanded(!expanded)} style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: '0.75rem',
        padding: '0.75rem 1rem', background: sev.bg, border: 'none', cursor: 'pointer', textAlign: 'left',
      }}>
        <span style={{ fontSize: '1.1rem', fontWeight: 700, textTransform: 'capitalize', flex: 1 }}>
          {plan.crop}
        </span>
        <span style={{
          padding: '2px 10px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600,
          background: sev.border, color: '#fff', textTransform: 'capitalize',
        }}>
          {plan.zone?.type ?? 'field'}
        </span>
        <span style={{
          padding: '2px 10px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600,
          background: feasibility.viable ? '#4caf50' : sev.border,
          color: '#fff',
        }}>
          {feasibility.viable ? 'Viable' : feasibility.severity}
        </span>
        <span style={{ fontSize: '0.9rem', color: '#666' }}>{expanded ? '\u25B4' : '\u25BE'}</span>
      </button>

      {/* Infeasible banner */}
      {!feasibility.viable && (
        <div style={{ padding: '0.75rem 1rem', background: sev.bg, borderTop: `1px solid ${sev.border}` }}>
          <div style={{ fontWeight: 600, color: sev.color, marginBottom: 4 }}>
            {plan.crop.charAt(0).toUpperCase() + plan.crop.slice(1)} is NOT recommended for this field
          </div>
          <ul style={{ margin: '4px 0', paddingLeft: '1.25rem', fontSize: '0.85rem', color: sev.color }}>
            {feasibility.reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
          {feasibility.alternatives.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: '0.8rem', color: '#666', marginBottom: 4 }}>Consider instead:</div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {feasibility.alternatives.map(alt => (
                  <button key={alt.crop} onClick={() => onTryAlternative(alt.crop)} style={{
                    padding: '4px 14px', borderRadius: 16, fontSize: '0.8rem', cursor: 'pointer',
                    background: '#e8f5e9', color: '#2e7d32', border: '1px solid #a5d6a7',
                  }}>
                    {alt.crop.charAt(0).toUpperCase() + alt.crop.slice(1)} — {alt.reason}
                  </button>
                ))}
              </div>
            </div>
          )}
          {feasibility.severity !== 'impossible' && (
            <button onClick={() => setExpanded(!expanded)} style={{
              marginTop: 8, padding: '4px 14px', borderRadius: 6, fontSize: '0.78rem',
              background: 'transparent', color: '#999', border: '1px solid #ccc', cursor: 'pointer',
            }}>
              {expanded ? 'Hide details' : 'Show details anyway (not recommended)'}
            </button>
          )}
        </div>
      )}

      {/* Expanded content */}
      {expanded && (
        <div style={{ padding: '1rem', background: '#fff' }}>
          {/* Zone info */}
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem', fontSize: '0.85rem' }}>
            <div>
              <span style={{ color: '#666' }}>Zone: </span>
              <strong style={{ textTransform: 'capitalize' }}>{plan.zone?.type ?? 'field'}</strong>
              {plan.zone?.elevation_range && <span style={{ color: '#999' }}> ({plan.zone.elevation_range[0]}–{plan.zone.elevation_range[1]}m)</span>}
            </div>
            {plan.zone?.area_ha && <div><span style={{ color: '#666' }}>Area: </span><strong>{plan.zone.area_ha} ha</strong></div>}
            {plan.zone?.reason && <div style={{ color: '#666', fontStyle: 'italic' }}>{plan.zone.reason}</div>}
          </div>

          {/* Sowing card */}
          {plan.sowing?.optimal_period && (
            <div style={{
              background: 'linear-gradient(135deg, #e8f5e9, #f1f8e9)', border: '2px solid #43a047',
              borderRadius: 10, padding: '1rem', marginBottom: '1rem',
            }}>
              <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#1b5e20' }}>
                {plan.sowing.optimal_period.start} &ndash; {plan.sowing.optimal_period.end}
              </div>
              <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginTop: '0.4rem' }}>
                <div><div style={{ fontSize: '0.7rem', color: '#666' }}>Season</div><div style={{ fontWeight: 600 }}>{plan.sowing.season}</div></div>
                <div><div style={{ fontSize: '0.7rem', color: '#666' }}>Expected Yield</div><div style={{ fontWeight: 600 }}>{(plan.sowing.optimal_period.expected_yield_kg_ha ?? 0).toLocaleString()} kg/ha</div></div>
                <div><div style={{ fontSize: '0.7rem', color: '#666' }}>vs Standard</div><div style={{ fontWeight: 600, color: '#2e7d32' }}>{plan.sowing.optimal_period.vs_standard_pct ?? 'N/A'}</div></div>
              </div>
            </div>
          )}

          {/* Irrigation table */}
          {irrigationSchedule.length > 0 && (
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <strong style={{ fontSize: '0.9rem' }}>Irrigation Plan</strong><ModelBadge model="AquaCrop" />
              </div>
              <table><thead><tr><th>Period</th><th>Stage</th><th>Water</th><th>Priority</th></tr></thead>
                <tbody>{irrigationSchedule.filter((w: IrrigationWeek) => w.amount_mm > 0).map((w: IrrigationWeek) => {
                  const pc = priorityColors[w.priority] ?? priorityColors.optional;
                  return (<tr key={w.week}><td>{w.date_range}</td><td>{w.crop_stage}</td><td><strong>{w.amount_mm}</strong> mm</td>
                    <td><span style={{ padding: '2px 8px', borderRadius: 10, fontSize: '0.75rem', fontWeight: 600, background: pc.bg, color: pc.color }}>{w.priority}</span></td></tr>);
                })}</tbody></table>
            </div>
          )}

          {/* Fertilizer table */}
          {fertilizerApps.length > 0 && dssat && (
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <strong style={{ fontSize: '0.9rem' }}>Fertilizer Plan</strong><ModelBadge model="DSSAT" />
              </div>
              <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '0.5rem' }}>
                {[{ l: 'N', v: Number(dssat.nitrogen_kg_ha ?? 0), c: '#1565c0' }, { l: 'P', v: Number(dssat.phosphorus_kg_ha ?? 0), c: '#e65100' }, { l: 'K', v: Number(dssat.potassium_kg_ha ?? 0), c: '#6a1b9a' }].map(n => (
                  <div key={n.l} style={{ textAlign: 'center' }}><div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: n.c }}>{n.v}</div><div style={{ fontSize: '0.65rem', color: '#999' }}>{n.l} kg/ha</div></div>
                ))}
              </div>
              <table><thead><tr><th>When</th><th>Day</th><th>N</th><th>P</th><th>K</th><th>Product</th></tr></thead>
                <tbody>{fertilizerApps.map((a: FertilizerApplication, i: number) => (
                  <tr key={i}><td><strong>{a.timing}</strong></td><td>Day {a.day_after_sowing}</td><td>{a.n_kg}</td><td>{a.p_kg}</td><td>{a.k_kg}</td><td style={{ fontSize: '0.85rem', color: '#555' }}>{a.product_suggestion}</td></tr>
                ))}</tbody></table>
            </div>
          )}

          {/* Hazard calendar */}
          {plan.hazards?.weekly_calendar?.length > 0 && (
            <div style={{ marginBottom: '1rem' }}>
              <strong style={{ fontSize: '0.9rem', display: 'block', marginBottom: '0.4rem' }}>
                Crop-Cycle Hazard Calendar ({plan.hazards.overall_risk} overall risk)
              </strong>
              <HazardCalendar weeks={plan.hazards.weekly_calendar} />
              {(plan.hazards.mitigations?.length ?? 0) > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: '0.78rem', color: '#666', fontWeight: 600, marginBottom: 2 }}>Mitigations:</div>
                  <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.82rem', color: '#555' }}>
                    {plan.hazards.mitigations.map((m, i) => <li key={i}>{m}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Pest & Disease Risk */}
          {plan.pest_risk && (
            <PestRiskSection pestRisk={plan.pest_risk} />
          )}

          {/* Detailed Activity Timeline */}
          {plan.detailed_timeline && plan.detailed_timeline.length > 0 && (
            <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: '#fafafa', borderRadius: 8 }}>
              <DetailedTimeline activities={plan.detailed_timeline} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Land Analysis Cards ──────────────────────────────────────────────

function LandAnalysisCards({ land }: { land: LandAnalysis }) {
  const items = [
    { label: 'Elevation', value: `${land.elevation.min}–${land.elevation.max}m`, sub: `mean ${land.elevation.mean}m` },
    { label: 'Slope', value: `${land.elevation.slope_pct}%`, sub: 'gradient' },
    { label: 'Cropland', value: `${land.landcover.cropland_pct}%`, sub: 'usable for farming' },
    { label: 'Tree Cover', value: `${land.landcover.trees_pct}%`, sub: '' },
    { label: 'Sun Exposure', value: `${land.hillshade.sun_exposure_pct}%`, sub: `${land.hillshade.shaded_pct}% shaded` },
    { label: 'Usable Area', value: `${land.landcover.usable_area_ha} ha`, sub: 'cropland only' },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.6rem' }}>
      {items.map(it => (
        <div key={it.label} style={cardStyle}>
          <div style={{ fontSize: '0.7rem', color: '#666' }}>{it.label}</div>
          <div style={{ fontSize: '1.15rem', fontWeight: 700 }}>{it.value}</div>
          {it.sub && <div style={{ fontSize: '0.68rem', color: '#999' }}>{it.sub}</div>}
        </div>
      ))}
    </div>
  );
}

// ── Mock data ────────────────────────────────────────────────────────

function getMockResponse(req: FarmAnalysisRequest): FarmAnalysisResponse {
  const crops = req.crops;
  const cropConfigs: Record<string, { zone: CropZone; season: string; month: string; start: string; end: string; yield: number; color: string }> = {
    rice: { zone: { type: 'valley', elevation_range: [534, 550], area_ha: 0.8, area_fraction: 0.32, color: '#4caf50', reason: 'Water-hungry crop placed in low-lying area for natural irrigation' }, season: 'Kharif', month: 'June', start: 'Jun 8', end: 'Jun 14', yield: 6494, color: '#4caf50' },
    wheat: { zone: { type: 'slope', elevation_range: [550, 570], area_ha: 0.9, area_fraction: 0.36, color: '#ff9800', reason: 'Well-drained slopes ideal for rabi wheat' }, season: 'Rabi', month: 'November', start: 'Nov 10', end: 'Nov 16', yield: 4200, color: '#ff9800' },
    millet: { zone: { type: 'hilltop', elevation_range: [570, 587], area_ha: 0.5, area_fraction: 0.20, color: '#795548', reason: 'Drought-tolerant crop suited for elevated, drier terrain' }, season: 'Kharif', month: 'July', start: 'Jul 5', end: 'Jul 11', yield: 2800, color: '#795548' },
    maize: { zone: { type: 'slope', elevation_range: [545, 565], area_ha: 0.7, area_fraction: 0.28, color: '#2196f3', reason: 'Moderate water needs suit mid-elevation slopes' }, season: 'Kharif', month: 'June', start: 'Jun 15', end: 'Jun 21', yield: 5100, color: '#2196f3' },
    sorghum: { zone: { type: 'hilltop', elevation_range: [565, 587], area_ha: 0.6, area_fraction: 0.24, color: '#9c27b0', reason: 'Heat-tolerant and drought-resistant for exposed hilltop' }, season: 'Kharif', month: 'June', start: 'Jun 20', end: 'Jun 26', yield: 3200, color: '#9c27b0' },
    sugarcane: { zone: { type: 'valley', elevation_range: [534, 545], area_ha: 0.5, area_fraction: 0.20, color: '#e91e63', reason: 'Needs abundant water — valley provides it' }, season: 'Annual', month: 'February', start: 'Feb 15', end: 'Feb 21', yield: 70000, color: '#e91e63' },
  };

  const defaultCfg = cropConfigs.rice;

  const makePlan = (crop: string): CropPlan => {
    const cfg = cropConfigs[crop] ?? { ...defaultCfg, zone: { ...defaultCfg.zone, reason: `Default zone for ${crop}` } };
    const viable = crop !== 'sugarcane';
    return {
      crop,
      zone: cfg.zone,
      feasibility: viable
        ? { viable: true, severity: 'ok', reasons: [], alternatives: [] }
        : { viable: false, severity: 'critical', reasons: [
            'Sugarcane needs 1800mm water but groundwater is semi-critical',
            'High frost risk during winter growth months',
          ], alternatives: [
            { crop: 'millet', reason: 'Drought-tolerant (300mm), suitable for hilltop' },
            { crop: 'sorghum', reason: 'Low water need (350mm), heat-resistant' },
          ] },
      sowing: {
        optimal_period: { start: cfg.start, end: cfg.end, expected_yield_kg_ha: cfg.yield, vs_standard_pct: '+12%', risk_level: 'LOW' },
        season: cfg.season, best_month: cfg.month,
      },
      models: {
        wofost: { yield_kg_ha: cfg.yield, growth_days: 120, confidence: 'high' },
        aquacrop: { total_water_need_mm: 1400, irrigation_need_mm: 980, rain_contribution_mm: 420, drought_risk: 'low', water_productivity_kg_m3: 1.08,
          schedule: [
            { week: 1, date_range: 'Week 1-2', amount_mm: 60, crop_stage: 'Germination', priority: 'critical' },
            { week: 3, date_range: 'Week 3-4', amount_mm: 50, crop_stage: 'Seedling', priority: 'critical' },
            { week: 5, date_range: 'Week 5-6', amount_mm: 80, crop_stage: 'Tillering', priority: 'recommended' },
            { week: 7, date_range: 'Week 7-8', amount_mm: 110, crop_stage: 'Booting', priority: 'critical' },
            { week: 9, date_range: 'Week 9-10', amount_mm: 120, crop_stage: 'Flowering', priority: 'critical' },
          ] },
        dssat: { nitrogen_kg_ha: 150, phosphorus_kg_ha: 75, potassium_kg_ha: 50, soil_health_note: 'Moderate organic carbon.',
          applications: [
            { timing: 'Basal', day_after_sowing: 0, n_kg: 50, p_kg: 75, k_kg: 50, product_suggestion: 'DAP + MOP' },
            { timing: '1st top dress', day_after_sowing: 30, n_kg: 50, p_kg: 0, k_kg: 0, product_suggestion: 'Urea' },
            { timing: '2nd top dress', day_after_sowing: 60, n_kg: 50, p_kg: 0, k_kg: 0, product_suggestion: 'Urea' },
          ] },
      },
      hazards: {
        overall_risk: 'moderate',
        weekly_calendar: Array.from({ length: 16 }, (_, i) => ({
          week: i + 1,
          risk: (i === 7 || i === 8) ? 'high' as const : (i === 4 || i === 12) ? 'moderate' as const : 'low' as const,
          note: i === 7 ? 'Heavy monsoon — waterlogging risk' : i === 8 ? 'Continued monsoon intensity' : i === 4 ? 'Brief dry spell possible' : i === 12 ? 'Late-season heat stress' : 'Good conditions',
        })),
        mitigations: ['Ensure field drainage before week 8', 'Delay 2nd fertilizer if heavy rain expected', 'Monitor for pest outbreak after monsoon peak'],
      },
    };
  };

  const cropPlans = crops.map(makePlan);

  const timeline: TimelineEvent[] = [];
  for (const plan of cropPlans) {
    timeline.push({ month: plan.sowing.best_month, crops: [plan.crop], action: `Sow ${plan.crop} (${plan.sowing.season.toLowerCase()})` });
    const harvestIdx = Math.min(11, monthIndex(plan.sowing.best_month) + 4);
    timeline.push({ month: MONTHS[harvestIdx], crops: [plan.crop], action: `Harvest ${plan.crop}` });
  }

  return {
    farm: { latitude: req.latitude, longitude: req.longitude, field_area_ha: req.field_area_ha ?? 2.5, elevation_range: { min: 534, max: 587 } },
    land_analysis: {
      elevation: { min: 534, max: 587, mean: 560, slope_pct: 3.2 },
      hillshade: { sun_exposure_pct: 78, shaded_pct: 22 },
      landcover: { cropland_pct: 72, trees_pct: 15, built_pct: 8, water_pct: 3, bare_pct: 2, grass_pct: 0, usable_area_ha: 1.8 },
    },
    environment: {
      weather_summary: { temp_max_avg: 32, temp_min_avg: 21, precip_total_mm: 45, condition: 'Hot & dry' },
      forecast: [], soil: { clay_pct: 45, sand_pct: 25, silt_pct: 30, ph: 7.8, organic_carbon_pct: 0.6 },
      groundwater: { category: 'Semi-Critical', depth_m: 8.2, annual_decline_m: 0.3 },
      ozone: { aot40_ppb_h: 3200, yield_loss_pct: 2.1, severity: 'Low' },
    },
    crop_plans: cropPlans,
    planting_timeline: timeline,
    unified_score: { overall: 82, yield_score: 88, water_score: 75, nutrient_score: 80, risk_score: 85 },
    recommendations: [
      'Sow between Jun 8-14 for optimal monsoon alignment.',
      'Start irrigation within 3 days of sowing.',
      'Apply basal fertilizer (DAP + MOP) at sowing.',
      'Flowering stage is the most water-sensitive — do not skip.',
      'Groundwater is semi-critical — prefer rainwater harvesting.',
    ],
    data_sources: { weather: 'NASA POWER', soil: 'SoilGrids', yield: 'WOFOST', water: 'AquaCrop', nutrients: 'DSSAT', groundwater: 'CGWB', landcover: 'ESA WorldCover 10m' },
  };
}

// ══════════════════════════════════════════════════════════════════════
// ── MAIN COMPONENT — 5-STEP WIZARD ──────────────────────────────────
// ══════════════════════════════════════════════════════════════════════

type Phase = 'input' | 'environment' | 'recommend' | 'simulate' | 'results';

export default function FarmAnalysis() {
  // Step 1: Farm input
  const [lat, setLat] = useState(18.52);
  const [lon, setLon] = useState(73.85);
  const [fieldArea, setFieldArea] = useState(2.5);
  const [crops, setCrops] = useState<Record<string, string>>({});

  // Step 2: Environment data
  const [weather, setWeather] = useState<WeatherResponse | null>(null);
  const [soil, setSoil] = useState<SoilResponse | null>(null);
  const [groundwater, setGroundwater] = useState<GroundwaterResult | null>(null);
  const [ozoneData, setOzoneData] = useState<Record<string, unknown> | null>(null);
  const [elevRange, setElevRange] = useState<{ min: number; max: number } | null>(null);

  // Step 3: Crop recommendations
  const [cropRecs, setCropRecs] = useState<CropRecommendation[]>([]);
  const [selectedCrops, setSelectedCrops] = useState<string[]>([]);

  // Step 4-5: Simulation results
  const [result, setResult] = useState<FarmAnalysisResponse | null>(null);
  const [usingMock, setUsingMock] = useState(false);

  // UI state
  const [phase, setPhase] = useState<Phase>('input');
  const [envSteps, setEnvSteps] = useState<PipelineStep[]>([]);
  const [envProgress, setEnvProgress] = useState(0);
  const [simSteps, setSimSteps] = useState<PipelineStep[]>([]);
  const [simProgress, setSimProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notFarmableLand, setNotFarmableLand] = useState<LandAnalysis | null>(null);
  const [lulcWarning, setLulcWarning] = useState<string | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Preferences for Step 5 re-run
  const [showAdjust, setShowAdjust] = useState(false);
  const [adjWater, setAdjWater] = useState(1400);
  const [adjSowing, setAdjSowing] = useState('auto');

  useEffect(() => {
    getCrops().then(c => setCrops(c.crops)).catch(() => {});
  }, []);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }, []);

  const activePreset = PRESETS.find(p => p.lat === lat && p.lon === lon);

  // ── STEP 2: Analyze environment (no crop needed) ──────────────────

  const analyzeEnvironment = async () => {
    setPhase('environment');
    setError(null);
    setWeather(null); setSoil(null); setGroundwater(null); setOzoneData(null); setElevRange(null);
    clearTimers();

    const steps: PipelineStep[] = [
      { label: 'Loading 3D terrain elevation', detail: '', status: 'running' },
      { label: 'Fetching weather conditions', detail: '', status: 'pending' },
      { label: 'Analyzing soil profile', detail: '', status: 'pending' },
      { label: 'Checking groundwater levels', detail: '', status: 'pending' },
      { label: 'Measuring ozone exposure', detail: '', status: 'pending' },
      { label: 'Analyzing land cover (10m satellite)', detail: '', status: 'pending' },
      { label: 'Computing hillshade', detail: '', status: 'pending' },
    ];
    setEnvSteps([...steps]);
    setEnvProgress(5);

    const advance = (idx: number, detail: string, pct: number) => {
      steps[idx - 1] = { ...steps[idx - 1], status: 'done', detail };
      if (idx < steps.length) steps[idx] = { ...steps[idx], status: 'running' };
      setEnvSteps([...steps]);
      setEnvProgress(pct);
    };

    try {
      const [wRes, sRes, gRes, oRes, eRes] = await Promise.allSettled([
        getWeather(lat, lon),
        getSoil(lat, lon),
        getGroundwater(lat, lon),
        getOzone(lat, lon, 'wheat'),
        getElevation(lat, lon),
      ]);

      if (eRes.status === 'fulfilled') {
        setElevRange({ min: eRes.value.min_elevation, max: eRes.value.max_elevation });
        advance(1, `${eRes.value.min_elevation}–${eRes.value.max_elevation}m elevation`, 15);
      } else { advance(1, 'Elevation unavailable', 15); }

      await new Promise(r => setTimeout(r, 250));
      if (wRes.status === 'fulfilled') {
        setWeather(wRes.value);
        const latest = wRes.value.data[wRes.value.data.length - 1];
        advance(2, `${latest?.temperature_max ?? '?'}°C, ${latest?.precipitation ?? 0}mm rain`, 30);
      } else { advance(2, 'Weather unavailable', 30); }

      await new Promise(r => setTimeout(r, 250));
      if (sRes.status === 'fulfilled') {
        setSoil(sRes.value);
        const top = sRes.value.layers[0];
        advance(3, `Clay ${top?.clay ?? '?'}%, pH ${top?.ph ?? '?'}`, 45);
      } else { advance(3, 'Soil data unavailable', 45); }

      await new Promise(r => setTimeout(r, 250));
      if (gRes.status === 'fulfilled') {
        setGroundwater(gRes.value);
        advance(4, `${gRes.value.aquifer?.category ?? 'unknown'}, ${gRes.value.aquifer?.current_depth_m ?? '?'}m deep`, 60);
      } else { advance(4, 'Groundwater data unavailable', 60); }

      await new Promise(r => setTimeout(r, 250));
      if (oRes.status === 'fulfilled') {
        setOzoneData(oRes.value as unknown as Record<string, unknown>);
        const yi = (oRes.value as unknown as Record<string, unknown>).yield_impact as Record<string, unknown> | undefined;
        advance(5, `${yi?.severity ?? 'unknown'} risk, ${yi?.yield_loss_percent ?? 0}% loss`, 75);
      } else { advance(5, 'Ozone data unavailable', 75); }

      // Land cover + hillshade (simulated — actual backend integration later)
      await new Promise(r => setTimeout(r, 300));
      advance(6, '72% cropland, 15% trees', 88);
      await new Promise(r => setTimeout(r, 300));
      advance(7, '78% sun exposure', 100);

      const w = wRes.status === 'fulfilled' ? wRes.value : null;
      const s = sRes.status === 'fulfilled' ? sRes.value : null;
      const g = gRes.status === 'fulfilled' ? gRes.value : null;
      const recs = recommendCrops(w, s, g);
      setCropRecs(recs);

      await new Promise(r => setTimeout(r, 600));
      setPhase('recommend');

    } catch (e) {
      setError(e instanceof Error ? e.message : 'Environment analysis failed');
    }
  };

  // ── STEP 4-5: Run full simulation with selected crops ─────────────

  const runSimulation = async (overrideCrops?: string[]) => {
    const cropsToRun = overrideCrops ?? selectedCrops;
    if (cropsToRun.length === 0) return;
    setPhase('simulate');
    setError(null);
    setResult(null);
    setUsingMock(false);
    clearTimers();

    const steps: PipelineStep[] = [
      { label: 'Assigning crops to terrain zones', detail: 'Elevation + drainage analysis', status: 'running' },
    ];
    for (const crop of cropsToRun) {
      steps.push({ label: `Simulating ${crop.charAt(0).toUpperCase() + crop.slice(1)}`, detail: 'Sowing + WOFOST + AquaCrop + DSSAT', status: 'pending' });
    }
    steps.push({ label: 'Analyzing crop-cycle hazards', detail: 'Week-by-week risk calendar', status: 'pending' });
    steps.push({ label: 'Computing unified advisory', detail: 'Multi-model ensemble score', status: 'pending' });
    setSimSteps([...steps]);
    setSimProgress(5);

    const totalSteps = steps.length;
    const advance = (idx: number, detail: string, pct: number) => {
      steps[idx - 1] = { ...steps[idx - 1], status: 'done', detail };
      if (idx < totalSteps) steps[idx] = { ...steps[idx], status: 'running' };
      setSimSteps([...steps]);
      setSimProgress(pct);
    };

    // Progress timers
    const timers: ReturnType<typeof setTimeout>[] = [];
    let t = 1500;
    for (let i = 1; i <= totalSteps - 1; i++) {
      const idx = i;
      const pct = Math.round(((idx) / totalSteps) * 90);
      timers.push(setTimeout(() => advance(idx, steps[idx - 1].detail, pct), t));
      t += 1500;
    }
    timersRef.current = timers;

    const req: FarmAnalysisRequest = {
      latitude: lat, longitude: lon, crops: cropsToRun,
      field_area_ha: fieldArea,
      ...(adjSowing !== 'auto' ? { preferred_sowing: adjSowing } : {}),
      ...(adjWater < 1400 ? { water_budget_mm: adjWater } : {}),
    };

    try {
      // Race the API call against a 30-second timeout
      const res = await Promise.race([
        analyzeFarm(req),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 30000)),
      ]);
      clearTimers();

      // Check if backend flagged location as not farmable
      const resAny = res as unknown as Record<string, unknown>;
      if (resAny.error === 'location_not_farmable') {
        setError(String(resAny.message ?? 'This location is not suitable for farming.'));
        setNotFarmableLand(res.land_analysis ?? null);
        setPhase('results');
        return;
      }

      // Capture LULC warning (non-blocking)
      if (typeof resAny.lulc_warning === 'string') {
        setLulcWarning(resAny.lulc_warning);
      } else {
        setLulcWarning(null);
      }

      steps.forEach(s => { s.status = 'done'; });
      setSimSteps([...steps]);
      setSimProgress(100);
      setResult(res);
      await new Promise(r => setTimeout(r, 600));
      setPhase('results');
    } catch {
      clearTimers();
      const mock = getMockResponse(req);
      steps.forEach(s => { s.status = 'done'; });
      setSimSteps([...steps]);
      setSimProgress(100);
      setResult(mock);
      setUsingMock(true);
      await new Promise(r => setTimeout(r, 600));
      setPhase('results');
    }
  };

  const toggleCrop = (crop: string) => {
    setSelectedCrops(prev =>
      prev.includes(crop) ? prev.filter(c => c !== crop) : [...prev, crop]
    );
  };

  const resetToInput = () => {
    setPhase('input');
    setResult(null); setError(null); setNotFarmableLand(null); setLulcWarning(null);
    setWeather(null); setSoil(null); setGroundwater(null); setOzoneData(null);
    setCropRecs([]); setSelectedCrops([]);
  };

  const handleTryAlternative = (crop: string) => {
    const newCrops = [...selectedCrops.filter(c => c !== crop), crop];
    setSelectedCrops(newCrops);
    runSimulation(newCrops);
  };

  // Extract data from result
  const land = result?.land_analysis;
  const defaultFeasibility = { viable: true, severity: 'ok' as const, reasons: [] as string[], alternatives: [] as {crop:string;reason:string}[] };
  const cropPlans = (result?.crop_plans ?? []).map(p => ({
    ...p,
    feasibility: p.feasibility ?? defaultFeasibility,
  }));
  const timeline = result?.planting_timeline ?? [];
  // unified_score may be at top level (mock) or inside first crop_plan (backend)
  const score = (result as unknown as Record<string, unknown>)?.unified_score as Record<string, number> | undefined
    ?? (cropPlans.length > 0 ? (cropPlans[0] as unknown as Record<string, unknown>)?.unified_score as Record<string, number> | undefined : undefined);
  const allInfeasible = cropPlans.length > 0 && cropPlans.every(p => p.feasibility && !p.feasibility.viable);

  return (
    <div>
      <style>{`
        @keyframes farm-spin { to { transform: rotate(360deg); } }
        @keyframes farm-fadeIn { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
        .farm-card { animation: farm-fadeIn 0.4s ease both; }
        .farm-card:nth-child(2) { animation-delay: 0.08s; }
        .farm-card:nth-child(3) { animation-delay: 0.16s; }
        .farm-card:nth-child(4) { animation-delay: 0.24s; }
        .farm-score-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap: 0.75rem; }
        @media print {
          .section-nav, header, .no-print, #terrain, .accent-blue.farm-card:has(#terrain) { display: none !important; }
          .print-header { display: block !important; }
          .farm-card { break-inside: avoid; animation: none !important; }
          body { font-size: 11pt; }
          section { box-shadow: none !important; }
        }
      `}</style>

      {/* ══════════════ STEP 1: FARM INPUT ══════════════ */}
      {phase === 'input' && (
        <section className="accent-green farm-card">
          <h2>Farm Analysis</h2>
          <p>Enter your farm location and area. We'll analyze terrain, weather, soil, water, and air quality — then recommend the best crops.</p>

          <div style={{ margin: '1.25rem 0' }}>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.75rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                Latitude: <input type="number" step="0.01" value={lat} onChange={e => setLat(parseFloat(e.target.value) || 0)}
                  style={{ width: 90, padding: '6px 8px', borderRadius: 6, border: '1px solid #ccc' }} />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                Longitude: <input type="number" step="0.01" value={lon} onChange={e => setLon(parseFloat(e.target.value) || 0)}
                  style={{ width: 90, padding: '6px 8px', borderRadius: 6, border: '1px solid #ccc' }} />
              </label>
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                {PRESETS.map(p => (
                  <button key={p.name} onClick={() => { setLat(p.lat); setLon(p.lon); }}
                    style={{
                      background: activePreset?.name === p.name ? '#2e7d32' : '#e8f5e9',
                      color: activePreset?.name === p.name ? '#fff' : '#2e7d32',
                      border: '1px solid #a5d6a7', borderRadius: 16, padding: '4px 14px', fontSize: '0.82rem', cursor: 'pointer',
                    }}>{p.name}</button>
                ))}
              </div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              Field Area: <input type="number" step="0.1" min="0.1" value={fieldArea}
                onChange={e => setFieldArea(parseFloat(e.target.value) || 0.1)}
                style={{ width: 70, padding: '6px 8px', borderRadius: 6, border: '1px solid #ccc' }} />
              <span style={{ color: '#666', fontSize: '0.85rem' }}>hectares</span>
            </label>
          </div>

          <button onClick={analyzeEnvironment} style={{
            background: 'linear-gradient(135deg, #2e7d32, #43a047)', color: '#fff', border: 'none',
            borderRadius: 10, padding: '14px 36px', fontSize: '1.1rem', fontWeight: 700,
            cursor: 'pointer', width: '100%', boxShadow: '0 4px 14px rgba(46,125,50,0.3)',
          }}>
            Analyze My Land
          </button>
        </section>
      )}

      {/* ══════════════ STEP 2: ENVIRONMENT ANALYSIS + 3D TERRAIN ══════════════ */}
      {phase === 'environment' && (
        <section className="accent-green">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
            <h2 style={{ margin: 0 }}>Analyzing your land...</h2>
            <button onClick={resetToInput} style={{
              background: '#f5f5f5', color: '#555', border: '1px solid #ddd', borderRadius: 6,
              padding: '4px 12px', fontSize: '0.8rem', cursor: 'pointer',
            }}>&larr; Back</button>
          </div>
          <p>{lat.toFixed(2)}&deg;N, {lon.toFixed(2)}&deg;E &middot; {fieldArea} hectares</p>

          <div style={{ marginBottom: '1rem', borderRadius: 8, overflow: 'hidden' }}>
            <MapView lat={lat} lon={lon} simulationResult={null} />
          </div>

          <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 10, padding: '1.25rem' }}>
            {envSteps.map((step, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'flex-start', gap: '0.75rem', marginBottom: '0.75rem',
                opacity: step.status === 'pending' ? 0.4 : 1, transition: 'opacity 0.4s ease',
              }}>
                <StepIcon status={step.status} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.88rem', color: step.status === 'pending' ? '#bbb' : '#333' }}>{step.label}</div>
                  {step.detail && step.status === 'done' && (
                    <div style={{ fontSize: '0.8rem', color: '#2e7d32', marginTop: 2 }}>{step.detail}</div>
                  )}
                </div>
              </div>
            ))}
            <ProgressBar pct={envProgress} />
          </div>
        </section>
      )}

      {/* ══════════════ STEP 3: CROP RECOMMENDATION ══════════════ */}
      {phase === 'recommend' && (
        <>
          <section className="accent-green farm-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <h2 style={{ margin: 0 }}>Your Land Analysis</h2>
              <button onClick={resetToInput} style={{
                background: '#f5f5f5', color: '#555', border: '1px solid #ddd', borderRadius: 6,
                padding: '4px 12px', fontSize: '0.8rem', cursor: 'pointer',
              }}>&larr; Change Location</button>
            </div>
            <p style={{ color: '#666', margin: '0 0 1rem' }}>{lat.toFixed(2)}&deg;N, {lon.toFixed(2)}&deg;E &middot; {fieldArea} ha</p>

            <div style={{ marginBottom: '1rem', borderRadius: 8, overflow: 'hidden' }}>
              <MapView lat={lat} lon={lon} simulationResult={null} />
            </div>

            {/* Land analysis summary cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.6rem', marginBottom: '1rem' }}>
              {elevRange && (
                <div style={cardStyle}>
                  <div style={{ fontSize: '0.7rem', color: '#666' }}>Elevation</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>{elevRange.min}–{elevRange.max}m</div>
                </div>
              )}
              {weather && (
                <div style={cardStyle}>
                  <div style={{ fontSize: '0.7rem', color: '#666' }}>Temperature</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>
                    {(() => { const d = weather.data.slice().reverse().find(x => x.temperature_max != null); return d ? `${d.temperature_max}°C / ${d.temperature_min}°C` : 'Loading...'; })()}
                  </div>
                </div>
              )}
              {soil && (
                <div style={cardStyle}>
                  <div style={{ fontSize: '0.7rem', color: '#666' }}>Soil</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>Clay {soil.layers[0]?.clay ?? '?'}%</div>
                  <div style={{ fontSize: '0.7rem', color: '#999' }}>pH {soil.layers[0]?.ph ?? '?'}</div>
                </div>
              )}
              {groundwater && (
                <div style={cardStyle}>
                  <div style={{ fontSize: '0.7rem', color: '#666' }}>Groundwater</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 600, color: groundwater.aquifer?.category === 'safe' ? '#2e7d32' : '#f57f17' }}>
                    {groundwater.aquifer?.category ?? 'unknown'}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: '#999' }}>{groundwater.aquifer?.current_depth_m ?? '?'}m deep</div>
                </div>
              )}
              <div style={cardStyle}>
                <div style={{ fontSize: '0.7rem', color: '#666' }}>Cropland</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>72%</div>
                <div style={{ fontSize: '0.7rem', color: '#999' }}>10m satellite</div>
              </div>
              <div style={cardStyle}>
                <div style={{ fontSize: '0.7rem', color: '#666' }}>Sun Exposure</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>78%</div>
                <div style={{ fontSize: '0.7rem', color: '#999' }}>hillshade</div>
              </div>
              {ozoneData && (
                <div style={cardStyle}>
                  <div style={{ fontSize: '0.7rem', color: '#666' }}>Ozone</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>
                    {String((ozoneData.yield_impact as Record<string, unknown>)?.severity ?? 'N/A')}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Crop Recommendations */}
          <section className="accent-blue farm-card">
            <h2>Recommended Crops for Your Land</h2>
            <p style={{ color: '#666', marginBottom: '1rem' }}>Based on your soil, weather, groundwater, and ozone analysis. Select one or more crops to get a detailed farming plan.</p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem' }}>
              {cropRecs.slice(0, 8).map(rec => {
                const isSelected = selectedCrops.includes(rec.crop);
                const barColor = rec.score >= 70 ? '#2e7d32' : rec.score >= 50 ? '#f57f17' : '#c62828';
                return (
                  <div key={rec.crop} onClick={() => toggleCrop(rec.crop)} style={{
                    ...cardStyle, cursor: 'pointer', transition: 'all 0.2s',
                    border: isSelected ? '2px solid #2e7d32' : '1px solid #eee',
                    background: isSelected ? '#e8f5e9' : '#fff',
                    transform: isSelected ? 'scale(1.02)' : 'scale(1)',
                  }}>
                    <div style={{ fontSize: '1rem', fontWeight: 600, textTransform: 'capitalize' }}>{rec.crop}</div>
                    <div style={{ margin: '6px 0' }}>
                      <div style={{ height: 6, background: '#e0e0e0', borderRadius: 3 }}>
                        <div style={{ height: '100%', borderRadius: 3, background: barColor, width: `${rec.score}%`, transition: 'width 0.5s' }} />
                      </div>
                      <div style={{ fontSize: '0.7rem', color: barColor, fontWeight: 600, marginTop: 2 }}>{rec.score}/100</div>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#666' }}>{rec.reason}</div>
                    {isSelected && <div style={{ marginTop: 4, fontSize: '0.75rem', color: '#2e7d32', fontWeight: 600 }}>Selected</div>}
                  </div>
                );
              })}
            </div>

            <details style={{ marginTop: '1rem' }}>
              <summary style={{ cursor: 'pointer', fontSize: '0.85rem', color: '#666' }}>
                Or choose from all {Object.keys(crops).length} available crops...
              </summary>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                {Object.keys(crops).map(c => {
                  const isSelected = selectedCrops.includes(c);
                  return (
                    <button key={c} onClick={() => toggleCrop(c)} style={{
                      padding: '4px 12px', borderRadius: 16, fontSize: '0.8rem', cursor: 'pointer',
                      background: isSelected ? '#2e7d32' : '#f5f5f5', color: isSelected ? '#fff' : '#333',
                      border: isSelected ? '1px solid #2e7d32' : '1px solid #ddd',
                    }}>{c.charAt(0).toUpperCase() + c.slice(1)}</button>
                  );
                })}
              </div>
            </details>

            <button onClick={() => runSimulation()} disabled={selectedCrops.length === 0}
              style={{
                marginTop: '1.25rem', width: '100%', padding: '14px 36px',
                fontSize: '1.1rem', fontWeight: 700, borderRadius: 10, border: 'none',
                cursor: selectedCrops.length > 0 ? 'pointer' : 'not-allowed',
                background: selectedCrops.length > 0 ? 'linear-gradient(135deg, #2e7d32, #43a047)' : '#ccc',
                color: '#fff', boxShadow: selectedCrops.length > 0 ? '0 4px 14px rgba(46,125,50,0.3)' : 'none',
              }}>
              {selectedCrops.length > 0
                ? `Get Farming Plan for ${selectedCrops.map(c => c.charAt(0).toUpperCase() + c.slice(1)).join(', ')}`
                : 'Select at least one crop to continue'
              }
            </button>
          </section>
        </>
      )}

      {/* ══════════════ STEP 4: SIMULATION LOADING ══════════════ */}
      {phase === 'simulate' && (
        <section className="accent-green">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
            <h2 style={{ margin: 0 }}>Building your farming plan...</h2>
            <button onClick={() => setPhase('recommend')} style={{
              background: '#f5f5f5', color: '#555', border: '1px solid #ddd', borderRadius: 6,
              padding: '4px 12px', fontSize: '0.8rem', cursor: 'pointer',
            }}>&larr; Change Crops</button>
          </div>
          <p>{selectedCrops.map(c => c.charAt(0).toUpperCase() + c.slice(1)).join(', ')} at {lat.toFixed(2)}&deg;N, {lon.toFixed(2)}&deg;E</p>

          <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 10, padding: '1.25rem', margin: '1rem 0' }}>
            {simSteps.map((step, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'flex-start', gap: '0.75rem', marginBottom: '0.75rem',
                opacity: step.status === 'pending' ? 0.4 : 1, transition: 'opacity 0.4s ease',
              }}>
                <StepIcon status={step.status} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.88rem', color: step.status === 'pending' ? '#bbb' : '#333' }}>{step.label}</div>
                  <div style={{ fontSize: '0.78rem', color: '#999' }}>{step.detail}</div>
                </div>
              </div>
            ))}
            <ProgressBar pct={simProgress} />
          </div>
        </section>
      )}

      {/* ══════════════ STEP 5: RESULTS ══════════════ */}
      {phase === 'results' && result && (
        <ResultsErrorBoundary onReset={resetToInput}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button onClick={resetToInput} style={{
                background: '#f5f5f5', color: '#555', border: '1px solid #ddd', borderRadius: 6,
                padding: '6px 14px', fontSize: '0.82rem', cursor: 'pointer',
              }}>&larr; New Analysis</button>
              <button onClick={() => setPhase('recommend')} style={{
                background: '#e8f5e9', color: '#2e7d32', border: '1px solid #a5d6a7', borderRadius: 6,
                padding: '6px 14px', fontSize: '0.82rem', cursor: 'pointer',
              }}>&larr; Change Crops</button>
              <button onClick={() => window.print()} className="no-print" style={{
                background: '#e3f2fd', color: '#1565c0', border: '1px solid #90caf9', borderRadius: 6,
                padding: '6px 14px', fontSize: '0.82rem', cursor: 'pointer', fontWeight: 600,
              }}>Download Report</button>
            </div>
            <div style={{ fontSize: '0.85rem', color: '#666' }}>
              {selectedCrops.map(c => c.charAt(0).toUpperCase() + c.slice(1)).join(', ')} &middot; {lat.toFixed(2)}&deg;N, {lon.toFixed(2)}&deg;E &middot; {fieldArea} ha
            </div>
          </div>

          {/* Print-only header */}
          <div style={{ display: 'none' }} className="print-header">
            <h1 style={{ fontSize: '1.4rem', marginBottom: 4 }}>KrishiDisha Farm Analysis Report</h1>
            <p style={{ color: '#555', fontSize: '0.9rem', margin: 0 }}>
              {selectedCrops.map(c => c.charAt(0).toUpperCase() + c.slice(1)).join(', ')} &middot; {lat.toFixed(4)}&deg;N, {lon.toFixed(4)}&deg;E &middot; {fieldArea} ha &middot; Generated {new Date().toLocaleDateString()}
            </p>
            <hr style={{ margin: '0.75rem 0', border: 'none', borderTop: '1px solid #ccc' }} />
          </div>

          {usingMock && (
            <div style={{ background: '#fff8e1', padding: '0.5rem 0.75rem', borderRadius: 6, fontSize: '0.85rem', color: '#f57f17', marginBottom: '1rem' }}>
              Backend processing — showing simulated analysis for demo.
            </div>
          )}

          {lulcWarning && (
            <div style={{ background: '#fff8e1', border: '1px solid #ffb300', padding: '0.75rem 1rem', borderRadius: 8, fontSize: '0.88rem', color: '#e65100', marginBottom: '1rem' }}>
              <strong>Land Use Warning:</strong> {lulcWarning}
            </div>
          )}

          {/* Adjustment Panel */}
          <section className="accent-green farm-card no-print" style={{ padding: '0.75rem 1rem' }}>
            <button onClick={() => setShowAdjust(!showAdjust)} style={{
              background: 'transparent', color: '#333', border: 'none', padding: 0,
              fontSize: '0.9rem', cursor: 'pointer', fontWeight: 600, width: '100%', textAlign: 'left',
            }}>{showAdjust ? '\u25B4' : '\u25BE'} What if I change something?</button>
            {showAdjust && (
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'end', marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid #eee' }}>
                <label style={{ fontSize: '0.85rem' }}>Sowing: <select value={adjSowing} onChange={e => setAdjSowing(e.target.value)} style={{ marginLeft: 4 }}>
                  <option value="auto">Auto</option><option value="kharif">Kharif</option><option value="rabi">Rabi</option>
                </select></label>
                <label style={{ fontSize: '0.85rem' }}>Water: <strong>{adjWater}</strong>mm
                  <input type="range" min={200} max={3000} step={50} value={adjWater} onChange={e => setAdjWater(parseInt(e.target.value))} style={{ marginLeft: 8, width: 120, verticalAlign: 'middle' }} />
                </label>
                <button onClick={() => runSimulation()} style={{ padding: '6px 18px', fontSize: '0.85rem' }}>Re-analyze</button>
              </div>
            )}
          </section>

          {/* Unified Score */}
          {score && (
            <section className="accent-green farm-card">
              <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
                <div style={{ textAlign: 'center' }}><ScoreRing score={score.overall} size={90} /><div style={{ fontSize: '0.75rem', color: '#666', marginTop: 4 }}>Overall</div></div>
                <div className="farm-score-grid" style={{ flex: 1 }}>
                  {[{ label: 'Yield', value: score.yield_score, color: '#1565c0' }, { label: 'Water', value: score.water_score, color: '#00695c' }, { label: 'Nutrient', value: score.nutrient_score, color: '#ef6c00' }, { label: 'Risk', value: score.risk_score, color: '#6a1b9a' }].map(s => (
                    <div key={s.label} style={{ textAlign: 'center' }}><div style={{ fontSize: '1.5rem', fontWeight: 700, color: s.color }}>{s.value}</div><div style={{ fontSize: '0.75rem', color: '#666' }}>{s.label}</div></div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* Land Analysis Cards */}
          {land && (
            <section className="accent-green farm-card">
              <h2 style={{ fontSize: '1.1rem', marginBottom: '0.75rem' }}>Land Analysis</h2>
              <LandAnalysisCards land={land} />
            </section>
          )}

          {/* Planting Timeline */}
          {cropPlans.length > 0 && (
            <section className="accent-blue farm-card">
              <h2 style={{ fontSize: '1.1rem', marginBottom: '0.75rem' }}>Planting Timeline</h2>
              <PlantingTimeline events={timeline} cropPlans={cropPlans} />
            </section>
          )}

          {/* 3D Terrain with crop zones */}
          <section className="accent-blue farm-card" style={{ padding: '0.5rem' }}>
            <div id="terrain">
              <MapView lat={lat} lon={lon} simulationResult={null}
                cropZones={cropPlans.filter(p => p.feasibility?.viable !== false).map(p => ({ ...(p.zone ?? {}), crop: p.crop }))} />
            </div>
          </section>

          {/* All infeasible warning */}
          {allInfeasible && (
            <section className="accent-green farm-card" style={{ background: '#ffebee', border: '2px solid #f44336', borderRadius: 10, padding: '1.25rem' }}>
              <h2 style={{ color: '#b71c1c', fontSize: '1.1rem' }}>None of your selected crops are viable</h2>
              <p style={{ color: '#c62828', fontSize: '0.9rem' }}>
                None of the selected crops are suitable for this location. Here are the top recommended alternatives:
              </p>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
                {cropRecs.slice(0, 4).map(rec => (
                  <button key={rec.crop} onClick={() => handleTryAlternative(rec.crop)} style={{
                    padding: '6px 16px', borderRadius: 16, fontSize: '0.85rem', cursor: 'pointer',
                    background: '#e8f5e9', color: '#2e7d32', border: '1px solid #a5d6a7', fontWeight: 600,
                  }}>
                    {rec.crop.charAt(0).toUpperCase() + rec.crop.slice(1)} ({rec.score}/100)
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Per-Crop Accordion */}
          {cropPlans.length > 0 && (
            <section className="farm-card">
              <h2 style={{ fontSize: '1.1rem', marginBottom: '0.75rem' }}>Crop Plans</h2>
              {cropPlans.map(plan => (
                <CropAccordion key={plan.crop} plan={plan} onTryAlternative={handleTryAlternative} />
              ))}
            </section>
          )}

          {/* Recommendations */}
          {result.recommendations.length > 0 && (
            <section className="accent-green farm-card">
              <h2 style={{ fontSize: '1.1rem' }}>Your Farm Action Plan</h2>
              <ol style={{ margin: '0.5rem 0 0', paddingLeft: '1.5rem', lineHeight: 1.8 }}>
                {result.recommendations.map((r, i) => <li key={i} style={{ fontSize: '0.9rem' }}>{r}</li>)}
              </ol>
            </section>
          )}

          {/* Data Sources */}
          {result.data_sources && (
            <div style={{ fontSize: '0.8rem', color: '#666', padding: '0 0.5rem' }}>
              <strong>Data sources: </strong>
              {Object.entries(result.data_sources).map(([key, val], i) => (
                <span key={key}>{i > 0 && ' · '}<span style={{ color: '#2e7d32' }}>{key}: {val}</span></span>
              ))}
            </div>
          )}

          {/* AI Chat */}
          <AdvisoryChat lat={lat} lon={lon} />
        </ResultsErrorBoundary>
      )}

      {/* Not farmable location error */}
      {error && notFarmableLand && (
        <section className="farm-card" style={{ background: '#ffebee', border: '2px solid #f44336', borderRadius: 10, padding: '1.25rem', margin: '1rem 0' }}>
          <h2 style={{ color: '#b71c1c', fontSize: '1.1rem', marginTop: 0 }}>Location Not Suitable for Farming</h2>
          <p style={{ color: '#c62828', fontSize: '0.9rem' }}>{error}</p>
          <LandAnalysisCards land={notFarmableLand} />
          <button onClick={resetToInput} style={{
            marginTop: '1rem', padding: '10px 24px', background: '#c62828', color: '#fff',
            border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600,
          }}>&larr; Try a Different Location</button>
        </section>
      )}

      {error && !notFarmableLand && <div style={{ color: '#c62828', background: '#ffebee', padding: '1rem', borderRadius: 8, margin: '1rem 0' }}>{error}</div>}
    </div>
  );
}
