import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, buildGame, trackErrors, openGame, WIN_PATH } from './browser.mjs';

const url = buildGame();
const browser = await launch();
test.after(() => browser.close());

async function fresh() {
  const page = await browser.newPage({ viewport: { width: 1000, height: 950 } });
  const errors = trackErrors(page);
  const g = await openGame(page, url);
  return { page, errors, g };
}

test('the game can be won at full score by typing, with no JS errors', async () => {
  const { page, errors, g } = await fresh();
  for (const c of WIN_PATH) await g.type(c);
  const out = await g.output();
  assert.match(out, /\*\*\* YOU HAVE WON \*\*\*/);
  assert.match(out, /Score: 100 of 100/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('rooms change by walking off the screen edges; the troll gate holds', async () => {
  const { page, g } = await fresh();
  await g.walk('ArrowDown', 2600);
  assert.equal(await g.room(), 'meadow');
  await g.walk('ArrowRight', 3200);
  assert.equal(await g.room(), 'forest');
  await g.walk('ArrowLeft', 3200);
  assert.equal(await g.room(), 'meadow');
  await g.walk('ArrowDown', 2600);
  assert.equal(await g.room(), 'river');
  await g.walk('ArrowRight', 3500);
  assert.equal(await g.room(), 'river', 'unpaid troll blocks the bridge');
  await page.close();
});

test('arrows walk even while the text input is focused and empty', async () => {
  const { page, g } = await fresh();
  await g.type('look'); // input stays focused, history now non-empty
  assert.ok(await page.evaluate(() => document.activeElement === document.querySelector('.adv-input')));
  const before = await g.hero();
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(400);
  await page.keyboard.up('ArrowUp');
  const after = await g.hero();
  assert.notEqual(before.y, after.y, 'hero should walk, not recall history');
  assert.equal(await page.inputValue('.adv-input'), '', 'input must stay empty');

  // Shift+Up is the history shortcut and must not walk
  const h2 = await g.hero();
  await page.keyboard.press('Shift+ArrowUp');
  await page.waitForTimeout(150);
  assert.equal(await page.inputValue('.adv-input'), 'look');
  assert.deepEqual(await g.hero(), h2);
  await page.fill('.adv-input', '');

  // WASD must not move the hero while typing (those letters start commands)
  const h3 = await g.hero();
  await page.keyboard.press('KeyD');
  await page.waitForTimeout(150);
  assert.equal(await page.inputValue('.adv-input'), 'd');
  assert.deepEqual(await g.hero(), h3);
  await page.close();
});

test('a blocked exit refuses once per push, not once per frame', async () => {
  const { page, g } = await fresh();
  for (const c of WIN_PATH.slice(0, 22)) await g.type(c); // ends with "in": inside the cave, rope untied
  assert.equal(await g.room(), 'cave');
  await page.waitForTimeout(400);
  const turns = await g.turns();
  const lines = await g.lines();
  await g.setHero(0.25, 0.535);
  await g.walk('ArrowUp', 1500);
  assert.equal(await g.turns(), turns + 1, 'exactly one game turn');
  assert.equal(await g.lines() - lines, 1, 'exactly one refusal message');
  // releasing and pushing again is allowed to retry
  await g.walk('ArrowUp', 400);
  assert.equal(await g.turns(), turns + 2);
  await page.close();
});

test('walking is frozen during a conversation', async () => {
  const { page, g } = await fresh();
  for (const c of ['south', 'south', 'talk to troll']) await g.type(c);
  assert.ok(await page.evaluate(() => !!window.__advGame._dialogue));
  const lines = await g.lines();
  const before = await g.hero();
  await g.walk('ArrowUp', 800);
  assert.deepEqual(await g.hero(), before);
  assert.equal(await g.lines(), lines);
  await page.close();
});

test('restoring a save moves the hero to the restored room', async () => {
  const { page, g } = await fresh();
  await g.type('north');
  await g.type('save');
  await g.type('south');
  assert.equal(await g.room(), 'courtyard');
  await g.setHero(0.9, 0.9);
  await g.type('load');
  assert.equal(await g.room(), 'throne');
  const h = await g.hero();
  assert.ok(h.x < 0.8, `hero should be re-placed on the throne room spawn, got x=${h.x}`);
  await page.close();
});
