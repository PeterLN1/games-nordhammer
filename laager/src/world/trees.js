import * as THREE from "three";
import { scatter } from "../core/utils.js";

// instanced: trunk + 2 cone tiers, plus instanced fake shadow blobs
export function buildTrees(scene, palette, shadowMat) {
  const items = scatter(46, 8, 20, 1);
  const trunkGeo = new THREE.CylinderGeometry(0.09, 0.13, 0.7, 5);
  const coneGeo1 = new THREE.ConeGeometry(0.85, 1.3, 6);
  const coneGeo2 = new THREE.ConeGeometry(0.6, 1.1, 6);
  const trunkMat = new THREE.MeshStandardMaterial({ color: palette.trunk, flatShading: true, roughness: 1 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 1 });

  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, items.length);
  const cones1 = new THREE.InstancedMesh(coneGeo1, leafMat, items.length);
  const cones2 = new THREE.InstancedMesh(coneGeo2, leafMat, items.length);
  const shadowBlobs = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 8), shadowMat, items.length);
  shadowBlobs.rotateX(-Math.PI / 2);

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const color = new THREE.Color();

  items.forEach((it, i) => {
    const s = it.scale;
    q.setFromAxisAngle(up, it.rot);

    sc.set(s, s, s);
    m.compose(new THREE.Vector3(it.x, 0.35 * s, it.z), q, sc);
    trunks.setMatrixAt(i, m);

    m.compose(new THREE.Vector3(it.x, 1.05 * s, it.z), q, sc);
    cones1.setMatrixAt(i, m);
    color.set(palette.leaves[i % palette.leaves.length]);
    cones1.setColorAt(i, color);

    m.compose(new THREE.Vector3(it.x, 1.75 * s, it.z), q, sc);
    cones2.setMatrixAt(i, m);
    cones2.setColorAt(i, color);

    const sm = new THREE.Matrix4().compose(new THREE.Vector3(it.x, 0.02, it.z), new THREE.Quaternion(), new THREE.Vector3(0.9 * s, 0.9 * s, 1));
    shadowBlobs.setMatrixAt(i, sm);
  });

  scene.add(trunks, cones1, cones2, shadowBlobs);
}
