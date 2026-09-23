import * as THREE from "three";

// Pure height function so the player camera and the forest scatter sample
// exactly the same ground shape the mesh was built with, with no per-frame
// raycasting. Gentle, everywhere — no flattened clearing at spawn, the
// player just starts in the middle of it like everywhere else.
export function terrainHeight(x, z) {
  return (Math.sin(x * 0.18) + Math.cos(z * 0.15)) * 0.35 + Math.sin(x * 0.6 + z * 0.4) * 0.12;
}

export function buildGround(scene, palette) {
  const size = 170, seg = 80;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, terrainHeight(pos.getX(i), pos.getZ(i)));
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: palette.ground, flatShading: true, roughness: 1 });
  const ground = new THREE.Mesh(geo, mat);
  scene.add(ground);
  return { ground };
}
