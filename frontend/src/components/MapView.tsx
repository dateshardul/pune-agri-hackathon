import { useEffect, useRef, useState } from 'react';
import { Engine, DataLoader, TerrainMesh, type VerticalPlugin } from 'holographic-core';
import type { OverlayConfig } from 'holographic-core';
import * as THREE from 'three';

interface Props {
  lat: number;
  lon: number;
}

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

const containerStyle = {
  width: '100%',
  height: '500px',
  borderRadius: '8px',
  overflow: 'hidden' as const,
  background: '#0a0a1a',
};

/**
 * Generate synthetic spatial data that looks like real satellite imagery.
 */
function generateSyntheticData(
  width: number,
  height: number,
  min: number,
  max: number,
  seed: number,
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

export default function MapView({ lat, lon }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const terrainRef = useRef<TerrainMesh | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [activeOverlay, setActiveOverlay] = useState<OverlayType>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Dispose previous engine on lat/lon change
    if (engineRef.current) {
      engineRef.current.dispose();
      engineRef.current = null;
      terrainRef.current = null;
    }

    setStatus('loading');
    setError(null);
    setActiveOverlay(null);

    try {
      const engine = new Engine({
        container: containerRef.current,
        antialias: true,
        backgroundColor: 0x0a0a1a,
        enableShadows: true,
      });

      const agriculturePlugin: VerticalPlugin = {
        name: 'agriculture',
        init(eng) {
          const loader = new DataLoader();

          const terrainConfig = loader.generateSampleHeightmap(256, 256);
          const terrain = new TerrainMesh(terrainConfig);
          terrainRef.current = terrain;

          const terrainLayer = eng.layers.add({ name: 'Farm Terrain', visible: true });
          terrain.addTo(terrainLayer.group);

          const sensorPositions = [
            { pos: new THREE.Vector3(10, 8, -15), title: 'Weather Station', desc: 'Temp: 32°C | Humidity: 65%' },
            { pos: new THREE.Vector3(-12, 6, 8), title: 'Soil Sensor #1', desc: 'Moisture: 42% | pH: 6.8' },
            { pos: new THREE.Vector3(18, 5, 12), title: 'Soil Sensor #2', desc: 'Moisture: 38% | pH: 7.1' },
            { pos: new THREE.Vector3(-5, 7, -20), title: 'Rain Gauge', desc: 'Last 24h: 12mm' },
            { pos: new THREE.Vector3(0, 9, 0), title: 'Crop Monitor', desc: 'NDVI: 0.72 | Stage: Tillering' },
          ];

          const sensorLayer = eng.layers.add({ name: 'IoT Sensors', visible: true });

          for (const s of sensorPositions) {
            eng.annotations.addAnnotation(s.pos, s.title, s.desc);
            const marker = new THREE.Mesh(
              new THREE.SphereGeometry(0.5, 16, 16),
              new THREE.MeshStandardMaterial({ color: 0x00ff88, emissive: 0x004422 }),
            );
            marker.position.copy(s.pos);
            sensorLayer.group.add(marker);
          }

          const cropLayer = eng.layers.add({ name: 'Crop Zones', visible: true, opacity: 0.6 });
          const zoneGeom = new THREE.CircleGeometry(15, 32);
          zoneGeom.rotateX(-Math.PI / 2);
          const zoneMat = new THREE.MeshStandardMaterial({
            color: 0x22cc44,
            transparent: true,
            opacity: 0.3,
            side: THREE.DoubleSide,
          });
          const zone = new THREE.Mesh(zoneGeom, zoneMat);
          zone.position.set(0, 0.5, 0);
          cropLayer.group.add(zone);

          eng.cameraController.setPosition(new THREE.Vector3(50, 60, 70));
          eng.cameraController.lookAt(new THREE.Vector3(0, 0, 0));
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
      if (engineRef.current) {
        engineRef.current.dispose();
        engineRef.current = null;
        terrainRef.current = null;
      }
    };
  }, [lat, lon]);

  const applyOverlay = (overlayInfo: OverlayInfo) => {
    const terrain = terrainRef.current;
    if (!terrain) return;

    const vertexCount = terrain.getVertexCount();
    const size = Math.ceil(Math.sqrt(vertexCount));
    const seed = lat * 100 + lon;

    const [min, max] = overlayInfo.dataRange;
    const data = generateSyntheticData(size, size, min, max, seed + (overlayInfo.type === 'ndvi' ? 0 : overlayInfo.type === 'soil_moisture' ? 1000 : 2000));

    terrain.setOverlay(data, {
      ...overlayInfo.config,
      dataWidth: size,
      dataHeight: size,
    });
    setActiveOverlay(overlayInfo.type);
  };

  const clearOverlay = () => {
    const terrain = terrainRef.current;
    if (!terrain) return;
    terrain.clearOverlay();
    setActiveOverlay(null);
  };

  const activeInfo = OVERLAYS.find(o => o.type === activeOverlay);

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
          {/* Info label */}
          <div style={{
            position: 'absolute', top: '12px', left: '12px',
            background: 'rgba(0,0,0,0.7)', color: '#fff',
            padding: '8px 12px', borderRadius: '6px', fontSize: '0.8rem',
          }}>
            ~1 km² terrain around ({lat.toFixed(2)}°N, {lon.toFixed(2)}°E) — Orbit: drag | Zoom: scroll | Pan: right-drag
          </div>

          {/* Overlay toolbar */}
          <div style={{
            position: 'absolute', bottom: '12px', right: '12px',
            display: 'flex', gap: '6px', alignItems: 'flex-end',
          }}>
            {activeInfo && (
              <div style={{
                background: 'rgba(0,0,0,0.8)', color: '#fff',
                padding: '8px 12px', borderRadius: '6px', fontSize: '0.75rem',
                marginRight: '8px', minWidth: '140px',
              }}>
                <div style={{ marginBottom: '4px', fontWeight: 600 }}>{activeInfo.label}</div>
                <div style={{
                  height: '12px',
                  borderRadius: '3px',
                  background: activeInfo.gradientCSS,
                  marginBottom: '4px',
                }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem' }}>
                  <span>{activeInfo.dataRange[0]}{activeInfo.unit ? ` ${activeInfo.unit}` : ''}</span>
                  <span>{activeInfo.dataRange[1]}{activeInfo.unit ? ` ${activeInfo.unit}` : ''}</span>
                </div>
              </div>
            )}

            <div style={{
              background: 'rgba(0,0,0,0.8)',
              padding: '6px',
              borderRadius: '8px',
              display: 'flex',
              gap: '4px',
            }}>
              {OVERLAYS.map((o) => (
                <button
                  key={o.type}
                  onClick={() => activeOverlay === o.type ? clearOverlay() : applyOverlay(o)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '4px',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '0.78rem',
                    fontWeight: activeOverlay === o.type ? 700 : 400,
                    background: activeOverlay === o.type ? '#1976d2' : 'rgba(255,255,255,0.15)',
                    color: '#fff',
                    transition: 'background 0.15s',
                  }}
                >
                  {o.label}
                </button>
              ))}
              <button
                onClick={clearOverlay}
                style={{
                  padding: '6px 12px',
                  borderRadius: '4px',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '0.78rem',
                  background: activeOverlay === null ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.15)',
                  color: activeOverlay === null ? '#888' : '#fff',
                  transition: 'background 0.15s',
                }}
              >
                Clear
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
