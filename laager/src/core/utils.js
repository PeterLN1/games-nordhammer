// Shortest-path angle interpolation (so a player facing 350° turning
// toward 10° spins through 0° instead of the long way around).
export function lerpAngle(a, b, t) {
  const twoPi = Math.PI * 2;
  let diff = ((b - a + Math.PI * 3) % twoPi) - Math.PI;
  return a + diff * t;
}

// scatter positions on a ring around the camp, used for trees/rocks
export function scatter(count, minR, maxR, seedOffset = 0) {
  const items = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + Math.sin(i * 12.9 + seedOffset) * 0.3;
    const r = minR + Math.random() * (maxR - minR);
    items.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, rot: Math.random() * Math.PI * 2, scale: 0.75 + Math.random() * 0.6 });
  }
  return items;
}
