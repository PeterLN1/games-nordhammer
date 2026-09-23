import assert from "node:assert/strict";
import { scatterForest } from "../src/world/poissonScatter.js";

function pairwiseMinDist(points) {
  let min = Infinity;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const d = Math.hypot(points[i].x - points[j].x, points[i].z - points[j].z);
      if (d < min) min = d;
    }
  }
  return min;
}

// Respects minimum spacing
{
  const minDist = 2.1;
  const points = scatterForest({ seed: 42, radius: 40, minDist, maxPoints: 300 });
  assert.ok(points.length > 100, `expected a reasonably dense scatter, got ${points.length}`);
  assert.ok(pairwiseMinDist(points) >= minDist - 1e-9, "no two trees should be closer than minDist");
}

// Deterministic for a given seed
{
  const a = scatterForest({ seed: 7, radius: 30, minDist: 2, maxPoints: 100 });
  const b = scatterForest({ seed: 7, radius: 30, minDist: 2, maxPoints: 100 });
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++) {
    assert.equal(a[i].x, b[i].x);
    assert.equal(a[i].z, b[i].z);
  }
}

// Different seeds diverge
{
  const a = scatterForest({ seed: 1, radius: 30, minDist: 2, maxPoints: 100 });
  const b = scatterForest({ seed: 2, radius: 30, minDist: 2, maxPoints: 100 });
  assert.notEqual(a[0].x, b[0].x);
}

// Exclusion zones are respected
{
  const exclusions = [{ x: 0, z: 0, radius: 5 }];
  const points = scatterForest({ seed: 3, radius: 30, minDist: 1.5, maxPoints: 200, exclusions });
  for (const p of points) {
    assert.ok(Math.hypot(p.x, p.z) >= 5, `point (${p.x}, ${p.z}) fell inside the exclusion zone`);
  }
}

console.log("forestGeneration.test.mjs: OK");
