"""Elevation data service — 30m DEM grids via Copernicus/AWS with fallbacks."""

import asyncio
import logging
import math
from io import BytesIO

import httpx
import numpy as np

logger = logging.getLogger(__name__)


def _tile_key(lat: float, lon: float) -> str:
    """Build Copernicus COG tile key from lat/lon."""
    lat_int = int(math.floor(lat))
    lon_int = int(math.floor(lon))
    ns = "N" if lat_int >= 0 else "S"
    ew = "E" if lon_int >= 0 else "W"
    lat_str = f"{abs(lat_int):02d}"
    lon_str = f"{abs(lon_int):03d}"
    base = f"Copernicus_DSM_COG_10_{ns}{lat_str}_00_{ew}{lon_str}_00_DEM"
    return f"{base}/{base}.tif"


async def _fetch_copernicus(lat: float, lon: float, size_px: int) -> dict | None:
    """Strategy 1: Copernicus GLO-30 COG via rasterio HTTP range reads."""
    try:
        import rasterio
        from rasterio.windows import Window

        tile_key = _tile_key(lat, lon)
        url = f"https://copernicus-dem-30m.s3.eu-central-1.amazonaws.com/{tile_key}"

        def _read():
            with rasterio.open(url) as src:
                # Convert lat/lon to pixel coordinates
                row, col = src.index(lon, lat)
                half = size_px // 2
                # Clamp window to dataset bounds
                col_off = max(0, col - half)
                row_off = max(0, row - half)
                win_width = min(size_px, src.width - col_off)
                win_height = min(size_px, src.height - row_off)
                window = Window(col_off, row_off, win_width, win_height)
                data = src.read(1, window=window)
                return data

        loop = asyncio.get_event_loop()
        data = await loop.run_in_executor(None, _read)
        flat = data.astype(float).flatten().tolist()
        logger.info("Elevation fetched via Copernicus GLO-30 for (%.4f, %.4f)", lat, lon)
        return {
            "height_data": flat,
            "width": data.shape[1],
            "height": data.shape[0],
            "min_elevation": float(np.min(data)),
            "max_elevation": float(np.max(data)),
            "source": "Copernicus GLO-30 (30m resolution)",
        }
    except Exception as e:
        logger.warning("Copernicus GLO-30 failed: %s", e)
        return None


def _latlon_to_tile(lat: float, lon: float, zoom: int) -> tuple[int, int]:
    """Convert lat/lon to slippy map tile x/y."""
    n = 2 ** zoom
    x = int((lon + 180.0) / 360.0 * n)
    lat_rad = math.radians(lat)
    y = int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)
    return x, y


async def _fetch_aws_terrain(lat: float, lon: float, size_px: int) -> dict | None:
    """Strategy 2: AWS Terrain Tiles (Terrarium encoding)."""
    try:
        from PIL import Image

        zoom = 12
        x, y = _latlon_to_tile(lat, lon, zoom)
        url = f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{zoom}/{x}/{y}.png"

        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url)
            resp.raise_for_status()

        img = Image.open(BytesIO(resp.content)).convert("RGB")
        arr = np.array(img, dtype=np.float64)
        elevation = (arr[:, :, 0] * 256.0 + arr[:, :, 1] + arr[:, :, 2] / 256.0) - 32768.0

        # Crop/resize to requested size
        if elevation.shape[0] > size_px or elevation.shape[1] > size_px:
            center_r, center_c = elevation.shape[0] // 2, elevation.shape[1] // 2
            half = size_px // 2
            r0 = max(0, center_r - half)
            c0 = max(0, center_c - half)
            elevation = elevation[r0:r0 + size_px, c0:c0 + size_px]

        flat = elevation.flatten().tolist()
        logger.info("Elevation fetched via AWS Terrain Tiles for (%.4f, %.4f)", lat, lon)
        return {
            "height_data": flat,
            "width": elevation.shape[1],
            "height": elevation.shape[0],
            "min_elevation": float(np.min(elevation)),
            "max_elevation": float(np.max(elevation)),
            "source": "AWS Terrain Tiles (zoom 12)",
        }
    except Exception as e:
        logger.warning("AWS Terrain Tiles failed: %s", e)
        return None


def _synthetic_heightmap(lat: float, lon: float, size_px: int) -> dict:
    """Strategy 3: Procedural heightmap seeded by location."""
    seed = int(abs(lat * 100 + lon)) % (2**31)
    rng = np.random.RandomState(seed)
    # Multi-octave noise for realistic terrain
    data = np.zeros((size_px, size_px))
    for octave in range(4):
        freq = 2 ** octave
        amp = 1.0 / freq
        noise = rng.rand(size_px // freq + 2, size_px // freq + 2)
        # Simple upscale via repeat
        scaled = np.repeat(np.repeat(noise, freq, axis=0), freq, axis=1)
        data += scaled[:size_px, :size_px] * amp
    # Scale to plausible elevation range (500-700m for Pune-like terrain)
    base_elev = 500.0 + (lat + lon) % 10 * 20
    data = base_elev + data * 200.0
    flat = data.flatten().tolist()
    logger.info("Using synthetic elevation for (%.4f, %.4f)", lat, lon)
    return {
        "height_data": flat,
        "width": size_px,
        "height": size_px,
        "min_elevation": float(np.min(data)),
        "max_elevation": float(np.max(data)),
        "source": "Synthetic (procedural heightmap)",
    }


def compute_hillshade(
    elevation_data: list[float],
    width: int,
    height: int,
    cell_size: float = 30.0,
    azimuth: float = 315.0,
    altitude: float = 45.0,
) -> dict:
    """Compute hillshade from elevation array using numpy gradient.

    Returns sun exposure percentage and hillshade grid for crop zone planning.
    """
    arr = np.array(elevation_data).reshape(height, width)
    dy, dx = np.gradient(arr, cell_size)
    slope = np.arctan(np.sqrt(dx**2 + dy**2))
    aspect = np.arctan2(-dx, dy)
    az_rad = np.radians(azimuth)
    alt_rad = np.radians(altitude)
    shade = (
        np.sin(alt_rad) * np.cos(slope)
        + np.cos(alt_rad) * np.sin(slope) * np.cos(az_rad - aspect)
    )
    sun_pct = float(np.mean(shade > 0.5) * 100)
    return {
        "sun_exposure_pct": round(sun_pct, 1),
        "shaded_pct": round(100 - sun_pct, 1),
        "hillshade_grid": shade.flatten().tolist(),
    }


async def fetch_elevation_grid(lat: float, lon: float, size_px: int = 128) -> dict:
    """Fetch elevation grid trying Copernicus, then AWS Terrain, then synthetic."""
    # Strategy 1: Copernicus GLO-30
    result = await _fetch_copernicus(lat, lon, size_px)
    if result:
        return result

    # Strategy 2: AWS Terrain Tiles
    result = await _fetch_aws_terrain(lat, lon, size_px)
    if result:
        return result

    # Strategy 3: Synthetic fallback
    return _synthetic_heightmap(lat, lon, size_px)
