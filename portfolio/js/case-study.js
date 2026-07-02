/**
 * case-study.js — lightweight entry for the case-study template.
 * Hero lines animate on load; body sections reveal on scroll.
 *
 * The ?project= query param is parsed below. Right now it only logs —
 * if you keep a single template file, fetch a projects.json here and
 * fill in title/video/copy per project instead of duplicating HTML.
 */
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

document.documentElement.classList.remove("no-js");

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

if (reducedMotion) {
  gsap.set("[data-case-line], [data-reveal]", { opacity: 1, y: 0 });
} else {
  // Hero: category line then title, rising over 1s each, 0.15s apart
  gsap.from("[data-case-line]", {
    opacity: 0,
    y: 30,
    duration: 1,
    stagger: 0.15,
    ease: "power3.out",
    delay: 0.2,
  });

  // Body sections fade up as they enter the lower fifth of the viewport
  gsap.utils.toArray("[data-reveal]").forEach((el) => {
    gsap.to(el, {
      opacity: 1,
      y: 0,
      duration: 0.8,
      ease: "power2.out",
      scrollTrigger: { trigger: el, start: "top 80%" },
    });
  });
}

// Hook for data-driven case studies (see comment at top)
const projectId = new URLSearchParams(location.search).get("project");
if (projectId) console.info(`[case-study] viewing project: ${projectId}`);
