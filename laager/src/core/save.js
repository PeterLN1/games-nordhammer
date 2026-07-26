const KEY = "laager-save-v1";

// Wrapped in try/catch throughout: localStorage can throw (private
// browsing in some browsers, storage disabled, quota exceeded) — none of
// that should ever crash the game, just silently fall back to "no save".
export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeSave(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // storage full/blocked — this session still plays fine, it just won't persist
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing to do — if removal fails there was nothing usable stored anyway
  }
}
