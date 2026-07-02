/**
 * three-scene.js — subtle particle field behind the hero copy.
 *
 * Setup walkthrough:
 *   1. Scene + PerspectiveCamera (fov 60) pulled back to z = 5 so the
 *      particle cloud (spread over an 8×5×4 box) surrounds the camera edge.
 *   2. One Points object: a BufferGeometry with PARTICLE_COUNT random
 *      positions + a PointsMaterial. Additive blending + the CSS
 *      mix-blend-mode:screen on the canvas make particles read as light.
 *   3. Animation loop: slow constant rotation + mouse parallax, both
 *      frame-rate independent (scaled by delta time).
 *
 * Tuning knobs:
 *   PARTICLE_COUNT  600   — density. 2000+ still fine on desktop GPUs.
 *   DRIFT_SPEED     0.02  — rad/s of idle rotation. Keep < 0.05 for "subtle".
 *   PARALLAX        0.3   — how far the cloud leans toward the cursor.
 *   PARALLAX_EASE   2.0   — lerp speed toward the cursor; lower = dreamier.
 *   COLORS                — particle tints, sampled per-vertex.
 */
import * as THREE from "three";

const PARTICLE_COUNT = 600;
const DRIFT_SPEED = 0.02;
const PARALLAX = 0.3;
const PARALLAX_EASE = 2.0;
const COLORS = [0x00f0ff, 0xff2d78, 0x7c5cff]; // cyan / magenta / violet

/* Tiny white radial-gradient texture drawn on a 2D canvas — tints per
   vertex via vertexColors, so one sprite serves all three accent colors. */
function makeGlowSprite() {
  const size = 64;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.45)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

export function initParticleField(canvas) {
  if (!canvas) return;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,        // transparent — CSS gradient + videos show through
    antialias: false,   // points don't benefit; saves fill rate
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // cap for perf
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    60,                                        // fov
    canvas.clientWidth / canvas.clientHeight,  // aspect
    0.1,                                       // near
    50                                         // far
  );
  camera.position.z = 5;

  /* ---- Geometry: random positions + per-vertex accent colors ---- */
  const positions = new Float32Array(PARTICLE_COUNT * 3);
  const colors = new Float32Array(PARTICLE_COUNT * 3);
  const tint = new THREE.Color();

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    positions[i * 3 + 0] = (Math.random() - 0.5) * 8; // x spread
    positions[i * 3 + 1] = (Math.random() - 0.5) * 5; // y spread
    positions[i * 3 + 2] = (Math.random() - 0.5) * 4; // z depth
    tint.setHex(COLORS[Math.floor(Math.random() * COLORS.length)]);
    colors[i * 3 + 0] = tint.r;
    colors[i * 3 + 1] = tint.g;
    colors[i * 3 + 2] = tint.b;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size: 0.06,
    map: makeGlowSprite(),            // soft radial dot — without a map,
                                      // points render as hard squares
    vertexColors: true,
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending, // overlaps glow instead of darkening
    depthWrite: false,                // avoids sorting artifacts with blending
  });

  const points = new THREE.Points(geometry, material);
  scene.add(points);

  /* ---- Mouse parallax (normalized -1..1, eased in the loop) ---- */
  const mouse = { x: 0, y: 0 };
  window.addEventListener("pointermove", (e) => {
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -((e.clientY / window.innerHeight) * 2 - 1);
  });

  /* ---- Resize ---- */
  window.addEventListener("resize", () => {
    const { clientWidth: w, clientHeight: h } = canvas;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  });

  /* ---- Only render while the hero is on screen ---- */
  let visible = true;
  new IntersectionObserver(([entry]) => (visible = entry.isIntersecting), {
    threshold: 0,
  }).observe(canvas);

  /* ---- Loop ---- */
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    if (!visible) return; // skip draw calls when scrolled past the hero

    points.rotation.y += DRIFT_SPEED * dt;

    // Ease the cloud toward the cursor; dt-scaled so speed is fps-independent
    points.rotation.x += (mouse.y * PARALLAX - points.rotation.x) * PARALLAX_EASE * dt;
    points.position.x += (mouse.x * PARALLAX - points.position.x) * PARALLAX_EASE * dt;

    renderer.render(scene, camera);
  });

  // Handle for manual teardown if you ever swap scenes at runtime
  return {
    dispose() {
      renderer.setAnimationLoop(null);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    },
  };
}
