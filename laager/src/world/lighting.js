import * as THREE from "three";

// Cheap lighting: no shadow maps. The fire is the only dynamic light kept
// here — sun/moon/hemisphere lighting lives in world/sky.js since it's
// driven by the day/night cycle, not by anything fire-related.
export function createLighting(scene) {
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
