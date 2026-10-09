/*
 * Tree cover from ESA WorldCover 2021 (10 m, satellite-derived, CC BY 4.0).
 * One 3°×3° tile (S30E153) covers the whole Northern Rivers study area.
 * Class 10 = "Tree cover".
 */
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fromFile } from 'geotiff';

const TILE = 'ESA_WorldCover_10m_2021_v200_S30E153_Map.tif';
const URL_ = `https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/${TILE}`;

export async function loadTile(cacheDir) {
  const file = join(cacheDir, 'worldcover_S30E153.tif');
  if (!existsSync(file)) {
    console.log('  … downloading ESA WorldCover tile (15 MB)');
    const res = await fetch(URL_);
    if (!res.ok) throw new Error(`WorldCover HTTP ${res.status}`);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
  }
  const tiff = await fromFile(file);
  return tiff.getImage();
}

// Returns { bbox:[s,w,n,e], w, h, data:Uint8Array } snapped to the raster's pixel grid.
export async function canopyGrid(image, bbox) {
  const [ox, oy] = image.getOrigin(); // top-left lon, lat
  const [rx, ry] = image.getResolution(); // ry is negative
  const col0 = Math.floor((bbox[1] - ox) / rx);
  const col1 = Math.ceil((bbox[3] - ox) / rx);
  const row0 = Math.floor((bbox[2] - oy) / ry);
  const row1 = Math.ceil((bbox[0] - oy) / ry);
  const [band] = await image.readRasters({ window: [col0, row0, col1, row1] });
  const w = col1 - col0, h = row1 - row0;
  const data = new Uint8Array(w * h);
  for (let i = 0; i < data.length; i++) data[i] = band[i] === 10 ? 1 : 0;
  return {
    bbox: [oy + row1 * ry, ox + col0 * rx, oy + row0 * ry, ox + col1 * rx],
    w, h, data,
  };
}

// Halve resolution for shipping to the browser (a cell is "tree" if 2+ of its 4 pixels are).
export function downsample2(grid) {
  const w = Math.floor(grid.w / 2), h = Math.floor(grid.h / 2);
  const data = new Uint8Array(w * h);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    const i = 2 * r * grid.w + 2 * c;
    const n = grid.data[i] + grid.data[i + 1] + grid.data[i + grid.w] + grid.data[i + grid.w + 1];
    data[r * w + c] = n >= 2 ? 1 : 0;
  }
  const [s, wst, n] = grid.bbox;
  const e = wst + ((grid.bbox[3] - wst) * (2 * w)) / grid.w;
  const s2 = n - ((n - s) * (2 * h)) / grid.h;
  return { bbox: [s2, wst, n, e], w, h, data };
}
