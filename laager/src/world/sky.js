import * as THREE from "three";
import { MOON_DIR } from "../core/palette.js";

// Azimuth axis the sun/moon arc across — the horizontal projection of the
// old fixed MOON_DIR, so time=midnight still looks like the original
// night sky. The sun rises at +AZIMUTH, arcs overhead, sets at -AZIMUTH;
// the moon sits opposite it, so day and night trade off automatically.
const AZIMUTH = new THREE.Vector3(MOON_DIR.x, 0, MOON_DIR.z).normalize();

// Color/intensity keyframes across the sun's elevation (-1 = straight
// down at midnight, 0 = horizon, 1 = straight up at noon). sampleStops()
// interpolates piecewise between neighboring stops, so the whole cycle —
// night -> dawn -> day -> dusk -> night — comes from these four anchors.
const STOPS = [
  { elev: -1.00, skyTop: 0x150c2c, skyHorizon: 0x1a1330, fog: 0x150c2c, hemiSky: 0x38406e, hemiGround: 0x1c1710, hemiI: 0.35, sunI: 0.0, moonI: 0.55, star: 1.0 },
  { elev: -0.12, skyTop: 0x1e1a34, skyHorizon: 0xdd7a4a, fog: 0x2c2130, hemiSky: 0x5c5c82, hemiGround: 0x2c2318, hemiI: 0.55, sunI: 0.25, moonI: 0.30, star: 0.55 },
  { elev: 0.12, skyTop: 0x3d6fb4, skyHorizon: 0xf6c47c, fog: 0x9db3d4, hemiSky: 0x92a6cf, hemiGround: 0x4c3f2a, hemiI: 0.8, sunI: 1.1, moonI: 0.0, star: 0.0 },
  { elev: 0.55, skyTop: 0x2f74d6, skyHorizon: 0xc3e0f6, fog: 0xc7dbee, hemiSky: 0xa3bce6, hemiGround: 0x5d4b31, hemiI: 0.9, sunI: 1.25, moonI: 0.0, star: 0.0 },
];

const cA = new THREE.Color(), cB = new THREE.Color();
function lerpHex(a, b, t) { return cA.set(a).lerp(cB.set(b), t).getHex(); }

function sampleStops(elev) {
  const first = STOPS[0], last = STOPS[STOPS.length - 1];
  if (elev <= first.elev) return first;
  if (elev >= last.elev) return last;
  for (let i = 0; i < STOPS.length - 1; i++) {
    const a = STOPS[i], b = STOPS[i + 1];
    if (elev <= b.elev) {
      const t = (elev - a.elev) / (b.elev - a.elev);
      return {
        skyTop: lerpHex(a.skyTop, b.skyTop, t),
        skyHorizon: lerpHex(a.skyHorizon, b.skyHorizon, t),
        fog: lerpHex(a.fog, b.fog, t),
        hemiSky: lerpHex(a.hemiSky, b.hemiSky, t),
        hemiGround: lerpHex(a.hemiGround, b.hemiGround, t),
        hemiI: THREE.MathUtils.lerp(a.hemiI, b.hemiI, t),
        sunI: THREE.MathUtils.lerp(a.sunI, b.sunI, t),
        moonI: THREE.MathUtils.lerp(a.moonI, b.moonI, t),
        star: THREE.MathUtils.lerp(a.star, b.star, t),
      };
    }
  }
  return last;
}

// Direction toward the sun for time-of-day t in [0,1) (0 = midnight,
// 0.25 = sunrise, 0.5 = noon, 0.75 = sunset). The moon sits at -dir.
function sunDirAt(t) {
  const angle = (t - 0.25) * Math.PI * 2;
  const c = Math.cos(angle), s = Math.sin(angle);
  return new THREE.Vector3(AZIMUTH.x * c, s, AZIMUTH.z * c);
}

// vertex-color gradient dome, no texture — colors get repainted whenever
// the time of day changes instead of being baked in once.
function buildDome() {
  const geo = new THREE.SphereGeometry(45, 24, 16);
  geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3));
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false });
  return new THREE.Mesh(geo, mat);
}

const domeColor = new THREE.Color();
function paintDome(dome, skyTop, skyHorizon) {
  const pos = dome.geometry.attributes.position;
  const colorAttr = dome.geometry.attributes.color;
  cA.set(skyHorizon); cB.set(skyTop);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 45; // -1..1
    const t = THREE.MathUtils.clamp(y * 0.7 + 0.35, 0, 1);
    domeColor.copy(cA).lerp(cB, t);
    colorAttr.setXYZ(i, domeColor.r, domeColor.g, domeColor.b);
  }
  colorAttr.needsUpdate = true;
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

function buildDisc(color) {
  return new THREE.Mesh(
    new THREE.CircleGeometry(1.4, 16),
    new THREE.MeshBasicMaterial({ color, fog: false, transparent: true, depthWrite: false })
  );
}

function horizonFade(y) {
  return THREE.MathUtils.smoothstep(y, -0.05, 0.12);
}

// Owns the whole day/night cycle: sky dome, stars, sun/moon discs, fog,
// and the hemisphere/sun/moon lights. setHours() jumps straight to a time
// (used by the debug slider); update(dt) advances it automatically once
// a speed is set — nothing calls setSpeed yet, so today it's manual-only,
// but the plumbing is there for the day to progress on its own later.
export function createSky(scene, palette) {
  const dome = buildDome();
  scene.add(dome);
  const stars = buildStars();
  scene.add(stars);
  const sunDisc = buildDisc(0xfff2c8);
  const moonDisc = buildDisc(palette.moon);
  scene.add(sunDisc, moonDisc);

  const hemi = new THREE.HemisphereLight(0x8fa0c9, 0x2a2116, 0.65);
  scene.add(hemi);
  const sunLight = new THREE.DirectionalLight(0xfff0d0, 0);
  scene.add(sunLight);
  const moonLight = new THREE.DirectionalLight(0xb9c6ff, 0.55);
  scene.add(moonLight);

  scene.background = palette.skyTop.clone();
  scene.fog = new THREE.FogExp2(palette.skyTop.getHex(), 0.028);

  let time = 0.5; // start at noon — bright, for testing
  let speed = 0; // hours of game-time per real second; 0 = paused

  function apply() {
    const dir = sunDirAt(time);
    const stop = sampleStops(dir.y);

    scene.background.setHex(stop.skyTop);
    paintDome(dome, stop.skyTop, stop.skyHorizon);
    scene.fog.color.setHex(stop.fog);

    hemi.color.setHex(stop.hemiSky);
    hemi.groundColor.setHex(stop.hemiGround);
    hemi.intensity = stop.hemiI;

    sunLight.position.copy(dir).multiplyScalar(20);
    sunLight.intensity = stop.sunI;
    moonLight.position.copy(dir).multiplyScalar(-20);
    moonLight.intensity = stop.moonI;

    stars.material.opacity = 0.8 * stop.star;
    stars.visible = stop.star > 0.01;

    sunDisc.position.copy(dir).multiplyScalar(40);
    sunDisc.lookAt(0, sunDisc.position.y, 0);
    sunDisc.material.opacity = horizonFade(dir.y);
    sunDisc.visible = sunDisc.material.opacity > 0.01;

    moonDisc.position.copy(dir).multiplyScalar(-40);
    moonDisc.lookAt(0, moonDisc.position.y, 0);
    moonDisc.material.opacity = horizonFade(-dir.y);
    moonDisc.visible = moonDisc.material.opacity > 0.01;
  }

  apply();

  return {
    get hours() { return time * 24; },
    get isNight() { return sunDirAt(time).y < 0; },
    setHours(h) {
      time = (((h % 24) + 24) % 24) / 24;
      apply();
    },
    setSpeed(hoursPerSecond) { speed = hoursPerSecond; },
    update(dt) {
      if (!speed) return;
      time = ((time + (speed * dt) / 24) % 1 + 1) % 1;
      apply();
    },
  };
}
