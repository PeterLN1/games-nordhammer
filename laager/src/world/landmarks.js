// Fixed, hand-placed points of interest scattered around the spawn point.
// The text is intentionally sparse and unexplained — the player pieces
// together what happened, nothing is spelled out directly.
export const LANDMARKS = [
  { id: "firepit", x: 9, z: -6, text: "En gammal eldstad. Askan är kall, men inte gammal." },
  { id: "sign", x: -14, z: 10, text: "En skylt, vittrad. Bara ett ord går att läsa: VÄND." },
  { id: "toy", x: 22, z: 4, text: "En leksaksbil, rostig, liggandes i mossan." },
  { id: "carving", x: -8, z: -20, text: "Märken i barken, i rader. Någon räknade dagarna." },
  { id: "boot", x: 30, z: -14, text: "En enda sko, snörad hårt, som om den togs av med kraft." },
  { id: "cairn", x: -26, z: -4, text: "En hög av stenar, staplade av mänskliga händer." },
  { id: "tent", x: 4, z: 34, text: "Resterna av ett tält, tygduken murken och grön." },
];

export const DISCOVERY_RADIUS = 2.6;

// Returns the ids of landmarks the player is now within range of but that
// aren't in `discovered` yet — call this every frame with the live
// discovered-ids Set and it naturally fires exactly once per landmark.
export function checkDiscoveries(playerPos, discovered) {
  const found = [];
  for (const lm of LANDMARKS) {
    if (discovered.has(lm.id)) continue;
    if (Math.hypot(playerPos.x - lm.x, playerPos.z - lm.z) <= DISCOVERY_RADIUS) {
      found.push(lm.id);
    }
  }
  return found;
}
