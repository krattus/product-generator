// walk-ui.js — King's Quest-style walkabout layer for the browser UI.
//
// Turns the scene panel into a live canvas: an animated hero you steer with
// the arrow keys / WASD, NPC sprites standing in the rooms, foreground
// occlusion overlays, perspective scaling, and room transitions by walking
// off the screen edges. The text parser keeps working exactly as before —
// this is Sierra's classic walk-and-type interface.
//
//   import { createBrowserUI } from './browser-ui.js';
//   import { attachWalkLayer } from './walk-ui.js';
//   createBrowserUI(game, root);
//   attachWalkLayer(game, root);
//
// Room walk data is authored either by hand in the game file or with the
// level editor (editor/index.html) and loaded via applyWalkData(). The full
// schema lives in src/walk-data.js. ALL coordinates — walk shapes, spawns,
// NPC positions, the hero — are normalized 0..1 in BACKGROUND-IMAGE space,
// so editor and engine agree pixel-for-pixel; the engine maps them through
// the background's cover transform when drawing.
// `obstacles` and `npcs` may be functions of the game ctx (game code only),
// so the world can react to state — e.g. a troll blocking a bridge until
// paid.

import { walkableAt, nearestWalkable, pointInRect, validateWalk } from '../src/walk-data.js';

const OPPOSITE = { north: 'south', south: 'north', east: 'west', west: 'east', in: 'out', out: 'in', up: 'down', down: 'up' };

const DEFAULT_SPAWNS = {
  north: [0.5, 0.62],   // came from the north edge -> appear near the top
  south: [0.5, 0.94],
  east: [0.94, 0.8],
  west: [0.06, 0.8],
  in: [0.5, 0.7],
  out: [0.5, 0.9],
  up: [0.5, 0.66],
  down: [0.5, 0.9],
  default: [0.5, 0.82],
};

// How close to a screen edge "pushing against the boundary" still counts as
// leaving. Lets walk areas that stop short of the actual edge still exit.
const EDGE_MARGIN = 0.06;

export function attachWalkLayer(game, root) {
  const scene = root.querySelector('.adv-scene');
  const input = root.querySelector('.adv-input');
  if (!scene) throw new Error('attachWalkLayer: run createBrowserUI first.');

  scene.innerHTML = '<canvas class="adv-canvas"></canvas>';
  scene.hidden = false;
  const canvas = scene.querySelector('canvas');
  const ctx2d = canvas.getContext('2d');

  /* ---------------- image loading ---------------- */

  const cache = new Map();
  const warned = new Set();
  function warnOnce(key, message) {
    if (warned.has(key)) return;
    warned.add(key);
    console.warn(`[walk-ui] ${message}`);
  }

  function loadImage(path) {
    if (!path) return null;
    if (cache.has(path)) return cache.get(path);
    const img = new Image();
    img.onerror = () => warnOnce(`img:${path}`, `image failed to load: ${path}`);
    img.src = path.startsWith('data:') ? path : (game.config.assetBase || '') + path;
    cache.set(path, img);
    return img;
  }

  const ready = (img) => img && img.complete && img.naturalWidth > 0;

  const spriteDefs = game.config.sprites || {};
  const heroDef = spriteDefs.hero || {};
  const heroImgs = {
    side: heroDef.side ? loadImage(heroDef.side.image) : null,
    front: heroDef.front ? loadImage(heroDef.front.image) : null,
    back: heroDef.back ? loadImage(heroDef.back.image) : null,
  };

  /* ---------------- hero state ---------------- */

  const hero = {
    x: 0.5, y: 0.82,
    facing: 'down',          // 'left' | 'right' | 'up' | 'down'
    moving: false,
    animTime: 0,
  };
  const keys = new Set();
  let pendingWalkDir = null;   // direction we sent to the engine by walking off an edge
  let transitionLock = 0;      // brief input lock after a room change

  function roomWalk() {
    const room = game.rooms.get(game.state?.currentRoom);
    const w = room?.def.walk || {};
    if (room && !warned.has(`val:${room.id}`)) {
      warned.add(`val:${room.id}`);
      for (const msg of validateWalk(w, room.id)) console.warn(`[walk-ui] ${msg}`);
    }
    // obstacles/npcs may be functions of ctx, so rooms can react to game
    // state (the troll steps aside once paid).
    const resolve = (v) => {
      if (typeof v !== 'function') return v;
      try { return v(game.ctx()); }
      catch (e) { warnOnce(`fn:${room?.id}`, `walk data function threw in ${room?.id}: ${e.message}`); return null; }
    };
    return {
      horizon: w.horizon ?? 0.55,
      scaleAtHorizon: w.scaleAtHorizon ?? 0.45,
      areas: w.areas || null,
      obstacles: resolve(w.obstacles) || [],
      overlays: w.overlays || [],
      npcs: resolve(w.npcs) || {},
      spawn: w.spawn || {},
      edges: w.edges || autoEdges(room),
      hotspots: w.hotspots || [],
    };
  }

  function autoEdges(room) {
    const exits = room?.def.exits || {};
    const edges = {};
    if (exits.north) edges.top = 'north';
    if (exits.south) edges.bottom = 'south';
    if (exits.east) edges.right = 'east';
    if (exits.west) edges.left = 'west';
    return edges;
  }

  function scaleAt(y, w) {
    const t = Math.min(1, Math.max(0, (y - w.horizon) / Math.max(0.05, 1 - w.horizon)));
    return w.scaleAtHorizon + (1 - w.scaleAtHorizon) * t;
  }

  function placeHero(x, y, w) {
    const snapped = nearestWalkable(x, y, w) || [x, y];
    hero.x = snapped[0];
    hero.y = snapped[1];
  }

  /* ---------------- room transitions ---------------- */

  game.on('room:enter', (_ctx, { from }) => {
    const dir = from || pendingWalkDir;
    pendingWalkDir = null;
    const w = roomWalk();
    const entered = dir ? OPPOSITE[dir] || 'default' : 'default';
    const spawn = w.spawn[entered] || w.spawn.default || DEFAULT_SPAWNS[entered] || DEFAULT_SPAWNS.default;
    placeHero(spawn[0], spawn[1], w);
    hero.facing = dir === 'west' ? 'left' : dir === 'east' ? 'right' : dir === 'north' || dir === 'in' || dir === 'up' ? 'up' : 'down';
    transitionLock = 350; // ms — so a held key doesn't instantly walk back out
  });

  // The game usually starts before the walk layer attaches, so the initial
  // room:enter has already fired — place the hero at the start room's spawn.
  if (game.state) {
    const w0 = roomWalk();
    const sp = w0.spawn.default || DEFAULT_SPAWNS.default;
    placeHero(sp[0], sp[1], w0);
  }

  function tryEdgeCommand(command) {
    pendingWalkDir = command;
    const before = game.state.currentRoom;
    game.command(command);
    if (game.state.currentRoom === before) {
      pendingWalkDir = null;
      return false; // blocked exit (troll, chasm...) — hero stays put
    }
    return true;
  }

  /* ---------------- keyboard ---------------- */

  const KEYMAP = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
  };

  window.addEventListener('keydown', (e) => {
    const dir = KEYMAP[e.code];
    if (!dir) return;
    // Typed text keeps priority: while the player is composing a command,
    // Up/Down browse history (browser-ui) and Left/Right move the caret.
    if (document.activeElement === input && input.value !== '') return;
    if (e.code.startsWith('Arrow')) e.preventDefault();
    keys.add(dir);
  });
  window.addEventListener('keyup', (e) => {
    const dir = KEYMAP[e.code];
    if (dir) keys.delete(dir);
  });
  window.addEventListener('blur', () => keys.clear());

  /* ---------------- simulation ---------------- */

  const SPEED_X = 0.32; // screen widths per second at full scale
  const SPEED_Y = 0.18;

  function step(dt) {
    if (!game.state || game.state.status !== 'playing') return;
    if (transitionLock > 0) { transitionLock -= dt * 1000; return; }

    const w = roomWalk();
    let dx = 0;
    let dy = 0;
    if (keys.has('left')) dx -= 1;
    if (keys.has('right')) dx += 1;
    if (keys.has('up')) dy -= 1;
    if (keys.has('down')) dy += 1;

    hero.moving = dx !== 0 || dy !== 0;
    if (!hero.moving) return;

    if (dx < 0) hero.facing = 'left';
    else if (dx > 0) hero.facing = 'right';
    else if (dy < 0) hero.facing = 'up';
    else if (dy > 0) hero.facing = 'down';

    hero.animTime += dt;
    const s = scaleAt(hero.y, w);
    const nx = hero.x + dx * SPEED_X * s * dt;
    const ny = hero.y + dy * SPEED_Y * s * dt;

    // Where did we actually get to? Try the full move, then each axis, so
    // the hero slides along walls. If the hero is somehow standing inside
    // blocked ground (bad spawn, live-edited data), let them walk out
    // rather than trapping them.
    const stuck = !walkableAt(hero.x, hero.y, w);
    let mx = hero.x;
    let my = hero.y;
    if (stuck || walkableAt(nx, ny, w)) { mx = nx; my = ny; }
    else if (walkableAt(nx, hero.y, w)) { mx = nx; }
    else if (walkableAt(hero.x, ny, w)) { my = ny; }
    const blockedNow = mx === hero.x && my === hero.y;

    // Screen-edge exits: crossing the hard edge, or pushing against an
    // unwalkable boundary while already within the edge margin (for walk
    // areas that stop short of the screen edge).
    const edges = w.edges;
    const tryExit = (cmd) => cmd && tryEdgeCommand(cmd);
    if (dx < 0 && edges.left && (nx <= 0.005 || (blockedNow && hero.x <= EDGE_MARGIN))) { if (tryExit(edges.left)) return; }
    if (dx > 0 && edges.right && (nx >= 0.995 || (blockedNow && hero.x >= 1 - EDGE_MARGIN))) { if (tryExit(edges.right)) return; }
    if (dy > 0 && edges.bottom && (ny >= 0.985 || (blockedNow && hero.y >= 1 - EDGE_MARGIN))) { if (tryExit(edges.bottom)) return; }
    if (dy < 0 && edges.top && (ny <= w.horizon + 0.005 || (blockedNow && hero.y <= w.horizon + EDGE_MARGIN))) { if (tryExit(edges.top)) return; }

    // Hotspots (doorways, cave mouths) trigger on the attempted position,
    // so they work even when their ground is not walkable.
    for (const h of w.hotspots) {
      if (h?.rect && h.command && pointInRect(nx, ny, h.rect)) {
        if (tryEdgeCommand(h.command)) return;
      }
    }

    hero.x = Math.min(0.995, Math.max(0.005, mx));
    hero.y = Math.min(0.985, Math.max(0.015, my));
  }

  /* ---------------- rendering ---------------- */

  function fitCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = scene.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    const wpx = Math.round(rect.width * dpr);
    const hpx = Math.round(rect.height * dpr);
    if (canvas.width !== wpx || canvas.height !== hpx) {
      canvas.width = wpx;
      canvas.height = hpx;
    }
    return true;
  }

  // The background is drawn "cover"-fit; overlays cut from it must land on
  // exactly the same pixels, so both share this transform.
  function coverTransform(img) {
    const cw = canvas.width;
    const ch = canvas.height;
    const ir = img.naturalWidth / img.naturalHeight;
    const cr = cw / ch;
    let dw = cw;
    let dh = ch;
    if (ir > cr) dw = ch * ir;
    else dh = cw / ir;
    return { ox: (cw - dw) / 2, oy: (ch - dh) / 2, dw, dh };
  }

  function drawCover(img) {
    const { ox, oy, dw, dh } = coverTransform(img);
    ctx2d.drawImage(img, ox, oy, dw, dh);
  }

  // Maps image-space normalized coords to canvas pixels (identity when the
  // room has no background image).
  let frameT = null;
  function toCanvas(x, y) {
    if (!frameT) return [x * canvas.width, y * canvas.height];
    return [frameT.ox + x * frameT.dw, frameT.oy + y * frameT.dh];
  }
  function frameHeightPx(h) {
    return h * (frameT ? frameT.dh : canvas.height);
  }

  function drawSprite(img, x, y, height, { flip = false, frames = 1, frame = 0 } = {}) {
    if (!ready(img)) return;
    const fw = img.naturalWidth / frames;
    const fh = img.naturalHeight;
    const h = frameHeightPx(height);
    const wpx = h * (fw / fh);
    const [px, py] = toCanvas(x, y);
    ctx2d.save();
    ctx2d.imageSmoothingEnabled = false;
    if (flip) {
      ctx2d.translate(px, py);
      ctx2d.scale(-1, 1);
      ctx2d.drawImage(img, frame * fw, 0, fw, fh, -wpx / 2, -h, wpx, h);
    } else {
      ctx2d.drawImage(img, frame * fw, 0, fw, fh, px - wpx / 2, py - h, wpx, h);
    }
    ctx2d.restore();
  }

  // Overlays anchor to the background's cover transform, not the canvas, so
  // they stay glued to the scenery at any window size.
  function drawOverlay(img, rect, bgTransform) {
    if (!ready(img) || !bgTransform) return;
    const { ox, oy, dw, dh } = bgTransform;
    const x = ox + rect[0] * dw;
    const y = oy + rect[1] * dh;
    ctx2d.save();
    ctx2d.imageSmoothingEnabled = false;
    ctx2d.drawImage(img, x, y, (rect[2] - rect[0]) * dw, (rect[3] - rect[1]) * dh);
    ctx2d.restore();
  }

  function heroSprite() {
    const side = heroDef.side || {};
    if (hero.facing === 'up' && heroImgs.back) return { img: heroImgs.back, frames: 1, frame: 0, flip: false };
    if (hero.facing === 'down' && heroImgs.front) return { img: heroImgs.front, frames: 1, frame: 0, flip: false };
    const frames = side.frames || 1;
    const fps = side.fps || 10;
    const frame = hero.moving ? Math.floor(hero.animTime * fps) % frames : 0;
    return { img: heroImgs.side, frames, frame, flip: hero.facing === 'left' };
  }

  let last = performance.now();
  function tick(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    try { step(dt); }
    catch (e) { warnOnce('step', `simulation error: ${e.message}`); }

    if (!fitCanvas()) { requestAnimationFrame(tick); return; }
    ctx2d.clearRect(0, 0, canvas.width, canvas.height);

    const state = game.state;
    const room = game.rooms.get(state?.currentRoom);
    const gameOver = !state || state.status !== 'playing';
    const dark = room?.def.dark && !game.hasLight();

    ctx2d.fillStyle = '#000';
    ctx2d.fillRect(0, 0, canvas.width, canvas.height);

    if (gameOver) {
      const title = loadImage(game.config.titleImage);
      if (ready(title)) drawCover(title);
      requestAnimationFrame(tick);
      return;
    }
    if (dark) { requestAnimationFrame(tick); return; }

    const bg = room?.def.image ? loadImage(room.def.image) : null;
    frameT = null;
    if (ready(bg)) {
      frameT = coverTransform(bg);
      drawCover(bg);
    }

    // Painter's order: everything standing on the floor sorts by its ground
    // line — NPCs and the hero by their feet, overlays by their baseline.
    const w = roomWalk();
    const actors = [];
    for (const [charId, pos] of Object.entries(w.npcs)) {
      if (state.charLocations[charId] !== room.id) continue;
      const def = spriteDefs[charId];
      if (!def) { warnOnce(`npc:${charId}`, `no sprite configured for NPC "${charId}"`); continue; }
      if (!Array.isArray(pos) || pos.length !== 2) continue;
      actors.push({
        y: pos[1],
        draw: () => drawSprite(loadImage(def.image), pos[0], pos[1], (def.height || 0.3) * scaleAt(pos[1], w)),
      });
    }
    for (const o of w.overlays) {
      if (!o?.image || !Array.isArray(o.rect)) continue;
      actors.push({
        y: o.baseline ?? o.rect[3],
        draw: () => drawOverlay(loadImage(o.image), o.rect, frameT),
      });
    }
    const hs = heroSprite();
    actors.push({
      y: hero.y,
      draw: () => drawSprite(hs.img, hero.x, hero.y, (heroDef.height || 0.32) * scaleAt(hero.y, w), hs),
    });
    actors.sort((a, b) => a.y - b.y);
    for (const a of actors) a.draw();

    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  return { hero };
}
