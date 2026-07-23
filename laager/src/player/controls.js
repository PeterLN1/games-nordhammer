import * as THREE from "three";

// Tap/click the ground to walk there. Raycasts against the supplied ground
// meshes to convert a screen point into a world position.
export function createTapToMoveControls(renderer, camera, groundMeshes, onPick) {
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  function handle(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(groundMeshes, false);
    if (hits.length) onPick(hits[0].point);
  }

  renderer.domElement.addEventListener("pointerdown", (e) => {
    if (!e.isPrimary) return; // ignore extra touch points
    handle(e.clientX, e.clientY);
  });
}
