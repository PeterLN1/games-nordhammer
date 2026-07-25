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

// Tracks whether the player has "climbed" onto a platform: you only get
// up there by walking past a ladder attached to it, and you stay up while
// you're within its footprint — walking off (from any side) puts you back
// on the ground, same as walking off any ledge.
// A ladder always plants its foot exactly on a platform's inscribed-circle
// edge (see findLadderAnchor in buildMode.js) — right on the boundary this
// module tests against — so a strict "on the platform" radius check would
// flicker on and off at the one spot a player actually needs it to hold.
// This margin keeps the foot of the ladder reliably inside the gate.
const ON_PLATFORM_MARGIN = 0.08;

export function createPlatformClimb() {
  let current = null; // the platform {x, z, y, structure} entry, or null

  return {
    // call once per frame with the player's live (x, z); returns the
    // surface height to stand on, or null if the ground applies instead
    update(playerX, playerZ, placed) {
      if (current) {
        const stillOn = Math.hypot(current.x - playerX, current.z - playerZ) < current.structure.width / 2 + ON_PLATFORM_MARGIN;
        if (!stillOn) current = null;
      }
      if (!current) {
        for (const p of placed) {
          if (p.structure.id !== "ladder") continue;
          if (Math.hypot(p.x - playerX, p.z - playerZ) >= LADDER_CLIMB_RADIUS) continue;
          const platform = findPlatformNear(p.x, p.z, placed, LADDER_TO_PLATFORM_RADIUS);
          if (platform && Math.hypot(platform.x - playerX, platform.z - playerZ) < platform.structure.width / 2 + ON_PLATFORM_MARGIN) {
            current = platform;
            break;
          }
        }
      }
      return current ? current.y + current.structure.height : null;
    },
  };
}
