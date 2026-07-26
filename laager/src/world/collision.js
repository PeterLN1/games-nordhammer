import { forward } from "../build/buildMode.js";

const PLAYER_RADIUS = 0.3;
const WALL_HALF_THICKNESS = 0.14;

// How close in height counts as "the same floor". Without this, a wall
// built up on a platform (its recorded y sits at the platform's surface,
// often 1.3+ above the ground) still blocked ground-level movement at
// that (x,z) even though nothing is actually there at ground height —
// which read as getting stuck on a post for no visible reason, since the
// post itself never collides but a wall floating above it did.
const FLOOR_TOLERANCE = 0.5;

// Only the bigger scattered rocks/trees block movement (scale ranges
// 0.75-1.35, see core/utils.scatter) — every small sapling/pebble being
// solid would turn the whole clearing into a maze.
const BIG_OBSTACLE_SCALE = 1.05;

// Closest point on a wall/door's centerline segment to (x,z), clamped to
// the segment's actual span — this is how a long thin wall collides
// like a capsule instead of a single circle at its center.
function closestOnSegment(x, z, p) {
  const half = p.structure.width / 2 - 0.05;
  const dir = forward(p.rotY);
  const dx = x - p.x, dz = z - p.z;
  const t = Math.max(-half, Math.min(half, dx * dir.x + dz * dir.z));
  return { x: p.x + dir.x * t, z: p.z + dir.z * t };
}

// Built walls/doors, plus the bigger natural rocks/trees, block the
// player's ground movement — everything else (posts, platforms, roofs,
// small scenery) stays walkable/passable, and an open door is treated as
// no obstacle at all regardless of its visual swing angle. Obstacles are
// only solid when they're roughly at the same height the player is
// currently standing at (see FLOOR_TOLERANCE) — a wall up on a platform
// shouldn't block someone walking underneath it on the ground, and vice
// versa once the player has climbed up.
export function createCollision({ trees, rocks, buildMode, terrainHeight }) {
  const bigTrees = trees.filter((t) => t.scale > BIG_OBSTACLE_SCALE);
  const bigRocks = rocks.filter((r) => r.scale > BIG_OBSTACLE_SCALE);

  function blocked(x, z, y) {
    for (const t of bigTrees) {
      if (Math.abs(y - terrainHeight(t.x, t.z)) > FLOOR_TOLERANCE) continue;
      if (Math.hypot(x - t.x, z - t.z) < 0.3 * t.scale + PLAYER_RADIUS) return true;
    }
    for (const r of bigRocks) {
      if (Math.abs(y - terrainHeight(r.x, r.z)) > FLOOR_TOLERANCE) continue;
      if (Math.hypot(x - r.x, z - r.z) < 0.4 * r.scale + PLAYER_RADIUS) return true;
    }
    for (const p of buildMode.placed) {
      if (p.structure.snapMode !== "edge") continue; // only walls/doors — not posts, roofs, platforms
      if (p.structure.isDoor && p.open) continue;
      if (Math.abs(y - p.y) > FLOOR_TOLERANCE) continue;
      const c = closestOnSegment(x, z, p);
      if (Math.hypot(x - c.x, z - c.z) < WALL_HALF_THICKNESS + PLAYER_RADIUS) return true;
    }
    return false;
  }

  // Pushes (x,z) directly away from any wall it's currently overlapping,
  // by the exact penetration depth. Near a corner where two wall capsules'
  // rounded ends overlap, trying each axis *independently* (see resolve()
  // below) can find both the X-only and Z-only attempts blocked forever
  // — neither one alone escapes, even though the player isn't sealed in —
  // which read as the player getting permanently wedged against a post/
  // wall corner with nothing visibly stopping them. Running this before
  // every move guarantees the starting position is never inside a wall,
  // so there's always at least a small step available to slide out along.
  function depenetrate(x, z, y) {
    for (let iter = 0; iter < 4; iter++) {
      let pushed = false;
      for (const p of buildMode.placed) {
        if (p.structure.snapMode !== "edge") continue;
        if (p.structure.isDoor && p.open) continue;
        if (Math.abs(y - p.y) > FLOOR_TOLERANCE) continue;
        const c = closestOnSegment(x, z, p);
        const dx = x - c.x, dz = x === c.x && z === c.z ? 1e-4 : z - c.z;
        const dist = Math.hypot(dx, dz);
        const minDist = WALL_HALF_THICKNESS + PLAYER_RADIUS;
        if (dist < minDist) {
          const push = minDist - dist + 0.002;
          x += (dx / dist) * push;
          z += (dz / dist) * push;
          pushed = true;
        }
      }
      if (!pushed) break;
    }
    return { x, z };
  }

  return {
    // Exposed for pathfinding.js: a yes/no obstacle query at an arbitrary
    // point, using the exact same rule set real movement collides
    // against, so a route it finds is actually walkable rather than
    // subtly disagreeing with what resolve() will do frame to frame.
    blocked,

    // Resolves a movement step. Tries the full diagonal move first — for
    // a wall that isn't aligned with the world X/Z axes (any rotated
    // room), that's often clear even when neither pure-X nor pure-Z
    // alone would be, since those two only ever slide along the world
    // axes, not along the wall's own angle. Falls back to each axis
    // independently so brushing past a wall/tree still slides along it
    // instead of freezing the instant either axis alone would clip
    // something. `y` is the player's *current* standing height, used
    // only to decide which floor's obstacles apply.
    resolve(fromX, fromZ, toX, toZ, y) {
      const clear = depenetrate(fromX, fromZ, y);
      if (!blocked(toX, toZ, y)) return { x: toX, z: toZ };
      let x = clear.x, z = clear.z;
      if (!blocked(toX, z, y)) x = toX;
      if (!blocked(x, toZ, y)) z = toZ;
      return { x, z };
    },
  };
}
