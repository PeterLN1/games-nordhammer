import * as THREE from "three";
import { scatterForest, mulberry32 } from "./poissonScatter.js";
import { terrainHeight } from "./terrain.js";

const FOREST_RADIUS = 62;
const MIN_TREE_DIST = 2.1;
const MAX_TREES = 900;
const DECIDUOUS_RATIO = 0.32; // conifers dominate, a rounded minority breaks up the silhouette

// Collision radius is deliberately smaller than the visual canopy — it's
// meant to feel like the trunk, not the whole tree, or the forest would be
// unwalkable at this density.
const TRUNK_COLLIDE_RADIUS = 0.32;

const up = new THREE.Vector3(0, 1, 0);

// Combines the tree's facing rotation with a small random lean — real
// trees are never perfectly vertical — and returns the composed
// quaternion. `tiltAxis`/`tiltAngle` are per-tree, drawn once and reused
// for every tier so the whole tree leans as one unit.
function leanQuaternion(yaw, tiltAxis, tiltAngle) {
  const q = new THREE.Quaternion().setFromAxisAngle(up, yaw);
  const qTilt = new THREE.Quaternion().setFromAxisAngle(tiltAxis, tiltAngle);
  return q.multiply(qTilt);
}

// Conifers: 3 tapering, independently-jittered tiers instead of 2 perfectly
// stacked cones — the small per-tier horizontal offset is what breaks the
// "Christmas tree" symmetry into something closer to an actual spruce.
const CONIFER_TIERS = [
  { radius: 1.05, height: 2.0, centerY: 1.9, jitter: 0.06 },
  { radius: 0.75, height: 1.7, centerY: 3.0, jitter: 0.09 },
  { radius: 0.48, height: 1.35, centerY: 3.95, jitter: 0.12 },
];

// Deciduous: a lumpy canopy built from 3 overlapping low-poly spheres
// offset around a shared center, instead of one perfect cone/sphere —
// reads as a rounded broadleaf crown even at low poly count.
const DECIDUOUS_BLOBS = [
  { radius: 0.82, offset: [0, 0, 0] },
  { radius: 0.62, offset: [0.42, 0.18, 0.08] },
  { radius: 0.58, offset: [-0.32, -0.05, 0.36] },
];

export function buildForest(scene, palette, { seed, exclusions }) {
  const items = scatterForest({ seed, radius: FOREST_RADIUS, minDist: MIN_TREE_DIST, maxPoints: MAX_TREES, exclusions });
  const rng = mulberry32(seed ^ 0x9e3779b9);

  const conifers = [];
  const deciduous = [];
  for (const it of items) {
    const tiltAxis = new THREE.Vector3(rng() - 0.5, 0, rng() - 0.5).normalize();
    const tiltAngle = rng() * 0.1;
    const entry = { ...it, tiltAxis, tiltAngle, colorT: rng() };
    if (rng() < DECIDUOUS_RATIO) deciduous.push(entry);
    else conifers.push(entry);
  }

  // ---------- conifers ----------
  const conifTrunkGeo = new THREE.CylinderGeometry(0.08, 0.16, 2.2, 6);
  const conifTrunkMat = new THREE.MeshStandardMaterial({ color: palette.trunk, flatShading: true, roughness: 1 });
  const conifTrunks = new THREE.InstancedMesh(conifTrunkGeo, conifTrunkMat, conifers.length);
  const conifTierMeshes = CONIFER_TIERS.map((tier) => {
    const geo = new THREE.ConeGeometry(tier.radius, tier.height, 7);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 1 });
    return new THREE.InstancedMesh(geo, mat, conifers.length);
  });

  const m = new THREE.Matrix4(), sc = new THREE.Vector3(), pos = new THREE.Vector3(), color = new THREE.Color();

  conifers.forEach((it, i) => {
    const s = it.scale;
    const y = terrainHeight(it.x, it.z);
    const q = leanQuaternion(it.rot, it.tiltAxis, it.tiltAngle);
    sc.set(s, s, s);

    pos.set(it.x, y + 1.1 * s, it.z);
    m.compose(pos, q, sc);
    conifTrunks.setMatrixAt(i, m);

    color.set(palette.leaves[Math.floor(it.colorT * palette.leaves.length) % palette.leaves.length]);
    color.offsetHSL((rng() - 0.5) * 0.03, 0, (rng() - 0.5) * 0.06);

    CONIFER_TIERS.forEach((tier, ti) => {
      const jx = (rng() - 0.5) * 2 * tier.jitter;
      const jz = (rng() - 0.5) * 2 * tier.jitter;
      pos.set(it.x + jx * s, y + tier.centerY * s, it.z + jz * s);
      m.compose(pos, q, sc);
      const mesh = conifTierMeshes[ti];
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, color);
    });
  });

  scene.add(conifTrunks, ...conifTierMeshes);

  // ---------- deciduous ----------
  const decidTrunkGeo = new THREE.CylinderGeometry(0.09, 0.17, 1.6, 6);
  const decidTrunkMat = new THREE.MeshStandardMaterial({ color: palette.trunkBirch, flatShading: true, roughness: 1 });
  const decidTrunks = new THREE.InstancedMesh(decidTrunkGeo, decidTrunkMat, deciduous.length);
  const decidBlobMeshes = DECIDUOUS_BLOBS.map((blob) => {
    const geo = new THREE.IcosahedronGeometry(blob.radius, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 1 });
    return new THREE.InstancedMesh(geo, mat, deciduous.length);
  });

  deciduous.forEach((it, i) => {
    const s = it.scale;
    const y = terrainHeight(it.x, it.z);
    const q = leanQuaternion(it.rot, it.tiltAxis, it.tiltAngle);
    sc.set(s, s, s);

    pos.set(it.x, y + 0.8 * s, it.z);
    m.compose(pos, q, sc);
    decidTrunks.setMatrixAt(i, m);

    color.set(palette.leavesDeciduous[Math.floor(it.colorT * palette.leavesDeciduous.length) % palette.leavesDeciduous.length]);
    color.offsetHSL((rng() - 0.5) * 0.03, 0, (rng() - 0.5) * 0.06);

    const canopyCenterY = 2.3;
    DECIDUOUS_BLOBS.forEach((blob, bi) => {
      const [ox, oy, oz] = blob.offset;
      pos.set(it.x + ox * s, y + (canopyCenterY + oy) * s, it.z + oz * s);
      m.compose(pos, q, sc);
      const mesh = decidBlobMeshes[bi];
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, color);
    });
  });

  scene.add(decidTrunks, ...decidBlobMeshes);

  return items.map((it) => ({ x: it.x, z: it.z, radius: TRUNK_COLLIDE_RADIUS * it.scale }));
}
