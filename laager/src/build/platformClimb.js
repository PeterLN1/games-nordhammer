import { platformSurfaceAt } from "./buildMode.js";

const LADDER_CLIMB_RADIUS = 0.75; // how close to a ladder's foot counts as "climbing it"
const LADDER_TO_PLATFORM_RADIUS = 2.3; // must be >= buildMode's ladder search radius

function findPlatformNear(x, z, placed, radius) {
  let best = null, bestDist = Infinity;
  for (const p of placed) {
    if (p.structure.id !== "platform") continue;
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < radius && d < bestDist) { bestDist = d; best = p; }
  }
  return best;
}

// Tracks whether the player has "climbed" up: walking past a ladder
// attached to a platform puts you up, and you stay up for as long as
// you're over *any* platform tile's footprint — not just the specific
// tile the ladder happened to be next to. A floor built from several
// tiles only has a ladder on one of them, so tracking a single fixed
// tile (and its own circular radius) dropped the player through the
// moment they stepped onto a neighboring tile of the very same floor.
// platformSurfaceAt already tests every platform's real (rotated) square
// footprint and picks the highest one, so this now just asks it directly
// instead of re-deriving a cruder approximation.
export function createPlatformClimb() {
  let elevated = false;

  return {
    // call once per frame with the player's live (x, z); returns the
    // surface height to stand on, or null if the ground applies instead
    update(playerX, playerZ, placed) {
      if (elevated) {
        const y = platformSurfaceAt(playerX, playerZ, placed);
        if (y == null) elevated = false; // walked off every tile's footprint — back to the ground
        return y;
      }
      for (const p of placed) {
        if (p.structure.id !== "ladder") continue;
        if (Math.hypot(p.x - playerX, p.z - playerZ) >= LADDER_CLIMB_RADIUS) continue;
        const platform = findPlatformNear(p.x, p.z, placed, LADDER_TO_PLATFORM_RADIUS);
        if (!platform) continue;
        elevated = true;
        return platformSurfaceAt(playerX, playerZ, placed) ?? platform.y + platform.structure.height;
      }
      return null;
    },
  };
}
