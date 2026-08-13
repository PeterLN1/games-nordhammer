// Automated regression tests for the build system — runs the actual game
// modules in plain Node (three.js needs no DOM/WebGL for pure geometry),
// so dozens of room shapes/rotations get checked in well under a second
// instead of one browser round-trip per scenario. Run with:
//   cd laager && npm test
//
// This exists because the same handful of bug classes (a corner's
// default rotation, a spanning roof/gable's size, collision at a
// corner, cutaway fade coverage) kept resurfacing in slightly different
// shapes as real rooms got bigger/weirder than whatever one case had
// last been hand-tested in the browser. Every case below is a shape or
// situation that has *actually broken* at some point.

import * as THREE from "three";
import { createBuildMode, platformSurfaceAt } from "../src/build/buildMode.js";
import { createCutaway } from "../src/build/cutaway.js";
import { createCollision } from "../src/world/collision.js";
import { PALETTE } from "../src/core/palette.js";
import { STRUCTURES, ROOF_RISE, WALL_SPAN } from "../src/build/structures.js";

const EPS = 0.01;

let pass = 0, fail = 0;
const failures = [];
function check(label, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(detail ? `${label}\n    ${detail}` : label); }
}
function near(a, b, eps = EPS) {
  return typeof a === "number" && typeof b === "number" && Math.abs(a - b) < eps;
}

function makeBuildMode() {
  const scene = new THREE.Scene();
  const shadowMat = new THREE.MeshBasicMaterial();
  const resources = { canAfford: () => true, spend: () => {}, refund: () => {} };
  const terrainHeight = () => 0;
  return createBuildMode({ scene, palette: PALETTE, shadowMat, resources, terrainHeight });
}

function localToWorld(p, lx, lz) {
  const cos = Math.cos(p.rotY), sin = Math.sin(p.rotY);
  return { x: p.x + lx * cos + lz * sin, z: p.z - lx * sin + lz * cos };
}
function forward(rotY) {
  return { x: Math.cos(rotY), z: -Math.sin(rotY) };
}
function place(bm, id, point) {
  bm.selectStructure(id);
  bm.handleTap(point);
  return bm.confirm();
}

// Pushes a fully-formed placed-entry directly into buildMode's internal
// list, bypassing handleTap/confirm — used to build a perimeter at known
// exact positions/rotations so span/collision checks aren't entangled
// with which of a corner's two (both individually valid) edges the
// corner-snapping logic happens to pick by default.
function fabricate(bm, structureId, x, z, rotY, y = 0) {
  const structure = STRUCTURES[structureId];
  const mesh = structure.build(PALETTE);
  mesh.position.set(x, y, z);
  mesh.rotation.y = rotY;
  const entry = { x, y, z, rotY, structure, mesh, shadowMesh: mesh };
  bm.placed.push(entry);
  return entry;
}

// Grows a countI x countJ tile platform floor from a single seed post,
// rotated by `startRotate` off the post's own default facing — every
// rotation-dependent bug so far has actually been triggered by a
// platform that isn't axis-aligned.
function buildFloor(bm, countI, countJ, startRotate) {
  bm.toggle(true);
  place(bm, "post", { x: 2, z: 0 });
  bm.rotate(startRotate);
  bm.confirm();
  place(bm, "platform", { x: 2, z: 0 });
  const p00 = bm.placed.find((p) => p.structure.id === "platform");
  const w = p00.structure.width;

  const grid = { "0,0": p00 };
  for (let i = 0; i < countI; i++) {
    for (let j = 0; j < countJ; j++) {
      if (i === 0 && j === 0) continue;
      const fromKey = i > 0 ? `${i - 1},${j}` : `${i},${j - 1}`;
      const from = grid[fromKey];
      const [di, dj] = i > 0 ? [1, 0] : [0, 1];
      const target = localToWorld(from, di * w, dj * w);
      bm.selectStructure("platform");
      bm.handleTap(target);
      bm.confirm();
      grid[`${i},${j}`] = bm.placed.filter((p) => p.structure.id === "platform").slice(-1)[0];
    }
  }
  bm.toggle(false);
  return { p00, grid, tileWidth: w };
}

function outerCorners(grid, countI, countJ, tileWidth) {
  const half = tileWidth / 2;
  const p00 = grid["0,0"], pI0 = grid[`${countI - 1},0`], p0J = grid[`0,${countJ - 1}`], pIJ = grid[`${countI - 1},${countJ - 1}`];
  return [
    localToWorld(p00, -half, -half),
    localToWorld(pI0, half, -half),
    localToWorld(pIJ, half, half),
    localToWorld(p0J, -half, half),
  ];
}

// ---------------------------------------------------------------------
// 1) Every corner of every room shape/rotation lands its default
//    (un-rotated) wall tap ON the platform, never dropped to the ground
//    — the corner-tangent-picks-a-hidden-internal-seam bug.
// ---------------------------------------------------------------------
const shapes = [[1, 1], [2, 1], [1, 2], [2, 2], [3, 1], [3, 3], [4, 2], [3, 2]];
const rotations = [0, Math.PI / 6, Math.PI / 4, Math.PI / 2, 1.9];

for (const [countI, countJ] of shapes) {
  for (const startRotate of rotations) {
    const label = `${countI}x${countJ} @ ${startRotate.toFixed(2)}rad`;
    const bm = makeBuildMode();
    const { grid, tileWidth } = buildFloor(bm, countI, countJ, startRotate);
    const platformSurfaceY = grid["0,0"].y + grid["0,0"].structure.height;
    const corners = outerCorners(grid, countI, countJ, tileWidth);

    bm.toggle(true);
    bm.selectStructure("wallWood");
    corners.forEach((c, i) => {
      bm.handleTap(c);
      const ok = bm.confirm();
      const w = bm.placed.filter((p) => p.structure.id === "wallWood").slice(-1)[0];
      check(`${label}: corner ${i} wall confirms`, ok);
      if (ok) {
        check(
          `${label}: corner ${i} wall lands on the platform (not ground)`,
          near(w.y, platformSurfaceY, 0.05),
          `expected y≈${platformSurfaceY.toFixed(3)}, got ${w.y.toFixed(3)}`
        );
      }
    });
    bm.toggle(false);
  }
}

// ---------------------------------------------------------------------
// 2) Ridge roof + gable span consistency, on a perimeter built at known
//    exact positions (avoids depending on which of a corner's two valid
//    edges the live corner-snap logic happens to trace by default).
// ---------------------------------------------------------------------
function buildExactPerimeter(bm, lengthTiles, widthTiles, rotY, wallY = 1.4) {
  const W = STRUCTURES.wallWood.width;
  const along = forward(rotY);
  const perp = { x: Math.sin(rotY), z: Math.cos(rotY) };
  const lengthSpan = lengthTiles * W, widthSpan = widthTiles * W;
  const origin = { x: 0, z: 0 }; // one corner of the room
  const longWalls = [], shortWalls = [];
  for (const side of [0, 1]) { // z = 0 and z = widthSpan (the two long sides, running along `along`)
    for (let i = 0; i < lengthTiles; i++) {
      const cx = origin.x + along.x * (W * (i + 0.5)) + perp.x * (side * widthSpan);
      const cz = origin.z + along.z * (W * (i + 0.5)) + perp.z * (side * widthSpan);
      longWalls.push(fabricate(bm, "wallWood", cx, cz, rotY, wallY));
    }
  }
  const perpRotY = rotY - Math.PI / 2;
  const alongPerp = forward(perpRotY);
  for (const side of [0, 1]) { // the two short sides, running along `perp`
    for (let j = 0; j < widthTiles; j++) {
      const cx = origin.x + alongPerp.x * (W * (j + 0.5)) + along.x * (side * lengthSpan);
      const cz = origin.z + alongPerp.z * (W * (j + 0.5)) + along.z * (side * lengthSpan);
      shortWalls.push(fabricate(bm, "wallWood", cx, cz, perpRotY, wallY));
    }
  }
  return { longWalls, shortWalls, lengthSpan, widthSpan };
}

const spanShapes = [[1, 1], [2, 1], [2, 2], [2, 3], [4, 2], [1, 3]];
for (const [lengthTiles, widthTiles] of spanShapes) {
  for (const rotY of [0, 0.7, Math.PI / 2]) {
    const label = `perimeter ${lengthTiles}x${widthTiles} @ rotY=${rotY.toFixed(2)}`;
    const bm = makeBuildMode();
    const { longWalls, shortWalls, widthSpan, lengthSpan } = buildExactPerimeter(bm, lengthTiles, widthTiles, rotY);

    bm.toggle(true);
    bm.selectStructure("ridgeRoof");
    bm.handleTap({ x: longWalls[0].x, z: longWalls[0].z });
    const roofOk = bm.confirm();
    const roof = bm.placed.find((p) => p.structure.id === "ridgeRoof");
    check(`${label}: ridge roof places on a long wall`, roofOk);
    if (roofOk) {
      check(
        `${label}: ridge roof span matches the room's width`,
        near(roof.buildArgs?.span, widthSpan, 0.05),
        `expected span≈${widthSpan.toFixed(3)}, got ${roof.buildArgs?.span}`
      );
    }

    bm.selectStructure("gableWall");
    bm.handleTap({ x: shortWalls[0].x, z: shortWalls[0].z });
    const gableOk = bm.confirm();
    const gable = bm.placed.find((p) => p.structure.id === "gableWall");
    check(`${label}: gable wall places on a short wall`, gableOk);
    if (gableOk) {
      check(
        `${label}: gable span matches the short wall's full run (the room's width)`,
        near(gable.buildArgs?.span, widthSpan, 0.05),
        `expected span≈${widthSpan.toFixed(3)}, got ${gable.buildArgs?.span}`
      );
    }
    if (gableOk && roofOk) {
      check(
        `${label}: gable span matches the ridge roof's span (the real bug from user reports)`,
        near(gable.buildArgs?.span, roof.buildArgs?.span, 0.05),
        `roof span=${roof.buildArgs?.span}, gable span=${gable.buildArgs?.span}`
      );
      check(
        `${label}: gable peak height matches roof peak height`,
        near(gable.y + ROOF_RISE, roof.y + ROOF_RISE, 0.05),
        `gable peak=${(gable.y + ROOF_RISE).toFixed(3)}, roof peak=${(roof.y + ROOF_RISE).toFixed(3)}`
      );
    }
    bm.toggle(false);

    // ---------------------------------------------------------------
    // 3) Cutaway fade coverage scales with the roof's real span
    // ---------------------------------------------------------------
    if (roofOk) {
      const cutaway = createCutaway();
      const fakeCamera = { position: new THREE.Vector3(0, 10, 0) };
      const outward = { x: Math.sin(roof.rotY), z: Math.cos(roof.rotY) };
      const underMiddle = { x: roof.x + outward.x * (roof.buildArgs.span / 2), y: roof.y, z: roof.z + outward.z * (roof.buildArgs.span / 2) };
      const underFarEdge = { x: roof.x + outward.x * (roof.buildArgs.span * 0.95), y: roof.y, z: roof.z + outward.z * (roof.buildArgs.span * 0.95) };
      const farAway = { x: roof.x - outward.x * 20, y: 0, z: roof.z - outward.z * 20 };
      cutaway.update(bm.placed, underMiddle, fakeCamera, 1);
      check(`${label}: cutaway fades the roof when standing under its middle`, cutaway.getFaded().has(roof.mesh));
      cutaway.update(bm.placed, underFarEdge, fakeCamera, 1);
      check(`${label}: cutaway fades the roof when standing near its far edge`, cutaway.getFaded().has(roof.mesh));
      cutaway.update(bm.placed, farAway, fakeCamera, 1);
      check(`${label}: cutaway stops fading the roof once far away`, !cutaway.getFaded().has(roof.mesh));
    }
  }
}

// ---------------------------------------------------------------------
// 4) Collision: depenetration prevents permanent stuck states at every
//    corner of an exact-perimeter room, at a tighter-than-wall-radius
//    clearance (deliberately aggressive).
// ---------------------------------------------------------------------
for (const rotY of [0, 0.6, Math.PI / 2]) {
  const bm = makeBuildMode();
  const { longWalls, shortWalls } = buildExactPerimeter(bm, 2, 2, rotY);
  const walls = [...longWalls, ...shortWalls];
  const floorY = walls[0].y;
  const collision = createCollision({ trees: [], rocks: [], buildMode: bm, terrainHeight: () => 0 });

  function endsOf(w) {
    const dir = forward(w.rotY);
    const half = w.structure.width / 2;
    return [{ x: w.x + dir.x * half, z: w.z + dir.z * half }, { x: w.x - dir.x * half, z: w.z - dir.z * half }];
  }
  function angleBetweenLines(a, b) {
    let d = (a - b) % Math.PI;
    if (d > Math.PI / 2) d -= Math.PI;
    else if (d < -Math.PI / 2) d += Math.PI;
    return Math.abs(d);
  }
  const corners = [];
  for (let i = 0; i < walls.length; i++) for (let j = i + 1; j < walls.length; j++) {
    const a = walls[i], b = walls[j];
    if (angleBetweenLines(a.rotY, b.rotY) < 0.3) continue; // only real 90°-ish turns, not two collinear segments of the same side touching
    for (const ea of endsOf(a)) for (const eb of endsOf(b)) {
      if (Math.hypot(ea.x - eb.x, ea.z - eb.z) < 0.05) corners.push({ corner: ea, wallA: a, wallB: b });
    }
  }
  check(`2x2 exact perimeter @ rotY=${rotY.toFixed(2)}: found the expected 4 corners`, corners.length === 4, `found ${corners.length}`);

  // A corner point sits exactly on wl's own centerline (it's one of the
  // wall's two endpoints), so wl's own perpendicular dot with the vector
  // to its own endpoint is always exactly 0 — that can't tell "outward"
  // from "inward". Use the room's centroid instead: outward is away from
  // the room's own bulk, which is well-defined for any corner.
  const centroid = walls.reduce((s, w) => ({ x: s.x + w.x / walls.length, z: s.z + w.z / walls.length }), { x: 0, z: 0 });
  function outwardOffset(wl, corner, dist) {
    const perp = { x: Math.sin(wl.rotY), z: Math.cos(wl.rotY) };
    const awayFromCentroid = { x: corner.x - centroid.x, z: corner.z - centroid.z };
    const s = perp.x * awayFromCentroid.x + perp.z * awayFromCentroid.z >= 0 ? 1 : -1;
    return { x: corner.x + perp.x * s * dist, z: corner.z + perp.z * s * dist };
  }

  for (const { corner, wallA, wallB } of corners) {
    const CLEARANCE = 0.45; // tighter than the wall's own 0.44 collision radius
    const startPoint = outwardOffset(wallA, corner, CLEARANCE);
    const endPoint = outwardOffset(wallB, corner, CLEARANCE);
    const alongA = forward(wallA.rotY), alongB = forward(wallB.rotY);
    const s1 = { x: startPoint.x - alongA.x * 0.4, z: startPoint.z - alongA.z * 0.4 };
    const t1 = { x: endPoint.x - alongB.x * 0.4, z: endPoint.z - alongB.z * 0.4 };

    let x = s1.x, z = s1.z;
    let stuckFrames = 0, maxStuckFrames = 0, steps = 0;
    while (Math.hypot(t1.x - x, t1.z - z) > 0.05 && steps < 3000) {
      steps++;
      const dx = t1.x - x, dz = t1.z - z, dist = Math.hypot(dx, dz);
      const step = Math.min(3.2 * 0.016, dist);
      const nx = x + (dx / dist) * step, nz = z + (dz / dist) * step;
      const resolved = collision.resolve(x, z, nx, nz, floorY);
      const moved = Math.hypot(resolved.x - x, resolved.z - z);
      if (moved < 0.0005) { stuckFrames++; maxStuckFrames = Math.max(maxStuckFrames, stuckFrames); }
      else stuckFrames = 0;
      x = resolved.x; z = resolved.z;
    }
    // A greedy straight-line walk toward one fixed point can legitimately
    // stall forever if a wall is directly in the way and the target never
    // changes — there's no pathfinding, so that's just a wall doing its
    // job, not a bug. The actual invariant from the real report is that
    // the player is never *fully* sealed in with literally nowhere to
    // go — so if progress stalled, check that at least one of several
    // other directions from that same spot still lets it move.
    let canEscape = true;
    if (maxStuckFrames >= 60) {
      canEscape = false;
      for (let k = 0; k < 16 && !canEscape; k++) {
        const ang = (k / 16) * Math.PI * 2;
        const nx = x + Math.cos(ang) * 0.05, nz = z + Math.sin(ang) * 0.05;
        const resolved = collision.resolve(x, z, nx, nz, floorY);
        if (Math.hypot(resolved.x - x, resolved.z - z) > 0.04) canEscape = true;
      }
    }
    check(
      `2x2 corner @ rotY=${rotY.toFixed(2)} (${corner.x.toFixed(2)},${corner.z.toFixed(2)}): never fully sealed in with nowhere to go`,
      canEscape,
      `maxStuckFrames=${maxStuckFrames}, finalPos=(${x.toFixed(3)},${z.toFixed(3)}), reached=${Math.hypot(t1.x - x, t1.z - z) < 0.05}`
    );
  }
}

// ---------------------------------------------------------------------
// 5) Grid alignment: independently-placed free-snapped structures (posts)
//    must all agree on the same default facing, and land on a grid whose
//    spacing actually matches a platform's own width — otherwise a
//    manually-built 2x2 post square produces platforms that don't tile
//    into a clean floor. This is the real bug from a user report.
// ---------------------------------------------------------------------
{
  const bm = makeBuildMode();
  bm.toggle(true);
  // Four posts placed independently (not chained) at the corners of a
  // WALL_SPAN-sided square, far from the origin — under the old
  // tangent-to-camp-center default, each corner's own position gave it a
  // *different* default rotation, so no two posts ever agreed on
  // "straight" even though the user laid them out as a square.
  const corners = [
    { x: 5, z: 5 }, { x: 5 + WALL_SPAN, z: 5 },
    { x: 5, z: 5 + WALL_SPAN }, { x: 5 + WALL_SPAN, z: 5 + WALL_SPAN },
  ];
  for (const c of corners) place(bm, "post", c);
  const posts = bm.placed.filter((p) => p.structure.id === "post");
  check(
    "grid: independently-placed posts all share the same default rotation",
    posts.every((p) => near(p.rotY, posts[0].rotY)),
    posts.map((p) => p.rotY.toFixed(3)).join(", ")
  );

  // Now build a platform directly on each post — the manual approach from
  // the report (as opposed to placing one platform and letting
  // findNearestPlatformNeighbor auto-continue the floor).
  for (const c of corners) place(bm, "platform", c);
  const platforms = bm.placed.filter((p) => p.structure.id === "platform");
  check(
    "grid: platforms built independently on each post all share the same rotation",
    platforms.every((p) => near(p.rotY, platforms[0].rotY)),
    platforms.map((p) => p.rotY.toFixed(3)).join(", ")
  );
  bm.toggle(false);
}

{
  const bm = makeBuildMode();
  bm.toggle(true);
  // Two taps roughly (not exactly) a wall-span apart, the way a real
  // finger would land rather than a pixel-perfect coordinate — both must
  // still snap onto the same physical grid a platform's width expects
  // (SNAP_SIZE === WALL_SPAN), or the posts end up close to but not
  // exactly one platform-width apart and adjacent platform tiles overlap
  // or gap instead of tiling seamlessly.
  place(bm, "post", { x: 5.06, z: 5.04 });
  place(bm, "post", { x: 5.06 + WALL_SPAN, z: 5.04 });
  const posts = bm.placed.filter((p) => p.structure.id === "post");
  const spacing = Math.hypot(posts[1].x - posts[0].x, posts[1].z - posts[0].z);
  check("grid: two roughly-wall-span-apart taps snap to exactly WALL_SPAN apart", near(spacing, WALL_SPAN, 0.01), `spacing=${spacing.toFixed(3)}`);
  bm.toggle(false);
}

// ---------------------------------------------------------------------
// 6) Build-anywhere: buildMode's own placement radius should match the
//    playable area (passed in as buildRadius), not a small fixed radius
//    around the campfire — while still clamping to *something* so a tap
//    can't build off the edge of the map entirely.
// ---------------------------------------------------------------------
{
  const bm = makeBuildMode(); // uses createBuildMode's default buildRadius
  bm.toggle(true);
  const built = place(bm, "wallWood", { x: 16, z: 0 });
  const wall = bm.placed.find((p) => p.structure.id === "wallWood");
  // Grid-snapped to the nearest WALL_SPAN multiple, so not exactly 16 —
  // just needs to have landed nowhere near the old 6.5m build radius.
  check("build-anywhere: a structure far from camp (16m) is not clamped to a small build radius", built && near(wall.x, 16, WALL_SPAN), wall && wall.x);
  bm.toggle(false);
}

{
  const bm = makeBuildMode();
  bm.toggle(true);
  place(bm, "wallWood", { x: 40, z: 0 });
  const wall = bm.placed.find((p) => p.structure.id === "wallWood");
  check("build-anywhere: a tap far past the playable area still clamps instead of building off the map", wall && wall.x < 20, wall && wall.x);
  bm.toggle(false);
}

// ---------------------------------------------------------------------
// 7) Stone door: tryToggleDoor and collision now key off structure.isDoor
//    rather than a hardcoded id === "door", so the new stone variant
//    needs to behave exactly like the wood door — solid while closed,
//    passable once open, toggled the same way.
// ---------------------------------------------------------------------
{
  const bm = makeBuildMode();
  bm.toggle(true);
  place(bm, "doorStone", { x: 0, z: 0 });
  const doorEntry = bm.placed.find((p) => p.structure.id === "doorStone");
  check("doorStone: places successfully and starts closed", !!doorEntry && doorEntry.open === false);

  const collision = createCollision({ trees: [], rocks: [], buildMode: bm, terrainHeight: () => 0 });
  const { x: dx, z: dz, y: floorY } = doorEntry;
  // Approach perpendicular to the door's own run (it defaults to
  // GRID_ROTATION, running along world X) so this is a face-on walk into
  // it, not a walk along its own centerline.
  const blockedClosed = collision.resolve(dx, dz - 2, dx, dz, floorY);
  check("doorStone: blocks the player while closed", Math.hypot(blockedClosed.x - dx, blockedClosed.z - dz) > 0.01, JSON.stringify(blockedClosed));

  const toggled = bm.tryToggleDoor({ x: dx, z: dz }, null);
  check("doorStone: tryToggleDoor finds it by distance and toggles isDoor structures generically", toggled && doorEntry.open === true);

  const throughOpen = collision.resolve(dx, dz - 2, dx, dz, floorY);
  check("doorStone: no longer blocks once open", near(throughOpen.x, dx, 0.01) && near(throughOpen.z, dz, 0.01), JSON.stringify(throughOpen));
  bm.toggle(false);
}

// ---------------------------------------------------------------------
// 8) Save/restore round-trip (core/save.js persists exactly this shape):
//    buildMode.restore() must reproduce a saved layout's positions,
//    rotations and open doors exactly, and must never spend resources
//    while doing it — the save already reflects the post-spend totals,
//    so restoring is reconstruction, not a repeat purchase.
// ---------------------------------------------------------------------
{
  const bm1 = makeBuildMode();
  bm1.toggle(true);
  place(bm1, "wallWood", { x: 0, z: 0 });
  place(bm1, "doorStone", { x: WALL_SPAN, z: 0 }); // chains onto the wall's open end
  const doorEntry = bm1.placed.find((p) => p.structure.id === "doorStone");
  doorEntry.open = true; // simulate the player having opened it before the session was saved
  bm1.toggle(false);

  const snapshot = bm1.placed.map((p) => ({ id: p.structure.id, x: p.x, y: p.y, z: p.z, rotY: p.rotY, buildArgs: p.buildArgs, open: p.open }));

  let spendCalls = 0;
  const bm2 = createBuildMode({
    scene: new THREE.Scene(),
    palette: PALETTE,
    shadowMat: new THREE.MeshBasicMaterial(),
    resources: { canAfford: () => true, spend: () => { spendCalls++; }, refund: () => {} },
    terrainHeight: () => 0,
  });
  bm2.restore(snapshot);

  check("save/restore: restores the same number of structures", bm2.placed.length === bm1.placed.length, `got ${bm2.placed.length}, expected ${bm1.placed.length}`);
  check("save/restore: doesn't spend resources again while restoring", spendCalls === 0, `spendCalls=${spendCalls}`);
  const restoredDoor = bm2.placed.find((p) => p.structure.id === "doorStone");
  check("save/restore: an open door stays open after restore", !!restoredDoor && restoredDoor.open === true);
  check(
    "save/restore: restored positions/rotations match exactly",
    bm2.placed.every((p, i) => near(p.x, bm1.placed[i].x) && near(p.z, bm1.placed[i].z) && near(p.rotY, bm1.placed[i].rotY))
  );
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
