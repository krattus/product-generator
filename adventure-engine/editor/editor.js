// Adventure Level Editor — authors the walk data the engine's walk layer
// consumes (schema: ../src/walk-data.js). All geometry is normalized 0..1 in
// background-image space, which is exactly what the engine expects.
//
// Segmentation: the magic wand (color flood fill) always works offline; the
// optional AI segmenter (SAM via transformers.js, loaded from a CDN) adds
// click-to-mask when the network is available. Both feed the same selection mask,
// which turns into occlusion overlays or obstacle footprints.

import {
  isRect, isPolygon, normRect, pointInRect, pointInShape, shapeBounds,
  walkableAt, nearestWalkable, validateWalk,
} from '../src/walk-data.js';

/* ================================================================== */
/* State                                                              */
/* ================================================================== */

const state = {
  world: { version: 1, assetBase: '../games/crystal-crown/', rooms: {} },
  roomId: null,
  tool: 'select',
  draft: null,             // in-progress polygon [[x,y],...]
  dragging: null,          // active drag descriptor
  selection: null,         // { kind, index|key }
  wand: { mask: null, w: 0, h: 0 },     // Uint8Array in image pixels
  sam: { status: 'off', model: null, processor: null, embeds: null, points: [], mask: null },
  test: null,              // { x, y } test-walk hero
  undo: [], redo: [],
  mouse: { x: 0, y: 0 },   // normalized, image space
  preview: false,
};

const bgCache = new Map(); // roomId -> HTMLImageElement (or 'error')

const $ = (id) => document.getElementById(id);
const canvas = $('canvas');
const ctx = canvas.getContext('2d');

const DIRS = ['', 'north', 'south', 'east', 'west', 'in', 'out', 'up', 'down'];
const ED_SPAWN_KEYS = ['default', 'north', 'south', 'east', 'west', 'in', 'out', 'up', 'down'];

function room() { return state.roomId ? state.world.rooms[state.roomId] : null; }
function walk() { const r = room(); if (r && !r.walk) r.walk = {}; return r?.walk; }

/* ================================================================== */
/* Undo                                                               */
/* ================================================================== */

function snapshot() {
  return JSON.stringify({ roomId: state.roomId, rooms: state.world.rooms });
}

function mutate(fn) {
  if (!room()) return;
  state.undo.push(snapshot());
  if (state.undo.length > 60) state.undo.shift();
  state.redo.length = 0;
  fn();
  refresh();
}

function undo() {
  if (!state.undo.length) return;
  state.redo.push(snapshot());
  restore(state.undo.pop());
}

function redo() {
  if (!state.redo.length) return;
  state.undo.push(snapshot());
  restore(state.redo.pop());
}

function restore(snap) {
  const s = JSON.parse(snap);
  state.world.rooms = s.rooms;
  if (!state.world.rooms[state.roomId]) state.roomId = s.roomId;
  state.selection = null;
  state.draft = null;
  refresh();
}

/* ================================================================== */
/* Canvas mapping (contain-fit; norm coords are image space)          */
/* ================================================================== */

function bgImage() {
  if (!state.roomId) return null;
  const img = bgCache.get(state.roomId);
  return img && img !== 'error' && img.complete && img.naturalWidth ? img : null;
}

function fitCanvas() {
  const wrap = canvas.parentElement;
  const img = bgImage();
  const ar = img ? img.naturalWidth / img.naturalHeight : 16 / 9;
  const maxW = wrap.clientWidth - 16;
  const maxH = wrap.clientHeight - 16;
  let w = maxW;
  let h = w / ar;
  if (h > maxH) { h = maxH; w = h * ar; }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
}

const X = (nx) => nx * canvas.width;
const Y = (ny) => ny * canvas.height;

function eventNorm(e) {
  const r = canvas.getBoundingClientRect();
  return [
    Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
    Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
  ];
}

/* ================================================================== */
/* Rendering                                                          */
/* ================================================================== */

function drawShape(shape, fill, stroke) {
  ctx.beginPath();
  if (isRect(shape)) {
    const [x1, y1, x2, y2] = normRect(shape);
    ctx.rect(X(x1), Y(y1), X(x2 - x1), Y(y2 - y1));
  } else if (isPolygon(shape)) {
    shape.forEach(([px, py], i) => (i ? ctx.lineTo(X(px), Y(py)) : ctx.moveTo(X(px), Y(py))));
    ctx.closePath();
  }
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawVertices(shape, color) {
  const pts = isRect(shape)
    ? [[shape[0], shape[1]], [shape[2], shape[1]], [shape[2], shape[3]], [shape[0], shape[3]]]
    : shape;
  ctx.fillStyle = color;
  for (const [px, py] of pts) {
    ctx.beginPath();
    ctx.arc(X(px), Y(py), 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawMarker(x, y, label, color) {
  ctx.fillStyle = color;
  ctx.strokeStyle = '#000';
  ctx.beginPath();
  ctx.arc(X(x), Y(y), 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.font = 'bold 11px monospace';
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.lineWidth = 3;
  ctx.strokeText(label, X(x) + 7, Y(y) - 6);
  ctx.fillText(label, X(x) + 7, Y(y) - 6);
}

let maskCanvas = null; // cached tinted wand mask

function rebuildMaskCanvas() {
  const { mask, w, h } = state.wand;
  maskCanvas = null;
  if (!mask) return;
  maskCanvas = document.createElement('canvas');
  maskCanvas.width = w;
  maskCanvas.height = h;
  const mg = maskCanvas.getContext('2d');
  const d = mg.createImageData(w, h);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    d.data[i * 4] = 95; d.data[i * 4 + 1] = 215; d.data[i * 4 + 2] = 255; d.data[i * 4 + 3] = 120;
  }
  mg.putImageData(d, 0, 0);
}

function render() {
  fitCanvas();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const img = bgImage();
  if (img) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  } else {
    ctx.fillStyle = '#181834';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#5a5e9a';
    ctx.font = '14px monospace';
    ctx.fillText(state.roomId ? 'no background image loaded' : 'create or select a room', 20, 30);
  }
  const w = walk();
  if (!w) return;

  // overlays (image pieces + baseline)
  for (const [i, o] of (w.overlays || []).entries()) {
    const oi = overlayImage(o);
    if (oi && o.rect) {
      ctx.drawImage(oi, X(o.rect[0]), Y(o.rect[1]), X(o.rect[2] - o.rect[0]), Y(o.rect[3] - o.rect[1]));
    }
    if (o.rect) {
      const sel = state.selection?.kind === 'overlay' && state.selection.index === i;
      ctx.strokeStyle = sel ? '#ffcf5f' : 'rgba(255,160,60,0.8)';
      ctx.lineWidth = sel ? 2.5 : 1.5;
      ctx.strokeRect(X(o.rect[0]), Y(o.rect[1]), X(o.rect[2] - o.rect[0]), Y(o.rect[3] - o.rect[1]));
      const by = o.baseline ?? o.rect[3];
      ctx.strokeStyle = '#ffa03c';
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(X(o.rect[0]) - 8, Y(by));
      ctx.lineTo(X(o.rect[2]) + 8, Y(by));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#ffa03c';
      ctx.font = '10px monospace';
      ctx.fillText(`baseline ${i}`, X(o.rect[0]), Y(by) + 11);
    }
  }

  // walk areas
  for (const [i, s] of (w.areas || []).entries()) {
    const sel = state.selection?.kind === 'area' && state.selection.index === i;
    drawShape(s, 'rgba(95,255,135,0.18)', sel ? '#5fff87' : 'rgba(95,255,135,0.7)');
    if (sel || state.tool === 'select') drawVertices(s, '#5fff87');
  }
  // obstacles
  for (const [i, s] of (w.obstacles || []).entries()) {
    const sel = state.selection?.kind === 'obstacle' && state.selection.index === i;
    drawShape(s, 'rgba(255,95,95,0.22)', sel ? '#ff5f5f' : 'rgba(255,95,95,0.75)');
    if (sel || state.tool === 'select') drawVertices(s, '#ff5f5f');
  }
  // hotspots
  for (const [i, h] of (w.hotspots || []).entries()) {
    if (!h.rect) continue;
    const sel = state.selection?.kind === 'hotspot' && state.selection.index === i;
    drawShape(h.rect, 'rgba(245,200,66,0.18)', sel ? '#f5c842' : 'rgba(245,200,66,0.8)');
    ctx.fillStyle = '#f5c842';
    ctx.font = 'bold 11px monospace';
    ctx.fillText(`⚡ ${h.command || '?'}`, X(normRect(h.rect)[0]) + 4, Y(normRect(h.rect)[1]) + 13);
  }

  // horizon
  const hy = w.horizon ?? 0.55;
  ctx.strokeStyle = '#5fd7ff';
  ctx.setLineDash([10, 6]);
  ctx.beginPath();
  ctx.moveTo(0, Y(hy));
  ctx.lineTo(canvas.width, Y(hy));
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#5fd7ff';
  ctx.font = '10px monospace';
  ctx.fillText(`horizon ${hy.toFixed(2)}`, 6, Y(hy) - 4);

  // spawns
  for (const [k, p] of Object.entries(w.spawn || {})) {
    if (Array.isArray(p)) drawMarker(p[0], p[1], `spawn:${k}`, '#ffffff');
  }
  // npcs
  for (const [k, p] of Object.entries(w.npcs || {})) {
    if (Array.isArray(p)) drawMarker(p[0], p[1], `npc:${k}`, '#ff7ad9');
  }

  // wand mask
  if (maskCanvas) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(maskCanvas, 0, 0, canvas.width, canvas.height);
  }
  // SAM points
  for (const p of state.sam.points) {
    ctx.fillStyle = p.label ? '#5fff87' : '#ff5f5f';
    ctx.beginPath();
    ctx.arc(X(p.x), Y(p.y), 5, 0, Math.PI * 2);
    ctx.fill();
  }

  // draft polygon
  if (state.draft) {
    ctx.strokeStyle = '#fff';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    state.draft.forEach(([px, py], i) => (i ? ctx.lineTo(X(px), Y(py)) : ctx.moveTo(X(px), Y(py))));
    ctx.lineTo(X(state.mouse.x), Y(state.mouse.y));
    ctx.stroke();
    ctx.setLineDash([]);
    drawVertices(state.draft, '#ffffff');
  }

  // transform handles around the selection
  if (state.tool === 'select') {
    const bb = selectionBBox();
    if (bb) {
      ctx.strokeStyle = '#ffffff';
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1;
      ctx.strokeRect(X(bb[0]), Y(bb[1]), X(bb[2] - bb[0]), Y(bb[3] - bb[1]));
      ctx.setLineDash([]);
      for (const [hx, hy] of HANDLES) {
        const [px, py] = handlePoint(bb, hx, hy);
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#10102a';
        ctx.fillRect(X(px) - 5, Y(py) - 5, 10, 10);
        ctx.strokeRect(X(px) - 5, Y(py) - 5, 10, 10);
      }
    }
  }

  // hero-size ghosts
  if (state.preview) {
    const sAH = w.scaleAtHorizon ?? 0.45;
    for (const gy of [hy + 0.02, (hy + 1) / 2, 0.95]) {
      const t = Math.min(1, Math.max(0, (gy - hy) / Math.max(0.05, 1 - hy)));
      const scale = sAH + (1 - sAH) * t;
      const hpx = 0.32 * scale * canvas.height;
      const wpx = hpx * 0.38;
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath();
      ctx.roundRect(X(0.08) - wpx / 2, Y(gy) - hpx, wpx, hpx, wpx / 3);
      ctx.fill();
      ctx.stroke();
    }
  }

  // test hero
  if (state.test) {
    const t = state.test;
    const scale = (w.scaleAtHorizon ?? 0.45) + (1 - (w.scaleAtHorizon ?? 0.45)) * Math.min(1, Math.max(0, (t.y - hy) / Math.max(0.05, 1 - hy)));
    const hpx = 0.32 * scale * canvas.height;
    const wpx = hpx * 0.38;
    ctx.fillStyle = 'rgba(245,200,66,0.85)';
    ctx.strokeStyle = '#10102a';
    ctx.beginPath();
    ctx.roundRect(X(t.x) - wpx / 2, Y(t.y) - hpx, wpx, hpx, wpx / 3);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(X(t.x), Y(t.y), 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

const overlayImgCache = new Map();
function overlayImage(o) {
  if (!o?.image) return null;
  if (!overlayImgCache.has(o.image)) {
    const img = new Image();
    img.onload = render;
    img.src = o.image.startsWith('data:') ? o.image : (state.world.assetBase || '') + o.image;
    overlayImgCache.set(o.image, img);
  }
  const img = overlayImgCache.get(o.image);
  return img.complete && img.naturalWidth ? img : null;
}

/* ================================================================== */
/* Hit testing (select tool)                                          */
/* ================================================================== */

const HIT = 0.014; // ~10px at 700px canvas

function near(ax, ay, bx, by) { return Math.abs(ax - bx) < HIT && Math.abs(ay - by) < HIT * 1.4; }

function shapeVertices(shape) {
  return isRect(shape)
    ? [[shape[0], shape[1]], [shape[2], shape[1]], [shape[2], shape[3]], [shape[0], shape[3]]]
    : shape;
}

function hitTest(x, y) {
  const w = walk();
  if (!w) return null;
  // markers first (small targets)
  for (const [k, p] of Object.entries(w.spawn || {})) {
    if (Array.isArray(p) && near(x, y, p[0], p[1])) return { kind: 'spawn', key: k };
  }
  for (const [k, p] of Object.entries(w.npcs || {})) {
    if (Array.isArray(p) && near(x, y, p[0], p[1])) return { kind: 'npc', key: k };
  }
  // vertices of areas/obstacles
  for (const [kind, list] of [['area', w.areas], ['obstacle', w.obstacles]]) {
    for (const [i, s] of (list || []).entries()) {
      const verts = shapeVertices(s);
      for (const [vi, [vx, vy]] of verts.entries()) {
        if (near(x, y, vx, vy)) return { kind, index: i, vertex: vi };
      }
    }
  }
  // overlay baseline handles / rects
  for (const [i, o] of (w.overlays || []).entries()) {
    if (!o.rect) continue;
    const by = o.baseline ?? o.rect[3];
    if (x >= o.rect[0] - HIT && x <= o.rect[2] + HIT && Math.abs(y - by) < HIT) return { kind: 'overlay', index: i, part: 'baseline' };
    if (pointInRect(x, y, o.rect)) return { kind: 'overlay', index: i, part: 'body' };
  }
  // hotspot bodies
  for (const [i, h] of (w.hotspots || []).entries()) {
    if (h.rect && pointInRect(x, y, h.rect)) return { kind: 'hotspot', index: i };
  }
  // the horizon line is grabbable too (before large shape bodies swallow it)
  if (Math.abs(y - (w.horizon ?? 0.55)) < HIT / 2) return { kind: 'horizon-line' };
  // shape bodies
  for (const [kind, list] of [['obstacle', w.obstacles], ['area', w.areas]]) {
    for (const [i, s] of (list || []).entries()) {
      if (pointInShape(x, y, s)) return { kind, index: i };
    }
  }
  return null;
}

function moveShape(shape, dx, dy) {
  if (isRect(shape)) return [shape[0] + dx, shape[1] + dy, shape[2] + dx, shape[3] + dy];
  return shape.map(([px, py]) => [px + dx, py + dy]);
}

/* ---- transform handles: every selected element gets a resizable bbox ---- */

function selectionBBox() {
  const sel = state.selection;
  const w = walk();
  if (!sel || !w) return null;
  if (sel.kind === 'area' || sel.kind === 'obstacle') {
    const s = (sel.kind === 'area' ? w.areas : w.obstacles)?.[sel.index];
    return s ? shapeBounds(s) : null;
  }
  if (sel.kind === 'overlay') {
    const r = w.overlays?.[sel.index]?.rect;
    return r ? normRect(r) : null;
  }
  if (sel.kind === 'hotspot') {
    const r = w.hotspots?.[sel.index]?.rect;
    return r ? normRect(r) : null;
  }
  return null;
}

// hx/hy: -1 = left/top edge, +1 = right/bottom edge, 0 = middle of that axis
const HANDLES = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

function handlePoint(bb, hx, hy) {
  const [x1, y1, x2, y2] = bb;
  return [hx < 0 ? x1 : hx > 0 ? x2 : (x1 + x2) / 2, hy < 0 ? y1 : hy > 0 ? y2 : (y1 + y2) / 2];
}

function handleAt(x, y) {
  const bb = selectionBBox();
  if (!bb) return null;
  for (const [hx, hy] of HANDLES) {
    const [px, py] = handlePoint(bb, hx, hy);
    if (near(x, y, px, py)) return { hx, hy, bb };
  }
  return null;
}

function handleCursor(hx, hy) {
  if (hx === 0) return 'ns-resize';
  if (hy === 0) return 'ew-resize';
  return hx === hy ? 'nwse-resize' : 'nesw-resize';
}

const MIN_SIZE = 0.01;

// Resize the selected element to the bbox implied by dragging one handle of
// the drag-start bbox to (x, y). Polygons scale through the bbox; overlays
// keep their baseline at the same relative depth.
function applyResize(d, x, y) {
  const w = walk();
  const sel = state.selection;
  if (!sel || !w) return;
  let [x1, y1, x2, y2] = d.bb;
  if (d.hx < 0) x1 = Math.min(x, x2 - MIN_SIZE);
  if (d.hx > 0) x2 = Math.max(x, x1 + MIN_SIZE);
  if (d.hy < 0) y1 = Math.min(y, y2 - MIN_SIZE);
  if (d.hy > 0) y2 = Math.max(y, y1 + MIN_SIZE);
  const clamp = (v) => Math.min(1, Math.max(0, v));
  const nb = [clamp(x1), clamp(y1), clamp(x2), clamp(y2)].map((n) => +n.toFixed(4));

  if (sel.kind === 'overlay') {
    const o = w.overlays[sel.index];
    const [, oy1, , oy2] = d.bb;
    const rel = ((d.baseline ?? oy2) - oy1) / Math.max(1e-6, oy2 - oy1);
    o.rect = nb;
    o.baseline = +(nb[1] + rel * (nb[3] - nb[1])).toFixed(4);
  } else if (sel.kind === 'hotspot') {
    w.hotspots[sel.index].rect = nb;
  } else if (sel.kind === 'area' || sel.kind === 'obstacle') {
    const list = sel.kind === 'area' ? w.areas : w.obstacles;
    if (isRect(d.orig)) {
      list[sel.index] = nb;
    } else {
      const [ox1, oy1, ox2, oy2] = d.bb;
      const sx = (nb[2] - nb[0]) / Math.max(1e-6, ox2 - ox1);
      const sy = (nb[3] - nb[1]) / Math.max(1e-6, oy2 - oy1);
      list[sel.index] = d.orig.map(([px, py]) => [
        +(nb[0] + (px - ox1) * sx).toFixed(4),
        +(nb[1] + (py - oy1) * sy).toFixed(4),
      ]);
    }
  }
}

// Nearest polygon edge of the selected shape within range: for double-click
// vertex insertion. Returns { index (of list entry), after (vertex idx) }.
function polygonEdgeAt(x, y) {
  const sel = state.selection;
  const w = walk();
  if (!sel || (sel.kind !== 'area' && sel.kind !== 'obstacle')) return null;
  const s = (sel.kind === 'area' ? w.areas : w.obstacles)?.[sel.index];
  if (!isPolygon(s)) return null;
  let best = null;
  let bestD = HIT * HIT * 2;
  for (let i = 0; i < s.length; i++) {
    const [ax, ay] = s[i];
    const [bx, by] = s[(i + 1) % s.length];
    const abx = bx - ax;
    const aby = by - ay;
    const t = Math.min(1, Math.max(0, ((x - ax) * abx + (y - ay) * aby) / Math.max(1e-9, abx * abx + aby * aby)));
    const dx = x - (ax + t * abx);
    const dy = y - (ay + t * aby);
    const dist = dx * dx + dy * dy;
    if (dist < bestD) { bestD = dist; best = { after: i }; }
  }
  return best;
}

function deleteSelection() {
  const sel = state.selection;
  const w = walk();
  if (!sel || !w) return;
  mutate(() => {
    if (sel.kind === 'area') w.areas.splice(sel.index, 1);
    else if (sel.kind === 'obstacle') w.obstacles.splice(sel.index, 1);
    else if (sel.kind === 'overlay') w.overlays.splice(sel.index, 1);
    else if (sel.kind === 'hotspot') w.hotspots.splice(sel.index, 1);
    else if (sel.kind === 'spawn') delete w.spawn[sel.key];
    else if (sel.kind === 'npc') delete w.npcs[sel.key];
    state.selection = null;
  });
}

/* ================================================================== */
/* Magic wand                                                         */
/* ================================================================== */

let imgData = null; // cached ImageData of current bg at natural size

function ensureImageData() {
  const img = bgImage();
  if (!img) return null;
  if (imgData?.roomId === state.roomId) return imgData;
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  imgData = { roomId: state.roomId, data: g.getImageData(0, 0, c.width, c.height), w: c.width, h: c.height };
  return imgData;
}

function wandSelect(nx, ny, mode) {
  const id = ensureImageData();
  if (!id) return toast('load a background image first');
  const { data, w, h } = id;
  const px = data.data;
  const sx = Math.min(w - 1, Math.round(nx * w));
  const sy = Math.min(h - 1, Math.round(ny * h));
  const si = (sy * w + sx) * 4;
  const seed = [px[si], px[si + 1], px[si + 2]];
  const tol = Number($('wand-tolerance').value) ** 2;
  const match = (i) => {
    const dr = px[i] - seed[0];
    const dg = px[i + 1] - seed[1];
    const db = px[i + 2] - seed[2];
    return dr * dr + dg * dg + db * db <= tol;
  };

  const region = new Uint8Array(w * h);
  if ($('wand-contiguous').checked) {
    const stack = [sy * w + sx];
    region[sy * w + sx] = 1;
    while (stack.length) {
      const p = stack.pop();
      const x0 = p % w;
      const y0 = (p / w) | 0;
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x1 = x0 + ox;
        const y1 = y0 + oy;
        if (x1 < 0 || x1 >= w || y1 < 0 || y1 >= h) continue;
        const q = y1 * w + x1;
        if (!region[q] && match(q * 4)) { region[q] = 1; stack.push(q); }
      }
    }
  } else {
    for (let i = 0; i < w * h; i++) if (match(i * 4)) region[i] = 1;
  }

  if (mode === 'add' && state.wand.mask && state.wand.w === w) {
    for (let i = 0; i < region.length; i++) if (region[i]) state.wand.mask[i] = 1;
  } else if (mode === 'sub' && state.wand.mask && state.wand.w === w) {
    for (let i = 0; i < region.length; i++) if (region[i]) state.wand.mask[i] = 0;
  } else {
    state.wand = { mask: region, w, h };
  }
  rebuildMaskCanvas();
  render();
}

function maskBBox() {
  const { mask, w, h } = state.wand;
  if (!mask) return null;
  let x1 = w, y1 = h, x2 = -1, y2 = -1, count = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue;
    count++;
    if (x < x1) x1 = x; if (x > x2) x2 = x;
    if (y < y1) y1 = y; if (y > y2) y2 = y;
  }
  return count ? { x1, y1, x2, y2, count } : null;
}

function makeOverlayFromMask() {
  const id = ensureImageData();
  const bb = maskBBox();
  if (!id || !bb) return toast('no selection');
  const { mask, w } = state.wand;
  const { data } = id;
  const ow = bb.x2 - bb.x1 + 1;
  const oh = bb.y2 - bb.y1 + 1;
  const out = document.createElement('canvas');
  out.width = ow;
  out.height = oh;
  const og = out.getContext('2d');
  const od = og.createImageData(ow, oh);
  for (let y = bb.y1; y <= bb.y2; y++) for (let x = bb.x1; x <= bb.x2; x++) {
    if (!mask[y * w + x]) continue;
    const sp = (y * w + x) * 4;
    const dp = ((y - bb.y1) * ow + (x - bb.x1)) * 4;
    od.data[dp] = data.data[sp];
    od.data[dp + 1] = data.data[sp + 1];
    od.data[dp + 2] = data.data[sp + 2];
    od.data[dp + 3] = 255;
  }
  og.putImageData(od, 0, 0);
  const rect = [bb.x1 / id.w, bb.y1 / id.h, (bb.x2 + 1) / id.w, (bb.y2 + 1) / id.h];
  mutate(() => {
    const wd = walk();
    wd.overlays = wd.overlays || [];
    wd.overlays.push({ image: out.toDataURL('image/png'), rect, baseline: rect[3] });
  });
  clearWand();
  toast('overlay added — drag its baseline to set the occlusion depth');
}

function makeObstacleFromMask() {
  const id = ensureImageData();
  const bb = maskBBox();
  if (!id || !bb) return toast('no selection');
  // footprint: the bottom quarter of the mask's bbox — where feet collide
  const y1 = bb.y1 + (bb.y2 - bb.y1) * 0.72;
  mutate(() => {
    const wd = walk();
    wd.obstacles = wd.obstacles || [];
    wd.obstacles.push([
      +(bb.x1 / id.w).toFixed(4), +(y1 / id.h).toFixed(4),
      +((bb.x2 + 1) / id.w).toFixed(4), +((bb.y2 + 1) / id.h).toFixed(4),
    ]);
  });
  clearWand();
  toast('obstacle footprint added');
}

function clearWand() {
  state.wand = { mask: null, w: 0, h: 0 };
  state.sam.points = [];
  maskCanvas = null;
  render();
}

/* ================================================================== */
/* Optional AI segmentation (SAM via transformers.js)                 */
/* ================================================================== */

async function loadSam() {
  const status = $('sam-status');
  try {
    state.sam.status = 'loading';
    status.textContent = 'loading model…';
    const T = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.1');
    const modelId = 'Xenova/slimsam-77-uniform';
    state.sam.model = await T.SamModel.from_pretrained(modelId, { dtype: 'fp32' });
    state.sam.processor = await T.AutoProcessor.from_pretrained(modelId);
    state.sam.RawImage = T.RawImage;
    state.sam.Tensor = T.Tensor;
    state.sam.status = 'ready';
    status.textContent = 'AI ready — click the image';
    $('sam-hint').hidden = false;
    $('btn-sam-apply').hidden = false;
    $('btn-sam').disabled = true;
  } catch (e) {
    state.sam.status = 'error';
    status.textContent = `couldn't load (${String(e.message || e).slice(0, 60)}…) — magic wand still works`;
  }
}

async function samEmbed() {
  if (state.sam.embeds?.roomId === state.roomId) return state.sam.embeds;
  const img = bgImage();
  if (!img) return null;
  const raw = await state.sam.RawImage.fromURL(img.src);
  const inputs = await state.sam.processor(raw);
  const embeddings = await state.sam.model.get_image_embeddings(inputs);
  state.sam.embeds = { roomId: state.roomId, inputs, embeddings, raw };
  return state.sam.embeds;
}

async function samClick(nx, ny, positive) {
  if (state.sam.status !== 'ready') return;
  toast('AI segmenting…');
  try {
    state.sam.points.push({ x: nx, y: ny, label: positive ? 1 : 0 });
    const { inputs, embeddings, raw } = await samEmbed();
    const reshaped = inputs.reshaped_input_sizes[0];
    const pts = state.sam.points.map((p) => [p.x * reshaped[1], p.y * reshaped[0]]);
    const labels = state.sam.points.map((p) => BigInt(p.label));
    const input_points = new state.sam.Tensor('float32', pts.flat(), [1, 1, pts.length, 2]);
    const input_labels = new state.sam.Tensor('int64', labels, [1, 1, labels.length]);
    const outputs = await state.sam.model({ ...embeddings, input_points, input_labels });
    const masks = await state.sam.processor.post_process_masks(outputs.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes);
    // best-scoring mask
    const scores = outputs.iou_scores.data;
    let best = 0;
    for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i;
    const m = masks[0][0]; // [num_masks, H, W]
    const H = m.dims[1];
    const W = m.dims[2];
    const off = best * H * W;
    const mask = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) mask[i] = m.data[off + i] ? 1 : 0;
    state.wand = { mask, w: W, h: H };
    rebuildMaskCanvas();
    render();
    toast(`AI mask (score ${scores[best].toFixed(2)}) — Apply, or add points`);
  } catch (e) {
    toast(`AI failed: ${String(e.message || e).slice(0, 80)}`);
  }
}

/* ================================================================== */
/* Test-walk mode                                                     */
/* ================================================================== */

const testKeys = new Set();
let testRAF = null;
let testLast = 0;

function toggleTest() {
  if (state.test) {
    state.test = null;
    cancelAnimationFrame(testRAF);
    $('btn-test').textContent = '▶ Test walk';
    render();
    return;
  }
  const w = walk();
  if (!w) return;
  const start = nearestWalkable(0.5, 0.85, w) || [0.5, 0.85];
  state.test = { x: start[0], y: start[1] };
  $('btn-test').textContent = '■ Stop test';
  testLast = performance.now();
  const step = (now) => {
    if (!state.test) return;
    const dt = Math.min(0.05, (now - testLast) / 1000);
    testLast = now;
    const wd = walk();
    const hy = wd.horizon ?? 0.55;
    const sAH = wd.scaleAtHorizon ?? 0.45;
    const s = sAH + (1 - sAH) * Math.min(1, Math.max(0, (state.test.y - hy) / Math.max(0.05, 1 - hy)));
    let dx = 0;
    let dy = 0;
    if (testKeys.has('left')) dx -= 1;
    if (testKeys.has('right')) dx += 1;
    if (testKeys.has('up')) dy -= 1;
    if (testKeys.has('down')) dy += 1;
    const nx = state.test.x + dx * 0.32 * s * dt;
    const ny = state.test.y + dy * 0.18 * s * dt;
    const stuck = !walkableAt(state.test.x, state.test.y, wd);
    if (stuck || walkableAt(nx, ny, wd)) { state.test.x = nx; state.test.y = ny; }
    else if (walkableAt(nx, state.test.y, wd)) state.test.x = nx;
    else if (walkableAt(state.test.x, ny, wd)) state.test.y = ny;
    for (const h of wd.hotspots || []) {
      if (h.rect && pointInRect(state.test.x, state.test.y, h.rect)) toast(`hotspot → ${h.command}`);
    }
    const ed = wd.edges || {};
    if (state.test.x < 0.01 && ed.left) toast(`edge → ${ed.left}`);
    if (state.test.x > 0.99 && ed.right) toast(`edge → ${ed.right}`);
    if (state.test.y > 0.98 && ed.bottom) toast(`edge → ${ed.bottom}`);
    if (state.test.y < (wd.horizon ?? 0.55) + 0.01 && ed.top) toast(`edge → ${ed.top}`);
    state.test.x = Math.min(1, Math.max(0, state.test.x));
    state.test.y = Math.min(1, Math.max(0, state.test.y));
    render();
    testRAF = requestAnimationFrame(step);
  };
  testRAF = requestAnimationFrame(step);
}

/* ================================================================== */
/* Tool interactions                                                  */
/* ================================================================== */

canvas.addEventListener('pointerdown', (e) => {
  if (!room()) return;
  const [x, y] = eventNorm(e);
  const w = walk();

  switch (state.tool) {
    case 'select': {
      // 1. transform handles of the current selection win over everything
      //    (except Alt-clicks, which are always vertex operations)
      const h = e.altKey ? null : handleAt(x, y);
      if (h) {
        state.undo.push(snapshot());
        state.redo.length = 0;
        const sel = state.selection;
        const drag = { mode: 'resize', hx: h.hx, hy: h.hy, bb: h.bb };
        if (sel.kind === 'area' || sel.kind === 'obstacle') {
          drag.orig = JSON.parse(JSON.stringify((sel.kind === 'area' ? w.areas : w.obstacles)[sel.index]));
        } else if (sel.kind === 'overlay') {
          drag.baseline = w.overlays[sel.index].baseline;
        }
        state.dragging = drag;
        break;
      }
      const hit = hitTest(x, y);
      // 2. Alt-click deletes a polygon vertex (triangles are the floor)
      if (hit && e.altKey && hit.vertex != null && (hit.kind === 'area' || hit.kind === 'obstacle')) {
        const list = hit.kind === 'area' ? w.areas : w.obstacles;
        if (isPolygon(list[hit.index]) && list[hit.index].length > 3) {
          state.selection = { kind: hit.kind, index: hit.index };
          mutate(() => list[hit.index].splice(hit.vertex, 1));
          break;
        }
      }
      state.selection = hit;
      if (hit) {
        state.undo.push(snapshot());
        state.redo.length = 0;
        state.dragging = { ...hit, lastX: x, lastY: y };
      }
      render();
      break;
    }
    case 'area':
    case 'obstacle-poly': {
      state.draft = state.draft || [];
      state.draft.push([+x.toFixed(4), +y.toFixed(4)]);
      render();
      break;
    }
    case 'obstacle-rect':
    case 'hotspot': {
      state.dragging = { kind: state.tool, startX: x, startY: y, rect: [x, y, x, y] };
      break;
    }
    case 'horizon': {
      mutate(() => { w.horizon = +y.toFixed(4); });
      syncSettingsPanel();
      break;
    }
    case 'spawn': {
      const key = $('spawn-key')?.value || 'default';
      mutate(() => {
        w.spawn = w.spawn || {};
        w.spawn[key] = [+x.toFixed(4), +y.toFixed(4)];
      });
      break;
    }
    case 'npc': {
      const id = ($('npc-id')?.value || '').trim();
      if (!id) return toast('enter an NPC id first');
      mutate(() => {
        w.npcs = w.npcs || {};
        w.npcs[id] = [+x.toFixed(4), +y.toFixed(4)];
      });
      break;
    }
    case 'wand': {
      if (state.sam.status === 'ready') samClick(x, y, !e.shiftKey);
      else wandSelect(x, y, e.shiftKey ? 'add' : e.altKey ? 'sub' : 'new');
      break;
    }
  }
});

canvas.addEventListener('pointermove', (e) => {
  const [x, y] = eventNorm(e);
  state.mouse = { x, y };
  $('coords').textContent = `${x.toFixed(3)}, ${y.toFixed(3)}`;

  const d = state.dragging;
  if (!d) {
    // hover feedback in select mode: resize cursors over handles, grab over
    // the horizon line
    if (state.tool === 'select' && room()) {
      const h = handleAt(x, y);
      canvas.style.cursor = h ? handleCursor(h.hx, h.hy)
        : Math.abs(y - (walk()?.horizon ?? 0.55)) < HIT / 2 ? 'row-resize' : 'crosshair';
    } else canvas.style.cursor = 'crosshair';
    if (state.draft) render();
    return;
  }
  const w = walk();

  if (d.mode === 'resize') {
    applyResize(d, x, y);
    render();
    return;
  }
  if (d.kind === 'horizon-line') {
    w.horizon = +Math.min(0.95, Math.max(0.05, y)).toFixed(4);
    syncSettingsPanel();
    render();
    return;
  }

  if (d.kind === 'obstacle-rect' || d.kind === 'hotspot') {
    d.rect = [d.startX, d.startY, x, y];
    render();
    ctx.save();
    ctx.strokeStyle = '#fff';
    ctx.setLineDash([5, 5]);
    const [x1, y1, x2, y2] = normRect(d.rect);
    ctx.strokeRect(X(x1), Y(y1), X(x2 - x1), Y(y2 - y1));
    ctx.restore();
    return;
  }

  // select-tool drags
  const dx = x - d.lastX;
  const dy = y - d.lastY;
  d.lastX = x;
  d.lastY = y;
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  if (d.kind === 'spawn') w.spawn[d.key] = [clamp01(x), clamp01(y)];
  else if (d.kind === 'npc') w.npcs[d.key] = [clamp01(x), clamp01(y)];
  else if (d.kind === 'overlay' && d.part === 'baseline') {
    w.overlays[d.index].baseline = +clamp01(y).toFixed(4);
  } else if (d.kind === 'overlay') {
    const o = w.overlays[d.index];
    o.rect = [o.rect[0] + dx, o.rect[1] + dy, o.rect[2] + dx, o.rect[3] + dy];
    if (o.baseline != null) o.baseline += dy;
  } else if (d.kind === 'hotspot' && d.index != null) {
    w.hotspots[d.index].rect = moveShape(w.hotspots[d.index].rect, dx, dy);
  } else if ((d.kind === 'area' || d.kind === 'obstacle') && d.vertex != null) {
    const list = d.kind === 'area' ? w.areas : w.obstacles;
    const s = list[d.index];
    if (isRect(s)) {
      // dragging a rect corner: corners are [0]=(x1,y1) [1]=(x2,y1) [2]=(x2,y2) [3]=(x1,y2)
      if (d.vertex === 0) { s[0] = x; s[1] = y; }
      else if (d.vertex === 1) { s[2] = x; s[1] = y; }
      else if (d.vertex === 2) { s[2] = x; s[3] = y; }
      else { s[0] = x; s[3] = y; }
    } else s[d.vertex] = [clamp01(x), clamp01(y)];
  } else if (d.kind === 'area' || d.kind === 'obstacle') {
    const list = d.kind === 'area' ? w.areas : w.obstacles;
    list[d.index] = moveShape(list[d.index], dx, dy);
  }
  render();
});

window.addEventListener('pointerup', () => {
  const d = state.dragging;
  state.dragging = null;
  if (!d) return;
  const w = walk();
  if (d.kind === 'obstacle-rect') {
    const r = normRect(d.rect).map((n) => +n.toFixed(4));
    if (r[2] - r[0] > 0.01 && r[3] - r[1] > 0.01) {
      mutate(() => { w.obstacles = w.obstacles || []; w.obstacles.push(r); });
    } else render();
  } else if (d.kind === 'hotspot' && d.rect) {
    const r = normRect(d.rect).map((n) => +n.toFixed(4));
    if (r[2] - r[0] > 0.01 && r[3] - r[1] > 0.01) {
      const command = prompt('Hotspot command (e.g. "in", "enter hut"):', 'in');
      if (command) mutate(() => { w.hotspots = w.hotspots || []; w.hotspots.push({ rect: r, command }); });
      else render();
    } else render();
  } else {
    refresh(); // finalize select-tool drag (undo snapshot was taken on pointerdown)
  }
});

canvas.addEventListener('dblclick', (e) => {
  if (state.draft) { closeDraft(); return; }
  // double-click on a selected polygon's edge inserts a vertex there
  if (state.tool === 'select') {
    const [x, y] = eventNorm(e);
    const edge = polygonEdgeAt(x, y);
    if (edge) {
      const sel = state.selection;
      const list = sel.kind === 'area' ? walk().areas : walk().obstacles;
      mutate(() => list[sel.index].splice(edge.after + 1, 0, [+x.toFixed(4), +y.toFixed(4)]));
    }
  }
});

function closeDraft() {
  if (!state.draft || state.draft.length < 3) { state.draft = null; render(); return; }
  const poly = state.draft;
  state.draft = null;
  const w = walk();
  mutate(() => {
    if (state.tool === 'area') { w.areas = w.areas || []; w.areas.push(poly); }
    else { w.obstacles = w.obstacles || []; w.obstacles.push(poly); }
  });
}

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  if (state.test) {
    const dir = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right' }[e.code];
    if (dir) { testKeys.add(dir); e.preventDefault(); return; }
  }
  if (e.code === 'Enter') closeDraft();
  else if (e.code === 'Escape') { state.draft = null; state.selection = null; clearWand(); render(); }
  else if (e.code === 'Delete' || e.code === 'Backspace') deleteSelection();
  else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (!e.ctrlKey && !e.metaKey) {
    const tool = { KeyV: 'select', KeyA: 'area', KeyR: 'obstacle-rect', KeyO: 'obstacle-poly', KeyH: 'horizon', KeyS: 'spawn', KeyN: 'npc', KeyT: 'hotspot', KeyW: 'wand' }[e.code];
    if (tool) setTool(tool);
  }
});
window.addEventListener('keyup', (e) => {
  const dir = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right' }[e.code];
  if (dir) testKeys.delete(dir);
});

/* ================================================================== */
/* Sidebar wiring                                                     */
/* ================================================================== */

function setTool(tool) {
  state.tool = tool;
  state.draft = null;
  document.querySelectorAll('#tools button').forEach((b) => b.classList.toggle('active', b.dataset.tool === tool));
  $('wand-section').hidden = tool !== 'wand';
  const opts = $('tool-options');
  if (tool === 'spawn') {
    opts.innerHTML = `<label>direction <select id="spawn-key">${ED_SPAWN_KEYS.map((k) => `<option>${k}</option>`).join('')}</select></label>`;
  } else if (tool === 'npc') {
    opts.innerHTML = '<input id="npc-id" placeholder="npc id (matches sprites config)" />';
  } else if (tool === 'area' || tool === 'obstacle-poly') {
    opts.innerHTML = '<span class="ed-hint">click vertices · Enter or double-click to close · Esc cancels</span>';
  } else if (tool === 'wand') {
    opts.innerHTML = '<span class="ed-hint">select pixels, then make an overlay or obstacle</span>';
  } else {
    opts.innerHTML = '';
  }
  render();
}

document.querySelectorAll('#tools button').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));

function refreshRoomList() {
  const list = $('room-list');
  list.innerHTML = '';
  for (const id of Object.keys(state.world.rooms)) {
    const div = document.createElement('div');
    div.className = `ed-room${id === state.roomId ? ' active' : ''}`;
    div.innerHTML = `<span>${id}</span><span class="del" title="delete room">✕</span>`;
    div.querySelector('span').addEventListener('click', () => selectRoom(id));
    div.addEventListener('click', (e) => { if (!e.target.classList.contains('del')) selectRoom(id); });
    div.querySelector('.del').addEventListener('click', (e) => {
      e.stopPropagation();
      if (!confirm(`Delete room "${id}" from the world file?`)) return;
      mutate(() => {
        delete state.world.rooms[id];
        if (state.roomId === id) state.roomId = Object.keys(state.world.rooms)[0] || null;
      });
    });
    list.appendChild(div);
  }
  $('room-label').textContent = state.roomId || 'no room';
}

function selectRoom(id) {
  state.roomId = id;
  state.selection = null;
  state.draft = null;
  imgData = null;
  clearWand();
  state.sam.embeds = null;
  loadRoomBg();
  refresh();
}

function loadRoomBg() {
  const r = room();
  if (!r) return;
  if (bgCache.has(state.roomId)) return;
  const src = r.imageDataURI
    || (r.image?.startsWith('data:') ? r.image : null)
    || (r.image ? (state.world.assetBase || '') + r.image : null);
  if (!src) { bgCache.set(state.roomId, 'error'); return; }
  const img = new Image();
  img.onload = () => { imgData = null; refresh(); };
  img.onerror = () => { bgCache.set(state.roomId, 'error'); refresh(); };
  img.src = src;
  bgCache.set(state.roomId, img);
}

$('asset-base').value = state.world.assetBase;
$('asset-base').addEventListener('change', () => {
  state.world.assetBase = $('asset-base').value;
  bgCache.clear();
  imgData = null;
  loadRoomBg();
  refresh();
});

$('btn-add-room').addEventListener('click', () => {
  const id = $('new-room-id').value.trim();
  if (!id) return;
  if (state.world.rooms[id]) return toast('room id exists');
  state.undo.push(snapshot());
  state.world.rooms[id] = { walk: {} };
  state.roomId = id;
  $('new-room-id').value = '';
  refresh();
});

$('bg-file').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file || !room()) return;
  const reader = new FileReader();
  reader.onload = () => {
    room().imageDataURI = reader.result;
    if (!room().image) room().image = `art/${state.roomId}.${file.name.split('.').pop()}`;
    bgCache.delete(state.roomId);
    imgData = null;
    loadRoomBg();
    refresh();
  };
  reader.readAsDataURL(file);
});

$('btn-bg-path').addEventListener('click', () => {
  const p = $('bg-path').value.trim();
  if (!p || !room()) return;
  const img = new Image();
  img.onload = () => { imgData = null; refresh(); };
  img.onerror = () => toast(`couldn't load ${p}`);
  // Engine-relative paths (art/room.jpg) resolve through the asset base;
  // absolute URLs and data URIs pass straight through.
  img.src = /^(https?:|data:|\/)/.test(p) ? p : (state.world.assetBase || '') + p;
  bgCache.set(state.roomId, img);
  room().image = p.replace(/^\.\.\/games\/[^/]+\//, ''); // store engine-relative when possible
  refresh();
});

/* room settings */
$('opt-horizon').addEventListener('input', (e) => {
  const w = walk();
  if (!w) return;
  w.horizon = Number(e.target.value) / 100;
  $('opt-horizon-v').textContent = w.horizon.toFixed(2);
  render();
});
$('opt-scale').addEventListener('input', (e) => {
  const w = walk();
  if (!w) return;
  w.scaleAtHorizon = Number(e.target.value) / 100;
  $('opt-scale-v').textContent = w.scaleAtHorizon.toFixed(2);
  render();
});
$('opt-preview').addEventListener('change', (e) => { state.preview = e.target.checked; render(); });

for (const edge of ['top', 'bottom', 'left', 'right']) {
  const sel = $(`edge-${edge}`);
  sel.innerHTML = DIRS.map((d) => `<option value="${d}">${d || '(none)'}</option>`).join('');
  sel.addEventListener('change', () => {
    const w = walk();
    if (!w) return;
    w.edges = w.edges || {};
    if (sel.value) w.edges[edge] = sel.value;
    else delete w.edges[edge];
    if (!Object.keys(w.edges).length) delete w.edges;
    refresh();
  });
}

function syncSettingsPanel() {
  const w = walk() || {};
  $('opt-horizon').value = Math.round((w.horizon ?? 0.55) * 100);
  $('opt-horizon-v').textContent = (w.horizon ?? 0.55).toFixed(2);
  $('opt-scale').value = Math.round((w.scaleAtHorizon ?? 0.45) * 100);
  $('opt-scale-v').textContent = (w.scaleAtHorizon ?? 0.45).toFixed(2);
  for (const edge of ['top', 'bottom', 'left', 'right']) $(`edge-${edge}`).value = w.edges?.[edge] || '';
}

/* wand buttons */
$('btn-make-overlay').addEventListener('click', makeOverlayFromMask);
$('btn-make-obstacle').addEventListener('click', makeObstacleFromMask);
$('btn-clear-sel').addEventListener('click', clearWand);
$('btn-sam').addEventListener('click', loadSam);
$('btn-sam-apply').addEventListener('click', () => { state.sam.points = []; toast('mask kept — make an overlay or obstacle'); });

/* top bar */
$('btn-undo').addEventListener('click', undo);
$('btn-redo').addEventListener('click', redo);
$('btn-test').addEventListener('click', toggleTest);

/* ================================================================== */
/* Import / export                                                    */
/* ================================================================== */

function exportWorld() {
  const world = { version: 1, rooms: {} };
  for (const [id, r] of Object.entries(state.world.rooms)) {
    const entry = {};
    if (r.image) entry.image = r.image;
    else if (r.imageDataURI) entry.image = r.imageDataURI;
    if (r.walk && Object.keys(r.walk).length) entry.walk = r.walk;
    world.rooms[id] = entry;
  }
  return world;
}

function download(name, text, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

$('btn-export').addEventListener('click', () => {
  download('walk-data.json', JSON.stringify(exportWorld(), null, 2));
});

$('btn-copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText(JSON.stringify(exportWorld(), null, 2));
  toast('copied');
});

$('btn-export-pngs').addEventListener('click', () => {
  // Downloads each data-URI overlay as a PNG and rewrites the world to
  // reference art/overlays/<room>-<n>.png (save the files there yourself).
  let n = 0;
  for (const [id, r] of Object.entries(state.world.rooms)) {
    (r.walk?.overlays || []).forEach((o, i) => {
      if (!o.image?.startsWith('data:')) return;
      const name = `${id}-overlay-${i}.png`;
      download(name, dataURItoBlob(o.image), 'image/png');
      o.image = `art/overlays/${name}`;
      n++;
    });
  }
  refresh();
  toast(n ? `${n} PNG(s) downloaded — put them in art/overlays/` : 'no inline overlays to export');
});

function dataURItoBlob(uri) {
  const bytes = atob(uri.split(',')[1]);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return arr;
}

function importWorld(data) {
  if (!data?.rooms) throw new Error('missing rooms');
  state.undo.push(snapshot());
  if (data.assetBase) state.world.assetBase = data.assetBase;
  for (const [id, r] of Object.entries(data.rooms)) {
    const entry = { walk: r.walk || {} };
    if (typeof r.image === 'string' && r.image.startsWith('data:')) entry.imageDataURI = r.image;
    else if (r.image) entry.image = r.image;
    state.world.rooms[id] = entry;
    bgCache.delete(id);
  }
  state.roomId = state.roomId || Object.keys(state.world.rooms)[0] || null;
  loadRoomBg();
  refresh();
}

$('import-file').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      importWorld(data);
      toast(`imported ${Object.keys(data.rooms).length} room(s)`);
    } catch (err) {
      toast(`import failed: ${err.message}`);
    }
  };
  reader.readAsText(file);
});

/* ================================================================== */
/* Validation + refresh                                               */
/* ================================================================== */

function refreshValidation() {
  const el = $('validation');
  if (!room()) { el.textContent = '—'; el.className = 'ed-validation'; return; }
  const warnings = validateWalk(walk(), state.roomId);
  if (!warnings.length) {
    el.textContent = '✓ no problems found';
    el.className = 'ed-validation ok';
  } else {
    el.textContent = warnings.join('\n');
    el.className = 'ed-validation warn';
  }
}

let toastTimer = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}

function refresh() {
  refreshRoomList();
  syncSettingsPanel();
  refreshValidation();
  render();
}

window.addEventListener('resize', render);

/* expose for tests */
window.__editor = { state, exportWorld, importWorld, wandSelect, selectRoom, setTool, refresh };

/* single-file builds can embed a starter world (backgrounds as data URIs) */
if (window.__EMBED_WORLD) {
  try { importWorld(window.__EMBED_WORLD); } catch (e) { console.warn('embedded world failed:', e); }
}

refresh();
