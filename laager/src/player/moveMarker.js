import * as THREE from "three";

// A ring that pops in at the tap point and fades out — feedback that the
// tap registered and where the player is walking to.
export function createMoveMarker(scene) {
  const geo = new THREE.RingGeometry(0.28, 0.4, 16);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffe9b0, transparent: true, opacity: 0, depthWrite: false, fog: false });
  const mesh = new THREE.Mesh(geo, mat);
  scene.add(mesh);

  const duration = 0.55;
  let life = 0;

  return {
    show(x, y, z) {
      mesh.position.set(x, y + 0.03, z);
      life = duration;
    },
    update(dt) {
      if (life <= 0) {
        mat.opacity = 0;
        return;
      }
      life -= dt;
      const t = 1 - Math.max(life, 0) / duration;
      mesh.scale.setScalar(0.4 + t * 0.9);
      mat.opacity = (1 - t) * 0.85;
    },
  };
}
