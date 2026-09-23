// The way out — a single fixed point far from spawn. Always technically
// reachable (finding it isn't gated behind the landmarks), just hard to
// stumble onto by accident given the fog and tree density.
export const EXIT_POS = { x: 4, z: 58 };
const EXIT_RADIUS = 3;

export function distanceToExit(playerPos) {
  return Math.hypot(playerPos.x - EXIT_POS.x, playerPos.z - EXIT_POS.z);
}

export function hasReachedExit(playerPos) {
  return distanceToExit(playerPos) <= EXIT_RADIUS;
}
