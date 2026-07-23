import * as THREE from "three";

const CLEARING_INNER = 4.2;
const CLEARING_OUTER = 7.5;

// Pure height function so the player/camera can sample the same terrain
// shape the ground mesh was built with, without raycasting every frame.
export function terrainHeight(x, z) {
  const distFromCamp = Math.hypot(x, z);
  let h = (Math.sin(x * 0.35) + Math.cos(z * 0.3)) * 0.22 + Math.sin(x * 0.9 + z * 0.6) * 0.08;
  const clearing = THREE.MathUtils.smoothstep(distFromCamp, CLEARING_INNER, CLEARING_OUTER);
  return h * clearing;
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

  const clearing = new THREE.Mesh(
    new THREE.CircleGeometry(4.6, 10),
    new THREE.MeshStandardMaterial({ color: palette.clearing, flatShading: true, roughness: 1 })
  );
  clearing.rotation.x = -Math.PI / 2;
  clearing.position.y = 0.01;
  scene.add(clearing);

  return { ground, clearing };
}
