import * as THREE from "three";
import { PALETTE } from "./core/palette.js";
import { createShadowMaterial } from "./core/shadowDecals.js";
import { buildSky } from "./world/sky.js";
import { createLighting } from "./world/lighting.js";
import { buildGround, terrainHeight } from "./world/terrain.js";
import { buildShelter } from "./world/shelter.js";
import { buildFire, buildEmbers } from "./world/fire.js";
import { buildTrees } from "./world/trees.js";
import { buildRocks } from "./world/rocks.js";
import { buildFence } from "./world/fence.js";
import { Player } from "./player/player.js";
import { createTouchControls } from "./player/controls.js";
import { createMoveMarker } from "./player/moveMarker.js";
import { FollowCamera } from "./camera/followCamera.js";

/* ---------------------------------------------------------------------
   Läger — stiliserad low-poly 3D-prototyp
   Fas 1: spelarkontroll (tap-to-move) + kamera som följer spelaren.
   Mål: snyggt & levande men billigt att rendera på mobil — flat shading
   istället för texturer, inga realtids-skuggor (falska skuggblobbar
   istället), instancing för upprepade objekt.
--------------------------------------------------------------------- */

const container = document.getElementById("app");
const hint = document.getElementById("hint");
const fpsEl = document.getElementById("fps");

const PLAY_RADIUS = 17; // how far from camp the player is allowed to walk

// ---------- renderer / scene / camera ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = PALETTE.skyTop.clone();
scene.fog = new THREE.FogExp2(PALETTE.skyTop.getHex(), 0.028);

const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
const followCam = new FollowCamera(camera);

// ---------- world ----------
const shadowMat = createShadowMaterial();
buildSky(scene, PALETTE);
const lighting = createLighting(scene);
const { ground, clearing } = buildGround(scene, PALETTE);
buildShelter(scene, PALETTE, shadowMat);
buildFire(scene, PALETTE, shadowMat);
const embers = buildEmbers(scene);
buildTrees(scene, PALETTE, shadowMat);
buildRocks(scene, PALETTE);
buildFence(scene, PALETTE);

// ---------- player ----------
const player = new Player(scene, PALETTE, shadowMat, terrainHeight);
const marker = createMoveMarker(scene);

createTouchControls(renderer, camera, [ground, clearing], {
  onTap(point) {
    const len = Math.hypot(point.x, point.z);
    const p = len > PLAY_RADIUS ? point.clone().multiplyScalar(PLAY_RADIUS / len) : point;
    player.moveTo(p.x, p.z);
    marker.show(p.x, terrainHeight(p.x, p.z), p.z);
    hint.classList.add("hidden");
  },
  onPinchZoom(deltaPx) {
    followCam.zoomBy(deltaPx);
  },
});

// ---------- resize ----------
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  followCam.resize(w / h);
}
window.addEventListener("resize", resize);
resize();
followCam.snapTo(player.group.position);

// ---------- render loop ----------
const clock = new THREE.Clock();
let fpsAccum = 0, fpsFrames = 0, fpsTimer = 0;

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);

  lighting.updateFireFlicker(clock.elapsedTime);
  embers.update(dt);
  player.update(dt);
  marker.update(dt);
  followCam.update(player.group.position, dt);

  renderer.render(scene, camera);

  fpsAccum += dt; fpsFrames++; fpsTimer += dt;
  if (fpsTimer > 0.5) {
    fpsEl.textContent = Math.round(fpsFrames / fpsAccum) + " fps";
    fpsAccum = 0; fpsFrames = 0; fpsTimer = 0;
  }

  requestAnimationFrame(tick);
}
tick();
