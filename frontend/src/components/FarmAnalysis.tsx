import { useState, useEffect, useRef, useCallback } from 'react';
import {
  getCrops, analyzeFarm,
  type FarmAnalysisRequest, type FarmAnalysisResponse,
  type IrrigationWeek, type FertilizerApplication,
} from '../services/api';
import MapView from './MapView';
import AdvisoryChat from './AdvisoryChat';

// ── Location presets ─────────────────────────────────────────────────

interface LocationPreset {
  name: string;
  lat: number;
  lon: number;
}

const PRESETS: LocationPreset[] = [
  { name: 'Pune', lat: 18.52, lon: 73.85 },
  { name: 'Delhi', lat: 28.61, lon: 77.23 },
  { name: 'Jaipur', lat: 26.91, lon: 75.78 },
  { name: 'Nagpur', lat: 21.15, lon: 79.09 },
];

// ── Styling helpers ──────────────────────────────────────────────────

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

// ── Pipeline animation helpers ───────────────────────────────────────

type StepStatus = 'pending' | 'running' | 'done' | 'error';

interface PipelineStep {
  label: string;
  detail: string;
  status: StepStatus;
}

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

const errorCircle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 22, height: 22, borderRadius: '50%', background: '#c62828',
  color: '#fff', fontSize: '0.8rem', fontWeight: 700, flexShrink: 0,
};

function StepIcon({ status }: { status: StepStatus }) {
  if (status === 'done') return <span style={checkCircle}>&#10003;</span>;
  if (status === 'running') return <span style={spinnerStyle} />;
  if (status === 'error') return <span style={errorCircle}>!</span>;
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
        strokeDasharray={`${(pct / 100) * c} ${c}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dasharray 0.8s ease' }}
      />
      <text x="50%" y="50%" textAnchor="middle" dy="0.35em"
        style={{ fontSize: size * 0.28, fontWeight: 700, fill: color }}>
        {pct}
      </text>
    </svg>
  );
}

// ── Mock data ────────────────────────────────────────────────────────

function getMockResponse(req: FarmAnalysisRequest): FarmAnalysisResponse {
  return {
    farm: {
      latitude: req.latitude, longitude: req.longitude,
      field_area_ha: req.field_area_ha ?? 2.5,
      elevation_range: { min: 534, max: 587 },
    },
    environment: {
      weather_summary: { temp_max_avg: 32, temp_min_avg: 21, precip_total_mm: 45, condition: 'Hot & dry' },
      forecast: [],
      soil: { clay_pct: 45, sand_pct: 25, silt_pct: 30, ph: 7.8, organic_carbon_pct: 0.6 },
      groundwater: { category: 'Semi-Critical', depth_m: 8.2, annual_decline_m: 0.3 },
      ozone: { aot40_ppb_h: 3200, yield_loss_pct: 2.1, severity: 'Low' },
    },
    sowing: {
      optimal_period: { start: 'Jun 8', end: 'Jun 14', expected_yield_kg_ha: 6494, vs_standard_pct: '+12%', risk_level: 'LOW' },
      season: 'Kharif',
      best_month: 'June',
      best_week: 'Jun 8-14',
    },
    models: {
      wofost: { yield_kg_ha: 6494, growth_days: 120, confidence: 'high' },
      aquacrop: {
        total_water_need_mm: 1400, irrigation_need_mm: 980, rain_contribution_mm: 420,
        drought_risk: 'low', water_productivity_kg_m3: 1.08,
        schedule: [
          { week: 1, date_range: 'Week 1-2', amount_mm: 60, crop_stage: 'Germination', priority: 'critical' },
          { week: 3, date_range: 'Week 3-4', amount_mm: 50, crop_stage: 'Seedling', priority: 'critical' },
          { week: 5, date_range: 'Week 5-6', amount_mm: 80, crop_stage: 'Tillering', priority: 'recommended' },
          { week: 7, date_range: 'Week 7-8', amount_mm: 110, crop_stage: 'Booting', priority: 'critical' },
          { week: 9, date_range: 'Week 9-10', amount_mm: 120, crop_stage: 'Flowering', priority: 'critical' },
          { week: 11, date_range: 'Week 11-12', amount_mm: 90, crop_stage: 'Grain filling', priority: 'recommended' },
          { week: 13, date_range: 'Week 13-14', amount_mm: 50, crop_stage: 'Ripening', priority: 'optional' },
        ],
      },
      dssat: {
        nitrogen_kg_ha: 150, phosphorus_kg_ha: 75, potassium_kg_ha: 50,
        soil_health_note: 'Moderate organic carbon. Apply farmyard manure (5 t/ha) before sowing.',
        applications: [
          { timing: 'Basal (at sowing)', day_after_sowing: 0, n_kg: 50, p_kg: 75, k_kg: 50, product_suggestion: 'DAP (18:46:0) + MOP (0:0:60)' },
          { timing: 'First top dress', day_after_sowing: 30, n_kg: 50, p_kg: 0, k_kg: 0, product_suggestion: 'Urea (46:0:0)' },
          { timing: 'Second top dress', day_after_sowing: 60, n_kg: 50, p_kg: 0, k_kg: 0, product_suggestion: 'Urea (46:0:0)' },
        ],
      },
    },
    unified_score: { overall: 82, yield_score: 88, water_score: 75, nutrient_score: 80, risk_score: 85 },
    recommendations: [
      'Sow between Jun 8-14 for optimal monsoon alignment and +12% yield vs standard timing.',
      'Start irrigation within 3 days of sowing — pre-monsoon soil moisture is below field capacity.',
      'Apply basal fertilizer (DAP + MOP) at sowing for strong root establishment.',
      'Flowering stage (week 9-10) is the most water-sensitive — do not skip irrigation.',
      'Split nitrogen into 3 doses to reduce leaching and improve uptake efficiency.',
      'Groundwater is semi-critical — prefer rainwater harvesting and deficit irrigation strategies.',
    ],
    data_sources: {
      weather: 'NASA POWER + Open-Meteo',
      soil: 'SoilGrids + ICAR',
      yield: 'WOFOST crop model',
      water: 'AquaCrop (FAO)',
      nutrients: 'DSSAT',
      groundwater: 'CGWB + GRACE-FO',
      ozone: 'CAMS reanalysis',
    },
  };
}

// ── Main component ───────────────────────────────────────────────────

type Phase = 'setup' | 'loading' | 'results';

export default function FarmAnalysis() {
  // Form state
  const [lat, setLat] = useState(18.52);
  const [lon, setLon] = useState(73.85);
  const [fieldArea, setFieldArea] = useState(2.5);
  const [selectedCrop, setSelectedCrop] = useState('rice');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [preferredSowing, setPreferredSowing] = useState('auto');
  const [waterBudget, setWaterBudget] = useState('');
  const [crops, setCrops] = useState<Record<string, string>>({});

  // Analysis state
  const [phase, setPhase] = useState<Phase>('setup');
  const [result, setResult] = useState<FarmAnalysisResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [usingMock, setUsingMock] = useState(false);

  // Pipeline steps
  const [steps, setSteps] = useState<PipelineStep[]>([]);
  const [progress, setProgress] = useState(0);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Adjustment panel
  const [showAdjust, setShowAdjust] = useState(false);
  const [adjWaterBudget, setAdjWaterBudget] = useState(1400);
  const [adjSowing, setAdjSowing] = useState('auto');

  useEffect(() => {
    getCrops().then((c) => setCrops(c.crops)).catch(() => {});
  }, []);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }, []);

  const selectPreset = (p: LocationPreset) => {
    setLat(p.lat);
    setLon(p.lon);
  };

  const activePreset = PRESETS.find(p => p.lat === lat && p.lon === lon);

  const runAnalysis = async (overrides?: Partial<FarmAnalysisRequest>) => {
    setPhase('loading');
    setError(null);
    setResult(null);
    setUsingMock(false);
    clearTimers();

    // Pipeline animation
    const initSteps: PipelineStep[] = [
      { label: 'Fetching terrain data', detail: '', status: 'running' },
      { label: 'Loading weather conditions', detail: '', status: 'pending' },
      { label: 'Analyzing soil profile', detail: '', status: 'pending' },
      { label: 'Checking groundwater levels', detail: '', status: 'pending' },
      { label: 'Measuring ozone exposure', detail: '', status: 'pending' },
      { label: 'Finding best sowing period', detail: '', status: 'pending' },
      { label: 'Running crop simulations', detail: 'WOFOST + AquaCrop + DSSAT', status: 'pending' },
    ];
    setSteps([...initSteps]);
    setProgress(5);

    const advance = (idx: number, _detail: string, pct: number) => {
      initSteps[idx - 1] = { ...initSteps[idx - 1], status: 'done', detail: initSteps[idx - 1].detail || 'Done' };
      if (idx < initSteps.length) {
        initSteps[idx] = { ...initSteps[idx], status: 'running' };
      }
      setSteps([...initSteps]);
      setProgress(pct);
    };

    const t1 = setTimeout(() => advance(1, '', 18), 500);
    const t2 = setTimeout(() => advance(2, '', 32), 1000);
    const t3 = setTimeout(() => advance(3, '', 45), 1500);
    const t4 = setTimeout(() => advance(4, '', 58), 2000);
    const t5 = setTimeout(() => advance(5, '', 70), 2500);
    const t6 = setTimeout(() => advance(6, '', 82), 3000);
    timersRef.current = [t1, t2, t3, t4, t5, t6];

    const req: FarmAnalysisRequest = {
      latitude: overrides?.latitude ?? lat,
      longitude: overrides?.longitude ?? lon,
      crop: overrides?.crop ?? selectedCrop,
      field_area_ha: overrides?.field_area_ha ?? fieldArea,
      ...(preferredSowing !== 'auto' ? { preferred_sowing: overrides?.preferred_sowing ?? preferredSowing } : {}),
      ...(waterBudget ? { water_budget_mm: overrides?.water_budget_mm ?? parseFloat(waterBudget) } : {}),
    };

    try {
      const res = await analyzeFarm(req);
      clearTimers();
      // All done
      const doneSteps = initSteps.map(s => ({ ...s, status: 'done' as StepStatus, detail: s.detail || 'Done' }));
      setSteps(doneSteps);
      setProgress(100);
      setResult(res);
      setTimeout(() => setPhase('results'), 600);
    } catch {
      // Use mock fallback
      clearTimers();
      const mockRes = getMockResponse(req);
      const doneSteps = initSteps.map(s => ({ ...s, status: 'done' as StepStatus, detail: s.detail || 'Done' }));
      setSteps(doneSteps);
      setProgress(100);
      setResult(mockRes);
      setUsingMock(true);
      setTimeout(() => setPhase('results'), 600);
    }
  };

  const handleReAnalyze = () => {
    runAnalysis({
      preferred_sowing: adjSowing !== 'auto' ? adjSowing : undefined,
      water_budget_mm: adjWaterBudget,
    });
  };

  const resetToSetup = () => {
    setPhase('setup');
    setResult(null);
    setSteps([]);
    setProgress(0);
    setError(null);
  };

  // Extract model data with safe typing
  const wofost = result?.models?.wofost as Record<string, unknown> | null;
  const aquacrop = result?.models?.aquacrop as Record<string, unknown> | null;
  const dssat = result?.models?.dssat as Record<string, unknown> | null;
  const env = result?.environment;
  const sowing = result?.sowing;
  const score = result?.unified_score;

  // AquaCrop schedule — safe cast from Record<string, unknown>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const irrigationSchedule: IrrigationWeek[] = (aquacrop as any)?.schedule ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fertilizerApps: FertilizerApplication[] = (dssat as any)?.applications ?? [];

  return (
    <div>
      <style>{`
        @keyframes farm-spin { to { transform: rotate(360deg); } }
        @keyframes farm-fadeIn { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
        .farm-card { animation: farm-fadeIn 0.4s ease both; }
        .farm-card:nth-child(2) { animation-delay: 0.08s; }
        .farm-card:nth-child(3) { animation-delay: 0.16s; }
        .farm-card:nth-child(4) { animation-delay: 0.24s; }
        .farm-card:nth-child(5) { animation-delay: 0.32s; }
        .farm-card:nth-child(6) { animation-delay: 0.40s; }
        .farm-score-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap: 0.75rem; }
      `}</style>

      {/* ─── STEP 1: Farm Setup Form ─── */}
      {phase === 'setup' && (
        <section className="accent-green farm-card">
          <h2>Farm Analysis</h2>
          <p>Set up your farm parameters for a comprehensive multi-model analysis</p>

          {/* Location */}
          <div style={{ margin: '1.25rem 0' }}>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.75rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                Latitude:
                <input type="number" step="0.01" value={lat}
                  onChange={e => setLat(parseFloat(e.target.value) || 0)}
                  style={{ width: 90, padding: '6px 8px', borderRadius: 6, border: '1px solid #ccc', fontSize: '0.9rem' }}
                />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                Longitude:
                <input type="number" step="0.01" value={lon}
                  onChange={e => setLon(parseFloat(e.target.value) || 0)}
                  style={{ width: 90, padding: '6px 8px', borderRadius: 6, border: '1px solid #ccc', fontSize: '0.9rem' }}
                />
              </label>
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                {PRESETS.map(p => (
                  <button key={p.name} onClick={() => selectPreset(p)}
                    style={{
                      background: activePreset?.name === p.name ? '#2e7d32' : '#e8f5e9',
                      color: activePreset?.name === p.name ? '#fff' : '#2e7d32',
                      border: '1px solid #a5d6a7', borderRadius: 16,
                      padding: '4px 14px', fontSize: '0.82rem', cursor: 'pointer',
                    }}>
                    {p.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Field area & crop */}
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                Field Area:
                <input type="number" step="0.1" min="0.1" value={fieldArea}
                  onChange={e => setFieldArea(parseFloat(e.target.value) || 0.1)}
                  style={{ width: 70, padding: '6px 8px', borderRadius: 6, border: '1px solid #ccc', fontSize: '0.9rem' }}
                />
                <span style={{ color: '#666', fontSize: '0.85rem' }}>hectares</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                Crop:
                <select value={selectedCrop} onChange={e => setSelectedCrop(e.target.value)}>
                  {Object.keys(crops).length > 0
                    ? Object.keys(crops).map(c => (
                        <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                      ))
                    : ['rice', 'wheat', 'maize', 'soybean', 'cotton'].map(c => (
                        <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                      ))
                  }
                </select>
              </label>
            </div>
          </div>

          {/* Advanced */}
          <div style={{ marginBottom: '1.25rem' }}>
            <button onClick={() => setShowAdvanced(!showAdvanced)}
              style={{
                background: 'transparent', color: '#555', border: 'none',
                padding: '4px 0', fontSize: '0.85rem', cursor: 'pointer', fontWeight: 500,
              }}>
              {showAdvanced ? 'Advanced \u25B4' : 'Advanced \u25BE'}
            </button>
            {showAdvanced && (
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginTop: '0.5rem', padding: '0.75rem', background: '#f9fafb', borderRadius: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  Preferred sowing:
                  <select value={preferredSowing} onChange={e => setPreferredSowing(e.target.value)}>
                    <option value="auto">Auto (optimize)</option>
                    <option value="kharif">Kharif (Jun-Jul)</option>
                    <option value="rabi">Rabi (Oct-Nov)</option>
                    <option value="zaid">Zaid (Mar-Apr)</option>
                  </select>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  Water budget:
                  <input type="number" step="50" placeholder="mm (optional)" value={waterBudget}
                    onChange={e => setWaterBudget(e.target.value)}
                    style={{ width: 120, padding: '6px 8px', borderRadius: 6, border: '1px solid #ccc', fontSize: '0.9rem' }}
                  />
                  <span style={{ color: '#666', fontSize: '0.85rem' }}>mm</span>
                </label>
              </div>
            )}
          </div>

          {/* Big green button */}
          <button onClick={() => runAnalysis()}
            style={{
              background: 'linear-gradient(135deg, #2e7d32, #43a047)',
              color: '#fff', border: 'none', borderRadius: 10,
              padding: '14px 36px', fontSize: '1.1rem', fontWeight: 700,
              cursor: 'pointer', width: '100%', letterSpacing: '0.3px',
              boxShadow: '0 4px 14px rgba(46,125,50,0.3)',
            }}>
            Analyze My Farm
          </button>
        </section>
      )}

      {/* ─── STEP 2: Progressive Loading ─── */}
      {phase === 'loading' && (
        <section className="accent-green">
          <h2>Analyzing your farm...</h2>
          <p>{lat.toFixed(2)}&deg;N, {lon.toFixed(2)}&deg;E &middot; {selectedCrop.charAt(0).toUpperCase() + selectedCrop.slice(1)} &middot; {fieldArea} ha</p>

          <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 10, padding: '1.25rem', margin: '1rem 0' }}>
            {steps.map((step, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
                marginBottom: '0.75rem', minHeight: 28,
                opacity: step.status === 'pending' ? 0.4 : 1,
                transition: 'opacity 0.4s ease',
              }}>
                <StepIcon status={step.status} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.88rem', color: step.status === 'pending' ? '#bbb' : '#333' }}>
                    {step.label}
                  </div>
                  {step.detail && step.status !== 'pending' && (
                    <div style={{ fontSize: '0.8rem', color: '#666', marginTop: 2 }}>{step.detail}</div>
                  )}
                </div>
              </div>
            ))}
            <ProgressBar pct={progress} />
            <div style={{ fontSize: '0.75rem', color: '#999', marginTop: 4, textAlign: 'right' }}>{progress}%</div>
          </div>
        </section>
      )}

      {/* ─── STEP 3: Results Dashboard ─── */}
      {phase === 'results' && result && (
        <>
          {/* Back + Adjust header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <button onClick={resetToSetup}
              style={{
                background: '#f5f5f5', color: '#555', border: '1px solid #ddd',
                borderRadius: 6, padding: '6px 14px', fontSize: '0.82rem', cursor: 'pointer',
              }}>
              &larr; New Analysis
            </button>
            <div style={{ fontSize: '0.85rem', color: '#666' }}>
              {lat.toFixed(2)}&deg;N, {lon.toFixed(2)}&deg;E &middot; {selectedCrop.charAt(0).toUpperCase() + selectedCrop.slice(1)} &middot; {fieldArea} ha
            </div>
          </div>

          {usingMock && (
            <div style={{
              background: '#fff8e1', padding: '0.5rem 0.75rem', borderRadius: 6,
              fontSize: '0.85rem', color: '#f57f17', marginBottom: '1rem',
            }}>
              Unified endpoint coming soon — showing simulated analysis for demo.
            </div>
          )}

          {/* Adjustment Panel */}
          <section className="accent-green farm-card" style={{ padding: '0.75rem 1rem' }}>
            <button onClick={() => setShowAdjust(!showAdjust)}
              style={{
                background: 'transparent', color: '#333', border: 'none',
                padding: 0, fontSize: '0.9rem', cursor: 'pointer', fontWeight: 600, width: '100%', textAlign: 'left',
              }}>
              {showAdjust ? '\u25B4' : '\u25BE'} What if I change something?
            </button>
            {showAdjust && (
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'end', marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid #eee' }}>
                <label style={{ fontSize: '0.85rem' }}>
                  Sowing override:
                  <select value={adjSowing} onChange={e => setAdjSowing(e.target.value)} style={{ marginLeft: 6 }}>
                    <option value="auto">Auto</option>
                    <option value="kharif">Kharif</option>
                    <option value="rabi">Rabi</option>
                    <option value="zaid">Zaid</option>
                  </select>
                </label>
                <label style={{ fontSize: '0.85rem' }}>
                  Water budget: <strong>{adjWaterBudget}</strong> mm
                  <input type="range" min={200} max={3000} step={50} value={adjWaterBudget}
                    onChange={e => setAdjWaterBudget(parseInt(e.target.value))}
                    style={{ marginLeft: 8, width: 150, verticalAlign: 'middle' }}
                  />
                </label>
                <button onClick={handleReAnalyze}
                  style={{ padding: '6px 18px', fontSize: '0.85rem' }}>
                  Re-analyze
                </button>
              </div>
            )}
          </section>

          {/* Unified Score */}
          {score && (
            <section className="accent-green farm-card">
              <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
                <div style={{ textAlign: 'center' }}>
                  <ScoreRing score={score.overall} size={90} />
                  <div style={{ fontSize: '0.75rem', color: '#666', marginTop: 4 }}>Overall Score</div>
                </div>
                <div className="farm-score-grid" style={{ flex: 1 }}>
                  {[
                    { label: 'Yield', value: score.yield_score, color: '#1565c0' },
                    { label: 'Water', value: score.water_score, color: '#00695c' },
                    { label: 'Nutrient', value: score.nutrient_score, color: '#ef6c00' },
                    { label: 'Risk', value: score.risk_score, color: '#6a1b9a' },
                  ].map(s => (
                    <div key={s.label} style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '1.5rem', fontWeight: 700, color: s.color }}>{s.value}</div>
                      <div style={{ fontSize: '0.75rem', color: '#666' }}>{s.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* Summary Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem' }}>
            {wofost != null && (
              <div style={cardStyle} className="farm-card">
                <div style={{ fontSize: '0.75rem', color: '#666', marginBottom: 4 }}>Yield</div>
                <div style={{ fontSize: '1.6rem', fontWeight: 'bold' }}>
                  {Number(wofost.yield_kg_ha ?? 0).toLocaleString()}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#999' }}>kg/ha</div>
                <div style={{ marginTop: 6 }}><ModelBadge model="WOFOST" /></div>
              </div>
            )}
            {aquacrop != null && (
              <div style={cardStyle} className="farm-card">
                <div style={{ fontSize: '0.75rem', color: '#666', marginBottom: 4 }}>Water Need</div>
                <div style={{ fontSize: '1.6rem', fontWeight: 'bold' }}>
                  {Number(aquacrop.total_water_need_mm ?? 0).toLocaleString()}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#999' }}>mm total</div>
                <div style={{ marginTop: 6 }}><ModelBadge model="AquaCrop" /></div>
              </div>
            )}
            {dssat != null && (
              <div style={cardStyle} className="farm-card">
                <div style={{ fontSize: '0.75rem', color: '#666', marginBottom: 4 }}>Nitrogen</div>
                <div style={{ fontSize: '1.6rem', fontWeight: 'bold' }}>
                  {Number(dssat.nitrogen_kg_ha ?? 0)}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#999' }}>kg N/ha</div>
                <div style={{ marginTop: 6 }}><ModelBadge model="DSSAT" /></div>
              </div>
            )}
            {sowing?.optimal_period && (
              <div style={cardStyle} className="farm-card">
                <div style={{ fontSize: '0.75rem', color: '#666', marginBottom: 4 }}>Best Sowing</div>
                <div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>
                  {sowing.optimal_period.start}&ndash;{sowing.optimal_period.end}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#999' }}>{sowing.season}</div>
                <div style={{
                  marginTop: 6, display: 'inline-block', padding: '2px 10px', borderRadius: 12,
                  fontSize: '0.7rem', fontWeight: 600,
                  background: sowing.optimal_period.risk_level === 'LOW' ? '#e8f5e9' : '#fff8e1',
                  color: sowing.optimal_period.risk_level === 'LOW' ? '#2e7d32' : '#f57f17',
                }}>
                  {sowing.optimal_period.risk_level} risk
                </div>
              </div>
            )}
          </div>

          {/* Environment Summary */}
          {env != null && (
            <section className="accent-purple farm-card">
              <h2 style={{ fontSize: '1.1rem', marginBottom: '0.75rem' }}>Environment Snapshot</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem' }}>
                {env.weather_summary && (
                  <div style={cardStyle}>
                    <div style={{ fontSize: '0.75rem', color: '#666' }}>Weather</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>
                      {Number((env.weather_summary as Record<string, unknown>).temp_max_avg)}&deg;C
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#999' }}>
                      {String((env.weather_summary as Record<string, unknown>).condition ?? 'N/A')}
                    </div>
                  </div>
                )}
                {env.soil && (
                  <div style={cardStyle}>
                    <div style={{ fontSize: '0.75rem', color: '#666' }}>Soil</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>
                      Clay {Number((env.soil as Record<string, unknown>).clay_pct)}%
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#999' }}>
                      pH {Number((env.soil as Record<string, unknown>).ph)}
                    </div>
                  </div>
                )}
                {env.groundwater && (
                  <div style={cardStyle}>
                    <div style={{ fontSize: '0.75rem', color: '#666' }}>Groundwater</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>
                      {String((env.groundwater as Record<string, unknown>).category ?? 'N/A')}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#999' }}>
                      {Number((env.groundwater as Record<string, unknown>).depth_m)}m deep
                    </div>
                  </div>
                )}
                {env.ozone && (
                  <div style={cardStyle}>
                    <div style={{ fontSize: '0.75rem', color: '#666' }}>Ozone Impact</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>
                      {String((env.ozone as Record<string, unknown>).severity ?? 'N/A')}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#999' }}>
                      -{Number((env.ozone as Record<string, unknown>).yield_loss_pct)}% yield
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* 3D Terrain */}
          <section className="accent-blue farm-card" style={{ padding: '0.5rem' }}>
            <div id="terrain">
              <MapView lat={lat} lon={lon} simulationResult={null} />
            </div>
          </section>

          {/* Sowing Recommendation */}
          {sowing?.optimal_period && (
            <section className="accent-green farm-card">
              <h2 style={{ fontSize: '1.1rem' }}>Sowing Recommendation</h2>
              <div style={{
                background: 'linear-gradient(135deg, #e8f5e9 0%, #f1f8e9 100%)',
                border: '2px solid #43a047', borderRadius: 12, padding: '1.25rem',
                marginTop: '0.75rem',
              }}>
                <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#1b5e20', marginBottom: 4 }}>
                  {sowing.optimal_period.start} &ndash; {sowing.optimal_period.end}
                </div>
                <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: '#666' }}>Season</div>
                    <div style={{ fontWeight: 600 }}>{sowing.season}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: '#666' }}>Expected Yield</div>
                    <div style={{ fontWeight: 600 }}>{sowing.optimal_period.expected_yield_kg_ha.toLocaleString()} kg/ha</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: '#666' }}>vs Standard</div>
                    <div style={{ fontWeight: 600, color: '#2e7d32' }}>{sowing.optimal_period.vs_standard_pct}</div>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Irrigation Plan */}
          {irrigationSchedule.length > 0 && (
            <section className="accent-teal farm-card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <h2 style={{ fontSize: '1.1rem', margin: 0 }}>Irrigation Plan</h2>
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
                  {irrigationSchedule.filter((w: IrrigationWeek) => w.amount_mm > 0).map((w: IrrigationWeek) => {
                    const pc = priorityColors[w.priority] ?? priorityColors.optional;
                    return (
                      <tr key={w.week}>
                        <td>{w.date_range}</td>
                        <td>{w.crop_stage}</td>
                        <td><strong>{w.amount_mm}</strong> mm</td>
                        <td>
                          <span style={{
                            padding: '2px 8px', borderRadius: 10, fontSize: '0.75rem',
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
              {aquacrop != null && (
                <div style={{ fontSize: '0.8rem', color: '#666', marginTop: '0.5rem' }}>
                  Total: <strong>{Number(aquacrop.total_water_need_mm)} mm</strong> | Irrigation: {Number(aquacrop.irrigation_need_mm)} mm | Rain: {Number(aquacrop.rain_contribution_mm)} mm
                </div>
              )}
            </section>
          )}

          {/* Fertilizer Plan */}
          {fertilizerApps.length > 0 && dssat != null && (
            <section className="accent-orange farm-card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <h2 style={{ fontSize: '1.1rem', margin: 0 }}>Fertilizer Plan</h2>
                <ModelBadge model="DSSAT" />
              </div>

              {/* NPK summary */}
              <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '0.75rem' }}>
                {[
                  { label: 'N', value: Number(dssat.nitrogen_kg_ha ?? 0), color: '#1565c0' },
                  { label: 'P', value: Number(dssat.phosphorus_kg_ha ?? 0), color: '#e65100' },
                  { label: 'K', value: Number(dssat.potassium_kg_ha ?? 0), color: '#6a1b9a' },
                ].map(n => (
                  <div key={n.label} style={{ textAlign: 'center', flex: 1 }}>
                    <div style={{ fontSize: '1.4rem', fontWeight: 'bold', color: n.color }}>{n.value}</div>
                    <div style={{ fontSize: '0.7rem', color: '#999' }}>{n.label} kg/ha</div>
                  </div>
                ))}
              </div>

              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Day</th>
                    <th>N</th>
                    <th>P</th>
                    <th>K</th>
                    <th>Product</th>
                  </tr>
                </thead>
                <tbody>
                  {fertilizerApps.map((a: FertilizerApplication, i: number) => (
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

              {dssat.soil_health_note != null && (
                <div style={{
                  marginTop: '0.75rem', padding: '0.6rem 0.75rem', borderRadius: 6,
                  background: '#f1f8e9', fontSize: '0.85rem', color: '#33691e',
                }}>
                  <strong>Soil tip:</strong> {String(dssat.soil_health_note)}
                </div>
              )}
            </section>
          )}

          {/* Risk Assessment */}
          {env != null && (
            <section className="accent-slate farm-card">
              <h2 style={{ fontSize: '1.1rem' }}>Risk Assessment</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem' }}>
                {[
                  {
                    label: 'Drought',
                    value: String((aquacrop?.drought_risk as string) ?? 'N/A'),
                    isLow: (aquacrop?.drought_risk as string) === 'low',
                  },
                  {
                    label: 'Ozone Damage',
                    value: String((env.ozone as Record<string, unknown>)?.severity ?? 'N/A'),
                    isLow: String((env.ozone as Record<string, unknown>)?.severity ?? '').toLowerCase() === 'low',
                  },
                  {
                    label: 'Groundwater',
                    value: String((env.groundwater as Record<string, unknown>)?.category ?? 'N/A'),
                    isLow: String((env.groundwater as Record<string, unknown>)?.category ?? '').toLowerCase() === 'safe',
                  },
                ].map(r => (
                  <div key={r.label} style={{
                    ...cardStyle,
                    background: r.isLow ? '#e8f5e9' : '#fff8e1',
                    borderColor: r.isLow ? '#a5d6a7' : '#ffe082',
                  }}>
                    <div style={{ fontSize: '0.75rem', color: '#666' }}>{r.label}</div>
                    <div style={{
                      fontSize: '1.1rem', fontWeight: 700,
                      color: r.isLow ? '#2e7d32' : '#f57f17',
                    }}>
                      {r.value}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Action Plan / Recommendations */}
          {result.recommendations.length > 0 && (
            <section className="accent-green farm-card">
              <h2 style={{ fontSize: '1.1rem' }}>Your Farm Action Plan</h2>
              <ol style={{ margin: '0.5rem 0 0', paddingLeft: '1.5rem', lineHeight: 1.8 }}>
                {result.recommendations.map((r, i) => (
                  <li key={i} style={{ fontSize: '0.9rem' }}>{r}</li>
                ))}
              </ol>
            </section>
          )}

          {/* Data Sources */}
          {result.data_sources && (
            <div style={{ fontSize: '0.8rem', color: '#666', padding: '0 0.5rem' }}>
              <strong>Data sources: </strong>
              {Object.entries(result.data_sources).map(([key, val], i) => (
                <span key={key}>
                  {i > 0 && ' \u00B7 '}
                  <span style={{ color: '#2e7d32' }}>{key}: {val}</span>
                </span>
              ))}
            </div>
          )}

          {/* AI Chat */}
          <AdvisoryChat lat={lat} lon={lon} />
        </>
      )}

      {error && (
        <div style={{ color: '#c62828', background: '#ffebee', padding: '1rem', borderRadius: 8, margin: '1rem 0' }}>
          {error}
        </div>
      )}
    </div>
  );
}
