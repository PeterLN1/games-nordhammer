// Automated regression tests for player pathfinding — runs the pure grid
// A* logic in plain Node (no DOM/WebGL, no THREE.js needed at all here),
// so a handful of obstacle layouts get checked in well under a second.
// Run with:
//   cd laager && npm test

import { findPath } from "../src/player/pathfinding.js";

let pass = 0, fail = 0;
const failures = [];
function check(label, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(detail ? `${label}\n    ${detail}` : label); }
}
function near(a, b, eps = 0.05) {
  return typeof a === "number" && typeof b === "number" && Math.abs(a - b) < eps;
}

// Walks every leg of a returned path with fine sampling and confirms none
// of it ever crosses a blocked point — this is the actual invariant that
// matters (the player never gets routed *through* an obstacle), checked
// the same way regardless of which obstacle layout produced the path.
function pathIsFullyClear(start, path, isBlocked) {
  let prev = start;
  for (const wp of path) {
    const dist = Math.hypot(wp.x - prev.x, wp.z - prev.z);
    const steps = Math.max(1, Math.ceil(dist / 0.05));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (isBlocked(prev.x + (wp.x - prev.x) * t, prev.z + (wp.z - prev.z) * t)) return false;
    }
    prev = wp;
  }
  return true;
}

// ---------------------------------------------------------------------
// 1) Nothing in the way — should skip the grid entirely and just return
//    the target as a single waypoint.
// ---------------------------------------------------------------------
{
  const path = findPath({ x: 0, z: 0 }, { x: 5, z: 0 }, () => false);
  check(
    "open field: returns the target directly as a single waypoint",
    !!path && path.length === 1 && near(path[0].x, 5) && near(path[0].z, 0)
  );
}

// ---------------------------------------------------------------------
// 2) A wall directly between start and target, but with open ends —
//    must actually route around one end rather than getting stuck.
// ---------------------------------------------------------------------
{
  const isBlocked = (x, z) => x > 2.3 && x < 2.7 && z > -3 && z < 3; // long wall straight across the direct line, x~2.5
  const start = { x: 0, z: 0 }, target = { x: 5, z: 0 };
  const path = findPath(start, target, isBlocked);
  check("wall in the way: finds a route", !!path && path.length > 0);
  if (path) {
    const last = path[path.length - 1];
    check("wall in the way: reaches the exact target", near(last.x, target.x) && near(last.z, target.z), JSON.stringify(last));
    check("wall in the way: the whole route is actually clear of the wall", pathIsFullyClear(start, path, isBlocked));
  }
}

// ---------------------------------------------------------------------
// 3) A doorway-width gap in an otherwise long wall — the route should
//    thread through the gap rather than detour all the way around a
//    wall that (in this scenario) has no real end within grid range.
// ---------------------------------------------------------------------
{
  // wall from z=-20..20 at x=2.5, except a 1m gap right at z=0
  const isBlocked = (x, z) => x > 2.3 && x < 2.7 && (z < -0.5 || z > 0.5);
  const start = { x: 0, z: 0 }, target = { x: 5, z: 0 };
  const path = findPath(start, target, isBlocked);
  check("doorway gap: finds a route", !!path && path.length > 0);
  if (path) {
    check("doorway gap: reaches the exact target", near(path[path.length - 1].x, target.x) && near(path[path.length - 1].z, target.z));
    check("doorway gap: the whole route is actually clear", pathIsFullyClear(start, path, isBlocked));
  }
}

// ---------------------------------------------------------------------
// 4) A fully sealed room around the target — there is genuinely no route,
//    and findPath must say so (null) rather than returning a path that
//    secretly cuts through a wall.
// ---------------------------------------------------------------------
{
  const outerMin = 1.5, outerMax = 3.5, innerMin = 2.15, innerMax = 2.85; // ring wall ~0.65 thick, well past grid resolution
  const isBlocked = (x, z) => {
    const inRing = x >= outerMin && x <= outerMax && z >= outerMin && z <= outerMax;
    const inHole = x > innerMin && x < innerMax && z > innerMin && z < innerMax;
    return inRing && !inHole;
  };
  const path = findPath({ x: 0, z: 0 }, { x: 2.5, z: 2.5 }, isBlocked);
  check("sealed room: returns null instead of a bogus path through the wall", path === null, JSON.stringify(path));
}

// ---------------------------------------------------------------------
// 5) A closed room but with the target *just outside* it (not sealed) —
//    make sure the sealed-room case above isn't just always returning
//    null; an actually-reachable target near a similar obstacle must
//    still find a route.
// ---------------------------------------------------------------------
{
  const isBlocked = (x, z) => x >= 1.5 && x <= 3.5 && z >= 1.5 && z <= 3.5; // solid block, not a ring
  const start = { x: 0, z: 0 }, target = { x: 5, z: 2.5 }; // past the block, not inside it
  const path = findPath(start, target, isBlocked);
  check("solid block, reachable target: finds a route", !!path && path.length > 0);
  if (path) {
    check("solid block, reachable target: reaches the exact target", near(path[path.length - 1].x, target.x) && near(path[path.length - 1].z, target.z));
    check("solid block, reachable target: the whole route is actually clear", pathIsFullyClear(start, path, isBlocked));
  }
}

// ---------------------------------------------------------------------
// 6) A long detour (forces the full grid search, not just the
//    line-of-sight fast path) must still finish quickly — this is a
//    tap-to-move game, a multi-second hang on a single click would be a
//    serious regression.
// ---------------------------------------------------------------------
{
  const isBlocked = (x, z) => x > 4.7 && x < 5.3 && z > -2 && z < 2; // wall across the direct line, with room to go around at either end within the grid's padded bounds
  const start = { x: 0, z: 0 }, target = { x: 10, z: 0 };
  const t0 = Date.now();
  const path = findPath(start, target, isBlocked);
  const elapsed = Date.now() - t0;
  check("long detour: completes quickly", elapsed < 500, `${elapsed}ms`);
  check("long detour: still finds *some* route (goes around the wall's end)", !!path && path.length > 0);
}

// ---------------------------------------------------------------------
// 7) Player already standing right up against an obstacle (start cell
//    itself reads as blocked, e.g. pressed into a wall's clearance
//    radius) — must still find a route instead of failing outright.
// ---------------------------------------------------------------------
{
  const isBlocked = (x, z) => Math.hypot(x, z) < 0.4; // a small obstacle centered exactly on the start point
  const path = findPath({ x: 0, z: 0 }, { x: 3, z: 0 }, isBlocked);
  check("start pressed against an obstacle: still finds a route", !!path && path.length > 0, JSON.stringify(path));
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
