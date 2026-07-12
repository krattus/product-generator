// walk-data.js — the shared contract between the level editor and the walk
// engine: geometry helpers, schema validation, and the loader that applies
// editor-exported data onto a Game.
//
// Shapes (all coordinates normalized 0..1, origin top-left):
//   rect:    [x1, y1, x2, y2]              (any corner order; normalized on use)
//   polygon: [[x,y], [x,y], ...]           (3+ vertices, implicitly closed)
//   A "shape list" (walk.areas, walk.obstacles) may mix rects and polygons.
//
// Room walk block (all fields optional):
//   {
//     horizon: 0.55,            // top of the walkable floor; also scale anchor
//     scaleAtHorizon: 0.45,     // sprite scale multiplier at the horizon
//     areas: [shape, ...],      // walkable region (union). If absent: the
//                               // horizontal band from horizon to the bottom.
//     obstacles: [shape, ...],  // blocked region (subtracted from areas)
//     overlays: [{ image, rect, baseline? }],
//                               // foreground cutouts drawn in the painter's
//                               // sort at `baseline` (default: rect bottom) —
//                               // the hero passes BEHIND them when above
//     npcs: { charId: [x, y] },
//     spawn: { north|south|east|west|in|out|up|down|default: [x, y] },
//     edges: { top|bottom|left|right: 'direction or command' },
//     hotspots: [{ rect, command }],
//   }
// `obstacles` and `npcs` may also be functions of the game ctx (game code
// only — JSON can't carry functions).
//
// Editor export ("world file"):
//   { version: 1, rooms: { roomId: { image?, walk: {...} } } }

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

export function isRect(shape) {
  return Array.isArray(shape) && shape.length === 4 && shape.every((n) => typeof n === 'number');
}

export function isPolygon(shape) {
  return (
    Array.isArray(shape) &&
    shape.length >= 3 &&
    shape.every((p) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number'))
  );
}

/** Normalize a rect so x1<=x2, y1<=y2. */
export function normRect(r) {
  return [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])];
}

export function pointInRect(x, y, r) {
  const [x1, y1, x2, y2] = normRect(r);
  return x >= x1 && x <= x2 && y >= y1 && y <= y2;
}

/** Even-odd rule point-in-polygon. Tolerant of duplicate/collinear vertices. */
export function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInShape(x, y, shape) {
  if (isRect(shape)) return pointInRect(x, y, shape);
  if (isPolygon(shape)) return pointInPolygon(x, y, shape);
  return false;
}

export function pointInAnyShape(x, y, shapes) {
  return Array.isArray(shapes) && shapes.some((s) => pointInShape(x, y, s));
}

export function shapeBounds(shape) {
  if (isRect(shape)) return normRect(shape);
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const [x, y] of shape) {
    x1 = Math.min(x1, x); y1 = Math.min(y1, y);
    x2 = Math.max(x2, x); y2 = Math.max(y2, y);
  }
  return [x1, y1, x2, y2];
}

/**
 * Is (x, y) a legal place to stand?
 * areas present -> inside an area and outside every obstacle;
 * areas absent  -> inside the horizon..0.985 band and outside every obstacle.
 */
export function walkableAt(x, y, walk) {
  if (x < 0 || x > 1 || y < 0 || y > 1) return false;
  const areas = walk.areas;
  if (Array.isArray(areas) && areas.length > 0) {
    if (!pointInAnyShape(x, y, areas)) return false;
  } else {
    const horizon = walk.horizon ?? 0.55;
    if (y < horizon || y > 0.985) return false;
  }
  const obstacles = walk.obstacles;
  if (Array.isArray(obstacles) && pointInAnyShape(x, y, obstacles)) return false;
  return true;
}

/**
 * Nearest walkable point to (x, y), searched on a grid spiral. Returns the
 * input when already walkable; null when the room has no walkable cell at
 * all (a validation error, but the engine must not crash on it).
 */
export function nearestWalkable(x, y, walk, step = 0.02) {
  if (walkableAt(x, y, walk)) return [x, y];
  let best = null;
  let bestD = Infinity;
  for (let gy = step / 2; gy < 1; gy += step) {
    for (let gx = step / 2; gx < 1; gx += step) {
      if (!walkableAt(gx, gy, walk)) continue;
      const d = (gx - x) * (gx - x) + (gy - y) * (gy - y);
      if (d < bestD) { bestD = d; best = [gx, gy]; }
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

const WALK_DIRECTIONS = ['north', 'south', 'east', 'west', 'in', 'out', 'up', 'down'];
const EDGE_KEYS = ['top', 'bottom', 'left', 'right'];
const SPAWN_KEYS = [...WALK_DIRECTIONS, 'default'];

function isPoint(p) {
  return Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number');
}

function inUnit(n) {
  return typeof n === 'number' && n >= 0 && n <= 1.01;
}

function checkShape(shape, where, warnings) {
  if (isRect(shape)) {
    if (!shape.every(inUnit)) warnings.push(`${where}: rect coordinates outside 0..1: [${shape}]`);
    const [x1, y1, x2, y2] = normRect(shape);
    if (x2 - x1 < 0.005 || y2 - y1 < 0.005) warnings.push(`${where}: degenerate rect (near-zero size)`);
    return true;
  }
  if (isPolygon(shape)) {
    if (!shape.every((p) => p.every(inUnit))) warnings.push(`${where}: polygon vertex outside 0..1`);
    if (shape.length < 3) warnings.push(`${where}: polygon needs 3+ vertices`);
    return true;
  }
  warnings.push(`${where}: not a rect [x1,y1,x2,y2] or polygon [[x,y],...]`);
  return false;
}

/**
 * Validate one room's walk block. Returns an array of human-readable
 * warnings (empty = clean). Never throws. `roomId` only labels messages.
 */
export function validateWalk(walk, roomId = 'room') {
  const warnings = [];
  if (walk == null) return warnings;
  if (typeof walk !== 'object') return [`${roomId}: walk block is not an object`];

  if (walk.horizon != null && !inUnit(walk.horizon)) warnings.push(`${roomId}: horizon outside 0..1`);
  if (walk.scaleAtHorizon != null && !(walk.scaleAtHorizon > 0 && walk.scaleAtHorizon <= 1.5)) {
    warnings.push(`${roomId}: scaleAtHorizon should be in (0, 1.5]`);
  }

  for (const [field, shapes] of [['areas', walk.areas], ['obstacles', walk.obstacles]]) {
    if (shapes == null || typeof shapes === 'function') continue;
    if (!Array.isArray(shapes)) { warnings.push(`${roomId}: ${field} is not an array`); continue; }
    shapes.forEach((s, i) => checkShape(s, `${roomId}: ${field}[${i}]`, warnings));
  }

  if (Array.isArray(walk.areas) && walk.areas.length > 0) {
    // The most common editor mistake: a walk area that nothing can stand in.
    if (!nearestWalkable(0.5, 0.8, walk)) warnings.push(`${roomId}: no walkable point exists (areas fully blocked?)`);
  }

  if (walk.overlays != null) {
    if (!Array.isArray(walk.overlays)) warnings.push(`${roomId}: overlays is not an array`);
    else walk.overlays.forEach((o, i) => {
      const where = `${roomId}: overlays[${i}]`;
      if (!o || typeof o !== 'object') { warnings.push(`${where}: not an object`); return; }
      if (typeof o.image !== 'string' || !o.image) warnings.push(`${where}: missing image`);
      if (!isRect(o.rect)) warnings.push(`${where}: missing rect [x1,y1,x2,y2]`);
      if (o.baseline != null && !inUnit(o.baseline)) warnings.push(`${where}: baseline outside 0..1`);
    });
  }

  if (walk.spawn != null && typeof walk.spawn === 'object') {
    for (const [k, p] of Object.entries(walk.spawn)) {
      if (!SPAWN_KEYS.includes(k)) warnings.push(`${roomId}: spawn key "${k}" is not a direction or "default"`);
      if (!isPoint(p)) warnings.push(`${roomId}: spawn.${k} is not [x, y]`);
      else if (!walkableAt(p[0], p[1], walk)) warnings.push(`${roomId}: spawn.${k} [${p}] is not on walkable ground (engine will snap it)`);
    }
  }

  if (walk.edges != null && typeof walk.edges === 'object') {
    for (const [k, v] of Object.entries(walk.edges)) {
      if (!EDGE_KEYS.includes(k)) warnings.push(`${roomId}: edges key "${k}" (use top/bottom/left/right)`);
      if (typeof v !== 'string' || !v) warnings.push(`${roomId}: edges.${k} should be a command string`);
    }
  }

  if (walk.hotspots != null) {
    if (!Array.isArray(walk.hotspots)) warnings.push(`${roomId}: hotspots is not an array`);
    else walk.hotspots.forEach((h, i) => {
      const where = `${roomId}: hotspots[${i}]`;
      if (!h || typeof h !== 'object') { warnings.push(`${where}: not an object`); return; }
      if (!isRect(h.rect)) warnings.push(`${where}: missing rect`);
      if (typeof h.command !== 'string' || !h.command) warnings.push(`${where}: missing command`);
    });
  }

  if (walk.npcs != null && typeof walk.npcs === 'object' && typeof walk.npcs !== 'function') {
    for (const [id, p] of Object.entries(walk.npcs)) {
      if (!isPoint(p)) warnings.push(`${roomId}: npcs.${id} is not [x, y]`);
    }
  }

  return warnings;
}

/** Validate a whole editor export. Returns warnings; never throws. */
export function validateWorld(data) {
  const warnings = [];
  if (!data || typeof data !== 'object') return ['world: not an object'];
  if (data.version != null && data.version !== 1) warnings.push(`world: unknown version ${data.version}`);
  if (!data.rooms || typeof data.rooms !== 'object') return [...warnings, 'world: missing rooms map'];
  for (const [roomId, room] of Object.entries(data.rooms)) {
    if (!room || typeof room !== 'object') { warnings.push(`${roomId}: not an object`); continue; }
    warnings.push(...validateWalk(room.walk, roomId));
  }
  return warnings;
}

/* ------------------------------------------------------------------ */
/* Loader                                                              */
/* ------------------------------------------------------------------ */

/**
 * Apply an editor world file onto a Game. Field-level merge into each
 * room's existing walk block; existing FUNCTION values always win (JSON
 * cannot express state-dependent obstacles/npcs, so game code keeps them).
 * Rooms in the data that the game doesn't define are reported, not created.
 * Returns { applied: [roomId...], warnings: [...] }.
 */
export function applyWalkData(game, data) {
  const warnings = validateWorld(data);
  const applied = [];
  if (!data?.rooms) return { applied, warnings };

  for (const [roomId, roomData] of Object.entries(data.rooms)) {
    const room = game.rooms.get(roomId);
    if (!room) { warnings.push(`${roomId}: game has no such room — skipped`); continue; }
    if (roomData.image) room.def.image = roomData.image;
    if (roomData.walk) {
      const existing = room.def.walk || {};
      const merged = { ...existing };
      for (const [k, v] of Object.entries(roomData.walk)) {
        if (typeof existing[k] === 'function') {
          warnings.push(`${roomId}: walk.${k} is a function in game code — JSON value ignored`);
          continue;
        }
        merged[k] = v;
      }
      room.def.walk = merged;
    }
    applied.push(roomId);
  }
  return { applied, warnings };
}
