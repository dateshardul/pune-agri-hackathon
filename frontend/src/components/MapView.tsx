import { useEffect, useRef } from 'react';

/**
 * MapView — will integrate holographic-core Engine + TerrainMesh here.
 * For now, renders a placeholder that shows the 3D viewport area.
 *
 * Future integration:
 *   import { Engine, DataLoader, TerrainMesh } from 'holographic-core';
 */
export default function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // TODO: Initialize holographic-core Engine here once core is ready
    // const engine = new Engine({ container: containerRef.current! });
    // engine.start();
    // return () => engine.dispose();
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '400px',
        background: 'linear-gradient(135deg, #0a0a1a 0%, #1a2a3a 100%)',
        borderRadius: '8px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#4af',
        fontSize: '1.2rem',
      }}
    >
      3D Terrain Viewport — awaiting holographic-core integration
    </div>
  );
}
