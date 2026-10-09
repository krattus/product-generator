/*
 * Van Spot Finder — scoring engine.
 *
 * Turns raw OpenStreetMap data (Overpass API JSON) into ranked overnight
 * spots for someone living in a van. Works in the browser (window.VanEngine)
 * and in Node (import './engine.js' then globalThis.VanEngine).
 *
 * Every spot gets three 0–100 sub-scores:
 *   shade      – tree canopy around the spot (ESA WorldCover 10 m satellite tree cover + OSM woods/trees)
 *   solar      – how open the northern sky is (southern hemisphere: sun sits north)
 *   isolation  – few buildings, away from towns, homes and busy roads
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Areas the user asked about (Northern Rivers, NSW, Australia)
  // bbox = [south, west, north, east]
  // ---------------------------------------------------------------------------
  const AREAS = [
    {
      id: 'murwillumbah',
      name: 'Murwillumbah',
      aka: 'Marwell Bar',
      council: 'Tweed Shire',
      center: [-28.3268, 153.3972],
      bbox: [-28.41, 153.30, -28.25, 153.48],
      notes: [
        'Tweed Shire Council does not allow camping or overnight stays in its parks and reserves.',
        'Murwillumbah Showground takes short-stay RVs and campervans. Book ahead.',
      ],
    },
    {
      id: 'burringbar',
      name: 'Burringbar',
      aka: 'Boring Bar',
      council: 'Tweed Shire',
      center: [-28.4333, 153.4725],
      bbox: [-28.50, 153.38, -28.38, 153.56],
      notes: [
        'Tweed Shire bans overnight parking (11pm–5am) at signed coastal car parks such as Pottsville and Cabarita. The quieter hinterland roads around Burringbar have no such signs.',
        'There is at least one private farm stay near Burringbar on Hipcamp that takes RVs and vans.',
      ],
    },
    {
      id: 'mullumbimby',
      name: 'Mullumbimby',
      aka: 'Malimbimbi',
      council: 'Byron Shire',
      center: [-28.5483, 153.5011],
      bbox: [-28.62, 153.40, -28.48, 153.58],
      notes: [
        'Byron Shire Council enforces its no-camping rules and has fined people sleeping in vehicles. It has said it would use number-plate recognition to issue tickets.',
        'State forests are the main legal free option. Forestry Corporation allows free camping for up to 4 weeks unless signs say otherwise.',
      ],
    },
    {
      id: 'byron',
      name: 'Byron Bay',
      aka: '',
      council: 'Byron Shire',
      center: [-28.6483, 153.6178],
      bbox: [-28.73, 153.52, -28.60, 153.66],
      notes: [
        'Byron Bay is the most heavily patrolled place in the region. Rangers fine people sleeping in vehicles, especially in beach car parks and during holidays.',
        'Use the town for the day, then sleep in a campground or out in the hinterland.',
      ],
    },
  ];

  // ---------------------------------------------------------------------------
  // Overpass query
  // ---------------------------------------------------------------------------
  const OVERPASS_ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
  ];

  function buildQuery(bbox) {
    const B = bbox.join(',');
    return `[out:json][timeout:180];
(
  nwr["amenity"="parking"](${B});
  nwr["highway"="rest_area"](${B});
  nwr["tourism"~"^(camp_site|caravan_site|picnic_site|viewpoint)$"](${B});
  nwr["amenity"~"^(toilets|drinking_water|shower)$"](${B});
  node["place"~"^(city|town|suburb|village|hamlet|locality)$"](${B});
);
out center tags;
(
  way["natural"="wood"](${B});
  way["landuse"="forest"](${B});
  rel["natural"="wood"](${B});
  rel["landuse"="forest"](${B});
  way["boundary"~"^(protected_area|national_park)$"](${B});
  rel["boundary"~"^(protected_area|national_park)$"](${B});
  way["leisure"="nature_reserve"](${B});
  rel["leisure"="nature_reserve"](${B});
);
out geom;
(
  way["natural"="tree_row"](${B});
  way["landuse"="residential"](${B});
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|track)$"](${B});
  way["natural"="water"](${B});
  way["natural"="coastline"](${B});
  way["waterway"="river"](${B});
);
out geom(${B});
node["natural"="tree"](${B});
out skel;
way["building"](${B});
out ids center;`;
  }

  // ---------------------------------------------------------------------------
  // Geometry helpers. Points are [lat, lon].
  // ---------------------------------------------------------------------------
  const M_PER_DEG_LAT = 110574;
  const mPerDegLon = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);
  const clamp01 = (x) => Math.max(0, Math.min(1, x));

  function distM(a, b) {
    const dy = (a[0] - b[0]) * M_PER_DEG_LAT;
    const dx = (a[1] - b[1]) * mPerDegLon((a[0] + b[0]) / 2);
    return Math.hypot(dx, dy);
  }

  function offset(p, bearingDeg, meters) {
    const r = (bearingDeg * Math.PI) / 180;
    return [
      p[0] + (Math.cos(r) * meters) / M_PER_DEG_LAT,
      p[1] + (Math.sin(r) * meters) / mPerDegLon(p[0]),
    ];
  }

  function pointInRing(p, ring) {
    let inside = false;
    const y = p[0], x = p[1];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const yi = ring[i][0], xi = ring[i][1];
      const yj = ring[j][0], xj = ring[j][1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function inPolygon(p, poly) {
    if (p[0] < poly.bb[0] || p[0] > poly.bb[2] || p[1] < poly.bb[1] || p[1] > poly.bb[3]) return false;
    if (!poly.outer.some((r) => pointInRing(p, r))) return false;
    return !poly.inner.some((r) => pointInRing(p, r));
  }

  function distToSegmentM(p, a, b) {
    const k = mPerDegLon(p[0]);
    const ax = (a[1] - p[1]) * k, ay = (a[0] - p[0]) * M_PER_DEG_LAT;
    const bx = (b[1] - p[1]) * k, by = (b[0] - p[0]) * M_PER_DEG_LAT;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? -(ax * dx + ay * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(ax + t * dx, ay + t * dy);
  }

  function distToLineM(p, line) {
    let best = Infinity;
    for (let i = 1; i < line.length; i++) best = Math.min(best, distToSegmentM(p, line[i - 1], line[i]));
    return best;
  }

  function bboxOf(rings) {
    const bb = [Infinity, Infinity, -Infinity, -Infinity];
    for (const r of rings) for (const [la, lo] of r) {
      if (la < bb[0]) bb[0] = la;
      if (lo < bb[1]) bb[1] = lo;
      if (la > bb[2]) bb[2] = la;
      if (lo > bb[3]) bb[3] = lo;
    }
    return bb;
  }

  // Join multipolygon member ways into closed rings.
  function assembleRings(ways) {
    const key = (p) => p[0].toFixed(7) + ',' + p[1].toFixed(7);
    const pool = ways.filter((w) => w.length > 1).map((w) => w.slice());
    const rings = [];
    while (pool.length) {
      let ring = pool.shift();
      let guard = 0;
      while (key(ring[0]) !== key(ring[ring.length - 1]) && guard++ < 10000) {
        const end = key(ring[ring.length - 1]);
        const idx = pool.findIndex((w) => key(w[0]) === end || key(w[w.length - 1]) === end);
        if (idx < 0) break; // unclosed (data cut off) – keep what we have
        const w = pool.splice(idx, 1)[0];
        ring = ring.concat(key(w[0]) === end ? w.slice(1) : w.slice().reverse().slice(1));
      }
      if (ring.length >= 3) rings.push(ring);
    }
    return rings;
  }

  function toPolygon(el) {
    const g = (geom) => (geom || []).filter(Boolean).map((n) => [n.lat, n.lon]);
    let outer = [], inner = [];
    if (el.type === 'way' && el.geometry) {
      outer = [g(el.geometry)];
    } else if (el.type === 'relation' && el.members) {
      const outs = el.members.filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry).map((m) => g(m.geometry));
      const ins = el.members.filter((m) => m.type === 'way' && m.role === 'inner' && m.geometry).map((m) => g(m.geometry));
      outer = assembleRings(outs);
      inner = assembleRings(ins);
    }
    outer = outer.filter((r) => r.length >= 3);
    if (!outer.length) return null;
    return { outer, inner, bb: bboxOf(outer), tags: el.tags || {}, id: el.type + '/' + el.id };
  }

  // Coarse spatial grid so we don't test every polygon for every sample point.
  class Grid {
    constructor(bbox, cell = 0.005) {
      this.s = bbox[0] - 0.02; this.w = bbox[1] - 0.02;
      this.n = bbox[2] + 0.02; this.e = bbox[3] + 0.02;
      this.cell = cell;
      this.rows = Math.ceil((this.n - this.s) / cell);
      this.cols = Math.ceil((this.e - this.w) / cell);
      this.cells = new Map();
    }
    _rc(lat, lon) {
      return [
        Math.max(0, Math.min(this.rows - 1, Math.floor((lat - this.s) / this.cell))),
        Math.max(0, Math.min(this.cols - 1, Math.floor((lon - this.w) / this.cell))),
      ];
    }
    insert(item, bb) {
      const [r0, c0] = this._rc(bb[0], bb[1]);
      const [r1, c1] = this._rc(bb[2], bb[3]);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const k = r * this.cols + c;
        if (!this.cells.has(k)) this.cells.set(k, []);
        this.cells.get(k).push(item);
      }
    }
    query(p, radiusM) {
      const dLat = radiusM / M_PER_DEG_LAT, dLon = radiusM / mPerDegLon(p[0]);
      const [r0, c0] = this._rc(p[0] - dLat, p[1] - dLon);
      const [r1, c1] = this._rc(p[0] + dLat, p[1] + dLon);
      const out = new Set();
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const list = this.cells.get(r * this.cols + c);
        if (list) for (const it of list) out.add(it);
      }
      return out;
    }
  }

  function lineBB(line) { return bboxOf([line]); }

  // Douglas–Peucker in metres, for shrinking basemap geometry.
  function simplify(line, tolM) {
    if (line.length <= 2) return line;
    let maxD = 0, idx = 0;
    for (let i = 1; i < line.length - 1; i++) {
      const d = distToSegmentM(line[i], line[0], line[line.length - 1]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD <= tolM) return [line[0], line[line.length - 1]];
    const a = simplify(line.slice(0, idx + 1), tolM);
    const b = simplify(line.slice(idx), tolM);
    return a.slice(0, -1).concat(b);
  }
  const round5 = (line) => line.map((p) => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5]);

  // ---------------------------------------------------------------------------
  // Classification
  // ---------------------------------------------------------------------------
  const MAJOR_ROADS = /^(motorway|trunk|primary|secondary)$/;
  const MINOR_ROADS = /^(tertiary|unclassified|residential)$/;

  function protectedKind(tags) {
    const name = tags.name || '';
    const op = tags.operator || '';
    if (/state forest/i.test(name) || /forestry corporation/i.test(op)) return 'state_forest';
    if (/state conservation area/i.test(name)) return 'conservation_area';
    if (/national park/i.test(name) || tags.boundary === 'national_park' || tags.protect_class === '2') return 'national_park';
    if (/nature reserve/i.test(name) || tags.leisure === 'nature_reserve') return 'nature_reserve';
    if (tags.boundary === 'protected_area') return 'protected';
    return null;
  }

  const KIND_LABEL = {
    parking: 'Car park',
    rest_area: 'Rest area',
    camp_site: 'Campground',
    caravan_site: 'Caravan park',
    picnic_site: 'Picnic area',
    viewpoint: 'Lookout',
    forest_track: 'Forest track pull-in',
  };

  function candidateKind(tags) {
    if (tags.tourism === 'camp_site') return 'camp_site';
    if (tags.tourism === 'caravan_site') return 'caravan_site';
    if (tags.highway === 'rest_area') return 'rest_area';
    if (tags.amenity === 'parking') return 'parking';
    if (tags.tourism === 'picnic_site') return 'picnic_site';
    if (tags.tourism === 'viewpoint') return 'viewpoint';
    return null;
  }

  function exclusionReason(tags) {
    if (/^(private|no|customers|delivery|employees|residents)$/.test(tags.access || '')) return `Access: ${tags.access}`;
    if (/^(underground|multi-storey|rooftop)$/.test(tags.parking || '')) return `${tags.parking} car park (height limit, no sun)`;
    if (tags.motor_vehicle === 'no' || tags.motorcar === 'no') return 'No motor vehicles';
    if (tags.caravans === 'no' && tags.motorhome === 'no') return 'No caravans or motorhomes';
    const mh = parseFloat(tags.maxheight);
    if (!isNaN(mh) && mh < 2.6) return `Height limit ${mh} m`;
    return null;
  }

  // ---------------------------------------------------------------------------
  // Main analysis
  // ---------------------------------------------------------------------------
  // Sample ring around each spot: 8 compass sectors x 4 distances.
  const BEARINGS = [0, 45, 90, 135, 180, 225, 270, 315]; // N, NE, E, SE, S, SW, W, NW
  const RADII = [6, 14, 24, 36];
  const RADIUS_WEIGHT = [1, 0.8, 0.55, 0.35];

  function analyze(osm, area, opts = {}) {
    const bbox = area.bbox;
    const els = osm.elements || [];

    const woods = [], protectedAreas = [], residential = [], water = [];
    const treeRows = [], majorRoads = [], minorRoads = [], tracks = [], coast = [], rivers = [];
    const trees = [], buildings = [], places = [], facilities = [], candidates = [];

    for (const el of els) {
      const t = el.tags;
      if (!t) {
        // untagged = single trees (nodes) or building centres (ways)
        if (el.type === 'node') trees.push([el.lat, el.lon]);
        else if (el.center) buildings.push([el.center.lat, el.center.lon]);
        continue;
      }
      const pt = el.type === 'node' ? [el.lat, el.lon] : el.center ? [el.center.lat, el.center.lon] : null;

      if (t.place && el.type === 'node') { places.push({ name: t.name, type: t.place, p: pt }); continue; }
      if (/^(toilets|drinking_water|shower)$/.test(t.amenity || '') && pt) { facilities.push({ type: t.amenity, p: pt, tags: t }); continue; }

      const kind = candidateKind(t);
      if (kind && pt) { candidates.push({ el, kind, p: pt }); continue; }

      const line = el.geometry ? el.geometry.filter(Boolean).map((n) => [n.lat, n.lon]) : null;
      if (t.highway && line) {
        if (MAJOR_ROADS.test(t.highway)) majorRoads.push({ line, tags: t });
        else if (MINOR_ROADS.test(t.highway)) minorRoads.push({ line, tags: t });
        else if (t.highway === 'track') tracks.push({ line, tags: t, id: el.id });
        continue;
      }
      if (t.natural === 'tree_row' && line) { treeRows.push(line); continue; }
      if (t.natural === 'coastline' && line) { coast.push(line); continue; }
      if (t.waterway === 'river' && line) { rivers.push(line); continue; }

      const isWood = t.natural === 'wood' || t.landuse === 'forest';
      const pk = protectedKind(t);
      if (isWood || pk || t.landuse === 'residential' || t.natural === 'water') {
        const poly = toPolygon(el);
        if (!poly) continue;
        if (isWood) woods.push(poly);
        if (pk) protectedAreas.push(Object.assign(poly, { kind: pk, name: t.name || '' }));
        if (t.landuse === 'residential') residential.push(poly);
        if (t.natural === 'water') water.push(poly);
      }
    }

    // ---- spatial indexes
    const woodGrid = new Grid(bbox); woods.forEach((w) => woodGrid.insert(w, w.bb));
    const protGrid = new Grid(bbox, 0.02); protectedAreas.forEach((w) => protGrid.insert(w, w.bb));
    const resGrid = new Grid(bbox, 0.01); residential.forEach((r) => resGrid.insert(r, r.bb));
    const treeGrid = new Grid(bbox, 0.002); trees.forEach((p) => treeGrid.insert(p, [p[0], p[1], p[0], p[1]]));
    const rowGrid = new Grid(bbox, 0.002); treeRows.forEach((l) => rowGrid.insert(l, lineBB(l)));
    const bldGrid = new Grid(bbox, 0.005); buildings.forEach((p) => bldGrid.insert(p, [p[0], p[1], p[0], p[1]]));
    const roadGrid = new Grid(bbox, 0.01); majorRoads.forEach((r) => roadGrid.insert(r, lineBB(r.line)));
    const facGrid = new Grid(bbox, 0.01); facilities.forEach((f) => facGrid.insert(f, [f.p[0], f.p[1], f.p[0], f.p[1]]));

    // Satellite tree-cover raster (ESA WorldCover) when available, plus OSM woods / trees.
    const raster = opts.canopy || null;
    function isCanopy(p) {
      if (raster && raster(p[0], p[1])) return true;
      for (const w of woodGrid.query(p, 5)) if (inPolygon(p, w)) return true;
      for (const t of treeGrid.query(p, 8)) if (distM(p, t) <= 7) return true;
      for (const l of rowGrid.query(p, 10)) if (distToLineM(p, l) <= 6) return true;
      return false;
    }

    function protectedAt(p) {
      const hits = [];
      for (const a of protGrid.query(p, 10)) if (inPolygon(p, a)) hits.push(a);
      // a state forest wins over a generic "protected" polygon
      const order = ['national_park', 'nature_reserve', 'conservation_area', 'state_forest', 'protected'];
      hits.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
      return hits[0] || null;
    }

    function countWithin(grid, p, r) {
      let n = 0;
      for (const q of grid.query(p, r)) if (distM(p, q) <= r) n++;
      return n;
    }

    function nearestRoadM(p) {
      let best = Infinity;
      for (const r of roadGrid.query(p, 1500)) best = Math.min(best, distToLineM(p, r.line));
      if (best === Infinity) for (const r of majorRoads) best = Math.min(best, distToLineM(p, r.line));
      return best;
    }

    function nearestResidentialM(p) {
      let best = Infinity;
      for (const r of resGrid.query(p, 1500)) {
        if (inPolygon(p, r)) return 0;
        for (const ring of r.outer) best = Math.min(best, distToLineM(p, ring.concat([ring[0]])));
      }
      return best;
    }

    const PLACE_SCALE = { city: 6000, town: 3500, suburb: 1800, village: 1500, hamlet: 600, locality: 300 };
    function nearestPlace(p) {
      let best = null, factor = 1;
      for (const pl of places) {
        const d = distM(p, pl.p);
        const f = clamp01(d / (PLACE_SCALE[pl.type] || 1000));
        if (f < factor) factor = f;
        if (!best || d < best.d) best = { name: pl.name, type: pl.type, d };
      }
      return { nearest: best, factor };
    }

    function nearestFacility(p, type) {
      let best = Infinity;
      for (const f of facGrid.query(p, 2500)) if (f.type === type) best = Math.min(best, distM(p, f.p));
      return best === Infinity ? null : Math.round(best);
    }

    // ---- forest track pull-ins: tracks that run into state forests
    for (const tr of tracks) {
      if (/^(private|no)$/.test(tr.tags.access || '') || /^(private|no)$/.test(tr.tags.motor_vehicle || '')) continue;
      let along = 0;
      for (let i = 0; i < tr.line.length; i++) {
        if (i) along += distM(tr.line[i - 1], tr.line[i]);
        if (along < 80) continue;
        const pa = protectedAt(tr.line[i]);
        if (pa && pa.kind === 'state_forest') {
          candidates.push({
            el: { type: 'way', id: tr.id, tags: Object.assign({ name: pa.name ? `Track in ${pa.name}` : '' }, tr.tags) },
            kind: 'forest_track',
            p: tr.line[i],
          });
          break;
        }
      }
    }

    // ---- score every candidate
    const spots = [];
    const seen = [];
    for (const c of candidates) {
      const p = c.p;
      // inside the area box only (Overpass may return centres slightly outside)
      if (p[0] < bbox[0] || p[0] > bbox[2] || p[1] < bbox[1] || p[1] > bbox[3]) continue;
      // de-duplicate the same place mapped twice (e.g. node + area)
      if (seen.some((s) => s.kind === c.kind && distM(s.p, p) < 30)) continue;
      seen.push(c);

      const t = c.el.tags || {};

      // --- canopy sampling
      const centre = isCanopy(p);
      const sector = {};
      let wSum = 0, wHit = 0;
      for (const b of BEARINGS) {
        sector[b] = [];
        RADII.forEach((r, i) => {
          const hit = isCanopy(offset(p, b, r));
          sector[b].push(hit);
          wSum += RADIUS_WEIGHT[i];
          if (hit) wHit += RADIUS_WEIGHT[i];
        });
      }
      const frac = (bs, idx = [0, 1, 2, 3]) => {
        let s = 0, h = 0;
        for (const b of bs) for (const i of idx) { s += RADIUS_WEIGHT[i]; if (sector[b][i]) h += RADIUS_WEIGHT[i]; }
        return s ? h / s : 0;
      };
      const canopyAround = wHit / wSum;
      const shade = Math.round(100 * clamp01(canopyAround * 1.5 + (centre ? 0.25 : 0)));
      // Afternoon sun comes from the west/north-west — trees there give the shade that matters most.
      const afternoonShade = Math.round(100 * clamp01(frac([270, 315, 225], [0, 1, 2]) * 1.3));
      // Panels want the northern sky open (sun is in the north at 28°S), plus some east/west for morning/evening.
      const northBlock = frac([315, 0, 45]);
      const ewBlock = frac([90, 270], [0, 1]);
      const solar = Math.round(100 * clamp01(1 - (0.75 * northBlock + 0.25 * ewBlock) * 1.2) * (centre ? 0.45 : 1));

      // --- isolation
      const b150 = countWithin(bldGrid, p, 150);
      const b500 = countWithin(bldGrid, p, 500);
      const dRoad = nearestRoadM(p);
      const dRes = nearestResidentialM(p);
      const place = nearestPlace(p);
      const cap = parseInt(t.capacity, 10);
      const bF = 1 / (1 + b150 / 2 + b500 / 12);
      const roadF = clamp01(dRoad / 700);
      const resF = clamp01(dRes / 700);
      const capF = isNaN(cap) ? 0.6 : clamp01(1 - cap / 80);
      const typeMult = { caravan_site: 0.35, camp_site: 0.75, picnic_site: 0.9, viewpoint: 0.9 }[c.kind] || 1;
      const isolation = Math.round(100 * typeMult * (0.3 * bF + 0.2 * roadF + 0.2 * resF + 0.2 * place.factor + 0.1 * capF));

      // --- legality / context
      const prot = protectedAt(p);
      let overnight = 'check';
      const notes = [];
      const excluded = exclusionReason(t);
      if (c.kind === 'camp_site' || c.kind === 'caravan_site') {
        overnight = 'yes';
        notes.push(t.fee === 'no' ? 'Free campground.' : t.fee === 'yes' ? 'Paid campground. Book or pay on site.' : 'Campground. Check whether fees apply.');
      } else if (prot && prot.kind === 'state_forest') {
        overnight = 'likely';
        notes.push(`Inside ${prot.name || 'a State Forest'}. Free camping is generally allowed for up to 4 weeks unless signs say otherwise. Logging trucks may use forest roads.`);
      } else if (prot && /national_park|nature_reserve|conservation_area/.test(prot.kind)) {
        overnight = 'no';
        notes.push(`Inside ${prot.name || 'an NPWS reserve'}. Camping is only allowed at signed NPWS campgrounds.`);
      } else if (area.council === 'Byron Shire') {
        overnight = 'risky';
        notes.push('Byron Shire fines people sleeping in vehicles on public land. Use this for daytime only unless signs say otherwise.');
      } else {
        notes.push('Public land in Tweed Shire. Look for "no camping" or 11pm–5am parking signs before you settle in.');
      }
      if (t.overnight === 'no' || t.camping === 'no') { overnight = 'no'; notes.push('Mapped as "no overnight stays".'); }
      if (t.overnight === 'yes') { overnight = 'yes'; notes.push('Mapped as allowing overnight stays.'); }
      if (t.maxstay) notes.push(`Max stay: ${t.maxstay}.`);
      if (t.opening_hours) notes.push(`Opening hours: ${t.opening_hours}.`);
      if (t.fee === 'yes' && c.kind === 'parking') notes.push('Paid parking.');
      if (c.kind === 'forest_track') notes.push('Not a mapped car park. Check satellite imagery for a flat pull-in, and that the track suits your van.');
      if (t.surface) notes.push(`Surface: ${t.surface}.`);

      const nearName = place.nearest && place.nearest.name;
      const name = t.name || `${KIND_LABEL[c.kind]}${nearName ? ' near ' + nearName : ''}`;

      spots.push({
        id: `${c.el.type}/${c.el.id}`,
        area: area.id,
        kind: c.kind,
        kindLabel: KIND_LABEL[c.kind],
        name,
        lat: Math.round(p[0] * 1e6) / 1e6,
        lon: Math.round(p[1] * 1e6) / 1e6,
        scores: { shade, afternoonShade, solar, isolation },
        metrics: {
          underTrees: centre,
          canopyPct: Math.round(canopyAround * 100),
          northSkyBlockedPct: Math.round(northBlock * 100),
          buildings150m: b150,
          buildings500m: b500,
          majorRoadM: dRoad === Infinity ? null : Math.round(dRoad),
          homesM: dRes === Infinity ? null : Math.round(dRes),
          nearestPlace: place.nearest ? { name: place.nearest.name, type: place.nearest.type, m: Math.round(place.nearest.d) } : null,
          capacity: isNaN(cap) ? null : cap,
          sectors: Object.fromEntries(BEARINGS.map((b) => [b, sector[b].map((h) => (h ? 1 : 0))])),
        },
        facilities: {
          toiletsM: nearestFacility(p, 'toilets'),
          waterM: nearestFacility(p, 'drinking_water'),
          showerM: nearestFacility(p, 'shower'),
        },
        protectedArea: prot ? { kind: prot.kind, name: prot.name } : null,
        overnight,
        excluded,
        notes,
        tags: pick(t, ['name', 'fee', 'access', 'surface', 'capacity', 'maxheight', 'maxstay', 'opening_hours', 'toilets', 'drinking_water', 'operator', 'website', 'parking']),
      });
    }

    const result = { area: area.id, generatedAt: new Date().toISOString(), spots };
    if (opts.basemap) {
      const TOL = opts.tolerance || 8;
      const ring = (r) => round5(simplify(r, TOL));
      const clipBB = [bbox[0] - 0.01, bbox[1] - 0.01, bbox[2] + 0.01, bbox[3] + 0.01];
      const touches = (bb) => !(bb[2] < clipBB[0] || bb[0] > clipBB[2] || bb[3] < clipBB[1] || bb[1] > clipBB[3]);
      result.basemap = {
        woods: woods.filter((w) => touches(w.bb)).map((w) => w.outer.map(ring).filter((r) => r.length >= 3)),
        protected: protectedAreas.filter((w) => touches(w.bb)).map((a) => ({
          kind: a.kind, name: a.name, rings: a.outer.map((r) => round5(simplify(r, TOL * 2))),
        })),
        residential: residential.map((r) => r.outer.map(ring)),
        water: water.map((r) => r.outer.map(ring)),
        coast: coast.map(ring),
        rivers: rivers.map(ring),
        major: majorRoads.map((r) => ring(r.line)),
        minor: minorRoads.map((r) => ring(r.line)),
        tracks: tracks.map((r) => ring(r.line)),
        places: places.filter((pl) => pl.name && /^(town|village|suburb|hamlet)$/.test(pl.type))
          .map((pl) => ({ name: pl.name, type: pl.type, lat: pl.p[0], lon: pl.p[1] })),
      };
    }
    return result;
  }

  // Lookup over a tree-cover grid: { bbox:[s,w,n,e], w, h, data } where data[row*w+col] is 1 for tree cover.
  // Row 0 is the northern edge. Returns false outside the grid.
  function makeCanopyLookup(grid) {
    const [s, w, n, e] = grid.bbox;
    return (lat, lon) => {
      if (lat < s || lat > n || lon < w || lon > e) return false;
      const col = Math.min(grid.w - 1, Math.floor(((lon - w) / (e - w)) * grid.w));
      const row = Math.min(grid.h - 1, Math.floor(((n - lat) / (n - s)) * grid.h));
      return grid.data[row * grid.w + col] === 1;
    };
  }

  // Compact transport for a 0/1 grid: alternating run lengths (starting with 0s) as LEB128 varints, base64.
  function encodeRuns(data) {
    const bytes = [];
    let val = 0, run = 0;
    const push = (n) => { do { let b = n & 127; n >>>= 7; if (n) b |= 128; bytes.push(b); } while (n); };
    for (let i = 0; i < data.length; i++) {
      if (data[i] === val) run++;
      else { push(run); val ^= 1; run = 1; }
    }
    push(run);
    let str = '';
    for (let i = 0; i < bytes.length; i += 8192) str += String.fromCharCode.apply(null, bytes.slice(i, i + 8192));
    return typeof btoa === 'function' ? btoa(str) : Buffer.from(str, 'binary').toString('base64');
  }

  function decodeRuns(b64, length) {
    const str = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
    const data = new Uint8Array(length);
    let pos = 0, val = 0, i = 0;
    while (i < str.length && pos < length) {
      let n = 0, shift = 0, b;
      do { b = str.charCodeAt(i++); n |= (b & 127) << shift; shift += 7; } while (b & 128);
      if (val) data.fill(1, pos, Math.min(length, pos + n));
      pos += n; val ^= 1;
    }
    return data;
  }

  function pick(obj, keys) {
    const o = {};
    for (const k of keys) if (obj[k] != null) o[k] = obj[k];
    return o;
  }

  // Weighted overall score — weights come from the UI sliders (0..1 each).
  function overall(spot, w) {
    const total = w.shade + w.solar + w.isolation || 1;
    return Math.round((spot.scores.shade * w.shade + spot.scores.solar * w.solar + spot.scores.isolation * w.isolation) / total);
  }

  // Shade and solar fight each other. This picks out spots with afternoon shade AND an open northern sky.
  function bestOfBoth(spot) {
    return spot.scores.afternoonShade >= 40 && spot.scores.solar >= 55;
  }

  // Overpass with mirror fallback (browser or Node 18+ fetch).
  async function fetchOverpass(query, { fetchImpl, onAttempt } = {}) {
    const f = fetchImpl || root.fetch;
    let lastErr;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let round = 0; round < 3; round++) for (const url of OVERPASS_ENDPOINTS) {
      if (round) await wait(5000 * round);
      try {
        if (onAttempt) onAttempt(url);
        const res = await f(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(query),
        });
        if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
        const json = await res.json();
        if (json.remark && /error|timed out/i.test(json.remark)) throw new Error(`${url} → ${json.remark}`);
        return json;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('All Overpass servers failed');
  }

  root.VanEngine = { AREAS, OVERPASS_ENDPOINTS, KIND_LABEL, buildQuery, analyze, makeCanopyLookup, encodeRuns, decodeRuns, overall, bestOfBoth, fetchOverpass, distM };
})(typeof globalThis !== 'undefined' ? globalThis : this);
