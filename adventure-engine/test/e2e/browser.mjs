// Shared helpers for the browser (end-to-end) tests.
//
// Needs `playwright-core` (npm i -D) and a Chromium. Set CHROMIUM_PATH to a
// browser binary, or install one with `npx playwright install chromium`.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const engineDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  try {
    const found = execSync(
      'ls -d /opt/pw-browsers/chromium-*/chrome-linux/headless_shell /opt/pw-browsers/chromium-*/chrome-linux/chrome 2>/dev/null | head -1',
    ).toString().trim();
    return found || undefined;
  } catch {
    return undefined; // playwright-core will look in its own browser cache
  }
}

export async function launch() {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: chromiumPath(), args: ['--no-sandbox'] });
  return browser;
}

/** Builds a single-file bundle of a game into a temp dir; returns its file:// URL. */
export function buildGame(gameDir = 'games/crystal-crown') {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'adv-')), 'game.html');
  execSync(`node build-single-file.mjs ${gameDir} ${out}`, { cwd: engineDir, stdio: 'pipe' });
  return `file://${out}`;
}

/** Builds the self-contained editor (with a game's rooms embedded). */
export function buildEditor(gameDir = 'games/crystal-crown') {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'adv-ed-')), 'editor.html');
  execSync(`node build-editor.mjs ${gameDir} ${out}`, { cwd: engineDir, stdio: 'pipe' });
  return `file://${out}`;
}

/** Collects page errors + console errors so tests can assert on them. */
export function trackErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return errors;
}

export async function openGame(page, url) {
  await page.goto(url);
  await page.waitForSelector('.adv-input');
  await page.waitForTimeout(400);
  return {
    type: async (cmd) => {
      await page.fill('.adv-input', cmd);
      await page.press('.adv-input', 'Enter');
      await page.waitForTimeout(25);
    },
    // hold a movement key with the text input blurred (keyboard walking)
    walk: async (key, ms) => {
      await page.evaluate(() => document.activeElement?.blur());
      await page.keyboard.down(key);
      await page.waitForTimeout(ms);
      await page.keyboard.up(key);
      await page.waitForTimeout(100);
    },
    room: () => page.evaluate(() => window.__advGame.state.currentRoom),
    turns: () => page.evaluate(() => window.__advGame.state.turns),
    hero: () => page.evaluate(() => ({ x: window.__advWalk.hero.x, y: window.__advWalk.hero.y })),
    setHero: (x, y) => page.evaluate(([x, y]) => { window.__advWalk.hero.x = x; window.__advWalk.hero.y = y; }, [x, y]),
    lines: () => page.evaluate(() => document.querySelectorAll('.adv-line').length),
    output: () => page.textContent('.adv-output'),
  };
}

// The commands that win The Crystal Crown, from the courtyard.
export const WIN_PATH = [
  'north', 'talk to king', '2', 'open chest', 'take rope', 'take cake', 'south', 'search fountain',
  'south', 'east', 'take mushrooms', 'north', 'talk to hermit', '2', 'talk to hermit', '2', 'south', 'west',
  'south', 'give coin to troll', 'east', 'in', 'use rope on stalagmite', 'north', 'take crown',
  'south', 'out', 'west', 'north', 'north', 'north', 'give crown to king',
];
