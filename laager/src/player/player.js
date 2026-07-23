import * as THREE from "three";
import { lerpAngle } from "../core/utils.js";
import { buildCharacterModel } from "./characterModel.js";

const STOP_DIST = 0.03;
const TURN_SPEED = 10; // rad/sec-ish, via lerp factor below
const WALK_CYCLE_SPEED = 8;
const WALK_SWING_MAX = 0.55;
const SWING_EASE = 8;

export class Player {
  constructor(scene, palette, shadowMat, terrainHeight, spawn = new THREE.Vector3(0, 0, 2.6)) {
    this.terrainHeight = terrainHeight;
    this.speed = 3.2;
    this.position = spawn.clone();
    this.target = spawn.clone();
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

  moveTo(x, z) {
    this.target.set(x, 0, z);
  }

  update(dt) {
    const dx = this.target.x - this.position.x;
    const dz = this.target.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    const moving = dist > STOP_DIST;
    if (moving) {
      const step = Math.min(this.speed * dt, dist);
      this.position.x += (dx / dist) * step;
      this.position.z += (dz / dist) * step;
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
