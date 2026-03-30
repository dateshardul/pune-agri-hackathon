import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Engine, TerrainMesh,
  ScreenshotExporter, SimulationOverlayBuilder, TimeSeriesPlayer, GeoJSONOverlay,
  type VerticalPlugin, type Annotation, type LayerEntry,
} from 'holographic-core';
import type { OverlayConfig } from 'holographic-core';
import * as THREE from 'three';
import { getWeather, getSoil, getElevation, type WeatherResponse, type SoilResponse, type SimulationResult, type ElevationData } from '../services/api';

interface CropZoneWithName {
  type: string;
  elevation_range: [number, number];
  area_ha: number;
  area_fraction: number;
  color: string;
  reason: string;
  crop: string;
}

interface LandcoverData {
  cropland_pct: number;
  trees_pct: number;
  built_pct: number;
  water_pct: number;
  bare_pct: number;
}

interface Props {
  lat: number;
  lon: number;
  simulationResult?: SimulationResult | null;
  cropZones?: CropZoneWithName[];
  highlightedCrop?: string | null;
  onCropZoneClick?: (cropName: string) => void;
  landcover?: LandcoverData;
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
  stops: string[]; // Farmer-friendly legend labels
}

const OVERLAYS: OverlayInfo[] = [
  {
    label: 'Crop Health (NDVI)',
    type: 'ndvi',
    config: { colormap: { name: 'rdylgn', min: 0.2, max: 0.9 } },
    dataRange: [0.2, 0.9],
    unit: '',
    gradientCSS: 'linear-gradient(to right, #a50026, #f46d43, #fee08b, #a6d96a, #1a9850, #006837)',
    stops: ['Stressed', 'Moderate', 'Healthy', 'Vigorous'],
  },
  {
    label: 'Soil Moisture',
    type: 'soil_moisture',
    config: { colormap: { name: 'cool', min: 0.1, max: 0.6 } },
    dataRange: [0.1, 0.6],
    unit: '',
    gradientCSS: 'linear-gradient(to right, #00ffff, #8080ff, #ff00ff)',
    stops: ['Dry', 'Adequate', 'Wet', 'Saturated'],
  },
  {
    label: 'Ozone Damage',
    type: 'ozone_damage',
    config: { colormap: { name: 'hot', min: 0, max: 15 } },
    dataRange: [0, 15],
    unit: '% crop loss',
    gradientCSS: 'linear-gradient(to right, #000000, #e50000, #ff8c00, #ffff00, #ffffff)',
    stops: ['None', 'Low', 'Moderate', 'Severe'],
  },
];

// ── Styles (static to avoid re-render churn) ─────────────────────────

const containerStyle = {
  width: '100%',
  height: '500px',
  borderRadius: '8px',
  overflow: 'hidden' as const,
  background: '#d4e6f1',
};

const panelStyle = {
  position: 'absolute' as const, top: '72px', right: '12px',
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

export default function MapView({ lat, lon, simulationResult, cropZones, highlightedCrop, onCropZoneClick: _onCropZoneClick, landcover }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const terrainRef = useRef<TerrainMesh | null>(null);

  const playerRef = useRef<TimeSeriesPlayer | null>(null);

  // Store simulation overlay frame sets keyed by overlay type
  const overlayFramesRef = useRef<Record<string, { frames: Float32Array[], config: OverlayConfig, series?: { time: unknown, value: number }[] }>>({});
  // Track which overlay type the current player is showing ('lai' default, or overlay type)
  const activeSimOverlayRef = useRef<string>('lai');

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [activeOverlay, setActiveOverlay] = useState<OverlayType>(null);
  const [layers, setLayers] = useState<LayerEntry[]>([]);
  const [selectedAnnotation, setSelectedAnnotation] = useState<Annotation | null>(null);

  // Elevation info for display
  const [elevationRange, setElevationRange] = useState<{ min: number; max: number } | null>(null);

  // Farm range selection
  const FARM_RANGES = [
    { label: '500m', size: 16 },
    { label: '1 km', size: 34 },
    { label: '2 km', size: 67 },
    { label: '5 km', size: 167 },
  ] as const;
  const [farmRange, setFarmRange] = useState<number>(67); // default 2 km

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
      getElevation(lat, lon, farmRange),
    ]);

    try {
      const engine = new Engine({
        container: containerRef.current,
        antialias: true,
        backgroundColor: 0xd4e6f1,
        enableShadows: true,
      });

      const agriculturePlugin: VerticalPlugin = {
        name: 'agriculture',
        async init(eng) {
          // ── Wait for data so we can use real elevation ──
          const [wResult, sResult, eResult] = await dataPromise;
          if (controller.signal.aborted) return;

          const weather = wResult.status === 'fulfilled' ? wResult.value : null;
          const soil = sResult.status === 'fulfilled' ? sResult.value : null;
          const elevResult: ElevationData | null = eResult.status === 'fulfilled' ? eResult.value : null;

          // ── Terrain ──
          let terrain: TerrainMesh;
          let elevMin: number | null = null;
          let elevMax: number | null = null;

          if (elevResult) {
            const rawHeight = new Float32Array(elevResult.height_data);
            for (let i = 0; i < rawHeight.length; i++) {
              rawHeight[i] -= elevResult.min_elevation;
            }
            const elevRange = elevResult.max_elevation - elevResult.min_elevation;
            terrain = new TerrainMesh({
              heightData: rawHeight,
              width: elevResult.width,
              height: elevResult.height,
              heightScale: elevRange > 0 ? 2 / elevRange : 1,
            });
            elevMin = elevResult.min_elevation;
            elevMax = elevResult.max_elevation;
          } else {
            // Fallback: procedural heightmap seeded by location
            const seed = lat * 100 + lon;
            const heightData = generateSeededHeightmap(256, 256, seed);
            terrain = new TerrainMesh({
              heightData, width: 256, height: 256, heightScale: 0.2,
            });
          }
          terrainRef.current = terrain;
          if (elevMin !== null && elevMax !== null) {
            setElevationRange({ min: elevMin, max: elevMax });
          } else {
            setElevationRange(null);
          }

          const terrainLayer = eng.layers.add({ name: 'Terrain', visible: true });
          terrain.addTo(terrainLayer.group);

          // Simple green ground plane (no map overlay)
          {
            const groundSize = terrainRef.current ? (elevResult?.width ?? 64) * 0.2 * 2.5 : 50;
            const groundGeom = new THREE.PlaneGeometry(groundSize, groundSize);
            groundGeom.rotateX(-Math.PI / 2);
            const groundMat = new THREE.MeshStandardMaterial({ color: 0xb5c99a, roughness: 1 });
            const ground = new THREE.Mesh(groundGeom, groundMat);
            ground.position.y = -0.3;
            ground.receiveShadow = true;
            terrainLayer.group.add(ground);
          }

          // ── Crop Zones (parent layer with per-crop sub-layers) ──
          eng.layers.add({ name: 'Crop Zones', visible: true });
          if (cropZones && cropZones.length > 0 && elevResult) {
            const { height_data: hData, width: gridW, height: gridH, min_elevation: eMin, max_elevation: eMax } = elevResult;
            const eRange = eMax - eMin;
            const hScl = eRange > 0 ? 2 / eRange : 1;
            const planeSize = gridW * 0.2;
            const segs = Math.min(gridW - 1, 127);

            cropZones.forEach((cz) => {
              const cropName = cz.crop.charAt(0).toUpperCase() + cz.crop.slice(1);
              // Each crop gets its own toggleable layer
              const layer = eng.layers.add({ name: `  ${cropName}`, visible: true, opacity: 0.6 });

              // Add margin to elevation range so flat/boundary areas are included
              const rawRange = cz.elevation_range ?? [eMin, eMax];
              const zLow = rawRange[0] - 5;
              const zHigh = rawRange[1] + 5;
              const zoneColor = new THREE.Color(cz.color || '#4caf50');

              const geom = new THREE.PlaneGeometry(planeSize, planeSize, segs, segs);
              geom.rotateX(-Math.PI / 2);
              const pos = geom.attributes.position;
              const elevs = new Float32Array(pos.count);

              for (let i = 0; i < pos.count; i++) {
                const gx = Math.min(Math.max(Math.round(((pos.getX(i) / planeSize) + 0.5) * (gridW - 1)), 0), gridW - 1);
                const gz = Math.min(Math.max(Math.round(((pos.getZ(i) / planeSize) + 0.5) * (gridH - 1)), 0), gridH - 1);
                const absElev = hData[Math.min(gz * gridW + gx, hData.length - 1)];
                pos.setY(i, (absElev - eMin) * hScl + 0.03);
                elevs[i] = absElev;
              }
              pos.needsUpdate = true;
              geom.computeVertexNormals();
              geom.setAttribute('elevation', new THREE.BufferAttribute(elevs, 1));

              const mat = new THREE.ShaderMaterial({
                uniforms: { uColor: { value: zoneColor }, uElevLow: { value: zLow }, uElevHigh: { value: zHigh } },
                vertexShader: `attribute float elevation; varying float vElev; void main() { vElev = elevation; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
                fragmentShader: `uniform vec3 uColor; uniform float uElevLow; uniform float uElevHigh; varying float vElev; void main() { if (vElev < uElevLow || vElev > uElevHigh) discard; gl_FragColor = vec4(uColor, 0.25); }`,
                transparent: true, side: THREE.DoubleSide, depthWrite: false,
              });

              const mesh = new THREE.Mesh(geom, mat);
              // Store crop name for click detection
              mesh.userData = { cropName: cz.crop };
              layer.group.add(mesh);

              // Label sprite
              const centerY = ((zLow + zHigh) / 2 - eMin) * hScl;
              const canvas = document.createElement('canvas');
              canvas.width = 300; canvas.height = 64;
              const ctx = canvas.getContext('2d');
              if (ctx) {
                ctx.fillStyle = cz.color || '#4caf50';
                ctx.roundRect(0, 0, 300, 64, 8); ctx.fill();
                ctx.fillStyle = '#fff';
                ctx.font = 'bold 26px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(`${cropName} (${cz.type || 'field'})`, 150, 42);
                const tex = new THREE.CanvasTexture(canvas);
                const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.9 });
                const sprite = new THREE.Sprite(spriteMat);
                sprite.position.set(0, centerY + 2.0, 0);
                sprite.scale.set(8, 2, 1);
                layer.group.add(sprite);
              }
            });
          } else if (cropZones && cropZones.length > 0) {
            // Fallback without elevation
            const zoneTypes = ['valley', 'slope', 'hilltop'];
            cropZones.forEach((cz, idx) => {
              const cropName = cz.crop.charAt(0).toUpperCase() + cz.crop.slice(1);
              const layer = eng.layers.add({ name: `  ${cropName}`, visible: true, opacity: 0.6 });
              const zoneGeom = new THREE.PlaneGeometry(12, 12 * (cz.area_fraction || 0.3));
              zoneGeom.rotateX(-Math.PI / 2);
              const zoneMat = new THREE.MeshStandardMaterial({
                color: new THREE.Color(cz.color || '#4caf50'), transparent: true, opacity: 0.35, side: THREE.DoubleSide,
              });
              const zoneMesh = new THREE.Mesh(zoneGeom, zoneMat);
              zoneMesh.userData = { cropName: cz.crop };
              const typeIdx = zoneTypes.indexOf(cz.type || '');
              const zOff = (typeIdx >= 0 ? typeIdx - 1 : idx - 1) * 5;
              zoneMesh.position.set(0, 0.3, zOff);
              layer.group.add(zoneMesh);
            });
          }

          // ── Build annotations from fetched data ──
          const annotationDefs = buildAnnotations(weather, soil, lat, lon);

          // Register annotations layer with engine's annotation group
          const annotGroup = eng.annotations.getGroup();
          eng.layers.add({ name: 'Data Markers', visible: true, group: annotGroup });

          // Create a separate layer for the colored sphere markers
          const markerLayer = eng.layers.add({ name: 'Marker Spheres', visible: true });

          // Use sprites for constant screen-size markers (don't scale with zoom)
          const markerMeshes: THREE.Mesh[] = [];
          for (const a of annotationDefs) {
            eng.annotations.addAnnotation(a.pos, a.title, a.desc, a.data);
            const marker = new THREE.Mesh(
              new THREE.SphereGeometry(0.6, 16, 16),
              new THREE.MeshStandardMaterial({ color: a.color, emissive: a.color, emissiveIntensity: 0.3 }),
            );
            marker.position.copy(a.pos);
            markerLayer.group.add(marker);
            markerMeshes.push(marker);
          }

          // Scale markers inversely with camera distance to keep constant screen size
          eng.onUpdate(() => {
            const camPos = eng.camera.position;
            for (const m of markerMeshes) {
              const dist = camPos.distanceTo(m.position);
              const scale = Math.max(0.3, dist / 80);
              m.scale.setScalar(scale);
            }
          });

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
            style: { strokeColor: 0x22cc44, fillColor: 0x22cc44, fillOpacity: 0.05, strokeWidth: 2 },
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
  }, [lat, lon, farmRange]);

  // ── Auto-play simulation when result arrives ──────────────────────

  useEffect(() => {
    if (simulationResult && terrainRef.current) {
      startSimulation(simulationResult);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simulationResult]);

  // ── Highlight a specific crop zone when selected from timeline ────

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !cropZones) return;
    const allLayers = engine.layers.getAll();
    for (const layer of allLayers) {
      if (layer.name.startsWith('  ')) {
        // Indented names = crop zone sub-layers
        const cropInLayer = layer.name.trim().toLowerCase();
        if (!highlightedCrop) {
          engine.layers.setVisible(layer.name, true);
          engine.layers.setOpacity(layer.name, 0.6);
        } else {
          const isMatch = cropInLayer === highlightedCrop.toLowerCase();
          engine.layers.setVisible(layer.name, true);
          engine.layers.setOpacity(layer.name, isMatch ? 0.8 : 0.15);
        }
      }
    }
  }, [highlightedCrop, cropZones]);

  // ── Overlay controls ───────────────────────────────────────────────

  // Switch the active TimeSeriesPlayer to a different overlay's frame set
  const switchSimOverlay = useCallback((overlayKey: string) => {
    const terrain = terrainRef.current;
    if (!terrain) return false;
    const entry = overlayFramesRef.current[overlayKey];
    if (!entry || entry.frames.length === 0) return false;

    // Preserve current frame position
    const wasPlaying = playerRef.current?.isPlaying() ?? false;
    const currentFrame = playerRef.current?.getCurrentFrame() ?? 0;
    playerRef.current?.dispose();

    const player = new TimeSeriesPlayer(terrain, entry.frames, entry.config);
    playerRef.current = player;
    player.onFrameChange((idx: number, total: number) => {
      setSimFrame(idx);
      setSimTotal(total);
    });

    // Seek to same frame position (clamped to new frame count)
    const targetFrame = Math.min(currentFrame, entry.frames.length - 1);
    player.setFrame(targetFrame);
    setSimTotal(entry.frames.length);
    setSimFrame(targetFrame);

    if (wasPlaying) {
      player.play(200);
      setSimPlaying(true);
    }

    activeSimOverlayRef.current = overlayKey;
    return true;
  }, []);

  const applyOverlay = useCallback((overlayInfo: OverlayInfo) => {
    const terrain = terrainRef.current;
    if (!terrain) return;

    // If simulation frames exist for this overlay type, use them (animated)
    if (overlayInfo.type && overlayFramesRef.current[overlayInfo.type]) {
      switchSimOverlay(overlayInfo.type);
      setActiveOverlay(overlayInfo.type);
      return;
    }

    // Fallback: static synthetic data (no simulation running)
    // Pause any running player first
    playerRef.current?.pause();
    setSimPlaying(false);

    const vertexCount = terrain.getVertexCount();
    const size = Math.ceil(Math.sqrt(vertexCount));
    const seed = lat * 100 + lon;
    const [min, max] = overlayInfo.dataRange;
    const data = generateSyntheticData(size, size, min, max,
      seed + (overlayInfo.type === 'ndvi' ? 0 : overlayInfo.type === 'soil_moisture' ? 1000 : 2000));
    terrain.setOverlay(data, { ...overlayInfo.config, dataWidth: size, dataHeight: size });
    setActiveOverlay(overlayInfo.type);
  }, [lat, lon, switchSimOverlay]);

  const clearOverlay = useCallback(() => {
    // If simulation frames exist, revert to LAI view instead of clearing entirely
    if (overlayFramesRef.current.lai) {
      switchSimOverlay('lai');
      setActiveOverlay(null);
      return;
    }
    terrainRef.current?.clearOverlay();
    setActiveOverlay(null);
  }, [switchSimOverlay]);

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

    const gridOpts = { gridWidth: 64, gridHeight: 64, spatialPattern: 'noise' as const };

    // Build frame sets for all available overlays
    const laiSeries = SimulationOverlayBuilder.extractTimeSeries(result.daily_output, 'LAI', 'date');
    const tagpSeries = SimulationOverlayBuilder.extractTimeSeries(result.daily_output, 'TAGP', 'date');
    const smSeries = SimulationOverlayBuilder.extractTimeSeries(result.daily_output, 'SM', 'date');

    if (laiSeries.length === 0) return;

    // Auto-compute colormap ranges from actual data for visible animation
    const laiMax = Math.max(1, ...laiSeries.map(s => s.value));
    const laiFrames = SimulationOverlayBuilder.buildFrames(laiSeries, gridOpts);
    const laiConfig: OverlayConfig = { colormap: { name: 'rdylgn', min: 0, max: laiMax }, dataWidth: 64, dataHeight: 64 };

    // Store all frame sets with data-driven ranges
    overlayFramesRef.current = {
      lai: { frames: laiFrames, config: laiConfig, series: laiSeries },
    };

    if (tagpSeries.length > 0) {
      const tagpMax = Math.max(1, ...tagpSeries.map(s => s.value));
      overlayFramesRef.current.ndvi = {
        frames: SimulationOverlayBuilder.buildFrames(tagpSeries, gridOpts),
        config: { colormap: { name: 'rdylgn', min: 0, max: tagpMax }, dataWidth: 64, dataHeight: 64 },
        series: tagpSeries,
      };
    }
    if (smSeries.length > 0) {
      const smMax = Math.max(0.01, ...smSeries.map(s => s.value));
      overlayFramesRef.current.soil_moisture = {
        frames: SimulationOverlayBuilder.buildFrames(smSeries, gridOpts),
        config: { colormap: { name: 'cool', min: 0, max: smMax }, dataWidth: 64, dataHeight: 64 },
        series: smSeries,
      };
    }

    // Start with LAI overlay by default
    activeSimOverlayRef.current = 'lai';
    if (laiFrames.length === 0) return;

    const player = new TimeSeriesPlayer(terrain, laiFrames, laiConfig);
    playerRef.current = player;

    player.onFrameChange((idx: number, total: number) => {
      setSimFrame(idx);
      setSimTotal(total);
    });

    setActiveOverlay(null);
    setSimTotal(laiFrames.length);
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
              <select
                value={farmRange}
                onChange={(e) => setFarmRange(Number(e.target.value))}
                style={{
                  background: 'rgba(255,255,255,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)',
                  borderRadius: '4px', padding: '2px 4px', fontSize: '0.78rem', cursor: 'pointer',
                }}
              >
                {FARM_RANGES.map((r) => (
                  <option key={r.size} value={r.size} style={{ background: '#222', color: '#fff' }}>
                    {r.label}
                  </option>
                ))}
              </select>
              <span>terrain around ({lat.toFixed(2)}°N, {lon.toFixed(2)}°E)</span>
            </div>
            {elevationRange && <div>Elevation: {Math.round(elevationRange.min)}–{Math.round(elevationRange.max)}m</div>}
            <span style={{ fontSize: '0.7rem', color: '#aaa' }}>
              Orbit: drag | Zoom: scroll | Pan: right-drag | Click markers for details
            </span>
          </div>

          {/* Compass */}
          <div style={{
            position: 'absolute', top: '12px', right: '12px',
            width: 50, height: 50,
            background: 'rgba(255,255,255,0.9)', borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            border: '2px solid #ddd', zIndex: 5,
          }}>
            <svg width="36" height="36" viewBox="0 0 36 36">
              {/* North arrow (red) */}
              <polygon points="18,2 22,18 18,14 14,18" fill="#c62828" />
              {/* South arrow (grey) */}
              <polygon points="18,34 22,18 18,22 14,18" fill="#bbb" />
              <text x="18" y="10" textAnchor="middle" fontSize="7" fontWeight="bold" fill="#c62828">N</text>
              <text x="18" y="32" textAnchor="middle" fontSize="6" fill="#999">S</text>
              <text x="5" y="20" textAnchor="middle" fontSize="6" fill="#999">W</text>
              <text x="31" y="20" textAnchor="middle" fontSize="6" fill="#999">E</text>
            </svg>
          </div>

          {/* Top-right: layer toggle panel (below compass) */}
          {layers.length > 0 && (() => {
            const baseLayers = layers.filter(l => !l.name.startsWith('  ') && l.name !== 'Crop Zones');
            const cropZoneLayers = layers.filter(l => l.name.startsWith('  '));
            const hasCropZones = cropZoneLayers.length > 0;

            return (
              <div style={panelStyle}>
                <div style={{ fontWeight: 600, marginBottom: '6px', fontSize: '0.82rem' }}>Layers</div>
                {baseLayers.map((layer) => (
                  <label key={layer.name} style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    marginBottom: '3px', cursor: 'pointer', fontSize: '0.76rem',
                  }}>
                    <input type="checkbox" checked={layer.visible}
                      onChange={() => toggleLayer(layer.name)} style={{ accentColor: '#00d4ff' }} />
                    {layer.name}
                  </label>
                ))}

                {hasCropZones && (
                  <>
                    <div style={{ fontWeight: 600, marginTop: '8px', marginBottom: '4px', fontSize: '0.78rem', color: '#4caf50', borderTop: '1px solid rgba(255,255,255,0.15)', paddingTop: '6px' }}>
                      Crop Zones
                    </div>
                    {cropZoneLayers.map((layer) => (
                      <label key={layer.name} style={{
                        display: 'flex', alignItems: 'center', gap: '6px',
                        marginBottom: '3px', cursor: 'pointer', fontSize: '0.74rem', paddingLeft: '8px',
                      }}>
                        <input type="checkbox" checked={layer.visible}
                          onChange={() => toggleLayer(layer.name)} style={{ accentColor: '#4caf50' }} />
                        {layer.name.trim()}
                      </label>
                    ))}
                  </>
                )}
              </div>
            );
          })()}

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

          {/* LULC summary legend */}
          {landcover && cropZones && cropZones.length > 0 && !selectedAnnotation && (
            <div style={{
              position: 'absolute', bottom: '60px', left: '12px',
              background: 'rgba(10,10,30,0.92)', color: '#fff',
              padding: '10px 14px', borderRadius: '8px', fontSize: '0.78rem',
              backdropFilter: 'blur(8px)',
              border: '1px solid rgba(0,212,255,0.3)',
              minWidth: '150px',
            }}>
              <div style={{ fontWeight: 600, marginBottom: '6px', fontSize: '0.8rem' }}>Land Use</div>
              {[
                { label: 'Cropland', pct: landcover.cropland_pct, color: '#8bc34a' },
                { label: 'Trees', pct: landcover.trees_pct, color: '#2e7d32' },
                { label: 'Built-up', pct: landcover.built_pct, color: '#757575' },
                { label: 'Water', pct: landcover.water_pct, color: '#1976d2' },
                { label: 'Bare', pct: landcover.bare_pct, color: '#d7ccc8' },
              ].filter(item => item.pct > 0).map(item => (
                <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
                  <div style={{
                    width: `${Math.max(8, item.pct * 0.8)}px`, height: '10px',
                    background: item.color, borderRadius: '2px', flexShrink: 0,
                  }} />
                  <span style={{ color: '#ccc', fontSize: '0.72rem' }}>
                    {item.label} <strong style={{ color: '#fff' }}>{item.pct}%</strong>
                  </span>
                </div>
              ))}
              <div style={{ fontSize: '0.62rem', color: '#888', marginTop: '4px' }}>ESA WorldCover 10m</div>
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
              {/* Show current metric value */}
              {(() => {
                const key = activeSimOverlayRef.current || 'lai';
                const entry = overlayFramesRef.current[key];
                const val = entry?.series?.[simFrame]?.value;
                const labels: Record<string, string> = { lai: 'LAI', ndvi: 'Biomass', soil_moisture: 'SM' };
                const units: Record<string, string> = { lai: '', ndvi: ' kg/ha', soil_moisture: '' };
                return val != null ? (
                  <span style={{ minWidth: '90px', textAlign: 'right', color: '#4caf50', fontWeight: 600 }}>
                    {labels[key] ?? key}: {val.toFixed(1)}{units[key] ?? ''}
                  </span>
                ) : null;
              })()}
              <div style={{
                height: '10px', width: '80px', borderRadius: '3px',
                background: activeOverlay
                  ? (OVERLAYS.find(o => o.type === activeOverlay)?.gradientCSS ?? 'linear-gradient(to right, #a50026, #f46d43, #fee08b, #a6d96a, #1a9850, #006837)')
                  : 'linear-gradient(to right, #a50026, #f46d43, #fee08b, #a6d96a, #1a9850, #006837)',
              }} />
              <span style={{ fontSize: '0.7rem', color: '#aaa' }}>
                {activeOverlay === 'ndvi' ? 'Biomass (TAGP)'
                  : activeOverlay === 'soil_moisture' ? 'SM 0–0.5'
                  : 'LAI 0–7'}
              </span>
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
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem' }}>
                  {activeInfo.stops.map((stop, i) => (
                    <span key={i}>{stop}</span>
                  ))}
                </div>
                <div style={{ fontSize: '0.65rem', color: '#999', marginTop: '4px' }}>
                  {activeOverlay && overlayFramesRef.current[activeOverlay]
                    ? 'Animated from WOFOST simulation'
                    : 'Simulated pattern — real satellite data requires Sentinel API'}
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
