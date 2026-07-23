import * as THREE from "three";
import { scatter } from "../core/utils.js";

export function buildRocks(scene, palette) {
  const items = scatter(16, 5.2, 18, 7);
  const geo = new THREE.IcosahedronGeometry(0.4, 0);
  const mat = new THREE.MeshStandardMaterial({ color: palette.rock, flatShading: true, roughness: 1 });
  const mesh = new THREE.InstancedMesh(geo, mat, items.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), euler = new THREE.Euler();
  items.forEach((it, i) => {
    euler.set(Math.random() * Math.PI, it.rot, Math.random() * Math.PI);
    q.setFromEuler(euler);
    const sy = it.scale * (0.5 + Math.random() * 0.4);
    m.compose(new THREE.Vector3(it.x, sy * 0.4, it.z), q, new THREE.Vector3(it.scale, sy, it.scale));
    mesh.setMatrixAt(i, m);
  });
  scene.add(mesh);
}
