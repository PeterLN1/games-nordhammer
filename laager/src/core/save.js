// A new key from the old build/survival game's "laager-save-v1" — that
// save shape (resources, placed structures) doesn't mean anything here, so
// reusing the key would just let a stale old save collide with this game.
const KEY = "trapped-in-forest-save-v1";

function safeStorage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

// `storage` is injectable so tests can pass a plain in-memory mock instead
// of touching real localStorage.
export function loadSave(storage = safeStorage()) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeSave(data, storage = safeStorage()) {
  if (!storage) return;
  try {
    storage.setItem(KEY, JSON.stringify(data));
  } catch {
    // storage full/unavailable — losing the save silently is fine here
  }
}

export function clearSave(storage = safeStorage()) {
  if (!storage) return;
  try {
    storage.removeItem(KEY);
  } catch {
    // nothing to do if removal fails
  }
}
