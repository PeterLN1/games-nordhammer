// Automated regression tests for cold-shelter detection (roof overhead or
// a nearby fire) — plain Node, pure math, no THREE/DOM needed. Uses
// minimal hand-built "placed" entries (just the fields roofCoverage.js
// and shelter.js actually read) rather than STRUCTURES.build()'d meshes.
// Run with:
//   cd laager && npm test

import { isSheltered } from "../src/world/shelter.js";
import { roofCovers, isUnderAnyRoof } from "../src/build/roofCoverage.js";

let pass = 0, fail = 0;
const failures = [];
function check(label, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(detail ? `${label}\n    ${detail}` : label); }
}

// A roof spanning 2m along its local +Z (rotY=0 -> outward is +Z, see
// roofCoverage.js), ridge at (0,0).
function fakeRoof(x, z, rotY = 0, span = 2) {
  return { x, z, rotY, structure: { spansToOpposite: true, width: 1.3 }, buildArgs: { span } };
}
function fakeFire(x, z) {
  return { x, z, structure: { id: "fire" } };
}
function fakeWallWood(x, z, rotY = 0) {
  // not a roof, not a fire — should never count as shelter on its own
  return { x, z, rotY, structure: { id: "wallWood", snapMode: "edge", width: 1.3 } };
}

// ---------------------------------------------------------------------
// 1) No structures at all: never sheltered.
// ---------------------------------------------------------------------
{
  check("isSheltered: false with nothing built", !isSheltered([], { x: 0, z: 0 }));
}

// ---------------------------------------------------------------------
// 2) Roof coverage.
// ---------------------------------------------------------------------
{
  const roof = fakeRoof(0, 0, 0, 2);
  check("roofCovers: true directly under the ridge", roofCovers(roof, { x: 0, z: 0 }));
  check("roofCovers: true partway along the span, not just at the ridge", roofCovers(roof, { x: 0, z: 1.5 }));
  check("roofCovers: false well past the eave", !roofCovers(roof, { x: 0, z: 10 }));
  check("roofCovers: false well off to the side", !roofCovers(roof, { x: 10, z: 1 }));
  check("roofCovers: a non-roof structure never covers", !roofCovers(fakeWallWood(0, 0), { x: 0, z: 0 }));
}

{
  const placed = [fakeWallWood(0, 0), fakeRoof(0, 0, 0, 2)];
  check("isUnderAnyRoof: finds the roof among other non-roof structures", isUnderAnyRoof(placed, { x: 0, z: 1 }));
  check("isSheltered: a roof overhead is enough on its own, no walls needed", isSheltered(placed, { x: 0, z: 1 }));
  check("isSheltered: false once outside every roof's footprint", !isSheltered(placed, { x: 0, z: 20 }));
}

// ---------------------------------------------------------------------
// 3) Fire warmth.
// ---------------------------------------------------------------------
{
  const placed = [fakeFire(5, 5)];
  check("isSheltered: true standing right next to a built fire", isSheltered(placed, { x: 5.5, z: 5 }));
  check("isSheltered: false once far from the fire", !isSheltered(placed, { x: 5 + 20, z: 5 }));
}

{
  // A wall isn't a fire — shouldn't warm anyone just by existing.
  const placed = [fakeWallWood(5, 5)];
  check("isSheltered: a wall alone (no roof, no fire) gives no shelter", !isSheltered(placed, { x: 5, z: 5 }));
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
