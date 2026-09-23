// All sound here is synthesized with the Web Audio API — no audio files
// ship with this game, so there's nothing to license, fetch, or keep in
// sync with a save format. Created lazily on the first user gesture, since
// browsers block audio playback before one.
export function createAmbience() {
  let ctx = null;
  let started = false;
  let lastStepDistance = 0;

  function buildNoiseBuffer(seconds) {
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function playCrack() {
    const src = ctx.createBufferSource();
    src.buffer = buildNoiseBuffer(0.25);
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 900 + Math.random() * 600;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start();
  }

  function scheduleDistantSound() {
    const delay = 14000 + Math.random() * 26000;
    setTimeout(() => {
      if (ctx) playCrack();
      scheduleDistantSound();
    }, delay);
  }

  function start() {
    if (started) return;
    started = true;
    ctx = new (window.AudioContext || window.webkitAudioContext)();

    // Wind/forest bed: filtered noise with a slow LFO on the cutoff so it
    // swells and fades instead of sitting at an obviously constant pitch.
    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = buildNoiseBuffer(4);
    noiseSource.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 420;

    const windGain = ctx.createGain();
    windGain.gain.value = 0.05;

    noiseSource.connect(filter).connect(windGain).connect(ctx.destination);
    noiseSource.start();

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 180;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start();

    scheduleDistantSound();
  }

  function playFootstep() {
    const src = ctx.createBufferSource();
    src.buffer = buildNoiseBuffer(0.12);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 260;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start();
  }

  return {
    start,
    // Call every frame with the player's total distance walked — fires a
    // footstep each time another ~0.85m has passed, silent while standing
    // still since distance simply stops accumulating.
    onDistanceWalked(totalDistance) {
      if (!ctx) return;
      if (totalDistance - lastStepDistance >= 0.85) {
        lastStepDistance = totalDistance;
        playFootstep();
      }
    },
  };
}
