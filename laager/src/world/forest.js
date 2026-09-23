import * as THREE from "three";
import { scatterForest } from "./poissonScatter.js";
import { terrainHeight } from "./terrain.js";

const FOREST_RADIUS = 62;
const MIN_TREE_DIST = 2.1;
const MAX_TREES = 900;

// Collision radius is deliberately smaller than the visual canopy — it's
// meant to feel like the trunk, not the whole tree, or the forest would be
// unwalkable at this density.
const TRUNK_COLLIDE_RADIUS = 0.32;

// Instanced trunk + 2 cone tiers per tree, scattered densely enough that
// sight lines stay short even before the fog takes over. Returns the
// scatter as simple {x, z, radius} circles for movement collision.
export function buildForest(scene, palette, { seed, exclusions }) {
  const items = scatterForest({ seed, radius: FOREST_RADIUS, minDist: MIN_TREE_DIST, maxPoints: MAX_TREES, exclusions });

  const trunkGeo = new THREE.CylinderGeometry(0.1, 0.16, 2.2, 5);
  const coneGeo1 = new THREE.ConeGeometry(1.0, 2.6, 6);
  const coneGeo2 = new THREE.ConeGeometry(0.7, 2.0, 6);
  const trunkMat = new THREE.MeshStandardMaterial({ color: palette.trunk, flatShading: true, roughness: 1 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 1 });

  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, items.length);
  const cones1 = new THREE.InstancedMesh(coneGeo1, leafMat, items.length);
  const cones2 = new THREE.InstancedMesh(coneGeo2, leafMat, items.length);

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const color = new THREE.Color();

  items.forEach((it, i) => {
    const s = it.scale;
    const y = terrainHeight(it.x, it.z);
    q.setFromAxisAngle(up, it.rot);
    sc.set(s, s, s);

    m.compose(new THREE.Vector3(it.x, y + 1.1 * s, it.z), q, sc);
    trunks.setMatrixAt(i, m);

    m.compose(new THREE.Vector3(it.x, y + 2.6 * s, it.z), q, sc);
    cones1.setMatrixAt(i, m);
    color.set(palette.leaves[i % palette.leaves.length]);
    cones1.setColorAt(i, color);

    m.compose(new THREE.Vector3(it.x, y + 3.9 * s, it.z), q, sc);
    cones2.setMatrixAt(i, m);
    cones2.setColorAt(i, color);
  });

  scene.add(trunks, cones1, cones2);

  return items.map((it) => ({ x: it.x, z: it.z, radius: TRUNK_COLLIDE_RADIUS * it.scale }));
}
