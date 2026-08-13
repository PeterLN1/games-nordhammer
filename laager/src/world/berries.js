import * as THREE from "three";
import { scatter } from "../core/utils.js";

// Low berry bushes — food, tapped the same way as trees/rocks (see
// world/gathering.js). Fewer and closer-in than the trees/rocks scatter:
// this is meant to be a findable, specific thing ("utforska för att hitta
// ... några bär"), not scenery scattered everywhere.
export function buildBerries(scene, palette) {
  const items = scatter(8, 4, 15, 3);
  const berriesPerBush = 4;

  const bushGeo = new THREE.IcosahedronGeometry(0.32, 0);
  const bushMat = new THREE.MeshStandardMaterial({ color: palette.leaves[1], flatShading: true, roughness: 1 });
  const bush = new THREE.InstancedMesh(bushGeo, bushMat, items.length);

  const berryGeo = new THREE.IcosahedronGeometry(0.05, 0);
  const berryMat = new THREE.MeshStandardMaterial({ color: palette.berry, flatShading: true, roughness: 0.5 });
  const berries = new THREE.InstancedMesh(berryGeo, berryMat, items.length * berriesPerBush);

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  items.forEach((it, i) => {
    const s = it.scale * 0.55; // noticeably smaller than trees/rocks — a low bush, not a landmark
    q.setFromAxisAngle(up, it.rot);
    m.compose(new THREE.Vector3(it.x, 0.28 * s, it.z), q, new THREE.Vector3(s, s * 0.8, s));
    bush.setMatrixAt(i, m);

    for (let b = 0; b < berriesPerBush; b++) {
      const a = (b / berriesPerBush) * Math.PI * 2 + it.rot;
      const bx = it.x + Math.cos(a) * 0.22 * s;
      const bz = it.z + Math.sin(a) * 0.22 * s;
      m.compose(new THREE.Vector3(bx, 0.42 * s, bz), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
      berries.setMatrixAt(i * berriesPerBush + b, m);
    }
  });

  scene.add(bush, berries);
  return items; // {x, z, rot, scale} per bush, for gathering.js to tap
}
