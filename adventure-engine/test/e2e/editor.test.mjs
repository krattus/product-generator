import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, buildEditor, trackErrors } from './browser.mjs';

const url = buildEditor();
const browser = await launch();
test.after(() => browser.close());

async function open() {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = trackErrors(page);
  await page.goto(url);
  await page.waitForSelector('#canvas');
  await page.waitForTimeout(600);
  const box = await page.locator('#canvas').boundingBox();
  const at = (nx, ny) => ({ x: box.x + nx * box.width, y: box.y + ny * box.height });
  const drag = async (a, b) => {
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(60);
  };
  const walk = () => page.evaluate(() => JSON.parse(JSON.stringify(
    window.__editor.state.world.rooms[window.__editor.state.roomId].walk,
  )));
  return { page, errors, at, drag, walk };
}

test('embedded world loads every room with its walk data', async () => {
  const { page, errors } = await open();
  const info = await page.evaluate(() => {
    const s = window.__editor.state;
    return { rooms: Object.keys(s.world.rooms).length, current: s.roomId, riverObstacles: s.world.rooms.river.walk.obstacles.length };
  });
  assert.equal(info.rooms, 9);
  assert.equal(info.current, 'courtyard');
  assert.equal(info.riverObstacles, 3, 'water x2 + the troll in his starting position');
  assert.deepEqual(errors, []);
  await page.close();
});

test('draw, resize, undo and export round-trip', async () => {
  const { page, at, drag, walk } = await open();

  // walk-area polygon
  await page.click('[data-tool=area]');
  for (const [x, y] of [[0.05, 0.6], [0.95, 0.6], [0.95, 0.95], [0.05, 0.95]]) {
    const p = at(x, y);
    await page.mouse.click(p.x, p.y);
  }
  await page.keyboard.press('Enter');
  assert.equal((await walk()).areas.length, 1);

  // resize the fountain obstacle by its bottom-right handle
  await page.click('[data-tool=select]');
  await page.evaluate(() => { window.__editor.state.selection = { kind: 'obstacle', index: 0 }; window.__editor.refresh(); });
  const ob = (await walk()).obstacles[0];
  await drag(at(ob[2], ob[3]), at(ob[2] + 0.1, ob[3] + 0.04));
  const resized = (await walk()).obstacles[0];
  assert.ok(resized[2] > ob[2] + 0.08 && resized[3] > ob[3] + 0.03, `resized to ${resized}`);

  // undo snapshots must not carry background images
  const snapshotHasImage = await page.evaluate(() => window.__editor.state.undo.at(-1).includes('data:image/jpeg'));
  assert.equal(snapshotHasImage, false);
  await page.click('#btn-undo');
  assert.deepEqual((await walk()).obstacles[0], ob);
  const stillHasBg = await page.evaluate(() => !!window.__editor.state.world.rooms.courtyard.imageDataURI);
  assert.ok(stillHasBg, 'undo keeps the background image');

  // export carries everything the engine needs
  const world = await page.evaluate(() => window.__editor.exportWorld());
  assert.equal(world.version, 1);
  assert.equal(world.rooms.courtyard.walk.areas.length, 1);
  assert.ok(world.rooms.courtyard.walk.overlays[0].image.startsWith('data:image/png'));
  await page.close();
});

test('magic wand selection becomes an overlay with a baseline', async () => {
  const { page, at, walk } = await open();
  await page.click('[data-tool=wand]');
  const p = at(0.5, 0.78);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(200);
  const before = (await walk()).overlays.length;
  await page.click('#btn-make-overlay');
  const after = await walk();
  assert.equal(after.overlays.length, before + 1);
  const o = after.overlays.at(-1);
  assert.ok(o.image.startsWith('data:image/png'));
  assert.equal(o.baseline, o.rect[3]);
  await page.close();
});
