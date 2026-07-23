// Simple resource pool (wood/stone). No gathering yet — that's phase 3 —
// so this just starts with a fixed stock and lets the build system spend it.
export function createResources(initial = { wood: 20, stone: 10 }) {
  const state = { ...initial };
  const listeners = new Set();

  function notify() {
    listeners.forEach((fn) => fn({ ...state }));
  }

  return {
    get wood() { return state.wood; },
    get stone() { return state.stone; },
    canAfford(cost) {
      return state.wood >= (cost.wood || 0) && state.stone >= (cost.stone || 0);
    },
    spend(cost) {
      state.wood -= cost.wood || 0;
      state.stone -= cost.stone || 0;
      notify();
    },
    subscribe(fn) {
      listeners.add(fn);
      fn({ ...state });
      return () => listeners.delete(fn);
    },
  };
}
