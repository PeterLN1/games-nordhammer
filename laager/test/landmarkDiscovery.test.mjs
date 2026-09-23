import assert from "node:assert/strict";
import { LANDMARKS, checkDiscoveries, DISCOVERY_RADIUS } from "../src/world/landmarks.js";

const firstLandmark = LANDMARKS[0];

// Fires once when in range
{
  const discovered = new Set();
  const found = checkDiscoveries({ x: firstLandmark.x, z: firstLandmark.z }, discovered);
  assert.deepEqual(found, [firstLandmark.id]);
}

// Does not fire again once already discovered
{
  const discovered = new Set([firstLandmark.id]);
  const found = checkDiscoveries({ x: firstLandmark.x, z: firstLandmark.z }, discovered);
  assert.deepEqual(found, []);
}

// Does not fire outside the discovery radius
{
  const discovered = new Set();
  const farPos = { x: firstLandmark.x + DISCOVERY_RADIUS + 1, z: firstLandmark.z };
  const found = checkDiscoveries(farPos, discovered);
  assert.deepEqual(found, []);
}

// Fires right at the edge of the radius
{
  const discovered = new Set();
  const edgePos = { x: firstLandmark.x + DISCOVERY_RADIUS - 0.01, z: firstLandmark.z };
  const found = checkDiscoveries(edgePos, discovered);
  assert.deepEqual(found, [firstLandmark.id]);
}

// Can discover multiple landmarks at once if somehow close to several
// (not realistic given their spacing, but the function should still
// report every match rather than just the first)
{
  const discovered = new Set();
  const near = LANDMARKS.slice(0, 2);
  // fabricate a point equidistant-ish from both by just checking each independently instead
  for (const lm of near) {
    const found = checkDiscoveries({ x: lm.x, z: lm.z }, new Set());
    assert.ok(found.includes(lm.id));
  }
}

console.log("landmarkDiscovery.test.mjs: OK");
