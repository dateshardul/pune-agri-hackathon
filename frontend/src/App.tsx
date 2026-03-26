import { useState, useEffect, useRef } from 'react'
import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom'
import Dashboard from './components/Dashboard'
import MapView from './components/MapView'
import type { SimulationResult } from './services/api'
import ScenarioExplorer from './components/ScenarioExplorer'
import OzoneSight from './components/OzoneSight'
import GroundwaterView from './components/GroundwaterView'
import YieldPredictor from './components/YieldPredictor'
import AdvisoryChat from './components/AdvisoryChat'
import SmartAdvisory from './components/SmartAdvisory'
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

const NAV_TABS = [
  { to: '/dashboard', label: 'Dashboard', color: '#1976d2' },
  { to: '/simulation', label: 'Crop Simulation', color: '#1b5e20' },
  { to: '/environment', label: 'Environment', color: '#6a1b9a' },
  { to: '/advisory', label: 'Smart Advisory', color: '#00695c' },
];

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
    <BrowserRouter>
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
                />
              </label>
              <label>
                Lon:
                <input
                  type="number"
                  step="0.01"
                  value={lonInput}
                  onChange={(e) => setLonInput(parseFloat(e.target.value) || 0)}
                />
              </label>
            </div>
            <div className="location-presets">
              {PRESETS.map((p) => (
                <button
                  key={p.name}
                  onClick={() => selectPreset(p)}
                  className={activePreset?.name === p.name ? 'preset-active' : ''}
                >
                  {p.name}
                </button>
              ))}
            </div>
            {activePreset && (
              <span style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.9)', fontWeight: 600 }}>
                {activePreset.name}
              </span>
            )}
          </div>
        </header>

        {/* Sticky Section Navigation */}
        <nav className="section-nav">
          {NAV_TABS.map(({ to, label, color }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => isActive ? 'active' : ''}
            >
              <span className="nav-dot" style={{ background: color }} />
              {label}
            </NavLink>
          ))}
        </nav>

        <main>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route
              path="/dashboard"
              element={<Dashboard lat={lat} lon={lon} onSimulationResult={setSimResult} />}
            />
            <Route
              path="/simulation"
              element={
                <>
                  <div id="terrain">
                    <MapView lat={lat} lon={lon} simulationResult={simResult} />
                  </div>
                  <YieldPredictor lat={lat} lon={lon} onSimulationResult={setSimResult} />
                  <ScenarioExplorer lat={lat} lon={lon} onSimulationResult={setSimResult} />
                </>
              }
            />
            <Route
              path="/environment"
              element={
                <>
                  <OzoneSight lat={lat} lon={lon} />
                  <GroundwaterView lat={lat} lon={lon} />
                </>
              }
            />
            <Route
              path="/advisory"
              element={
                <>
                  <SmartAdvisory lat={lat} lon={lon} />
                  <AdvisoryChat lat={lat} lon={lon} />
                </>
              }
            />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}

export default App
