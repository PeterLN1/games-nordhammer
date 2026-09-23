import * as THREE from "three";

// Dusk-worn, desaturated palette — the forest should feel a little
// unwelcoming even before anything happens, not like a cozy campsite.
export const PALETTE = {
  skyDay: new THREE.Color(0x5c6a5e),
  skyDusk: new THREE.Color(0x241f2c),
  fogDay: new THREE.Color(0x6e7a6a),
  fogDusk: new THREE.Color(0x1c1622),
  ground: 0x3a4232,
  trunk: 0x3a2e22,
  trunkBirch: 0x5c584e,
  // Conifers (dominant): a spread of cool, muted greens for per-tree
  // variation. Deciduous (minority): warmer, yellower tones so the two
  // species read as visually distinct in the fog, not just different
  // silhouettes.
  leaves: [0x293b2a, 0x2f4530, 0x24331f, 0x33472e, 0x263a2d],
  leavesDeciduous: [0x4a5730, 0x565f34, 0x3e4a29, 0x505933],
  landmarkGlow: 0xd8b06a,
  exitGlow: 0xf0d9a0,
  playerLight: 0xe9c98a,
};
