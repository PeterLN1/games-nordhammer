import * as THREE from "three";
import { addShadowBlob } from "../core/shadowDecals.js";

// Log lean-to on a cut-stone foundation.
export function buildShelter(scene, palette, shadowMat) {
  const w = 2.6, d = 3.2, h = 1.9, baseH = 0.18;
  const group = new THREE.Group();
  group.position.set(-2.6, 0, -1.6);
  group.rotation.y = 0.5;
  scene.add(group);

  const stoneMat = new THREE.MeshStandardMaterial({ color: palette.stoneBuilt, flatShading: true, roughness: 1 });
  const logMat = new THREE.MeshStandardMaterial({ color: palette.trunk, flatShading: true, roughness: 1 });

  // stone foundation slab
  const base = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, baseH, d + 0.3), stoneMat);
  base.position.y = baseH / 2;
  group.add(base);

  // a few stacked stones flanking the open front, for a "built" accent
  const accentGeo = new THREE.IcosahedronGeometry(0.22, 0);
  [[-w / 2 - 0.15, -d / 2 + 0.2], [w / 2 + 0.15, -d / 2 + 0.2]].forEach(([ax, az]) => {
    for (let s = 0; s < 2; s++) {
      const stone = new THREE.Mesh(accentGeo, stoneMat);
      stone.position.set(ax + (Math.random() - 0.5) * 0.1, baseH + 0.15 + s * 0.28, az);
      stone.rotation.set(Math.random(), Math.random(), Math.random());
      group.add(stone);
    }
  });

  // ridge beam
  const ridge = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, d, 6), logMat);
  ridge.rotation.x = Math.PI / 2;
  ridge.position.set(0, h, 0);
  group.add(ridge);

  // vertical corner posts holding the ridge ends
  [-d / 2, d / 2].forEach((z) => {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, h - baseH, 6), logMat);
    post.position.set(0, (baseH + h) / 2, z);
    group.add(post);
  });

  // sloped roof slats (parallel logs), instanced per side
  const dir = { left: new THREE.Vector3(-w / 2, baseH - h, 0), right: new THREE.Vector3(w / 2, baseH - h, 0) };
  const slatCount = 6, inset = 0.3;
  Object.values(dir).forEach((v) => {
    const len = v.length();
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.clone().normalize());
    const mid = v.clone().multiplyScalar(0.5).setY((h + baseH) / 2);
    const slatGeo = new THREE.CylinderGeometry(0.045, 0.055, len, 5);
    const slats = new THREE.InstancedMesh(slatGeo, logMat, slatCount);
    const m = new THREE.Matrix4();
    for (let i = 0; i < slatCount; i++) {
      const z = -d / 2 + inset + (i / (slatCount - 1)) * (d - inset * 2);
      m.compose(new THREE.Vector3(mid.x, mid.y, z), quat, new THREE.Vector3(1, 1, 1));
      slats.setMatrixAt(i, m);
    }
    group.add(slats);
  });

  addShadowBlob(scene, shadowMat, group.position.x, group.position.z, 2.3);
}
