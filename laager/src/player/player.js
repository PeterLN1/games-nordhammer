import * as THREE from "three";
import { lerpAngle } from "../core/utils.js";
import { buildCharacterModel } from "./characterModel.js";
import { findPath } from "./pathfinding.js";

const STOP_DIST = 0.03;
const TURN_SPEED = 10; // rad/sec-ish, via lerp factor below
const WALK_CYCLE_SPEED = 8;
const WALK_SWING_MAX = 0.55;
const SWING_EASE = 8;

export class Player {
  constructor(scene, palette, shadowMat, terrainHeight, collision, spawn = new THREE.Vector3(0, 0, 2.6)) {
    this.terrainHeight = terrainHeight;
    this.collision = collision;
    this.speed = 3.2;
    this.position = spawn.clone();
    this.target = spawn.clone();
    this.waypoints = []; // remaining points after `target`, when routing around an obstacle (see moveTo)
    this.facing = 0;
    this.walkPhase = 0;
    this.swing = 0;

    this.group = new THREE.Group();
    const { root, legL, legR, armL, armR } = buildCharacterModel(palette);
    this.legL = legL; this.legR = legR; this.armL = armL; this.armR = armR;
    this.group.add(root);
    scene.add(this.group);

    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.48, 10), shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    scene.add(this.shadow);

    this._syncTransform();
  }

  // Routes around anything solid in the way (see pathfinding.js) instead
  // of aiming straight at (x,z) — a straight line only works when nothing
  // is actually blocking it, and collision.js's per-frame sliding alone
  // can't get *around* an obstacle, only glide along whichever side of it
  // the player happens to run into. Falls back to the old straight-line
  // target when there's no collision system to query (shouldn't happen
  // in the real game) or when the target is simply unreachable (e.g.
  // sealed behind a closed door) — walking there and stopping at the
  // wall is the correct outcome in that case, same as before.
  moveTo(x, z) {
    this.waypoints = [];
    if (this.collision?.blocked) {
      const y = this.terrainHeight(this.position.x, this.position.z);
      const isBlocked = (px, pz) => this.collision.blocked(px, pz, y);
      const path = findPath({ x: this.position.x, z: this.position.z }, { x, z }, isBlocked);
      if (path && path.length) {
        this.target.set(path[0].x, 0, path[0].z);
        this.waypoints = path.slice(1);
        return;
      }
    }
    this.target.set(x, 0, z);
  }

  update(dt) {
    let dx = this.target.x - this.position.x;
    let dz = this.target.z - this.position.z;
    let dist = Math.hypot(dx, dz);
    // Advance through any remaining waypoints as each one is reached —
    // in the same frame, so arriving at an intermediate corner doesn't
    // cost a stalled frame before continuing toward the next one.
    while (dist <= STOP_DIST && this.waypoints.length) {
      const next = this.waypoints.shift();
      this.target.set(next.x, 0, next.z);
      dx = this.target.x - this.position.x;
      dz = this.target.z - this.position.z;
      dist = Math.hypot(dx, dz);
    }
    const moving = dist > STOP_DIST;
    if (moving) {
      const step = Math.min(this.speed * dt, dist);
      const nx = this.position.x + (dx / dist) * step;
      const nz = this.position.z + (dz / dist) * step;
      const currentY = this.terrainHeight(this.position.x, this.position.z);
      const resolved = this.collision ? this.collision.resolve(this.position.x, this.position.z, nx, nz, currentY) : { x: nx, z: nz };
      this.position.x = resolved.x;
      this.position.z = resolved.z;
      const desiredFacing = Math.atan2(dx, dz);
      this.facing = lerpAngle(this.facing, desiredFacing, Math.min(1, dt * TURN_SPEED));
      this.walkPhase += dt * WALK_CYCLE_SPEED;
    }
    this.swing = THREE.MathUtils.lerp(this.swing, moving ? WALK_SWING_MAX : 0, Math.min(1, dt * SWING_EASE));
    this._syncTransform();
  }

  _syncTransform() {
    const y = this.terrainHeight(this.position.x, this.position.z);
    this.group.position.set(this.position.x, y, this.position.z);
    this.group.rotation.y = this.facing;
    this.shadow.position.set(this.position.x, y + 0.02, this.position.z);

    const swingAngle = Math.sin(this.walkPhase) * this.swing;
    this.legL.rotation.x = swingAngle;
    this.legR.rotation.x = -swingAngle;
    this.armL.rotation.x = -swingAngle * 0.8;
    this.armR.rotation.x = swingAngle * 0.8;
  }
}
