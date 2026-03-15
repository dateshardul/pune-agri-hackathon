import Dashboard from './components/Dashboard'
import MapView from './components/MapView'
import ScenarioExplorer from './components/ScenarioExplorer'
import OzoneSight from './components/OzoneSight'
import AdvisoryChat from './components/AdvisoryChat'
import './App.css'

function App() {
  return (
    <div className="app">
      <header>
        <h1>KrishiTwin</h1>
        <p>Climate-Resilient Digital Agriculture Platform</p>
      </header>
      <main>
        <MapView />
        <Dashboard />
        <ScenarioExplorer />
        <OzoneSight />
        <AdvisoryChat />
      </main>
    </div>
  )
}

export default App
