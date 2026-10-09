#!/usr/bin/env node
/*
 * Bundles the app + saved data into ONE html file (dist/van-spot-finder.html) that works offline:
 * no map tiles (draws its own map from the saved OSM roads, water and satellite tree cover),
 * no live Overpass/forecast calls. Good for phones with bad reception, or sharing as a single file.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFile(join(root, p), 'utf8');
const LEAFLET = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4';

const [html, css, engine, data, app] = await Promise.all([
  read('index.html'), read('styles.css'), read('engine.js'), read('data/van-data.js'), read('app.js'),
]);
let leafletCss;
try {
  leafletCss = await read('.cache/leaflet.min.css');
} catch {
  const r = await fetch(`${LEAFLET}/leaflet.min.css`);
  if (!r.ok) throw new Error(`leaflet.css HTTP ${r.status}`);
  leafletCss = await r.text();
  await mkdir(join(root, '.cache'), { recursive: true });
  await writeFile(join(root, '.cache/leaflet.min.css'), leafletCss);
}
const markup = html.split('<!--APP-->')[1].split('<!--/APP-->')[0];
const fonts = html.match(/<link rel="stylesheet" href="https:\/\/fonts[^>]+>/)[0];
const safe = (js) => js.replace(/<\/(script)/gi, '<\\/$1');

const out = `<title>Van Spot Finder</title>
<meta name="description" content="Shady, sunny and quiet overnight van spots around Murwillumbah, Burringbar, Mullumbimby and Byron Bay">
${fonts}
<style>
${leafletCss}
${css}
</style>
${markup.trim()}
<script src="${LEAFLET}/leaflet.js"></script>
<script>window.VAN_STANDALONE = true;</script>
<script>
${safe(engine)}
</script>
<script>
${safe(data)}
</script>
<script>
${safe(app)}
</script>
`;
await mkdir(join(root, 'dist'), { recursive: true });
await writeFile(join(root, 'dist/van-spot-finder.html'), out);
console.log(`✔ dist/van-spot-finder.html (${(out.length / 1024).toFixed(0)} KB)`);
