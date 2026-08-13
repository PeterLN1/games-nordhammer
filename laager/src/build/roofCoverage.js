// Whether a point sits under a roof structure's own sloped footprint —
// shared by cutaway.js (fades the roof so the camera can see the player
// underneath) and world/shelter.js (a roof overhead also counts as cover
// from cold/rain). Kept as one function so "under a roof" means exactly
// the same thing in both places instead of two math implementations
// slowly drifting apart.
export const ROOF_COVER_MARGIN = 2.0; // how far *past the roof's own footprint* still counts as "under it"

// Closest point on the roof's own ridge-to-eave centerline to `point`,
// clamped to its real span — which varies a lot (a ridge/gable roof over
// a big room reaches far further than one tile) — then just a distance
// check against that closest point.
export function roofCovers(p, point, margin = ROOF_COVER_MARGIN) {
  if (!p.structure.spansToOpposite) return false;
  const outward = { x: Math.sin(p.rotY), z: Math.cos(p.rotY) };
  const span = p.buildArgs?.span ?? p.structure.width;
  const dx = point.x - p.x, dz = point.z - p.z;
  const t = Math.max(0, Math.min(span, dx * outward.x + dz * outward.z));
  const coverX = p.x + outward.x * t, coverZ = p.z + outward.z * t;
  return Math.hypot(coverX - point.x, coverZ - point.z) < margin;
}

export function isUnderAnyRoof(placed, point, margin = ROOF_COVER_MARGIN) {
  return placed.some((p) => roofCovers(p, point, margin));
}
