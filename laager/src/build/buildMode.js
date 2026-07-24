import { STRUCTURES, SNAP_SIZE } from "./structures.js";
import { createPlacementGhost } from "./placementGhost.js";
import { addShadowBlob } from "../core/shadowDecals.js";

const BUILD_RADIUS = 6.5; // how far from camp you can place structures
const NEIGHBOR_SEARCH_RADIUS = 2.2; // how close a tap must be to an existing corner to snap onto it

function snap(v) {
  return Math.round(v / SNAP_SIZE) * SNAP_SIZE;
}

// Structures default to facing tangent to the camp center, so placing one
// with no neighbors nearby still leans toward curving into a palisade ring.
function tangentRotation(x, z) {
  return Math.atan2(x, z) + Math.PI / 2;
}

function clampToBuildRadius(point) {
  const len = Math.hypot(point.x, point.z);
  if (len <= BUILD_RADIUS) return { x: point.x, z: point.z };
  const s = BUILD_RADIUS / len;
  return { x: point.x * s, z: point.z * s };
}

function forward(rotY) {
  return { x: Math.cos(rotY), z: -Math.sin(rotY) };
}

// The two open ends of a placed structure, in world space, each carrying
// the structure's own facing as the "continue straight from here" default.
function endPoints(p) {
  const dir = forward(p.rotY);
  const half = p.structure.width / 2;
  return [
    { x: p.x + dir.x * half, z: p.z + dir.z * half, rotY: p.rotY },
    { x: p.x - dir.x * half, z: p.z - dir.z * half, rotY: p.rotY },
  ];
}

// Nearest open end of any placed structure to the tap point, if close
// enough to count as "aiming at that corner" rather than free placement.
function findNearestCorner(point, placed) {
  let best = null, bestDist = Infinity;
  for (const p of placed) {
    for (const end of endPoints(p)) {
      const d = Math.hypot(end.x - point.x, end.z - point.z);
      if (d < NEIGHBOR_SEARCH_RADIUS && d < bestDist) {
        bestDist = d;
        best = end;
      }
    }
  }
  return best;
}

export function createBuildMode({ scene, palette, shadowMat, resources, terrainHeight }) {
  const ghost = createPlacementGhost(scene, palette);
  const placed = []; // {x, z, rotY, structure, mesh, shadowMesh}
  let active = false;
  let demolish = false;
  let selected = null;
  let pending = null; // {x, y, z, rotY, structure, affordable}

  // Where the current placement is anchored: either a fixed world corner
  // (pivot set — rotating swings the piece around that point, so you can
  // turn a corner) or a fixed grid cell (pivot null — rotating spins the
  // piece in place, for free-standing pieces with no neighbor to snap to).
  let pivot = null;
  let freeCenter = null;
  let currentRotY = 0;

  function commitGhost() {
    let x, z;
    if (pivot) {
      const dir = forward(currentRotY);
      x = pivot.x + dir.x * (selected.width / 2);
      z = pivot.z + dir.z * (selected.width / 2);
    } else {
      x = freeCenter.x; z = freeCenter.z;
    }
    const y = terrainHeight(x, z);
    ghost.moveTo(x, y, z, currentRotY);
    const affordable = resources.canAfford(selected.cost);
    ghost.setValid(affordable);
    pending = { x, y, z, rotY: currentRotY, structure: selected, affordable };
  }

  return {
    get active() { return active; },
    get demolishActive() { return demolish; },
    get selectedId() { return selected ? selected.id : null; },
    get canConfirm() { return !!(pending && pending.affordable); },

    toggle(force) {
      active = force !== undefined ? force : !active;
      if (active) demolish = false;
      if (!active) {
        selected = null;
        pending = null;
        pivot = null;
        ghost.clear();
      }
      return active;
    },

    toggleDemolish(force) {
      demolish = force !== undefined ? force : !demolish;
      if (demolish) this.toggle(false);
      return demolish;
    },

    selectStructure(id) {
      selected = STRUCTURES[id] || null;
      pending = null;
      pivot = null;
      if (selected) ghost.setShape(selected);
      else ghost.clear();
    },

    handleTap(point) {
      if (!active || !selected) return;
      const clamped = clampToBuildRadius(point);
      const corner = findNearestCorner(clamped, placed);
      if (corner) {
        pivot = { x: corner.x, z: corner.z };
        currentRotY = corner.rotY; // default: continue straight from this end
      } else {
        pivot = null;
        freeCenter = { x: snap(clamped.x), z: snap(clamped.z) };
        currentRotY = tangentRotation(freeCenter.x, freeCenter.z);
      }
      commitGhost();
    },

    // Nudges the pending piece's angle. With a pivot locked (built onto an
    // existing corner) this swings around that corner — e.g. one 90° turn
    // to close a square instead of only ever extending in a straight line.
    // With no pivot it just spins the piece in place.
    rotate(stepRad) {
      if (!pending) return;
      currentRotY += stepRad;
      commitGhost();
    },

    confirm() {
      if (!pending || !pending.affordable) return false;
      resources.spend(pending.structure.cost);
      const mesh = pending.structure.build(palette);
      mesh.position.set(pending.x, pending.y, pending.z);
      mesh.rotation.y = pending.rotY;
      scene.add(mesh);
      const shadowMesh = addShadowBlob(scene, shadowMat, pending.x, pending.z, pending.structure.shadowRadius);
      placed.push({ x: pending.x, z: pending.z, rotY: pending.rotY, structure: pending.structure, mesh, shadowMesh });
      pending = null;
      pivot = null;
      ghost.hide();
      return true;
    },

    // finds the nearest placed structure to the tap point and removes it,
    // refunding its full cost
    tryDemolish(point) {
      if (!demolish) return false;
      let best = null, bestIndex = -1, bestDist = Infinity;
      placed.forEach((p, i) => {
        const d = Math.hypot(p.x - point.x, p.z - point.z);
        if (d < p.structure.shadowRadius + 0.3 && d < bestDist) {
          bestDist = d; best = p; bestIndex = i;
        }
      });
      if (!best) return false;
      scene.remove(best.mesh);
      scene.remove(best.shadowMesh);
      resources.refund(best.structure.cost);
      placed.splice(bestIndex, 1);
      return true;
    },
  };
}
