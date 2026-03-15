# India Agriculture Crisis: 2026-2029

*Compiled: 2026-03-15 | Sources: IPCC AR6, CGWB, IMD, ISRO, ICAR, World Bank, FAO*

## The Convergence Crisis

```mermaid
graph TD
    subgraph "🔴 The Doom Loop"
        GW["💧 Groundwater<br/>depleting 1-3m/decade"]
        HEAT["🌡️ Heat waves<br/>+0.15°C/decade"]
        SOC["🌱 Soil carbon<br/>below survival threshold"]
        OZ["🌫️ Ozone damage<br/>invisible, $3-5B/yr"]
        PEST["🐛 Pests expanding<br/>range + resistance"]
        POLL["🐝 Pollinators<br/>declining 20-30%"]
    end

    GW -->|"No buffer during<br/>heat waves"| HEAT
    HEAT -->|"Stressed crops<br/>attract pests"| PEST
    PEST -->|"More pesticide<br/>kills pollinators"| POLL
    POLL -->|"Lower yields<br/>= more inputs"| SOC
    SOC -->|"Soil can't hold<br/>remaining water"| GW
    OZ -->|"Silent 5-15%<br/>yield theft"| SOC

    EL["⚠️ El Niño<br/>(likely before 2029)"]
    EL -->|"TRIGGERS<br/>CASCADING FAILURE"| GW

    style EL fill:#dc2626,color:#fff,stroke:#dc2626,stroke-width:3px
    style GW fill:#dc2626,color:#fff
    style HEAT fill:#ea580c,color:#fff
    style SOC fill:#ca8a04,color:#fff
    style OZ fill:#7c3aed,color:#fff
    style PEST fill:#059669,color:#fff
    style POLL fill:#2563eb,color:#fff
```

---

## Crisis-by-Crisis Snapshot

### 1. Groundwater

```
India = World's #1 groundwater extractor (250 billion m³/year > US + China combined)

Status:     ████████████████████░░░░░ 17% aquifers OVER-EXPLOITED
By 2032:    ████████████████████████████████████████████████████████████░ 60% CRITICAL

Maharashtra Sugarcane Paradox:
  Cropped area:     ████ 4%
  Irrigation used:  ████████████████████████████████████████████████████████████████████ 65%
```

| Region | Status | Trend |
|:-------|:------:|:-----:|
| Punjab, Haryana | Over-exploited | Dropping 0.5-1.0 m/year |
| Marathwada, Vidarbha | Severe | Drought near-annual |
| Solapur, Ahmednagar | Acute stress | Borewells at 300-400 ft |
| Pune district | Moderate | Urbanization competing |

### 2. Heat Stress

```mermaid
xychart-beta
    title "Days Above 45°C in NW India (projected)"
    x-axis ["2020", "2022", "2024", "2026", "2028", "2030"]
    y-axis "Days per year" 0 --> 45
    bar [15, 18, 22, 27, 33, 40]
```

| Crop | Impact per +1°C | Current Loss |
|:-----|:---------------:|:------------:|
| Wheat (grain-filling) | -5 to -7% yield | 10-15% in IGP |
| Rice (night temp >26°C) | -10% yield | Increasing |
| Dairy (milk production) | -10 to -25% | $10-25B sector at risk |

### 3. Soil Organic Carbon — The Collapse Threshold

```
Desirable SOC:  ████████████████████ 1.5-2.0%
IGP 40 yrs ago: ██████████████ 0.5-0.7%
IGP today:      ████████ 0.3-0.4%          ← APPROACHING NON-LINEAR COLLAPSE
Threshold:      ██████ 0.3%                ← Below this, soil stops functioning

Land degraded:  96.4 million hectares (29.3% of India)
                Adding ~500,000 hectares/year
```

### 4. Tropospheric Ozone — The Invisible Yield Thief

```mermaid
pie title "Annual Ozone Crop Losses in India ($3-5B total)"
    "Wheat: 3.5M tonnes" : 45
    "Rice" : 20
    "Soybean (MH/MP)" : 15
    "Mustard" : 12
    "Other crops" : 8
```

> **IGP ozone: 60-100 ppb** during rabi season. Crop damage threshold: 40 ppb.
> Farmers cannot see, smell, or diagnose this. It shows up as "unexplained low yield."

### 5. Monsoon Disruption

```
Total rainfall:          Stable (misleading!)
Rainy days:              ↓ 15% fewer since 1950
Extreme rainfall events: ↑ 3x since 1950 in central India
Pattern:                 Long dry spell ──── DELUGE ──── Long dry spell
```

### 6. Pest & Disease Threats

```mermaid
graph LR
    subgraph "🔴 Active Crisis"
        FAW["Fall Armyworm<br/>15-30% maize loss<br/>→ spreading to RICE"]
        PB["Pink Bollworm<br/>Bt-RESISTANT<br/>Cotton collapse risk"]
    end

    subgraph "🟠 At the Border"
        WB["Wheat Blast<br/>In Bangladesh<br/>Entry = 'when not if'"]
    end

    subgraph "🟡 Spreading"
        TLC["ToLCNDV<br/>Tomato/cucurbit<br/>via whitefly"]
        FTR["Fusarium TR4<br/>Banana disease<br/>Bihar, UP, Gujarat"]
        CG["Citrus Greening<br/>Nagpur oranges<br/>No cure exists"]
    end

    style FAW fill:#dc2626,color:#fff
    style PB fill:#dc2626,color:#fff
    style WB fill:#ea580c,color:#fff
    style TLC fill:#ca8a04,color:#fff
    style FTR fill:#ca8a04,color:#fff
    style CG fill:#ca8a04,color:#fff
```

### 7. Pollinator Decline

| Pollinator | Decline | Crop Impact |
|:-----------|:-------:|:------------|
| Indian honeybee | -20 to 30% | Mustard yield boost lost (25-40%) |
| Rock bee | -40% colonies | Wild pollination of fruit |
| Butterflies | -30 to 40% | Indicator species |
| **Result** | → Apple hand-pollination now required in Himachal | → $15-20B/yr edible oil import bill worsens |

### 8. Hidden & Emerging Threats

```mermaid
timeline
    title Problems That Seem Small Now → Critical by 2029
    2026 : Microplastics accumulating silently in soil (no remediation exists)
         : Bt resistance spreading in cotton bollworm
    2027 : Soil carbon crosses 0.3% threshold in more IGP zones
         : Fall Armyworm establishes on rice
    2028 : Wheat Blast enters eastern India
         : Pollinator decline hits mustard yields measurably
    2029 : El Niño + depleted groundwater = CASCADING CROP FAILURE
         : Ozone damage exceeds $5B/year with zero policy response
```

---

## Food Security Outlook

```
Population:     1.44B (2025) → 1.50B (2030)     +4% people
Food demand:    ↑ 15-20% by 2030                  +20% food needed
Climate loss:   -5 to 15% yields without adaptation   -10% supply

EDIBLE OIL:     ████████████████████████████████████████████████████████████ 60% IMPORTED ($15-20B/yr)
PULSES:         ████████████████████████ $2-3B imported annually
WHEAT AT RISK:  World's 2nd largest producer, concentrated in the exact
                region facing groundwater + heat convergence
```

---

## Maharashtra / Pune Region Specifically

```mermaid
mindmap
  root((Pune Region))
    Water Crisis
      Sugarcane uses 65% water on 4% land
      Solapur/Ahmednagar acute stress
      Borewells 300-400 ft deep
      Bhima/Nira rivers declining
    Soil
      42% of Maharashtra degraded
      Vidarbha salinization
      Black cotton soil SOC dropping
    Pests
      Pink bollworm Bt-resistant
      ToLCNDV hitting tomatoes
      Fall Armyworm on maize
    Urban Pressure
      Pune-Mumbai corridor encroaching
      Competing for water with agriculture
    Crops at Risk
      Sugarcane, Cotton, Soybean
      Onion, Pomegranate, Tomato
```
