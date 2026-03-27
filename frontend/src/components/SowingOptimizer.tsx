import { useState, useEffect, useRef } from 'react';
import { getCrops, optimizeSowing, type SowingOptimizerResponse } from '../services/api';

interface Props {
  lat: number;
  lon: number;
}

const cardStyle = { background: '#fff', padding: '1rem', borderRadius: '8px', textAlign: 'center' as const, border: '1px solid #eee' };

type StepStatus = 'pending' | 'running' | 'done';

interface PipelineStep {
  label: string;
  detail: string;
  status: StepStatus;
}

const stepAnimStyle = (visible: boolean): React.CSSProperties => ({
  opacity: visible ? 1 : 0,
  transform: visible ? 'translateY(0)' : 'translateY(12px)',
  transition: 'opacity 0.4s ease, transform 0.4s ease',
});

const checkCircle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 22, height: 22, borderRadius: '50%', background: '#2e7d32',
  color: '#fff', fontSize: '0.75rem', fontWeight: 700, flexShrink: 0,
};

const spinnerStyle: React.CSSProperties = {
  display: 'inline-block', width: 20, height: 20, borderRadius: '50%',
  border: '2.5px solid #c8e6c9', borderTopColor: '#2e7d32',
  animation: 'sowing-spin 0.7s linear infinite', flexShrink: 0,
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
    <div style={{ height: 8, background: '#e0e0e0', borderRadius: 4, overflow: 'hidden', width: '100%', marginTop: 6 }}>
      <div style={{
        height: '100%', borderRadius: 4,
        background: 'linear-gradient(90deg, #43a047, #66bb6a)',
        width: `${pct}%`, transition: 'width 0.5s ease',
      }} />
    </div>
  );
}

export default function SowingOptimizer({ lat, lon }: Props) {
  const [crops, setCrops] = useState<Record<string, string>>({});
  const [selectedCrop, setSelectedCrop] = useState('wheat');
  const [result, setResult] = useState<SowingOptimizerResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);

  // Pipeline animation state
  const [steps, setSteps] = useState<PipelineStep[]>([]);
  const [progress, setProgress] = useState(0);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    getCrops().then((c) => setCrops(c.crops)).catch(() => {});
  }, []);

  const clearTimers = () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  };

  const run = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    setSlow(false);
    clearTimers();

    // Start pipeline animation
    const initSteps: PipelineStep[] = [
      { label: 'Season Analysis', detail: 'Evaluating climate windows...', status: 'running' },
      { label: 'Monthly Weather & Soil Check', detail: '', status: 'pending' },
      { label: 'Multi-Model Simulation', detail: '', status: 'pending' },
    ];
    setSteps([...initSteps]);
    setProgress(15);

    // Step 2 at 1.5s
    const t1 = setTimeout(() => {
      initSteps[0] = { ...initSteps[0], status: 'done', detail: 'Season identified' };
      initSteps[1] = { ...initSteps[1], status: 'running', detail: 'Checking temperature, rainfall & soil moisture...' };
      setSteps([...initSteps]);
      setProgress(35);
    }, 1500);

    // Step 3 at 3s
    const t2 = setTimeout(() => {
      initSteps[1] = { ...initSteps[1], status: 'done', detail: 'Optimal month found' };
      initSteps[2] = { ...initSteps[2], status: 'running', detail: 'WOFOST + AquaCrop + DSSAT running...' };
      setSteps([...initSteps]);
      setProgress(55);
    }, 3000);

    // Slow progress bump
    const t3 = setTimeout(() => setProgress(70), 5000);
    const t4 = setTimeout(() => setProgress(80), 8000);
    const t5 = setTimeout(() => setSlow(true), 15000);

    timersRef.current = [t1, t2, t3, t4, t5];

    try {
      const res = await optimizeSowing({ latitude: lat, longitude: lon, crop: selectedCrop });
      clearTimers();
      // Complete all steps
      setSteps([
        { label: 'Season Analysis', detail: res.analysis.best_season.reason, status: 'done' },
        { label: 'Monthly Weather & Soil Check', detail: res.analysis.best_month.reason, status: 'done' },
        { label: 'Multi-Model Simulation', detail: 'All models complete', status: 'done' },
      ]);
      setProgress(100);
      setResult(res);
    } catch (err: unknown) {
      clearTimers();
      setSteps([]);
      setProgress(0);
      setError(err instanceof Error ? err.message : 'Failed to optimize sowing period');
    } finally {
      setLoading(false);
      setSlow(false);
    }
  };

  const analysis = result?.analysis;
  const best = analysis?.optimal_period;
  const bestWeek = analysis?.best_week;
  const bestMonth = analysis?.best_month;
  const bestSeason = analysis?.best_season;
  const maxWeekScore = bestWeek ? Math.max(...bestWeek.all_weeks.map(w => w.score)) : 1;

  return (
    <section id="sowing-optimizer" className="accent-green">
      <style>{`
        @keyframes sowing-spin {
          to { transform: rotate(360deg); }
        }
        .sow-pill {
          display: inline-block; padding: 4px 14px; border-radius: 16px;
          font-size: 0.8rem; font-weight: 600; margin: 0 4px 4px 0;
          border: 1.5px solid #c8e6c9; background: #f1f8e9; color: #33691e;
          transition: all 0.2s;
        }
        .sow-pill.winner {
          background: #2e7d32; color: #fff; border-color: #2e7d32;
          box-shadow: 0 2px 8px rgba(46,125,50,0.25);
        }
        .sow-pill.muted { opacity: 0.55; }
        .sow-bar-row {
          display: flex; align-items: center; gap: 0.75rem; margin-bottom: 6px;
        }
        .sow-bar-fill {
          height: 24px; border-radius: 4px; transition: width 0.6s ease;
          display: flex; align-items: center; padding: 0 8px;
          font-size: 0.75rem; font-weight: 600; color: #fff; min-width: 32px;
        }
        .sow-rec-card {
          background: linear-gradient(135deg, #e8f5e9 0%, #f1f8e9 100%);
          border: 2px solid #43a047; border-radius: 12px; padding: 1.5rem;
          margin: 1.5rem 0 1rem; position: relative; overflow: hidden;
        }
        .sow-rec-card::before {
          content: ''; position: absolute; top: -30px; right: -30px;
          width: 100px; height: 100px; border-radius: 50%;
          background: rgba(46,125,50,0.07);
        }
        .sow-factor-tag {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 3px 10px; border-radius: 12px; font-size: 0.75rem;
          background: #e8f5e9; color: #2e7d32; margin: 2px 4px 2px 0;
        }
      `}</style>

      <h2>Sowing Period Optimizer</h2>
      <p>Find the best sowing window using multi-factor climate analysis ({lat.toFixed(2)}&deg;N, {lon.toFixed(2)}&deg;E)</p>

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
        <button onClick={run} disabled={loading}>
          {loading ? 'Optimizing...' : 'Find Best Sowing Period'}
        </button>
      </div>

      {error && <div style={{ color: '#c62828', margin: '1rem 0' }}>Error: {error}</div>}

      {/* Pipeline Animation */}
      {steps.length > 0 && (
        <div style={{
          background: '#fff', border: '1px solid #e0e0e0', borderRadius: '10px',
          padding: '1.25rem', margin: '1rem 0',
        }}>
          <div style={{ fontWeight: 600, marginBottom: '1rem', fontSize: '0.95rem', color: '#1b5e20' }}>
            Finding Best Sowing Period for {selectedCrop.charAt(0).toUpperCase() + selectedCrop.slice(1)}
          </div>

          {steps.map((step, i) => (
            <div key={i} style={{
              ...stepAnimStyle(step.status !== 'pending'),
              display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
              marginBottom: '0.75rem', minHeight: 28,
            }}>
              <StepIcon status={step.status} />
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.88rem', color: step.status === 'pending' ? '#bbb' : '#333' }}>
                  Step {i + 1}: {step.label}
                </div>
                {step.detail && (
                  <div style={{ fontSize: '0.8rem', color: '#666', marginTop: 2 }}>
                    {step.detail}
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <>
              <ProgressBar pct={progress} />
              <div style={{ fontSize: '0.75rem', color: '#999', marginTop: 4, textAlign: 'right' }}>
                {progress}%
              </div>
            </>
          )}

          {slow && (
            <div style={{ fontSize: '0.8rem', color: '#f57f17', marginTop: '0.5rem' }}>
              This is taking longer than usual...
            </div>
          )}
        </div>
      )}

      {/* Results */}
      {result && analysis && (
        <div style={{ animation: 'fadeIn 0.5s ease' }}>

          {/* Season Funnel */}
          {bestSeason && (
            <div style={{ ...cardStyle, textAlign: 'left', marginBottom: '1rem' }}>
              <div style={{ fontSize: '0.8rem', color: '#666', marginBottom: 8, fontWeight: 600 }}>Season Analysis</div>
              <div>
                {bestSeason.all_seasons.map((s) => (
                  <span key={s.season} className={`sow-pill ${s.season === bestSeason.season ? 'winner' : 'muted'}`}>
                    {s.season} {s.season === bestSeason.season && '\u2605'}
                  </span>
                ))}
              </div>
              <div style={{ fontSize: '0.8rem', color: '#555', marginTop: 6 }}>{bestSeason.reason}</div>
            </div>
          )}

          {/* Monthly Scores */}
          {bestMonth && (
            <div style={{ ...cardStyle, textAlign: 'left', marginBottom: '1rem' }}>
              <div style={{ fontSize: '0.8rem', color: '#666', marginBottom: 8, fontWeight: 600 }}>Monthly Scores</div>
              {bestMonth.all_months.map((m) => {
                const isWinner = m.month === bestMonth.month;
                const pct = Math.max(10, m.score);
                return (
                  <div key={m.month} className="sow-bar-row">
                    <span style={{ width: 36, fontSize: '0.8rem', fontWeight: isWinner ? 700 : 400, color: isWinner ? '#1b5e20' : '#555' }}>
                      {m.month}
                    </span>
                    <div style={{ flex: 1 }}>
                      <div className="sow-bar-fill" style={{
                        width: `${pct}%`,
                        background: isWinner ? '#2e7d32' : '#a5d6a7',
                      }}>
                        {m.score}
                      </div>
                    </div>
                    <span style={{ fontSize: '0.7rem', color: m.risk === 'low' ? '#2e7d32' : m.risk === 'high' ? '#c62828' : '#f57f17', width: 52, textAlign: 'right' }}>
                      {m.risk} risk
                    </span>
                  </div>
                );
              })}
              <div style={{ fontSize: '0.8rem', color: '#555', marginTop: 6 }}>{bestMonth.reason}</div>
            </div>
          )}

          {/* Weekly Breakdown */}
          {bestWeek && (
            <div style={{ ...cardStyle, textAlign: 'left', marginBottom: '1rem' }}>
              <div style={{ fontSize: '0.8rem', color: '#666', marginBottom: 8, fontWeight: 600 }}>Weekly Sowing Windows</div>
              {bestWeek.all_weeks.map((w) => {
                const isRec = w.recommended;
                const barPct = Math.max(10, (w.score / maxWeekScore) * 100);
                return (
                  <div key={w.period} className="sow-bar-row">
                    <span style={{ width: 90, fontSize: '0.78rem', fontWeight: isRec ? 700 : 400, color: isRec ? '#1b5e20' : '#555' }}>
                      {w.period}
                    </span>
                    <div style={{ flex: 1 }}>
                      <div className="sow-bar-fill" style={{
                        width: `${barPct}%`,
                        background: isRec ? '#2e7d32' : '#a5d6a7',
                      }}>
                        {w.yield_kg_ha.toLocaleString()} kg/ha
                      </div>
                    </div>
                    {isRec && <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#2e7d32' }}>{'\u2605'}</span>}
                  </div>
                );
              })}
              <div style={{ fontSize: '0.8rem', color: '#555', marginTop: 6 }}>{bestWeek.reason}</div>
            </div>
          )}

          {/* Big Recommendation Card */}
          {best && (
            <div className="sow-rec-card">
              <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#2e7d32', letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 8 }}>
                Recommended Sowing Period
              </div>
              <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#1b5e20', marginBottom: 4 }}>
                {best.start} &ndash; {best.end}
              </div>
              <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', margin: '0.75rem 0' }}>
                <div>
                  <div style={{ fontSize: '0.75rem', color: '#666' }}>Expected Yield</div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{best.expected_yield_kg_ha.toLocaleString()} <span style={{ fontSize: '0.8rem', fontWeight: 400 }}>kg/ha</span></div>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: '#666' }}>vs Standard Sowing</div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#2e7d32' }}>{best.vs_standard_pct}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: '#666' }}>Risk Level</div>
                  <div style={{
                    display: 'inline-block', padding: '3px 12px', borderRadius: 12,
                    fontWeight: 700, fontSize: '0.85rem',
                    background: best.risk_level === 'LOW' ? '#e8f5e9' : best.risk_level === 'HIGH' ? '#ffebee' : '#fff8e1',
                    color: best.risk_level === 'LOW' ? '#2e7d32' : best.risk_level === 'HIGH' ? '#c62828' : '#f57f17',
                  }}>
                    {best.risk_level}
                  </div>
                </div>
              </div>

              {/* Factors */}
              {result.factors_considered.length > 0 && (
                <div style={{ marginTop: '0.75rem' }}>
                  <div style={{ fontSize: '0.75rem', color: '#666', marginBottom: 4 }}>Factors Considered</div>
                  <div>
                    {result.factors_considered.map((f) => (
                      <span key={f} className="sow-factor-tag">
                        <span style={{ color: '#43a047', fontWeight: 700 }}>&#10003;</span> {f}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ fontSize: '0.75rem', color: '#888', marginTop: '0.75rem' }}>
                Source: {result.weather_source}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
