// Pushes a moving circle (the player) out of any overlapping static circle
// obstacle (a tree trunk), sliding along the obstacle's edge instead of
// stopping dead — trees are the only obstacles in this world, so plain
// circle-vs-circle resolution is all that's needed.
export function resolveCollision(pos, radius, obstacles) {
  let x = pos.x, z = pos.z;
  for (const ob of obstacles) {
    const dx = x - ob.x, dz = z - ob.z;
    const minDist = radius + ob.radius;
    const dist = Math.hypot(dx, dz);
    if (dist === 0) {
      x += minDist;
    } else if (dist < minDist) {
      const push = (minDist - dist) / dist;
      x += dx * push;
      z += dz * push;
    }
  }
  return { x, z };
}
