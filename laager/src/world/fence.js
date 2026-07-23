import * as THREE from "three";

// palisade arc (hints at "build to protect")
export function buildFence(scene, palette) {
  const postGeo = new THREE.CylinderGeometry(0.07, 0.09, 1.3, 5);
  const postMat = new THREE.MeshStandardMaterial({ color: palette.fence, flatShading: true, roughness: 1 });
  const count = 14;
  const mesh = new THREE.InstancedMesh(postGeo, postMat, count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion();
  const radius = 5.4;
  const startA = Math.PI * 0.55, endA = Math.PI * 1.55;
  for (let i = 0; i < count; i++) {
    const a = startA + (i / (count - 1)) * (endA - startA);
    const x = Math.cos(a) * radius, z = Math.sin(a) * radius;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a + Math.random() * 0.15);
    m.compose(new THREE.Vector3(x, 0.6, z), q, new THREE.Vector3(1, 1 + Math.random() * 0.25, 1));
    mesh.setMatrixAt(i, m);
  }
  scene.add(mesh);
}
