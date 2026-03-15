# Decision 001: Theme Selection

**Date:** 2026-03-15 | **Status:** Decided | **Choice:** Theme 7 — Climate Resilient Digital Agriculture

## Evaluation at a Glance

```mermaid
xychart-beta
    title "Theme Scores (out of 10)"
    x-axis ["Plant\nProtection", "Smart\nWater", "Climate\nDigital Ag", "Soil\nHealth", "Value\nChain", "Farm\nMech", "Renewable\nEnergy"]
    y-axis "Score" 0 --> 10
    bar [9, 8, 7.5, 7, 6, 5, 4]
```

## Why NOT the Top Scorer (Theme 6)?

```mermaid
graph LR
    T6["Theme 6: Plant Protection<br/>Score: 9/10"] -->|"BUT"| P1["❌ Basic disease detection<br/>done at EVERY hackathon"]
    T6 -->|"BUT"| P2["❌ Judges are fatigued<br/>with PlantVillage CNNs"]
    T6 -->|"BUT"| P3["❌ Narrow scope =<br/>limited innovation score"]

    T7["Theme 7: Climate Digital Ag<br/>Score: 7.5 → 9.5/10"] -->|"BECAUSE"| W1["✅ Digital twin = novel<br/>for Indian agriculture"]
    T7 -->|"BECAUSE"| W2["✅ Convergence crisis<br/>framing is unique"]
    T7 -->|"BECAUSE"| W3["✅ OzoneSight =<br/>zero competition"]
    T7 -->|"BECAUSE"| W4["✅ Mech eng background<br/>= digital twin credibility"]

    style T6 fill:#dc2626,color:#fff
    style T7 fill:#059669,color:#fff
    style P1 fill:#fca5a5
    style P2 fill:#fca5a5
    style P3 fill:#fca5a5
    style W1 fill:#86efac
    style W2 fill:#86efac
    style W3 fill:#86efac
    style W4 fill:#86efac
```

## Detailed Scoring Matrix

| Theme | SW MVP? | Demo Impact | Differentiation | Data Available | Our Edge | **Score** |
|:------|:-------:|:-----------:|:---------------:|:--------------:|:--------:|:---------:|
| 6. Plant Protection | Yes | Very High | ~~High~~ Overdone | PlantVillage 50K | CS teammate | ~~9~~ **6** |
| **7. Climate Digital Ag** | **Yes** | **High** | **Very High** | **Open sat/weather** | **Mech + twin** | **9.5** |
| 2. Smart Water | Yes | High | Medium | Public APIs | Mech background | **8** |
| 1. Soil Health | Partial | Med-High | Medium | Satellite | Decent | **7** |
| 4. Value Chain | Yes | Medium | Low (crowded) | Govt mandi APIs | Low | **6** |
| 3. Farm Mech | No HW | High if built | High | N/A | Can't build | **5** |
| 5. Renewable Energy | No HW | Low w/o HW | Medium | N/A | Low | **4** |

## Project Chosen: KrishiTwin

```mermaid
mindmap
  root((KrishiTwin))
    Core: Farm Digital Twin
      Satellite imagery auto-pull
      Soil properties mapping
      Weather integration
      Crop growth simulation
    Unique: OzoneSight
      Tropospheric ozone tracking
      Invisible yield loss calculator
      Mitigation recommendations
    Advisory: LLM in Marathi/Hindi
      Claude API + RAG
      Voice input/output future
      ICAR/KVK knowledge base
    Scenarios: What-If Explorer
      Heat wave simulation
      El Nino drought modeling
      Crop switching economics
      Groundwater depletion timeline
```

## Alternatives Considered

```mermaid
graph TD
    K["✅ KrishiTwin<br/>CHOSEN"]

    O["OzoneSight<br/>(standalone)"] -->|"Better as feature<br/>inside KrishiTwin"| K
    A["AquiferMind<br/>(groundwater twin)"] -->|"Narrower scope;<br/>becomes a module"| K
    C["CropVerse<br/>(quantum soil)"] -->|"Too experimental<br/>for reliable demo"| X1["❌"]
    F["FarmSaathi<br/>(voice-first AI)"] -->|"'Chatbot' framing risky;<br/>voice = future feature"| K
    B["BioShield<br/>(pollinator + pest)"] -->|"Data scarcity<br/>for pollinators"| X2["❌"]
    T["TerraStream<br/>(carbon credits)"] -->|"Business > tech<br/>for hackathon"| X3["❌"]

    style K fill:#059669,color:#fff
    style X1 fill:#dc2626,color:#fff
    style X2 fill:#dc2626,color:#fff
    style X3 fill:#dc2626,color:#fff
```
