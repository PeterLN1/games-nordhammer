import * as THREE from "three";
import { MOON_DIR } from "../core/palette.js";

// Cheap lighting: no shadow maps. A hemisphere light for cheap ambient
// sky/ground fill, one directional "moonlight", and a single flickering
// point light at the fire (the only dynamic light in the scene).
export function createLighting(scene) {
  const hemi = new THREE.HemisphereLight(0x8fa0c9, 0x2a2116, 0.65);
  scene.add(hemi);

  const moonLight = new THREE.DirectionalLight(0xb9c6ff, 0.55);
  moonLight.position.copy(MOON_DIR).multiplyScalar(20);
  scene.add(moonLight);

  const fireLight = new THREE.PointLight(0xff7b2e, 2.2, 9, 2);
  fireLight.position.set(0, 0.9, 0);
  scene.add(fireLight);

  return {
    fireLight,
    updateFireFlicker(elapsed) {
      fireLight.intensity = 2.0
        + Math.sin(elapsed * 9) * 0.25
        + Math.sin(elapsed * 23.7) * 0.15
        + (Math.random() - 0.5) * 0.2;
    },
  };
}
