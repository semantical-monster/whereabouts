# GeoNerd

USA Deep Geography Quiz — React + D3 + Zustand

## Quick Start (macOS)

### 1. Check Node.js is installed
Open Terminal:
    node --version
If command not found, install via Homebrew:
    brew install node

### 2. Install dependencies
    cd geonerd
    npm install

### 3. Run dev server
    npm run dev
Then open http://localhost:5173

---

## What works now

**USA Map** — hover any state, click Utah (highlighted green) to enter county quiz.

**Utah County Quiz — 3 modes:**
- Click to ID: click a county to reveal its name + seat (50 pts)
- Find It: given a county name, click the correct one (100 pts)
- Multiple Choice: given a county, pick the county seat from 4 options (150 pts)

Streak bonus: 3+ correct in a row adds streak×10 pts per answer.

---

## Adding more states

1. Add the FIPS code to ENABLED_STATES in src/components/USAMap.jsx
2. Create src/data/<state>Counties.js following the Utah format
3. The TopoJSON already contains all counties — no new data needed

---

## Tech stack
- React 19 + Vite
- D3 v7 (projection, rendering, hit detection)
- TopoJSON (US Atlas — Census Bureau TIGER/Line data)
- Zustand (quiz state)
