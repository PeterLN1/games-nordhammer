// The player wakes up with nothing (see core/resources.js and
// core/survival.js) — this is where wood/stone/food/water actually enter
// those pools: tapping a nearby tree, rock, berry bush, or pool of water.
// "Stone" here is loose stones/pebbles lying around the rock, not the
// boulder itself — nobody's quarrying bare-handed, they're just picking
// up what's already on the ground, which is also why it's a smaller
// yield than wood (see STONE_PER_GATHER below). No node depletion yet (a
// tree/rock/bush never "runs out" — it's just on a short per-node
// cooldown so one held finger can't spam a single node for infinite
// resources), and no fiber/grass source yet, both intentional
// simplifications to revisit once this needs more depth.

const TAP_RADIUS = 1.1; // how close a tap must land to a node to count as aiming at it, not the ground past it
const GATHER_RANGE = 2.0; // how close the player must actually be standing to gather (vs. just walking closer)
const GATHER_COOLDOWN = 1.1; // seconds before the same node can be gathered/drunk/eaten from again
const WOOD_PER_GATHER = 2;
const STONE_PER_GATHER = 1;
const FOOD_PER_GATHER = 18; // a handful of berries — a real bite out of hunger, not a full meal
const WATER_PER_GATHER = 25; // a drink outpaces a berry's worth of hunger, same as thirst draining faster than hunger

// wood/stone feed core/resources.js's building-material pool; food/water
// feed core/survival.js's hunger/thirst instead — see createGathering's
// tryGather() for which pool each type actually lands in.
const RESOURCE_AMOUNTS = { wood: WOOD_PER_GATHER, stone: STONE_PER_GATHER };
const CONSUMABLE_AMOUNTS = { food: FOOD_PER_GATHER, water: WATER_PER_GATHER };

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

// Whichever candidate across all the source lists is actually closest to
// `point` — a tap can only ever be aiming at one real-world object, so
// ties go to whichever is nearer rather than always preferring the first
// source in the list. `sources` is [{type, items}, ...].
export function findGatherTarget(point, sources, radius = TAP_RADIUS) {
  let best = null;
  for (const { type, items } of sources) {
    const hit = nearestWithin(point, items, radius);
    if (hit && (!best || hit.dist < best.dist)) {
      best = { type, index: hit.index, x: hit.x, z: hit.z, dist: hit.dist };
    }
  }
  return best;
}

// Stateful wrapper: cooldowns per node, and the actual resources.add()/
// survival.eat()/survival.drink() call. `now` is advanced explicitly by
// the caller's own frame clock (see main.js) rather than reading
// Date.now() here, so this stays a pure function of its inputs and is
// trivial to unit test without timers.
export function createGathering({
  treeItems, rockItems, berryItems = [], waterItems = [],
  resources, survival,
  tapRadius = TAP_RADIUS, gatherRange = GATHER_RANGE, cooldown = GATHER_COOLDOWN,
}) {
  const lastGatheredAt = new Map(); // "wood-3" -> the `now` value it was last gathered at
  let now = 0;
  const sources = [
    { type: "wood", items: treeItems },
    { type: "stone", items: rockItems },
    { type: "food", items: berryItems },
    { type: "water", items: waterItems },
  ];

  return {
    advance(dt) { now += dt; },

    // Resolves a tap against the world. Returns null if it didn't land
    // near a gatherable node at all — the caller should fall through to
    // its normal move/interact handling in that case. Otherwise always
    // returns a result object: `gathered` tells the caller whether
    // something actually changed (false while out of range or on
    // cooldown — the caller can still use `x`/`z` to walk the player
    // closer for next time).
    tryGather(point, playerPos) {
      const target = findGatherTarget(point, sources, tapRadius);
      if (!target) return null;

      if (Math.hypot(target.x - playerPos.x, target.z - playerPos.z) > gatherRange) {
        return { gathered: false, type: target.type, x: target.x, z: target.z };
      }

      const key = `${target.type}-${target.index}`;
      if (now - (lastGatheredAt.get(key) ?? -Infinity) < cooldown) {
        return { gathered: false, type: target.type, x: target.x, z: target.z, onCooldown: true };
      }
      lastGatheredAt.set(key, now);

      if (target.type in RESOURCE_AMOUNTS) {
        const amount = RESOURCE_AMOUNTS[target.type];
        resources.add({ [target.type]: amount });
        return { gathered: true, type: target.type, amount, x: target.x, z: target.z };
      }

      const amount = CONSUMABLE_AMOUNTS[target.type];
      if (target.type === "food") survival.eat(amount);
      else survival.drink(amount);
      return { gathered: true, type: target.type, amount, x: target.x, z: target.z };
    },
  };
}
