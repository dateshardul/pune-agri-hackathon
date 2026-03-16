"""OzoneSight endpoints — tropospheric ozone tracking + crop yield loss."""

from datetime import date

from fastapi import APIRouter, HTTPException, Query

from app.services.ozone_sight import fetch_ozone_analysis

router = APIRouter()


@router.get("/")
async def get_ozone_analysis(
    lat: float = Query(..., ge=-90, le=90, description="Latitude"),
    lon: float = Query(..., ge=-180, le=180, description="Longitude"),
    crop: str = Query("wheat", description="Crop to assess yield impact for"),
    sowing_date: date | None = Query(None, description="Sowing date (YYYY-MM-DD)"),
    growing_days: int = Query(120, ge=30, le=365, description="Growing season length"),
):
    """Get ozone exposure analysis and crop yield impact estimate.

    Combines regional ozone climatology with exposure-response functions
    to estimate yield loss for a given crop at a given location.
    """
    try:
        return await fetch_ozone_analysis(lat, lon, crop, sowing_date, growing_days)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OzoneSight error: {e}")
