import * as THREE from "three";

const MIN_ZOOM = 0.45; // closer
const MAX_ZOOM = 1.7;  // farther
const PINCH_SENSITIVITY = 0.0022;
const MIN_ELEVATION = THREE.MathUtils.degToRad(16);
const MAX_ELEVATION = THREE.MathUtils.degToRad(82);

// Chase camera: follows the player's position (not their facing) at an
// orbit distance/angle the player controls directly — drag rotates,
// pinch zooms — rather than a fixed angle, so the camp can be seen from
// any side. The camera never reacts to a stationary tap, so tap-to-move
// stays unambiguous; only a drag past a small threshold rotates it.
export class FollowCamera {
  constructor(camera, baseFov = 42) {
    this.camera = camera;
    this.baseFov = baseFov; // desired *horizontal* fov
    this.lookOffset = new THREE.Vector3(0, 1.1, 0);
    this.current = new THREE.Vector3();
    this.zoom = 1;

    // initial view angle, expressed as spherical coordinates around the player
    const initial = new THREE.Vector3(7, 8.5, 9);
    this.distance = initial.length();
    this.azimuth = Math.atan2(initial.z, initial.x);
    this.elevation = Math.asin(initial.y / this.distance);
  }

  get offset() {
    const horiz = this.distance * Math.cos(this.elevation);
    return new THREE.Vector3(
      horiz * Math.cos(this.azimuth),
      this.distance * Math.sin(this.elevation),
      horiz * Math.sin(this.azimuth)
    );
  }

  resize(aspect) {
    this.camera.aspect = aspect;
    const vFov = aspect < 1
      ? THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(this.baseFov) / 2) / aspect))
      : this.baseFov;
    this.camera.fov = Math.min(vFov, 80);
    this.camera.updateProjectionMatrix();
  }

  // spreading fingers (positive pinchDeltaPx) zooms in (closer)
  zoomBy(pinchDeltaPx) {
    this.zoom = THREE.MathUtils.clamp(this.zoom - pinchDeltaPx * PINCH_SENSITIVITY, MIN_ZOOM, MAX_ZOOM);
  }

  // dragging orbits the camera around the player; elevation is clamped so
  // you can't flip over the top or dip below the ground
  rotateBy(deltaAzimuthRad, deltaElevationRad) {
    this.azimuth += deltaAzimuthRad;
    this.elevation = THREE.MathUtils.clamp(this.elevation + deltaElevationRad, MIN_ELEVATION, MAX_ELEVATION);
  }

  snapTo(targetPos) {
    this.current.copy(targetPos).addScaledVector(this.offset, this.zoom);
    this.camera.position.copy(this.current);
    this.camera.lookAt(targetPos.clone().add(this.lookOffset));
  }

  update(targetPos, dt) {
    const desired = targetPos.clone().addScaledVector(this.offset, this.zoom);
    const alpha = 1 - Math.pow(0.0008, dt); // frame-rate independent smoothing
    this.current.lerp(desired, alpha);
    this.camera.position.copy(this.current);
    this.camera.lookAt(targetPos.clone().add(this.lookOffset));
  }
}
