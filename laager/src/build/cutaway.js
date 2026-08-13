import * as THREE from "three";
import { roofCovers } from "./roofCoverage.js";

const FADE_OPACITY = 0.18;
const FADE_SPEED = 9; // higher = snappier fade

// Fades out whatever's blocking the view of the player: a roof the player
// is standing under, and any wall between the camera and the player. Both
// checks are cheap (a handful of distance checks + one raycast) since a
// camp only ever has a small number of built structures.
export function createCutaway() {
  const raycaster = new THREE.Raycaster();
  let lastActive = new Set();

  return {
    // Meshes currently faded out (roof over the player, wall between
    // camera and player) — tap-targeting excludes these, so a tap
    // "through" a see-through roof reaches the wall/ground beneath it
    // instead of hitting the invisible-looking but still-solid roof.
    getFaded() {
      return lastActive;
    },

    update(placed, playerPos, camera, dt) {
      const active = new Set();
      lastActive = active;

      // roofs: fade if the player is anywhere under the sloped panel's
      // actual footprint — see roofCoverage.js for the shared math (also
      // used by world/shelter.js to decide if a roof counts as cover).
      for (const p of placed) {
        if (roofCovers(p, playerPos)) active.add(p.mesh);
      }

      // walls: fade if they sit between the camera and the player — a
      // gable wall is snapMode "top" (it rests on a wall's top) but reads
      // visually as a small vertical wall, so it belongs in this
      // occlusion check rather than the roof-coverage one above.
      const wallEntries = placed.filter((p) => (p.structure.snapMode === "edge" || p.structure.id === "gableWall") && p.structure.id !== "post");
      if (wallEntries.length) {
        const from = camera.position;
        const to = new THREE.Vector3(playerPos.x, playerPos.y + 1, playerPos.z);
        const toTarget = to.clone().sub(from);
        const dist = toTarget.length();
        if (dist > 0.01) {
          raycaster.set(from, toTarget.normalize());
          raycaster.near = 0;
          raycaster.far = Math.max(dist - 0.4, 0);
          const wallMeshes = wallEntries.map((p) => p.mesh);
          const hits = raycaster.intersectObjects(wallMeshes, true);
          hits.forEach((h) => {
            let obj = h.object;
            while (obj && !wallMeshes.includes(obj)) obj = obj.parent;
            if (obj) active.add(obj);
          });
        }
      }

      const alpha = Math.min(1, dt * FADE_SPEED);
      for (const p of placed) {
        if (p.structure.snapMode === "topPost") continue; // platforms aren't faded
        const target = active.has(p.mesh) ? FADE_OPACITY : 1;
        p.mesh.traverse((child) => {
          if (child.isMesh) child.material.opacity = THREE.MathUtils.lerp(child.material.opacity, target, alpha);
        });
      }
    },
  };
}
