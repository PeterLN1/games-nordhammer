import * as THREE from "three";

// Long enough that the drift from overcast day toward dusk is only ever
// noticed in hindsight, not as a visible "toggle".
const DAY_TO_DUSK_SECONDS = 420;
const FOG_DENSITY_DAY = 0.05;
const FOG_DENSITY_DUSK = 0.085;

export function createAtmosphere(scene, palette) {
  scene.fog = new THREE.FogExp2(palette.fogDay.getHex(), FOG_DENSITY_DAY);
  scene.background = palette.skyDay.clone();

  const hemi = new THREE.HemisphereLight(0x9aa79a, 0x2a2418, 0.75);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xd8dfc8, 0.5);
  sun.position.set(-10, 16, -6);
  scene.add(sun);

  // The player's own faint light — beyond its reach, everything sinks into
  // the fog. Position is updated every frame in main.js to follow the
  // camera.
  const playerLight = new THREE.PointLight(palette.playerLight, 0.9, 9, 2);
  scene.add(playerLight);

  // Off by default (intensity 0) — brightens as the player nears the exit,
  // see setExitCloseness(). Position is set once in main.js, at EXIT_POS.
  const exitGlow = new THREE.PointLight(palette.exitGlow, 0, 40, 2);
  scene.add(exitGlow);

  const fogColor = new THREE.Color();
  let elapsed = 0;

  return {
    playerLight,
    exitGlow,
    update(dt) {
      elapsed += dt;
      const t = Math.min(elapsed / DAY_TO_DUSK_SECONDS, 1);
      fogColor.copy(palette.fogDay).lerp(palette.fogDusk, t);
      scene.fog.color.copy(fogColor);
      scene.fog.density = THREE.MathUtils.lerp(FOG_DENSITY_DAY, FOG_DENSITY_DUSK, t);
      scene.background.copy(palette.skyDay).lerp(palette.skyDusk, t);
      hemi.intensity = THREE.MathUtils.lerp(0.75, 0.32, t);
      sun.intensity = THREE.MathUtils.lerp(0.5, 0.12, t);
    },
    // A wordless "you're getting somewhere" cue instead of a HUD marker or
    // compass — `closeness` is 0..1, 1 meaning right on top of the exit.
    setExitCloseness(closeness) {
      exitGlow.intensity = THREE.MathUtils.lerp(0, 3.2, closeness);
    },
  };
}
