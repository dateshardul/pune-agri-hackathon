# Pune Agri Hackathon 2026 — Project Context

## What This Is
Hackathon project for **Pune Agriculture Hackathon 2026** — India's first international agriculture hackathon.
Hosted at Agricultural College, Pune. Prizes: 1st place ₹25 lakh, runner-up ₹15 lakh.

## Status: FEATURE-COMPLETE — SUBMISSION READY
Theme 7: **Climate Resilient Digital Agriculture**
Project: **KrishiDisha** — New Direction to Smart Agriculture
Team: **DISHA** (दिशा)

**For full project context, architecture, and technical decisions, see: `docs/PROJECT_CONTEXT.md`**

### What's Built
- **Backend** (`backend/`): FastAPI with NASA POWER weather, SoilGrids soil (cached Pune fallback), WOFOST crop simulation (13 crops), what-if scenarios, OzoneSight ozone analysis, advisory stub
- **Frontend** (`frontend/`): React-TS via Vite — Dashboard, MapView (holographic-core 3D), ScenarioExplorer, OzoneSight, GroundwaterView, AdvisoryChat (stub)
- **Groundwater** (`backend/app/services/groundwater.py`): CGWB/GRACE-FO regional aquifer data, depletion projections, crop-switching advisory (13 crops)
- **Integration**: holographic-core 3D engine integrated for terrain + crop markers

### Git Workflow
```
master (always has a working demo)
  └── feat/data-pipeline  ← current (backend scaffold + data APIs)
```

### Running Locally
```bash
# Backend
cd backend && source venv/bin/activate && uvicorn app.main:app --reload
# Frontend
cd frontend && npm run dev
```

## Coordination Protocol (Holographic Core Engine)
Another Claude instance builds the 3D engine in `~/Holographic-Digital-Twinning/`.
- **Protocol**: `/home/shardul/coordination/hologram/agriculture_vertical/PROTOCOL.md`
- **Our status**: `status/agri_status.md` (we update)
- **Their status**: `status/core_status.md` (they update)
- **Messages**: `messages/YYYYMMDD_HHMMSS_agri_<subject>.md`
- **Contracts**: `contracts/core_api.md` (their API), `contracts/agri_requirements.md` (our needs)
- **Import**: `"holographic-core": "file:../../Holographic-Digital-Twinning"` in frontend

See `docs/research/hackathon_project_ideas.md` for full list of 10 ranked ideas.
See `docs/decisions/hackathon_plan.md` for strategic approach notes.

## The 7 Themes
1. **Soil Health** — Technologies for restoring soil health degradation (IoT, AI soil mapping, biofertilizers, carbon sequestration, remote sensing)
2. **Smart Water Management** — Quality, automation, fertigation (smart irrigation, AI scheduling, water quality monitoring, precision fertigation)
3. **Farm Mechanization** — AI and robotics in agriculture (autonomous tractors/drones, robotic sowing/weeding/harvesting, machine vision, post-harvest automation)
4. **Agro Processing & Value Chain** — Marketing and export (agro processing tech, digital traceability, cold chain, blockchain, farmer-market linkage)
5. **Renewable Energy & Farm Waste** — Energy in agriculture and waste management (solar/wind/bioenergy, biogas/biochar, waste-to-energy, circular bioeconomy)
6. **Plant Protection** — Pest and disease forecasting and management (AI/ML prediction, smart sensors/drones, mobile advisory, biocontrol, IPM, precision pesticide delivery)
7. **Climate Resilient Digital Agriculture** — Sustainable and digital farming (climate-smart decision support, remote sensing/GIS, weather forecasting, IoT precision ag, digital crop improvement)

## Judging Criteria
- Innovativeness
- Feasibility & impact
- Technology utilized
- Scalability & market potential

## Timeline
| Date | Milestone |
|------|-----------|
| March 31, 2026 | Application submission deadline |
| April 30, 2026 | Shortlisted entries announced |
| May 15-17, 2026 | Finals at Agricultural College, Pune |
| May 17, 2026 | Award ceremony |

## Team Constraints
- User is an IIT student, mechanical branch
- Can team up with CS/AI/other branch students
- No physical hardware or biology experiments feasible in the short term
- Can conceptualize hardware but cannot build/deliver physical prototypes by submission
- Focus should be on software/AI-based MVP or strong conceptual submissions
