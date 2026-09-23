import assert from "node:assert/strict";
import { loadSave, writeSave, clearSave } from "../src/core/save.js";

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
}

// Round-trip
{
  const storage = fakeStorage();
  writeSave({ discoveredIds: ["firepit", "sign"] }, storage);
  const loaded = loadSave(storage);
  assert.deepEqual(loaded, { discoveredIds: ["firepit", "sign"] });
}

// Nothing saved yet
{
  const storage = fakeStorage();
  assert.equal(loadSave(storage), null);
}

// Clear removes it
{
  const storage = fakeStorage();
  writeSave({ discoveredIds: ["toy"] }, storage);
  clearSave(storage);
  assert.equal(loadSave(storage), null);
}

// Corrupt JSON doesn't throw, just reads as null
{
  const storage = fakeStorage();
  storage.setItem("trapped-in-forest-save-v1", "{not json");
  assert.equal(loadSave(storage), null);
}

// No storage available (e.g. private browsing edge cases) doesn't throw
{
  assert.equal(loadSave(null), null);
  writeSave({ discoveredIds: [] }, null);
  clearSave(null);
}

console.log("save.test.mjs: OK");
