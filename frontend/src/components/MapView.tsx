import { useEffect, useRef, useState } from 'react';
import { Engine, DataLoader, TerrainMesh, type VerticalPlugin } from 'holographic-core';
import * as THREE from 'three';

interface Props {
  onLayersReady?: (engine: Engine) => void;
}

export default function MapView({ onLayersReady }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current || engineRef.current) return;

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

          // Generate sample terrain (Pune-like rolling hills)
          const terrainConfig = loader.generateSampleHeightmap(256, 256);
          const terrain = new TerrainMesh(terrainConfig);

          // Add terrain to a layer
          const terrainLayer = eng.layers.add({ name: 'Farm Terrain', visible: true });
          terrain.addTo(terrainLayer.group);

          // Add sensor markers
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
            // Add a small sphere marker
            const marker = new THREE.Mesh(
              new THREE.SphereGeometry(0.5, 16, 16),
              new THREE.MeshStandardMaterial({ color: 0x00ff88, emissive: 0x004422 }),
            );
            marker.position.copy(s.pos);
            sensorLayer.group.add(marker);
          }

          // Add crop zone overlay
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

          // Position camera for good initial view
          eng.cameraController.setPosition(new THREE.Vector3(50, 60, 70));
          eng.cameraController.lookAt(new THREE.Vector3(0, 0, 0));
        },
        dispose() {},
      };

      engine.registerPlugin(agriculturePlugin);
      engine.start();
      engineRef.current = engine;
      setStatus('ready');

      if (onLayersReady) onLayersReady(engine);
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : 'Failed to initialize 3D engine');
    }

    return () => {
      if (engineRef.current) {
        engineRef.current.dispose();
        engineRef.current = null;
      }
    };
  }, [onLayersReady]);

  return (
    <div style={{ position: 'relative' }}>
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '500px',
          borderRadius: '8px',
          overflow: 'hidden',
          background: '#0a0a1a',
        }}
      />
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
        <div style={{
          position: 'absolute', top: '12px', left: '12px',
          background: 'rgba(0,0,0,0.7)', color: '#fff',
          padding: '8px 12px', borderRadius: '6px', fontSize: '0.8rem',
        }}>
          Holographic Farm Digital Twin — Orbit: drag | Zoom: scroll | Pan: right-drag
        </div>
      )}
    </div>
  );
}
