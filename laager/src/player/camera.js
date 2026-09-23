import * as THREE from "three";
import { terrainHeight } from "../world/terrain.js";
import { resolveCollision } from "../world/collision.js";

const EYE_HEIGHT = 1.65;
const MOVE_SPEED = 2.4; // m/s — deliberately slow, this is a walk, not a sprint
const PLAYER_RADIUS = 0.35;
const LOOK_SENSITIVITY = 0.0028;
const PITCH_LIMIT = Math.PI * 0.42;

// First-person camera rig: owns yaw/pitch and ground position, resolves
// movement against tree collision, and applies a light head-bob while
// walking. `camera.rotation.order` must stay "YXZ" for yaw/pitch to
// compose the way a first-person view expects.
export function createPlayerCamera(camera, spawn = { x: 0, z: 0 }) {
  camera.rotation.order = "YXZ";
  let x = spawn.x, z = spawn.z;
  let yaw = 0, pitch = 0;
  let distanceWalked = 0;

  function applyLook(dx, dy) {
    yaw -= dx * LOOK_SENSITIVITY;
    pitch = THREE.MathUtils.clamp(pitch - dy * LOOK_SENSITIVITY, -PITCH_LIMIT, PITCH_LIMIT);
  }

  // input: {forward, strafe}, each in [-1, 1], relative to facing direction
  function update(dt, input, obstacles, bounds) {
    const mag = Math.hypot(input.forward, input.strafe);
    const scale = mag > 1 ? 1 / mag : 1;
    const forward = input.forward * scale;
    const strafe = input.strafe * scale;

    const sin = Math.sin(yaw), cos = Math.cos(yaw);
    const dx = (-sin * forward + cos * strafe) * MOVE_SPEED * dt;
    const dz = (-cos * forward - sin * strafe) * MOVE_SPEED * dt;

    let nx = x + dx, nz = z + dz;
    const resolved = resolveCollision({ x: nx, z: nz }, PLAYER_RADIUS, obstacles);
    nx = resolved.x; nz = resolved.z;

    if (bounds) {
      const d = Math.hypot(nx, nz);
      if (d > bounds) { nx *= bounds / d; nz *= bounds / d; }
    }

    distanceWalked += Math.hypot(nx - x, nz - z);
    x = nx; z = nz;

    const bob = mag > 0.05 ? Math.sin(distanceWalked * 5.2) * 0.035 : 0;
    camera.position.set(x, terrainHeight(x, z) + EYE_HEIGHT + bob, z);
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;
  }

  return {
    applyLook,
    update,
    get position() { return { x, z }; },
    get distanceWalked() { return distanceWalked; },
  };
}
