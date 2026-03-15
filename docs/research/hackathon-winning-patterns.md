# Hackathon Winning Patterns

*Compiled: 2026-03-15 | Sources: SIH, NABARD, ICAR, MIT Solve, Google Solution Challenge, NASA Space Apps*

## Winners vs Losers — At a Glance

```mermaid
graph LR
    subgraph "🏆 WINNERS DO"
        W1["Live demo<br/>with real data"]
        W2["Specific problem<br/>specific geography"]
        W3["Novel tech in<br/>unexpected way"]
        W4["'Last mile'<br/>farmer UX"]
        W5["Tech + Domain<br/>team mix"]
    end

    subgraph "❌ LOSERS DO"
        L1["Slides with<br/>mock data"]
        L2["'Solve Indian<br/>agriculture'"]
        L3["Basic CNN on<br/>PlantVillage"]
        L4["Assume smartphone<br/>+ internet"]
        L5["All-CS team<br/>no ag knowledge"]
    end

    style W1 fill:#059669,color:#fff
    style W2 fill:#059669,color:#fff
    style W3 fill:#059669,color:#fff
    style W4 fill:#059669,color:#fff
    style W5 fill:#059669,color:#fff
    style L1 fill:#dc2626,color:#fff
    style L2 fill:#dc2626,color:#fff
    style L3 fill:#dc2626,color:#fff
    style L4 fill:#dc2626,color:#fff
    style L5 fill:#dc2626,color:#fff
```

## Overdone Ideas (AVOID)

```mermaid
pie title "These Show Up at EVERY AgriTech Hackathon"
    "Leaf disease detection (PlantVillage CNN)" : 30
    "Weather + crop recommendation app" : 20
    "Mandi price aggregator" : 15
    "IoT soil moisture + Arduino" : 15
    "Blockchain supply chain" : 10
    "Drone monitoring concept" : 10
```

> Unless your execution is **extraordinary**, judges will mentally check out when they see these.

## What Would Surprise Judges

```mermaid
mindmap
  root((Novel Approaches))
    Digital Twin
      Farm simulation before planting
      Borrowed from aerospace/manufacturing
      Nobody does this for Indian smallholders
    Invisible Threats
      Ozone yield loss tracking
      Microplastic soil mapping
      Soil carbon collapse prediction
    Cross-Domain
      Acoustic soil health from geophysics
      Reinforcement learning irrigation from gaming
      Synthetic disease data from GenAI
    Language-First
      Voice-first Marathi AI advisory
      NLP extraction from farmer YouTube videos
      Federated learning on farmer phones
```

## Notable Winners We Studied

| Competition | Winner | What Made It Win |
|:------------|:-------|:-----------------|
| MIT Solve | Ignitia | Hyperlocal tropical weather ML |
| MIT Solve | Kheyti (India) | Greenhouse-in-a-Box, 90% water reduction |
| Google Solution | FarmSense | Acoustic insect monitoring via phone mic |
| NASA Space Apps | Various | Sentinel/Landsat + ML for drought prediction |
| SIH India | Various | AI disease detection **with real farmer pilot data** |

## Judging Criteria — How to Score High

```mermaid
xychart-beta
    title "What Judges Actually Weight"
    x-axis ["Working\nDemo", "Real\nData", "Specific\nProblem", "Novel\nTech", "Last Mile\nUX", "Business\nModel"]
    y-axis "Importance" 0 --> 10
    bar [10, 9, 9, 8, 8, 6]
```

## Pune-Specific Judge Intel

```
🎯 Located at Agricultural College, Pune (one of Asia's oldest)
🎯 Judges care about: sugarcane, cotton, soybean, onion, pomegranate
🎯 Marathi language support = instant rapport
🎯 Sugarcane-water paradox is politically charged → handle with DATA not opinion
🎯 e-Peek Pahani (digital crop survey) → complement govt digitization
```

## Funded AgriTech = Signal for What's Valued

```mermaid
graph TD
    subgraph "💰 Most Funded Indian AgriTech"
        D["DeHaat $150M+<br/>Full-stack platform"]
        C["CropIn<br/>Satellite AI SaaS"]
        B["BharatAgri<br/>Personalized advisory"]
        F["Fasal<br/>IoT + advisory"]
        P["Pixxel<br/>Hyperspectral satellites"]
    end

    subgraph "📊 Pattern"
        T["Investors fund:<br/>① Platforms<br/>② AI advisory<br/>③ Data plays<br/><br/>NOT pure hardware"]
    end

    D & C & B & F & P --> T

    style T fill:#2563eb,color:#fff
```

## How KrishiTwin Hits Every Winning Pattern

| Pattern | KrishiTwin | Score |
|:--------|:-----------|:-----:|
| Live demo with real data | Input any GPS → instant analysis | ✅ |
| Specific geography | Maharashtra crops, Pune groundwater | ✅ |
| Novel tech application | Digital twin from aerospace → agriculture | ✅ |
| Technical depth | Satellite + simulation + LLM + ozone | ✅ |
| Last mile UX | Hindi/Marathi advisory, simple GPS input | ✅ |
| Team credibility | Mech eng → digital twin is native domain | ✅ |
| Not overdone | Zero other teams doing farm digital twins | ✅ |
