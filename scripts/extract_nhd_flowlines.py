#!/usr/bin/env python3
"""
Download per-state NHD High Resolution GDB files and extract NHDFlowline
features to per-state GeoJSON files used by --rivers-nhd in fetch-state-data.js.

Usage:
    python3 scripts/extract_nhd_flowlines.py              # all 50 states
    python3 scripts/extract_nhd_flowlines.py Minnesota    # single state
    python3 scripts/extract_nhd_flowlines.py MN UT        # by abbreviation
    python3 scripts/extract_nhd_flowlines.py Minnesota Iowa Wisconsin

Output per state: scripts/data/nhd_states/{state-slug}.geojson

Each feature is a single LineString (MultiLineString components are decomposed)
so fetch-state-data.js can apply the same chainSegments/coherentChains pipeline
it uses on OSM data.

Filters:
  gnis_name IS NOT NULL AND gnis_name != ''
  fcode IN (46006, 46003, 39004)   perennial, intermittent, artificial path (reservoir)
  lengthkm > 0.1                   drop truly tiny sub-100m noise

No length-km lower bound is set high here because fetch-state-data.js applies its
own 0.05° noise filter after chaining. The fcode 39004 (artificial path through
reservoirs) is the key addition over OSM: it fills the gaps behind dams on rivers
like the Mississippi through the Twin Cities pool reaches.
"""

import json
import os
import sys
import zipfile
import warnings
import urllib.request
import urllib.error

warnings.filterwarnings('ignore')

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR   = os.path.join(SCRIPT_DIR, 'data')
OUT_DIR    = os.path.join(DATA_DIR, 'nhd_states')

BASE_URL = 'https://prd-tnm.s3.amazonaws.com/StagedProducts/Hydrography/NHD/State/GDB'

ALLOWED_FCODES = {46006, 46003, 39004, 55800}
MIN_LENGTH_KM  = 0.1

# Names containing these strings (case-insensitive) and fcode 55800 are true man-made
# canals/ditches — exclude them so only rivers impounded behind dams pass through.
CANAL_WORDS = {'canal', 'ditch', 'drain', 'aqueduct', 'flume', 'barge'}

# All 50 US states with NHD file naming (spaces → underscores in URL)
STATES = {
    'Alabama':        'AL', 'Alaska':         'AK', 'Arizona':        'AZ',
    'Arkansas':       'AR', 'California':     'CA', 'Colorado':       'CO',
    'Connecticut':    'CT', 'Delaware':       'DE', 'Florida':        'FL',
    'Georgia':        'GA', 'Hawaii':         'HI', 'Idaho':          'ID',
    'Illinois':       'IL', 'Indiana':        'IN', 'Iowa':           'IA',
    'Kansas':         'KS', 'Kentucky':       'KY', 'Louisiana':      'LA',
    'Maine':          'ME', 'Maryland':       'MD', 'Massachusetts':  'MA',
    'Michigan':       'MI', 'Minnesota':      'MN', 'Mississippi':    'MS',
    'Missouri':       'MO', 'Montana':        'MT', 'Nebraska':       'NE',
    'Nevada':         'NV', 'New Hampshire':  'NH', 'New Jersey':     'NJ',
    'New Mexico':     'NM', 'New York':       'NY', 'North Carolina': 'NC',
    'North Dakota':   'ND', 'Ohio':           'OH', 'Oklahoma':       'OK',
    'Oregon':         'OR', 'Pennsylvania':   'PA', 'Rhode Island':   'RI',
    'South Carolina': 'SC', 'South Dakota':   'SD', 'Tennessee':      'TN',
    'Texas':          'TX', 'Utah':           'UT', 'Vermont':        'VT',
    'Virginia':       'VA', 'Washington':     'WA', 'West Virginia':  'WV',
    'Wisconsin':      'WI', 'Wyoming':        'WY',
}

ABBREV_TO_NAME = {v: k for k, v in STATES.items()}


def slug(name):
    return name.lower().replace(' ', '-').replace("'", '')


def nhd_filename(state_name):
    return f"NHD_H_{state_name.replace(' ', '_')}_State_GDB"


def download_state(state_name, dest_dir):
    fname = nhd_filename(state_name)
    zip_path = os.path.join(dest_dir, f'{fname}.zip')
    url = f'{BASE_URL}/{fname}.zip'

    if os.path.exists(zip_path):
        print(f'  zip cached: {zip_path}')
        return zip_path

    print(f'  downloading {url} …', flush=True)
    try:
        req = urllib.request.Request(
            url,
            headers={'User-Agent': 'Whereabouts/1.0 (educational geography quiz)'}
        )
        with urllib.request.urlopen(req) as resp, open(zip_path, 'wb') as f:
            total = int(resp.getheader('Content-Length', 0))
            downloaded = 0
            chunk = 1 << 20  # 1 MB
            while True:
                block = resp.read(chunk)
                if not block:
                    break
                f.write(block)
                downloaded += len(block)
                if total:
                    pct = downloaded * 100 // total
                    print(f'\r  {pct:3d}% ({downloaded // (1 << 20)} / {total // (1 << 20)} MB)', end='', flush=True)
        print()
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'HTTP {e.code} downloading {url}')
    return zip_path


def extract_gdb(zip_path, dest_dir):
    """Unzip and return path to the .gdb directory inside."""
    fname_base = os.path.splitext(os.path.basename(zip_path))[0]
    gdb_path = os.path.join(dest_dir, f'{fname_base}.gdb')
    if os.path.exists(gdb_path):
        return gdb_path
    print(f'  unzipping …', flush=True)
    with zipfile.ZipFile(zip_path, 'r') as zf:
        # Only extract .gdb members (not .jpg / .xml)
        members = [m for m in zf.namelist() if '.gdb/' in m or m.endswith('.gdb')]
        zf.extractall(dest_dir, members=members)
    return gdb_path


def read_flowlines(gdb_path):
    """Read NHDFlowline from GDB, decompose MultiLineStrings into LineStrings.

    Returns list of dicts: {gnis_name, fcode, lengthkm, coordinates: [[lon,lat], ...]}
    """
    import pyogrio.raw
    import shapely.wkb

    result = pyogrio.raw.read(
        gdb_path,
        layer='NHDFlowline',
        columns=['gnis_name', 'fcode', 'lengthkm'],
        where=(
            f"gnis_name IS NOT NULL AND gnis_name != '' "
            f"AND fcode IN (46006,46003,39004,55800) "
            f"AND lengthkm > {MIN_LENGTH_KM}"
        ),
        force_2d=True,
    )

    meta, _, geoms_wkb, fields_data = result
    field_names = list(meta['fields'])
    fi = {n: i for i, n in enumerate(field_names)}

    gnis_col  = fields_data[fi['gnis_name']]
    fcode_col = fields_data[fi['fcode']]
    len_col   = fields_data[fi['lengthkm']]

    segments = []
    for i in range(len(geoms_wkb)):
        name = gnis_col[i]
        if not name:
            continue
        name = str(name).strip()
        if not name:
            continue
        fcode    = int(fcode_col[i])
        lengthkm = float(len_col[i])

        # For fcode 55800 (Canal/Ditch), keep only features whose name looks like
        # a river — exclude true man-made canals, ditches, and drains.
        if fcode == 55800:
            name_lower = name.lower()
            if any(w in name_lower for w in CANAL_WORDS):
                continue

        geom = shapely.wkb.loads(bytes(geoms_wkb[i]))
        # Decompose MultiLineString → individual LineStrings
        if geom.geom_type == 'LineString':
            lines = [geom]
        elif geom.geom_type == 'MultiLineString':
            lines = list(geom.geoms)
        else:
            continue

        for ls in lines:
            coords = [[round(x, 7), round(y, 7)] for x, y in ls.coords]
            if len(coords) < 2:
                continue
            segments.append({
                'gnis_name': name,
                'fcode':     fcode,
                'lengthkm':  lengthkm,
                'coordinates': coords,
            })

    return segments


def write_geojson(segments, out_path):
    features = []
    for seg in segments:
        features.append({
            'type': 'Feature',
            'properties': {
                'gnis_name': seg['gnis_name'],
                'fcode':     seg['fcode'],
                'lengthkm':  seg['lengthkm'],
            },
            'geometry': {
                'type': 'LineString',
                'coordinates': seg['coordinates'],
            },
        })
    fc = {'type': 'FeatureCollection', 'features': features}
    with open(out_path, 'w') as f:
        json.dump(fc, f, separators=(',', ':'))
    return len(features)


def process_state(state_name, tmp_dir, out_dir):
    out_path = os.path.join(out_dir, f'{slug(state_name)}.geojson')
    if os.path.exists(out_path):
        size = os.path.getsize(out_path)
        print(f'  already extracted ({size // 1024} KB) — skipping. Delete to re-run.')
        return

    zip_path = download_state(state_name, tmp_dir)
    gdb_path = extract_gdb(zip_path, tmp_dir)

    print(f'  reading NHDFlowline …', flush=True)
    segments = read_flowlines(gdb_path)
    count = write_geojson(segments, out_path)
    size_kb = os.path.getsize(out_path) // 1024
    print(f'  {count:,} segments → {out_path} ({size_kb} KB)')

    # Clean up GDB and ZIP to save disk space
    import shutil
    shutil.rmtree(gdb_path, ignore_errors=True)
    try:
        os.remove(zip_path)
    except OSError:
        pass


def resolve_states(args):
    """Map CLI args (full name or 2-letter abbrev) to canonical state names."""
    if not args:
        return list(STATES.keys())
    out = []
    for a in args:
        if a in STATES:
            out.append(a)
        elif a.upper() in ABBREV_TO_NAME:
            out.append(ABBREV_TO_NAME[a.upper()])
        else:
            sys.exit(f'Unknown state: {a!r}')
    return out


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    tmp_dir = os.path.join(DATA_DIR, 'nhd_tmp')
    os.makedirs(tmp_dir, exist_ok=True)

    states = resolve_states(sys.argv[1:])
    print(f'Processing {len(states)} state(s)…\n')

    errors = []
    for i, state_name in enumerate(states, 1):
        print(f'[{i:02d}/{len(states):02d}] {state_name}')
        try:
            process_state(state_name, tmp_dir, OUT_DIR)
        except Exception as e:
            print(f'  ERROR: {e}')
            errors.append(f'{state_name}: {e}')
        print()

    # Clean up temp dir if empty
    try:
        os.rmdir(tmp_dir)
    except OSError:
        pass

    if errors:
        print('Errors:')
        for e in errors:
            print(f'  - {e}')
    print(f'Done. Output in {OUT_DIR}')


if __name__ == '__main__':
    main()
