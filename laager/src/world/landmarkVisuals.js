import * as THREE from "three";
import { LANDMARKS } from "./landmarks.js";
import { terrainHeight } from "./terrain.js";

// A small glowing marker per landmark — dim enough not to read as a
// gameplay waypoint from a distance, just something that catches the eye
// once you're close in the fog. Disappears once its fragment is found.
export function buildLandmarkVisuals(scene, palette) {
  const geo = new THREE.OctahedronGeometry(0.22, 0);
  const mat = new THREE.MeshStandardMaterial({
    color: palette.landmarkGlow,
    emissive: palette.landmarkGlow,
    emissiveIntensity: 0.6,
    flatShading: true,
  });

  const markers = LANDMARKS.map((lm) => {
    const mesh = new THREE.Mesh(geo, mat);
    const y = terrainHeight(lm.x, lm.z);
    mesh.position.set(lm.x, y + 0.5, lm.z);
    scene.add(mesh);
    return { id: lm.id, mesh };
  });

  return {
    hide(id) {
      const found = markers.find((m) => m.id === id);
      if (found) found.mesh.visible = false;
    },
    update(dt, elapsed) {
      markers.forEach((m, i) => {
        if (!m.mesh.visible) return;
        m.mesh.rotation.y += dt * 0.6;
        m.mesh.position.y += Math.sin(elapsed * 1.6 + i) * 0.0015;
      });
    },
  };
}
