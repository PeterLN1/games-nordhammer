import { isUnderAnyRoof } from "../build/roofCoverage.js";

// How close a built fire has to be to count as warmth — bigger than the
// fire's own light radius (see world/lighting.js's PointLight distance)
// since standing just outside the glow but still next to the flames is
// obviously still "by the fire".
const FIRE_WARMTH_RADIUS = 3.0;

function isNearFire(placed, point, radius = FIRE_WARMTH_RADIUS) {
  return placed.some((p) => p.structure.id === "fire" && Math.hypot(p.x - point.x, p.z - point.z) < radius);
}

// Whether the player has any protection from cold right now: a roof
// overhead (see build/roofCoverage.js) or a built fire nearby. Doesn't
// require walls too — a roof-only lean-to already keeps the worst of the
// cold off in this first pass, matching "utan ordentligt tak så regnar
// det in" (walls matter once actual weather/rain exists, not yet).
export function isSheltered(placed, point) {
  return isUnderAnyRoof(placed, point) || isNearFire(placed, point);
}
