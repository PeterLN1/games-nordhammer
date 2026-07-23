import * as THREE from "three";

export const PALETTE = {
  skyTop: new THREE.Color(0x150c2c),
  skyHorizon: new THREE.Color(0xdd7a4a),
  ground: 0x3c5c3a,
  clearing: 0x8a6b4a,
  trunk: 0x4a3524,
  leaves: [0x2f4a34, 0x35553c, 0x3c5c3f],
  rock: 0x77786f,
  stoneBuilt: 0x8f8f83,
  plank: 0x6b4a30,
  fence: 0x5b4430,
  logs: 0x33210f,
  moon: 0xf3ecd6,
  playerCloak: 0x4c7a8a,
  playerHead: 0xe0b98c,
};

// direction toward the moon/moonlight, shared by the sky dome and the lights
export const MOON_DIR = new THREE.Vector3(-14, 16, -8).normalize();
