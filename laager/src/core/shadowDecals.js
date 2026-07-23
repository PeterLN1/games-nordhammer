import * as THREE from "three";

// Cheap alternative to real shadow maps: a soft radial-gradient decal
// dropped just above the ground under an object. No lights/shadow camera
// involved, so it costs almost nothing on mobile GPUs.
export function createShadowMaterial() {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(0,0,0,0.55)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false });
}

export function addShadowBlob(scene, shadowMat, x, z, radius) {
  const m = new THREE.Mesh(new THREE.CircleGeometry(radius, 12), shadowMat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.015, z);
  scene.add(m);
  return m;
}
