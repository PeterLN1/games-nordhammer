// Automated regression tests for wood/stone/food/water gathering — plain
// Node, no THREE/DOM needed since gathering.js is pure logic over plain
// {x,z} lists. Run with:
//   cd laager && npm test

import { findGatherTarget, createGathering } from "../src/world/gathering.js";

let pass = 0, fail = 0;
const failures = [];
function check(label, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(detail ? `${label}\n    ${detail}` : label); }
}

function makeResources() {
  const state = { wood: 0, stone: 0, grass: 0 };
  return {
    state,
    add(amounts) {
      state.wood += amounts.wood || 0;
      state.stone += amounts.stone || 0;
      state.grass += amounts.grass || 0;
    },
  };
}

function makeSurvival() {
  const state = { hunger: 50, thirst: 50 };
  return {
    state,
    eat(amount) { state.hunger += amount; },
    drink(amount) { state.thirst += amount; },
  };
}

function sources(treeItems = [], rockItems = [], berryItems = [], waterItems = []) {
  return [
    { type: "wood", items: treeItems },
    { type: "stone", items: rockItems },
    { type: "food", items: berryItems },
    { type: "water", items: waterItems },
  ];
}

// ---------------------------------------------------------------------
// 1) findGatherTarget: nearest node within radius, whichever type it is.
// ---------------------------------------------------------------------
{
  const trees = [{ x: 5, z: 5 }, { x: 0.3, z: 0 }];
  const rocks = [{ x: -5, z: -5 }];
  const target = findGatherTarget({ x: 0, z: 0 }, sources(trees, rocks));
  check("findGatherTarget: picks the nearby tree over far rocks/other trees", target && target.type === "wood" && target.index === 1, JSON.stringify(target));
}

{
  const trees = [{ x: 5, z: 5 }];
  const rocks = [{ x: 0.2, z: 0.1 }];
  const target = findGatherTarget({ x: 0, z: 0 }, sources(trees, rocks));
  check("findGatherTarget: picks a nearby rock when it's the closest thing", target && target.type === "stone", JSON.stringify(target));
}

{
  const target = findGatherTarget({ x: 0, z: 0 }, sources([{ x: 5, z: 5 }], [{ x: -5, z: -5 }]));
  check("findGatherTarget: null when nothing is within the tap radius", target === null);
}

{
  // Tie-breaking: whichever is actually closer wins, not "wood always first".
  const trees = [{ x: 0.5, z: 0 }];
  const rocks = [{ x: 0.2, z: 0 }];
  const target = findGatherTarget({ x: 0, z: 0 }, sources(trees, rocks));
  check("findGatherTarget: closer rock wins over a farther (but still in-radius) tree", target.type === "stone", JSON.stringify(target));
}

{
  // Same tie-breaking, but across all four source types now — food/water
  // aren't a special case bolted on, they compete on distance like
  // wood/stone do.
  const berries = [{ x: 5, z: 5 }];
  const water = [{ x: 0.15, z: 0 }];
  const target = findGatherTarget({ x: 0, z: 0 }, sources([], [], berries, water));
  check("findGatherTarget: water wins over a farther berry bush", target.type === "water", JSON.stringify(target));
}

// ---------------------------------------------------------------------
// 2) createGathering: range gating, cooldown, actual resource yield —
//    wood/stone into resources, food/water into survival.
// ---------------------------------------------------------------------
{
  const res = makeResources();
  const gathering = createGathering({ treeItems: [{ x: 0, z: 0 }], rockItems: [], resources: res });
  const farAway = { x: 20, z: 20 };
  const result = gathering.tryGather({ x: 0, z: 0 }, farAway);
  check("tryGather: too far from the player does not grant resources", result && result.gathered === false, JSON.stringify(result));
  check("tryGather: too far leaves the pool untouched", res.state.wood === 0);
}

{
  const res = makeResources();
  const gathering = createGathering({ treeItems: [{ x: 0, z: 0 }], rockItems: [], resources: res });
  const nearby = { x: 0.5, z: 0 };
  const result = gathering.tryGather({ x: 0, z: 0 }, nearby);
  check("tryGather: standing close actually gathers", result && result.gathered === true && result.type === "wood", JSON.stringify(result));
  check("tryGather: wood was added to the pool", res.state.wood > 0, `wood=${res.state.wood}`);
}

{
  const res = makeResources();
  const gathering = createGathering({ treeItems: [], rockItems: [{ x: 0, z: 0 }], resources: res });
  const nearby = { x: 0.3, z: 0.3 };
  const result = gathering.tryGather({ x: 0, z: 0 }, nearby);
  check("tryGather: rocks yield stone, not wood", result.gathered && result.type === "stone" && res.state.stone > 0 && res.state.wood === 0);
}

{
  const res = makeResources();
  const survival = makeSurvival();
  const gathering = createGathering({ treeItems: [], rockItems: [], berryItems: [{ x: 0, z: 0 }], resources: res, survival });
  const nearby = { x: 0.3, z: 0.3 };
  const result = gathering.tryGather({ x: 0, z: 0 }, nearby);
  check("tryGather: a berry bush yields food, restoring hunger not thirst", result.gathered && result.type === "food" && survival.state.hunger > 50 && survival.state.thirst === 50, JSON.stringify({ result, state: survival.state }));
  check("tryGather: food doesn't touch the building-material pool", res.state.wood === 0 && res.state.stone === 0);
}

{
  const survival = makeSurvival();
  const gathering = createGathering({ treeItems: [], rockItems: [], waterItems: [{ x: 0, z: 0 }], resources: makeResources(), survival });
  const nearby = { x: 0.3, z: 0.3 };
  const result = gathering.tryGather({ x: 0, z: 0 }, nearby);
  check("tryGather: a pool of water yields water, restoring thirst not hunger", result.gathered && result.type === "water" && survival.state.thirst > 50 && survival.state.hunger === 50, JSON.stringify({ result, state: survival.state }));
}

{
  const res = makeResources();
  const gathering = createGathering({ treeItems: [{ x: 0, z: 0 }], rockItems: [], resources: res, cooldown: 1 });
  const nearby = { x: 0.2, z: 0 };
  const first = gathering.tryGather({ x: 0, z: 0 }, nearby);
  const second = gathering.tryGather({ x: 0, z: 0 }, nearby);
  check("tryGather: an immediate second tap on the same tree is on cooldown", first.gathered === true && second.gathered === false && second.onCooldown === true, JSON.stringify({ first, second }));
  const woodAfterTwoTaps = res.state.wood;
  gathering.advance(1.5); // past the 1s cooldown
  const third = gathering.tryGather({ x: 0, z: 0 }, nearby);
  check("tryGather: gathering resumes once the cooldown has elapsed", third.gathered === true && res.state.wood > woodAfterTwoTaps, JSON.stringify(third));
}

{
  // Two separate trees each have their own cooldown — tapping one
  // shouldn't lock out the other.
  const res = makeResources();
  const gathering = createGathering({ treeItems: [{ x: 0, z: 0 }, { x: 1, z: 0 }], rockItems: [], resources: res, cooldown: 5 });
  const a = gathering.tryGather({ x: 0, z: 0 }, { x: 0, z: 0 });
  const b = gathering.tryGather({ x: 1, z: 0 }, { x: 1, z: 0 });
  check("tryGather: cooldowns are per-node, not global", a.gathered === true && b.gathered === true, JSON.stringify({ a, b }));
}

{
  const res = makeResources();
  const gathering = createGathering({ treeItems: [], rockItems: [], resources: res });
  const result = gathering.tryGather({ x: 0, z: 0 }, { x: 0, z: 0 });
  check("tryGather: no nearby node at all returns null (caller falls through to normal tap handling)", result === null);
}

// ---------------------------------------------------------------------
console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) {
  console.log("\nFAILURES:");
  for (const f of failures) console.log("  ✗ " + f);
  process.exit(1);
} else {
  console.log("all good ✓");
}
