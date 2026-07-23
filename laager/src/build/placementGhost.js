import * as THREE from "three";

// A translucent preview of the currently selected structure. Its meshes'
// real materials are swapped for a shared green/red ghost material so it
// costs nothing extra to build and clearly signals valid/invalid placement.
export function createPlacementGhost(scene, palette) {
  const validMat = new THREE.MeshBasicMaterial({ color: 0x8fe08a, transparent: true, opacity: 0.45, depthWrite: false, fog: false });
  const invalidMat = new THREE.MeshBasicMaterial({ color: 0xe0665a, transparent: true, opacity: 0.45, depthWrite: false, fog: false });

  let object = null;
  let valid = true;

  function applyMat() {
    if (!object) return;
    object.traverse((child) => {
      if (child.isMesh) child.material = valid ? validMat : invalidMat;
    });
  }

  return {
    setShape(structure) {
      this.clear();
      object = structure.build(palette);
      object.visible = false;
      scene.add(object);
      applyMat();
    },
    moveTo(x, y, z, rotY) {
      if (!object) return;
      object.position.set(x, y, z);
      object.rotation.y = rotY;
      object.visible = true;
    },
    setValid(v) {
      if (valid === v) return;
      valid = v;
      applyMat();
    },
    hide() {
      if (object) object.visible = false;
    },
    get isValid() { return valid; },
    get object() { return object; },
    clear() {
      if (object) {
        scene.remove(object);
        object = null;
      }
      valid = true;
    },
  };
}
