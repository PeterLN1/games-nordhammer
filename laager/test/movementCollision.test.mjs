import assert from "node:assert/strict";
import { resolveCollision } from "../src/world/collision.js";

// No obstacles nearby: position is unchanged
{
  const result = resolveCollision({ x: 5, z: 5 }, 0.35, [{ x: 0, z: 0, radius: 0.3 }]);
  assert.equal(result.x, 5);
  assert.equal(result.z, 5);
}

// Overlapping obstacle: pushed out to exactly touching distance
{
  const result = resolveCollision({ x: 0.2, z: 0 }, 0.35, [{ x: 0, z: 0, radius: 0.3 }]);
  const dist = Math.hypot(result.x, result.z);
  assert.ok(Math.abs(dist - 0.65) < 1e-9, `expected distance 0.65, got ${dist}`);
}

// Pushed straight away from the obstacle along the same line of approach
{
  const result = resolveCollision({ x: 0, z: 0.1 }, 0.35, [{ x: 0, z: 0, radius: 0.3 }]);
  assert.ok(Math.abs(result.x) < 1e-9, "should not gain any x offset when approaching along z");
  assert.ok(result.z > 0.1, "should be pushed further along z, away from the obstacle");
}

// Multiple obstacles in the list: only the one actually overlapped affects
// the result, distant ones are left alone. (Two obstacles whose own
// clearance zones overlap each other can't both be satisfied at once —
// that never happens in-game since trees are spaced further apart than any
// possible combined player+tree clearance, so it's not a scenario this
// function needs to solve.)
{
  const obstacles = [{ x: 0, z: 0, radius: 0.3 }, { x: 5, z: 0, radius: 0.3 }];
  const result = resolveCollision({ x: 0.2, z: 0 }, 0.35, obstacles);
  assert.ok(Math.abs(Math.hypot(result.x, result.z) - 0.65) < 1e-9, "pushed to exactly clear the near obstacle");
  assert.ok(Math.hypot(result.x - 5, result.z) > 0.65, "far obstacle stays clear, unaffected");
}

console.log("movementCollision.test.mjs: OK");
