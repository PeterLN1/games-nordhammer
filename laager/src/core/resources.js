// Simple resource pool (wood/stone/grass). The player wakes up with
// nothing — see world/gathering.js for how wood/stone actually enter this
// pool (tapping a tree/rock nearby). Grass has no gathering source yet, so
// anything that costs grass (roof, ridgeRoof) stays out of reach until
// that's added — intentional: it's the "later, with better tools" tier,
// not day-one gear.
export function createResources(initial = { wood: 0, stone: 0, grass: 0 }) {
  const state = { ...initial };
  const listeners = new Set();

  function notify() {
    listeners.forEach((fn) => fn({ ...state }));
  }

  return {
    get wood() { return state.wood; },
    get stone() { return state.stone; },
    get grass() { return state.grass; },
    canAfford(cost) {
      return state.wood >= (cost.wood || 0) && state.stone >= (cost.stone || 0) && state.grass >= (cost.grass || 0);
    },
    spend(cost) {
      state.wood -= cost.wood || 0;
      state.stone -= cost.stone || 0;
      state.grass -= cost.grass || 0;
      notify();
    },
    // Adds resources to the pool — used both by a demolished structure's
    // refund and by actually gathering wood/stone from the world (see
    // world/gathering.js). Same operation either way, just a different
    // caller/reason.
    add(amounts) {
      state.wood += amounts.wood || 0;
      state.stone += amounts.stone || 0;
      state.grass += amounts.grass || 0;
      notify();
    },
    refund(cost) {
      this.add(cost);
    },
    subscribe(fn) {
      listeners.add(fn);
      fn({ ...state });
      return () => listeners.delete(fn);
    },
  };
}
