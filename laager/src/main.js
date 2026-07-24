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
import { createResources } from "./core/resources.js";
import { createBuildMode } from "./build/buildMode.js";
import { STRUCTURES } from "./build/structures.js";
import { createGridGuide } from "./build/gridGuide.js";

const ROTATE_STEP = Math.PI / 8; // 22.5° per tap of the rotate button

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
const buildToggleBtn = document.getElementById("buildToggle");
const demolishToggleBtn = document.getElementById("demolishToggle");
const buildPanel = document.getElementById("buildPanel");
const structureList = document.getElementById("structureList");
const buildCancelBtn = document.getElementById("buildCancel");
const buildRotateBtn = document.getElementById("buildRotate");
const buildConfirmBtn = document.getElementById("buildConfirm");
const resWoodEl = document.getElementById("resWood");
const resStoneEl = document.getElementById("resStone");

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

// ---------- build system ----------
const resources = createResources();
const buildMode = createBuildMode({ scene, palette: PALETTE, shadowMat, resources, terrainHeight });
const gridGuide = createGridGuide(scene);

resources.subscribe(({ wood, stone }) => {
  resWoodEl.textContent = wood;
  resStoneEl.textContent = stone;
});

Object.values(STRUCTURES).forEach((s) => {
  const btn = document.createElement("button");
  btn.className = "struct-btn";
  btn.dataset.id = s.id;
  btn.innerHTML = `<span class="ic">${s.icon}</span><span>${s.label}</span><span class="cost">${s.cost.wood ? `🪵${s.cost.wood}` : `🪨${s.cost.stone}`}</span>`;
  btn.addEventListener("click", () => {
    buildMode.selectStructure(s.id);
    [...structureList.children].forEach((c) => c.classList.toggle("selected", c === btn));
    buildConfirmBtn.disabled = !buildMode.canConfirm;
  });
  structureList.appendChild(btn);
});

function setBuildActive(active) {
  buildMode.toggle(active);
  buildToggleBtn.classList.toggle("on", active);
  buildPanel.classList.toggle("hidden", !active);
  demolishToggleBtn.classList.toggle("on", buildMode.demolishActive);
  if (active) {
    [...structureList.children].forEach((c) => c.classList.remove("selected"));
    buildConfirmBtn.disabled = true;
    hint.textContent = "Tryck på marken för att placera · ✓ för att bygga";
    hint.classList.remove("hidden");
    gridGuide.show();
  } else {
    hint.classList.add("hidden");
    gridGuide.hide();
  }
}

function setDemolishActive(active) {
  buildMode.toggleDemolish(active);
  demolishToggleBtn.classList.toggle("on", active);
  buildToggleBtn.classList.toggle("on", buildMode.active);
  buildPanel.classList.toggle("hidden", !buildMode.active);
  gridGuide.hide();
  hint.textContent = "Tryck på en byggnad för att riva den";
  hint.classList.toggle("hidden", !active);
}

buildToggleBtn.addEventListener("click", () => setBuildActive(!buildMode.active));
demolishToggleBtn.addEventListener("click", () => setDemolishActive(!buildMode.demolishActive));

// Avbryt always backs all the way out of build mode — a partial "just clear
// the ghost but stay in the panel" state read as broken (tapping it seemed
// to do nothing whenever no ghost happened to be showing).
buildCancelBtn.addEventListener("click", () => setBuildActive(false));

buildRotateBtn.addEventListener("click", () => {
  buildMode.rotate(ROTATE_STEP);
  buildConfirmBtn.disabled = !buildMode.canConfirm;
});

buildConfirmBtn.addEventListener("click", () => {
  if (buildMode.confirm()) buildConfirmBtn.disabled = !buildMode.canConfirm;
});

createTouchControls(renderer, camera, [ground, clearing], {
  onTap(point) {
    if (buildMode.demolishActive) {
      buildMode.tryDemolish(point);
      return;
    }
    if (buildMode.active) {
      buildMode.handleTap(point);
      buildConfirmBtn.disabled = !buildMode.canConfirm;
      return;
    }
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
