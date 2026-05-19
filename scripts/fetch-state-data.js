#!/usr/bin/env node
/**
 * scripts/fetch-state-data.js
 *
 * Fetches geographic feature data from public APIs for all 50 US states and
 * writes src/data/features/{state-slug}.js + src/data/features/index.js.
 *
 * APIs used:
 *   Peaks:  OpenStreetMap Overpass API  (natural=peak, sorted by elevation)
 *   Rivers: OpenStreetMap Overpass API  (waterway=river ways, all segments per river)
 *   Parks:  NPS ArcGIS FeatureServer   (NPSParkBoundaries — NPS-administered units only)
 *   Cities: Natural Earth ne_10m_populated_places (one download, cached)
 *
 * Usage:  node scripts/fetch-state-data.js
 *         node scripts/fetch-state-data.js Utah          ← single state
 *         node scripts/fetch-state-data.js Utah Colorado ← subset
 *         node scripts/fetch-state-data.js --parks-only  ← refresh parks, preserve other data
 *         node scripts/fetch-state-data.js --rivers-only ← refresh rivers via OSM Overpass
 *         node scripts/fetch-state-data.js --peaks-only  ← refresh peaks, preserve other data
 *         node scripts/fetch-state-data.js --rivers-nhd  ← refresh rivers from local NHD data
 *           Requires pre-extracted GeoJSON: python3 scripts/extract_nhd_flowlines.py
 */

import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as topojson from 'topojson-client';
import * as turf from '@turf/turf';
import { isWhitelisted } from '../src/data/riverWhitelist.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '../src/data/features');

const STATE_FIPS = {
  '01':'Alabama','02':'Alaska','04':'Arizona','05':'Arkansas','06':'California',
  '08':'Colorado','09':'Connecticut','10':'Delaware','12':'Florida','13':'Georgia',
  '15':'Hawaii','16':'Idaho','17':'Illinois','18':'Indiana','19':'Iowa',
  '20':'Kansas','21':'Kentucky','22':'Louisiana','23':'Maine','24':'Maryland',
  '25':'Massachusetts','26':'Michigan','27':'Minnesota','28':'Mississippi',
  '29':'Missouri','30':'Montana','31':'Nebraska','32':'Nevada','33':'New Hampshire',
  '34':'New Jersey','35':'New Mexico','36':'New York','37':'North Carolina',
  '38':'North Dakota','39':'Ohio','40':'Oklahoma','41':'Oregon','42':'Pennsylvania',
  '44':'Rhode Island','45':'South Carolina','46':'South Dakota','47':'Tennessee',
  '48':'Texas','49':'Utah','50':'Vermont','51':'Virginia','53':'Washington',
  '54':'West Virginia','55':'Wisconsin','56':'Wyoming',
};

// FIPS → 2-letter state abbreviation (for properties.states on park features)
const STATE_ABBREV = {
  '01':'AL','02':'AK','04':'AZ','05':'AR','06':'CA',
  '08':'CO','09':'CT','10':'DE','12':'FL','13':'GA',
  '15':'HI','16':'ID','17':'IL','18':'IN','19':'IA',
  '20':'KS','21':'KY','22':'LA','23':'ME','24':'MD',
  '25':'MA','26':'MI','27':'MN','28':'MS','29':'MO',
  '30':'MT','31':'NE','32':'NV','33':'NH','34':'NJ',
  '35':'NM','36':'NY','37':'NC','38':'ND','39':'OH',
  '40':'OK','41':'OR','42':'PA','44':'RI','45':'SC',
  '46':'SD','47':'TN','48':'TX','49':'UT','50':'VT',
  '51':'VA','53':'WA','54':'WV','55':'WI','56':'WY',
};

// Bounding boxes [south, west, north, east] for Overpass bbox queries.
const STATE_BBOX = {
  'Alabama':         [30.14, -88.47, 35.01, -84.89],
  'Alaska':          [54.74, -179.15, 71.38, -129.97],
  'Arizona':         [31.33, -114.82, 37.00, -109.04],
  'Arkansas':        [33.00, -94.62,  36.50, -89.64],
  'California':      [32.53, -124.41, 42.01, -114.13],
  'Colorado':        [36.99, -109.06, 41.00, -102.04],
  'Connecticut':     [40.96, -73.73,  42.05, -71.79],
  'Delaware':        [38.45, -75.79,  39.84, -75.05],
  'Florida':         [24.54, -87.63,  31.00, -80.03],
  'Georgia':         [30.36, -85.61,  35.00, -80.84],
  'Hawaii':          [18.91, -160.25, 22.24, -154.81],
  'Idaho':           [41.99, -117.24, 49.00, -111.04],
  'Illinois':        [36.97, -91.51,  42.51, -87.02],
  'Indiana':         [37.77, -88.10,  41.77, -84.79],
  'Iowa':            [40.37, -96.64,  43.50, -90.14],
  'Kansas':          [36.99, -102.05, 40.00, -94.59],
  'Kentucky':        [36.50, -89.57,  39.15, -81.96],
  'Louisiana':       [28.92, -94.05,  33.02, -88.82],
  'Maine':           [43.06, -71.08,  47.46, -66.95],
  'Maryland':        [37.91, -79.49,  39.72, -74.99],
  'Massachusetts':   [41.19, -73.51,  42.89, -69.93],
  'Michigan':        [41.70, -90.42,  48.31, -82.41],
  'Minnesota':       [43.50, -97.24,  49.38, -89.49],
  'Mississippi':     [30.17, -91.65,  35.00, -88.10],
  'Missouri':        [35.99, -95.77,  40.61, -89.10],
  'Montana':         [44.36, -116.06, 49.00, -104.04],
  'Nebraska':        [39.99, -104.06, 43.00, -95.31],
  'Nevada':          [35.00, -120.01, 42.00, -114.04],
  'New Hampshire':   [42.70, -72.56,  45.31, -70.60],
  'New Jersey':      [38.93, -75.56,  41.36, -73.89],
  'New Mexico':      [31.33, -109.05, 37.00, -103.00],
  'New York':        [40.50, -79.76,  45.01, -71.86],
  'North Carolina':  [33.84, -84.32,  36.59, -75.46],
  'North Dakota':    [45.93, -104.05, 49.00, -96.55],
  'Ohio':            [38.40, -84.82,  42.33, -80.52],
  'Oklahoma':        [33.62, -103.00, 37.00, -94.43],
  'Oregon':          [41.99, -124.57, 46.24, -116.46],
  'Pennsylvania':    [39.72, -80.52,  42.27, -74.69],
  'Rhode Island':    [41.15, -71.91,  42.02, -71.12],
  'South Carolina':  [32.04, -83.35,  35.21, -78.55],
  'South Dakota':    [42.48, -104.06, 45.95, -96.44],
  'Tennessee':       [34.98, -90.31,  36.68, -81.65],
  'Texas':           [25.84, -106.65, 36.50, -93.51],
  'Utah':            [37.00, -114.05, 42.00, -109.04],
  'Vermont':         [42.73, -73.44,  45.02, -71.46],
  'Virginia':        [36.54, -83.68,  39.47, -75.22],
  'Washington':      [45.54, -124.73, 49.00, -116.92],
  'West Virginia':   [37.20, -82.64,  40.64, -77.72],
  'Wisconsin':       [42.49, -92.89,  46.96, -86.80],
  'Wyoming':         [40.99, -111.06, 45.01, -104.05],
};

// Hardcoded correct coordinates for peaks where OSM has misplaced nodes.
// Keyed by exact OSM name tag. Coordinates are [lon, lat].
// Apply these before PIP validation so the corrected point is what gets checked.
const PEAK_OVERRIDES = {
  'Mount le Conte - High Top': [-83.4432, 35.6543],
};

// Per-state centroid overrides for NPS units whose polygon spans multiple disconnected
// states (e.g. Manhattan Project: Oak Ridge TN + Los Alamos NM + Hanford WA).
// The NPS ArcGIS centroid averages the full multi-polygon, landing in a state that
// contains none of the actual sites. Structure: { UNIT_NAME: { STATE_ABBR: [lon, lat] } }.
const PARK_OVERRIDES = {
  'Manhattan Project National Historical Park': {
    TN: [-84.2696, 35.9312],  // Oak Ridge, TN
    NM: [-106.2951, 35.8801], // Los Alamos, NM
    WA: [-119.5179, 46.5504], // Hanford, WA
  },
};

const slug = name => name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
const empty = () => ({ type: 'FeatureCollection', features: [] });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Overpass helper ──────────────────────────────────────────────────────────

// The main overpass-api.de server blocks Node.js User-Agents.
// Use the openstreetmap.fr mirror (requires explicit User-Agent and Accept headers).
const OVERPASS_ENDPOINTS = [
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const OVERPASS_HEADERS = {
  'Content-Type': 'application/x-www-form-urlencoded',
  'User-Agent': 'Whereabouts/1.0 (educational geography quiz; contact: dtroxler017@gmail.com)',
  'Accept': 'application/json',
};

async function overpass(query, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const url = OVERPASS_ENDPOINTS[attempt % OVERPASS_ENDPOINTS.length];
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: OVERPASS_HEADERS,
        body: 'data=' + encodeURIComponent(query),
      });
      if (res.status === 429 || res.status === 503) {
        if (attempt < retries) { await sleep(8000); continue; }
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
      return res.json();
    } catch (e) {
      if (attempt < retries) { await sleep(3000); continue; }
      throw e;
    }
  }
}

// Reduce coordinate density while keeping shape
function simplify(coords, max = 60) {
  if (coords.length <= max) return coords;
  const step = Math.ceil(coords.length / max);
  return coords.filter((_, i) => i % step === 0 || i === coords.length - 1);
}

// ── State boundary (point-in-polygon filter) ─────────────────────────────────

let STATE_GEO = null;
function getStateBoundary(fips) {
  if (!STATE_GEO) {
    const topoPath = join(__dirname, '../node_modules/us-atlas/states-10m.json');
    const topo = JSON.parse(readFileSync(topoPath, 'utf8'));
    STATE_GEO = topojson.feature(topo, topo.objects.states);
  }
  // IDs in states-10m.json are zero-padded strings matching our STATE_FIPS keys
  return STATE_GEO.features.find(f => String(f.id) === fips) || null;
}

// Ray-casting point-in-polygon for a GeoJSON Polygon ring
function pipRing(pt, ring) {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi) / (yj - yi) + xi))
      inside = !inside;
  }
  return inside;
}

function withinFeature(pt, feature) {
  if (!feature) return true; // no boundary data → keep
  const geom = feature.geometry;
  if (!geom) return true;
  if (geom.type === 'Polygon') return pipRing(pt, geom.coordinates[0]);
  if (geom.type === 'MultiPolygon') return geom.coordinates.some(poly => pipRing(pt, poly[0]));
  return true;
}

// Filter a FeatureCollection: keep only features inside the state boundary, then cap at max.
// Slicing happens HERE (after PIP), not inside the fetchers, so bounding-box bleed doesn't
// crowd out in-state features.
function filterInState(fc, boundary, max = 10) {
  const kept = fc.features.filter(f => {
    const geom = f.geometry;
    let pt;
    if (geom.type === 'Point') {
      pt = geom.coordinates;
    } else if (geom.type === 'LineString') {
      pt = geom.coordinates[Math.floor(geom.coordinates.length / 2)];
    } else {
      return true;
    }
    return withinFeature(pt, boundary);
  });
  return { ...fc, features: kept.slice(0, max) };
}

// Approximate geodesic length of a coordinate array (in degrees, good enough for ranking)
function coordLengthDeg(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].lon - pts[i - 1].lon;
    const dy = pts[i].lat - pts[i - 1].lat;
    len += Math.sqrt(dx * dx + dy * dy);
  }
  return len;
}

// Same but for [lon, lat] pairs (post-conversion)
function segLength(coords) {
  let len = 0;
  for (let i = 1; i < coords.length; i++) {
    const dx = coords[i][0] - coords[i - 1][0];
    const dy = coords[i][1] - coords[i - 1][1];
    len += Math.sqrt(dx * dx + dy * dy);
  }
  return len;
}

// ── River segment chaining ───────────────────────────────────────────────────

// Merge way segments that share endpoints into longer continuous LineStrings.
// Returns an array of [lon, lat][] — each entry is one continuous chain.
// CHAIN_TOL: how close endpoints must be (degrees) to count as connected.
// 0.002° ≈ 220 m — generous enough to bridge small OSM node gaps.
const CHAIN_TOL = 0.002;
// Maximum endpoint-to-endpoint distance to connect two chains into the same
// component (degrees). ~35 miles. Large enough to bridge a TVA/USACE reservoir
// gap; small enough to separate truly distinct rivers in different parts of a state.
const GAP_THRESHOLD = 0.5;

function ptClose(a, b) {
  return Math.abs(a[0] - b[0]) < CHAIN_TOL && Math.abs(a[1] - b[1]) < CHAIN_TOL;
}

function chainSegments(segs) {
  if (segs.length <= 1) return segs;
  const chains = segs.map(s => s.slice()); // work on mutable copies

  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < chains.length; i++) {
      for (let j = i + 1; j < chains.length; j++) {
        const a = chains[i], b = chains[j];
        const aS = a[0], aE = a[a.length - 1];
        const bS = b[0], bE = b[b.length - 1];
        let result = null;
        if      (ptClose(aE, bS)) result = [...a, ...b.slice(1)];
        else if (ptClose(aE, bE)) result = [...a, ...b.slice(0, -1).reverse()];
        else if (ptClose(aS, bE)) result = [...b, ...a.slice(1)];
        else if (ptClose(aS, bS)) result = [...b.slice().reverse(), ...a.slice(1)];
        if (result) {
          chains[i] = result;
          chains.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  return chains;
}

// Connected component clustering: group chains whose endpoints are within
// GAP_THRESHOLD of each other, then return only the dominant component
// (highest total chain length).
//
// Handles two cases under a single algorithm:
//   A) Name collision (e.g. Willow River MN — three unrelated rivers in different
//      parts of the state): dominant component < 60% of total → keep only it,
//      discard the scattered fragments.
//   B) Single river with a data gap (e.g. Holston River TN — Cherokee Lake covers
//      its OSM course): dominant component ≥ 60% of total → the two real segments
//      are close enough to be in one component, outliers (cross-border bleed) are
//      not.
// In both cases the action is identical: return the dominant component's chains.
function dominantComponent(chains) {
  if (chains.length <= 1) return chains;
  const n = chains.length;

  // Endpoints of each chain
  const eps = chains.map(c => [c[0], c[c.length - 1]]);

  // Build adjacency list: edge when any endpoint pair is within GAP_THRESHOLD
  const adj = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let minDist = Infinity;
      for (const p of eps[i])
        for (const q of eps[j]) {
          const d = Math.sqrt((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2);
          if (d < minDist) minDist = d;
        }
      if (minDist < GAP_THRESHOLD) { adj[i].push(j); adj[j].push(i); }
    }
  }

  // BFS connected components
  const visited = new Uint8Array(n);
  const components = [];
  for (let s = 0; s < n; s++) {
    if (visited[s]) continue;
    const comp = [];
    const queue = [s];
    visited[s] = 1;
    while (queue.length) {
      const v = queue.shift();
      comp.push(v);
      for (const u of adj[v]) { if (!visited[u]) { visited[u] = 1; queue.push(u); } }
    }
    components.push(comp);
  }

  if (components.length === 1) return chains;

  // Return only the dominant component (highest total chain length)
  const lens = chains.map(segLength);
  let best = null, bestLen = -1;
  for (const comp of components) {
    const len = comp.reduce((s, i) => s + lens[i], 0);
    if (len > bestLen) { bestLen = len; best = comp; }
  }
  return best.map(i => chains[i]);
}

// ── Feature fetchers ─────────────────────────────────────────────────────────

async function fetchPeaks(stateName, stateFips) {
  const [s, w, n, e] = STATE_BBOX[stateName] || [];
  if (!s) return empty();

  const data = await overpass(`[out:json][timeout:90];
node["natural"="peak"]["name"]["ele"](${s},${w},${n},${e});
out body;`);

  const boundary = getStateBoundary(stateFips);

  const features = (data.elements || [])
    .filter(el => el.tags?.ele && !isNaN(parseFloat(el.tags.ele)))
    .map(el => {
      const name = el.tags.name;
      const override = PEAK_OVERRIDES[name];
      return {
        name,
        ele: parseFloat(el.tags.ele),
        lon: override ? override[0] : el.lon,
        lat: override ? override[1] : el.lat,
      };
    })
    .filter(peak => {
      if (withinFeature([peak.lon, peak.lat], boundary)) return true;
      console.log(`  Dropped peak ${peak.name} (${peak.lat},${peak.lon}) — outside state boundary`);
      return false;
    })
    .sort((a, b) => b.ele - a.ele)
    .slice(0, 10)
    .map(peak => ({
      type: 'Feature',
      properties: {
        name: peak.name,
        elevation: Math.round(peak.ele * 3.28084), // m → ft
      },
      geometry: { type: 'Point', coordinates: [peak.lon, peak.lat] },
    }));

  return { type: 'FeatureCollection', features };
}

// NHD ArcGIS REST was investigated as an alternative data source (2025-05) but proved
// unsuitable: 27s+ latency per bbox query, 51K+ features for large states (no per-state
// filter at the API level), outStatistics+geometry returns HTTP 400, and the `mainpath`
// field is always 0. OSM Overpass with segment chaining remains the source.

async function fetchRivers(stateName, stateFips) {
  const [s, w, n, e] = STATE_BBOX[stateName] || [];
  if (!s) return empty();

  const data = await overpass(`[out:json][timeout:60];
way["waterway"="river"]["name"](${s},${w},${n},${e});
(._;>;);
out body;`);

  // Build a node-id → {lon,lat} lookup
  const nodes = new Map();
  for (const el of data.elements || []) {
    if (el.type === 'node') nodes.set(el.id, { lon: el.lon, lat: el.lat });
  }

  // Collect all way segments per river name
  const byName = new Map();
  for (const el of data.elements || []) {
    if (el.type !== 'way') continue;
    const name = el.tags?.name;
    if (!name) continue;
    const pts = (el.nodes || []).map(id => nodes.get(id)).filter(Boolean);
    if (pts.length < 2) continue;
    // Alaska: normalize longitudes crossing antimeridian, drop far Aleutians
    if (stateFips === '02') {
      for (const p of pts) {
        if (p.lon > 0) p.lon -= 360;
        if (p.lon < -180) p.lon += 360;
      }
      const midLon = pts[Math.floor(pts.length / 2)].lon;
      if (midLon < -170) continue;
    }
    const segLen = coordLengthDeg(pts);
    const coords = pts.map(p => [p.lon, p.lat]);
    const prev = byName.get(name);
    if (!prev) {
      byName.set(name, { total: segLen, segments: [coords] });
    } else {
      prev.total += segLen;
      prev.segments.push(coords);
    }
  }

  const boundary = getStateBoundary(stateFips);
  let borderLine = null;
  if (boundary?.geometry) {
    const geom = boundary.geometry;
    const rings = geom.type === 'Polygon'
      ? [geom.coordinates[0]]
      : geom.coordinates.map(p => p[0]);
    borderLine = rings.length === 1 ? turf.lineString(rings[0]) : turf.multiLineString(rings);
  }

  return assembleRiverFeatures(byName, boundary, borderLine);
}

// Convert a river entry to a GeoJSON Feature (chain + noise-filter + simplify).
// Returns null if the river fails the length gate (and is not whitelisted).
// Module-level so both fetchRivers (OSM) and fetchRiversNHD share it.
function makeRiverFeature(name, segments) {
  if (!segments.length) return null;
  const chains = dominantComponent(chainSegments(segments));
  const MIN_SEG_LEN = 0.05;
  // Whitelisted rivers skip the per-chain length filter — they may be heavily
  // fragmented in OSM (e.g. Jordan River: 200+ tiny urban segments in Salt Lake).
  const meaningful = isWhitelisted(name)
    ? chains
    : chains.filter(c => segLength(c) >= MIN_SEG_LEN);
  // Fallback: if every chain is below threshold keep the longest so the total-length
  // check below (not the whitelist path) can decide whether to drop the river.
  const toUse = meaningful.length
    ? meaningful
    : [chains.reduce((a, b) => segLength(a) >= segLength(b) ? a : b)];
  const simplified = toUse.map(c => simplify(c, 60));
  const feature = {
    type: 'Feature',
    properties: { name, segment_count: simplified.length },
    geometry: simplified.length === 1
      ? { type: 'LineString',      coordinates: simplified[0] }
      : { type: 'MultiLineString', coordinates: simplified },
  };
  // Post-map total-length gate: drop invisible sub-pixel stubs.
  // Whitelisted rivers always pass regardless of total length.
  if (!isWhitelisted(name)) {
    const total = simplified.reduce((s, c) => s + segLength(c), 0);
    if (total < 0.05) return null;
  }
  return feature;
}

// Shared final assembly step for both fetchRivers and fetchRiversNHD.
// Applies keepSegment PIP filter, whitelist bypass, top-10 slice, makeRiverFeature.
function assembleRiverFeatures(byName, boundary, borderLine) {
  const BORDER_TOL = 0.05;

  function keepSegment(coords) {
    if (coords.length < 2) return false;
    if (!boundary) return true;
    const mid = turf.point(coords[Math.floor(coords.length / 2)]);
    if (turf.booleanPointInPolygon(mid, boundary)) return true;
    if (borderLine) {
      const rings = borderLine.geometry.type === 'MultiLineString'
        ? borderLine.geometry.coordinates
        : [borderLine.geometry.coordinates];
      const dist = Math.min(...rings.map(ring =>
        turf.pointToLineDistance(mid, turf.lineString(ring), { units: 'degrees' })
      ));
      if (dist < BORDER_TOL) return true;
    }
    return false;
  }

  const candidates = [...byName.entries()]
    .map(([name, { total, segments }]) => ({
      name, total, filtered: segments.filter(keepSegment),
    }))
    .filter(r => r.filtered.length > 0);

  // Whitelisted rivers bypass the top-10 slice — include them unconditionally
  // (they may rank outside the top 10 by raw length, like the Jordan River in UT).
  const whitelisted = candidates.filter(r => isWhitelisted(r.name));
  const others      = candidates.filter(r => !isWhitelisted(r.name));

  const whitelistedFeatures = whitelisted
    .map(r => makeRiverFeature(r.name, r.filtered))
    .filter(Boolean);

  const slotsForOthers = Math.max(0, 10 - whitelistedFeatures.length);
  const otherFeatures = others
    .sort((a, b) => b.total - a.total)
    .slice(0, slotsForOthers + 5)  // over-fetch to absorb post-map drops
    .map(r => makeRiverFeature(r.name, r.filtered))
    .filter(Boolean)
    .slice(0, slotsForOthers);

  return {
    type: 'FeatureCollection',
    features: [...whitelistedFeatures, ...otherFeatures],
  };
}

// ── NHD local river fetch (--rivers-nhd) ─────────────────────────────────────
// Reads pre-extracted per-state GeoJSON from scripts/data/nhd_states/{slug}.geojson.
// Run python3 scripts/extract_nhd_flowlines.py to build those files.
// NHD advantage over OSM: fcode 39004 (artificial path) fills reservoir gaps so
// rivers like the Mississippi are continuous through every Twin Cities dam pool.

async function fetchRiversNHD(stateName, stateFips) {
  const stateSlug = slug(stateName);
  const stateFile = join(__dirname, `../scripts/data/nhd_states/${stateSlug}.geojson`);

  let fc;
  try {
    fc = JSON.parse(readFileSync(stateFile, 'utf8'));
  } catch {
    throw new Error(
      `NHD state file not found: ${stateFile}\n` +
      `  Run: python3 scripts/extract_nhd_flowlines.py "${stateName}"`
    );
  }

  // Build byName map — each feature is already a LineString (decomposed by extraction script)
  const byName = new Map();
  for (const f of fc.features) {
    const name = f.properties?.gnis_name;
    if (!name || f.geometry?.type !== 'LineString') continue;
    const coords = f.geometry.coordinates;
    if (!coords || coords.length < 2) continue;
    const segLen = segLength(coords);
    const prev = byName.get(name);
    if (!prev) {
      byName.set(name, { total: segLen, segments: [coords] });
    } else {
      prev.total += segLen;
      prev.segments.push(coords);
    }
  }

  const boundary = getStateBoundary(stateFips);
  let borderLine = null;
  if (boundary?.geometry) {
    const geom = boundary.geometry;
    const rings = geom.type === 'Polygon'
      ? [geom.coordinates[0]]
      : geom.coordinates.map(p => p[0]);
    borderLine = rings.length === 1 ? turf.lineString(rings[0]) : turf.multiLineString(rings);
  }

  return assembleRiverFeatures(byName, boundary, borderLine);
}

// ── NPS Parks (official NPS ArcGIS FeatureServer) ────────────────────────────

const NPS_PARKS_URL =
  'https://services1.arcgis.com/fBc8EJBxQRMcHlei/arcgis/rest/services/NPSParkBoundaries/FeatureServer/0/query' +
  '?where=1%3D1&outFields=UNIT_NAME%2CUNIT_TYPE%2CSTATE&returnGeometry=true&f=geojson&resultRecordCount=1000';

// NPS unit types to include in the parks quiz category
const ALLOWED_PARK_TYPES = new Set([
  'National Park',
  'National Monument',
  'National Recreation Area',
  'National Seashore',
  'National Lakeshore',
  'National Parkway',
  'National Preserve',
  'National Reserve',
  'National Historical Park',
  'National Battlefield',
  'National Memorial',
  'National River and Recreation Area',
]);

// Simplify all rings in a polygon/multipolygon geometry
function simplifyGeometry(geom, maxPerRing = 40) {
  if (geom.type === 'Polygon')
    return { type: 'Polygon', coordinates: geom.coordinates.map(r => simplify(r, maxPerRing)) };
  if (geom.type === 'MultiPolygon')
    return { type: 'MultiPolygon', coordinates: geom.coordinates.map(p => p.map(r => simplify(r, maxPerRing))) };
  return geom;
}

// Bounding box [minLon, minLat, maxLon, maxLat] of a GeoJSON geometry
function bboxOfGeom(geom) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const visit = c => {
    if (typeof c[0] === 'number') {
      if (c[0] < minX) minX = c[0]; if (c[0] > maxX) maxX = c[0];
      if (c[1] < minY) minY = c[1]; if (c[1] > maxY) maxY = c[1];
    } else c.forEach(visit);
  };
  visit(geom.coordinates);
  return [minX, minY, maxX, maxY];
}

// Sample up to n coordinate pairs from a polygon/multipolygon geometry
function sampleCoords(geom, n = 25) {
  const all = [];
  const visit = c => { if (typeof c[0] === 'number') all.push(c); else c.forEach(visit); };
  visit(geom.coordinates);
  if (!all.length) return [];
  const step = Math.max(1, Math.floor(all.length / n));
  return all.filter((_, i) => i % step === 0);
}

function bboxesOverlap([aX1, aY1, aX2, aY2], [bX1, bY1, bX2, bY2]) {
  return aX1 <= bX2 && aX2 >= bX1 && aY1 <= bY2 && aY2 >= bY1;
}

// NPS parks keyed by FIPS, built once and reused across all states
let NPS_PARKS_BY_FIPS = null;

async function buildNPSParksMap() {
  process.stdout.write('Downloading NPS park boundaries… ');
  const res = await fetch(NPS_PARKS_URL, {
    headers: { 'User-Agent': 'Whereabouts/1.0 (educational geography quiz)' },
  });
  if (!res.ok) throw new Error(`NPS API HTTP ${res.status}`);
  const data = await res.json();

  const parks = (data.features || []).filter(
    f => f.geometry?.coordinates && ALLOWED_PARK_TYPES.has(f.properties.UNIT_TYPE)
  );
  process.stdout.write(`${parks.length} qualifying NPS units\n`);

  // Ensure state boundaries are loaded, then pre-compute each state's bbox
  if (!STATE_GEO) {
    const topoPath = join(__dirname, '../node_modules/us-atlas/states-10m.json');
    const topo = JSON.parse(readFileSync(topoPath, 'utf8'));
    STATE_GEO = topojson.feature(topo, topo.objects.states);
  }
  const stateMeta = STATE_GEO.features.map(sf => ({
    fips: String(sf.id),
    sf,
    bbox: bboxOfGeom(sf.geometry),
  }));

  const byFips = new Map();

  for (const park of parks) {
    const geom = park.geometry;
    const parkBbox = bboxOfGeom(geom);
    const [x1, y1, x2, y2] = parkBbox;
    const centroid = [(x1 + x2) / 2, (y1 + y2) / 2];

    // Sample polygon vertices to detect which states this park polygon overlaps.
    const samples = sampleCoords(geom, 25);
    if (!samples.length) samples.push(centroid);

    const parkFips = [];
    const parkAbbrevs = [];
    for (const { fips, sf, bbox: stateBbox } of stateMeta) {
      if (!bboxesOverlap(parkBbox, stateBbox)) continue;
      if (samples.some(pt => withinFeature(pt, sf))) {
        parkFips.push(fips);
        if (STATE_ABBREV[fips]) parkAbbrevs.push(STATE_ABBREV[fips]);
      }
    }

    if (!parkFips.length) continue;

    const parkBase = {
      type: 'Feature',
      properties: {
        name: park.properties.UNIT_NAME,
        type: park.properties.UNIT_TYPE,
        states: parkAbbrevs,
        boundary: simplifyGeometry(geom),
      },
    };

    const stateOverride = PARK_OVERRIDES[park.properties.UNIT_NAME];
    for (const fips of parkFips) {
      if (!byFips.has(fips)) byFips.set(fips, []);
      const abbrev = STATE_ABBREV[fips];
      const coords = stateOverride?.[abbrev] || centroid;
      byFips.get(fips).push({ ...parkBase, geometry: { type: 'Point', coordinates: coords } });
    }
  }

  return byFips;
}

// ── Cities ───────────────────────────────────────────────────────────────────

let NE_CITIES = null;
async function fetchCities(stateName) {
  if (!NE_CITIES) {
    process.stdout.write('(downloading Natural Earth cities…) ');
    const res = await fetch(
      'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places.geojson',
      { headers: { 'User-Agent': 'Whereabouts/1.0' } },
    );
    if (!res.ok) throw new Error(`Natural Earth HTTP ${res.status}`);
    NE_CITIES = (await res.json()).features;
    process.stdout.write(`(${NE_CITIES.length} places loaded) `);
  }

  return {
    type: 'FeatureCollection',
    features: NE_CITIES
      .filter(f =>
        f.properties.ADM1NAME === stateName &&
        (f.properties.SOV0NAME === 'United States' || f.properties.SOV0NAME === 'United States of America')
      )
      .sort((a, b) => (b.properties.POP_MAX || 0) - (a.properties.POP_MAX || 0))
      .map(f => ({
        type: 'Feature',
        properties: { name: f.properties.NAME, pop: f.properties.POP_MAX },
        geometry: {
          type: 'Point',
          coordinates: [f.geometry.coordinates[0], f.geometry.coordinates[1]],
        },
      })),
  };
}

// ── Writers ──────────────────────────────────────────────────────────────────

function writeStateFile(fips, stateName, { rivers, peaks, parks, cities }) {
  const content =
    '// Auto-generated by scripts/fetch-state-data.js — do not edit manually\n\n' +
    `export const rivers = ${JSON.stringify(rivers, null, 2)};\n\n` +
    `export const peaks = ${JSON.stringify(peaks, null, 2)};\n\n` +
    `export const parks = ${JSON.stringify(parks, null, 2)};\n\n` +
    `export const cities = ${JSON.stringify(cities, null, 2)};\n`;
  writeFileSync(join(OUT_DIR, slug(stateName) + '.js'), content, 'utf8');
}

function writeIndex() {
  const lines = Object.entries(STATE_FIPS)
    .map(([fips, name]) => `  '${fips}': () => import('./${slug(name)}.js'),`)
    .join('\n');
  writeFileSync(
    join(OUT_DIR, 'index.js'),
    `// Auto-generated by scripts/fetch-state-data.js — do not edit manually\nexport const STATE_FEATURES = {\n${lines}\n};\n`,
  );
}

// Read all four feature exports from an existing state file.
// Used by --parks-only and --rivers-only to preserve untouched categories.
function readExistingFeatures(stateName) {
  const filePath = join(OUT_DIR, slug(stateName) + '.js');
  try {
    const content = readFileSync(filePath, 'utf8');
    const result = {};
    const sections = content.split(/\n\nexport const /);
    for (const section of sections.slice(1)) {
      const eqIdx = section.indexOf(' = ');
      const key = section.slice(0, eqIdx).trim();
      const jsonStr = section.slice(eqIdx + 3).replace(/;\s*$/, '').trim();
      result[key] = JSON.parse(jsonStr);
    }
    return result;
  } catch {
    return null;
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const parksOnly  = process.argv.includes('--parks-only');
  const riversOnly = process.argv.includes('--rivers-only');
  const peaksOnly  = process.argv.includes('--peaks-only');
  const riversNhd  = process.argv.includes('--rivers-nhd');
  const requested  = process.argv.slice(2).filter(a => !a.startsWith('--'));
  let entries = Object.entries(STATE_FIPS);
  if (requested.length) {
    entries = entries.filter(([, name]) =>
      requested.some(r => name.toLowerCase() === r.toLowerCase())
    );
    if (!entries.length) {
      console.error('No matching states found for:', requested.join(', '));
      process.exit(1);
    }
  }

  // Download NPS park data only when needed (not for rivers-only / rivers-nhd / peaks-only runs)
  if (!riversOnly && !riversNhd && !peaksOnly) {
    NPS_PARKS_BY_FIPS = await buildNPSParksMap();
  }

  const errors = [];

  for (let i = 0; i < entries.length; i++) {
    const [fips, name] = entries[i];
    process.stdout.write(`[${String(i + 1).padStart(2, '0')}/${String(entries.length).padStart(2, '0')}] ${name.padEnd(16)} `);

    try {
      // ── Parks-only mode ──────────────────────────────────────────────────
      if (parksOnly) {
        const existing = readExistingFeatures(name);
        if (!existing) { console.log('SKIP (no existing file)'); continue; }
        const parks = { type: 'FeatureCollection', features: NPS_PARKS_BY_FIPS.get(fips) || [] };
        writeStateFile(fips, name, {
          rivers: existing.rivers, peaks: existing.peaks, parks, cities: existing.cities,
        });
        console.log(`parks:${String(parks.features.length).padStart(2)} (rivers/peaks/cities preserved)`);
        continue;
      }

      // ── Rivers-only mode ─────────────────────────────────────────────────
      if (riversOnly) {
        const existing = readExistingFeatures(name);
        if (!existing) { console.log('SKIP (no existing file)'); continue; }
        const rivers = await fetchRivers(name, fips).catch(e => {
          errors.push(`${name} rivers: ${e.message}`); return empty();
        });
        writeStateFile(fips, name, {
          rivers, peaks: existing.peaks, parks: existing.parks, cities: existing.cities,
        });
        console.log(
          `rivers:${String(rivers.features.length).padStart(2)} ` +
          `segs:[${rivers.features.map(f => f.properties.segment_count).join(',')}] ` +
          `(peaks/parks/cities preserved)`
        );
        if (i < entries.length - 1) await sleep(10000); // Overpass rate limit
        continue;
      }

      // ── NHD rivers mode ──────────────────────────────────────────────────
      if (riversNhd) {
        const existing = readExistingFeatures(name);
        if (!existing) { console.log('SKIP (no existing file)'); continue; }
        const rivers = await fetchRiversNHD(name, fips).catch(e => {
          errors.push(`${name} rivers: ${e.message}`); return empty();
        });
        writeStateFile(fips, name, {
          rivers, peaks: existing.peaks, parks: existing.parks, cities: existing.cities,
        });
        console.log(
          `rivers:${String(rivers.features.length).padStart(2)} ` +
          `segs:[${rivers.features.map(f => f.properties.segment_count).join(',')}] ` +
          `(peaks/parks/cities preserved)`
        );
        continue; // no sleep — reads local files
      }

      // ── Peaks-only mode ──────────────────────────────────────────────────
      if (peaksOnly) {
        const existing = readExistingFeatures(name);
        if (!existing) { console.log('SKIP (no existing file)'); continue; }
        const peaks = await fetchPeaks(name, fips).catch(e => {
          errors.push(`${name} peaks: ${e.message}`); return empty();
        });
        writeStateFile(fips, name, {
          rivers: existing.rivers, peaks, parks: existing.parks, cities: existing.cities,
        });
        console.log(`peaks:${String(peaks.features.length).padStart(2)} (rivers/parks/cities preserved)`);
        if (i < entries.length - 1) await sleep(10000);
        continue;
      }

      // ── Full run ─────────────────────────────────────────────────────────
      const parks = { type: 'FeatureCollection', features: NPS_PARKS_BY_FIPS.get(fips) || [] };

      const [peaks, cities] = await Promise.all([
        fetchPeaks(name, fips).catch(e => { errors.push(`${name} peaks: ${e.message}`); return empty(); }),
        fetchCities(name).catch(e => { errors.push(`${name} cities: ${e.message}`); return empty(); }),
      ]);

      await sleep(1000);
      const rivers = await fetchRivers(name, fips).catch(e => {
        errors.push(`${name} rivers: ${e.message}`); return empty();
      });

      const boundary = getStateBoundary(fips);
      const filtered = {
        // Rivers are filtered inside fetchRivers (turf PIP + border proximity)
        rivers,
        peaks:  filterInState(peaks,  boundary, 10),
        parks,
        cities: filterInState(cities, boundary, 10),
      };

      writeStateFile(fips, name, filtered);
      console.log(
        `rivers:${String(filtered.rivers.features.length).padStart(2)} ` +
        `peaks:${String(filtered.peaks.features.length).padStart(2)} ` +
        `parks:${String(filtered.parks.features.length).padStart(2)} ` +
        `cities:${String(filtered.cities.features.length).padStart(2)}`
      );
    } catch (e) {
      console.error(`FATAL: ${e.message}`);
      errors.push(`${name}: ${e.message}`);
    }

    if (!parksOnly && i < entries.length - 1) await sleep(3000);
  }

  writeIndex();

  if (errors.length) {
    console.log('\nWarnings / errors:');
    errors.forEach(e => console.log('  -', e));
  }
  console.log(`\nDone. ${entries.length} state file(s) + index.js → ${OUT_DIR}`);
}

main().catch(e => { console.error(e); process.exit(1); });
