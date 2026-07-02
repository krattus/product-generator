/**
 * main.js — entry point.
 * Wires the four feature modules together and gates the expensive ones
 * (Three.js) behind capability checks so the CSS gradient fallback is
 * what low-bandwidth / reduced-motion visitors get.
 */
import { initAnimations } from "./animations.js";
import { initVideoMask } from "./video-mask.js";
import { initPortfolioGrid } from "./portfolio-grid.js";

// Modules loaded fine — hand hidden-until-revealed elements over to GSAP
document.documentElement.classList.remove("no-js");

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Portfolio cards first — they add DOM that animations may observe later.
initPortfolioGrid(document.getElementById("portfolio-grid"), {
  filters: document.getElementById("portfolio-filters"),
});

initAnimations({ reducedMotion: prefersReducedMotion });

if (!prefersReducedMotion) {
  initVideoMask(document.getElementById("hero-media"), {
    maskedVideo: document.getElementById("hero-video-top"),
  });
}

/**
 * Three.js particle field — deferred and conditional:
 *  - skipped on reduced motion / Save-Data / narrow screens (phones get
 *    the CSS gradient, which costs nothing)
 *  - dynamic import() so three.module.js (~600 kB) is only fetched when
 *    we actually intend to render it
 *  - waits for `load` so it never competes with the hero videos
 */
const saveData = navigator.connection?.saveData === true;
const smallScreen = window.matchMedia("(max-width: 768px)").matches;

if (!prefersReducedMotion && !saveData && !smallScreen) {
  window.addEventListener(
    "load",
    () => {
      import("./three-scene.js")
        .then(({ initParticleField }) =>
          initParticleField(document.getElementById("hero-particles"))
        )
        .catch((err) => console.warn("[three-scene] skipped:", err));
    },
    { once: true }
  );
}
