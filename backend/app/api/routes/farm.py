"""Unified farm analysis endpoint — single call runs everything."""

from fastapi import APIRouter

from app.models.schemas import FarmAnalysisRequest
from app.services.unified_analysis import analyze_farm

router = APIRouter()


@router.post("/analyze")
async def analyze_farm_endpoint(req: FarmAnalysisRequest):
    """Run complete multi-crop farm analysis: land cover, terrain zones,
    sowing optimization, crop-cycle hazards, and model simulations.
    """
    result = await analyze_farm(
        lat=req.latitude,
        lon=req.longitude,
        crops=req.crops,
        field_area_ha=req.field_area_ha,
        elevation=req.elevation,
        preferred_sowing=req.preferred_sowing,
        water_budget_mm=req.water_budget_mm,
    )
    return result
