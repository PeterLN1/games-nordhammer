import { STRUCTURES, SNAP_SIZE, DEFAULT_PLATFORM_HEIGHT } from "./structures.js";
import { createPlacementGhost } from "./placementGhost.js";
import { addShadowBlob } from "../core/shadowDecals.js";

const BUILD_RADIUS = 6.5; // how far from camp you can place structures
const NEIGHBOR_SEARCH_RADIUS = 2.2; // how close a tap must be to an existing edge to snap onto it
const TOP_SEARCH_RADIUS = 1.6; // how close a tap must be to snap a roof/platform onto a top

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

// Nearest placed structure's *top* (its own footprint, at its own height)
// to the tap point — this is how roofs/platforms rest on top of a wall or
// post instead of snapping to its side edge.
function findNearestTop(point, placed, filterFn) {
  let best = null, bestDist = Infinity;
  for (const p of placed) {
    if (p.structure.height == null) continue;
    if (filterFn && !filterFn(p)) continue;
    const d = Math.hypot(p.x - point.x, p.z - point.z);
    if (d < TOP_SEARCH_RADIUS && d < bestDist) {
      bestDist = d;
      best = { x: p.x, z: p.z, y: p.y + p.structure.height, rotY: p.rotY };
    }
  }
  return best;
}

export function createBuildMode({ scene, palette, shadowMat, resources, terrainHeight }) {
  const ghost = createPlacementGhost(scene, palette);
  const placed = []; // {x, y, z, rotY, structure, mesh, shadowMesh}
  let active = false;
  let demolish = false;
  let selected = null;
  let pending = null; // {x, y, z, rotY, structure, affordable}

  // How the current placement is anchored:
  // - "edge" + pivot set: locked onto a neighbor's corner — rotating swings
  //   the piece around that point (lets you turn a 90° corner).
  // - "edge" + no pivot: free grid cell — rotating spins the piece in place.
  // - "top"/"topPost": resting on top of a wall/post (or a fixed default
  //   height if nothing to rest on) — rotating spins it in place there.
  let mode = "edge";
  let pivot = null;
  let freeCenter = null;
  let anchorY = 0;
  let currentRotY = 0;

  function commitGhost() {
    let x, z, y;
    if (mode === "edge") {
      if (pivot) {
        const dir = forward(currentRotY);
        x = pivot.x + dir.x * (selected.width / 2);
        z = pivot.z + dir.z * (selected.width / 2);
      } else {
        x = freeCenter.x; z = freeCenter.z;
      }
      y = terrainHeight(x, z);
    } else {
      x = freeCenter.x; z = freeCenter.z; y = anchorY;
    }
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
    get placed() { return placed; },

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
      mode = selected.snapMode === "edge" ? "edge" : selected.snapMode;

      if (mode === "edge") {
        const corner = findNearestCorner(clamped, placed);
        if (corner) {
          pivot = { x: corner.x, z: corner.z };
          currentRotY = corner.rotY; // default: continue straight from this end
        } else {
          pivot = null;
          freeCenter = { x: snap(clamped.x), z: snap(clamped.z) };
          currentRotY = tangentRotation(freeCenter.x, freeCenter.z);
        }
      } else {
        pivot = null;
        const filter = mode === "topPost" ? (p) => p.structure.id === "post" : null;
        const anchor = findNearestTop(clamped, placed, filter);
        if (anchor) {
          freeCenter = { x: anchor.x, z: anchor.z };
          anchorY = anchor.y;
          currentRotY = anchor.rotY;
        } else {
          freeCenter = { x: snap(clamped.x), z: snap(clamped.z) };
          anchorY = mode === "topPost" ? DEFAULT_PLATFORM_HEIGHT : terrainHeight(freeCenter.x, freeCenter.z);
          currentRotY = tangentRotation(freeCenter.x, freeCenter.z);
        }
      }
      commitGhost();
    },

    // Nudges the pending piece's angle. With an edge-pivot locked (built
    // onto an existing corner) this swings around that corner — e.g. one
    // 90° turn to close a square instead of only ever extending in a
    // straight line. Otherwise it just spins the piece in place.
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
      placed.push({ x: pending.x, y: pending.y, z: pending.z, rotY: pending.rotY, structure: pending.structure, mesh, shadowMesh });
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
