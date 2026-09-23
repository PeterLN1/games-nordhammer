// Deterministic dart-throwing point scatter within a circular area, so the
// forest generates the same layout for a given seed (the node test checks
// spacing against this) while still looking organically random in-game.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// exclusions: [{x, z, radius}] — no point is placed within `radius` of these
// (used to keep the spawn point, landmarks, and the exit clearing free of
// trees). Stops once `maxPoints` is reached or the attempt budget runs out —
// at moderate densities the budget is never the limiting factor.
export function scatterForest({ seed, radius, minDist, maxPoints, exclusions = [] }) {
  const rng = mulberry32(seed);
  const points = [];
  const maxAttempts = maxPoints * 30;
  let attempts = 0;

  while (points.length < maxPoints && attempts < maxAttempts) {
    attempts++;
    const angle = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * radius; // sqrt for uniform area density, not uniform radius
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;

    let ok = true;
    for (const ex of exclusions) {
      if (Math.hypot(x - ex.x, z - ex.z) < ex.radius) { ok = false; break; }
    }
    if (ok) {
      for (const p of points) {
        if (Math.hypot(x - p.x, z - p.z) < minDist) { ok = false; break; }
      }
    }
    if (!ok) continue;

    points.push({
      x, z,
      rot: rng() * Math.PI * 2,
      scale: 0.75 + rng() * 0.6,
    });
  }
  return points;
}
