// Tracks which landmark fragments the player has found this session and
// notifies subscribers (the HUD counter, the journal overlay) on every
// change.
export function createJournal(initialIds = []) {
  const discovered = new Set(initialIds);
  const listeners = new Set();

  function notify() {
    listeners.forEach((fn) => fn([...discovered]));
  }

  return {
    get discovered() { return discovered; },
    has(id) { return discovered.has(id); },
    add(id) {
      if (discovered.has(id)) return false;
      discovered.add(id);
      notify();
      return true;
    },
    subscribe(fn) {
      listeners.add(fn);
      fn([...discovered]);
      return () => listeners.delete(fn);
    },
  };
}
