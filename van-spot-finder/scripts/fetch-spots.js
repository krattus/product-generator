#!/usr/bin/env node
/*
 * Downloads OpenStreetMap data + a 7-day solar/weather forecast for each area,
 * scores every candidate spot, and writes:
 *   data/van-data.json   – raw result (for other tools)
 *   data/van-data.js     – same data as `window.VAN_DATA = …` so index.html works offline / from file://
 *
 * Usage:  node van-spot-finder/scripts/fetch-spots.js [areaId ...]
 * Behind an HTTP proxy run with NODE_USE_ENV_PROXY=1 (Node 22.21+).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import '../engine.js';
import { loadTile, canopyGrid, downsample2 } from './canopy.js';

const { AREAS, buildQuery, analyze, fetchOverpass, makeCanopyLookup, encodeRuns } = globalThis.VanEngine;
const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'data');
const cacheDir = join(here, '..', '.cache');

async function weather(area) {
  const [lat, lon] = area.center;
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    daily: 'shortwave_radiation_sum,sunshine_duration,temperature_2m_max,temperature_2m_min,precipitation_probability_max,cloud_cover_mean,uv_index_max,sunrise,sunset',
    timezone: 'Australia/Sydney',
    forecast_days: '7',
  }).toString();
  let j, err;
  for (let i = 0; i < 4 && !j; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
      j = await res.json();
    } catch (e) {
      err = e;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** i));
    }
  }
  if (!j) throw err;
  return { fetchedAt: new Date().toISOString(), daily: j.daily };
}

async function osmFor(area, useCache) {
  const file = join(cacheDir, `${area.id}.osm.json`);
  if (useCache) {
    try { return JSON.parse(await readFile(file, 'utf8')); } catch { /* fall through */ }
  }
  const json = await fetchOverpass(buildQuery(area.bbox), {
    onAttempt: (u) => console.log(`  … ${area.name}: querying ${new URL(u).host}`),
  });
  await mkdir(cacheDir, { recursive: true });
  await writeFile(file, JSON.stringify(json));
  return json;
}

const args = process.argv.slice(2);
const useCache = args.includes('--cache');
const wanted = args.filter((a) => !a.startsWith('--'));
const areas = wanted.length ? AREAS.filter((a) => wanted.includes(a.id)) : AREAS;

const tile = await loadTile(cacheDir);
const out = { generatedAt: new Date().toISOString(), areas: [] };
for (const area of areas) {
  console.log(`▶ ${area.name}`);
  const osm = await osmFor(area, useCache);
  const grid = await canopyGrid(tile, area.bbox);
  const result = analyze(osm, area, { basemap: true, canopy: makeCanopyLookup(grid) });
  const small = downsample2(grid);
  result.basemap.canopy = { bbox: small.bbox, w: small.w, h: small.h, runs: encodeRuns(small.data) };
  const treePct = Math.round((100 * grid.data.reduce((a, b) => a + b, 0)) / grid.data.length);
  console.log(`  tree cover ${treePct}% of area (${grid.w}×${grid.h} px)`);
  let wx = null;
  try { wx = await weather(area); } catch (e) { console.warn(`  weather failed: ${e.message}`); }
  out.areas.push({ ...area, spots: result.spots, basemap: result.basemap, weather: wx });
  console.log(`  ${result.spots.length} spots scored (${osm.elements.length} OSM elements)`);
}

// Spots near two areas' edges are found twice: keep each one in the area whose centre is closer.
const owner = new Map();
for (const a of out.areas) for (const s of a.spots) {
  const d = globalThis.VanEngine.distM([s.lat, s.lon], a.center);
  const cur = owner.get(s.id);
  if (!cur || d < cur.d) owner.set(s.id, { area: a.id, d });
}
for (const a of out.areas) a.spots = a.spots.filter((s) => owner.get(s.id).area === a.id);

await mkdir(dataDir, { recursive: true });
const json = JSON.stringify(out);
await writeFile(join(dataDir, 'van-data.json'), json);
await writeFile(join(dataDir, 'van-data.js'), `window.VAN_DATA = ${json};\n`);
console.log(`✔ wrote data/van-data.json (${(json.length / 1024).toFixed(0)} KB)`);
