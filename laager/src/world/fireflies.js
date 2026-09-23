import * as THREE from "three";
import { mulberry32 } from "./poissonScatter.js";

const FIREFLY_COUNT = 180;
const SPAWN_RADIUS = 40; // tighter than the full forest radius — a scatter near the player reads better than a thin haze over the whole map
const FADE_IN_START = 0.45; // dusk progress (see atmosphere.js) at which they start appearing
const FADE_IN_END = 0.8;

// A soft radial glow drawn once to a small canvas at runtime — cheaper and
// far nicer-looking than a hard square THREE.Points dot, and there's no
// texture file to ship since it's generated, not loaded.
function buildGlowTexture() {
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.4, "rgba(255,255,255,0.55)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

// A single THREE.Points cloud — cheap enough that positions are just
// recomputed on the CPU each frame (a few hundred sines is nothing next to
// the render cost of the scene itself). Invisible and idle until dusk sets
// in, matching the flashlight becoming relevant at the same point.
export function buildFireflies(scene, palette, seed) {
  const rng = mulberry32(seed);
  const bases = [];
  const positions = new Float32Array(FIREFLY_COUNT * 3);
  for (let i = 0; i < FIREFLY_COUNT; i++) {
    const angle = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * SPAWN_RADIUS;
    const base = {
      x: Math.cos(angle) * r,
      z: Math.sin(angle) * r,
      y: 0.3 + rng() * 1.1,
      phase: rng() * Math.PI * 2,
      speed: 0.4 + rng() * 0.5,
    };
    bases.push(base);
    positions[i * 3] = base.x;
    positions[i * 3 + 1] = base.y;
    positions[i * 3 + 2] = base.z;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: palette.fireflyGlow,
    size: 0.22,
    map: buildGlowTexture(),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  scene.add(points);

  const posAttr = geo.attributes.position;

  return {
    update(elapsed, duskT) {
      const visible = THREE.MathUtils.smoothstep(duskT, FADE_IN_START, FADE_IN_END);
      mat.opacity = visible * 0.85;
      points.visible = visible > 0.01;
      if (!points.visible) return;

      for (let i = 0; i < FIREFLY_COUNT; i++) {
        const b = bases[i];
        posAttr.setXYZ(
          i,
          b.x + Math.sin(elapsed * b.speed + b.phase) * 1.4,
          b.y + Math.sin(elapsed * b.speed * 1.7 + b.phase) * 0.35,
          b.z + Math.cos(elapsed * b.speed + b.phase * 1.3) * 1.4
        );
      }
      posAttr.needsUpdate = true;
    },
  };
}
