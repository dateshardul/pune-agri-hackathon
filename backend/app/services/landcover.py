"""ESA WorldCover 10m land cover classification service.

Fetches LULC data from ESA WorldCover v200 COG tiles on AWS S3.
Returns land cover class percentages for a farm bounding box.
"""

import asyncio
import logging
import math

import numpy as np

from app.services.api_cache import get_cached, set_cached

logger = logging.getLogger(__name__)

# ESA WorldCover class codes → labels
LANDCOVER_CLASSES = {
    10: "trees",
    20: "shrub",
    30: "grass",
    40: "cropland",
    50: "built",
    60: "bare",
    70: "snow_ice",
    80: "water",
    90: "wetland",
    95: "mangrove",
    100: "moss_lichen",
}

CACHE_TTL = 24 * 3600  # 24 hours


def _tile_name(lat: float, lon: float) -> str:
    """Build ESA WorldCover tile name from lat/lon.

    Tiles are named by flooring lat/lon to nearest multiple of 3.
    E.g. Pune (18.52, 73.85) -> N18E072
    """
    lat_floor = int(math.floor(lat / 3) * 3)
    lon_floor = int(math.floor(lon / 3) * 3)
    ns = "N" if lat_floor >= 0 else "S"
    ew = "E" if lon_floor >= 0 else "W"
    return f"ESA_WorldCover_10m_2021_v200_{ns}{abs(lat_floor):02d}{ew}{abs(lon_floor):03d}_Map.tif"


def _build_tile_url(lat: float, lon: float) -> str:
    name = _tile_name(lat, lon)
    return f"https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/{name}"


async def fetch_landcover(
    lat: float, lon: float, field_area_ha: float = 1.0,
) -> dict | None:
    """Fetch ESA WorldCover land cover for the farm area.

    Returns percentages of each land cover class within the bounding box.
    """
    # Check cache
    cache_key_params = {"lat": round(lat, 3), "lon": round(lon, 3), "area": field_area_ha}
    cached = get_cached("landcover", ttl=CACHE_TTL, **cache_key_params)
    if cached:
        return cached

    try:
        import rasterio
        from rasterio.windows import Window

        url = _build_tile_url(lat, lon)

        # Compute bbox from field area (approximate square)
        side_m = math.sqrt(field_area_ha * 10000)
        # 10m resolution -> pixels needed
        side_px = max(10, int(side_m / 10))
        half_px = side_px // 2

        def _read():
            with rasterio.open(url) as src:
                row, col = src.index(lon, lat)
                col_off = max(0, col - half_px)
                row_off = max(0, row - half_px)
                win_w = min(side_px, src.width - col_off)
                win_h = min(side_px, src.height - row_off)
                window = Window(col_off, row_off, win_w, win_h)
                data = src.read(1, window=window)
                return data

        loop = asyncio.get_event_loop()
        data = await loop.run_in_executor(None, _read)

        total_pixels = data.size
        if total_pixels == 0:
            return None

        # Count each class
        unique, counts = np.unique(data, return_counts=True)
        class_counts = dict(zip(unique.tolist(), counts.tolist()))

        result = {}
        for code, label in LANDCOVER_CLASSES.items():
            pct = round(class_counts.get(code, 0) / total_pixels * 100, 1)
            result[f"{label}_pct"] = pct

        # Compute usable (cropland) area
        cropland_frac = class_counts.get(40, 0) / total_pixels
        result["usable_area_ha"] = round(cropland_frac * field_area_ha, 2)
        result["source"] = "ESA WorldCover 10m v200 (2021)"

        # Cache result
        set_cached("landcover", result, **cache_key_params)
        logger.info("Landcover fetched for (%.4f, %.4f): cropland=%.1f%%", lat, lon, result.get("cropland_pct", 0))
        return result

    except Exception as e:
        logger.warning("ESA WorldCover fetch failed: %s — using synthetic fallback", e)
        return _synthetic_landcover(lat, lon, field_area_ha)


def _synthetic_landcover(lat: float, lon: float, field_area_ha: float) -> dict:
    """Synthetic fallback — plausible LULC for Indian agricultural regions."""
    seed = int(abs(lat * 100 + lon * 10)) % (2**31)
    rng = np.random.RandomState(seed)

    # Generate plausible percentages for Indian agricultural landscape
    cropland = rng.uniform(55, 80)
    trees = rng.uniform(5, 20)
    built = rng.uniform(3, 15)
    remaining = max(0, 100 - cropland - trees - built)
    water = min(remaining, rng.uniform(0, 5))
    bare = min(remaining - water, rng.uniform(0, 5))
    grass = max(0, remaining - water - bare)

    result = {
        "trees_pct": round(trees, 1),
        "shrub_pct": round(rng.uniform(0, 3), 1),
        "grass_pct": round(grass, 1),
        "cropland_pct": round(cropland, 1),
        "built_pct": round(built, 1),
        "bare_pct": round(bare, 1),
        "snow_ice_pct": 0.0,
        "water_pct": round(water, 1),
        "wetland_pct": 0.0,
        "mangrove_pct": 0.0,
        "moss_lichen_pct": 0.0,
        "usable_area_ha": round(cropland / 100 * field_area_ha, 2),
        "source": "Synthetic (fallback)",
    }
    return result
