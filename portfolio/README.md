# Portfolio — vanilla HTML/CSS/JS scaffolding

Dark cyberpunk portfolio: GSAP animations, Three.js particle field,
hover-mask hero videos. No frameworks, no build step — ES modules load
straight in the browser via an import map (GSAP and Three.js come from
the jsDelivr CDN).

## Run it

ES modules don't work over `file://`, so serve the folder:

```bash
cd portfolio
npx serve .            # or: python3 -m http.server 8000
```

Then open http://localhost:3000 (or :8000).

## Structure

```
index.html              # hero, nav, skills, portfolio grid, contact
case-study.html         # single-project template (hero video, tools, results)
css/
  variables.css         # ALL design tokens — retheme here
  main.css              # layout + components + responsive rules
js/
  main.js               # entry — wires modules, gates Three.js by capability
  animations.js         # GSAP: hero intro, ScrollTrigger reveals, nav state
  video-mask.js         # hero hover reveal (CSS mask driven by pointer)
  three-scene.js        # particle field (deferred, desktop-only by default)
  portfolio-grid.js     # card data + render + filters + hover-play + expand
assets/videos/          # placeholder paths — see the README inside
```

## Customizing

- **Colors/spacing/fonts** — everything is a CSS variable in
  `css/variables.css`.
- **Animation feel** — the timing constants at the top of
  `js/animations.js` and `js/video-mask.js` are commented with what each
  one changes.
- **Particles** — density/speed/colors are constants at the top of
  `js/three-scene.js`. Delete the `import()` block in `main.js` to drop
  Three.js entirely; the CSS gradient remains.
- **Projects** — edit the `PROJECTS` array in `js/portfolio-grid.js`;
  cards, filters and case-study links follow automatically.
