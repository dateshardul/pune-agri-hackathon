# KrishiTwin — Digital Twin Farm Resilience Simulator

> **Pune Agriculture Hackathon 2026** | Theme 7: Climate Resilient Digital Agriculture

## The Problem

```mermaid
graph TD
    subgraph "India's Agricultural Convergence Crisis (2026-2029)"
        A["💧 Groundwater Collapse<br/>17% aquifers over-exploited<br/>60% critical by 2032"]
        B["🌡️ Heat Stress<br/>10-15% wheat yield loss<br/>in 3 of last 5 years"]
        C["🌱 Soil Carbon Collapse<br/>50%+ soils below 0.5% SOC<br/>30% below survival threshold"]
        D["🌫️ Invisible Ozone Damage<br/>₹25,000-40,000 Cr/yr losses<br/>Zero farmer awareness"]
        E["🐛 Fall Armyworm<br/>Endemic on maize<br/>Host-switching to rice"]
        F["🐝 Pollinator Decline<br/>20-30% bee population drop<br/>Mustard, apple, coffee hit"]
    end

    A -->|"No water buffer<br/>during heat waves"| B
    B -->|"Stressed plants<br/>more vulnerable"| E
    C -->|"Soil can't hold<br/>remaining water"| A
    D -->|"Invisible 5-15%<br/>yield reduction"| C
    F -->|"25-40% less<br/>mustard yield"| D

    style A fill:#dc2626,color:#fff
    style B fill:#ea580c,color:#fff
    style C fill:#ca8a04,color:#fff
    style D fill:#7c3aed,color:#fff
    style E fill:#059669,color:#fff
    style F fill:#2563eb,color:#fff
```

**No existing tool models this convergence.** KrishiTwin is the first.

## How It Works

```mermaid
graph LR
    subgraph "INPUT"
        GPS["📍 GPS Location"]
    end

    subgraph "AUTO-PULL DATA (all free)"
        S["🛰️ Sentinel-2<br/>Satellite Imagery"]
        SO["🌍 SoilGrids<br/>Soil Properties"]
        W["⛅ NASA POWER<br/>Weather Data"]
        GW["💧 CGWB<br/>Groundwater Levels"]
        OZ["🌫️ Sentinel-5P<br/>Ozone / Air Quality"]
    end

    subgraph "SIMULATE"
        DT["🖥️ Digital Twin<br/>DSSAT/WOFOST<br/>Crop Models"]
    end

    subgraph "OUTPUT"
        D1["📊 Farm Health<br/>Dashboard"]
        D2["🔮 What-If<br/>Scenario Explorer"]
        D3["💧 Groundwater<br/>Depletion Timeline"]
        D4["🌫️ OzoneSight™<br/>Invisible Loss Tracker"]
        D5["🗣️ Advisory in<br/>Hindi / Marathi"]
    end

    GPS --> S & SO & W & GW & OZ
    S & SO & W & GW & OZ --> DT
    DT --> D1 & D2 & D3 & D4 & D5

    style GPS fill:#2563eb,color:#fff
    style DT fill:#7c3aed,color:#fff
    style D4 fill:#dc2626,color:#fff
```

### What-If Scenarios

```
┌─────────────────────────────────────────────────────────────┐
│  "What if February hits 38°C?"        →  Wheat yield: -12%  │
│  "What if El Niño cuts monsoon 15%?"  →  Rice yield: -18%   │
│  "Switch sugarcane → pomegranate?"    →  Water saved: 2100mm │
│  "Your well runs dry in..."          →  ⚠️  4.2 years       │
│  "Ozone is silently costing you..."  →  ₹8,400/acre/year    │
└─────────────────────────────────────────────────────────────┘
```

## Tech Stack

```mermaid
graph TB
    subgraph "Frontend"
        R["⚛️ React"] --> V["📊 Interactive<br/>Visualizations"]
        R --> T["🗺️ Three.js / Deck.gl<br/>3D Farm Rendering"]
    end

    subgraph "Backend"
        F["⚡ FastAPI<br/>(Python)"]
    end

    subgraph "AI Layer"
        C["🤖 Claude API<br/>Hindi/Marathi Advisory"]
        CS["🌾 DSSAT/WOFOST<br/>Crop Simulation"]
    end

    subgraph "Data Sources (all FREE)"
        S2["🛰️ Sentinel-2"]
        S5["🌫️ Sentinel-5P"]
        NP["⛅ NASA POWER"]
        SG["🌍 SoilGrids"]
        CG["💧 CGWB"]
        CP["🏭 CPCB AQI"]
    end

    R <--> F
    F <--> C & CS
    F <--> S2 & S5 & NP & SG & CG & CP

    style F fill:#059669,color:#fff
    style C fill:#7c3aed,color:#fff
```

## Judging Criteria

```mermaid
quadrantChart
    title How KrishiTwin Scores
    x-axis "Low Feasibility" --> "High Feasibility"
    y-axis "Low Innovation" --> "High Innovation"
    quadrant-1 "Sweet Spot"
    quadrant-2 "Risky Bets"
    quadrant-3 "Avoid"
    quadrant-4 "Incremental"
    "KrishiTwin": [0.85, 0.9]
    "Basic Disease Detection": [0.8, 0.2]
    "Quantum-only Approach": [0.2, 0.95]
    "Mandi Price App": [0.9, 0.1]
    "Hardware Robot": [0.15, 0.7]
```

| Criteria | Score | Why |
|:---------|:-----:|:----|
| Innovativeness | **10/10** | First Indian farm digital twin + ozone tracking |
| Feasibility | **9/10** | All free/open data, proven crop models |
| Technology | **10/10** | Digital twin + satellite + crop sim + LLM |
| Scalability | **9/10** | Any GPS in India, SaaS-ready |

## Timeline

```mermaid
gantt
    title Development Roadmap
    dateFormat YYYY-MM-DD
    axisFormat %b %d

    section Phase 1: MVP
    Data pipeline (satellite, soil, weather)    :a1, 2026-03-15, 3d
    Crop simulation engine                      :a2, after a1, 4d
    Frontend dashboard                          :a3, after a1, 5d
    OzoneSight module                           :a4, after a2, 2d
    LLM advisory (Hindi/Marathi)                :a5, after a2, 2d
    Demo video + application                    :a6, after a4, 3d
    Application deadline                        :milestone, 2026-03-31, 0d

    section Phase 2: Finals (if shortlisted)
    Mobile optimization (TFLite/ONNX)           :b1, 2026-04-30, 5d
    Maharashtra crops (sugarcane, soybean)       :b2, after b1, 4d
    Mobile app (React Native)                   :b3, after b1, 7d
    Pitch deck + rehearsal                      :b4, 2026-05-10, 5d
    Finals at Pune                              :milestone, 2026-05-15, 0d
```

## Team

| Role | Person | Skills |
|:-----|:-------|:-------|
| Project Lead / System Architecture | **Shardul** (IIT, Mech) | Simulation, modeling, product design |
| ML + Backend | *Seeking CS/AI student* | Python, ML, APIs |
| Frontend | *Seeking CS student* | React, visualization |
| Domain Expert | *Seeking Ag/Bio student* | Crop science, validation |

## Project Status: `THEME SELECTED → BUILDING MVP`

```
[████████░░░░░░░░░░░░] 15% — Architecture finalized, research complete
```

---

*Built for [Pune Agriculture Hackathon 2026](https://example.com) — India's first international agriculture hackathon*
