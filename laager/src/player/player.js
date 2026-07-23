import * as THREE from "three";
import { lerpAngle } from "../core/utils.js";

const STOP_DIST = 0.03;
const TURN_SPEED = 10; // rad/sec-ish, via lerp factor below

export class Player {
  constructor(scene, palette, shadowMat, terrainHeight, spawn = new THREE.Vector3(0, 0, 2.6)) {
    this.terrainHeight = terrainHeight;
    this.speed = 3.2;
    this.position = spawn.clone();
    this.target = spawn.clone();
    this.facing = 0;

    this.group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: palette.playerCloak, flatShading: true, roughness: 0.9 });
    const headMat = new THREE.MeshStandardMaterial({ color: palette.playerHead, flatShading: true, roughness: 0.8 });

    const body = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.85, 6), bodyMat);
    body.position.y = 0.5;
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 0), headMat);
    head.position.y = 1.05;
    this.group.add(body, head);
    scene.add(this.group);

    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.45, 10), shadowMat);
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
    if (dist > STOP_DIST) {
      const step = Math.min(this.speed * dt, dist);
      this.position.x += (dx / dist) * step;
      this.position.z += (dz / dist) * step;
      const desiredFacing = Math.atan2(dx, dz);
      this.facing = lerpAngle(this.facing, desiredFacing, Math.min(1, dt * TURN_SPEED));
    }
    this._syncTransform();
  }

  _syncTransform() {
    const y = this.terrainHeight(this.position.x, this.position.z);
    this.group.position.set(this.position.x, y, this.position.z);
    this.group.rotation.y = this.facing;
    this.shadow.position.set(this.position.x, y + 0.02, this.position.z);
  }
}
