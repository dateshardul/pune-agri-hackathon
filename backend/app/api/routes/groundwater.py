"""Groundwater endpoints — aquifer status, depletion trends, crop switching advisory."""

from fastapi import APIRouter, HTTPException, Query

from app.services.groundwater import fetch_groundwater_analysis

router = APIRouter()


@router.get("/")
async def get_groundwater(
    lat: float = Query(..., ge=-90, le=90, description="Latitude"),
    lon: float = Query(..., ge=-180, le=180, description="Longitude"),
):
    """Fetch groundwater analysis: aquifer status, depletion projections, crop advisory."""
    try:
        return await fetch_groundwater_analysis(lat, lon)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Groundwater analysis error: {e}")
