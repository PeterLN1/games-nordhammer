import * as THREE from "three";

const HIP_H = 0.42;    // leg length / hip height
const TORSO_H = 0.4;   // shoulder height = HIP_H + TORSO_H
const LEG_W = 0.12, LEG_D = 0.13;
const ARM_W = 0.09, ARM_H = 0.34, ARM_D = 0.09;
const ARM_X = 0.225;   // shoulder offset

function limb(mat, w, h, d) {
  // a pivot group at the top of the limb, with the mesh hanging below it,
  // so rotating the pivot swings the limb from the hip/shoulder
  const pivot = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.y = -h / 2;
  pivot.add(mesh);
  return pivot;
}

// A simple low-poly "peg doll" person: separate legs and arms (as swinging
// limbs) plus a torso, cape and head, all flat-shaded boxes/cones so the
// silhouette reads as human without adding real per-vertex cost.
export function buildCharacterModel(palette) {
  const tunicMat = new THREE.MeshStandardMaterial({ color: palette.playerCloak, flatShading: true, roughness: 0.9 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(palette.playerCloak).multiplyScalar(0.55), flatShading: true, roughness: 0.9 });
  const skinMat = new THREE.MeshStandardMaterial({ color: palette.playerHead, flatShading: true, roughness: 0.8 });

  const root = new THREE.Group();

  const legL = limb(pantsMat, LEG_W, HIP_H, LEG_D);
  legL.position.set(-0.09, HIP_H, 0);
  const legR = limb(pantsMat, LEG_W, HIP_H, LEG_D);
  legR.position.set(0.09, HIP_H, 0);
  root.add(legL, legR);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.34, TORSO_H, 0.2), tunicMat);
  torso.position.set(0, HIP_H + TORSO_H / 2, 0);
  root.add(torso);

  const shoulderY = HIP_H + TORSO_H;
  const armL = limb(tunicMat, ARM_W, ARM_H, ARM_D);
  armL.position.set(-ARM_X, shoulderY, 0);
  const armR = limb(tunicMat, ARM_W, ARM_H, ARM_D);
  armR.position.set(ARM_X, shoulderY, 0);
  root.add(armL, armR);

  // small cape hanging from the shoulders, mostly for silhouette from behind
  const cape = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.5, 4), pantsMat);
  cape.rotation.y = Math.PI / 4;
  cape.position.set(0, shoulderY - 0.16, -0.1);
  root.add(cape);

  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.17, 0), skinMat);
  head.position.set(0, shoulderY + 0.2, 0);
  root.add(head);

  return { root, legL, legR, armL, armR };
}
