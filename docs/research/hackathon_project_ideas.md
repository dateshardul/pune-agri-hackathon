# Hackathon Project Ideas — Climate Resilient Digital Agriculture
## Problem Statement 7: Innovations in Climate Resilient, Digital and Sustainable Agriculture

---

## INDIA 2026-2029: THE CRISIS LANDSCAPE

### What's happening RIGHT NOW (2026):
- **331 of 334 days** in 2025 had extreme weather events — 99% of the year
- **February 2026 was India's warmest in 124 years** — wheat terminal heat stress is imminent
- **El Nino developing in H2 2026** — risk of sub-par monsoon and drought (Skymet)
- **17.41 million hectares** of crop area affected by extreme weather in 2025
- **Punjab groundwater dropping 1-1.2m/year** — extraction exceeds recharge by 65%
- **Soil organic carbon crashed to 0.3-0.4%** (down from 1% in 1950s)
- **49% of soils are zinc-deficient** (projected 63% by 2025)
- **Pink bollworm has evolved resistance** to both Bt cotton toxins
- **India's carbon credit trading scheme launching mid-2026**
- **AgriStack Farmer IDs: 4.86 crore generated**, Kharif 2026 deadline for full rollout
- **Bharat-VISTAAR** (multilingual AI advisory) announced in Budget 2026-27

### What's coming 2027-2029 (projected):
- **Monsoons becoming more erratic** — more intense but more concentrated rainfall, longer dry spells
- **Himalayan glacier melt accelerating** — peak meltwater in next few decades, then decline (ticking time bomb)
- **50-year flood peaks increasing**: Indus +51%, Brahmaputra +80%, Ganga +108%
- **Wheat yields could drop 10-20%** without adaptation from heat stress alone
- **Carbon credit compliance market operationalizing** — agri-carbon becomes a real revenue stream
- **Fall armyworm now endemic** across all maize-growing regions (15-73% yield reduction)
- **10,000 FPOs exist but operate on 3-6% margins** — need technology badly
- **Agricultural labour shortage accelerating** — rural-to-urban migration continues

---

## TOP HACKATHON PROJECT IDEAS

### TIER S: "I've never seen anything like this" (Maximum wow + technically sound)

---

### 1. "BHOOMI-DARPAN" — Holographic Digital Twin of a Farm Watershed

**The Pitch:** A real-time holographic digital twin that models an entire farm watershed — terrain, water flow, soil moisture, crop growth, and weather — as an interactive 3D holographic volume. The commander of a farm (the farmer) can "see" their land the way a military commander sees a battlefield.

**Why it wins:**
- Directly leverages your BTP project (multi-user 3D terrain interaction)
- "Digital twin" + "holographic" = two of the biggest buzzwords in one project
- Solves the #1 problem: water. India lost 450 cubic km of groundwater in 20 years.
- Nobody at any hackathon has built a holographic farm digital twin

**Tech Stack:**
- **Terrain**: SRTM DEM data (free, USGS) → 3D mesh via OpenDroneMap or custom Python pipeline
- **Hydrology**: GRASS GIS water flow simulation on the terrain mesh
- **Crop simulation**: DSSAT (free, 42 crop models) for growth prediction
- **Weather**: OpenWeatherMap API + IMD data for real-time + forecast
- **Soil**: ESP32 + capacitive soil moisture sensor ($2) + LoRa ($5) for live data
- **Visualization**: Unity + Looking Glass or WebGL/Three.js light-field rendering
- **AI**: Neural network predicting water stress zones from terrain + weather + soil data

**5-Week Build Plan:**
- Week 1: DEM → 3D terrain mesh + water flow simulation pipeline
- Week 2: DSSAT integration + weather API + soil sensor setup
- Week 3: 3D visualization (Unity or Three.js) with interactive layers
- Week 4: AI prediction model (water stress zones from historical + live data)
- Week 5: Integration, demo polish, presentation

**Cost:** ~₹3,000-5,000 (soil sensors + LoRa modules + display)

**Connection to your work:** This IS your DHARAA-BHOOMI engine applied to agriculture instead of defence. Same terrain processing, same 3D visualization, same digital twin concept. The code you write here directly feeds into the iDEX project.

---

### 2. "NAKSHATRA-KRISHI" — Solar-Lunar Cycle AI for Pest & Weather Prediction

**The Pitch:** An AI system that correlates 50 years of NASA solar activity data + Panchang/Nakshatra calendars + IMD weather records + government pest survey data to find predictive patterns that modern meteorology misses. Outputs a farmer-facing "Nakshatra Risk Dashboard" predicting pest outbreaks and weather anomalies up to 6 months in advance.

**Why it wins:**
- Published science NOW validates this:
  - Sunspot activity causally linked to locust outbreaks (Agronomy journal)
  - Cotton bollworm populations correlate with solar cycles (PMC 2025)
  - Panchang rainfall predictions shown "on par with" IMD predictions (Medium/academic)
  - 2025 Springer paper: "Ancient Wisdom and Modern Science: Unveiling Links Between Indian Knowledge Systems, Agriculture, Solar Cycles and Remote Sensing"
- Makes judges say "I have never seen anything like this"
- Solves a REAL problem: pest forecasting is currently reactive, not predictive
- The "ancient + modern" narrative is uniquely powerful for Indian judges

**Tech Stack:**
- **Solar data**: NASA OMNI dataset (free) — sunspot numbers, solar wind, geomagnetic indices
- **Panchang data**: Swiss Ephemeris (free API) for lunar phases, Nakshatra positions, Tithi
- **Weather data**: IMD historical gridded data (free) — 50+ years of rainfall, temperature
- **Pest data**: ICAR pest surveillance records, state agriculture department reports
- **ML**: Time-series analysis (LSTM/Transformer) + Granger causality testing
- **Frontend**: Streamlit or React dashboard with Nakshatra calendar interface

**5-Week Build Plan:**
- Week 1: Data collection and cleaning (NASA solar + Panchang + IMD weather + pest records)
- Week 2: Correlation analysis — Granger causality between solar cycles and pest/weather events
- Week 3: ML model — LSTM predicting pest risk from solar + lunar + weather features
- Week 4: Dashboard — farmer-facing Nakshatra calendar with risk scores
- Week 5: Validation with historical data, demo polish

**Cost:** ₹0 (pure software)

**Critical presentation note:** Lead with the published science, not the Vedic framing. "We found statistically significant correlations between solar cycle phase and bollworm outbreaks in Maharashtra cotton (p < 0.05, Granger causality test, 30-year dataset)." The Panchang connection is the story, not the claim.

---

### 3. "PRANA-VAYU" — Plant Breath Analyzer (VOC Sensing + Phone Camera)

**The Pitch:** Plants "breathe" — they emit volatile organic compounds that change when stressed. We built a ₹50 colorimetric sensor card that, when placed near a plant for 30 minutes, changes colour based on the plant's VOC signature. A phone camera photographs the card, and our CNN classifies the disease — **2-3 days before any visible symptoms appear.**

**Why it wins:**
- Based on landmark Cell paper (Khait et al., 2023) — plants emit ultrasonic sounds and VOCs under stress
- The ₹50 sensor card vs. ₹10,00,000 lab equipment is a 20,000x cost reduction
- "Reading a plant's breath" is an unforgettable pitch
- Detects disease BEFORE symptoms appear — game-changer for Indian farmers
- Physical prototype that judges can hold and smell

**Tech Stack:**
- **Sensor card**: Filter paper + pH indicator dyes + bromothymol blue + methyl red (react to different VOC classes) — ~₹50 per card
- **Phone app**: Camera captures colour change → CNN (EfficientNet-Lite, TFLite) classifies pattern
- **Training data**: Controlled experiment — expose cards to healthy vs. stressed plants over 5 weeks
- **Disease mapping**: Map VOC signatures to specific diseases using published literature

**5-Week Build Plan:**
- Week 1: Design and fabricate sensor cards (chemistry lab access needed — check IIT chem dept)
- Week 2: Controlled exposure experiments — healthy vs. drought-stressed vs. infected plants
- Week 3: Photograph cards, build image dataset, train CNN
- Week 4: Deploy model on Android app (TFLite), test on new samples
- Week 5: Validate accuracy, build demo kit with cards + app

**Cost:** ~₹2,000-3,000 (chemical reagents + filter paper + phone app development)

**Risk:** You need access to a chemistry lab for reagent preparation and controlled plant experiments. Check if your IIT botany/chemistry department can support this.

---

### TIER A: Technically Impressive + Highly Feasible

---

### 4. "KRISHI-QUANTUM" — Quantum-Enhanced Crop Yield Optimization

**The Pitch:** We use quantum computing algorithms (QAOA) running on IBM Quantum to optimize crop planning — which crops to plant where, when to irrigate, how to allocate limited water across fields — solving combinatorial optimization problems that classical computers struggle with at farm-cluster scale.

**Tech Stack:**
- IBM Qiskit (free) — QAOA for crop-water allocation
- DSSAT for crop yield simulation (the "reward function")
- Historical crop data from data.gov.in
- Streamlit dashboard comparing quantum vs. classical solutions

**Why it wins:** "Quantum computing for agriculture" — nobody has done this in an Indian hackathon. The published science exists (EPJ 2025 — QYieldOpt framework, 89% water utilization efficiency). Even if the quantum advantage is marginal, the novelty is maximum.

**Cost:** ₹0 (all cloud/software)

---

### 5. "MITTI-JYOTI" — Soil-Powered IoT Sensor Network

**The Pitch:** We buried electrodes in dirt and generated electricity from soil bacteria. This "dirt battery" powers a LoRaWAN sensor that monitors soil moisture, temperature, and pH — running FOREVER without batteries or solar panels. Self-powered, zero-maintenance, ₹500 per node.

**Tech Stack:**
- Soil microbial fuel cell: Carbon felt/graphite electrodes ($5) + soil + container
- Ultra-low-power ESP32-C3 + LoRa module (deep sleep mode, wakes every 15 min to transmit)
- Supercapacitor to store MFC charge between transmissions
- LoRaWAN gateway (single Raspberry Pi + LoRa HAT covers 5+ km radius)
- Grafana dashboard

**Why it wins:**
- Northwestern University published this in 2024 — peer-reviewed, real science
- Bactery (startup) is commercializing this RIGHT NOW
- Physical demo: judges watch an LED light up from DIRT
- "Zero-battery, zero-solar, forever-running sensor" is an unbeatable tagline
- Costs ₹500 per node vs. ₹5,000+ for solar-powered IoT nodes

**Cost:** ~₹3,000-5,000 total for 3-4 nodes + gateway

---

### 6. "VRIKSHA-VANI" — Acoustic Tree Health Scanner

**The Pitch:** We tap sensors around a tree trunk, send sound waves through the wood, and reconstruct a 2D cross-section showing internal decay, cavities, and disease — like a CT scan for trees. Targets India's ₹50,000+ crore plantation economy (coconut, mango, rubber, sandalwood) where tree death costs crores annually with zero internal monitoring today.

**Tech Stack:**
- 4-8 piezoelectric contact sensors (₹100-200 each)
- Arduino/ESP32 for timing measurement
- Time-of-flight tomography algorithm (well-published, implementable in Python)
- 2D/3D cross-section visualization

**Why it wins:**
- Sonic tomography is proven (USDA Forest Service uses it) but costs ₹5-10 lakh per system
- Your DIY version costs ₹3,000-5,000
- Nobody does this for agricultural plantation crops
- Physical hardware demo that produces a stunning visual output
- Connects to Vrikshayurveda (ancient tree medicine) as the diagnostic tool

**Cost:** ~₹3,000-5,000

---

### 7. "KRISHI-KAVACH" — Electrostatic Pest Shield + IoT

**The Pitch:** A solar-powered electrostatic mesh that repels and kills insects using high-voltage electric fields — no chemicals, no residues. IoT counter tracks insect intercept rates. Dashboard shows pest pressure trends. Based on published research in MDPI Agronomy (2025).

**Tech Stack:**
- High-voltage DC module (₹200, from air purifier ionizer)
- Metal mesh + grounding wire
- Solar panel (5W, ₹500)
- ESP32 + IR break-beam sensor for insect counting
- LoRa transmission to dashboard

**Why it wins:**
- Chemical-free pest control is THE hot topic in Indian agriculture
- Published science: electrostatic fields give 10x better coverage than spraying
- Your Dhoopana concept from the earlier proposal, but with real physics
- Physical demo is dramatic — insects get zapped in real-time
- ₹2,000 per unit vs. ₹10,000+ for commercial alternatives

**Cost:** ~₹3,000-4,000

---

### TIER B: Strong Software-Only Projects (Zero Hardware Cost)

---

### 8. "CARBON-KRISHI" — Carbon Credit MRV Platform for Smallholders

**The Pitch:** India's carbon credit trading scheme launches mid-2026 but NO tool exists for smallholder farmers to measure, report, and verify (MRV) their practices. We built the first platform where: farmer registers practices (DSR rice, zero-till, cover crops, biochar application) → satellite verifies (NDVI change, land use) → AI estimates carbon sequestered → blockchain records immutable credit → farmer earns carbon revenue.

**Why it wins NOW:**
- India's CCTS launching mid-2026 — PERFECT timing
- Rs 20,000 crore CCUS support programme announced in Budget 2026-27
- Varaha (Indian startup) raised millions doing exactly this, proving the model
- No farmer-facing tool exists yet — you'd be first

**Tech Stack:**
- Satellite: Google Earth Engine (free) for NDVI, land-use change detection
- Carbon estimation: IPCC emission factors + India-specific soil carbon models
- Blockchain: Polygon testnet (free) for credit tokenization
- Frontend: React/Flutter mobile app for farmer onboarding
- AgriStack integration: Use Farmer ID framework for identity verification

**Cost:** ₹0

---

### 9. "BHARAT-KRISHI-GPT" — Offline Multilingual Farm AI Assistant

**The Pitch:** AgriLLM costs $$$. We built an offline-first, Hindi/Marathi/Tamil farm assistant that runs on a ₹8,000 phone with NO internet. Farmer photographs a diseased crop, speaks in their language, and gets instant diagnosis + treatment recommendation — all on-device.

**Tech Stack:**
- Plant disease model: EfficientNet-Lite trained on PlantVillage (50K+ images) → TFLite
- Voice: Vosk (offline speech recognition, supports Hindi) or Whisper-tiny
- LLM: DistilGPT or Phi-3-mini quantized to 4-bit, running on-device via llama.cpp
- Fine-tuned on ICAR advisory corpus + Kisan Call Center transcripts
- Local language TTS for audio response

**Why it wins:**
- 70% of India's farmers have limited internet access
- Bharat-VISTAAR just announced but doesn't exist yet — you're building the prototype
- "Works without internet" is the single most impactful feature for rural India
- Demo: airplane mode ON → photograph crop → instant diagnosis in Hindi

**Cost:** ₹0

---

### 10. "JALA-DRISHTI" — Groundwater Digital Twin with Quantum Sensing Concept

**The Pitch:** Punjab is losing 1.2m of groundwater per year. We built a digital twin of the aquifer system that predicts water table levels 6 months out, using a novel approach: quantum gravity sensing principles (NV-center magnetometry) for future sub-surface mapping, combined with current satellite data (GRACE-FO mass anomaly), well monitoring data, and AI for prediction.

**Tech Stack:**
- GRACE-FO satellite data (free, NASA) for gravitational anomaly → groundwater mass changes
- CGWB well monitoring data (data.gov.in)
- DSSAT soil water balance model
- LSTM/Transformer for time-series prediction of water table
- 3D visualization of aquifer in Three.js
- Concept demo: NV-center ODMR bench setup (₹15,000) showing the quantum sensing principle

**Why it wins:**
- Groundwater is India's existential agricultural crisis
- Nobody has built a groundwater digital twin for Indian agriculture
- The quantum sensing angle (even as a concept/bench demo) adds frontier tech credibility
- GRACE-FO data is real and freely available

**Cost:** ₹0-15,000 (depending on whether you build the NV-center bench demo)

---

## STRATEGIC RECOMMENDATION: WHICH ONE TO BUILD

### If you want MAXIMUM probability of winning:
**Build #1 (BHOOMI-DARPAN) + elements of #2 (NAKSHATRA-KRISHI)**

Why:
- Your BTP repo gives you a 60% head start on the 3D terrain visualization
- Digital twin + holographic = double buzzword, but with REAL substance (DSSAT simulation engine)
- Add the Nakshatra/solar-cycle correlation as ONE LAYER in the digital twin — it becomes a feature, not the whole product
- The terrain hydrology model directly feeds your iDEX DHARAA project
- You can demo it on a Looking Glass display (₹1.5L) or even a web-based 3D viewer

### If you want MAXIMUM wow factor:
**Build #3 (PRANA-VAYU) — the plant breath analyzer**

Why:
- Physical prototype that judges can hold
- ₹50 sensor card vs. ₹10 lakh lab equipment = unforgettable pitch
- Cell paper backing gives scientific credibility
- "We read the plant's breath and diagnosed disease 3 days before any human could see it" — that's a winning one-liner

### If you want MAXIMUM impact argument:
**Build #8 (CARBON-KRISHI) — the carbon credit MRV platform**

Why:
- India's carbon trading launches mid-2026 — you're building infrastructure for a policy that's about to become law
- Quantifiable: "If 10% of India's 150M farmers earn ₹5,000/year in carbon credits, that's ₹7,500 crore of new farmer income"
- Satellite + blockchain + AI = technically impressive
- Business model is clear: take 10-15% of carbon credit revenue

### If you want to leverage ALL your skills:
**Build #1 + #4 + #5 combined: "QUANTUM-HOLOGRAPHIC FARM DIGITAL TWIN"**

The ultimate hackathon flex:
1. 3D holographic terrain visualization of a farm (your BTP + DHARAA work)
2. DSSAT crop simulation running as the digital twin engine
3. Quantum optimization (QAOA on IBM Qiskit) for water allocation across fields
4. Soil-powered IoT sensors feeding live data into the twin
5. Nakshatra-AI layer for long-range pest/weather risk

This hits: holography + digital twin + quantum + robotics/IoT + AI + ancient knowledge + climate resilience

**It's audacious, but with your background, it's buildable in 5 weeks if you scope each component to its minimum viable demo.**
