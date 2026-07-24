import { STRUCTURES, SNAP_SIZE } from "./structures.js";
import { createPlacementGhost } from "./placementGhost.js";
import { addShadowBlob } from "../core/shadowDecals.js";

const BUILD_RADIUS = 6.5; // how far from camp you can place structures
const NEIGHBOR_SEARCH_RADIUS = 2.2; // how close a tap must be to an existing edge to snap onto it

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

// Looks for the nearest open end of an already-placed structure and, if one
// is close enough to the tap, returns the position+rotation that continues
// flush from it — this is what makes a row of walls actually line up
// instead of relying on the tap landing on the exact right grid cell.
function findNeighborAttachment(point, width, placed) {
  let best = null, bestDist = Infinity;
  for (const p of placed) {
    const dirX = Math.cos(p.rotY), dirZ = -Math.sin(p.rotY); // local +X axis in world space
    const half = p.structure.width / 2 + width / 2;
    for (const sign of [1, -1]) {
      const ax = p.x + dirX * half * sign;
      const az = p.z + dirZ * half * sign;
      const d = Math.hypot(ax - point.x, az - point.z);
      if (d < NEIGHBOR_SEARCH_RADIUS && d < bestDist) {
        bestDist = d;
        best = { x: ax, z: az, rotY: p.rotY };
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
  let rotationOverride = null;
  let lastRotY = 0;

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
        rotationOverride = null;
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
      rotationOverride = null;
      if (selected) ghost.setShape(selected);
      else ghost.clear();
    },

    // nudges the ghost by a fixed step; once used, the manual angle sticks
    // for this structure instead of the auto tangent/neighbor logic
    rotate(stepRad) {
      if (!selected) return;
      rotationOverride = (rotationOverride ?? lastRotY) + stepRad;
      if (pending) this.handleTap({ x: pending.x, z: pending.z });
    },

    handleTap(point) {
      if (!active || !selected) return;
      const clamped = clampToBuildRadius(point);
      let x, z, rotY;

      if (rotationOverride != null) {
        x = snap(clamped.x); z = snap(clamped.z);
        rotY = rotationOverride;
      } else {
        const neighbor = findNeighborAttachment(clamped, selected.width, placed);
        if (neighbor) {
          x = neighbor.x; z = neighbor.z; rotY = neighbor.rotY;
        } else {
          x = snap(clamped.x); z = snap(clamped.z);
          rotY = tangentRotation(x, z);
        }
      }

      const y = terrainHeight(x, z);
      ghost.moveTo(x, y, z, rotY);
      const affordable = resources.canAfford(selected.cost);
      ghost.setValid(affordable);
      pending = { x, y, z, rotY, structure: selected, affordable };
      lastRotY = rotY;
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
