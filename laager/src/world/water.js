import * as THREE from "three";
import { scatter } from "../core/utils.js";

// A couple of small pools — "en bäck med vatten" — drunk from the same
// way trees/rocks are tapped for wood/stone (see world/gathering.js).
// Only a couple of these (unlike the dozens of trees/rocks): it's meant
// to be a specific place worth remembering and walking back to, not
// something you trip over everywhere. Uses terrainHeight (unlike trees/
// rocks, which sit at a fixed height) since a flat disc sitting visibly
// off the sloped ground would read as broken in a way a small tree trunk
// doesn't.
export function buildWater(scene, palette, terrainHeight) {
  const items = scatter(2, 6, 15, 11);
  const geo = new THREE.CircleGeometry(0.9, 12);
  const mat = new THREE.MeshStandardMaterial({
    color: palette.water, flatShading: true, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.88,
  });
  items.forEach((it) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(it.x, terrainHeight(it.x, it.z) + 0.02, it.z);
    scene.add(mesh);
  });
  return items; // {x, z, ...} per pool, for gathering.js to tap
}
