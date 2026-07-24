// Simple resource pool (wood/stone/grass). No gathering yet — that's phase
// 3 — so this just starts with a generous fixed stock (there's no economy
// to balance yet, so testing the build system shouldn't be bottlenecked
// by running out) and lets the build system spend it.
export function createResources(initial = { wood: 300, stone: 300, grass: 300 }) {
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
    refund(cost) {
      state.wood += cost.wood || 0;
      state.stone += cost.stone || 0;
      state.grass += cost.grass || 0;
      notify();
    },
    subscribe(fn) {
      listeners.add(fn);
      fn({ ...state });
      return () => listeners.delete(fn);
    },
  };
}
