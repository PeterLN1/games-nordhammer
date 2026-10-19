// Designprinciperna för Ghost Trains kartor (se ghosttrains/README.md,
// "Kartan"). Förr kontrollerades de med engångsskript — nu körs de för
// varje karta i ghosttrains-maps/ med `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAPS } from '../ghosttrains-maps/index.js';

const COLORS = ['red', 'blue', 'green', 'yellow', 'orange', 'purple', 'black', 'white'];
const other = (r, c) => (r.cityA === c ? r.cityB : r.cityA);

function components(map, { removedRoutes = new Set(), removedCity = null } = {}) {
  const seen = new Set();
  const comps = [];
  for (const { id: start } of map.cities) {
    if (start === removedCity || seen.has(start)) continue;
    const comp = [start];
    seen.add(start);
    for (let i = 0; i < comp.length; i++) {
      for (const r of map.routes) {
        if (removedRoutes.has(r.id) || (r.cityA !== comp[i] && r.cityB !== comp[i])) continue;
        const o = other(r, comp[i]);
        if (o === removedCity || seen.has(o)) continue;
        seen.add(o);
        comp.push(o);
      }
    }
    comps.push(comp);
  }
  return comps;
}

function shortestDistances(map, from) {
  const dist = new Map(map.cities.map(c => [c.id, Infinity]));
  dist.set(from, 0);
  const todo = new Set(map.cities.map(c => c.id));
  while (todo.size) {
    let u = null;
    for (const c of todo) if (u === null || dist.get(c) < dist.get(u)) u = c;
    todo.delete(u);
    for (const r of map.routes) {
      if (r.cityA !== u && r.cityB !== u) continue;
      const o = other(r, u);
      if (dist.get(u) + r.length < dist.get(o)) dist.set(o, dist.get(u) + r.length);
    }
  }
  return dist;
}

for (const map of Object.values(MAPS)) {
  const cityIds = new Set(map.cities.map(c => c.id));

  test(`${map.id}: rutter och biljetter pekar på kända städer, unika id:n`, () => {
    assert.equal(cityIds.size, map.cities.length);
    assert.equal(new Set(map.routes.map(r => r.id)).size, map.routes.length);
    assert.equal(new Set(map.tickets.map(t => t.id)).size, map.tickets.length);
    for (const r of map.routes) {
      assert.ok(cityIds.has(r.cityA) && cityIds.has(r.cityB), r.id);
      assert.ok(COLORS.includes(r.color), r.id);
      assert.ok(r.length >= 1 && r.length <= 6, r.id);
    }
    for (const t of map.tickets) assert.ok(cityIds.has(t.cityA) && cityIds.has(t.cityB), t.id);
    for (const c of map.cities) {
      assert.ok(c.x >= 0 && c.x <= map.width && c.y >= 0 && c.y <= map.height, c.id);
    }
  });

  test(`${map.id}: inga stadsprickar som överlappar (minst 20 enheter isär)`, () => {
    for (const a of map.cities) for (const b of map.cities) {
      if (a.id < b.id) assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 20, `${a.id}–${b.id}`);
    }
  });

  test(`${map.id}: sammanhängande, inga artikulationspunkter, inga grad-1-städer`, () => {
    assert.equal(components(map).length, 1);
    for (const { id } of map.cities) {
      assert.equal(components(map, { removedCity: id }).length, 1, `artikulationspunkt: ${id}`);
      const degree = map.routes.filter(r => r.cityA === id || r.cityB === id).length;
      assert.ok(degree >= 2, `grad ${degree}: ${id}`);
    }
  });

  test(`${map.id}: ingen stad har två rutter i samma färg`, () => {
    for (const { id } of map.cities) {
      const colors = map.routes.filter(r => r.cityA === id || r.cityB === id).map(r => r.color);
      assert.equal(new Set(colors).size, colors.length, `samma färg två gånger i ${id}`);
    }
  });

  test(`${map.id}: inga två enkelspår kan stänga in 2+ städer`, () => {
    const singles = map.routes.filter(r => !r.doubleTrack);
    for (let i = 0; i < singles.length; i++) {
      for (let j = i; j < singles.length; j++) {
        const comps = components(map, { removedRoutes: new Set([singles[i].id, singles[j].id]) });
        const trapped = comps.filter(c => c.length >= 2 && c.length <= map.cities.length / 2);
        assert.equal(trapped.length, 0, `${singles[i].id} + ${singles[j].id} stänger in ${trapped.map(c => c.join(',')).join(' | ')}`);
      }
    }
  });

  test(`${map.id}: färgbalans (vagnar spår per färg inom ett smalt spann)`, () => {
    const sum = Object.fromEntries(COLORS.map(c => [c, 0]));
    map.routes.forEach(r => { sum[r.color] += r.length * (r.doubleTrack ? 2 : 1); });
    const spread = Math.max(...Object.values(sum)) - Math.min(...Object.values(sum));
    assert.ok(spread <= 6, `spann ${spread}: ${JSON.stringify(sum)}`);
  });

  test(`${map.id}: biljettpoäng = kortaste vägen (avtrubbad över 13), minst 6 långa`, () => {
    for (const t of map.tickets) {
      const d = shortestDistances(map, t.cityA).get(t.cityB);
      const expected = d <= 13 ? d : 13 + Math.floor((d - 13) / 3);
      // Sverigekartans ursprungliga biljetter (t1–t15) prissattes innan
      // senare rutter (t.ex. Kalmar, lulea-sundsvall) ändrade avstånden —
      // de avviker upp till 2p och har lämnats orörda.
      const tolerance = map.id === 'sverige' && Number(t.id.slice(1)) <= 15 ? 2 : 0;
      assert.ok(Math.abs(t.points - expected) <= tolerance, `${t.id} ${t.cityA}–${t.cityB}: avstånd ${d}, ${t.points}p`);
      assert.ok(d <= map.startingTrainCars, `${t.id} kräver ${d} vagnar`);
    }
    assert.ok(map.tickets.filter(t => t.points >= 12).length >= 6);
    assert.ok(map.tickets.some(t => t.points >= 7 && t.points < 12));
    assert.ok(map.tickets.some(t => t.points < 7));
  });
}
