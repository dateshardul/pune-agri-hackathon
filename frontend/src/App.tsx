import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom'
import FarmAnalysis from './components/FarmAnalysis'
import AdvisoryChat from './components/AdvisoryChat'
import './App.css'

const NAV_TABS = [
  { to: '/analysis', label: 'KrishiDisha', color: '#1b5e20' },
  { to: '/chat', label: 'AI Farm Chat', color: '#00695c' },
];

function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <header>
          <h1>KrishiDisha</h1>
          <p>New Direction to Smart Agriculture</p>
        </header>

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
            <Route path="/" element={<Navigate to="/analysis" replace />} />
            <Route path="/analysis" element={<FarmAnalysis />} />
            <Route path="/chat" element={<AdvisoryChat lat={18.52} lon={73.85} />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}

export default App
