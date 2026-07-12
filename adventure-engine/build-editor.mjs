#!/usr/bin/env node
// Bundles the level editor into ONE self-contained HTML file — no server
// needed. Optionally embeds a game's rooms (backgrounds as data URIs) as a
// starter world so the editor opens ready to edit.
//
//   node build-editor.mjs [gameDir|none] [outFile]
//   node build-editor.mjs games/crystal-crown editor.html

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const gameArg = process.argv[2] || 'games/crystal-crown';
const outFile = path.resolve(process.argv[3] || 'editor-bundle.html');

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const dataUri = (file) =>
  `data:${MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'};base64,${fs.readFileSync(file).toString('base64')}`;

/* ---- optional embedded starter world from a game ---- */
let embed = null;
if (gameArg !== 'none') {
  const gameDir = path.resolve(here, gameArg);
  const { game } = await import(path.join(gameDir, 'game.js'));
  // Function-valued fields (state-dependent obstacles/NPCs) are resolved
  // with a "fresh game" ctx so the editor sees their starting shape.
  const freshCtx = { hasFlag: () => false, itemAt: () => 'nowhere', hasItem: () => false };
  const resolve = (v) => {
    if (typeof v !== 'function') return v;
    try { return v(freshCtx); } catch { return undefined; }
  };
  embed = { version: 1, rooms: {} };
  for (const [id, room] of game.rooms) {
    const entry = {};
    if (room.def.image) {
      const file = path.join(gameDir, room.def.image);
      if (fs.existsSync(file)) entry.image = dataUri(file);
    }
    if (room.def.walk) {
      const w = {};
      for (const [k, v] of Object.entries(room.def.walk)) {
        const r = resolve(v);
        if (r !== undefined) w[k] = r;
      }
      // overlay images -> data URIs so they render without the repo
      if (Array.isArray(w.overlays)) {
        w.overlays = w.overlays.map((o) => {
          const file = path.join(gameDir, o.image || '');
          return o.image && !o.image.startsWith('data:') && fs.existsSync(file)
            ? { ...o, image: dataUri(file) }
            : o;
        });
      }
      entry.walk = JSON.parse(JSON.stringify(w));
    }
    embed.rooms[id] = entry;
  }
}

/* ---- assemble the page ---- */
let html = fs.readFileSync(path.join(here, 'editor/index.html'), 'utf8');
const css = fs.readFileSync(path.join(here, 'editor/editor.css'), 'utf8');

const walkData = fs.readFileSync(path.join(here, 'src/walk-data.js'), 'utf8')
  .replace(/^import .*$/gm, '')
  .replace(/^export /gm, '');
const editorJs = fs.readFileSync(path.join(here, 'editor/editor.js'), 'utf8')
  .replace(/^import \{[\s\S]*?\} from '\.\.\/src\/walk-data\.js';/m, '')
  .replace(/^import .*$/gm, '');

html = html.replace('<link rel="stylesheet" href="./editor.css" />', `<style>\n${css}\n</style>`);
html = html.replace(
  '<script type="module" src="./editor.js"></script>',
  `${embed ? `<script>window.__EMBED_WORLD = ${JSON.stringify(embed)};</script>\n` : ''}` +
  `<script type="module">\n/* ==== src/walk-data.js ==== */\n${walkData}\n/* ==== editor/editor.js ==== */\n${editorJs}\n</script>`,
);
// strip the doc header comment's server instructions (not applicable here)
html = html.replace(/<!--[\s\S]*?-->/, '<!-- Self-contained level editor build. AI segmentation needs network; the magic wand works offline. -->');

fs.writeFileSync(outFile, html);
console.log(`wrote ${outFile} (${(html.length / 1024 / 1024).toFixed(2)} MB${embed ? `, ${Object.keys(embed.rooms).length} rooms embedded` : ''})`);
