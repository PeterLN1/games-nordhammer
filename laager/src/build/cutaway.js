import * as THREE from "three";

const ROOF_COVER_RADIUS = 2.0; // how far from a roof's coverage center still counts as "under it"
const FADE_OPACITY = 0.18;
const FADE_SPEED = 9; // higher = snappier fade

// Fades out whatever's blocking the view of the player: a roof the player
// is standing under, and any wall between the camera and the player. Both
// checks are cheap (a handful of distance checks + one raycast) since a
// camp only ever has a small number of built structures.
export function createCutaway() {
  const raycaster = new THREE.Raycaster();

  return {
    update(placed, playerPos, camera, dt) {
      const active = new Set();

      // roofs: fade if the player is standing under their sloped coverage
      for (const p of placed) {
        if (p.structure.snapMode !== "top") continue;
        const outward = { x: Math.sin(p.rotY), z: Math.cos(p.rotY) };
        const coverX = p.x + outward.x * 0.5;
        const coverZ = p.z + outward.z * 0.5;
        const d = Math.hypot(coverX - playerPos.x, coverZ - playerPos.z);
        if (d < ROOF_COVER_RADIUS) active.add(p.mesh);
      }

      // walls: fade if they sit between the camera and the player
      const wallEntries = placed.filter((p) => p.structure.snapMode === "edge" && p.structure.id !== "post");
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
