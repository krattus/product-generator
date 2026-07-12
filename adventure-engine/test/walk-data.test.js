import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isRect, isPolygon, normRect, pointInRect, pointInPolygon, pointInShape,
  shapeBounds, walkableAt, nearestWalkable, validateWalk, validateWorld,
  applyWalkData,
} from '../src/walk-data.js';

test('shape type detection', () => {
  assert.ok(isRect([0, 0, 1, 1]));
  assert.ok(!isRect([0, 0, 1]));
  assert.ok(!isRect([[0, 0], [1, 1], [0, 1]]));
  assert.ok(isPolygon([[0, 0], [1, 0], [0.5, 1]]));
  assert.ok(!isPolygon([[0, 0], [1, 0]]));
  assert.ok(!isPolygon([0, 0, 1, 1]));
});

test('rects normalize regardless of corner order', () => {
  assert.deepEqual(normRect([0.8, 0.9, 0.2, 0.1]), [0.2, 0.1, 0.8, 0.9]);
  assert.ok(pointInRect(0.5, 0.5, [0.8, 0.9, 0.2, 0.1]));
});

test('point in polygon: convex, concave, and boundary-ish cases', () => {
  const tri = [[0, 0], [1, 0], [0.5, 1]];
  assert.ok(pointInPolygon(0.5, 0.4, tri));
  assert.ok(!pointInPolygon(0.05, 0.9, tri));
  // concave "L"
  const L = [[0, 0], [1, 0], [1, 0.4], [0.4, 0.4], [0.4, 1], [0, 1]];
  assert.ok(pointInPolygon(0.2, 0.8, L));
  assert.ok(!pointInPolygon(0.8, 0.8, L)); // inside the notch
  assert.ok(pointInShape(0.8, 0.2, L));
});

test('shapeBounds covers both kinds', () => {
  assert.deepEqual(shapeBounds([0.6, 0.7, 0.2, 0.3]), [0.2, 0.3, 0.6, 0.7]);
  assert.deepEqual(shapeBounds([[0.1, 0.5], [0.9, 0.2], [0.4, 0.8]]), [0.1, 0.2, 0.9, 0.8]);
});

test('walkableAt: horizon band fallback when no areas', () => {
  const walk = { horizon: 0.5, obstacles: [[0.4, 0.6, 0.6, 0.8]] };
  assert.ok(walkableAt(0.2, 0.7, walk));
  assert.ok(!walkableAt(0.2, 0.4, walk));       // above horizon
  assert.ok(!walkableAt(0.5, 0.7, walk));       // in obstacle
  assert.ok(!walkableAt(0.5, 0.999, walk));     // below the bottom clamp
  assert.ok(!walkableAt(-0.1, 0.7, walk));      // out of frame
});

test('walkableAt: polygon areas replace the band', () => {
  const walk = { areas: [[[0.1, 0.5], [0.9, 0.5], [0.9, 0.9], [0.1, 0.9]]] };
  assert.ok(walkableAt(0.5, 0.7, walk));
  assert.ok(!walkableAt(0.05, 0.7, walk));      // outside area but inside the old band
  // mixed shape list: rect area also accepted
  const walk2 = { areas: [[0.1, 0.5, 0.9, 0.9]] };
  assert.ok(walkableAt(0.5, 0.7, walk2));
});

test('nearestWalkable finds an escape and handles the impossible', () => {
  const walk = { areas: [[0.1, 0.5, 0.9, 0.9]] };
  assert.deepEqual(nearestWalkable(0.5, 0.7, walk), [0.5, 0.7]); // already fine
  const snapped = nearestWalkable(0.5, 0.1, walk);               // way above
  assert.ok(snapped && snapped[1] >= 0.5 && snapped[1] <= 0.9);
  // fully blocked room -> null, not a crash
  const dead = { areas: [[0.1, 0.5, 0.9, 0.9]], obstacles: [[0, 0, 1, 1]] };
  assert.equal(nearestWalkable(0.5, 0.7, dead), null);
});

test('validateWalk flags the classic mistakes', () => {
  assert.deepEqual(validateWalk(null), []);
  assert.deepEqual(validateWalk({ horizon: 0.5 }), []);

  const w = validateWalk({
    horizon: 2,
    areas: [[0.1, 0.1, 0.100001, 0.100001]],       // degenerate
    obstacles: 'nope',
    overlays: [{ rect: [0, 0, 0.5] }],              // bad rect + no image
    spawn: { norht: [0.5, 0.5], south: [5, 5] },    // typo key + off-canvas point
    edges: { middle: 'north', top: '' },
    hotspots: [{ rect: [0, 0, 0.1, 0.1] }],         // no command
  }, 'r');
  const text = w.join('\n');
  assert.match(text, /horizon outside/);
  assert.match(text, /degenerate rect/);
  assert.match(text, /obstacles is not an array/);
  assert.match(text, /missing image/);
  assert.match(text, /missing rect/);
  assert.match(text, /"norht"/);
  assert.match(text, /edges key "middle"/);
  assert.match(text, /edges.top should be a command/);
  assert.match(text, /hotspots\[0\]: missing command/);
});

test('validateWalk warns on unreachable spawn (snappable, not fatal)', () => {
  const w = validateWalk({ areas: [[0.1, 0.5, 0.9, 0.9]], spawn: { south: [0.5, 0.2] } }, 'r');
  assert.match(w.join('\n'), /spawn.south .* not on walkable ground/);
});

test('validateWorld handles garbage without throwing', () => {
  assert.ok(validateWorld(null).length > 0);
  assert.ok(validateWorld({}).some((w) => /missing rooms/.test(w)));
  assert.deepEqual(validateWorld({ version: 1, rooms: {} }), []);
});

test('applyWalkData merges, respects functions, reports unknown rooms', () => {
  const fnObstacles = () => [[0, 0, 1, 1]];
  const fakeGame = {
    rooms: new Map([
      ['a', { def: { walk: { horizon: 0.5, obstacles: fnObstacles } } }],
      ['b', { def: {} }],
    ]),
  };
  const data = {
    version: 1,
    rooms: {
      a: { walk: { horizon: 0.6, obstacles: [[0.1, 0.1, 0.2, 0.2]], spawn: { default: [0.5, 0.8] } } },
      b: { image: 'art/b.jpg', walk: { areas: [[0.1, 0.5, 0.9, 0.9]] } },
      ghost: { walk: {} },
    },
  };
  const { applied, warnings } = applyWalkData(fakeGame, data);
  assert.deepEqual(applied, ['a', 'b']);
  const a = fakeGame.rooms.get('a').def.walk;
  assert.equal(a.horizon, 0.6);                       // JSON wins on plain values
  assert.equal(a.obstacles, fnObstacles);             // function survives
  assert.deepEqual(a.spawn, { default: [0.5, 0.8] }); // new fields merge in
  assert.equal(fakeGame.rooms.get('b').def.image, 'art/b.jpg');
  assert.match(warnings.join('\n'), /ghost: game has no such room/);
  assert.match(warnings.join('\n'), /walk.obstacles is a function/);
});
