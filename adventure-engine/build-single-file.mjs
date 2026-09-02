#!/usr/bin/env node
// Bundles the engine, browser UI, a game, and its art into ONE self-contained
// HTML file (art inlined as data URIs) — handy for publishing anywhere that
// takes a single page.
//
//   node build-single-file.mjs [gameDir] [outFile]
//   node build-single-file.mjs games/crystal-crown crystal-crown.html

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const gameDir = path.resolve(here, process.argv[2] || 'games/crystal-crown');
const outFile = path.resolve(process.argv[3] || 'game-bundle.html');

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };

const sources = [
  'src/parser.js',
  'src/entities.js',
  'src/dialogue.js',
  'src/engine.js',
  'src/walk-data.js',
  'ui/browser-ui.js',
  'ui/walk-ui.js',
].map((f) => path.join(here, f));
sources.push(path.join(gameDir, 'game.js'));

let js = sources
  .map((f) => {
    const src = fs.readFileSync(f, 'utf8')
      .replace(/^import .*$/gm, '')
      .replace(/^export \{[^}]*\};?\s*$/gm, '')
      .replace(/^export /gm, '');
    return `/* ==== ${path.relative(here, f)} ==== */\n${src}`;
  })
  .join('\n\n');

// Level-editor export next to the game file? Apply it at startup (art it
// references gets inlined below along with everything else).
const walkDataFile = path.join(gameDir, 'walk-data.json');
if (fs.existsSync(walkDataFile)) {
  const json = JSON.stringify(JSON.parse(fs.readFileSync(walkDataFile, 'utf8')));
  // art refs become single-quoted so the inliner below picks them up
  js += `\n/* ==== walk-data.json (level editor) ==== */\napplyWalkData(game, ${json.replace(/"((?:art|assets|images)\/[^"]+)"/g, "'$1'")});`;
  console.log('applied walk-data.json from the game directory');
}

// Inline every art asset referenced as '<relative path>' in the game source.
const artRefs = [...new Set(js.match(/'(?:art|assets|images)\/[^']+'/g) || [])];
for (const ref of artRefs) {
  const rel = ref.slice(1, -1);
  const file = path.join(gameDir, rel);
  if (!fs.existsSync(file)) {
    console.warn(`warning: ${rel} referenced but not found in ${gameDir} — skipped`);
    continue;
  }
  const mime = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const dataUri = `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
  js = js.split(ref).join(`'${dataUri}'`);
}

// Title from the game config, if present.
// Page title from the game's own config (not the engine's doc comments —
// those mention an example title too). Shouty EGA-era titles get title-cased.
const gameSrc = fs.readFileSync(path.join(gameDir, 'game.js'), 'utf8');
const rawTitle = (gameSrc.match(/title:\s*'([^']+)'/) || [, 'Adventure'])[1];
const title = rawTitle === rawTitle.toUpperCase()
  ? rawTitle.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
  : rawTitle;

const css = fs.readFileSync(path.join(here, 'ui/style.css'), 'utf8');

const html = `<title>${title}</title>
<style>
${css}
/* Single-file extras: CRT atmosphere */
.adv-root { position: relative; }
.adv-root::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: repeating-linear-gradient(
    to bottom,
    rgba(255, 255, 255, 0.025) 0px,
    rgba(255, 255, 255, 0.025) 1px,
    transparent 1px,
    transparent 3px
  );
}
.adv-room-name, .adv-line.adv-title { text-shadow: 0 0 8px rgba(95, 215, 255, 0.35); }
.adv-death { text-shadow: 0 0 8px rgba(255, 95, 95, 0.45); }
.adv-win { text-shadow: 0 0 8px rgba(95, 255, 135, 0.45); }
@media (prefers-reduced-motion: no-preference) {
  .adv-prompt { animation: adv-blink 1.2s steps(1) infinite; }
  @keyframes adv-blink { 50% { opacity: 0.35; } }
}
</style>
<div id="game"></div>
<script type="module">
${js}
createBrowserUI(game, document.getElementById('game'));
window.__advWalk = attachWalkLayer(game, document.getElementById('game'));
window.__advGame = game; // console/debug handle
</script>
`;

fs.writeFileSync(outFile, html);
console.log(`wrote ${outFile} (${(html.length / 1024 / 1024).toFixed(2)} MB, ${artRefs.length} art assets inlined)`);
