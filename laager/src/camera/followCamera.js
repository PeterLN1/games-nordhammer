import * as THREE from "three";

// Fixed-angle chase camera: follows the player's position (not their
// facing) at a constant world-space offset. Simpler and less nauseating
// on mobile than a rotating third-person orbit, and keeps taps unambiguous
// since the camera never changes on input.
export class FollowCamera {
  constructor(camera, baseFov = 42) {
    this.camera = camera;
    this.baseFov = baseFov; // desired *horizontal* fov
    this.offset = new THREE.Vector3(7, 8.5, 9);
    this.lookOffset = new THREE.Vector3(0, 1.1, 0);
    this.current = new THREE.Vector3();
  }

  resize(aspect) {
    this.camera.aspect = aspect;
    const vFov = aspect < 1
      ? THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(this.baseFov) / 2) / aspect))
      : this.baseFov;
    this.camera.fov = Math.min(vFov, 80);
    this.camera.updateProjectionMatrix();
  }

  snapTo(targetPos) {
    this.current.copy(targetPos).add(this.offset);
    this.camera.position.copy(this.current);
    this.camera.lookAt(targetPos.clone().add(this.lookOffset));
  }

  update(targetPos, dt) {
    const desired = targetPos.clone().add(this.offset);
    const alpha = 1 - Math.pow(0.0008, dt); // frame-rate independent smoothing
    this.current.lerp(desired, alpha);
    this.camera.position.copy(this.current);
    this.camera.lookAt(targetPos.clone().add(this.lookOffset));
  }
}
