import * as THREE from "three";

// Cheap lighting: no shadow maps. The fire is the only dynamic light kept
// here — sun/moon/hemisphere lighting lives in world/sky.js since it's
// driven by the day/night cycle, not by anything fire-related.
//
// Only one flicker light total (not one per built fire) — same
// mobile-performance reasoning as the rest of this scene. It follows
// whichever fire main.js considers "active" (see main.js's activeFires
// list) and switches off entirely when there's no fire built yet, since
// the player no longer spawns with one lit.
export function createLighting(scene) {
  const fireLight = new THREE.PointLight(0xff7b2e, 0, 9, 2);
  scene.add(fireLight);

  return {
    fireLight,
    setFirePosition(x, y, z) {
      fireLight.position.set(x, y + 0.9, z);
    },
    setFireActive(active) {
      if (!active) fireLight.intensity = 0;
      fireLight.userData.active = active;
    },
    updateFireFlicker(elapsed) {
      if (!fireLight.userData.active) return;
      fireLight.intensity = 2.0
        + Math.sin(elapsed * 9) * 0.25
        + Math.sin(elapsed * 23.7) * 0.15
        + (Math.random() - 0.5) * 0.2;
    },
  };
}
