"""Elevation DEM endpoints — real 30m elevation grids."""

from fastapi import APIRouter, HTTPException, Query

from app.services.elevation import fetch_elevation_grid

router = APIRouter()


@router.get("/dem")
async def get_elevation_dem(
    lat: float = Query(..., ge=-90, le=90, description="Latitude"),
    lon: float = Query(..., ge=-180, le=180, description="Longitude"),
    size: int = Query(128, ge=16, le=512, description="Grid size in pixels"),
):
    """Get a DEM elevation grid centered on the given coordinates.

    Tries Copernicus GLO-30 (30m), then AWS Terrain Tiles, then synthetic fallback.
    """
    try:
        return await fetch_elevation_grid(lat, lon, size)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Elevation service error: {e}")
