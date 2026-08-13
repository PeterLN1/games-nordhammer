import * as THREE from "three";

// Pure height function so the player/camera can sample the same terrain
// shape the ground mesh was built with, without raycasting every frame.
// No flattened patch anywhere — the player wakes up in the middle of the
// wilderness, not at a prepared camp spot, so the ground undulates the
// same near spawn as everywhere else.
export function terrainHeight(x, z) {
  return (Math.sin(x * 0.35) + Math.cos(z * 0.3)) * 0.22 + Math.sin(x * 0.9 + z * 0.6) * 0.08;
}

export function buildGround(scene, palette) {
  const size = 46, seg = 40;
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
