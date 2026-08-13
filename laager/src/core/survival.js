// Health/hunger/thirst — the player's actual survival state, as opposed
// to core/resources.js which is the *building* material pool. Hunger and
// thirst drain on their own over time; health only drains as a
// consequence (starving, dehydrated, or cold with no shelter/fire — see
// world/shelter.js), and slowly regenerates back up on its own whenever
// none of those are happening. Reaching 0 health is death.
//
// All the *_PER_SEC rates below are first-pass balance numbers, not
// anything measured — tune freely once this has actually been played.
const HUNGER_DECAY_PER_SEC = 100 / 600; // empty in 10 min
const THIRST_DECAY_PER_SEC = 100 / 420; // empty in 7 min — thirst outpaces hunger, same as real life
const STARVE_DAMAGE_PER_SEC = 100 / 120; // dead in 2 min of being at 0 hunger, if nothing else is wrong
const DEHYDRATE_DAMAGE_PER_SEC = 100 / 100; // dead in 100s at 0 thirst
const COLD_DAMAGE_PER_SEC = 100 / 90; // dead in 90s of unsheltered night cold — the sharpest of the three, matches "cold nights are the first big threat"
const HEALTH_REGEN_PER_SEC = 100 / 300; // full recovery in 5 min once nothing is actively hurting you

function clamp01to100(v) {
  return Math.max(0, Math.min(100, v));
}

export function createSurvival(initial = {}) {
  const state = {
    health: initial.health ?? 100,
    hunger: initial.hunger ?? 100,
    thirst: initial.thirst ?? 100,
  };
  const listeners = new Set();
  let deathCauses = initial.deathCauses ?? []; // whatever was actively hurting on the tick that reached 0 health

  function notify() {
    listeners.forEach((fn) => fn({ ...state }));
  }

  return {
    get health() { return state.health; },
    get hunger() { return state.hunger; },
    get thirst() { return state.thirst; },
    get isDead() { return state.health <= 0; },
    // Which of "hunger"/"thirst"/"cold" were actually killing the player
    // at the moment health hit 0 — main.js turns this into the death
    // screen's message. Empty while still alive.
    get deathCauses() { return deathCauses; },

    eat(amount) {
      state.hunger = clamp01to100(state.hunger + amount);
      notify();
    },
    drink(amount) {
      state.thirst = clamp01to100(state.thirst + amount);
      notify();
    },

    // `cold` is main.js's own isSheltered/isNight check — this module
    // doesn't know about the world, just what to do once told.
    tick(dt, { cold }) {
      if (state.health <= 0) return; // dead — nothing left to simulate
      state.hunger = clamp01to100(state.hunger - HUNGER_DECAY_PER_SEC * dt);
      state.thirst = clamp01to100(state.thirst - THIRST_DECAY_PER_SEC * dt);

      const causes = [];
      let damage = 0;
      if (state.hunger <= 0) { damage += STARVE_DAMAGE_PER_SEC * dt; causes.push("hunger"); }
      if (state.thirst <= 0) { damage += DEHYDRATE_DAMAGE_PER_SEC * dt; causes.push("thirst"); }
      if (cold) { damage += COLD_DAMAGE_PER_SEC * dt; causes.push("cold"); }

      if (damage > 0) {
        state.health = clamp01to100(state.health - damage);
        if (state.health <= 0) deathCauses = causes;
      } else {
        state.health = clamp01to100(state.health + HEALTH_REGEN_PER_SEC * dt);
      }
      notify();
    },

    subscribe(fn) {
      listeners.add(fn);
      fn({ ...state });
      return () => listeners.delete(fn);
    },
  };
}
