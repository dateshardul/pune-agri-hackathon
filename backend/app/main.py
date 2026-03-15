from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import data, simulation, ozone, advisory

app = FastAPI(
    title="KrishiTwin API",
    description="Climate-resilient digital agriculture platform — backend services",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(data.router, prefix="/api/data", tags=["data"])
app.include_router(simulation.router, prefix="/api/simulate", tags=["simulation"])
app.include_router(ozone.router, prefix="/api/ozone", tags=["ozone"])
app.include_router(advisory.router, prefix="/api/advisory", tags=["advisory"])


@app.get("/health")
async def health():
    return {"status": "ok", "service": "krishitwin-api"}
