"""Ozone tracking endpoints — Sentinel-5P ozone data (stub)."""

from fastapi import APIRouter

router = APIRouter()


@router.get("/")
async def get_ozone():
    """Get ozone data for a location. (Coming in feat/ozonesight)"""
    return {"status": "stub", "message": "OzoneSight not yet implemented"}
