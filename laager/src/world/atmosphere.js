import * as THREE from "three";

// The descent is one-way, never cyclic — it's meant to read as "it's
// getting later and darker the longer you're out here", not a day/night
// loop. Long enough that each stage is only noticed in hindsight.
const DAY_TO_NIGHT_SECONDS = 600;

// Four keyframes sampled by elapsed-time progress (0 = just arrived, 1 =
// fully night). Piecewise-lerped between neighbors, same technique as a
// sun-position keyframe table, just driven by a clock instead of an angle.
function stops(palette) {
  return [
    { t: 0.0, sky: palette.skyDay, fog: palette.fogDay, density: 0.05, hemi: 0.75, sun: 0.5, torch: 0 },
    { t: 0.35, sky: palette.skyGolden, fog: palette.fogGolden, density: 0.06, hemi: 0.6, sun: 0.6, torch: 0 },
    { t: 0.7, sky: palette.skyDusk, fog: palette.fogDusk, density: 0.085, hemi: 0.32, sun: 0.12, torch: 0.55 },
    { t: 1.0, sky: palette.skyNight, fog: palette.fogNight, density: 0.11, hemi: 0.12, sun: 0.02, torch: 1.0 },
  ];
}

function sampleStops(list, t) {
  const first = list[0], last = list[list.length - 1];
  if (t <= first.t) return { ...first, mixT: 0, a: first, b: first };
  if (t >= last.t) return { ...last, mixT: 0, a: last, b: last };
  for (let i = 0; i < list.length - 1; i++) {
    const a = list[i], b = list[i + 1];
    if (t <= b.t) return { a, b, mixT: (t - a.t) / (b.t - a.t) };
  }
  return { a: last, b: last, mixT: 0 };
}

export function createAtmosphere(scene, palette) {
  const STOPS = stops(palette);

  scene.fog = new THREE.FogExp2(palette.fogDay.getHex(), STOPS[0].density);
  scene.background = palette.skyDay.clone();

  const hemi = new THREE.HemisphereLight(0x9aa79a, 0x2a2418, STOPS[0].hemi);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xd8dfc8, STOPS[0].sun);
  sun.position.set(-10, 16, -6);
  scene.add(sun);

  // The player's own light — a soft flashlight cone rather than a bare
  // bulb, so it reads as "your presence" pushing back the dark instead of
  // a horror-game beam. Barely matters at midday (see `torch` above),
  // becomes the main thing keeping the fog at bay once it's properly
  // dark. Position/target are updated every frame in main.js to follow
  // the camera and where it's looking.
  const playerLight = new THREE.SpotLight(palette.playerLight, 0, 12, Math.PI * 0.3, 0.65, 1.2);
  scene.add(playerLight);
  const playerLightTarget = new THREE.Object3D();
  scene.add(playerLightTarget);
  playerLight.target = playerLightTarget;

  // Off by default (intensity 0) — brightens as the player nears the exit,
  // see setExitCloseness(). Position is set once in main.js, at EXIT_POS.
  const exitGlow = new THREE.PointLight(palette.exitGlow, 0, 40, 2);
  scene.add(exitGlow);

  const fogColor = new THREE.Color();
  const skyColor = new THREE.Color();
  // SpotLight intensity is in physically-correct candela units in this
  // Three.js version — nothing like the old "0.5-3 range" that worked for
  // hemisphere/directional lights. Tuned empirically in the browser: below
  // ~500 the beam is essentially invisible against the fog, ~1800 reads as
  // a proper handheld light at night. `torch` is 0 through day/golden
  // (ambient light already does the job, the torch would just wash it
  // out), so no separate minimum is needed.
  const TORCH_MAX = 1800;
  let elapsed = 0;
  let duskT = 0;

  return {
    playerLight,
    playerLightTarget,
    exitGlow,
    get duskT() { return duskT; },
    update(dt) {
      elapsed += dt;
      duskT = Math.min(elapsed / DAY_TO_NIGHT_SECONDS, 1);
      const { a, b, mixT } = sampleStops(STOPS, duskT);

      fogColor.copy(a.fog).lerp(b.fog, mixT);
      scene.fog.color.copy(fogColor);
      scene.fog.density = THREE.MathUtils.lerp(a.density, b.density, mixT);

      skyColor.copy(a.sky).lerp(b.sky, mixT);
      scene.background.copy(skyColor);

      hemi.intensity = THREE.MathUtils.lerp(a.hemi, b.hemi, mixT);
      sun.intensity = THREE.MathUtils.lerp(a.sun, b.sun, mixT);

      const torch = THREE.MathUtils.lerp(a.torch, b.torch, mixT);
      playerLight.intensity = torch * TORCH_MAX;
    },
    // A wordless "you're getting somewhere" cue instead of a HUD marker or
    // compass — `closeness` is 0..1, 1 meaning right on top of the exit.
    setExitCloseness(closeness) {
      exitGlow.intensity = THREE.MathUtils.lerp(0, 3.2, closeness);
    },
  };
}
