/**
 * animations.js — all GSAP work lives here.
 *
 * Timing cheatsheet (tweak freely):
 *   HERO_STAGGER   0.12s between hero lines   — tighter = snappier intro
 *   HERO_DURATION  1.0s per line              — the "weight" of the intro
 *   SKILL_STAGGER  0.15s between skill rows   — the cascade feel
 *   REVEAL_START   "top 80%"                  — element top hits 80% down
 *                                               the viewport → animation fires.
 *                                               Use "top 90%" to fire earlier.
 */
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

const HERO_STAGGER = 0.12;
const HERO_DURATION = 1.0;
const SKILL_STAGGER = 0.15;
const REVEAL_START = "top 80%";

export function initAnimations({ reducedMotion = false } = {}) {
  initNavState();

  if (reducedMotion) {
    // Motion off: snap everything visible, skip tweens entirely.
    gsap.set("[data-hero-line], [data-skill], [data-reveal]", {
      opacity: 1,
      y: 0,
      clearProps: "transform",
    });
    return;
  }

  initHeroIntro();
  initSkillsReveal();
  initGenericReveals();
}

/* ---- Hero intro: lines rise + fade in sequence on page load ---- */
function initHeroIntro() {
  gsap.from("[data-hero-line]", {
    opacity: 0,
    y: 40,                      // rise distance in px
    duration: HERO_DURATION,
    stagger: HERO_STAGGER,
    ease: "power3.out",         // fast start, soft landing
    delay: 0.3,                 // small beat so the video has a frame up first
  });
}

/* ---- Skills: staggered fade + slide, re-triggered per row ----
   Each item gets its own ScrollTrigger (rather than one for the list)
   so long lists animate progressively as you scroll, not all at once. */
function initSkillsReveal() {
  gsap.utils.toArray("[data-skill]").forEach((item, i) => {
    gsap.to(item, {
      opacity: 1,
      y: 0,
      duration: 0.9,
      ease: "power3.out",
      delay: (i % 3) * SKILL_STAGGER, // small cascade within a screenful
      scrollTrigger: {
        trigger: item,
        start: REVEAL_START,
        toggleActions: "play none none reverse", // reverse = fades back out
                                                 // when scrolling up past it;
                                                 // use "play none none none"
                                                 // for animate-once
      },
    });
  });
}

/* ---- Generic reveals: anything tagged data-reveal ---- */
function initGenericReveals() {
  gsap.utils.toArray("[data-reveal]").forEach((el) => {
    gsap.to(el, {
      opacity: 1,
      y: 0,
      duration: 0.8,
      ease: "power2.out",
      scrollTrigger: { trigger: el, start: REVEAL_START },
    });
  });
}

/* ---- Nav: gains a blurred background once the hero is scrolled past ---- */
function initNavState() {
  const nav = document.getElementById("site-nav");
  if (!nav) return;
  ScrollTrigger.create({
    start: "top -80",           // 80px of scroll before the switch
    onUpdate: (self) =>
      nav.classList.toggle("is-scrolled", self.scroll() > 80),
  });
}

/**
 * Called by portfolio-grid.js after it injects cards, so new elements
 * get a scroll-in animation and ScrollTrigger recalculates positions.
 */
export function animateCardsIn(cards) {
  gsap.from(cards, {
    opacity: 0,
    y: 30,
    duration: 0.6,
    stagger: 0.06,              // quick ripple across the grid
    ease: "power2.out",
    scrollTrigger: {
      trigger: "#portfolio-grid",
      start: REVEAL_START,
    },
  });
  ScrollTrigger.refresh();
}
