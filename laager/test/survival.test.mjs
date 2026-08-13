// Automated regression tests for health/hunger/thirst — plain Node, pure
// state machine, no THREE/DOM needed. Run with:
//   cd laager && npm test

import { createSurvival } from "../src/core/survival.js";

let pass = 0, fail = 0;
const failures = [];
function check(label, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(detail ? `${label}\n    ${detail}` : label); }
}
function near(a, b, eps = 0.01) {
  return typeof a === "number" && typeof b === "number" && Math.abs(a - b) < eps;
}

// ---------------------------------------------------------------------
// 1) Starting state and eat()/drink().
// ---------------------------------------------------------------------
{
  const s = createSurvival();
  check("starts at full health/hunger/thirst by default", s.health === 100 && s.hunger === 100 && s.thirst === 100);
  check("not dead at full health", !s.isDead);
}

{
  const s = createSurvival({ health: 40, hunger: 10, thirst: 20 });
  check("accepts custom initial state (e.g. a restored save)", s.health === 40 && s.hunger === 10 && s.thirst === 20);
}

{
  const s = createSurvival({ hunger: 50 });
  s.eat(20);
  check("eat() raises hunger", near(s.hunger, 70));
  s.eat(1000);
  check("eat() clamps at 100", s.hunger === 100);
}

{
  const s = createSurvival({ thirst: 50 });
  s.drink(15);
  check("drink() raises thirst", near(s.thirst, 65));
  s.drink(1000);
  check("drink() clamps at 100", s.thirst === 100);
}

// ---------------------------------------------------------------------
// 2) Passive decay: hunger/thirst drain on their own, health doesn't
//    while neither has run out and it's not cold.
// ---------------------------------------------------------------------
{
  const s = createSurvival();
  s.tick(60, { cold: false });
  check("hunger drains over time", s.hunger < 100 && s.hunger > 0, `hunger=${s.hunger}`);
  check("thirst drains over time", s.thirst < 100 && s.thirst > 0, `thirst=${s.thirst}`);
  check("thirst drains faster than hunger (matches the *_PER_SEC constants)", s.thirst < s.hunger, `hunger=${s.hunger}, thirst=${s.thirst}`);
  check("health doesn't drop while hunger/thirst are both still positive and it's not cold", s.health === 100, `health=${s.health}`);
}

// ---------------------------------------------------------------------
// 3) Damage sources: starving, dehydrated, cold — individually and
//    stacked (should be strictly worse than any single one alone).
// ---------------------------------------------------------------------
{
  const s = createSurvival({ hunger: 0 });
  const before = s.health;
  s.tick(5, { cold: false });
  check("starving (0 hunger) damages health", s.health < before, `before=${before}, after=${s.health}`);
}

{
  const s = createSurvival({ thirst: 0 });
  const before = s.health;
  s.tick(5, { cold: false });
  check("dehydration (0 thirst) damages health", s.health < before, `before=${before}, after=${s.health}`);
}

{
  const s = createSurvival();
  const before = s.health;
  s.tick(5, { cold: true });
  check("cold with no shelter damages health even at full hunger/thirst", s.health < before, `before=${before}, after=${s.health}`);
}

{
  const single = createSurvival({ hunger: 0 });
  single.tick(3, { cold: false });
  const stacked = createSurvival({ hunger: 0, thirst: 0 });
  stacked.tick(3, { cold: true });
  check(
    "starving + dehydrated + cold all at once hurts more than starving alone",
    (100 - stacked.health) > (100 - single.health),
    `single loss=${100 - single.health}, stacked loss=${100 - stacked.health}`
  );
}

// ---------------------------------------------------------------------
// 4) Regeneration: health climbs back up on its own once nothing is wrong.
// ---------------------------------------------------------------------
{
  const s = createSurvival({ health: 50 });
  s.tick(30, { cold: false });
  check("health regenerates over time when hunger/thirst are fine and it's not cold", s.health > 50, `health=${s.health}`);
}

{
  const s = createSurvival({ health: 100 });
  s.tick(30, { cold: false });
  check("health regen doesn't push past 100", s.health === 100);
}

// ---------------------------------------------------------------------
// 5) Death: health hits 0, isDead flips, and the simulation stops
//    (no further state changes from tick()).
// ---------------------------------------------------------------------
{
  const s = createSurvival({ health: 1 });
  s.tick(10, { cold: true });
  check("health hitting 0 sets isDead", s.isDead, `health=${s.health}`);
  check("health never goes negative", s.health === 0, `health=${s.health}`);

  const hungerAtDeath = s.hunger;
  s.tick(60, { cold: true });
  check("tick() after death doesn't keep changing hunger", s.hunger === hungerAtDeath, `before=${hungerAtDeath}, after=${s.hunger}`);
  check("still dead, still exactly 0 health", s.isDead && s.health === 0);
}

{
  const s = createSurvival();
  check("deathCauses is empty while still alive", s.deathCauses.length === 0);
}

{
  const s = createSurvival({ health: 1 });
  s.tick(10, { cold: true });
  check("deathCauses records cold as the cause when that's what finished the player off", s.deathCauses.includes("cold"), JSON.stringify(s.deathCauses));
}

{
  const s = createSurvival({ health: 1, hunger: 0, thirst: 0 });
  s.tick(10, { cold: false });
  check(
    "deathCauses records both hunger and thirst when both are at 0 at the moment of death",
    s.deathCauses.includes("hunger") && s.deathCauses.includes("thirst") && !s.deathCauses.includes("cold"),
    JSON.stringify(s.deathCauses)
  );
}

// ---------------------------------------------------------------------
// 6) subscribe(): fires immediately with the current state, then again
//    on every change — same contract as core/resources.js's.
// ---------------------------------------------------------------------
{
  const s = createSurvival({ hunger: 80 });
  const seen = [];
  s.subscribe((state) => seen.push(state));
  check("subscribe() fires immediately with the current state", seen.length === 1 && seen[0].hunger === 80, JSON.stringify(seen));
  s.eat(5);
  check("subscribe() fires again on a change", seen.length === 2 && near(seen[1].hunger, 85), JSON.stringify(seen));
}

{
  const s = createSurvival();
  const seen = [];
  const unsubscribe = s.subscribe((state) => seen.push(state));
  unsubscribe();
  s.eat(5);
  check("unsubscribe stops further notifications", seen.length === 1, `got ${seen.length} notifications`);
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
