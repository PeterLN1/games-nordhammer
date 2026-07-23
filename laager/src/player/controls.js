import * as THREE from "three";

// One finger taps the ground to walk there (raycast against the ground
// meshes). Two fingers pinch to zoom the follow camera in/out. The two
// gestures are told apart by how many pointers are active at once.
export function createTouchControls(renderer, camera, groundMeshes, { onTap, onPinchZoom }) {
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const pointers = new Map(); // pointerId -> {x, y}
  let prevPinchDist = null;

  function pick(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(groundMeshes, false);
    if (hits.length) onTap(hits[0].point);
  }

  function pinchDistance() {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  const el = renderer.domElement;

  el.addEventListener("pointerdown", (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      pick(e.clientX, e.clientY);
    } else if (pointers.size === 2) {
      prevPinchDist = pinchDistance();
    }
  });

  el.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const dist = pinchDistance();
      if (prevPinchDist != null) onPinchZoom(dist - prevPinchDist);
      prevPinchDist = dist;
    }
  });

  function release(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) prevPinchDist = null;
  }
  el.addEventListener("pointerup", release);
  el.addEventListener("pointercancel", release);
}
