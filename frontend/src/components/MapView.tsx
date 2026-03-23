import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Engine, TerrainMesh,
  ScreenshotExporter, SimulationOverlayBuilder, TimeSeriesPlayer, GeoJSONOverlay,
  type VerticalPlugin, type Annotation, type LayerEntry,
} from 'holographic-core';
import type { OverlayConfig } from 'holographic-core';
import * as THREE from 'three';
import { getWeather, getSoil, type WeatherResponse, type SoilResponse, type SimulationResult } from '../services/api';

interface Props {
  lat: number;
  lon: number;
  simulationResult?: SimulationResult | null;
}

// ── Overlay definitions ──────────────────────────────────────────────

type OverlayType = 'ndvi' | 'soil_moisture' | 'ozone_damage' | null;

interface OverlayInfo {
  label: string;
  type: OverlayType;
  config: OverlayConfig;
  dataRange: [number, number];
  unit: string;
  gradientCSS: string;
}

const OVERLAYS: OverlayInfo[] = [
  {
    label: 'Crop Health (NDVI)',
    type: 'ndvi',
    config: { colormap: { name: 'rdylgn', min: 0.2, max: 0.9 } },
    dataRange: [0.2, 0.9],
    unit: '',
    gradientCSS: 'linear-gradient(to right, #a50026, #f46d43, #fee08b, #a6d96a, #1a9850, #006837)',
  },
  {
    label: 'Soil Moisture',
    type: 'soil_moisture',
    config: { colormap: { name: 'cool', min: 0.1, max: 0.6 } },
    dataRange: [0.1, 0.6],
    unit: '',
    gradientCSS: 'linear-gradient(to right, #00ffff, #8080ff, #ff00ff)',
  },
  {
    label: 'Ozone Damage',
    type: 'ozone_damage',
    config: { colormap: { name: 'hot', min: 0, max: 15 } },
    dataRange: [0, 15],
    unit: '% crop loss',
    gradientCSS: 'linear-gradient(to right, #000000, #e50000, #ff8c00, #ffff00, #ffffff)',
  },
];

// ── Styles (static to avoid re-render churn) ─────────────────────────

const containerStyle = {
  width: '100%',
  height: '500px',
  borderRadius: '8px',
  overflow: 'hidden' as const,
  background: '#0a0a1a',
};

const panelStyle = {
  position: 'absolute' as const, top: '12px', right: '12px',
  background: 'rgba(0,0,0,0.8)', color: '#fff',
  padding: '10px 14px', borderRadius: '8px', fontSize: '0.78rem',
  minWidth: '160px',
};

const infoCardStyle = {
  position: 'absolute' as const, bottom: '60px', left: '12px',
  background: 'rgba(10,10,30,0.92)', color: '#fff',
  padding: '12px 16px', borderRadius: '8px', fontSize: '0.82rem',
  maxWidth: '320px', backdropFilter: 'blur(8px)',
  border: '1px solid rgba(0,212,255,0.3)',
};

// ── Location-seeded data generators ──────────────────────────────────

function generateSeededHeightmap(
  width: number, height: number, seed: number,
): Float32Array {
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nx = x / width - 0.5;
      const ny = y / height - 0.5;
      // Multi-octave noise seeded by location
      const h =
        Math.sin(nx * 6 + seed * 0.7) * Math.cos(ny * 6 + seed * 1.3) * 8 +
        Math.sin(nx * 12 + seed * 2.1 + 1) * Math.cos(ny * 10 + seed * 0.4 + 2) * 4 +
        Math.sin(nx * 25 + seed * 3.7) * Math.cos(ny * 25 + seed * 0.9) * 1.5 +
        Math.cos(Math.sqrt(nx * nx + ny * ny) * 15 + seed * 1.1) * 3;
      data[y * width + x] = h;
    }
  }
  return data;
}

function generateSyntheticData(
  width: number, height: number,
  min: number, max: number, seed: number,
): Float32Array {
  const data = new Float32Array(width * height);
  const range = max - min;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nx = x / width;
      const ny = y / height;
      let val = 0.5 + 0.2 * Math.sin(nx * 3.14 + seed) * Math.cos(ny * 2.7 + seed * 0.7);
      val += 0.15 * Math.sin(nx * 8.5 + ny * 6.3 + seed * 1.3);
      val += 0.1 * Math.cos(nx * 12.1 - ny * 9.7 + seed * 2.1);
      const noiseX = Math.sin(x * 127.1 + y * 311.7 + seed * 43.7) * 43758.5453;
      val += 0.08 * (noiseX - Math.floor(noiseX) - 0.5);
      const noiseY = Math.sin(x * 269.5 + y * 183.3 + seed * 97.1) * 28461.3217;
      val += 0.06 * (noiseY - Math.floor(noiseY) - 0.5);
      val = Math.max(0, Math.min(1, val));
      data[y * width + x] = min + val * range;
    }
  }
  return data;
}

// ── Build annotations from real API data ─────────────────────────────

interface AnnotationDef {
  pos: THREE.Vector3;
  title: string;
  desc: string;
  data: Record<string, unknown>;
  color: number;
}

function buildAnnotations(
  weather: WeatherResponse | null,
  soil: SoilResponse | null,
  lat: number, lon: number,
): AnnotationDef[] {
  const annotations: AnnotationDef[] = [];

  // Center: farm location marker
  annotations.push({
    pos: new THREE.Vector3(0, 9, 0),
    title: 'Your Farm',
    desc: `${lat.toFixed(2)}°N, ${lon.toFixed(2)}°E`,
    data: { type: 'farm', lat, lon },
    color: 0x00ff88,
  });

  // Weather data — use latest day with real data
  if (weather?.data.length) {
    const latest = weather.data.slice().reverse().find(d => d.temperature_max !== null)
      ?? weather.data[weather.data.length - 1];
    annotations.push({
      pos: new THREE.Vector3(18, 8, -15),
      title: 'Weather Station',
      desc: [
        `${latest.temperature_max ?? '—'}°C / ${latest.temperature_min ?? '—'}°C`,
        `Rain: ${latest.precipitation ?? '—'} mm`,
        `Humidity: ${latest.relative_humidity ?? '—'}%`,
      ].join(' | '),
      data: {
        type: 'weather',
        date: latest.date,
        temp_max: latest.temperature_max,
        temp_min: latest.temperature_min,
        precipitation: latest.precipitation,
        solar_radiation: latest.solar_radiation,
        humidity: latest.relative_humidity,
        wind: latest.wind_speed,
        days_available: weather.data.length,
        source: weather.source,
      },
      color: 0xffaa00,
    });
  }

  // Soil — show as two sensor points with real profile data
  if (soil?.layers.length) {
    const topLayer = soil.layers[0];
    const deepLayer = soil.layers[soil.layers.length - 1];

    annotations.push({
      pos: new THREE.Vector3(-14, 6, 8),
      title: 'Soil — Topsoil',
      desc: `Clay: ${topLayer.clay ?? '—'}% | Sand: ${topLayer.sand ?? '—'}% | pH: ${topLayer.ph ?? '—'}`,
      data: {
        type: 'soil',
        depth: topLayer.depth_label,
        clay: topLayer.clay,
        sand: topLayer.sand,
        silt: topLayer.silt,
        ph: topLayer.ph,
        organic_carbon: topLayer.organic_carbon,
        source: soil.source,
      },
      color: 0x8b6914,
    });

    if (soil.layers.length > 1) {
      annotations.push({
        pos: new THREE.Vector3(12, 5, 16),
        title: `Soil — ${deepLayer.depth_label}`,
        desc: `Clay: ${deepLayer.clay ?? '—'}% | Sand: ${deepLayer.sand ?? '—'}% | pH: ${deepLayer.ph ?? '—'}`,
        data: {
          type: 'soil',
          depth: deepLayer.depth_label,
          clay: deepLayer.clay,
          sand: deepLayer.sand,
          silt: deepLayer.silt,
          ph: deepLayer.ph,
          organic_carbon: deepLayer.organic_carbon,
          source: soil.source,
        },
        color: 0x6b4914,
      });
    }
  }

  return annotations;
}

// ── Component ────────────────────────────────────────────────────────

export default function MapView({ lat, lon, simulationResult }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const terrainRef = useRef<TerrainMesh | null>(null);

  const playerRef = useRef<TimeSeriesPlayer | null>(null);

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [activeOverlay, setActiveOverlay] = useState<OverlayType>(null);
  const [layers, setLayers] = useState<LayerEntry[]>([]);
  const [selectedAnnotation, setSelectedAnnotation] = useState<Annotation | null>(null);

  // Simulation playback state
  const [simPlaying, setSimPlaying] = useState(false);
  const [simFrame, setSimFrame] = useState(0);
  const [simTotal, setSimTotal] = useState(0);

  // ── Engine lifecycle (recreate on lat/lon change) ──────────────────

  useEffect(() => {
    if (!containerRef.current) return;

    // Dispose previous
    if (engineRef.current) {
      engineRef.current.dispose();
      engineRef.current = null;
      terrainRef.current = null;
    }

    setStatus('loading');
    setError(null);
    setActiveOverlay(null);
    setSelectedAnnotation(null);

    const controller = new AbortController();

    // Fetch real data in parallel with engine init
    const dataPromise = Promise.allSettled([
      getWeather(lat, lon),
      getSoil(lat, lon),
    ]);

    try {
      const engine = new Engine({
        container: containerRef.current,
        antialias: true,
        backgroundColor: 0x0a0a1a,
        enableShadows: true,
      });

      const agriculturePlugin: VerticalPlugin = {
        name: 'agriculture',
        async init(eng) {
          // ── Terrain (seeded by location so each city looks different) ──
          const seed = lat * 100 + lon;
          const heightData = generateSeededHeightmap(256, 256, seed);
          const terrain = new TerrainMesh({
            heightData, width: 256, height: 256, heightScale: 1,
          });
          terrainRef.current = terrain;

          const terrainLayer = eng.layers.add({ name: 'Terrain', visible: true });
          terrain.addTo(terrainLayer.group);

          // ── Crop zone overlay ──
          const cropLayer = eng.layers.add({ name: 'Crop Zones', visible: true, opacity: 0.6 });
          const zoneGeom = new THREE.CircleGeometry(15, 32);
          zoneGeom.rotateX(-Math.PI / 2);
          const zoneMat = new THREE.MeshStandardMaterial({
            color: 0x22cc44, transparent: true, opacity: 0.3, side: THREE.DoubleSide,
          });
          const zone = new THREE.Mesh(zoneGeom, zoneMat);
          zone.position.set(0, 0.5, 0);
          cropLayer.group.add(zone);

          // ── Wait for real data, build annotations ──
          const [wResult, sResult] = await dataPromise;
          if (controller.signal.aborted) return;

          const weather = wResult.status === 'fulfilled' ? wResult.value : null;
          const soil = sResult.status === 'fulfilled' ? sResult.value : null;
          const annotationDefs = buildAnnotations(weather, soil, lat, lon);

          // Register annotations layer with engine's annotation group
          const annotGroup = eng.annotations.getGroup();
          eng.layers.add({ name: 'Data Markers', visible: true, group: annotGroup });

          // Create a separate layer for the colored sphere markers
          const markerLayer = eng.layers.add({ name: 'Marker Spheres', visible: true });

          for (const a of annotationDefs) {
            eng.annotations.addAnnotation(a.pos, a.title, a.desc, a.data);
            const marker = new THREE.Mesh(
              new THREE.SphereGeometry(0.6, 16, 16),
              new THREE.MeshStandardMaterial({ color: a.color, emissive: a.color, emissiveIntensity: 0.3 }),
            );
            marker.position.copy(a.pos);
            markerLayer.group.add(marker);
          }

          // ── Annotation click handler ──
          eng.annotations.onAnnotationClick((annotation: Annotation) => {
            setSelectedAnnotation(annotation);
          });

          // ── Farm boundary (GeoJSON) ──
          const boundaryLayer = eng.layers.add({ name: 'Field Boundary', visible: true });
          const geoOverlay = new GeoJSONOverlay({
            project: (lon_: number, lat_: number) => ({
              x: (lon_ - lon) * 11100 * 0.2,
              z: -(lat_ - lat) * 11100 * 0.2,
            }),
            elevation: 0.5,
            style: { strokeColor: 0x22cc44, fillColor: 0x22cc44, fillOpacity: 0.2 },
          });
          // Synthetic rectangular field boundary around the location
          const fieldSize = 0.003; // ~330m
          geoOverlay.setData({
            type: 'Feature',
            geometry: {
              type: 'Polygon',
              coordinates: [[
                [lon - fieldSize, lat - fieldSize],
                [lon + fieldSize, lat - fieldSize],
                [lon + fieldSize, lat + fieldSize],
                [lon - fieldSize, lat + fieldSize],
                [lon - fieldSize, lat - fieldSize],
              ]],
            },
            properties: { name: 'Demo Field' },
          });
          boundaryLayer.group.add(geoOverlay.group);

          // ── Camera ──
          eng.cameraController.setPosition(new THREE.Vector3(50, 60, 70));
          eng.cameraController.lookAt(new THREE.Vector3(0, 0, 0));

          // ── Track layers for UI ──
          setLayers(eng.layers.getAll());
          eng.layers.onChange(() => {
            setLayers([...eng.layers.getAll()]);
          });
        },
        dispose() {},
      };

      engine.registerPlugin(agriculturePlugin);
      engine.start();
      engineRef.current = engine;
      setStatus('ready');
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : 'Failed to initialize 3D engine');
    }

    return () => {
      controller.abort();
      if (engineRef.current) {
        engineRef.current.dispose();
        engineRef.current = null;
        terrainRef.current = null;
      }
    };
  }, [lat, lon]);

  // ── Auto-play simulation when result arrives ──────────────────────

  useEffect(() => {
    if (simulationResult && terrainRef.current) {
      startSimulation(simulationResult);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simulationResult]);

  // ── Overlay controls ───────────────────────────────────────────────

  const applyOverlay = useCallback((overlayInfo: OverlayInfo) => {
    const terrain = terrainRef.current;
    if (!terrain) return;
    const vertexCount = terrain.getVertexCount();
    const size = Math.ceil(Math.sqrt(vertexCount));
    const seed = lat * 100 + lon;
    const [min, max] = overlayInfo.dataRange;
    const data = generateSyntheticData(size, size, min, max,
      seed + (overlayInfo.type === 'ndvi' ? 0 : overlayInfo.type === 'soil_moisture' ? 1000 : 2000));
    terrain.setOverlay(data, { ...overlayInfo.config, dataWidth: size, dataHeight: size });
    setActiveOverlay(overlayInfo.type);
  }, [lat, lon]);

  const clearOverlay = useCallback(() => {
    terrainRef.current?.clearOverlay();
    setActiveOverlay(null);
  }, []);

  // ── Screenshot ────────────────────────────────────────────────────

  const handleScreenshot = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const exporter = new ScreenshotExporter(engine.renderer, engine.scene, engine.camera);
    exporter.download({ filename: 'krishitwin.png', width: 1920, height: 1080 });
  }, []);

  // ── Simulation playback ───────────────────────────────────────────

  const startSimulation = useCallback((result: SimulationResult) => {
    const terrain = terrainRef.current;
    if (!terrain) return;

    // Stop any existing player
    playerRef.current?.dispose();

    // Our WOFOST output uses 'date' not 'day' as the time field
    const laiSeries = SimulationOverlayBuilder.extractTimeSeries(result.daily_output, 'LAI', 'date');
    if (laiSeries.length === 0) return; // no LAI data (e.g., crop hasn't emerged)

    const frames = SimulationOverlayBuilder.buildFrames(laiSeries, {
      gridWidth: 64, gridHeight: 64, spatialPattern: 'noise',
    });
    if (frames.length === 0) return;

    const player = new TimeSeriesPlayer(terrain, frames, {
      colormap: { name: 'rdylgn', min: 0, max: 7 },
    });
    playerRef.current = player;

    player.onFrameChange((idx: number, total: number) => {
      setSimFrame(idx);
      setSimTotal(total);
    });

    setSimTotal(frames.length);
    setSimFrame(0);
    setSimPlaying(true);
    player.play(200);
  }, []);

  const toggleSimPlayback = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    if (simPlaying) {
      player.pause();
      setSimPlaying(false);
    } else {
      player.play(200);
      setSimPlaying(true);
    }
  }, [simPlaying]);

  const seekSim = useCallback((frame: number) => {
    playerRef.current?.setFrame(frame);
    setSimFrame(frame);
  }, []);

  // ── Layer toggle ───────────────────────────────────────────────────

  const toggleLayer = useCallback((name: string) => {
    engineRef.current?.layers.toggleVisible(name);
  }, []);

  // ── Render ─────────────────────────────────────────────────────────

  const activeInfo = OVERLAYS.find(o => o.type === activeOverlay);
  const annData = selectedAnnotation?.data as Record<string, unknown> | undefined;

  return (
    <div style={{ position: 'relative' }}>
      <div ref={containerRef} style={containerStyle} />

      {status === 'loading' && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          color: '#4af', fontSize: '1.2rem',
        }}>
          Initializing 3D terrain...
        </div>
      )}

      {status === 'error' && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          color: '#f44', fontSize: '1rem', flexDirection: 'column', gap: '0.5rem',
        }}>
          <span>3D Engine Error</span>
          <small>{error}</small>
        </div>
      )}

      {status === 'ready' && (
        <>
          {/* Top-left: location label */}
          <div style={{
            position: 'absolute', top: '12px', left: '12px',
            background: 'rgba(0,0,0,0.7)', color: '#fff',
            padding: '8px 12px', borderRadius: '6px', fontSize: '0.8rem',
          }}>
            ~1 km² terrain around ({lat.toFixed(2)}°N, {lon.toFixed(2)}°E)
            <br />
            <span style={{ fontSize: '0.7rem', color: '#aaa' }}>
              Orbit: drag | Zoom: scroll | Pan: right-drag | Click markers for details
            </span>
          </div>

          {/* Top-right: layer toggle panel */}
          {layers.length > 0 && (
            <div style={panelStyle}>
              <div style={{ fontWeight: 600, marginBottom: '6px', fontSize: '0.82rem' }}>Layers</div>
              {layers.map((layer) => (
                <label key={layer.name} style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  marginBottom: '4px', cursor: 'pointer', fontSize: '0.78rem',
                }}>
                  <input
                    type="checkbox"
                    checked={layer.visible}
                    onChange={() => toggleLayer(layer.name)}
                    style={{ accentColor: '#00d4ff' }}
                  />
                  {layer.name}
                </label>
              ))}
            </div>
          )}

          {/* Bottom-left: annotation info card */}
          {selectedAnnotation && (
            <div style={infoCardStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                <strong style={{ fontSize: '0.95rem', color: '#00d4ff' }}>
                  {selectedAnnotation.title}
                </strong>
                <button
                  onClick={() => setSelectedAnnotation(null)}
                  style={{
                    background: 'none', border: 'none', color: '#888',
                    cursor: 'pointer', fontSize: '1rem', padding: '0 0 0 8px',
                  }}
                >
                  ✕
                </button>
              </div>
              <div style={{ color: '#ccc', margin: '4px 0 8px', fontSize: '0.8rem' }}>
                {selectedAnnotation.content}
              </div>

              {/* Render detailed data based on annotation type */}
              {annData?.type === 'weather' && (
                <div style={{ fontSize: '0.78rem', lineHeight: 1.6 }}>
                  <div>Date: <strong>{annData.date as string}</strong></div>
                  <div>Temperature: <strong>{annData.temp_max as number}°C</strong> / {annData.temp_min as number}°C</div>
                  <div>Rainfall: <strong>{annData.precipitation as number} mm</strong></div>
                  <div>Sunlight: {annData.solar_radiation as number} MJ/m²/day</div>
                  <div>Humidity: {annData.humidity as number}%</div>
                  <div>Wind: {annData.wind as number} m/s</div>
                  <div style={{ color: '#888', marginTop: '4px' }}>
                    {annData.days_available as number} days from {annData.source as string}
                  </div>
                </div>
              )}

              {annData?.type === 'soil' && (
                <div style={{ fontSize: '0.78rem', lineHeight: 1.6 }}>
                  <div>Depth: <strong>{annData.depth as string}</strong></div>
                  <div>Clay: <strong>{annData.clay as number}%</strong> | Sand: {annData.sand as number}% | Silt: {annData.silt as number}%</div>
                  <div>pH: <strong>{annData.ph as number}</strong></div>
                  <div>Organic Carbon: {annData.organic_carbon as number} g/kg</div>
                  <div style={{ color: '#888', marginTop: '4px' }}>
                    Source: {annData.source as string}
                  </div>
                </div>
              )}

              {annData?.type === 'farm' && (
                <div style={{ fontSize: '0.78rem', color: '#aaa' }}>
                  Click other markers to see weather and soil data from this location.
                </div>
              )}
            </div>
          )}

          {/* Simulation playback controls */}
          {simTotal > 0 && (
            <div style={{
              position: 'absolute', bottom: '56px', left: '12px', right: '12px',
              background: 'rgba(0,0,0,0.85)', padding: '8px 14px',
              borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '10px',
              color: '#fff', fontSize: '0.78rem',
            }}>
              <button
                onClick={toggleSimPlayback}
                style={{
                  background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff',
                  padding: '4px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem',
                }}
              >
                {simPlaying ? '⏸' : '▶'}
              </button>
              <input
                type="range"
                min={0}
                max={Math.max(simTotal - 1, 0)}
                value={simFrame}
                onChange={(e) => seekSim(Number(e.target.value))}
                style={{ flex: 1, accentColor: '#4caf50' }}
              />
              <span style={{ minWidth: '80px', textAlign: 'right' }}>
                Day {simFrame + 1} / {simTotal}
              </span>
              <div style={{
                height: '10px', width: '80px', borderRadius: '3px',
                background: 'linear-gradient(to right, #a50026, #f46d43, #fee08b, #a6d96a, #1a9850, #006837)',
              }} />
              <span style={{ fontSize: '0.7rem', color: '#aaa' }}>LAI 0–7</span>
            </div>
          )}

          {/* Bottom-right: overlay toolbar + legend */}
          <div style={{
            position: 'absolute', bottom: '12px', right: '12px',
            display: 'flex', gap: '6px', alignItems: 'flex-end',
          }}>
            {/* Legend */}
            {activeInfo && (
              <div style={{
                background: 'rgba(0,0,0,0.8)', color: '#fff',
                padding: '8px 12px', borderRadius: '6px', fontSize: '0.75rem',
                marginRight: '8px', minWidth: '140px',
              }}>
                <div style={{ marginBottom: '4px', fontWeight: 600 }}>{activeInfo.label}</div>
                <div style={{
                  height: '12px', borderRadius: '3px',
                  background: activeInfo.gradientCSS, marginBottom: '4px',
                }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem' }}>
                  <span>{activeInfo.dataRange[0]}{activeInfo.unit ? ` ${activeInfo.unit}` : ''}</span>
                  <span>{activeInfo.dataRange[1]}{activeInfo.unit ? ` ${activeInfo.unit}` : ''}</span>
                </div>
                <div style={{ fontSize: '0.65rem', color: '#999', marginTop: '4px' }}>
                  Simulated pattern — real satellite data requires Sentinel API
                </div>
              </div>
            )}

            {/* Overlay buttons + screenshot */}
            <div style={{
              background: 'rgba(0,0,0,0.8)', padding: '6px',
              borderRadius: '8px', display: 'flex', gap: '4px',
            }}>
              {OVERLAYS.map((o) => (
                <button
                  key={o.type}
                  onClick={() => activeOverlay === o.type ? clearOverlay() : applyOverlay(o)}
                  style={{
                    padding: '6px 12px', borderRadius: '4px', border: 'none',
                    cursor: 'pointer', fontSize: '0.78rem',
                    fontWeight: activeOverlay === o.type ? 700 : 400,
                    background: activeOverlay === o.type ? '#1976d2' : 'rgba(255,255,255,0.15)',
                    color: '#fff', transition: 'background 0.15s',
                  }}
                >
                  {o.label}
                </button>
              ))}
              <button
                onClick={clearOverlay}
                style={{
                  padding: '6px 12px', borderRadius: '4px', border: 'none',
                  cursor: 'pointer', fontSize: '0.78rem',
                  background: activeOverlay === null ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.15)',
                  color: activeOverlay === null ? '#888' : '#fff',
                  transition: 'background 0.15s',
                }}
              >
                Clear
              </button>
              <div style={{ width: '1px', background: 'rgba(255,255,255,0.2)', margin: '2px 2px' }} />
              <button
                onClick={handleScreenshot}
                title="Download screenshot"
                style={{
                  padding: '6px 12px', borderRadius: '4px', border: 'none',
                  cursor: 'pointer', fontSize: '0.78rem',
                  background: 'rgba(255,255,255,0.15)', color: '#fff',
                  transition: 'background 0.15s',
                }}
              >
                Screenshot
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
