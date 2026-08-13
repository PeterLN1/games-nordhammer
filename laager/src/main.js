import * as THREE from "three";
import { PALETTE } from "./core/palette.js";
import { createShadowMaterial } from "./core/shadowDecals.js";
import { createSky } from "./world/sky.js";
import { createLighting } from "./world/lighting.js";
import { buildGround, terrainHeight } from "./world/terrain.js";
import { buildEmbers } from "./world/fire.js";
import { buildTrees } from "./world/trees.js";
import { buildRocks } from "./world/rocks.js";
import { createGathering } from "./world/gathering.js";
import { Player } from "./player/player.js";
import { createTouchControls } from "./player/controls.js";
import { createMoveMarker } from "./player/moveMarker.js";
import { FollowCamera } from "./camera/followCamera.js";
import { createResources } from "./core/resources.js";
import { loadSave, writeSave, clearSave } from "./core/save.js";
import { createBuildMode, platformSurfaceAt } from "./build/buildMode.js";
import { STRUCTURES } from "./build/structures.js";
import { createCutaway } from "./build/cutaway.js";
import { createPlatformClimb } from "./build/platformClimb.js";
import { createCollision } from "./world/collision.js";

const ROTATE_STEP = Math.PI / 2; // 90° per tap — building is grid-only, no in-between angles
const CAMERA_DRAG_SPEED = 0.008; // radians per pixel of drag

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
const resGrassEl = document.getElementById("resGrass");
const resWoodHudEl = document.getElementById("resWoodHud");
const resStoneHudEl = document.getElementById("resStoneHud");
const resGrassHudEl = document.getElementById("resGrassHud");
const gatherToastEl = document.getElementById("gatherToast");
const resetBtn = document.getElementById("resetGame");
const dayNightSlider = document.getElementById("dayNightSlider");
const dayNightIcon = document.getElementById("dayNightIcon");
const dayNightLabel = document.getElementById("dayNightLabel");

const PLAY_RADIUS = 17; // how far from spawn the player is allowed to walk

// ---------- renderer / scene / camera ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
const followCam = new FollowCamera(camera);

// ---------- world ----------
const shadowMat = createShadowMaterial();
const sky = createSky(scene, PALETTE);
const lighting = createLighting(scene);
const { ground } = buildGround(scene, PALETTE);
const treeItems = buildTrees(scene, PALETTE, shadowMat);
const rockItems = buildRocks(scene, PALETTE);

// ---------- build system ----------
// Loaded once at startup: a previous session's resources/buildings, if
// any, so the camp is exactly as it was left instead of resetting on
// every reload/revisit.
const saved = loadSave();
const resources = createResources(saved?.resources);
const buildMode = createBuildMode({ scene, palette: PALETTE, shadowMat, resources, terrainHeight, buildRadius: PLAY_RADIUS });
if (saved?.placed?.length) buildMode.restore(saved.placed);
const cutaway = createCutaway();
const gathering = createGathering({ treeItems, rockItems, resources });

// ---------- fires: each built "fire" structure gets its own embers
// particle system; only one drives the flicker light (see
// world/lighting.js) since a second dynamic light per campfire isn't
// worth the render cost here. The player no longer spawns with one
// already lit — see build/structures.js's "fire" entry.
const fireEmbers = new Map(); // placed-entry -> embers handle
function addFireEmbers(entry) {
  const handle = buildEmbers();
  handle.points.position.set(entry.x, entry.y, entry.z);
  scene.add(handle.points);
  fireEmbers.set(entry, handle);
  lighting.setFirePosition(entry.x, entry.y, entry.z);
  lighting.setFireActive(true);
}
function removeFireEmbers(entry) {
  const handle = fireEmbers.get(entry);
  if (!handle) return;
  scene.remove(handle.points);
  fireEmbers.delete(entry);
  const remaining = fireEmbers.keys().next().value;
  if (remaining) lighting.setFirePosition(remaining.x, remaining.y, remaining.z);
  else lighting.setFireActive(false);
}
for (const entry of buildMode.placed) {
  if (entry.structure.id === "fire") addFireEmbers(entry);
}

// Persisted after every build/demolish/door-toggle (see call sites below)
// rather than on a timer — those are the only actions that actually
// change what a reload needs to reproduce, so there's no reason to write
// to storage any more often than that.
function saveGame() {
  writeSave({
    version: 1,
    resources: { wood: resources.wood, stone: resources.stone, grass: resources.grass },
    placed: buildMode.placed.map((p) => ({
      id: p.structure.id, x: p.x, y: p.y, z: p.z, rotY: p.rotY, buildArgs: p.buildArgs, open: p.open,
    })),
  });
}

// ---------- player ----------
// The player only stands on a platform's surface after climbing a ladder
// attached to it, and stays up there until walking off its footprint —
// otherwise it's ground height as usual.
const platformClimb = createPlatformClimb();
function playerHeightAt(x, z) {
  return platformClimb.update(x, z, buildMode.placed) ?? terrainHeight(x, z);
}
const collision = createCollision({ trees: treeItems, rocks: rockItems, buildMode, terrainHeight });
const player = new Player(scene, PALETTE, shadowMat, playerHeightAt, collision);
const marker = createMoveMarker(scene);

resources.subscribe(({ wood, stone, grass }) => {
  resWoodEl.textContent = wood;
  resStoneEl.textContent = stone;
  resGrassEl.textContent = grass;
  resWoodHudEl.textContent = wood;
  resStoneHudEl.textContent = stone;
  resGrassHudEl.textContent = grass;
});

const GATHER_ICON = { wood: "🪵", stone: "🪨" };
let gatherToastTimer = null;

// Pops the "+N 🪵" toast in and schedules its fade-out — restarting the
// timer on every call so a quick run of taps keeps it visible instead of
// having it flicker out mid-streak.
function showGatherToast(type, amount) {
  gatherToastEl.textContent = `+${amount} ${GATHER_ICON[type]}`;
  gatherToastEl.classList.add("show");
  clearTimeout(gatherToastTimer);
  gatherToastTimer = setTimeout(() => gatherToastEl.classList.remove("show"), 800);
}

function costLabel(cost) {
  const parts = [];
  if (cost.wood) parts.push(`🪵${cost.wood}`);
  if (cost.stone) parts.push(`🪨${cost.stone}`);
  if (cost.grass) parts.push(`🌾${cost.grass}`);
  return parts.join(" ");
}

function formatClock(hours) {
  const h = Math.floor(hours) % 24;
  const m = Math.round((hours % 1) * 60) % 60;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}
function refreshDayNightUI() {
  dayNightLabel.textContent = formatClock(sky.hours);
  dayNightIcon.textContent = sky.isNight ? "🌙" : "☀️";
}
dayNightSlider.value = sky.hours;
refreshDayNightUI();
dayNightSlider.addEventListener("input", () => {
  sky.setHours(parseFloat(dayNightSlider.value));
  refreshDayNightUI();
});

Object.values(STRUCTURES).forEach((s) => {
  const btn = document.createElement("button");
  btn.className = "struct-btn";
  btn.dataset.id = s.id;
  btn.innerHTML = `<span class="ic">${s.icon}</span><span>${s.label}</span><span class="cost">${costLabel(s.cost)}</span>`;
  btn.addEventListener("click", () => {
    buildMode.selectStructure(s.id);
    [...structureList.children].forEach((c) => c.classList.toggle("selected", c === btn));
    buildConfirmBtn.disabled = !buildMode.canConfirm;
    hint.textContent = "Tryck på marken för att placera · ✓ för att bygga";
    hint.classList.remove("hidden");
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
  } else {
    hint.classList.add("hidden");
  }
}

function setDemolishActive(active) {
  buildMode.toggleDemolish(active);
  demolishToggleBtn.classList.toggle("on", active);
  buildToggleBtn.classList.toggle("on", buildMode.active);
  buildPanel.classList.toggle("hidden", !buildMode.active);
  hint.textContent = "Tryck på en byggnad för att riva den";
  hint.classList.toggle("hidden", !active);
}

buildToggleBtn.addEventListener("click", () => setBuildActive(!buildMode.active));
demolishToggleBtn.addEventListener("click", () => setDemolishActive(!buildMode.demolishActive));

// Wipes the save and reloads rather than trying to reset every in-memory
// system (built meshes, resources, player position, ...) by hand — a
// fresh page load already does that correctly for the "no save" case, so
// clear-then-reload gets a genuinely clean slate for free.
resetBtn.addEventListener("click", () => {
  if (window.confirm("Börja om från början? Allt du har byggt försvinner.")) {
    clearSave();
    location.reload();
  }
});

// Avbryt always backs all the way out of build mode — a partial "just clear
// the ghost but stay in the panel" state read as broken (tapping it seemed
// to do nothing whenever no ghost happened to be showing).
buildCancelBtn.addEventListener("click", () => setBuildActive(false));

buildRotateBtn.addEventListener("click", () => {
  buildMode.rotate(ROTATE_STEP);
  buildConfirmBtn.disabled = !buildMode.canConfirm;
});

buildConfirmBtn.addEventListener("click", () => {
  if (buildMode.confirm()) {
    const last = buildMode.placed[buildMode.placed.length - 1];
    if (last.structure.id === "fire") addFireEmbers(last);
    buildConfirmBtn.disabled = !buildMode.canConfirm;
    saveGame();
  }
});

// Raycast targets include every built structure (not just the ground
// plane), so a tap lands on whatever's actually visually under it —
// recomputed fresh each tap since what's built changes over time.
// Currently-faded structures (a roof over the player, a wall between
// camera and player — see cutaway.js) are left out, so tapping "through"
// one of those reaches the wall/ground behind it instead of hitting the
// see-through-but-still-solid mesh.
function tapTargets() {
  const faded = cutaway.getFaded();
  const structureMeshes = buildMode.placed.filter((p) => !faded.has(p.mesh)).map((p) => p.mesh);
  return [ground, ...structureMeshes];
}

createTouchControls(renderer, camera, tapTargets, {
  onTap(point, hitObject) {
    if (buildMode.demolishActive) {
      const removed = buildMode.tryDemolish(point, hitObject);
      if (removed) {
        if (removed.structure.id === "fire") removeFireEmbers(removed);
        saveGame();
      }
      return;
    }
    if (buildMode.active) {
      buildMode.handleTap(point);
      buildConfirmBtn.disabled = !buildMode.canConfirm;
      return;
    }
    if (buildMode.tryToggleDoor(point, hitObject)) { saveGame(); return; }

    // Trees/rocks aren't raycast targets themselves (see tapTargets above)
    // — a tap that visually lands on one still resolves to roughly its
    // ground position via the ground-plane hit, which is exactly what
    // gathering.tryGather matches against. Too far away just walks the
    // player closer instead of gathering, same as tapping any other spot.
    const gathered = gathering.tryGather(point, player.position);
    if (gathered) {
      const gy = terrainHeight(gathered.x, gathered.z);
      marker.show(gathered.x, gy, gathered.z);
      if (gathered.gathered) {
        showGatherToast(gathered.type, gathered.amount);
        saveGame();
      } else {
        player.moveTo(gathered.x, gathered.z);
      }
      hint.classList.add("hidden");
      return;
    }

    const len = Math.hypot(point.x, point.z);
    const p = len > PLAY_RADIUS ? point.clone().multiplyScalar(PLAY_RADIUS / len) : point;
    player.moveTo(p.x, p.z);
    marker.show(p.x, platformSurfaceAt(p.x, p.z, buildMode.placed) ?? terrainHeight(p.x, p.z), p.z);
    hint.classList.add("hidden");
  },
  onPinchZoom(deltaPx) {
    followCam.zoomBy(deltaPx);
  },
  onRotateDrag(deltaX, deltaY) {
    followCam.rotateBy(-deltaX * CAMERA_DRAG_SPEED, deltaY * CAMERA_DRAG_SPEED);
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

  sky.update(dt);
  lighting.updateFireFlicker(clock.elapsedTime);
  fireEmbers.forEach((handle) => handle.update(dt));
  gathering.advance(dt);
  player.update(dt);
  marker.update(dt);
  followCam.update(player.group.position, dt);
  cutaway.update(buildMode.placed, player.group.position, camera, dt);
  renderer.render(scene, camera);

  fpsAccum += dt; fpsFrames++; fpsTimer += dt;
  if (fpsTimer > 0.5) {
    fpsEl.textContent = Math.round(fpsFrames / fpsAccum) + " fps";
    fpsAccum = 0; fpsFrames = 0; fpsTimer = 0;
  }

  requestAnimationFrame(tick);
}
tick();
