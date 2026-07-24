import * as THREE from "three";
import { SNAP_SIZE } from "./structures.js";

function buildGridTexture() {
  const size = 64;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  ctx.strokeStyle = "rgba(223,232,255,0.9)";
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// A faint square grid patch over the buildable area so it's clear where a
// tap will snap before you commit to it. Only meaningful during placement
// (snap-to-neighbor overrides it once you're building next to something).
export function createGridGuide(scene, radius = 6.5) {
  const size = radius * 2;
  const tex = buildGridTexture();
  const repeats = size / SNAP_SIZE;
  tex.repeat.set(repeats, repeats);

  const geo = new THREE.PlaneGeometry(size, size);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.22, depthWrite: false, fog: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0.025;
  mesh.visible = false;
  scene.add(mesh);

  return {
    show() { mesh.visible = true; },
    hide() { mesh.visible = false; },
  };
}
