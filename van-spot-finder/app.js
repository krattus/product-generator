/* Van Spot Finder — UI. Needs Leaflet (L), VanEngine and window.VAN_DATA. */
(function () {
  'use strict';
  const E = window.VanEngine;
  const DATA = window.VAN_DATA || { areas: [] };
  const STANDALONE = !!window.VAN_STANDALONE; // single-file build: no tiles, no live network calls
  const $ = (id) => document.getElementById(id);

  const OVERNIGHT = {
    yes: 'Campground',
    likely: 'Free camping likely OK',
    check: 'Check signs',
    risky: 'Fines likely',
    no: 'No camping',
  };
  const PRESETS = [
    { label: 'Balanced', w: [5, 5, 5] },
    { label: 'Hot day: shade', w: [10, 2, 4] },
    { label: 'Charging day: sun', w: [1, 10, 4] },
    { label: 'Stealth: quiet', w: [3, 3, 10] },
  ];

  // ---------- state
  const store = {
    get(k, d) { try { const v = localStorage.getItem('vsf.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('vsf.' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };
  const areas = DATA.areas.slice();
  const hashArea = (location.hash || '').slice(1);
  const state = {
    area: areas.some((a) => a.id === hashArea) || hashArea === 'all' ? hashArea : store.get('area', 'all'),
    w: store.get('weights', [5, 5, 5]),
    panelW: store.get('panelW', 200),
    sleep: 'nofines',
    kind: 'all',
    both: false,
    excl: false,
    selected: null,
  };
  if (!areas.some((a) => a.id === state.area) && state.area !== 'all') state.area = 'all';

  const tok = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';

  // ---------- map
  const map = L.map('map', { preferCanvas: true, zoomSnap: 0.5, attributionControl: true });
  map.attributionControl.setPrefix(false);
  const canopyPane = map.createPane('canopy');
  canopyPane.style.zIndex = 350; // under roads and spot markers
  // opacity on the pane (not the pixels) so overlapping area grids don't double up
  canopyPane.style.opacity = STANDALONE ? 0.6 : 0.35;
  const baseGroup = L.layerGroup().addTo(map);
  const canopyGroup = L.layerGroup().addTo(map);
  const parksGroup = L.layerGroup().addTo(map);
  const spotGroup = L.layerGroup().addTo(map);
  let tiles = null;

  if (!STANDALONE) {
    const street = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© OpenStreetMap contributors',
    });
    const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
    });
    tiles = { Street: street, Satellite: sat };
    street.addTo(map);
    L.control.layers(tiles, null, { position: 'topright' }).addTo(map);
  } else {
    map.attributionControl.addAttribution('© OpenStreetMap contributors · ESA WorldCover');
  }

  // decode tree-cover grids once
  const canopyGrids = {};
  for (const a of areas) {
    const c = a.basemap && a.basemap.canopy;
    if (c) canopyGrids[a.id] = { bbox: c.bbox, w: c.w, h: c.h, data: E.decodeRuns(c.runs, c.w * c.h) };
  }

  function canopyImage(grid) {
    const cv = document.createElement('canvas');
    cv.width = grid.w; cv.height = grid.h;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(grid.w, grid.h);
    const hex = tok('--canopy').replace('#', '');
    const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
    for (let i = 0; i < grid.data.length; i++) {
      if (!grid.data[i]) continue;
      img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return cv.toDataURL();
  }

  function drawBasemap() {
    baseGroup.clearLayers(); canopyGroup.clearLayers(); parksGroup.clearLayers();
    for (const a of areas) {
      const bm = a.basemap;
      if (!bm) continue;
      const grid = canopyGrids[a.id];
      if (grid) {
        const [s, w, n, e] = grid.bbox;
        L.imageOverlay(canopyImage(grid), [[s, w], [n, e]], { interactive: false, pane: 'canopy' }).addTo(canopyGroup);
      }
      for (const p of bm.protected || []) {
        const color = p.kind === 'state_forest' ? tok('--ok') : tok('--accent');
        L.polygon(p.rings, { color, weight: 1.2, dashArray: '4 4', fill: false, interactive: true })
          .bindTooltip(`${p.name || 'Protected area'}`, { sticky: true }).addTo(parksGroup);
      }
      if (!STANDALONE) continue;
      const water = tok('--water');
      for (const poly of bm.water || []) L.polygon(poly, { stroke: false, fillColor: water, fillOpacity: 1, interactive: false }).addTo(baseGroup);
      for (const poly of bm.residential || []) L.polygon(poly, { stroke: false, fillColor: tok('--line'), fillOpacity: 0.7, interactive: false }).addTo(baseGroup);
      for (const l of bm.rivers || []) L.polyline(l, { color: water, weight: 3, interactive: false }).addTo(baseGroup);
      for (const l of bm.coast || []) L.polyline(l, { color: water, weight: 5, interactive: false }).addTo(baseGroup);
      for (const l of bm.tracks || []) L.polyline(l, { color: tok('--track'), weight: 1, dashArray: '3 3', interactive: false }).addTo(baseGroup);
      for (const l of bm.minor || []) L.polyline(l, { color: tok('--road'), weight: 2, interactive: false }).addTo(baseGroup);
      for (const l of bm.major || []) L.polyline(l, { color: tok('--road-major'), weight: 3.5, interactive: false }).addTo(baseGroup);
      for (const p of bm.places || []) {
        if (p.type === 'hamlet') continue;
        L.marker([p.lat, p.lon], { interactive: false, icon: L.divIcon({ className: 'place-label', html: p.name, iconSize: null }) }).addTo(baseGroup);
      }
    }
  }

  // layer toggles
  const toggles = [
    { id: 'lt-canopy', label: 'Tree cover', group: canopyGroup, on: true },
    { id: 'lt-parks', label: 'Parks & forests', group: parksGroup, on: true },
  ];
  $('layer-toggles').innerHTML = toggles.map((t) => `<label for="${t.id}"><input id="${t.id}" type="checkbox" ${t.on ? 'checked' : ''}> ${t.label}</label>`).join('');
  toggles.forEach((t) => $(t.id).addEventListener('change', (e) => (e.target.checked ? map.addLayer(t.group) : map.removeLayer(t.group))));

  // ---------- scoring helpers
  const weights = () => ({ shade: state.w[0] / 10, solar: state.w[1] / 10, isolation: state.w[2] / 10 });
  function scoreColor(v) {
    // red → amber → green
    const stops = [[0, [194, 69, 58]], [50, [224, 166, 58]], [100, [90, 158, 75]]];
    let i = v <= 50 ? 0 : 1;
    const [a, ca] = stops[i], [b, cb] = stops[i + 1];
    const t = (v - a) / (b - a);
    const c = ca.map((x, k) => Math.round(x + (cb[k] - x) * t));
    return `rgb(${c.join(',')})`;
  }
  function areaOf(id) { return areas.find((a) => a.id === id); }
  function spotsInView() {
    const list = state.area === 'all' ? areas.flatMap((a) => a.spots) : (areaOf(state.area) || { spots: [] }).spots;
    const w = weights();
    return list
      .filter((s) => state.excl || !s.excluded)
      .filter((s) => state.kind === 'all' || s.kind === state.kind || (state.kind === 'camp_site' && s.kind === 'caravan_site'))
      .filter((s) => state.sleep === 'all' || (state.sleep === 'nofines' ? s.overnight !== 'no' : /^(yes|likely|check)$/.test(s.overnight)))
      .filter((s) => !state.both || E.bestOfBoth(s))
      .map((s) => ({ s, total: E.overall(s, w) }))
      .sort((a, b) => b.total - a.total);
  }

  function weatherFor(areaId) {
    const a = areaOf(areaId === 'all' ? 'mullumbimby' : areaId) || areas[0];
    return a && a.weather ? a.weather : null;
  }
  function kwh(radMJ, solarScore) {
    return (radMJ / 3.6) * (state.panelW / 1000) * 0.75 * Math.max(0.15, solarScore / 100);
  }

  // ---------- rendering
  function renderTabs() {
    const items = [{ id: 'all', name: 'All areas', aka: '' }].concat(areas);
    $('tabs').innerHTML = items.map((a) =>
      `<button class="tab" type="button" data-area="${a.id}" aria-pressed="${state.area === a.id}">${a.name}${a.aka && a.aka !== a.name ? `<small>${a.aka}</small>` : ''}</button>`).join('');
  }
  $('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('.tab');
    if (!b) return;
    state.area = b.dataset.area;
    store.set('area', state.area);
    try { history.replaceState(null, '', '#' + state.area); } catch { /* sandboxed */ }
    state.selected = null;
    render(true);
  });

  $('presets').innerHTML = PRESETS.map((p, i) => `<button class="preset" type="button" data-i="${i}">${p.label}</button>`).join('');
  $('presets').addEventListener('click', (e) => {
    const b = e.target.closest('.preset');
    if (!b) return;
    state.w = PRESETS[+b.dataset.i].w.slice();
    syncSliders();
    store.set('weights', state.w);
    render(false);
  });
  const sliders = ['w-shade', 'w-solar', 'w-quiet'];
  const outs = ['o-shade', 'o-solar', 'o-quiet'];
  function syncSliders() { sliders.forEach((id, i) => { $(id).value = state.w[i]; $(outs[i]).textContent = state.w[i]; }); }
  sliders.forEach((id, i) => $(id).addEventListener('input', (e) => {
    state.w[i] = +e.target.value; $(outs[i]).textContent = state.w[i]; store.set('weights', state.w); render(false);
  }));
  $('f-sleep').addEventListener('change', (e) => { state.sleep = e.target.value; render(false); });
  $('f-kind').addEventListener('change', (e) => { state.kind = e.target.value; render(false); });
  $('f-both').addEventListener('change', (e) => { state.both = e.target.checked; render(false); });
  $('f-excl').addEventListener('change', (e) => { state.excl = e.target.checked; render(false); });
  $('panel-w').value = state.panelW;
  $('panel-w').addEventListener('input', (e) => {
    const v = +e.target.value;
    if (v > 0) { state.panelW = v; store.set('panelW', v); renderForecast(); if (state.selected) renderDetail(); }
  });

  function renderForecast() {
    const wx = weatherFor(state.area);
    const area = areaOf(state.area === 'all' ? 'mullumbimby' : state.area);
    $('fc-title').textContent = `Solar forecast · ${area ? area.name : ''}`;
    if (!wx || !wx.daily) { $('forecast').innerHTML = '<p class="empty">No forecast saved for this area.</p>'; $('fc-note').textContent = ''; return; }
    const d = wx.daily;
    $('forecast').innerHTML = d.time.map((t, i) => {
      const rad = d.shortwave_radiation_sum[i] || 0;
      const day = new Date(t + 'T12:00:00').toLocaleDateString('en-AU', { weekday: 'short' });
      const pct = Math.min(100, (rad / 32) * 100);
      return `<div class="day" title="${rad.toFixed(1)} MJ/m² · ${Math.round(d.temperature_2m_max[i])}°C max · ${d.precipitation_probability_max[i] ?? '–'}% rain">
        <div class="bar"><i style="height:${pct}%"></i></div><b>${kwh(rad, 100).toFixed(1)}</b><span>${day}</span><span>${Math.round(d.temperature_2m_max[i])}°</span></div>`;
    }).join('');
    const from = new Date(wx.fetchedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
    $('fc-note').textContent = `kWh/day in full sun · forecast from ${from}`;
  }

  function miniBars(s) {
    return `<div class="minibars" aria-hidden="true">
      <span><i style="width:${s.scores.shade}%;background:var(--shade)"></i></span>
      <span><i style="width:${s.scores.solar}%;background:var(--solar)"></i></span>
      <span><i style="width:${s.scores.isolation}%;background:var(--quiet)"></i></span></div>`;
  }

  let markers = new Map();
  function renderList(rows) {
    $('list-title').textContent = `Best spots · ${rows.length} found`;
    if (!rows.length) {
      $('list').innerHTML = '<li class="empty">No spots match these filters. Try "Show every spot" or switch area.</li>';
      return;
    }
    $('list').innerHTML = rows.map(({ s, total }, i) => `
      <li class="spot${state.selected === s.id ? ' sel' : ''}" data-id="${s.id}" tabindex="0">
        <span class="rank">${i + 1}</span>
        <div class="spot-main">
          <span class="spot-name">${esc(s.name)}</span>
          <div class="meta"><span>${s.kindLabel}</span>${state.area === 'all' ? `<span>· ${areaOf(s.area).name}</span>` : ''}
            <span class="pill ${s.overnight}">${OVERNIGHT[s.overnight]}</span>
            ${E.bestOfBoth(s) ? '<span class="pill both">Shade + sun</span>' : ''}</div>
          ${miniBars(s)}
        </div>
        <span class="score" style="color:${scoreColor(total)}">${total}<small>/100</small></span>
      </li>`).join('');
  }
  $('list').addEventListener('click', (e) => { const li = e.target.closest('.spot'); if (li) select(li.dataset.id, true); });
  $('list').addEventListener('keydown', (e) => { if (e.key === 'Enter') { const li = e.target.closest('.spot'); if (li) select(li.dataset.id, true); } });

  function renderMarkers(rows) {
    spotGroup.clearLayers();
    markers = new Map();
    // draw lowest first so the best end up on top
    rows.slice().reverse().forEach(({ s, total }) => {
      const sel = state.selected === s.id;
      const m = L.circleMarker([s.lat, s.lon], {
        radius: sel ? 11 : 7,
        color: sel ? tok('--ink') : tok('--panel'),
        weight: sel ? 3 : 1.5,
        fillColor: scoreColor(total),
        fillOpacity: 0.95,
      }).bindTooltip(`${esc(s.name)} · ${total}`, { direction: 'top', offset: [0, -6] });
      m.on('click', () => select(s.id, false));
      m.addTo(spotGroup);
      markers.set(s.id, m);
    });
  }

  function renderNotes() {
    const list = state.area === 'all' ? areas : [areaOf(state.area)].filter(Boolean);
    $('area-notes').innerHTML = list.flatMap((a) => a.notes.map((n) => `<li><b>${a.name}:</b> ${esc(n)}</li>`)).join('') ||
      '<li>No saved rules for this area.</li>';
  }

  function fit() {
    const a = areaOf(state.area);
    if (a) map.fitBounds([[a.bbox[0], a.bbox[1]], [a.bbox[2], a.bbox[3]]], { padding: [10, 10] });
    else if (areas.length) {
      const s = Math.min(...areas.map((x) => x.bbox[0])), w = Math.min(...areas.map((x) => x.bbox[1]));
      const n = Math.max(...areas.map((x) => x.bbox[2])), e = Math.max(...areas.map((x) => x.bbox[3]));
      map.fitBounds([[s, w], [n, e]], { padding: [10, 10] });
    }
  }

  let rowsCache = [];
  function render(refit) {
    renderTabs();
    rowsCache = spotsInView();
    renderList(rowsCache);
    renderMarkers(rowsCache);
    renderForecast();
    renderNotes();
    if (state.selected) renderDetail(); else $('detail').hidden = true;
    if (refit) fit();
  }

  // ---------- detail
  function findSpot(id) { for (const a of areas) { const s = a.spots.find((x) => x.id === id); if (s) return s; } return null; }

  function select(id, pan) {
    state.selected = id;
    const s = findSpot(id);
    renderList(rowsCache);
    renderMarkers(rowsCache);
    renderDetail();
    if (s && pan) map.setView([s.lat, s.lon], Math.max(map.getZoom(), 15));
    const li = document.querySelector(`.spot[data-id="${CSS.escape(id)}"]`);
    if (li && !pan) li.scrollIntoView({ block: 'nearest' });
  }

  function why(s) {
    const m = s.metrics, out = [];
    out.push(m.underTrees ? 'Parked under tree canopy.' : `${m.canopyPct}% of the ground within 36 m is tree-covered.`);
    if (s.scores.afternoonShade >= 50) out.push('Trees on the west side give afternoon shade.');
    out.push(m.northSkyBlockedPct > 40 ? `Trees block ${m.northSkyBlockedPct}% of the northern sky, so panels will struggle.` : 'Northern sky is mostly open for the panels.');
    out.push(`${m.buildings150m} buildings within 150 m, ${m.buildings500m} within 500 m.`);
    if (m.majorRoadM != null) out.push(`Main road ${fmtM(m.majorRoadM)} away.`);
    return out.join(' ');
  }

  function renderDetail() {
    const s = findSpot(state.selected);
    const box = $('detail');
    if (!s) { box.hidden = true; return; }
    const total = E.overall(s, weights());
    const wx = weatherFor(s.area);
    let kwhHtml = '';
    if (wx && wx.daily) {
      const r = wx.daily.shortwave_radiation_sum;
      const today = kwh(r[0] || 0, s.scores.solar);
      const avg = r.reduce((a, b) => a + (b || 0), 0) / r.length;
      kwhHtml = `<section><h2>Charging estimate</h2>
        <div class="kwh">${today.toFixed(1)} <small>kWh today on ${state.panelW} W</small></div>
        <p class="why">About ${kwh(avg, s.scores.solar).toFixed(1)} kWh/day on average over the next 7 days. Assumes flat panels, 75% system efficiency and the tree cover around this spot.</p></section>`;
    }
    const f = s.facilities;
    const m = s.metrics;
    const ll = `${s.lat.toFixed(5)}, ${s.lon.toFixed(5)}`;
    box.innerHTML = `
      <div class="detail-head">
        <div style="min-width:0">
          <h3>${esc(s.name)}</h3>
          <div class="meta"><span>${s.kindLabel}</span><span>· ${areaOf(s.area).name}</span>
            <span class="pill ${s.overnight}">${OVERNIGHT[s.overnight]}</span>
            ${s.excluded ? `<span class="pill no">${esc(s.excluded)}</span>` : ''}</div>
        </div>
        <button class="close" type="button" id="close-detail" aria-label="Close">×</button>
      </div>
      <div class="detail-body">
        <section class="scorebars">
          <div class="sb"><span>Overall</span><div class="track"><i style="width:${total}%;background:${scoreColor(total)}"></i></div><b>${total}</b></div>
          <div class="sb"><span>Shade</span><div class="track"><i style="width:${s.scores.shade}%;background:var(--shade)"></i></div><b>${s.scores.shade}</b></div>
          <div class="sb"><span>Afternoon shade</span><div class="track"><i style="width:${s.scores.afternoonShade}%;background:var(--shade);opacity:.7"></i></div><b>${s.scores.afternoonShade}</b></div>
          <div class="sb"><span>Solar</span><div class="track"><i style="width:${s.scores.solar}%;background:var(--solar)"></i></div><b>${s.scores.solar}</b></div>
          <div class="sb"><span>Quiet</span><div class="track"><i style="width:${s.scores.isolation}%;background:var(--quiet)"></i></div><b>${s.scores.isolation}</b></div>
          <p class="why">${why(s)}</p>
        </section>
        <section>
          <h2>Trees around the van</h2>
          <div class="rose-row">
            <canvas id="rose" width="300" height="300" aria-label="Tree cover by compass direction"></canvas>
            <div class="rose-legend">
              <span>Each cell is a 10 m ring in one compass direction. Green means trees.</span>
              <span>The sun arcs through the <b>north</b> at 28°S. Trees north block your panels. Trees west shade you in the afternoon.</span>
            </div>
          </div>
        </section>
        ${kwhHtml}
        <section>
          <h2>Why sleeping here is ${s.overnight === 'yes' || s.overnight === 'likely' ? 'probably fine' : 'uncertain'}</h2>
          <ul class="notes">${s.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
        </section>
        <section>
          <h2>Details</h2>
          <dl class="facts">
            <dt>Coordinates</dt><dd>${ll}</dd>
            ${m.nearestPlace ? `<dt>Nearest place</dt><dd>${esc(m.nearestPlace.name || '')} (${fmtM(m.nearestPlace.m)})</dd>` : ''}
            <dt>Homes</dt><dd>${m.homesM == null ? 'none mapped nearby' : m.homesM === 0 ? 'in a residential area' : fmtM(m.homesM)}</dd>
            <dt>Main road</dt><dd>${m.majorRoadM == null ? 'none nearby' : fmtM(m.majorRoadM)}</dd>
            ${m.capacity ? `<dt>Car spaces</dt><dd>${m.capacity}</dd>` : ''}
            <dt>Toilets</dt><dd>${f.toiletsM == null ? 'none within 2.5 km' : fmtM(f.toiletsM)}</dd>
            <dt>Drinking water</dt><dd>${f.waterM == null ? 'none within 2.5 km' : fmtM(f.waterM)}</dd>
            <dt>Showers</dt><dd>${f.showerM == null ? 'none within 2.5 km' : fmtM(f.showerM)}</dd>
            ${s.protectedArea ? `<dt>Inside</dt><dd>${esc(s.protectedArea.name || s.protectedArea.kind)}</dd>` : ''}
          </dl>
        </section>
        <section class="links">
          <a href="https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}" target="_blank" rel="noopener">Directions</a>
          <a href="https://www.google.com/maps/@${s.lat},${s.lon},150m/data=!3m1!1e3" target="_blank" rel="noopener">Satellite</a>
          <a href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${s.lat},${s.lon}" target="_blank" rel="noopener">Street View</a>
          <a href="https://www.openstreetmap.org/${s.id}" target="_blank" rel="noopener">OpenStreetMap</a>
          <button class="btn" type="button" id="copy-ll">Copy coordinates</button>
        </section>
      </div>`;
    box.hidden = false;
    $('close-detail').addEventListener('click', () => { state.selected = null; box.hidden = true; renderList(rowsCache); renderMarkers(rowsCache); });
    $('copy-ll').addEventListener('click', (e) => {
      const btn = e.currentTarget;
      const done = () => { btn.textContent = 'Copied'; setTimeout(() => (btn.textContent = 'Copy coordinates'), 1500); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ll).then(done, () => { btn.textContent = ll; });
      else btn.textContent = ll;
    });
    drawRose($('rose'), s);
  }

  function drawRose(cv, s) {
    const ctx = cv.getContext('2d');
    const W = cv.width, c = W / 2, ringW = (W / 2 - 26) / 4;
    ctx.clearRect(0, 0, W, W);
    // sun arc (north half)
    ctx.beginPath();
    ctx.arc(c, c, W / 2 - 8, Math.PI * 1.25, Math.PI * 1.75);
    ctx.strokeStyle = tok('--solar'); ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.stroke();
    const sectors = s.metrics.sectors;
    Object.keys(sectors).forEach((b) => {
      const mid = (+b - 90) * Math.PI / 180;
      sectors[b].forEach((hit, i) => {
        ctx.beginPath();
        ctx.arc(c, c, 14 + (i + 1) * ringW, mid - Math.PI / 8 + 0.03, mid + Math.PI / 8 - 0.03);
        ctx.arc(c, c, 14 + i * ringW + 1.5, mid + Math.PI / 8 - 0.03, mid - Math.PI / 8 + 0.03, true);
        ctx.closePath();
        ctx.fillStyle = hit ? tok('--shade') : tok('--chip');
        ctx.fill();
      });
    });
    // van
    ctx.beginPath(); ctx.arc(c, c, 9, 0, Math.PI * 2);
    ctx.fillStyle = s.metrics.underTrees ? tok('--shade') : tok('--ink'); ctx.fill();
    ctx.fillStyle = tok('--muted'); ctx.font = '700 20px ' + tok('--font-display'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = tok('--ink');
    ctx.fillText('N', c, 12); ctx.fillText('S', c, W - 10); ctx.fillText('E', W - 10, c); ctx.fillText('W', 10, c);
  }

  // ---------- live features (only when served, not in the single-file build)
  function toast(msg, ms = 4000) {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); if (ms) toast._t = setTimeout(() => (t.hidden = true), ms);
  }

  if (!STANDALONE) {
    $('map-actions').innerHTML = '<button class="btn primary" type="button" id="scan">Scan this map view</button>';
    $('scan').addEventListener('click', scanView);
  }

  function canopyAnywhere(lat, lon) {
    for (const id in canopyGrids) {
      const g = canopyGrids[id];
      if (!g._lookup) g._lookup = E.makeCanopyLookup(g);
      if (g._lookup(lat, lon)) return true;
    }
    return false;
  }

  async function scanView() {
    const b = map.getBounds();
    const bbox = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].map((x) => +x.toFixed(4));
    if ((bbox[2] - bbox[0]) * (bbox[3] - bbox[1]) > 0.05) { toast('Zoom in a bit more first (about 20 km across or less).'); return; }
    const center = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
    const nearest = areas.slice().sort((x, y) => E.distM(center, x.center) - E.distM(center, y.center))[0];
    const area = {
      id: 'scan', name: 'Map scan', aka: '', council: nearest ? nearest.council : '', center, bbox,
      notes: ['Live scan of OpenStreetMap. Satellite tree cover only covers the four saved areas. Elsewhere shade comes from mapped woods and trees.'],
    };
    $('scan').disabled = true;
    toast('Asking OpenStreetMap for spots in view…', 0);
    try {
      const osm = await E.fetchOverpass(E.buildQuery(bbox));
      const res = E.analyze(osm, area, { canopy: canopyAnywhere });
      area.spots = res.spots;
      area.weather = await fetchWeather(center).catch(() => null);
      const i = areas.findIndex((a) => a.id === 'scan');
      if (i >= 0) areas.splice(i, 1);
      areas.push(area);
      state.area = 'scan';
      state.selected = null;
      render(false);
      toast(`Found ${res.spots.length} spots in view.`);
    } catch (e) {
      toast(`Scan failed: ${e.message}. The free map servers are busy, so try again in a minute.`, 8000);
    } finally {
      $('scan').disabled = false;
    }
  }

  async function fetchWeather([lat, lon]) {
    const q = new URLSearchParams({
      latitude: lat, longitude: lon, timezone: 'Australia/Sydney', forecast_days: '7',
      daily: 'shortwave_radiation_sum,sunshine_duration,temperature_2m_max,temperature_2m_min,precipitation_probability_max,cloud_cover_mean,uv_index_max,sunrise,sunset',
    });
    const r = await fetch('https://api.open-meteo.com/v1/forecast?' + q);
    if (!r.ok) throw new Error('forecast HTTP ' + r.status);
    const j = await r.json();
    return { fetchedAt: new Date().toISOString(), daily: j.daily };
  }

  // refresh the saved forecasts in the background so kWh numbers are current
  if (!STANDALONE) {
    Promise.all(areas.map((a) => fetchWeather(a.center).then((w) => { a.weather = w; }).catch(() => {}))).then(() => {
      renderForecast(); if (state.selected) renderDetail();
    });
  }

  // ---------- utils
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function fmtM(m) { return m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m) + ' m'; }

  if (DATA.generatedAt) $('gen-date').textContent = `Spots scored ${new Date(DATA.generatedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}.`;

  // redraw colours when the theme flips
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const redraw = () => { drawBasemap(); renderMarkers(rowsCache); if (state.selected) renderDetail(); };
  if (mq.addEventListener) mq.addEventListener('change', redraw);
  new MutationObserver(redraw).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  syncSliders();
  drawBasemap();
  render(true);
})();
