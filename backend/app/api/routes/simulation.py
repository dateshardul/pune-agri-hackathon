"""Simulation endpoints — WOFOST crop simulation (stub)."""

from fastapi import APIRouter

router = APIRouter()


@router.post("/")
async def run_simulation():
    """Run a WOFOST crop simulation. (Coming in feat/simulation-engine)"""
    return {"status": "stub", "message": "WOFOST simulation not yet implemented"}


@router.get("/scenarios")
async def list_scenarios():
    """List available what-if scenarios. (Coming in feat/what-if-scenarios)"""
    return {"status": "stub", "scenarios": []}
