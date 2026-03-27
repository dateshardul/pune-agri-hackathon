"""Unified farm analysis endpoint — single call runs everything."""

from fastapi import APIRouter

from app.models.schemas import FarmAnalysisRequest
from app.services.unified_analysis import analyze_farm

router = APIRouter()


@router.post("/analyze")
async def analyze_farm_endpoint(req: FarmAnalysisRequest):
    """Run complete farm analysis: weather, soil, sowing optimization,
    WOFOST + AquaCrop + DSSAT simulations, ML prediction, and advisory.
    """
    result = await analyze_farm(
        lat=req.latitude,
        lon=req.longitude,
        crop=req.crop,
        field_area_ha=req.field_area_ha,
        elevation=req.elevation,
        preferred_sowing=req.preferred_sowing,
        water_budget_mm=req.water_budget_mm,
    )
    return result
