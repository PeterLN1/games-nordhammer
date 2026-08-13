import * as THREE from "three";

// A single finger down doesn't commit to "walk here" immediately — it
// waits this long for a second finger to show up and turn the gesture into
// a pinch instead. Long enough to catch a real pinch's second finger,
// short enough that a normal tap doesn't feel delayed.
const TAP_DELAY_MS = 140;

// How far a single finger has to move before it's treated as a camera-
// rotate drag instead of a stationary tap.
const DRAG_THRESHOLD_PX = 10;

// One finger taps to interact with whatever's actually under it —
// raycast against the ground *and* every built structure (nearest hit
// wins), not just the ground plane. Building/demolishing at height used
// to always project onto the flat ground no matter what was visually
// under your finger, which put the inferred point nowhere near an
// elevated wall/platform and made tapping it directly unreliable. A
// single finger that moves past a small threshold instead orbits the
// camera. Two fingers pinch to zoom the follow camera in/out.
//
// getTargets() is called fresh on every tap (not just once) since the
// set of built structures changes as the player builds/demolishes.
export function createTouchControls(renderer, camera, getTargets, { onTap, onPinchZoom, onRotateDrag }) {
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const pointers = new Map(); // pointerId -> {x, y}
  let prevPinchDist = null;
  let tapTimer = null;
  let tapPos = null;
  let dragging = false;
  let lastDragPos = null;

  function raycastFrom(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    return raycaster.intersectObjects(getTargets(), true);
  }

  function pick(clientX, clientY) {
    const hits = raycastFrom(clientX, clientY);
    if (hits.length) onTap(hits[0].point, hits[0].object);
  }

  function pinchDistance() {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function cancelPendingTap() {
    clearTimeout(tapTimer);
    tapTimer = null;
  }

  const el = renderer.domElement;

  el.addEventListener("pointerdown", (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      tapPos = { x: e.clientX, y: e.clientY };
      lastDragPos = { x: e.clientX, y: e.clientY };
      dragging = false;
      cancelPendingTap();
      tapTimer = setTimeout(() => {
        tapTimer = null;
        if (pointers.size < 2 && !dragging) pick(tapPos.x, tapPos.y);
      }, TAP_DELAY_MS);
    } else if (pointers.size === 2) {
      cancelPendingTap(); // a second finger arrived — this is a pinch, not a tap/drag
      dragging = false;
      prevPinchDist = pinchDistance();
    }
  });

  el.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 1) {
      if (!dragging) {
        const dx = e.clientX - tapPos.x, dy = e.clientY - tapPos.y;
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        dragging = true;
        cancelPendingTap();
        lastDragPos = { x: e.clientX, y: e.clientY };
      }
      onRotateDrag(e.clientX - lastDragPos.x, e.clientY - lastDragPos.y);
      lastDragPos = { x: e.clientX, y: e.clientY };
    } else if (pointers.size === 2) {
      const dist = pinchDistance();
      if (prevPinchDist != null) onPinchZoom(dist - prevPinchDist);
      prevPinchDist = dist;
    }
  });

  function release(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) prevPinchDist = null;
    if (pointers.size === 0) dragging = false;
  }
  el.addEventListener("pointerup", release);
  el.addEventListener("pointercancel", release);
}
