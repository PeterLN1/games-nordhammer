import { STRUCTURES, SNAP_SIZE } from "./structures.js";
import { createPlacementGhost } from "./placementGhost.js";
import { addShadowBlob } from "../core/shadowDecals.js";

function snap(v) {
  return Math.round(v / SNAP_SIZE) * SNAP_SIZE;
}

// Structures snap to a loose grid and default to facing tangent to the camp
// center, so placing several in a row naturally curves into a palisade ring
// (matching the decorative fence's orientation logic).
function tangentRotation(x, z) {
  return Math.atan2(x, z) + Math.PI / 2;
}

export function createBuildMode({ scene, palette, shadowMat, resources, terrainHeight }) {
  const ghost = createPlacementGhost(scene, palette);
  let active = false;
  let selected = null;
  let pending = null; // {x, y, z, rotY, structure}

  return {
    get active() { return active; },
    get selectedId() { return selected ? selected.id : null; },
    get canConfirm() { return !!(pending && pending.affordable); },

    toggle(force) {
      active = force !== undefined ? force : !active;
      if (!active) {
        selected = null;
        pending = null;
        ghost.clear();
      }
      return active;
    },

    selectStructure(id) {
      selected = STRUCTURES[id] || null;
      pending = null;
      if (selected) ghost.setShape(selected);
      else ghost.clear();
    },

    handleTap(point) {
      if (!active || !selected) return;
      const x = snap(point.x), z = snap(point.z);
      const y = terrainHeight(x, z);
      const rotY = tangentRotation(x, z);
      ghost.moveTo(x, y, z, rotY);
      const affordable = resources.canAfford(selected.cost);
      ghost.setValid(affordable);
      pending = { x, y, z, rotY, structure: selected, affordable };
    },

    confirm() {
      if (!pending || !pending.affordable) return false;
      resources.spend(pending.structure.cost);
      const real = pending.structure.build(palette);
      real.position.set(pending.x, pending.y, pending.z);
      real.rotation.y = pending.rotY;
      scene.add(real);
      addShadowBlob(scene, shadowMat, pending.x, pending.z, pending.structure.shadowRadius);
      pending = null;
      ghost.hide();
      return true;
    },
  };
}
