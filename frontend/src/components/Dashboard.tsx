import { useEffect, useState } from 'react';
import { getWeather, getSoil, type WeatherResponse, type SoilResponse } from '../services/api';

// Default: Pune, Maharashtra
const DEFAULT_LAT = 18.52;
const DEFAULT_LON = 73.85;

export default function Dashboard() {
  const [weather, setWeather] = useState<WeatherResponse | null>(null);
  const [soil, setSoil] = useState<SoilResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getWeather(DEFAULT_LAT, DEFAULT_LON),
      getSoil(DEFAULT_LAT, DEFAULT_LON),
    ])
      .then(([w, s]) => {
        setWeather(w);
        setSoil(s);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading">Loading Pune farm data...</div>;
  if (error) return <div className="error">Error: {error}</div>;

  const latest = weather?.data[weather.data.length - 1];

  return (
    <div className="dashboard">
      <h1>KrishiTwin Dashboard</h1>
      <p>Location: Pune ({DEFAULT_LAT}, {DEFAULT_LON})</p>

      <section>
        <h2>Latest Weather</h2>
        {latest && (
          <table>
            <tbody>
              <tr><td>Date</td><td>{latest.date}</td></tr>
              <tr><td>Temp (max/min)</td><td>{latest.temperature_max}°C / {latest.temperature_min}°C</td></tr>
              <tr><td>Precipitation</td><td>{latest.precipitation} mm</td></tr>
              <tr><td>Solar Radiation</td><td>{latest.solar_radiation} MJ/m²/day</td></tr>
              <tr><td>Humidity</td><td>{latest.relative_humidity}%</td></tr>
              <tr><td>Wind Speed</td><td>{latest.wind_speed} m/s</td></tr>
            </tbody>
          </table>
        )}
        <p><small>{weather?.data.length} days of data from {weather?.source}</small></p>
      </section>

      <section>
        <h2>Soil Profile</h2>
        <table>
          <thead>
            <tr>
              <th>Depth</th><th>Clay</th><th>Sand</th><th>Silt</th>
              <th>OC</th><th>pH</th><th>Bulk Density</th>
            </tr>
          </thead>
          <tbody>
            {soil?.layers.map((l) => (
              <tr key={l.depth_label}>
                <td>{l.depth_label}</td>
                <td>{l.clay}</td>
                <td>{l.sand}</td>
                <td>{l.silt}</td>
                <td>{l.organic_carbon}</td>
                <td>{l.ph}</td>
                <td>{l.bulk_density}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p><small>Data from {soil?.source}</small></p>
      </section>
    </div>
  );
}
