import * as THREE from "three";
import { PALETTE } from "./core/palette.js";
import { createJournal } from "./core/journal.js";
import { loadSave, writeSave, clearSave } from "./core/save.js";
import { buildGround, terrainHeight } from "./world/terrain.js";
import { buildForest } from "./world/forest.js";
import { buildFireflies } from "./world/fireflies.js";
import { createAtmosphere } from "./world/atmosphere.js";
import { LANDMARKS, checkDiscoveries } from "./world/landmarks.js";
import { buildLandmarkVisuals } from "./world/landmarkVisuals.js";
import { EXIT_POS, distanceToExit, hasReachedExit } from "./world/exit.js";
import { createPlayerCamera } from "./player/camera.js";
import { createControls } from "./player/controls.js";
import { createAmbience } from "./audio/ambience.js";

/* ---------------------------------------------------------------------
   Trapped in the Forest! — förstapersons atmosfärisk walking sim.
   Inget hot, ingen död: bara en tät, disorienterande skog, spridda
   textfragment att hitta, och en väg ut någonstans därute.
--------------------------------------------------------------------- */

const FOREST_SEED = 1337;
const PLAY_BOUNDS = 62;
const EXIT_GLOW_START_DIST = 26;
const AUTOSAVE_INTERVAL = 10;

const container = document.getElementById("app");
const hint = document.getElementById("hint");
const fpsEl = document.getElementById("fps");
const fragmentCountEl = document.getElementById("fragmentCount");
const journalToggleBtn = document.getElementById("journalToggle");
const journalOverlay = document.getElementById("journalOverlay");
const journalList = document.getElementById("journalList");
const journalCloseBtn = document.getElementById("journalClose");
const discoveryToastEl = document.getElementById("discoveryToast");
const endingOverlay = document.getElementById("endingOverlay");
const endingContinueBtn = document.getElementById("endingContinue");
const endingRestartBtn = document.getElementById("endingRestart");

// ---------- renderer / scene / camera ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 120);

// ---------- world ----------
const atmosphere = createAtmosphere(scene, PALETTE);
buildGround(scene, PALETTE);

const exclusions = [
  { x: 0, z: 0, radius: 4 },
  { x: EXIT_POS.x, z: EXIT_POS.z, radius: 5 },
  ...LANDMARKS.map((lm) => ({ x: lm.x, z: lm.z, radius: 2.2 })),
];
const { obstacles: treeObstacles, updateWind } = buildForest(scene, PALETTE, { seed: FOREST_SEED, exclusions });
const fireflies = buildFireflies(scene, PALETTE, FOREST_SEED ^ 0x51ed);
const landmarkVisuals = buildLandmarkVisuals(scene, PALETTE);

const exitMarker = new THREE.Mesh(
  new THREE.CylinderGeometry(0.05, 0.4, 2.4, 8),
  new THREE.MeshStandardMaterial({ color: PALETTE.exitGlow, emissive: PALETTE.exitGlow, emissiveIntensity: 1.2, flatShading: true })
);
exitMarker.position.set(EXIT_POS.x, terrainHeight(EXIT_POS.x, EXIT_POS.z) + 1.2, EXIT_POS.z);
scene.add(exitMarker);
atmosphere.exitGlow.position.set(EXIT_POS.x, terrainHeight(EXIT_POS.x, EXIT_POS.z) + 1.5, EXIT_POS.z);

// ---------- journal / save ----------
const saved = loadSave();
const journal = createJournal(saved?.discoveredIds);
journal.discovered.forEach((id) => landmarkVisuals.hide(id));

// endingShown is declared further down (with the rest of the player/ending
// wiring) but referenced here — safe since saveGame() is only ever called
// from the render loop, after that declaration has run.
function saveGame() {
  writeSave({ discoveredIds: [...journal.discovered], reachedExit: endingShown });
}

function updateFragmentCount() {
  fragmentCountEl.textContent = `${journal.discovered.size}/${LANDMARKS.length}`;
}
journal.subscribe(updateFragmentCount);

function renderJournalList() {
  journalList.innerHTML = "";
  if (journal.discovered.size === 0) {
    journalList.innerHTML = '<p class="journal-empty">Inget hittat än.</p>';
    return;
  }
  for (const lm of LANDMARKS) {
    if (!journal.has(lm.id)) continue;
    const p = document.createElement("p");
    p.textContent = lm.text;
    journalList.appendChild(p);
  }
}

journalToggleBtn.addEventListener("click", () => {
  renderJournalList();
  journalOverlay.classList.remove("hidden");
});
journalCloseBtn.addEventListener("click", () => journalOverlay.classList.add("hidden"));

let discoveryToastTimer = null;
function showDiscoveryToast(text) {
  discoveryToastEl.textContent = text;
  discoveryToastEl.classList.add("show");
  clearTimeout(discoveryToastTimer);
  discoveryToastTimer = setTimeout(() => discoveryToastEl.classList.remove("show"), 5000);
}

// ---------- player / controls / audio ----------
const playerCam = createPlayerCamera(camera, { x: 0, z: 0 });
const controls = createControls(renderer.domElement, {
  onLook(dx, dy) { playerCam.applyLook(dx, dy); },
});
const ambience = createAmbience();
renderer.domElement.addEventListener("pointerdown", () => ambience.start(), { once: true });
window.addEventListener("keydown", () => ambience.start(), { once: true });

let hintHidden = false;
let endingShown = saved?.reachedExit ?? false;
if (endingShown) endingOverlay.classList.remove("hidden");

endingContinueBtn.addEventListener("click", () => endingOverlay.classList.add("hidden"));
endingRestartBtn.addEventListener("click", () => {
  clearSave();
  location.reload();
});

// ---------- resize ----------
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

// ---------- render loop ----------
const clock = new THREE.Clock();
const lookDir = new THREE.Vector3();
let fpsAccum = 0, fpsFrames = 0, fpsTimer = 0;
let saveTimer = 0;

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.elapsedTime;

  const input = controls.getMoveInput();
  if (!hintHidden && (input.forward || input.strafe)) {
    hintHidden = true;
    hint.classList.add("hidden");
  }

  playerCam.update(dt, input, treeObstacles, PLAY_BOUNDS);
  const pos = playerCam.position;

  atmosphere.playerLight.position.set(camera.position.x, camera.position.y + 0.2, camera.position.z);
  camera.getWorldDirection(lookDir);
  atmosphere.playerLightTarget.position.set(
    camera.position.x + lookDir.x * 5,
    camera.position.y + lookDir.y * 5,
    camera.position.z + lookDir.z * 5
  );

  const exitDist = distanceToExit(pos);
  const closeness = 1 - THREE.MathUtils.clamp(exitDist / EXIT_GLOW_START_DIST, 0, 1);
  atmosphere.setExitCloseness(closeness);
  atmosphere.update(dt);

  updateWind(elapsed);
  fireflies.update(elapsed, atmosphere.duskT);
  landmarkVisuals.update(dt, elapsed);
  ambience.onDistanceWalked(playerCam.distanceWalked);

  const newlyFound = checkDiscoveries(pos, journal.discovered);
  for (const id of newlyFound) {
    journal.add(id);
    landmarkVisuals.hide(id);
    const lm = LANDMARKS.find((l) => l.id === id);
    showDiscoveryToast(lm.text);
    saveGame();
  }

  if (!endingShown && hasReachedExit(pos)) {
    endingShown = true;
    endingOverlay.classList.remove("hidden");
    saveGame();
  }

  renderer.render(scene, camera);

  saveTimer += dt;
  if (saveTimer > AUTOSAVE_INTERVAL) { saveTimer = 0; saveGame(); }

  fpsAccum += dt; fpsFrames++; fpsTimer += dt;
  if (fpsTimer > 0.5) {
    fpsEl.textContent = Math.round(fpsFrames / fpsAccum) + " fps";
    fpsAccum = 0; fpsFrames = 0; fpsTimer = 0;
  }

  requestAnimationFrame(tick);
}
updateFragmentCount();
tick();
