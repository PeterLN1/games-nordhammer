const MOVE_ZONE_RADIUS = 46; // px of drag for full-speed movement

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Two touch zones on `container`: left half = drag-to-walk (an invisible
// joystick — direction and speed from the drag vector, released = stop),
// right half = drag-to-look. A mouse pointer always looks (desktop moves
// with WASD instead, handled below), since there's no natural way to split
// a single mouse cursor into two zones the way two thumbs can.
export function createControls(container, { onLook }) {
  const keys = new Set();
  let movePointerId = null, moveOrigin = null, moveDX = 0, moveDY = 0;
  let lookPointerId = null, lookLast = null;

  function isMoveZone(clientX) {
    return clientX < window.innerWidth / 2;
  }

  container.addEventListener("pointerdown", (e) => {
    // Rare browsers/multi-touch transitions can reject capture for a
    // pointer id that's already gone by the time this runs — losing
    // capture there just means drags stop tracking outside the canvas,
    // not worth failing the whole handler over.
    try { container.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    if (e.pointerType !== "mouse" && isMoveZone(e.clientX)) {
      movePointerId = e.pointerId;
      moveOrigin = { x: e.clientX, y: e.clientY };
      moveDX = 0; moveDY = 0;
    } else {
      lookPointerId = e.pointerId;
      lookLast = { x: e.clientX, y: e.clientY };
    }
  });

  container.addEventListener("pointermove", (e) => {
    if (e.pointerId === movePointerId && moveOrigin) {
      moveDX = e.clientX - moveOrigin.x;
      moveDY = e.clientY - moveOrigin.y;
    } else if (e.pointerId === lookPointerId && lookLast) {
      const dx = e.clientX - lookLast.x;
      const dy = e.clientY - lookLast.y;
      lookLast = { x: e.clientX, y: e.clientY };
      onLook(dx, dy);
    }
  });

  function endPointer(e) {
    if (e.pointerId === movePointerId) {
      movePointerId = null; moveOrigin = null; moveDX = 0; moveDY = 0;
    }
    if (e.pointerId === lookPointerId) {
      lookPointerId = null; lookLast = null;
    }
  }
  container.addEventListener("pointerup", endPointer);
  container.addEventListener("pointercancel", endPointer);

  window.addEventListener("keydown", (e) => keys.add(e.code));
  window.addEventListener("keyup", (e) => keys.delete(e.code));

  return {
    getMoveInput() {
      let forward = 0, strafe = 0;
      if (movePointerId !== null) {
        forward = -moveDY / MOVE_ZONE_RADIUS;
        strafe = moveDX / MOVE_ZONE_RADIUS;
      }
      if (keys.has("KeyW") || keys.has("ArrowUp")) forward += 1;
      if (keys.has("KeyS") || keys.has("ArrowDown")) forward -= 1;
      if (keys.has("KeyD") || keys.has("ArrowRight")) strafe += 1;
      if (keys.has("KeyA") || keys.has("ArrowLeft")) strafe -= 1;
      return { forward: clamp(forward, -1, 1), strafe: clamp(strafe, -1, 1) };
    },
  };
}
