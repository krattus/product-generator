/**
 * video-mask.js — hero hover-reveal.
 *
 * Approach: CSS mask-image (radial-gradient) on the TOP video, driven by
 * three custom properties (--mask-x, --mask-y, --mask-size). The browser
 * composites the mask on the GPU, so this is much cheaper than redrawing
 * video frames into a <canvas> every rAF — and it degrades to "no hole"
 * anywhere masks aren't supported.
 *
 * If you later want irregular/textured reveals (brush strokes, noise),
 * swap the gradient for an SVG/PNG in CSS:
 *   mask-image: url(assets/brush.svg);  and keep the same JS to move it
 * via mask-position instead of --mask-x/y.
 *
 * Feel knobs:
 *   MASK_RADIUS   240px — size of the fully-open hole
 *   OPEN_DURATION 0.6s  — hole grow speed on pointer enter
 *   FOLLOW_LAG    0.45s — how far the hole trails the cursor.
 *                         Lower = glued to cursor, higher = liquid drift.
 */
import gsap from "gsap";

const MASK_RADIUS = 240;
const OPEN_DURATION = 0.6;
const FOLLOW_LAG = 0.45;

export function initVideoMask(container, { maskedVideo } = {}) {
  if (!container || !maskedVideo) return;

  // Bail if the browser supports neither standard nor -webkit- masks:
  // leaving --mask-size at 0 simply means the top video never opens.
  const supportsMask =
    CSS.supports("mask-image", "radial-gradient(black, transparent)") ||
    CSS.supports("-webkit-mask-image", "radial-gradient(black, transparent)");
  if (!supportsMask) return;

  // Normalize the CSS defaults (%) to px so every subsequent tween uses
  // one unit — GSAP can't interpolate between 50% and 300px.
  gsap.set(maskedVideo, { "--mask-x": "0px", "--mask-y": "0px" });

  // quickTo = pre-built tweens, cheap enough to call on every pointermove.
  const moveX = gsap.quickTo(maskedVideo, "--mask-x", {
    duration: FOLLOW_LAG,
    ease: "power3.out",
  });
  const moveY = gsap.quickTo(maskedVideo, "--mask-y", {
    duration: FOLLOW_LAG,
    ease: "power3.out",
  });

  container.addEventListener("pointermove", (e) => {
    const rect = container.getBoundingClientRect();
    moveX(e.clientX - rect.left);
    moveY(e.clientY - rect.top);
  });

  container.addEventListener("pointerenter", (e) => {
    // Teleport the (still size-0) hole to the entry point so it grows
    // from under the cursor instead of sliding in from its last position.
    const rect = container.getBoundingClientRect();
    gsap.set(maskedVideo, {
      "--mask-x": `${e.clientX - rect.left}px`,
      "--mask-y": `${e.clientY - rect.top}px`,
    });
    gsap.to(maskedVideo, {
      "--mask-size": `${MASK_RADIUS}px`,
      duration: OPEN_DURATION,
      ease: "power3.out",
      overwrite: "auto",
    });
  });

  container.addEventListener("pointerleave", () => {
    gsap.to(maskedVideo, {
      "--mask-size": "0px",
      duration: OPEN_DURATION * 0.75, // close slightly faster than open
      ease: "power3.in",
      overwrite: "auto",
    });
  });
}
