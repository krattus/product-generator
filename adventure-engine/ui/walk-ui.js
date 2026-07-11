// walk-ui.js — King's Quest-style walkabout layer for the browser UI.
//
// Turns the scene panel into a live canvas: an animated hero you steer with
// the arrow keys / WASD, NPC sprites standing in the rooms, perspective
// scaling, and room transitions by walking off the screen edges. The text
// parser keeps working exactly as before — this is Sierra's classic
// walk-and-type interface.
//
//   import { createBrowserUI } from './browser-ui.js';
//   import { attachWalkLayer } from './walk-ui.js';
//   const ui = createBrowserUI(game, root);
//   attachWalkLayer(game, root);
//
// Authoring — game config:
//   sprites: {
//     hero: {
//       side:  { image: 'art/hero-walk.png', frames: 8, fps: 10 },  // walk cycle, facing right
//       front: { image: 'art/hero-front.png' },
//       back:  { image: 'art/hero-back.png' },
//       height: 0.34,          // hero height as a fraction of scene height (at the bottom edge)
//     },
//     king: { image: "art/npc-king.png", height: 0.32 },   (any art/ path works)
//   }
//
// Authoring — per-room, all coordinates normalized 0..1:
//   walk: {
//     horizon: 0.55,                  // top of the walkable floor
//     scaleAtHorizon: 0.45,           // sprite scale multiplier at the horizon
//     obstacles: [[x1, y1, x2, y2]],  // rectangles the hero cannot enter
//     npcs: { king: [0.5, 0.68] },    // characterId -> standing position
//     spawn: { south: [0.5, 0.94] },  // entry-direction -> spawn point (has sane defaults)
//     edges: { top: 'north' },        // screen edge -> direction (defaults from room exits)
//     hotspots: [{ rect: [x1,y1,x2,y2], command: 'in' }],  // walk-in triggers
//   }

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
  function loadImage(path) {
    if (!path) return null;
    if (cache.has(path)) return cache.get(path);
    const img = new Image();
    img.src = path.startsWith('data:') ? path : (game.config.assetBase || '') + path;
    cache.set(path, img);
    return img;
  }

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
  let currentRoomId = null;
  let pendingWalkDir = null;   // direction we sent to the engine by walking off an edge
  let transitionLock = 0;      // brief input lock after a room change

  function roomWalk() {
    const room = game.rooms.get(game.state?.currentRoom);
    const w = room?.def.walk || {};
    // obstacles/npcs may be functions of ctx, so rooms can react to game
    // state (the troll steps aside once paid).
    const resolve = (v) => (typeof v === 'function' ? v(game.ctx()) : v);
    return {
      horizon: w.horizon ?? 0.55,
      scaleAtHorizon: w.scaleAtHorizon ?? 0.45,
      obstacles: resolve(w.obstacles) || [],
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
    const t = Math.min(1, Math.max(0, (y - w.horizon) / (1 - w.horizon)));
    return w.scaleAtHorizon + (1 - w.scaleAtHorizon) * t;
  }

  function inRect(x, y, r) {
    return x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3];
  }

  function blocked(x, y, w) {
    if (y < w.horizon || y > 0.985) return true;
    return w.obstacles.some((r) => inRect(x, y, r));
  }

  /* ---------------- room transitions ---------------- */

  game.on('room:enter', (_ctx, { from }) => {
    const dir = from || pendingWalkDir;
    pendingWalkDir = null;
    const w = roomWalk();
    const entered = dir ? OPPOSITE[dir] || 'default' : 'default';
    const spawn = w.spawn[entered] || DEFAULT_SPAWNS[entered] || DEFAULT_SPAWNS.default;
    hero.x = spawn[0];
    hero.y = Math.max(spawn[1], w.horizon + 0.01);
    hero.facing = dir === 'west' ? 'left' : dir === 'east' ? 'right' : dir === 'north' || dir === 'in' || dir === 'up' ? 'up' : 'down';
    transitionLock = 350; // ms — so a held key doesn't instantly walk back out
  });

  // The game usually starts before the walk layer attaches, so the initial
  // room:enter has already fired — place the hero at the start room's spawn.
  if (game.state) {
    const w0 = roomWalk();
    const sp = w0.spawn.default || DEFAULT_SPAWNS.default;
    hero.x = sp[0];
    hero.y = Math.max(sp[1], w0.horizon + 0.01);
  }

  function tryEdgeCommand(command) {
    pendingWalkDir = command;
    const before = game.state.currentRoom;
    game.command(command);
    if (game.state.currentRoom === before) {
      pendingWalkDir = null;
      return false; // blocked exit (troll, chasm...) — caller nudges the hero back
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
    let nx = hero.x + dx * SPEED_X * s * dt;
    let ny = hero.y + dy * SPEED_Y * s * dt;

    // Screen-edge exits.
    const edges = w.edges;
    if (nx <= 0.005 && edges.left) { if (tryEdgeCommand(edges.left)) return; nx = 0.02; }
    if (nx >= 0.995 && edges.right) { if (tryEdgeCommand(edges.right)) return; nx = 0.98; }
    if (ny >= 0.985 && edges.bottom) { if (tryEdgeCommand(edges.bottom)) return; ny = 0.97; }
    if (ny <= w.horizon + 0.005 && edges.top) { if (tryEdgeCommand(edges.top)) return; ny = w.horizon + 0.02; }

    // Hotspots (doorways, cave mouths).
    for (const h of w.hotspots) {
      if (inRect(nx, ny, h.rect)) {
        if (tryEdgeCommand(h.command)) return;
        nx = hero.x; ny = hero.y;
      }
    }

    // Obstacles: try full move, then each axis, so the hero slides along
    // walls. If the hero is somehow standing inside an obstacle (bad spawn,
    // edited room data), let them walk out rather than trapping them.
    const stuck = blocked(hero.x, hero.y, w);
    if (stuck || !blocked(nx, ny, w)) { hero.x = nx; hero.y = ny; }
    else if (!blocked(nx, hero.y, w)) { hero.x = nx; }
    else if (!blocked(hero.x, ny, w)) { hero.y = ny; }

    hero.x = Math.min(0.995, Math.max(0.005, hero.x));
    hero.y = Math.min(0.985, Math.max(w.horizon + 0.005, hero.y));
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

  function drawCover(img) {
    const cw = canvas.width;
    const ch = canvas.height;
    const ir = img.naturalWidth / img.naturalHeight;
    const cr = cw / ch;
    let dw = cw;
    let dh = ch;
    if (ir > cr) dw = ch * ir;
    else dh = cw / ir;
    ctx2d.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
  }

  function drawSprite(img, x, y, height, { flip = false, frames = 1, frame = 0 } = {}) {
    if (!img || !img.complete || !img.naturalWidth) return;
    const fw = img.naturalWidth / frames;
    const fh = img.naturalHeight;
    const h = height * canvas.height;
    const wpx = h * (fw / fh);
    const px = x * canvas.width;
    const py = y * canvas.height;
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
    step(dt);

    if (!fitCanvas()) { requestAnimationFrame(tick); return; }
    ctx2d.clearRect(0, 0, canvas.width, canvas.height);

    const state = game.state;
    const room = game.rooms.get(state?.currentRoom);
    const gameOver = !state || state.status !== 'playing';
    const dark = room?.def.dark && !game.hasLight();

    if (gameOver) {
      const title = loadImage(game.config.titleImage);
      ctx2d.fillStyle = '#000';
      ctx2d.fillRect(0, 0, canvas.width, canvas.height);
      if (title && title.complete && title.naturalWidth) drawCover(title);
      requestAnimationFrame(tick);
      return;
    }

    if (dark) {
      ctx2d.fillStyle = '#000';
      ctx2d.fillRect(0, 0, canvas.width, canvas.height);
      requestAnimationFrame(tick);
      return;
    }

    const bg = room?.def.image ? loadImage(room.def.image) : null;
    ctx2d.fillStyle = '#000';
    ctx2d.fillRect(0, 0, canvas.width, canvas.height);
    if (bg && bg.complete && bg.naturalWidth) drawCover(bg);

    // Painter's order: everything standing on the floor sorts by feet-y.
    const w = roomWalk();
    const actors = [];
    for (const [charId, pos] of Object.entries(w.npcs)) {
      if (state.charLocations[charId] !== room.id) continue;
      const def = spriteDefs[charId];
      if (!def) continue;
      actors.push({
        y: pos[1],
        draw: () => drawSprite(loadImage(def.image), pos[0], pos[1], (def.height || 0.3) * scaleAt(pos[1], w)),
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
