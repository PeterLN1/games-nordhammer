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
  leaves: [0x293b2a, 0x2f4530, 0x24331f],
  landmarkGlow: 0xd8b06a,
  exitGlow: 0xf0d9a0,
  playerLight: 0xe9c98a,
};
