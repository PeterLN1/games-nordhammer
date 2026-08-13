// The player wakes up with nothing (see core/resources.js) — this is
// where wood/stone actually enter the resource pool: tapping a nearby
// tree or rock. "Stone" here is loose stones/pebbles lying around the
// rock, not the boulder itself — nobody's quarrying bare-handed, they're
// just picking up what's already on the ground, which is also why it's
// a smaller yield than wood (see STONE_PER_GATHER below). No node
// depletion yet (a tree/rock never "runs out" — it's just on a short
// per-node cooldown so one held finger can't spam a single node for
// infinite resources), and no fiber/grass source yet, both intentional
// simplifications to revisit once this needs more depth.

const TAP_RADIUS = 1.1; // how close a tap must land to a tree/rock to count as aiming at it, not the ground past it
const GATHER_RANGE = 2.0; // how close the player must actually be standing to gather (vs. just walking closer)
const GATHER_COOLDOWN = 1.1; // seconds before the same tree/rock can be gathered again
const WOOD_PER_GATHER = 2;
const STONE_PER_GATHER = 1;

// Nearest item (from a {x,z,...}[] list, e.g. the arrays trees.js/rocks.js
// return) to `point` within `radius`, or null.
function nearestWithin(point, items, radius) {
  let best = null, bestDist = Infinity;
  items.forEach((it, index) => {
    const d = Math.hypot(it.x - point.x, it.z - point.z);
    if (d < radius && d < bestDist) {
      bestDist = d;
      best = { index, x: it.x, z: it.z, dist: d };
    }
  });
  return best;
}

// Whichever of the two candidate lists has the closer match at `point` —
// a tap can only ever be aiming at one real-world object, so ties go to
// whichever is nearer rather than always preferring wood.
export function findGatherTarget(point, treeItems, rockItems, radius = TAP_RADIUS) {
  const tree = nearestWithin(point, treeItems, radius);
  const rock = nearestWithin(point, rockItems, radius);
  if (tree && (!rock || tree.dist <= rock.dist)) return { type: "wood", index: tree.index, x: tree.x, z: tree.z };
  if (rock) return { type: "stone", index: rock.index, x: rock.x, z: rock.z };
  return null;
}

// Stateful wrapper: cooldowns per node, and the actual resources.add()
// call. `now` is advanced explicitly by the caller's own frame clock
// (see main.js) rather than reading Date.now() here, so this stays a pure
// function of its inputs and is trivial to unit test without timers.
export function createGathering({ treeItems, rockItems, resources, tapRadius = TAP_RADIUS, gatherRange = GATHER_RANGE, cooldown = GATHER_COOLDOWN }) {
  const lastGatheredAt = new Map(); // "wood-3" -> the `now` value it was last gathered at
  let now = 0;

  return {
    advance(dt) { now += dt; },

    // Resolves a tap against the world. Returns null if it didn't land
    // near a gatherable tree/rock at all — the caller should fall through
    // to its normal move/interact handling in that case. Otherwise always
    // returns a result object: `gathered` tells the caller whether
    // resources actually changed (false while out of range or on
    // cooldown — the caller can still use `x`/`z` to walk the player
    // closer for next time).
    tryGather(point, playerPos) {
      const target = findGatherTarget(point, treeItems, rockItems, tapRadius);
      if (!target) return null;

      if (Math.hypot(target.x - playerPos.x, target.z - playerPos.z) > gatherRange) {
        return { gathered: false, type: target.type, x: target.x, z: target.z };
      }

      const key = `${target.type}-${target.index}`;
      if (now - (lastGatheredAt.get(key) ?? -Infinity) < cooldown) {
        return { gathered: false, type: target.type, x: target.x, z: target.z, onCooldown: true };
      }
      lastGatheredAt.set(key, now);

      const amount = target.type === "wood" ? WOOD_PER_GATHER : STONE_PER_GATHER;
      resources.add({ [target.type]: amount });
      return { gathered: true, type: target.type, amount, x: target.x, z: target.z };
    },
  };
}
