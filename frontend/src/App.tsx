import { useState, useEffect, useRef } from 'react'
import Dashboard from './components/Dashboard'
import MapView from './components/MapView'
import type { SimulationResult } from './services/api'
import ScenarioExplorer from './components/ScenarioExplorer'
import OzoneSight from './components/OzoneSight'
import GroundwaterView from './components/GroundwaterView'
import YieldPredictor from './components/YieldPredictor'
import AdvisoryChat from './components/AdvisoryChat'
import './App.css'

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

const inputStyle = { width: '80px', marginLeft: '4px', padding: '4px 6px', borderRadius: '4px', border: '1px solid #ccc' } as const;

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

function App() {
  const [latInput, setLatInput] = useState(18.52);
  const [lonInput, setLonInput] = useState(73.85);

  const debouncedLat = useDebounced(latInput, 300);
  const debouncedLon = useDebounced(lonInput, 300);

  // Preset clicks bypass debounce
  const [lat, setLat] = useState(18.52);
  const [lon, setLon] = useState(73.85);
  const presetRef = useRef(false);

  useEffect(() => {
    if (presetRef.current) {
      presetRef.current = false;
      return;
    }
    setLat(debouncedLat);
    setLon(debouncedLon);
  }, [debouncedLat, debouncedLon]);

  const selectPreset = (p: LocationPreset) => {
    presetRef.current = true;
    setLatInput(p.lat);
    setLonInput(p.lon);
    setLat(p.lat);
    setLon(p.lon);
  };

  const [simResult, setSimResult] = useState<SimulationResult | null>(null);

  const activePreset = PRESETS.find(p => p.lat === lat && p.lon === lon);

  return (
    <div className="app">
      <header>
        <h1>KrishiTwin</h1>
        <p>Climate-Resilient Digital Agriculture Platform</p>

        <div className="location-bar">
          <div className="location-inputs">
            <label>
              Lat:
              <input
                type="number"
                step="0.01"
                value={latInput}
                onChange={(e) => setLatInput(parseFloat(e.target.value) || 0)}
                style={inputStyle}
              />
            </label>
            <label>
              Lon:
              <input
                type="number"
                step="0.01"
                value={lonInput}
                onChange={(e) => setLonInput(parseFloat(e.target.value) || 0)}
                style={inputStyle}
              />
            </label>
          </div>
          <div className="location-presets">
            {PRESETS.map((p) => (
              <button
                key={p.name}
                onClick={() => selectPreset(p)}
                className={activePreset?.name === p.name ? 'preset-active' : ''}
                style={{
                  padding: '4px 12px',
                  borderRadius: '16px',
                  border: activePreset?.name === p.name ? '2px solid #1976d2' : '1px solid #ccc',
                  background: activePreset?.name === p.name ? '#e3f2fd' : '#fff',
                  cursor: 'pointer',
                  fontWeight: activePreset?.name === p.name ? 600 : 400,
                  fontSize: '0.85rem',
                }}
              >
                {p.name}
              </button>
            ))}
          </div>
          {activePreset && (
            <span style={{ fontSize: '0.85rem', color: '#1976d2', fontWeight: 600 }}>
              {activePreset.name}
            </span>
          )}
        </div>
      </header>
      <main>
        <MapView lat={lat} lon={lon} simulationResult={simResult} />
        <Dashboard lat={lat} lon={lon} onSimulationResult={setSimResult} />
        <YieldPredictor lat={lat} lon={lon} />
        <ScenarioExplorer lat={lat} lon={lon} />
        <OzoneSight lat={lat} lon={lon} />
        <GroundwaterView lat={lat} lon={lon} />
        <AdvisoryChat lat={lat} lon={lon} />
      </main>
    </div>
  )
}

export default App
