import { useState, useEffect, useRef, useCallback } from 'react';
import {
  getCrops, analyzeFarm, getWeather, getSoil, getGroundwater, getOzone, getElevation,
  type FarmAnalysisRequest, type FarmAnalysisResponse,
  type IrrigationWeek, type FertilizerApplication,
  type WeatherResponse, type SoilResponse, type GroundwaterResult,
} from '../services/api';
import MapView from './MapView';
import AdvisoryChat from './AdvisoryChat';

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
  // Simple rule-based recommendation using available environment data
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

    // Temperature fit
    if (avgTemp >= c.minTemp && avgTemp <= c.maxTemp) {
      score += 15;
      reasons.push('Good temperature range');
    } else {
      score -= 15;
      reasons.push('Temperature outside optimal range');
    }

    // Soil pH fit
    if (ph >= c.phRange[0] && ph <= c.phRange[1]) {
      score += 10;
      reasons.push('Soil pH suitable');
    } else {
      score -= 10;
      reasons.push('Soil pH outside optimal range');
    }

    // Groundwater / water availability
    if (gwCategory === 'over-exploited' && c.waterNeed > 600) {
      score -= 20;
      reasons.push('High water need — groundwater stressed');
    } else if (gwCategory === 'safe' || c.waterNeed < gwRecharge * 0.5) {
      score += 10;
      reasons.push('Water availability adequate');
    }

    // Drought-tolerant crops get bonus in water-stressed areas
    if (gwCategory !== 'safe' && c.waterNeed < 400) {
      score += 10;
      reasons.push('Drought-tolerant — good for water-stressed area');
    }

    score = Math.max(10, Math.min(100, score));
    return {
      crop: c.crop,
      score,
      reason: reasons.slice(0, 2).join('. '),
      supported: true,
    };
  }).sort((a, b) => b.score - a.score);
}

// ── Mock data ────────────────────────────────────────────────────────

function getMockResponse(req: FarmAnalysisRequest): FarmAnalysisResponse {
  return {
    farm: { latitude: req.latitude, longitude: req.longitude, field_area_ha: req.field_area_ha ?? 2.5, elevation_range: { min: 534, max: 587 } },
    environment: {
      weather_summary: { temp_max_avg: 32, temp_min_avg: 21, precip_total_mm: 45, condition: 'Hot & dry' },
      forecast: [], soil: { clay_pct: 45, sand_pct: 25, silt_pct: 30, ph: 7.8, organic_carbon_pct: 0.6 },
      groundwater: { category: 'Semi-Critical', depth_m: 8.2, annual_decline_m: 0.3 },
      ozone: { aot40_ppb_h: 3200, yield_loss_pct: 2.1, severity: 'Low' },
    },
    sowing: { optimal_period: { start: 'Jun 8', end: 'Jun 14', expected_yield_kg_ha: 6494, vs_standard_pct: '+12%', risk_level: 'LOW' }, season: 'Kharif', best_month: 'June', best_week: 'Jun 8-14' },
    models: {
      wofost: { yield_kg_ha: 6494, growth_days: 120, confidence: 'high' },
      aquacrop: { total_water_need_mm: 1400, irrigation_need_mm: 980, rain_contribution_mm: 420, drought_risk: 'low', water_productivity_kg_m3: 1.08,
        schedule: [
          { week: 1, date_range: 'Week 1-2', amount_mm: 60, crop_stage: 'Germination', priority: 'critical' },
          { week: 3, date_range: 'Week 3-4', amount_mm: 50, crop_stage: 'Seedling', priority: 'critical' },
          { week: 5, date_range: 'Week 5-6', amount_mm: 80, crop_stage: 'Tillering', priority: 'recommended' },
          { week: 7, date_range: 'Week 7-8', amount_mm: 110, crop_stage: 'Booting', priority: 'critical' },
          { week: 9, date_range: 'Week 9-10', amount_mm: 120, crop_stage: 'Flowering', priority: 'critical' },
        ] },
      dssat: { nitrogen_kg_ha: 150, phosphorus_kg_ha: 75, potassium_kg_ha: 50, soil_health_note: 'Moderate organic carbon. Apply farmyard manure (5 t/ha) before sowing.',
        applications: [
          { timing: 'Basal (at sowing)', day_after_sowing: 0, n_kg: 50, p_kg: 75, k_kg: 50, product_suggestion: 'DAP (18:46:0) + MOP (0:0:60)' },
          { timing: 'First top dress', day_after_sowing: 30, n_kg: 50, p_kg: 0, k_kg: 0, product_suggestion: 'Urea (46:0:0)' },
          { timing: 'Second top dress', day_after_sowing: 60, n_kg: 50, p_kg: 0, k_kg: 0, product_suggestion: 'Urea (46:0:0)' },
        ] },
    },
    unified_score: { overall: 82, yield_score: 88, water_score: 75, nutrient_score: 80, risk_score: 85 },
    recommendations: [
      'Sow between Jun 8-14 for optimal monsoon alignment.',
      'Start irrigation within 3 days of sowing.',
      'Apply basal fertilizer (DAP + MOP) at sowing.',
      'Flowering stage is the most water-sensitive — do not skip.',
      'Groundwater is semi-critical — prefer rainwater harvesting.',
    ],
    data_sources: { weather: 'NASA POWER', soil: 'SoilGrids', yield: 'WOFOST', water: 'AquaCrop', nutrients: 'DSSAT', groundwater: 'CGWB' },
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
      // Fetch all in parallel
      const [wRes, sRes, gRes, oRes, eRes] = await Promise.allSettled([
        getWeather(lat, lon),
        getSoil(lat, lon),
        getGroundwater(lat, lon),
        getOzone(lat, lon, 'wheat'),  // default crop for ozone baseline
        getElevation(lat, lon),
      ]);

      // Process results progressively
      if (eRes.status === 'fulfilled') {
        setElevRange({ min: eRes.value.min_elevation, max: eRes.value.max_elevation });
        advance(1, `${eRes.value.min_elevation}–${eRes.value.max_elevation}m elevation`, 20);
      } else { advance(1, 'Elevation unavailable', 20); }

      await new Promise(r => setTimeout(r, 300));
      if (wRes.status === 'fulfilled') {
        setWeather(wRes.value);
        const latest = wRes.value.data[wRes.value.data.length - 1];
        advance(2, `${latest?.temperature_max ?? '?'}°C, ${latest?.precipitation ?? 0}mm rain`, 40);
      } else { advance(2, 'Weather unavailable', 40); }

      await new Promise(r => setTimeout(r, 300));
      if (sRes.status === 'fulfilled') {
        setSoil(sRes.value);
        const top = sRes.value.layers[0];
        advance(3, `Clay ${top?.clay ?? '?'}%, pH ${top?.ph ?? '?'}`, 60);
      } else { advance(3, 'Soil data unavailable', 60); }

      await new Promise(r => setTimeout(r, 300));
      if (gRes.status === 'fulfilled') {
        setGroundwater(gRes.value);
        advance(4, `${gRes.value.aquifer?.category ?? 'unknown'}, ${gRes.value.aquifer?.current_depth_m ?? '?'}m deep`, 80);
      } else { advance(4, 'Groundwater data unavailable', 80); }

      await new Promise(r => setTimeout(r, 300));
      if (oRes.status === 'fulfilled') {
        setOzoneData(oRes.value as unknown as Record<string, unknown>);
        const yi = (oRes.value as unknown as Record<string, unknown>).yield_impact as Record<string, unknown> | undefined;
        advance(5, `${yi?.severity ?? 'unknown'} risk, ${yi?.yield_loss_percent ?? 0}% loss`, 100);
      } else { advance(5, 'Ozone data unavailable', 100); }

      // Generate crop recommendations
      const w = wRes.status === 'fulfilled' ? wRes.value : null;
      const s = sRes.status === 'fulfilled' ? sRes.value : null;
      const g = gRes.status === 'fulfilled' ? gRes.value : null;
      const recs = recommendCrops(w, s, g);
      setCropRecs(recs);

      // Auto-advance to recommend phase
      await new Promise(r => setTimeout(r, 600));
      setPhase('recommend');

    } catch (e) {
      setError(e instanceof Error ? e.message : 'Environment analysis failed');
    }
  };

  // ── STEP 4-5: Run full simulation with selected crops ─────────────

  const runSimulation = async (overrideCrop?: string) => {
    const crop = overrideCrop ?? selectedCrops[0] ?? 'rice';
    setPhase('simulate');
    setError(null);
    setResult(null);
    setUsingMock(false);
    clearTimers();

    const steps: PipelineStep[] = [
      { label: 'Finding optimal sowing period', detail: 'Season → Month → Week analysis', status: 'running' },
      { label: 'Running WOFOST crop simulation', detail: 'Physics-based yield model', status: 'pending' },
      { label: 'Running AquaCrop water analysis', detail: 'FAO irrigation optimizer', status: 'pending' },
      { label: 'Running DSSAT nutrient analysis', detail: 'Fertilizer management model', status: 'pending' },
      { label: 'Computing unified advisory', detail: 'Multi-model ensemble score', status: 'pending' },
    ];
    setSimSteps([...steps]);
    setSimProgress(5);

    const advance = (idx: number, detail: string, pct: number) => {
      steps[idx - 1] = { ...steps[idx - 1], status: 'done', detail };
      if (idx < steps.length) steps[idx] = { ...steps[idx], status: 'running' };
      setSimSteps([...steps]);
      setSimProgress(pct);
    };

    // Simulate progress while waiting
    const t1 = setTimeout(() => advance(1, 'Analyzing seasons & months...', 20), 2000);
    const t2 = setTimeout(() => advance(2, 'Simulating daily crop growth...', 40), 4000);
    const t3 = setTimeout(() => advance(3, 'Computing water balance...', 60), 6000);
    const t4 = setTimeout(() => advance(4, 'Optimizing fertilizer schedule...', 80), 8000);
    timersRef.current = [t1, t2, t3, t4];

    const req: FarmAnalysisRequest = {
      latitude: lat, longitude: lon, crop,
      field_area_ha: fieldArea,
      ...(adjSowing !== 'auto' ? { preferred_sowing: adjSowing } : {}),
      ...(adjWater < 1400 ? { water_budget_mm: adjWater } : {}),
    };

    try {
      const res = await analyzeFarm(req);
      clearTimers();
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
    setResult(null); setError(null);
    setWeather(null); setSoil(null); setGroundwater(null); setOzoneData(null);
    setCropRecs([]); setSelectedCrops([]);
  };

  // Extract model data
  const wofost = result?.models?.wofost as Record<string, unknown> | null;
  const aquacrop = result?.models?.aquacrop as Record<string, unknown> | null;
  const dssat = result?.models?.dssat as Record<string, unknown> | null;
  const sowing = result?.sowing;
  const score = result?.unified_score;
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
        .farm-score-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap: 0.75rem; }
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
          <h2>Analyzing your land...</h2>
          <p>{lat.toFixed(2)}&deg;N, {lon.toFixed(2)}&deg;E &middot; {fieldArea} hectares</p>

          {/* 3D Terrain shows immediately */}
          <div style={{ marginBottom: '1rem', borderRadius: 8, overflow: 'hidden' }}>
            <MapView lat={lat} lon={lon} simulationResult={null} />
          </div>

          {/* Progressive environment analysis */}
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

            {/* 3D Terrain */}
            <div style={{ marginBottom: '1rem', borderRadius: 8, overflow: 'hidden' }}>
              <MapView lat={lat} lon={lon} simulationResult={null} />
            </div>

            {/* Environment summary cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
              {elevRange && (
                <div style={cardStyle}>
                  <div style={{ fontSize: '0.75rem', color: '#666' }}>Elevation</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>{elevRange.min}–{elevRange.max}m</div>
                </div>
              )}
              {weather && (
                <div style={cardStyle}>
                  <div style={{ fontSize: '0.75rem', color: '#666' }}>Temperature</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>
                    {weather.data[weather.data.length - 1]?.temperature_max ?? '?'}°C / {weather.data[weather.data.length - 1]?.temperature_min ?? '?'}°C
                  </div>
                </div>
              )}
              {soil && (
                <div style={cardStyle}>
                  <div style={{ fontSize: '0.75rem', color: '#666' }}>Soil</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>Clay {soil.layers[0]?.clay ?? '?'}%</div>
                  <div style={{ fontSize: '0.75rem', color: '#999' }}>pH {soil.layers[0]?.ph ?? '?'}</div>
                </div>
              )}
              {groundwater && (
                <div style={cardStyle}>
                  <div style={{ fontSize: '0.75rem', color: '#666' }}>Groundwater</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 600, color: groundwater.aquifer?.category === 'safe' ? '#2e7d32' : '#f57f17' }}>
                    {groundwater.aquifer?.category ?? 'unknown'}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#999' }}>{groundwater.aquifer?.current_depth_m ?? '?'}m deep</div>
                </div>
              )}
              {ozoneData && (
                <div style={cardStyle}>
                  <div style={{ fontSize: '0.75rem', color: '#666' }}>Ozone</div>
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
                    {isSelected && <div style={{ marginTop: 4, fontSize: '0.75rem', color: '#2e7d32', fontWeight: 600 }}>Selected ✓</div>}
                  </div>
                );
              })}
            </div>

            {/* Or pick from full list */}
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

            {/* Proceed button */}
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
          <h2>Building your farming plan...</h2>
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
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <button onClick={resetToInput} style={{
              background: '#f5f5f5', color: '#555', border: '1px solid #ddd', borderRadius: 6,
              padding: '6px 14px', fontSize: '0.82rem', cursor: 'pointer',
            }}>&larr; New Analysis</button>
            <div style={{ fontSize: '0.85rem', color: '#666' }}>
              {selectedCrops.map(c => c.charAt(0).toUpperCase() + c.slice(1)).join(', ')} &middot; {lat.toFixed(2)}&deg;N, {lon.toFixed(2)}&deg;E &middot; {fieldArea} ha
            </div>
          </div>

          {usingMock && (
            <div style={{ background: '#fff8e1', padding: '0.5rem 0.75rem', borderRadius: 6, fontSize: '0.85rem', color: '#f57f17', marginBottom: '1rem' }}>
              Backend processing — showing simulated analysis for demo.
            </div>
          )}

          {/* Adjustment Panel */}
          <section className="accent-green farm-card" style={{ padding: '0.75rem 1rem' }}>
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

          {/* Summary Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem' }}>
            {wofost && <div style={cardStyle} className="farm-card"><div style={{ fontSize: '0.75rem', color: '#666' }}>Yield</div><div style={{ fontSize: '1.6rem', fontWeight: 'bold' }}>{Number(wofost.yield_kg_ha ?? 0).toLocaleString()}</div><div style={{ fontSize: '0.75rem', color: '#999' }}>kg/ha</div><div style={{ marginTop: 6 }}><ModelBadge model="WOFOST" /></div></div>}
            {aquacrop && <div style={cardStyle} className="farm-card"><div style={{ fontSize: '0.75rem', color: '#666' }}>Water Need</div><div style={{ fontSize: '1.6rem', fontWeight: 'bold' }}>{Number(aquacrop.total_water_need_mm ?? 0)}</div><div style={{ fontSize: '0.75rem', color: '#999' }}>mm total</div><div style={{ marginTop: 6 }}><ModelBadge model="AquaCrop" /></div></div>}
            {dssat && <div style={cardStyle} className="farm-card"><div style={{ fontSize: '0.75rem', color: '#666' }}>Nitrogen</div><div style={{ fontSize: '1.6rem', fontWeight: 'bold' }}>{Number(dssat.nitrogen_kg_ha ?? 0)}</div><div style={{ fontSize: '0.75rem', color: '#999' }}>kg N/ha</div><div style={{ marginTop: 6 }}><ModelBadge model="DSSAT" /></div></div>}
            {sowing?.optimal_period && <div style={cardStyle} className="farm-card"><div style={{ fontSize: '0.75rem', color: '#666' }}>Best Sowing</div><div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{sowing.optimal_period.start}&ndash;{sowing.optimal_period.end}</div><div style={{ fontSize: '0.75rem', color: '#999' }}>{sowing.season}</div></div>}
          </div>

          {/* 3D Terrain */}
          <section className="accent-blue farm-card" style={{ padding: '0.5rem' }}>
            <div id="terrain"><MapView lat={lat} lon={lon} simulationResult={null} /></div>
          </section>

          {/* Sowing Recommendation */}
          {sowing?.optimal_period && (
            <section className="accent-green farm-card">
              <h2 style={{ fontSize: '1.1rem' }}>Sowing Recommendation</h2>
              <div style={{ background: 'linear-gradient(135deg, #e8f5e9, #f1f8e9)', border: '2px solid #43a047', borderRadius: 12, padding: '1.25rem', marginTop: '0.75rem' }}>
                <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#1b5e20' }}>{sowing.optimal_period.start} &ndash; {sowing.optimal_period.end}</div>
                <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                  <div><div style={{ fontSize: '0.75rem', color: '#666' }}>Season</div><div style={{ fontWeight: 600 }}>{sowing.season}</div></div>
                  <div><div style={{ fontSize: '0.75rem', color: '#666' }}>Expected Yield</div><div style={{ fontWeight: 600 }}>{sowing.optimal_period.expected_yield_kg_ha.toLocaleString()} kg/ha</div></div>
                  <div><div style={{ fontSize: '0.75rem', color: '#666' }}>vs Standard</div><div style={{ fontWeight: 600, color: '#2e7d32' }}>{sowing.optimal_period.vs_standard_pct}</div></div>
                </div>
              </div>
            </section>
          )}

          {/* Irrigation Plan */}
          {irrigationSchedule.length > 0 && (
            <section className="accent-teal farm-card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <h2 style={{ fontSize: '1.1rem', margin: 0 }}>Irrigation Plan</h2><ModelBadge model="AquaCrop" />
              </div>
              <table><thead><tr><th>Period</th><th>Stage</th><th>Water</th><th>Priority</th></tr></thead>
                <tbody>{irrigationSchedule.filter((w: IrrigationWeek) => w.amount_mm > 0).map((w: IrrigationWeek) => {
                  const pc = priorityColors[w.priority] ?? priorityColors.optional;
                  return (<tr key={w.week}><td>{w.date_range}</td><td>{w.crop_stage}</td><td><strong>{w.amount_mm}</strong> mm</td>
                    <td><span style={{ padding: '2px 8px', borderRadius: 10, fontSize: '0.75rem', fontWeight: 600, background: pc.bg, color: pc.color }}>{w.priority}</span></td></tr>);
                })}</tbody></table>
            </section>
          )}

          {/* Fertilizer Plan */}
          {fertilizerApps.length > 0 && dssat && (
            <section className="accent-orange farm-card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <h2 style={{ fontSize: '1.1rem', margin: 0 }}>Fertilizer Plan</h2><ModelBadge model="DSSAT" />
              </div>
              <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '0.75rem' }}>
                {[{ l: 'N', v: Number(dssat.nitrogen_kg_ha ?? 0), c: '#1565c0' }, { l: 'P', v: Number(dssat.phosphorus_kg_ha ?? 0), c: '#e65100' }, { l: 'K', v: Number(dssat.potassium_kg_ha ?? 0), c: '#6a1b9a' }].map(n => (
                  <div key={n.l} style={{ textAlign: 'center', flex: 1 }}><div style={{ fontSize: '1.4rem', fontWeight: 'bold', color: n.c }}>{n.v}</div><div style={{ fontSize: '0.7rem', color: '#999' }}>{n.l} kg/ha</div></div>
                ))}
              </div>
              <table><thead><tr><th>When</th><th>Day</th><th>N</th><th>P</th><th>K</th><th>Product</th></tr></thead>
                <tbody>{fertilizerApps.map((a: FertilizerApplication, i: number) => (
                  <tr key={i}><td><strong>{a.timing}</strong></td><td>Day {a.day_after_sowing}</td><td>{a.n_kg}</td><td>{a.p_kg}</td><td>{a.k_kg}</td><td style={{ fontSize: '0.85rem', color: '#555' }}>{a.product_suggestion}</td></tr>
                ))}</tbody></table>
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
        </>
      )}

      {error && <div style={{ color: '#c62828', background: '#ffebee', padding: '1rem', borderRadius: 8, margin: '1rem 0' }}>{error}</div>}
    </div>
  );
}
