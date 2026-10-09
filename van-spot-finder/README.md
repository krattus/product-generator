# Van Spot Finder

Finds the best places to park a van you live in around the Northern Rivers, NSW:

- **Murwillumbah** (Marwell Bar), **Burringbar** (Boring Bar), **Mullumbimby** (Malimbimbi), **Byron Bay**

Every car park, rest area, lookout, picnic area and campground in OpenStreetMap is scored 0–100 on:

| Score | How it's worked out |
|---|---|
| **Shade** | Tree cover in 32 sample points around the spot (8 compass directions × 6/14/24/36 m), from ESA WorldCover 10 m satellite tree cover plus OSM woods, tree rows and single trees. |
| **Afternoon shade** | Trees on the west / north-west / south-west side, the side the hot afternoon sun comes from. |
| **Solar** | How open the **northern** sky is. At 28°S the sun arcs through the north, so trees there block panels; east/west count a little for morning and evening. A spot under canopy is heavily penalised. |
| **Quiet** | Buildings within 150 m / 500 m, distance to houses (residential land), to towns and villages, to main roads, and car-park size. Caravan parks and campgrounds get a "people around" discount. |

Spots that do well on both afternoon shade and solar get a **Shade + sun** badge: you sit in the shade while the panels charge in the sun.

Each spot also gets a **sleeping** rating: campground / free camping likely OK (State Forest) / check signs (Tweed Shire public land) / fines likely (Byron Shire public land) / no camping (National Park, Nature Reserve, mapped "no overnight"). This is guidance from map data and council information, not legal advice. Always check the signs.

The app also shows a 7-day solar forecast (Open-Meteo) and estimates **kWh per day for your panel wattage** at each spot.

## Run it

```bash
cd van-spot-finder
npm start            # http://localhost:8080
```

The served version uses live map tiles, has a satellite layer for checking shade by eye, refreshes the forecast, and has a **Scan this map view** button to score spots anywhere in Australia live from OpenStreetMap.

### Offline single file

```bash
npm install          # geotiff + pngjs, only needed for fetching
npm run build        # → dist/van-spot-finder.html
```

`dist/van-spot-finder.html` is one ~2 MB file with all the data inside. It draws its own map from saved roads, water and tree cover, so it works on a phone with no reception once it's loaded. Map scans and forecast refreshes need a connection.

### Refresh the data

```bash
npm install
npm run fetch                          # all areas
node scripts/fetch-spots.js byron      # one area
node scripts/fetch-spots.js --cache    # re-score without re-downloading OSM data
```

Behind an HTTP proxy, prefix with `NODE_USE_ENV_PROXY=1`. Add more areas by appending to `AREAS` in `engine.js`. The bundled tree-cover tile (S30E153) covers about 27–30°S, 153–156°E. Areas outside it need another WorldCover tile name in `scripts/canopy.js`.

## Files

- `engine.js`: Overpass query, scoring and legality rules. Runs in the browser and Node.
- `app.js`, `index.html`, `styles.css`: the map UI (Leaflet).
- `scripts/fetch-spots.js`: downloads OSM data, tree cover and forecasts, then writes `data/van-data.js`.
- `scripts/canopy.js`: reads ESA WorldCover tree cover.
- `scripts/build-standalone.js`: bundles everything into one offline HTML file.

## Limits

- Satellite tree cover is from 2021 at 10 m resolution. Single street trees and recent clearing are missed.
- OSM building coverage is patchy in rural areas, so "quiet" can be too optimistic on farmland.
- Hills and terrain shading are not modelled.
- Rules change. Byron Shire has a long history of fining people sleeping in vehicles. Tweed Shire bans 11pm–5am parking at signed coastal car parks. State forests allow free camping for up to 4 weeks unless signs say otherwise.

Data: © OpenStreetMap contributors (ODbL) · ESA WorldCover 2021 (CC BY 4.0) · Open-Meteo forecasts (CC BY 4.0).
