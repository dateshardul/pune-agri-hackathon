# Decision 002: Technology Stack

**Date:** 2026-03-15 | **Status:** Proposed

## Architecture Overview

```mermaid
graph TB
    subgraph "🖥️ Frontend — React"
        UI["Dashboard UI"]
        MAP["Map View<br/>(Mapbox/Leaflet)"]
        VIZ["3D Visualizations<br/>(Three.js / Deck.gl)"]
        CHAT["Advisory Chat<br/>(Hindi/Marathi)"]
    end

    subgraph "⚡ Backend — FastAPI (Python)"
        API["REST API"]
        SIM["Simulation Engine<br/>(DSSAT/WOFOST)"]
        OZ["OzoneSight<br/>Calculator"]
        GW["Groundwater<br/>Modeler"]
    end

    subgraph "🤖 AI Layer"
        LLM["Claude API<br/>+ RAG"]
        WHISPER["Whisper STT<br/>(future)"]
        TTS["Google TTS<br/>(future)"]
    end

    subgraph "🛰️ Data Sources (ALL FREE)"
        direction LR
        S2["Sentinel-2<br/>🛰️ 10m, 5-day"]
        S5["Sentinel-5P<br/>🌫️ Ozone/NO₂"]
        NASA["NASA POWER<br/>⛅ Weather"]
        SOIL["SoilGrids<br/>🌍 250m soil"]
        CGWB["CGWB<br/>💧 Groundwater"]
        CPCB["CPCB<br/>🏭 Air Quality"]
    end

    UI & MAP & VIZ & CHAT <--> API
    API <--> SIM & OZ & GW
    API <--> LLM
    SIM <--> S2 & NASA & SOIL
    OZ <--> S5 & CPCB
    GW <--> CGWB & NASA

    style API fill:#059669,color:#fff
    style LLM fill:#7c3aed,color:#fff
    style OZ fill:#dc2626,color:#fff
```

## Data Sources

| Data | Source | Resolution | Cost | Access |
|:-----|:-------|:----------:|:----:|:------:|
| 🛰️ Multispectral | Sentinel-2 (ESA) | 10m / 5-day | Free | Google Earth Engine |
| 🌫️ Ozone / NO₂ | Sentinel-5P TROPOMI | 7km | Free | Google Earth Engine |
| ⛅ Weather | NASA POWER | Point / daily | Free | REST API |
| 🌍 Soil properties | SoilGrids (ISRIC) | 250m | Free | REST API |
| 💧 Groundwater | CGWB | District | Free | Scraped |
| 🏭 Air quality | CPCB | Station | Free | API |
| 🌏 Water mass | NASA GRACE-FO | ~300km | Free | Open data |

## Stack Decisions

```mermaid
graph LR
    subgraph "Chosen ✅"
        F1["FastAPI"]
        F2["React"]
        F3["DSSAT/WOFOST"]
        F4["Claude API"]
    end

    subgraph "Rejected ❌"
        R1["Django"] -->|"Too heavy,<br/>don't need ORM"| F1
        R2["Streamlit"] -->|"Can't do 3D viz<br/>or custom UI"| F2
        R3["Custom ML model"] -->|"Physics-based sim<br/>more credible"| F3
        R4["GPT-4"] -->|"Claude = better<br/>multilingual + structure"| F4
    end

    style F1 fill:#059669,color:#fff
    style F2 fill:#059669,color:#fff
    style F3 fill:#059669,color:#fff
    style F4 fill:#059669,color:#fff
    style R1 fill:#dc2626,color:#fff
    style R2 fill:#dc2626,color:#fff
    style R3 fill:#dc2626,color:#fff
    style R4 fill:#dc2626,color:#fff
```
