/**
 * portfolio-grid.js — renders the work grid from a data array and wires
 * up: category filters, hover-play video thumbnails, and click-to-expand
 * inline details (with a link out to the case-study template).
 *
 * To add real work: edit PROJECTS below — drop thumbnail loops into
 * assets/videos/ and point `video` at them. Cards whose video files are
 * missing gracefully keep their gradient placeholder.
 */
import gsap from "gsap";
import { animateCardsIn } from "./animations.js";

/* ----------------------------------------------------------------------
   Dummy data — three items per category, replace with real projects.
   `category` must match the data-filter values on the filter buttons.
   ---------------------------------------------------------------------- */
const PROJECTS = [
  // Generative Video ----------------------------------------------------
  {
    id: "neon-districts",
    title: "Neon Districts",
    category: "generative-video",
    categoryLabel: "Gen Video",
    meta: "2026 · MUSIC VIDEO · 3 MIN",
    video: "assets/videos/thumbs/neon-districts.mp4",
    blurb: "A fully AI-generated music video: 400 diffusion shots graded and cut to a synthwave track.",
  },
  {
    id: "latent-flora",
    title: "Latent Flora",
    category: "generative-video",
    categoryLabel: "Gen Video",
    meta: "2025 · INSTALLATION LOOP · 12 MIN",
    video: "assets/videos/thumbs/latent-flora.mp4",
    blurb: "Endless morphing botanical forms trained on herbarium scans, shown on a gallery LED wall.",
  },
  {
    id: "ghost-broadcast",
    title: "Ghost Broadcast",
    category: "generative-video",
    categoryLabel: "Gen Video",
    meta: "2025 · SHORT FILM · 6 MIN",
    video: "assets/videos/thumbs/ghost-broadcast.mp4",
    blurb: "Found-footage aesthetic built entirely from video models — nothing was ever filmed.",
  },

  // Web Animation --------------------------------------------------------
  {
    id: "signal-path",
    title: "Signal Path",
    category: "web-animation",
    categoryLabel: "Web Anim",
    meta: "2026 · PRODUCT SITE · GSAP",
    video: "assets/videos/thumbs/signal-path.mp4",
    blurb: "Scroll-driven product story for a synth plugin — 14 pinned scenes, one continuous timeline.",
  },
  {
    id: "type-in-motion",
    title: "Type in Motion",
    category: "web-animation",
    categoryLabel: "Web Anim",
    meta: "2025 · EXPERIMENT SERIES",
    video: "assets/videos/thumbs/type-in-motion.mp4",
    blurb: "Twelve kinetic-typography sketches exploring variable fonts driven by scroll velocity.",
  },
  {
    id: "orbital-menu",
    title: "Orbital Menu",
    category: "web-animation",
    categoryLabel: "Web Anim",
    meta: "2025 · UI CONCEPT",
    video: "assets/videos/thumbs/orbital-menu.mp4",
    blurb: "A radial navigation concept with physics-based easing, later shipped in a client kiosk.",
  },

  // 3D Design --------------------------------------------------------------
  {
    id: "chrome-garden",
    title: "Chrome Garden",
    category: "3d-design",
    categoryLabel: "3D",
    meta: "2026 · WEBGL SCENE · THREE.JS",
    video: "assets/videos/thumbs/chrome-garden.mp4",
    blurb: "A real-time browsable sculpture garden, procedural chrome plants with custom shaders.",
  },
  {
    id: "microverse",
    title: "Microverse",
    category: "3d-design",
    categoryLabel: "3D",
    meta: "2025 · CONFIGURATOR",
    video: "assets/videos/thumbs/microverse.mp4",
    blurb: "Product configurator rendering 2M+ variant combinations in-browser at 60fps.",
  },
  {
    id: "wire-relic",
    title: "Wire Relic",
    category: "3d-design",
    categoryLabel: "3D",
    meta: "2025 · ART TOY · PRINT + AR",
    video: "assets/videos/thumbs/wire-relic.mp4",
    blurb: "Sculpt-to-print art toy with an AR companion viewer built on WebXR.",
  },

  // AI Audio -----------------------------------------------------------------
  {
    id: "voice-of-the-city",
    title: "Voice of the City",
    category: "ai-audio",
    categoryLabel: "AI Audio",
    meta: "2026 · SOUND INSTALLATION",
    video: "assets/videos/thumbs/voice-of-the-city.mp4",
    blurb: "A neural voice reads live city data as spoken-word poetry, re-scored every hour.",
  },
  {
    id: "infinite-b-sides",
    title: "Infinite B-Sides",
    category: "ai-audio",
    categoryLabel: "AI Audio",
    meta: "2025 · GENERATIVE ALBUM",
    video: "assets/videos/thumbs/infinite-b-sides.mp4",
    blurb: "An album that renders a unique mix per listener from stems and a generative arranger.",
  },
  {
    id: "foley-machine",
    title: "Foley Machine",
    category: "ai-audio",
    categoryLabel: "AI Audio",
    meta: "2025 · TOOL · OPEN SOURCE",
    video: "assets/videos/thumbs/foley-machine.mp4",
    blurb: "Text-to-foley playground used by three indie game studios for prototype sound passes.",
  },
];

/* ---------------------------------------------------------------------- */

export function initPortfolioGrid(grid, { filters } = {}) {
  if (!grid) return;

  grid.innerHTML = PROJECTS.map(cardTemplate).join("");
  const cards = [...grid.querySelectorAll(".card")];

  cards.forEach((card) => {
    wireHoverPlay(card);
    wireExpand(card);
  });

  if (filters) wireFilters(filters, cards, grid);

  animateCardsIn(cards);
}

function cardTemplate(p) {
  return `
    <article class="card" data-category="${p.category}" tabindex="0"
             aria-label="${p.title} — ${p.categoryLabel}">
      <div class="card__media">
        <video class="card__video" muted loop playsinline preload="none">
          <source src="${p.video}" type="video/mp4" />
        </video>
        <span class="card__category">${p.categoryLabel}</span>
      </div>
      <div class="card__body">
        <h3 class="card__title">${p.title}</h3>
        <p class="card__meta">${p.meta}</p>
      </div>
      <div class="card__details">
        <div class="card__details-inner">
          <p>${p.blurb}</p>
          <a class="card__link" href="case-study.html?project=${p.id}"
             onclick="event.stopPropagation()">READ CASE STUDY →</a>
        </div>
      </div>
    </article>`;
}

/* ---- Hover-play: preload + play on enter, pause + rewind on leave.
   play() rejections (autoplay policy, missing placeholder file) are
   swallowed — the gradient placeholder simply stays visible. ---- */
function wireHoverPlay(card) {
  const video = card.querySelector(".card__video");
  if (!video) return;

  card.addEventListener("pointerenter", () => {
    video.play().then(() => card.classList.add("is-playing")).catch(() => {});
  });

  card.addEventListener("pointerleave", () => {
    video.pause();
    video.currentTime = 0;
    card.classList.remove("is-playing");
  });
}

/* ---- Click / Enter toggles the inline details panel. Height is
   animated from 0 → auto with GSAP; only one card open at a time. ---- */
function wireExpand(card) {
  const details = card.querySelector(".card__details");

  const toggle = () => {
    const isOpen = card.classList.contains("is-open");

    // close any other open card first
    document.querySelectorAll(".card.is-open").forEach((other) => {
      if (other === card) return;
      other.classList.remove("is-open");
      gsap.to(other.querySelector(".card__details"), {
        height: 0,
        duration: 0.35,
        ease: "power2.inOut",
      });
    });

    card.classList.toggle("is-open", !isOpen);
    gsap.to(details, {
      height: isOpen ? 0 : "auto",  // GSAP measures "auto" for us
      duration: 0.45,
      ease: "power3.inOut",
    });
  };

  card.addEventListener("click", toggle);
  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
    }
  });
}

/* ---- Category filters: fade the grid out, swap visibility, fade in.
   A display:none swap inside the fade keeps the layout jump hidden. ---- */
function wireFilters(filterBar, cards, grid) {
  filterBar.addEventListener("click", (e) => {
    const btn = e.target.closest(".filter-btn");
    if (!btn || btn.classList.contains("is-active")) return;

    filterBar.querySelector(".is-active")?.classList.remove("is-active");
    btn.classList.add("is-active");
    const filter = btn.dataset.filter;

    gsap.to(grid, {
      opacity: 0,
      y: 10,
      duration: 0.25,
      ease: "power2.in",
      onComplete: () => {
        cards.forEach((card) => {
          card.style.display =
            filter === "all" || card.dataset.category === filter ? "" : "none";
        });
        gsap.to(grid, { opacity: 1, y: 0, duration: 0.35, ease: "power2.out" });
      },
    });
  });
}
