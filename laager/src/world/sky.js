import * as THREE from "three";
import { MOON_DIR } from "../core/palette.js";

// vertex-color gradient dome, no texture
function buildDome(palette) {
  const geo = new THREE.SphereGeometry(45, 24, 16);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 45; // -1..1
    const t = THREE.MathUtils.clamp(y * 0.7 + 0.35, 0, 1);
    c.copy(palette.skyHorizon).lerp(palette.skyTop, t);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false });
  return new THREE.Mesh(geo, mat);
}

function buildStars() {
  const count = 260;
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = 42;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI * 0.42; // upper sky only
    pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = r * Math.cos(phi) * 0.9 + 6;
    pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: 0xfff6dd, size: 0.35, sizeAttenuation: false, transparent: true, opacity: 0.8, fog: false });
  return new THREE.Points(geo, mat);
}

function buildMoon(palette) {
  const moon = new THREE.Mesh(
    new THREE.CircleGeometry(1.4, 16),
    new THREE.MeshBasicMaterial({ color: palette.moon, fog: false })
  );
  moon.position.copy(MOON_DIR).multiplyScalar(40);
  moon.lookAt(0, moon.position.y, 0);
  return moon;
}

export function buildSky(scene, palette) {
  scene.add(buildDome(palette));
  scene.add(buildStars());
  scene.add(buildMoon(palette));
}
