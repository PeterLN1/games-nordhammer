/* ============================================================
   Ghost Trains — asynkront familjespel (Nordhammer Spel)
   Se .claude/plans/dapper-enchanting-snowflake.md för bakgrund.

   Kartorna (städer/rutter, ghosttrains-maps/) hålls bara på servern —
   klienten hämtar den via GET /api/ghosttrains/map istället för att duplicera datan,
   eftersom Railways "Root Directory" för server-tjänsten är satt till
   server/ och alltså inte ser filer utanför den mappen.
   ============================================================ */
import express from 'express';
import cron from 'node-cron';
import { MAPS, DEFAULT_MAP_ID } from './ghosttrains-maps/index.js';

export const COLORS = ['red', 'blue', 'green', 'yellow', 'orange', 'purple', 'black', 'white'];
export const WILD = 'wild';

function ticketTier(points) { return points >= 12 ? 'long' : points >= 7 ? 'medium' : 'short'; }

// Officiell Ticket to Ride-poängtabell för ruttlängd.
const ROUTE_POINTS = { 1: 1, 2: 2, 3: 4, 4: 7, 5: 10, 6: 15 };
// Tågvagnar per spelare sätts per karta (startingTrainCars i
// ghosttrains-maps/*.js) och sparas i ghosttrains_game_state.starting_cars
// när ett spel startas. Detta är reservvärdet för spel från före kartvalet.
const STARTING_TRAIN_CARS = 20;
const FINAL_ROUND_THRESHOLD = 2;
// AP per dag. Med 6 hinner en spelare flera claims samma dag (2 AP st)
// — därför kollar /claim tågvagnar mot dagens PENDING-claims och
// resolveDay håller en tågvagnsbudget per spelare under natten.
const DAILY_AP = 6;
const STARTING_HAND_SIZE = 4;       // som i Ticket to Ride: 4 tågkort i startgiv
const LONGEST_PATH_BONUS = 10;      // bonus för längsta sammanhängande tåg
// Antal spelfärger i klientens palett (PLAYER_COLORS i index.html).
// Varje spelare som gått med får ett eget färgindex per spel —
// profilfärgerna (shared/profile.js) kan krocka mellan enheter.
const PLAYER_COLOR_COUNT = 8;
function nextColorIdx(used) {
  for (let i = 0; i < PLAYER_COLOR_COUNT; i++) if (!used.has(i)) return i;
  return used.size % PLAYER_COLOR_COUNT; // fler spelare än färger: återanvänd
}

/* ---------- Kartor ----------
   Kartdatan (städer, rutter, biljetter, kontur) ligger i
   ghosttrains-maps/. Allt som slår upp rutter/städer/biljetter tar en
   kartkontext `m` — det pågående spelets karta (mapForGame). */
function buildMapContext(def) {
  const adjacency = new Map();
  def.cities.forEach(c => adjacency.set(c.id, []));
  def.routes.forEach(r => {
    adjacency.get(r.cityA).push({ routeId: r.id, other: r.cityB, length: r.length });
    adjacency.get(r.cityB).push({ routeId: r.id, other: r.cityA, length: r.length });
  });
  return {
    id: def.id, def,
    cities: def.cities, routes: def.routes, tickets: def.tickets,
    startingTrainCars: def.startingTrainCars || STARTING_TRAIN_CARS,
    routesById: new Map(def.routes.map(r => [r.id, r])),
    ticketsById: new Map(def.tickets.map(t => [t.id, t])),
    adjacency
  };
}
const MAP_CONTEXTS = Object.fromEntries(Object.values(MAPS).map(def => [def.id, buildMapContext(def)]));
export function mapContext(mapId) { return MAP_CONTEXTS[mapId] || MAP_CONTEXTS[DEFAULT_MAP_ID]; }
function mapForGame(gameState) { return mapContext(gameState && gameState.mapId); }

// Bakåtkompatibla exporter (Sverigekartan), används av engångsskript.
export const CITIES = MAPS[DEFAULT_MAP_ID].cities;
export const ROUTES = MAPS[DEFAULT_MAP_ID].routes;
export const TICKETS = MAPS[DEFAULT_MAP_ID].tickets;

function trackSlots(route) { return route.doubleTrack ? ['A', 'B'] : ['single']; }

// Som i Ticket to Ride: en spelare får aldrig äga båda spåren på en
// dubbelspårsrutt. Gäller både vanliga claims och omdirigering.
function ownsTrackOn(routeId, profileId, builtRoutesList) {
  return builtRoutesList.some(b => b.route_id === routeId && b.owner_profile_id === profileId);
}

// Origin-stad för ett claim väljs automatiskt (ingen prompt i UI):
// äger spelaren redan en rutt som rör vid EN av ändstäderna, blir den
// staden origin (för omdirigerings-BFS:en vid krock). Rör spelaren
// vid båda eller ingen, lottas det mellan de två ändstäderna.
function pickOriginCity(m, route, profileId, builtRoutesList) {
  const ownsCity = (city) => builtRoutesList.some((r) => {
    if (r.owner_profile_id !== profileId) return false;
    const owned = m.routesById.get(r.route_id);
    return owned && (owned.cityA === city || owned.cityB === city);
  });
  const touchesA = ownsCity(route.cityA);
  const touchesB = ownsCity(route.cityB);
  if (touchesA && !touchesB) return route.cityA;
  if (touchesB && !touchesA) return route.cityB;
  return Math.random() < 0.5 ? route.cityA : route.cityB;
}

/* ---------- Kortlek ---------- */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function freshDeck() {
  const deck = [];
  COLORS.forEach(c => { for (let i = 0; i < 14; i++) deck.push(c); });
  for (let i = 0; i < 14; i++) deck.push(WILD);
  return shuffle(deck);
}
// Kortlek + kasthög som ETT muterbart objekt { deck, discard }. Som i
// Ticket to Ride: tar leken slut blandas kasthögen (spenderade kort och
// utbytta marknadskort) till en ny lek. Bara om ÄVEN kasthögen är tom —
// alla kort ligger på händer/marknaden — skapas en ny lek, så att ett
// asynkront spel aldrig låser sig för att någon samlar kort.
function deckDrawer(st) {
  return () => {
    if (st.deck.length === 0) {
      if (st.discard.length) { st.deck = shuffle(st.discard); st.discard = []; }
      else st.deck = freshDeck();
    }
    return st.deck.pop();
  };
}
function freshMarket(drawFn) { return [drawFn(), drawFn(), drawFn(), drawFn(), drawFn()]; }
// Marknaden fylls på; har den 3+ jokrar kastas alla 5 (till kasthögen)
// och 5 nya dras — högst 3 gånger, så en joker-tung lek aldrig loopar.
function refillMarket(cards, index, st) {
  const draw = deckDrawer(st);
  let next = cards.slice();
  next[index] = draw();
  for (let i = 0; i < 3 && next.filter(c => c === WILD).length >= 3; i++) {
    st.discard.push(...next);
    next = freshMarket(draw);
  }
  return next;
}
function removeCards(hand, cardsToRemove) {
  const h = hand.slice();
  for (const c of cardsToRemove) {
    const idx = h.indexOf(c);
    if (idx === -1) return null;
    h.splice(idx, 1);
  }
  return h;
}
function validateClaimCards(route, cards) {
  if (!Array.isArray(cards) || cards.length !== route.length) return false;
  return cards.every(c => c === WILD || c === route.color);
}

/* ---------- Dagar (Europe/Stockholm, samma stil som Ordlek-hjälparna i index.js) ---------- */
const DAY_FMT = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' });
function gameDay(date = new Date()) { return DAY_FMT.format(date); }
function prevDay(dateStr) { return new Date(Date.parse(dateStr + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10); }
function nextDay(dateStr) { return new Date(Date.parse(dateStr + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10); }

/* ---------- Omdirigeringsmotor ----------
   Söker utåt i cirklar (BFS) från krockstaden efter en ledig rutt,
   och faller — om det lokala området redan är fullt — tillbaka på
   närmaste lediga rutt var som helst på kartan. En spelare lämnas
   alltså bara helt utan spår (Total Crash) om HELA kartan är fullbyggd. */
function findNearestFreeRoute(m, startCity, excludeRouteId, builtSet, maxAffordableLength, ownedRouteIds = new Set()) {
  const affordable = r => r.length <= maxAffordableLength && !ownedRouteIds.has(r.id);
  const visitedCities = new Set([startCity]);
  let frontier = [startCity];
  const seenRoutes = new Set();
  while (frontier.length) {
    const candidates = [];
    const nextFrontier = [];
    for (const city of frontier) {
      for (const edge of m.adjacency.get(city)) {
        if (!seenRoutes.has(edge.routeId)) {
          seenRoutes.add(edge.routeId);
          if (edge.routeId !== excludeRouteId) {
            const route = m.routesById.get(edge.routeId);
            const freeSlots = trackSlots(route).filter(t => !builtSet.has(route.id + '|' + t));
            if (freeSlots.length > 0 && affordable(route)) candidates.push(route);
          }
        }
        if (!visitedCities.has(edge.other)) { visitedCities.add(edge.other); nextFrontier.push(edge.other); }
      }
    }
    if (candidates.length) {
      const minLen = Math.min(...candidates.map(r => r.length));
      const shortest = candidates.filter(r => r.length === minLen);
      return shortest[Math.floor(Math.random() * shortest.length)];
    }
    frontier = nextFrontier;
  }
  // krockstadens sammanhängande del av kartan är helt full — sök globalt.
  const allFree = m.routes.filter(r => r.id !== excludeRouteId && affordable(r) && trackSlots(r).some(t => !builtSet.has(r.id + '|' + t)));
  if (!allFree.length) return null;
  return allFree[Math.floor(Math.random() * allFree.length)];
}

/* ---------- Upplösningsmotor ----------
   Körs en gång per "spelardag". Regler (se PRD + planen):
   - 1 claimare på en rutt → lyckas.
   - Exakt 2 claimare på en dubbelspårsrutt DÄR BÅDA SPÅREN är lediga
     → båda lyckas (tidigast → spår A, senare → spår B).
   - Alla andra fall (2+ på enkelspår, eller 3+ på en dubbelspårsrutt,
     eller fler claimare än lediga spår) → full krock: ingen får rutten,
     den förblir fri, alla inblandade omdirigeras. */
export async function resolveDay(store, day) {
  if (await store.isDayResolved(day)) return { day, alreadyResolved: true, results: [] };

  const m = mapForGame(await store.getGameState());
  const claims = await store.unresolvedForDay(day);
  const built = await store.builtRoutes();
  const builtSet = new Set(built.map(b => b.route_id + '|' + b.track));
  // Rutter (route_id) varje spelare redan äger ett spår på — uppdateras
  // under körningen så en omdirigering aldrig ger andra spåret.
  const ownedBy = new Map();
  const markOwned = (profileId, routeId) => {
    if (!ownedBy.has(profileId)) ownedBy.set(profileId, new Set());
    ownedBy.get(profileId).add(routeId);
  };
  built.forEach(b => markOwned(b.owner_profile_id, b.route_id));

  const byRoute = new Map();
  claims.forEach(c => {
    if (!byRoute.has(c.route_id)) byRoute.set(c.route_id, []);
    byRoute.get(c.route_id).push(c);
  });

  const results = [];
  const collided = [];
  const resolvedIds = [];

  for (const [routeId, group] of byRoute) {
    const route = m.routesById.get(routeId);
    group.sort((a, b) => new Date(a.submitted_at) - new Date(b.submitted_at));
    resolvedIds.push(...group.map(g => g.id));
    const freeSlots = trackSlots(route).filter(t => !builtSet.has(routeId + '|' + t));
    const n = group.length;
    const success = n === 1 || (route.doubleTrack && n === 2 && freeSlots.length === 2);

    if (success) {
      group.forEach((claim, i) => {
        const track = freeSlots[i];
        const kind = (n === 2 && route.doubleTrack) ? 'double_track' : 'success';
        results.push({ profileId: claim.profile_id, kind, routeId, track, length: route.length, submittedAt: claim.submitted_at });
        builtSet.add(routeId + '|' + track);
        markOwned(claim.profile_id, routeId);
      });
    } else {
      const names = group.map(g => g.profile_id);
      group.forEach(claim => {
        collided.push({
          profileId: claim.profile_id, fromCity: claim.from_city, routeId,
          submittedAt: claim.submitted_at, others: names.filter(x => x !== claim.profile_id)
        });
      });
    }
  }

  // Tågvagnsbudget per spelare för resten av natten: lagrade vagnar
  // minus nattens lyckade bygen. En spelare kan ha flera claims samma
  // natt (6 AP), så omdirigeringar måste rymmas i det som faktiskt är kvar.
  const budget = new Map();
  const budgetFor = async (profileId) => {
    if (!budget.has(profileId)) {
      const spent = results.filter(r => r.profileId === profileId && r.track).reduce((s, r) => s + r.length, 0);
      budget.set(profileId, (await store.getPlayer(profileId)).trainCars - spent);
    }
    return budget.get(profileId);
  };

  collided.sort((a, b) => new Date(a.submittedAt) - new Date(b.submittedAt));
  for (const c of collided) {
    // Omdirigering får bara ge en rutt spelaren faktiskt har råd med
    // (kvarvarande tågvagnar) — annars Total Crash (se .claude/plans,
    // Pass 2: "reroute constraints").
    const carsLeft = await budgetFor(c.profileId);
    const alt = findNearestFreeRoute(m, c.fromCity, c.routeId, builtSet, carsLeft, ownedBy.get(c.profileId));
    if (alt) {
      budget.set(c.profileId, carsLeft - alt.length);
      const track = trackSlots(alt).filter(t => !builtSet.has(alt.id + '|' + t))[0];
      builtSet.add(alt.id + '|' + track);
      markOwned(c.profileId, alt.id);
      results.push({ profileId: c.profileId, kind: 'rerouted', routeId: c.routeId, altRouteId: alt.id, track, length: alt.length, otherPlayers: c.others });
    } else {
      results.push({ profileId: c.profileId, kind: 'total_crash', routeId: c.routeId, otherPlayers: c.others });
    }
  }

  for (const r of results) {
    if (r.track) {
      await store.buildRoute(r.altRouteId || r.routeId, r.track, r.profileId, day);
      // Tågvagnar och poäng dras/läggs på den FAKTISKA ruttens längd —
      // alt-ruttens vid omdirigering, annars den claimade ruttens.
      await store.deductTrainCars(r.profileId, r.length);
      await store.addScore(r.profileId, ROUTE_POINTS[r.length] || 0);
    }
    await store.insertLog({
      gameDay: day, profileId: r.profileId, kind: r.kind,
      routeId: r.routeId, altRouteId: r.altRouteId || null, otherPlayers: r.otherPlayers || []
    });
  }
  await store.markResolved(resolvedIds);
  await store.markDayResolved(day);
  await checkFinalRoundAndGameOver(store, m, day, results);
  return { day, results };
}

// Enkel BFS över bara EN spelares egna byggda rutter — avgör om en
// destinationsbiljett är uppfylld vid spelslut.
function isConnectedForProfile(m, ownedRouteIds, cityA, cityB) {
  if (cityA === cityB) return true;
  const adj = new Map();
  m.routes.forEach(r => {
    if (!ownedRouteIds.has(r.id)) return;
    if (!adj.has(r.cityA)) adj.set(r.cityA, []);
    if (!adj.has(r.cityB)) adj.set(r.cityB, []);
    adj.get(r.cityA).push(r.cityB);
    adj.get(r.cityB).push(r.cityA);
  });
  const seen = new Set([cityA]);
  const stack = [cityA];
  while (stack.length) {
    const cur = stack.pop();
    for (const n of (adj.get(cur) || [])) if (!seen.has(n)) { seen.add(n); stack.push(n); }
  }
  return seen.has(cityB);
}

// Biljettstatus för EN spelare (privat, visas löpande i klienten):
//   completed — städerna hänger ihop via spelarens egna rutter
//   blocked   — ingen väg alls via egna + lediga rutter (någon annan har
//               stängt vägen) — biljetten kan inte längre klaras
//   too_far   — vägen finns men kräver fler tågvagnar än spelaren har kvar
//   open      — går fortfarande att klara
// Dijkstra där egna rutter (och dagens egna PENDING-claims, optimistiskt)
// kostar 0 och lediga rutter kostar sin längd. En rutt där spelaren redan
// äger ena dubbelspåret räknas som egen. Byggda rutter utan ledigt spår
// är oframkomliga. carsLeft = tågvagnar minus dagens bokade claims.
function ticketStatus(m, ticket, profileId, builtList, carsLeft, pendingRouteIds = new Set()) {
  const ownRouteIds = new Set(builtList.filter(b => b.owner_profile_id === profileId).map(b => b.route_id));
  if (isConnectedForProfile(m, ownRouteIds, ticket.cityA, ticket.cityB)) return { status: 'completed', carsNeeded: 0 };
  const cost = r => {
    if (ownRouteIds.has(r.id) || pendingRouteIds.has(r.id)) return 0;
    const freeSlot = trackSlots(r).some(t => !builtList.some(b => b.route_id === r.id && b.track === t));
    return freeSlot ? r.length : Infinity;
  };
  const dist = new Map(m.cities.map(c => [c.id, Infinity]));
  dist.set(ticket.cityA, 0);
  const todo = new Set(m.cities.map(c => c.id));
  while (todo.size) {
    let u = null;
    for (const c of todo) if (u === null || dist.get(c) < dist.get(u)) u = c;
    todo.delete(u);
    if (dist.get(u) === Infinity) break;
    for (const e of m.adjacency.get(u)) {
      const d = dist.get(u) + cost(m.routesById.get(e.routeId));
      if (d < dist.get(e.other)) dist.set(e.other, d);
    }
  }
  const need = dist.get(ticket.cityB);
  if (need === Infinity) return { status: 'blocked', carsNeeded: null };
  if (need > carsLeft) return { status: 'too_far', carsNeeded: need };
  return { status: 'open', carsNeeded: need };
}

// Lägger till status (+ bakåtkompatibla `completed`) på biljetter för en profil.
async function decorateTickets(store, m, profileId, ticketIds) {
  const [built, player, pending] = await Promise.all([
    store.builtRoutes(), store.getPlayer(profileId), store.pendingForProfileToday(profileId, gameDay())
  ]);
  const pendingIds = new Set(pending.map(p => p.route_id));
  const reserved = pending.reduce((s, p) => s + (m.routesById.get(p.route_id)?.length || 0), 0);
  const carsLeft = player.trainCars - reserved;
  return ticketIds.map(id => m.ticketsById.get(id)).filter(Boolean).map(t => {
    const st = ticketStatus(m, t, profileId, built, carsLeft, pendingIds);
    return { ...t, completed: st.status === 'completed', status: st.status, carsNeeded: st.carsNeeded };
  });
}

// Längsta sammanhängande tåg för EN spelare: längsta "trail" (varje
// byggt spår används högst en gång, städer får passeras flera gånger)
// viktad med ruttlängd — samma definition som Ticket to Rides bonus.
// Uttömmande DFS; en spelare äger högst ~20 rutter så det går snabbt.
export function longestPathLength(ownedBuilt, m = mapContext(DEFAULT_MAP_ID)) {
  const edges = ownedBuilt.map((b, i) => {
    const r = m.routesById.get(b.route_id);
    return r ? { i, a: r.cityA, b: r.cityB, len: r.length } : null;
  }).filter(Boolean);
  const adj = new Map();
  edges.forEach(e => {
    if (!adj.has(e.a)) adj.set(e.a, []);
    if (!adj.has(e.b)) adj.set(e.b, []);
    adj.get(e.a).push(e);
    adj.get(e.b).push(e);
  });
  const used = new Set();
  let best = 0;
  function dfs(city, sum) {
    if (sum > best) best = sum;
    for (const e of adj.get(city) || []) {
      if (used.has(e.i)) continue;
      used.add(e.i);
      dfs(e.a === city ? e.b : e.a, sum + e.len);
      used.delete(e.i);
    }
  }
  for (const city of adj.keys()) dfs(city, 0);
  return best;
}

// Sorteringsordning för slutresultat: totalpoäng, sedan flest klarade
// biljetter, sedan längsta tåg (Ticket to Rides tiebreak-regler).
function compareFinal(a, b) {
  return (b.total - a.total)
    || ((b.ticketsCompleted || 0) - (a.ticketsCompleted || 0))
    || ((b.longestPath || 0) - (a.longestPath || 0));
}

// Efter varje upplösning: kolla om någon spelares tågvagnar gått i
// botten (utlöser en sista spelrunda), och — om den sista rundans dag
// just upplöstes — räkna ut slutpoäng (ruttpoäng + biljetter) och
// avsluta spelet. Se .claude/plans, Pass 2.
async function checkFinalRoundAndGameOver(store, m, day, results) {
  let gameState = await store.getGameState();
  if (gameState.status === 'active') {
    const touched = Array.from(new Set(results.filter(r => r.track).map(r => r.profileId)));
    for (const profileId of touched) {
      const player = await store.getPlayer(profileId);
      if (player.trainCars <= FINAL_ROUND_THRESHOLD) {
        const finalDay = nextDay(day);
        await store.setGameState('final_round', finalDay);
        await store.insertLog({
          gameDay: day, profileId, kind: 'final_round_triggered',
          routeId: null, altRouteId: null, otherPlayers: [], details: { trainCars: player.trainCars }
        });
        gameState = { ...gameState, status: 'final_round', finalDay };
        break;
      }
    }
  }

  // Andra slutvillkoret: ingen spelare kan bygga någon ledig rutt längre
  // (kartan full, eller allt som är kvar är för långt / andra spåret på
  // en egen dubbelspårsrutt). Utan detta kunde spelet stå still för
  // evigt med många spelare — se startingTrainCars i ghosttrains-maps/.
  if (gameState.status === 'active') {
    const built = await store.builtRoutes();
    const joined = (await store.allPlayers()).filter(p => p.joined);
    const canBuild = p => m.routes.some(r =>
      r.length <= p.trainCars
      && trackSlots(r).some(t => !built.some(b => b.route_id === r.id && b.track === t))
      && !ownsTrackOn(r.id, p.profileId, built));
    if (joined.length && !joined.some(canBuild)) {
      const finalDay = nextDay(day);
      await store.setGameState('final_round', finalDay);
      await store.insertLog({
        gameDay: day, profileId: 'system', kind: 'final_round_triggered',
        routeId: null, altRouteId: null, otherPlayers: [], details: { reason: 'map_full' }
      });
      gameState = { ...gameState, status: 'final_round', finalDay };
    }
  }

  if (gameState.status === 'final_round' && gameState.finalDay && day >= gameState.finalDay) {
    const built = await store.builtRoutes();
    const ownedByProfile = new Map();
    const builtByProfile = new Map();
    built.forEach(b => {
      if (!ownedByProfile.has(b.owner_profile_id)) ownedByProfile.set(b.owner_profile_id, new Set());
      ownedByProfile.get(b.owner_profile_id).add(b.route_id);
      if (!builtByProfile.has(b.owner_profile_id)) builtByProfile.set(b.owner_profile_id, []);
      builtByProfile.get(b.owner_profile_id).push(b);
    });

    const allTickets = await store.allPlayerTickets();
    const ticketsByProfile = new Map();
    allTickets.forEach(t => {
      if (!ticketsByProfile.has(t.profileId)) ticketsByProfile.set(t.profileId, []);
      ticketsByProfile.get(t.profileId).push(t.ticketId);
    });

    const allPlayers = await store.allPlayers();
    const finalResults = [];
    for (const p of allPlayers) {
      const ownedRouteIds = ownedByProfile.get(p.profileId) || new Set();
      const ticketIds = ticketsByProfile.get(p.profileId) || [];
      const breakdown = [];
      let ticketDelta = 0;
      ticketIds.forEach(ticketId => {
        const ticket = m.ticketsById.get(ticketId);
        if (!ticket) return;
        const ok = isConnectedForProfile(m, ownedRouteIds, ticket.cityA, ticket.cityB);
        ticketDelta += ok ? ticket.points : -ticket.points;
        breakdown.push({ ticketId, cityA: ticket.cityA, cityB: ticket.cityB, points: ticket.points, success: ok });
      });
      // Profiler som bara tittat in (inga biljetter, inga rutter) räknas
      // inte som deltagare i slutresultatet.
      if (!ticketIds.length && !ownedRouteIds.size) continue;
      finalResults.push({
        profileId: p.profileId, routeScore: p.score, ticketDelta, breakdown,
        ticketsCompleted: breakdown.filter(b => b.success).length,
        longestPath: longestPathLength(builtByProfile.get(p.profileId) || [], m)
      });
    }
    // Längsta tåg-bonusen går till alla som delar det längsta (> 0).
    const maxPath = Math.max(0, ...finalResults.map(r => r.longestPath));
    finalResults.forEach(r => {
      r.longestBonus = maxPath > 0 && r.longestPath === maxPath ? LONGEST_PATH_BONUS : 0;
      r.total = r.routeScore + r.ticketDelta + r.longestBonus;
    });
    for (const r of finalResults) {
      const { profileId, ...details } = r;
      await store.insertLog({
        gameDay: day, profileId, kind: 'game_over',
        routeId: null, altRouteId: null, otherPlayers: [], details
      });
    }
    finalResults.sort(compareFinal);
    await store.setGameState('finished', gameState.finalDay, finalResults);
  }
}

// Slutresultat för /state. Spel som avslutades innan final_results
// sparades i game_state återskapas ur game_over-raderna i loggen.
async function finalResultsFor(store, gameState) {
  if (Array.isArray(gameState.finalResults)) return gameState.finalResults;
  if (!gameState.finalDay) return [];
  let entries = [];
  for (let day = gameState.finalDay, i = 0; i < 7 && !entries.length; day = nextDay(day), i++) {
    entries = (await store.logForDay(day)).filter(e => e.kind === 'game_over');
  }
  return entries
    .map(e => ({ profileId: e.profile_id, ...(e.details || {}) }))
    .sort(compareFinal);
}

/* ---------- Lagring (Postgres eller minne, samma dubbla mönster som server/index.js) ---------- */
async function initSchema(pool) {
  await pool.query(`create table if not exists ghosttrains_hands (
    profile_id text primary key,
    hand jsonb not null default '[]',
    updated_at timestamptz not null default now()
  );`);
  await pool.query(`create table if not exists ghosttrains_deck (
    id int primary key default 1,
    remaining jsonb not null
  );`);
  await pool.query(`create table if not exists ghosttrains_routes (
    route_id text not null,
    track text not null default 'single',
    owner_profile_id text not null,
    built_on_day date not null,
    created_at timestamptz not null default now(),
    primary key (route_id, track)
  );`);
  await pool.query(`create table if not exists ghosttrains_pending_moves (
    id bigserial primary key,
    profile_id text not null,
    route_id text not null,
    from_city text not null,
    cards jsonb not null,
    game_day date not null,
    submitted_at timestamptz not null default now(),
    resolved boolean not null default false
  );`);
  await pool.query(`create index if not exists ghosttrains_pending_day_idx on ghosttrains_pending_moves (game_day, resolved);`);
  await pool.query(`create table if not exists ghosttrains_resolution_log (
    id bigserial primary key,
    game_day date not null,
    profile_id text not null,
    kind text not null,
    route_id text,
    alt_route_id text,
    other_players jsonb not null default '[]',
    created_at timestamptz not null default now()
  );`);
  await pool.query(`create table if not exists ghosttrains_resolved_days (
    game_day date primary key,
    resolved_at timestamptz not null default now()
  );`);
  // Pass 1 (Action Points + kortmarknad, se .claude/plans):
  await pool.query(`create table if not exists ghosttrains_market (
    id int primary key default 1,
    cards jsonb not null
  );`);
  // game_day som text (inte date) — undviker tidszon-/typkonvertering
  // fram och tillbaka mellan JS Date och SQL date; vi jämför ändå bara
  // mot gameDay()-strängen (samma mönster som game_day i pending_moves,
  // fast den kolumnen är date eftersom den bara skrivs, aldrig jämförs
  // för lat-återställning som denna).
  await pool.query(`create table if not exists ghosttrains_ap (
    profile_id text primary key,
    game_day text not null,
    remaining int not null default ${DAILY_AP}
  );`);
  // Pass 2 (tågvagnar, biljetter, poäng, se .claude/plans):
  await pool.query(`alter table ghosttrains_resolution_log add column if not exists details jsonb;`);
  await pool.query(`create table if not exists ghosttrains_players (
    profile_id text primary key,
    train_cars int not null default ${STARTING_TRAIN_CARS},
    score int not null default 0,
    initial_tickets_dealt boolean not null default false
  );`);
  await pool.query(`create table if not exists ghosttrains_player_tickets (
    profile_id text not null,
    ticket_id text not null,
    primary key (profile_id, ticket_id)
  );`);
  await pool.query(`create table if not exists ghosttrains_ticket_offers (
    profile_id text primary key,
    ticket_ids jsonb not null,
    min_keep int not null
  );`);
  await pool.query(`create table if not exists ghosttrains_ticket_deck (
    id int primary key default 1,
    remaining jsonb not null
  );`);
  await pool.query(`create table if not exists ghosttrains_game_state (
    id int primary key default 1,
    status text not null default 'active',
    final_day text
  );`);
  // Slutresultat sparas vid spelslut; game_no räknas upp vid nytt spel.
  await pool.query(`alter table ghosttrains_game_state add column if not exists final_results jsonb;`);
  await pool.query(`alter table ghosttrains_game_state add column if not exists game_no int not null default 1;`);
  // Kartval per spel (null = Sverigekartan, spel från före kartvalet)
  // och kartans tågvagnar per spelare, satt av /new-game.
  await pool.query(`alter table ghosttrains_game_state add column if not exists map_id text;`);
  await pool.query(`alter table ghosttrains_game_state add column if not exists starting_cars int;`);
  // Kasthög för spenderade kort (blandas om när leken tar slut).
  await pool.query(`alter table ghosttrains_deck add column if not exists discard jsonb not null default '[]';`);
  await pool.query(`alter table ghosttrains_players add column if not exists color_idx int;`);
  // Kolumnens default sattes när tabellen skapades — följ konstanten.
  await pool.query(`alter table ghosttrains_players alter column train_cars set default ${STARTING_TRAIN_CARS};`);
  // Explicit "Gå med i spelet". Spelare som redan fått sin startgiv när
  // kolumnen läggs till räknas som med.
  await pool.query(`do $$ begin
    if not exists (select 1 from information_schema.columns where table_name='ghosttrains_players' and column_name='joined') then
      alter table ghosttrains_players add column joined boolean not null default false;
      update ghosttrains_players set joined = true
        where initial_tickets_dealt or score > 0 or train_cars < ${STARTING_TRAIN_CARS};
    end if;
  end $$;`);
  // Startgiv av tågkort. Befintliga spelare (som redan spelat) räknas
  // som klara — bara nya spelare/nya spel får de 4 startkorten.
  await pool.query(`do $$ begin
    if not exists (select 1 from information_schema.columns where table_name='ghosttrains_players' and column_name='initial_cards_dealt') then
      alter table ghosttrains_players add column initial_cards_dealt boolean not null default false;
      update ghosttrains_players set initial_cards_dealt = true;
    end if;
  end $$;`);
  // Samma öppna förtroendemodell som scores/profiles (se server/index.js):
  // RLS på utan policies stänger Supabases publika REST-API helt.
  for (const t of [
    'ghosttrains_hands', 'ghosttrains_deck', 'ghosttrains_routes', 'ghosttrains_pending_moves',
    'ghosttrains_resolution_log', 'ghosttrains_resolved_days', 'ghosttrains_market', 'ghosttrains_ap',
    'ghosttrains_players', 'ghosttrains_player_tickets', 'ghosttrains_ticket_offers',
    'ghosttrains_ticket_deck', 'ghosttrains_game_state'
  ]) {
    await pool.query(`alter table ${t} enable row level security;`);
  }
}

async function lockDeck(client) {
  const r = await client.query('select remaining, discard from ghosttrains_deck where id=1 for update');
  return r.rows[0] ? { deck: r.rows[0].remaining, discard: r.rows[0].discard || [] } : { deck: freshDeck(), discard: [] };
}
async function saveDeckState(client, st) {
  await client.query(
    `insert into ghosttrains_deck (id, remaining, discard) values (1,$1,$2)
     on conflict (id) do update set remaining=$1, discard=$2`,
    [JSON.stringify(st.deck), JSON.stringify(st.discard)]
  );
}

// Nya spelare får det pågående spelets tågvagnar (kartans
// startingTrainCars, sparat i game_state av /new-game). ALLA inserts i
// ghosttrains_players måste sätta train_cars med denna — kolumnens
// default är Sverigekartans 20 (hände med joinGame vid nytt spel).
const START_CARS_SQL = `coalesce((select starting_cars from ghosttrains_game_state where id=1), ${STARTING_TRAIN_CARS})`;

function pgStore(pool) {
  return {
    async getHand(profileId) {
      const r = await pool.query('select hand from ghosttrains_hands where profile_id=$1', [profileId]);
      return r.rows[0] ? r.rows[0].hand : [];
    },
    // Atomär påfyllning av handen: två samtidiga drag (t.ex. dubbeltryck)
    // kan annars läsa samma hand och skriva över varandras kort.
    async addToHand(profileId, cards) {
      const r = await pool.query(
        `insert into ghosttrains_hands (profile_id, hand, updated_at) values ($1,$2,now())
         on conflict (profile_id) do update set hand = ghosttrains_hands.hand || $2::jsonb, updated_at=now()
         returning hand`,
        [profileId, JSON.stringify(cards)]
      );
      return r.rows[0].hand;
    },
    // Compare-and-swap: sparar bara om handen fortfarande är exakt den
    // som lästes (annars har ett samtidigt drag hunnit ändra den).
    async replaceHandIf(profileId, oldHand, newHand) {
      const r = await pool.query(
        `update ghosttrains_hands set hand=$3, updated_at=now()
         where profile_id=$1 and hand=$2::jsonb returning profile_id`,
        [profileId, JSON.stringify(oldHand), JSON.stringify(newHand)]
      );
      return r.rows.length > 0;
    },
    async saveHand(profileId, hand) {
      await pool.query(
        `insert into ghosttrains_hands (profile_id, hand, updated_at) values ($1,$2,now())
         on conflict (profile_id) do update set hand=$2, updated_at=now()`,
        [profileId, JSON.stringify(hand)]
      );
    },
    // Blinddrag: hela läs-dra-skriv i en transaktion med låst lek, så
    // två samtidiga drag aldrig får samma kort.
    async drawFromDeck(count) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const st = await lockDeck(client);
        const draw = deckDrawer(st);
        const cards = [];
        for (let i = 0; i < count; i++) cards.push(draw());
        await saveDeckState(client, st);
        await client.query('commit');
        return cards;
      } catch (e) { await client.query('rollback'); throw e; }
      finally { client.release(); }
    },
    async discardCards(cards) {
      if (!cards.length) return;
      await pool.query(
        `insert into ghosttrains_deck (id, remaining, discard) values (1,$1,$2)
         on conflict (id) do update set discard = ghosttrains_deck.discard || $2::jsonb`,
        [JSON.stringify(freshDeck()), JSON.stringify(cards)]
      );
    },
    async builtRoutes() {
      const r = await pool.query('select route_id, track, owner_profile_id from ghosttrains_routes');
      return r.rows;
    },
    async insertPending(move) {
      const r = await pool.query(
        `insert into ghosttrains_pending_moves (profile_id, route_id, from_city, cards, game_day)
         values ($1,$2,$3,$4,$5) returning id`,
        [move.profileId, move.routeId, move.fromCity, JSON.stringify(move.cards), move.gameDay]
      );
      return r.rows[0].id;
    },
    async pendingForProfileToday(profileId, day) {
      const r = await pool.query(
        'select id, route_id, from_city, cards, submitted_at from ghosttrains_pending_moves where profile_id=$1 and game_day=$2 and resolved=false',
        [profileId, day]
      );
      return r.rows;
    },
    async unresolvedForDay(day) {
      const r = await pool.query(
        'select id, profile_id, route_id, from_city, cards, submitted_at from ghosttrains_pending_moves where game_day=$1 and resolved=false order by submitted_at asc',
        [day]
      );
      return r.rows;
    },
    async markResolved(ids) {
      if (!ids.length) return;
      await pool.query('update ghosttrains_pending_moves set resolved=true where id = any($1)', [ids]);
    },
    async buildRoute(routeId, track, profileId, day) {
      await pool.query(
        `insert into ghosttrains_routes (route_id, track, owner_profile_id, built_on_day) values ($1,$2,$3,$4)
         on conflict (route_id, track) do nothing`,
        [routeId, track, profileId, day]
      );
    },
    async isDayResolved(day) {
      const r = await pool.query('select 1 from ghosttrains_resolved_days where game_day=$1', [day]);
      return r.rows.length > 0;
    },
    async markDayResolved(day) {
      await pool.query('insert into ghosttrains_resolved_days (game_day) values ($1) on conflict do nothing', [day]);
    },
    async insertLog(entry) {
      await pool.query(
        `insert into ghosttrains_resolution_log (game_day, profile_id, kind, route_id, alt_route_id, other_players, details)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [entry.gameDay, entry.profileId, entry.kind, entry.routeId || null, entry.altRouteId || null,
          JSON.stringify(entry.otherPlayers || []), entry.details ? JSON.stringify(entry.details) : null]
      );
    },
    // Pass 3: hela familjens händelser för en dag (inte bara en profils
    // egna) — se .claude/plans, "Stories"-digesten.
    async logForDay(day) {
      const r = await pool.query(
        'select id, game_day, profile_id, kind, route_id, alt_route_id, other_players, details, created_at from ghosttrains_resolution_log where game_day=$1 order by id asc',
        [day]
      );
      return r.rows;
    },
    async getPlayer(profileId) {
      const r = await pool.query('select train_cars, score, initial_tickets_dealt, joined from ghosttrains_players where profile_id=$1', [profileId]);
      if (r.rows[0]) return { trainCars: r.rows[0].train_cars, score: r.rows[0].score, initialTicketsDealt: r.rows[0].initial_tickets_dealt, joined: r.rows[0].joined };
      await pool.query(
        `insert into ghosttrains_players (profile_id, train_cars) values ($1, ${START_CARS_SQL})
         on conflict (profile_id) do nothing`, [profileId]);
      return this.getPlayer(profileId);
    },
    async allPlayers() {
      const r = await pool.query('select profile_id, train_cars, score, joined, color_idx from ghosttrains_players');
      return r.rows.map(row => ({ profileId: row.profile_id, trainCars: row.train_cars, score: row.score, joined: row.joined, colorIdx: row.color_idx }));
    },
    // Ger varje spelare som gått med (eller byggt) men saknar färg en
    // ledig färg. Tabellås så två samtidiga anslutningar inte får samma.
    async assignPlayerColors() {
      const client = await pool.connect();
      try {
        await client.query('begin');
        await client.query('lock table ghosttrains_players in share row exclusive mode');
        const r = await client.query(
          `select profile_id, color_idx from ghosttrains_players
           where joined or score > 0 or color_idx is not null order by profile_id`);
        const used = new Set(r.rows.filter(x => x.color_idx != null).map(x => x.color_idx));
        for (const row of r.rows.filter(x => x.color_idx == null)) {
          const idx = nextColorIdx(used);
          used.add(idx);
          await client.query('update ghosttrains_players set color_idx=$2 where profile_id=$1', [row.profile_id, idx]);
        }
        await client.query('commit');
      } catch (e) { await client.query('rollback'); throw e; }
      finally { client.release(); }
    },
    async deductTrainCars(profileId, amount) {
      await pool.query(
        `insert into ghosttrains_players (profile_id, train_cars) values ($1, ${START_CARS_SQL} - $2)
         on conflict (profile_id) do update set train_cars = ghosttrains_players.train_cars - $2`,
        [profileId, amount]
      );
    },
    async addScore(profileId, amount) {
      await pool.query(
        `insert into ghosttrains_players (profile_id, train_cars, score) values ($1, ${START_CARS_SQL}, $2)
         on conflict (profile_id) do update set score = ghosttrains_players.score + $2`,
        [profileId, amount]
      );
    },
    async joinGame(profileId) {
      await pool.query(
        `insert into ghosttrains_players (profile_id, train_cars, joined) values ($1, ${START_CARS_SQL}, true)
         on conflict (profile_id) do update set joined = true`,
        [profileId]
      );
    },
    // Atomär: true bara för det anrop som faktiskt vänder flaggan, så två
    // samtidiga /state-anrop aldrig kan ge dubbla startkort.
    async claimInitialCards(profileId) {
      const r = await pool.query(
        `insert into ghosttrains_players (profile_id, train_cars, initial_cards_dealt) values ($1, ${START_CARS_SQL}, true)
         on conflict (profile_id) do update set initial_cards_dealt = true
         where ghosttrains_players.initial_cards_dealt = false
         returning profile_id`,
        [profileId]
      );
      return r.rows.length > 0;
    },
    async setInitialTicketsDealt(profileId) {
      await pool.query(
        `insert into ghosttrains_players (profile_id, train_cars, initial_tickets_dealt) values ($1, ${START_CARS_SQL}, true)
         on conflict (profile_id) do update set initial_tickets_dealt = true`,
        [profileId]
      );
    },
    async getPlayerTickets(profileId) {
      const r = await pool.query('select ticket_id from ghosttrains_player_tickets where profile_id=$1', [profileId]);
      return r.rows.map(row => row.ticket_id);
    },
    async allPlayerTickets() {
      const r = await pool.query('select profile_id, ticket_id from ghosttrains_player_tickets');
      return r.rows.map(row => ({ profileId: row.profile_id, ticketId: row.ticket_id }));
    },
    async addPlayerTickets(profileId, ticketIds) {
      for (const ticketId of ticketIds) {
        await pool.query('insert into ghosttrains_player_tickets (profile_id, ticket_id) values ($1,$2) on conflict do nothing', [profileId, ticketId]);
      }
    },
    async getTicketOffer(profileId) {
      const r = await pool.query('select ticket_ids, min_keep from ghosttrains_ticket_offers where profile_id=$1', [profileId]);
      return r.rows[0] ? { ticketIds: r.rows[0].ticket_ids, minKeep: r.rows[0].min_keep } : null;
    },
    async setTicketOffer(profileId, ticketIds, minKeep) {
      await pool.query(
        `insert into ghosttrains_ticket_offers (profile_id, ticket_ids, min_keep) values ($1,$2,$3)
         on conflict (profile_id) do update set ticket_ids=$2, min_keep=$3`,
        [profileId, JSON.stringify(ticketIds), minKeep]
      );
    },
    async clearTicketOffer(profileId) {
      await pool.query('delete from ghosttrains_ticket_offers where profile_id=$1', [profileId]);
    },
    async getGameState() {
      const r = await pool.query('select status, final_day, final_results, game_no, map_id, starting_cars from ghosttrains_game_state where id=1');
      if (!r.rows[0]) return { status: 'active', finalDay: null, finalResults: null, gameNo: 1, mapId: DEFAULT_MAP_ID, startingCars: STARTING_TRAIN_CARS };
      const row = r.rows[0];
      return {
        status: row.status, finalDay: row.final_day, finalResults: row.final_results, gameNo: row.game_no,
        mapId: row.map_id || DEFAULT_MAP_ID, startingCars: row.starting_cars || STARTING_TRAIN_CARS
      };
    },
    async setGameState(status, finalDay, finalResults = null) {
      await pool.query(
        `insert into ghosttrains_game_state (id, status, final_day, final_results) values (1,$1,$2,$3)
         on conflict (id) do update set status=$1, final_day=$2, final_results=$3`,
        [status, finalDay || null, finalResults ? JSON.stringify(finalResults) : null]
      );
    },
    // Nollställer brädet för ett nytt spel — bara om det förra är slut.
    // Låser game_state-raden så att två samtidiga klick inte kan starta
    // två spel. Loggen och resolved_days behålls (historik + idempotens).
    async resetGame(m) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const r = await client.query('select status, game_no from ghosttrains_game_state where id=1 for update');
        if (!r.rows[0] || r.rows[0].status !== 'finished') { await client.query('rollback'); return null; }
        for (const t of ['ghosttrains_hands', 'ghosttrains_deck', 'ghosttrains_routes', 'ghosttrains_market',
          'ghosttrains_players', 'ghosttrains_player_tickets', 'ghosttrains_ticket_offers', 'ghosttrains_ticket_deck']) {
          await client.query(`delete from ${t}`);
        }
        await client.query('delete from ghosttrains_pending_moves where resolved=false');
        const gameNo = r.rows[0].game_no + 1;
        await client.query(
          `update ghosttrains_game_state set status='active', final_day=null, final_results=null, game_no=$1,
             map_id=$2, starting_cars=$3 where id=1`,
          [gameNo, m.id, m.startingTrainCars]
        );
        await client.query('commit');
        return gameNo;
      } catch (e) { await client.query('rollback'); throw e; }
      finally { client.release(); }
    },
    // Delad, cirkulerande biljettlek — samma FOR UPDATE-transaktionsmönster
    // som kortmarknaden i Pass 1 (delad, muterbar state, samma racerisk).
    async dealTickets(count, m) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const r = await client.query('select remaining from ghosttrains_ticket_deck where id=1 for update');
        let deck = r.rows[0] ? r.rows[0].remaining : shuffle(m.tickets.map(t => t.id));
        const dealt = [];
        for (let i = 0; i < count && deck.length > 0; i++) dealt.push(deck.pop());
        await client.query('insert into ghosttrains_ticket_deck (id, remaining) values (1,$1) on conflict (id) do update set remaining=$1', [JSON.stringify(deck)]);
        await client.query('commit');
        return dealt;
      } catch (e) { await client.query('rollback'); throw e; }
      finally { client.release(); }
    },
    // Dealar EXAKT en biljett per given tier (initial gratis-deal).
    async dealTicketsByTier(tiers, m) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const r = await client.query('select remaining from ghosttrains_ticket_deck where id=1 for update');
        let deck = r.rows[0] ? r.rows[0].remaining : shuffle(m.tickets.map(t => t.id));
        const dealt = [];
        for (const tier of tiers) {
          let idx = -1;
          for (let i = deck.length - 1; i >= 0; i--) {
            if (ticketTier(m.ticketsById.get(deck[i])?.points) === tier) { idx = i; break; }
          }
          if (idx >= 0) dealt.push(deck.splice(idx, 1)[0]);
        }
        await client.query('insert into ghosttrains_ticket_deck (id, remaining) values (1,$1) on conflict (id) do update set remaining=$1', [JSON.stringify(deck)]);
        await client.query('commit');
        return dealt;
      } catch (e) { await client.query('rollback'); throw e; }
      finally { client.release(); }
    },
    async returnTicketsToDeck(ticketIds, m) {
      if (!ticketIds.length) return;
      const client = await pool.connect();
      try {
        await client.query('begin');
        const r = await client.query('select remaining from ghosttrains_ticket_deck where id=1 for update');
        let deck = r.rows[0] ? r.rows[0].remaining : shuffle(m.tickets.map(t => t.id));
        ticketIds.forEach(id => deck.unshift(id));
        await client.query('insert into ghosttrains_ticket_deck (id, remaining) values (1,$1) on conflict (id) do update set remaining=$1', [JSON.stringify(deck)]);
        await client.query('commit');
      } catch (e) { await client.query('rollback'); throw e; }
      finally { client.release(); }
    },
    // Lat-återställd: spenderar `amount` AP om spelaren har råd (annars
    // null, ingen mutation). amount=0 fungerar som en ren "peek" som
    // samtidigt initierar dagens rad — se .claude/plans (AP-mönstret).
    async spendAP(profileId, day, amount) {
      const r = await pool.query(
        `insert into ghosttrains_ap (profile_id, game_day, remaining)
         select $1, $2, ${DAILY_AP} - $3 where ${DAILY_AP} - $3 >= 0
         on conflict (profile_id) do update set
           remaining = case when ghosttrains_ap.game_day = $2 then ghosttrains_ap.remaining - $3 else ${DAILY_AP} - $3 end,
           game_day = $2
         where (ghosttrains_ap.game_day <> $2 and ${DAILY_AP} - $3 >= 0)
            or (ghosttrains_ap.game_day = $2 and ghosttrains_ap.remaining - $3 >= 0)
         returning remaining`,
        [profileId, day, amount]
      );
      return r.rows[0] ? r.rows[0].remaining : null;
    },
    // Lat-initierar marknaden (5 kort) om den saknas — read-only i övrigt.
    async getMarketSnapshot() {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const mres = await client.query('select cards from ghosttrains_market where id=1 for update');
        let cards = mres.rows[0] ? mres.rows[0].cards : null;
        if (!cards) {
          const st = await lockDeck(client);
          cards = freshMarket(deckDrawer(st));
          await saveDeckState(client, st);
          await client.query('insert into ghosttrains_market (id, cards) values (1,$1) on conflict (id) do nothing', [JSON.stringify(cards)]);
        }
        await client.query('commit');
        return cards;
      } catch (e) { await client.query('rollback'); throw e; }
      finally { client.release(); }
    },
    // Allt i EN transaktion (marknad + kortlek + AP): marknaden är delad,
    // muterbar state som flera spelare kan träffa samtidigt — utan detta
    // kunde två samtidiga drag på samma plats ge samma kort till båda
    // (se .claude/plans, "den enda verkliga tekniska risken"). AP-kostnaden
    // avgörs av vilket kort som FAKTISKT ligger där just nu (inuti låset),
    // inte ett tidigare separat peek — annars kunde kostnaden bli fel om
    // någon annan hann ändra marknaden mellan koll och drag.
    // expectedCard (valfri): kortet klienten SÅG på platsen. Ligger något
    // annat där nu (någon annan hann före) avbryts draget utan AP-kostnad
    // och aktuell marknad returneras — kontrollen sker inuti låset.
    async drawMarketCard(profileId, day, index, expectedCard) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const mres = await client.query('select cards from ghosttrains_market where id=1 for update');
        const st = await lockDeck(client);
        let cards = mres.rows[0] ? mres.rows[0].cards : null;
        if (!cards) cards = freshMarket(deckDrawer(st));
        if (!(index >= 0 && index < cards.length)) { await client.query('rollback'); return { error: 'ogiltigt kortval' }; }
        if (expectedCard && cards[index] !== expectedCard) { await client.query('rollback'); return { error: 'stale', market: cards }; }

        const drawnCard = cards[index];
        const cost = drawnCard === WILD ? 2 : 1;
        const apRes = await client.query(
          `insert into ghosttrains_ap (profile_id, game_day, remaining)
           select $1, $2, ${DAILY_AP} - $3 where ${DAILY_AP} - $3 >= 0
           on conflict (profile_id) do update set
             remaining = case when ghosttrains_ap.game_day = $2 then ghosttrains_ap.remaining - $3 else ${DAILY_AP} - $3 end,
             game_day = $2
           where (ghosttrains_ap.game_day <> $2 and ${DAILY_AP} - $3 >= 0)
              or (ghosttrains_ap.game_day = $2 and ghosttrains_ap.remaining - $3 >= 0)
           returning remaining`,
          [profileId, day, cost]
        );
        if (!apRes.rows[0]) { await client.query('rollback'); return { error: 'ap' }; }

        const newCards = refillMarket(cards, index, st);

        await saveDeckState(client, st);
        await client.query('insert into ghosttrains_market (id, cards) values (1,$1) on conflict (id) do update set cards=$1', [JSON.stringify(newCards)]);
        await client.query('commit');
        return { drawnCard, market: newCards, apRemaining: apRes.rows[0].remaining };
      } catch (e) { await client.query('rollback'); throw e; }
      finally { client.release(); }
    }
  };
}

function memStore() {
  const hands = new Map();
  const deckState = { deck: freshDeck(), discard: [] };
  const drawOneMem = deckDrawer(deckState);
  let routes = [];
  let pending = [];
  const resolvedDays = new Set();
  const log = [];
  const apState = new Map();
  let market = null;
  const players = new Map();
  const playerTickets = new Map();
  const ticketOffers = new Map();
  let ticketDeck = null;
  let gameState = { status: 'active', finalDay: null, finalResults: null, gameNo: 1, mapId: DEFAULT_MAP_ID, startingCars: STARTING_TRAIN_CARS };
  let nextPendingId = 1, nextLogId = 1;
  function getPlayerMem(profileId) {
    let p = players.get(profileId);
    if (!p) { p = { trainCars: gameState.startingCars, score: 0, initialTicketsDealt: false, initialCardsDealt: false, joined: false }; players.set(profileId, p); }
    return p;
  }
  function ensureTicketDeck(m) { if (!ticketDeck) ticketDeck = shuffle(m.tickets.map(t => t.id)); return ticketDeck; }
  return {
    async getHand(profileId) { return hands.get(profileId) || []; },
    async saveHand(profileId, hand) { hands.set(profileId, hand); },
    async addToHand(profileId, cards) { const h = (hands.get(profileId) || []).concat(cards); hands.set(profileId, h); return h; },
    async replaceHandIf(profileId, oldHand, newHand) {
      if (JSON.stringify(hands.get(profileId) || []) !== JSON.stringify(oldHand)) return false;
      hands.set(profileId, newHand);
      return true;
    },
    async drawFromDeck(count) { const out = []; for (let i = 0; i < count; i++) out.push(drawOneMem()); return out; },
    async discardCards(cards) { deckState.discard.push(...cards); },
    async builtRoutes() { return routes.map(r => ({ route_id: r.routeId, track: r.track, owner_profile_id: r.ownerProfileId })); },
    async insertPending(move) {
      const id = nextPendingId++;
      pending.push({ id, profileId: move.profileId, routeId: move.routeId, fromCity: move.fromCity, cards: move.cards, gameDay: move.gameDay, submittedAt: new Date().toISOString(), resolved: false });
      return id;
    },
    async pendingForProfileToday(profileId, day) {
      return pending.filter(p => p.profileId === profileId && p.gameDay === day && !p.resolved)
        .map(p => ({ id: p.id, route_id: p.routeId, from_city: p.fromCity, cards: p.cards, submitted_at: p.submittedAt }));
    },
    async unresolvedForDay(day) {
      return pending.filter(p => p.gameDay === day && !p.resolved)
        .sort((a, b) => new Date(a.submittedAt) - new Date(b.submittedAt))
        .map(p => ({ id: p.id, profile_id: p.profileId, route_id: p.routeId, from_city: p.fromCity, cards: p.cards, submitted_at: p.submittedAt }));
    },
    async markResolved(ids) { pending.forEach(p => { if (ids.includes(p.id)) p.resolved = true; }); },
    async buildRoute(routeId, track, profileId, day) {
      if (!routes.some(r => r.routeId === routeId && r.track === track)) {
        routes.push({ routeId, track, ownerProfileId: profileId, builtOnDay: day });
      }
    },
    async isDayResolved(day) { return resolvedDays.has(day); },
    async markDayResolved(day) { resolvedDays.add(day); },
    async insertLog(entry) {
      log.push({
        id: nextLogId++, gameDay: entry.gameDay, profileId: entry.profileId, kind: entry.kind,
        routeId: entry.routeId || null, altRouteId: entry.altRouteId || null, otherPlayers: entry.otherPlayers || [],
        details: entry.details || null, createdAt: new Date().toISOString()
      });
    },
    async logForDay(day) {
      return log.filter(e => e.gameDay === day)
        .map(e => ({ id: e.id, game_day: e.gameDay, profile_id: e.profileId, kind: e.kind, route_id: e.routeId, alt_route_id: e.altRouteId, other_players: e.otherPlayers, details: e.details, created_at: e.createdAt }));
    },
    async getPlayer(profileId) { const p = getPlayerMem(profileId); return { trainCars: p.trainCars, score: p.score, initialTicketsDealt: p.initialTicketsDealt, joined: p.joined }; },
    async allPlayers() { return Array.from(players.entries()).map(([profileId, p]) => ({ profileId, trainCars: p.trainCars, score: p.score, joined: p.joined, colorIdx: p.colorIdx ?? null })); },
    async assignPlayerColors() {
      const list = Array.from(players.entries()).filter(([, p]) => p.joined || p.score > 0 || p.colorIdx != null)
        .sort((a, b) => a[0].localeCompare(b[0]));
      const used = new Set(list.filter(([, p]) => p.colorIdx != null).map(([, p]) => p.colorIdx));
      list.filter(([, p]) => p.colorIdx == null).forEach(([, p]) => { p.colorIdx = nextColorIdx(used); used.add(p.colorIdx); });
    },
    async joinGame(profileId) { getPlayerMem(profileId).joined = true; },
    async deductTrainCars(profileId, amount) { getPlayerMem(profileId).trainCars -= amount; },
    async addScore(profileId, amount) { getPlayerMem(profileId).score += amount; },
    async setInitialTicketsDealt(profileId) { getPlayerMem(profileId).initialTicketsDealt = true; },
    async claimInitialCards(profileId) {
      const p = getPlayerMem(profileId);
      if (p.initialCardsDealt) return false;
      p.initialCardsDealt = true;
      return true;
    },
    async getPlayerTickets(profileId) { return Array.from(playerTickets.get(profileId) || []); },
    async allPlayerTickets() {
      const out = [];
      playerTickets.forEach((set, profileId) => set.forEach(ticketId => out.push({ profileId, ticketId })));
      return out;
    },
    async addPlayerTickets(profileId, ticketIds) {
      if (!playerTickets.has(profileId)) playerTickets.set(profileId, new Set());
      const set = playerTickets.get(profileId);
      ticketIds.forEach(id => set.add(id));
    },
    async getTicketOffer(profileId) { return ticketOffers.get(profileId) || null; },
    async setTicketOffer(profileId, ticketIds, minKeep) { ticketOffers.set(profileId, { ticketIds, minKeep }); },
    async clearTicketOffer(profileId) { ticketOffers.delete(profileId); },
    async getGameState() { return gameState; },
    async setGameState(status, finalDay, finalResults = null) {
      gameState = { ...gameState, status, finalDay: finalDay || null, finalResults: finalResults || null };
    },
    async resetGame(m) {
      if (gameState.status !== 'finished') return null;
      hands.clear(); deckState.deck = freshDeck(); deckState.discard = []; routes = []; market = null;
      players.clear(); playerTickets.clear(); ticketOffers.clear(); ticketDeck = null;
      pending = pending.filter(p => p.resolved);
      gameState = { status: 'active', finalDay: null, finalResults: null, gameNo: gameState.gameNo + 1, mapId: m.id, startingCars: m.startingTrainCars };
      return gameState.gameNo;
    },
    async dealTickets(count, m) {
      const d = ensureTicketDeck(m);
      const dealt = [];
      for (let i = 0; i < count && d.length > 0; i++) dealt.push(d.pop());
      return dealt;
    },
    async dealTicketsByTier(tiers, m) {
      const d = ensureTicketDeck(m);
      const dealt = [];
      tiers.forEach(tier => {
        let idx = -1;
        for (let i = d.length - 1; i >= 0; i--) {
          if (ticketTier(m.ticketsById.get(d[i])?.points) === tier) { idx = i; break; }
        }
        if (idx >= 0) dealt.push(d.splice(idx, 1)[0]);
      });
      return dealt;
    },
    async returnTicketsToDeck(ticketIds, m) {
      const d = ensureTicketDeck(m);
      ticketIds.forEach(id => d.unshift(id));
    },
    async spendAP(profileId, day, amount) {
      let s = apState.get(profileId);
      if (!s || s.day !== day) s = { day, remaining: DAILY_AP };
      if (s.remaining - amount < 0) return null;
      s.remaining -= amount;
      apState.set(profileId, s);
      return s.remaining;
    },
    async getMarketSnapshot() {
      if (!market) market = freshMarket(drawOneMem);
      return market.slice();
    },
    async drawMarketCard(profileId, day, index, expectedCard) {
      if (!market) market = freshMarket(drawOneMem);
      if (!(index >= 0 && index < market.length)) return { error: 'ogiltigt kortval' };
      if (expectedCard && market[index] !== expectedCard) return { error: 'stale', market: market.slice() };
      const drawnCard = market[index];
      const cost = drawnCard === WILD ? 2 : 1;
      let s = apState.get(profileId);
      if (!s || s.day !== day) s = { day, remaining: DAILY_AP };
      if (s.remaining - cost < 0) return { error: 'ap' };
      s.remaining -= cost;
      apState.set(profileId, s);
      market = refillMarket(market, index, deckState);
      return { drawnCard, market: market.slice(), apRemaining: s.remaining };
    }
  };
}

/* ---------- Router ---------- */
function validProfileId(id) { return typeof id === 'string' && /^[a-z0-9]{4,64}$/i.test(id); }

// Gemensam spärr för alla drag: spelet får inte vara slut, och profilen
// måste ha tryckt "Gå med i spelet" (POST /join).
async function actionBlocked(store, profileId) {
  if ((await store.getGameState()).status === 'finished') return { status: 409, error: 'spelet ar slut' };
  if (!(await store.getPlayer(profileId)).joined) return { status: 403, error: 'du har inte gatt med i spelet' };
  return null;
}

const MAP_LIST = Object.values(MAPS).map(d => ({
  id: d.id, name: d.name, description: d.description,
  cityCount: d.cities.length, routeCount: d.routes.length, startingTrainCars: d.startingTrainCars
}));
const CITY_NAMES = Object.fromEntries(Object.values(MAPS).flatMap(d => d.cities.map(c => [c.id, c.name])));

function createGhostTrainsRouter(store, resolveSecret) {
  const router = express.Router();

  // Det pågående spelets karta, eller ?mapId= för en annan (kartvalet
  // vid nytt spel). `maps` listar alla kartor; `cityNames` täcker alla
  // kartors städer så att gamla nattrapporter (från ett spel på en
  // annan karta) ändå kan visa stadsnamn.
  router.get('/map', async (req, res) => {
    try {
      const requested = typeof req.query.mapId === 'string' && MAPS[req.query.mapId] ? req.query.mapId : null;
      const def = MAPS[requested || mapForGame(await store.getGameState()).id];
      res.json({
        id: def.id, name: def.name, width: def.width, height: def.height,
        startingTrainCars: def.startingTrainCars, outlineSvg: def.outlineSvg,
        cities: def.cities, routes: def.routes,
        maps: MAP_LIST, cityNames: CITY_NAMES
      });
    } catch (e) { console.error(e); res.status(500).json({ error: 'databasfel' }); }
  });

  router.get('/state', async (req, res) => {
    const profileId = req.query.profileId;
    if (!validProfileId(profileId)) return res.status(400).json({ error: 'ogiltigt profileId' });
    try {
      const day = gameDay();
      let [hand, built, pendingMine, apRemaining, market, player, ticketIds, gameState] = await Promise.all([
        store.getHand(profileId), store.builtRoutes(), store.pendingForProfileToday(profileId, day),
        store.spendAP(profileId, day, 0), store.getMarketSnapshot(), store.getPlayer(profileId),
        store.getPlayerTickets(profileId), store.getGameState()
      ]);

      // Startgiv: 4 tågkort, lat vid profilens första /state (som biljetterna).
      if (player.joined && gameState.status !== 'finished' && await store.claimInitialCards(profileId)) {
        hand = await store.addToHand(profileId, await store.drawFromDeck(STARTING_HAND_SIZE));
      }

      // Gratis startbiljetter (1 lång + 1 medium + 1 kort) delas ut lat,
      // första gången någon läser /state för profilen — se .claude/plans.
      let ticketOffer = await store.getTicketOffer(profileId);
      if (player.joined && !ticketOffer && !player.initialTicketsDealt) {
        const dealt = await store.dealTicketsByTier(['long', 'medium', 'short'], mapForGame(gameState));
        if (dealt.length) {
          await store.setTicketOffer(profileId, dealt, 2);
          await store.setInitialTicketsDealt(profileId);
          ticketOffer = { ticketIds: dealt, minKeep: 2 };
        }
      }

      const m = mapForGame(gameState);
      const finalResults = gameState.status === 'finished' ? await finalResultsFor(store, gameState) : null;


      // Offentlig ställning: tågvagnar, ruttpoäng och antal biljetter per
      // spelare (i Ticket to Ride ligger allt detta öppet på bordet).
      let [allPlayers, allTickets] = await Promise.all([store.allPlayers(), store.allPlayerTickets()]);
      // Lat färgtilldelning (täcker även spelare från före färgerna fanns).
      if (allPlayers.some(p => (p.joined || p.score > 0) && p.colorIdx == null)) {
        await store.assignPlayerColors();
        allPlayers = await store.allPlayers();
      }
      const ticketCount = new Map();
      allTickets.forEach(t => ticketCount.set(t.profileId, (ticketCount.get(t.profileId) || 0) + 1));
      const players = allPlayers
        .map(p => ({ profileId: p.profileId, joined: !!p.joined, colorIdx: p.colorIdx, trainCars: p.trainCars, score: p.score, ticketCount: ticketCount.get(p.profileId) || 0 }))
        .filter(p => p.joined || p.ticketCount > 0 || p.score > 0 || p.trainCars < gameState.startingCars)
        .sort((a, b) => b.score - a.score);

      res.json({
        gameDay: day,
        hand,
        built: built.map(b => ({ routeId: b.route_id, track: b.track, ownerProfileId: b.owner_profile_id })),
        pendingToday: pendingMine.map(p => ({ id: p.id, routeId: p.route_id, fromCity: p.from_city, cards: p.cards })),
        apRemaining,
        apMax: DAILY_AP,
        market,
        trainCars: player.trainCars,
        score: player.score,
        tickets: await decorateTickets(store, m, profileId, ticketIds),
        players,
        ticketOffer: ticketOffer ? { tickets: await decorateTickets(store, m, profileId, ticketOffer.ticketIds), minKeep: ticketOffer.minKeep } : null,
        joined: !!player.joined,
        gameStatus: gameState.status,
        finalDay: gameState.finalDay,
        gameNo: gameState.gameNo || 1,
        mapId: m.id,
        finalResults
      });
    } catch (e) { console.error(e); res.status(500).json({ error: 'databasfel' }); }
  });

  router.get('/market', async (req, res) => {
    try { res.json({ cards: await store.getMarketSnapshot() }); }
    catch (e) { console.error(e); res.status(500).json({ error: 'databasfel' }); }
  });

  router.post('/draw', async (req, res) => {
    const profileId = (req.body || {}).profileId;
    if (!validProfileId(profileId)) return res.status(400).json({ error: 'ogiltigt profileId' });
    try {
      const blocked = await actionBlocked(store, profileId);
      if (blocked) return res.status(blocked.status).json({ error: blocked.error });
      const day = gameDay();
      const apRemaining = await store.spendAP(profileId, day, 1);
      if (apRemaining == null) return res.status(402).json({ error: 'inte tillrackligt med AP' });
      const [card] = await store.drawFromDeck(1);
      const hand = await store.addToHand(profileId, [card]);
      res.json({ ok: true, drawn: [card], hand, apRemaining });
    } catch (e) { console.error(e); res.status(500).json({ error: 'databasfel' }); }
  });

  router.post('/market/draw', async (req, res) => {
    const b = req.body || {};
    const profileId = b.profileId;
    const index = parseInt(b.index, 10);
    if (!validProfileId(profileId)) return res.status(400).json({ error: 'ogiltigt profileId' });
    if (!(index >= 0 && index <= 4)) return res.status(400).json({ error: 'ogiltigt kortval' });
    try {
      const blocked = await actionBlocked(store, profileId);
      if (blocked) return res.status(blocked.status).json({ error: blocked.error });
      const day = gameDay();
      const expectedCard = typeof b.expectedCard === 'string' ? b.expectedCard : null;
      const result = await store.drawMarketCard(profileId, day, index, expectedCard);
      if (result.error === 'stale') return res.status(409).json({ error: 'kortet har redan tagits', market: result.market });
      if (result.error === 'ap') return res.status(402).json({ error: 'inte tillrackligt med AP' });
      if (result.error) return res.status(400).json({ error: result.error });
      const hand = await store.addToHand(profileId, [result.drawnCard]);
      res.json({ ok: true, drawn: result.drawnCard, hand, apRemaining: result.apRemaining, market: result.market });
    } catch (e) { console.error(e); res.status(500).json({ error: 'databasfel' }); }
  });

  router.post('/claim', async (req, res) => {
    const b = req.body || {};
    const profileId = b.profileId;
    if (!validProfileId(profileId)) return res.status(400).json({ error: 'ogiltigt profileId' });
    try {
      const m = mapForGame(await store.getGameState());
      const route = m.routesById.get(b.routeId);
      if (!route) return res.status(400).json({ error: 'okand rutt' });
      if (!validateClaimCards(route, b.cards)) return res.status(400).json({ error: 'ogiltiga kort for denna rutt' });
      const blocked = await actionBlocked(store, profileId);
      if (blocked) return res.status(blocked.status).json({ error: blocked.error });
      const built = await store.builtRoutes();
      const builtSet = new Set(built.map(r => r.route_id + '|' + r.track));
      const freeSlots = trackSlots(route).filter(t => !builtSet.has(route.id + '|' + t));
      if (freeSlots.length === 0) return res.status(409).json({ error: 'rutten ar redan helt byggd' });
      if (ownsTrackOn(route.id, profileId, built)) return res.status(409).json({ error: 'du ager redan ena sparet pa denna rutt' });
      const day = gameDay();
      // Flera claims samma dag: aldrig samma rutt två gånger (skulle
      // krocka med sig själv / ge båda dubbelspåren), och tågvagnarna
      // räknas mot ALLA dagens oupplösta claims, inte bara detta.
      const pendingToday = await store.pendingForProfileToday(profileId, day);
      if (pendingToday.some(p => p.route_id === route.id)) return res.status(409).json({ error: 'du har redan ett claim pa denna rutt idag' });
      const reserved = pendingToday.reduce((sum, p) => sum + (m.routesById.get(p.route_id)?.length || 0), 0);
      const player = await store.getPlayer(profileId);
      if (player.trainCars - reserved < route.length) return res.status(400).json({ error: 'inte tillrackligt med tagvagnar kvar' });
      const hand = await store.getHand(profileId);
      const newHand = removeCards(hand, b.cards);
      if (!newHand) return res.status(400).json({ error: 'du har inte de korten' });
      const fromCity = pickOriginCity(m, route, profileId, built);
      // Handen tas atomärt (compare-and-swap) innan AP spenderas — ett
      // samtidigt drag/dubbeltryck ger 409 istället för att tappa kort.
      // Misslyckas AP:t läggs korten tillbaka på handen.
      if (!(await store.replaceHandIf(profileId, hand, newHand))) {
        return res.status(409).json({ error: 'handen andrades samtidigt - forsok igen' });
      }
      const apRemaining = await store.spendAP(profileId, day, 2);
      if (apRemaining == null) {
        await store.addToHand(profileId, b.cards);
        return res.status(402).json({ error: 'inte tillrackligt med AP' });
      }
      await store.discardCards(b.cards); // spenderade kort till kasthögen
      const id = await store.insertPending({ profileId, routeId: route.id, fromCity, cards: b.cards, gameDay: day });
      res.json({ ok: true, id, hand: newHand, apRemaining });
    } catch (e) { console.error(e); res.status(500).json({ error: 'databasfel' }); }
  });

  router.post('/tickets/draw', async (req, res) => {
    const profileId = (req.body || {}).profileId;
    if (!validProfileId(profileId)) return res.status(400).json({ error: 'ogiltigt profileId' });
    try {
      const blocked = await actionBlocked(store, profileId);
      if (blocked) return res.status(blocked.status).json({ error: blocked.error });
      const existing = await store.getTicketOffer(profileId);
      if (existing) return res.status(409).json({ error: 'du har redan olästa biljetter att välja bland' });
      const day = gameDay();
      const apRemaining = await store.spendAP(profileId, day, 1);
      if (apRemaining == null) return res.status(402).json({ error: 'inte tillrackligt med AP' });
      const m = mapForGame(await store.getGameState());
      const dealt = await store.dealTickets(3, m);
      if (!dealt.length) return res.json({ ok: true, offer: null, apRemaining, note: 'inga fler biljetter kvar i leken' });
      await store.setTicketOffer(profileId, dealt, 1);
      res.json({ ok: true, offer: { tickets: await decorateTickets(store, m, profileId, dealt), minKeep: 1 }, apRemaining });
    } catch (e) { console.error(e); res.status(500).json({ error: 'databasfel' }); }
  });

  router.post('/tickets/choose', async (req, res) => {
    const b = req.body || {};
    const profileId = b.profileId;
    if (!validProfileId(profileId)) return res.status(400).json({ error: 'ogiltigt profileId' });
    const keepIds = Array.isArray(b.keepIds) ? b.keepIds : [];
    try {
      const blocked = await actionBlocked(store, profileId);
      if (blocked) return res.status(blocked.status).json({ error: blocked.error });
      const offer = await store.getTicketOffer(profileId);
      if (!offer) return res.status(400).json({ error: 'ingen biljett-offer att svara pa' });
      const offeredSet = new Set(offer.ticketIds);
      const validKeep = keepIds.filter(id => offeredSet.has(id));
      if (validKeep.length !== keepIds.length || keepIds.length < offer.minKeep) {
        return res.status(400).json({ error: 'maste behalla minst ' + offer.minKeep + ' av de erbjudna biljetterna' });
      }
      const discard = offer.ticketIds.filter(id => !keepIds.includes(id));
      const m = mapForGame(await store.getGameState());
      await store.addPlayerTickets(profileId, keepIds);
      await store.returnTicketsToDeck(discard, m);
      await store.clearTicketOffer(profileId);
      const ticketIds = await store.getPlayerTickets(profileId);
      res.json({ ok: true, tickets: await decorateTickets(store, m, profileId, ticketIds) });
    } catch (e) { console.error(e); res.status(500).json({ error: 'databasfel' }); }
  });

  // "Gå med i spelet" — bara medan spelet är aktivt (inte under sista
  // rundan, då hinner man ändå inget). Startgiven delas sedan ut lat
  // vid nästa /state, samma väg som tidigare.
  router.post('/join', async (req, res) => {
    const profileId = (req.body || {}).profileId;
    if (!validProfileId(profileId)) return res.status(400).json({ error: 'ogiltigt profileId' });
    try {
      const status = (await store.getGameState()).status;
      if (status === 'final_round') return res.status(409).json({ error: 'sista rundan pagar - ga med i nasta spel' });
      if (status === 'finished') return res.status(409).json({ error: 'spelet ar slut' });
      await store.joinGame(profileId);
      res.json({ ok: true });
    } catch (e) { console.error(e); res.status(500).json({ error: 'databasfel' }); }
  });

  // Startar ett nytt spel när det förra är slut. Vem som helst i
  // familjen får trycka — samma öppna förtroendemodell som resten.
  // { mapId } väljer karta; utelämnat = samma karta som förra spelet.
  router.post('/new-game', async (req, res) => {
    const b = req.body || {};
    const profileId = b.profileId;
    if (!validProfileId(profileId)) return res.status(400).json({ error: 'ogiltigt profileId' });
    if (b.mapId != null && !MAPS[b.mapId]) return res.status(400).json({ error: 'okand karta' });
    try {
      const m = b.mapId ? mapContext(b.mapId) : mapForGame(await store.getGameState());
      const gameNo = await store.resetGame(m);
      if (gameNo == null) return res.status(409).json({ error: 'spelet ar inte slut an' });
      await store.joinGame(profileId); // den som startar är självklart med
      await store.insertLog({
        gameDay: gameDay(), profileId, kind: 'new_game',
        routeId: null, altRouteId: null, otherPlayers: [], details: { gameNo, mapId: m.id, mapName: m.def.name }
      });
      res.json({ ok: true, gameNo, mapId: m.id });
    } catch (e) { console.error(e); res.status(500).json({ error: 'databasfel' }); }
  });

  router.post('/resolve', async (req, res) => {
    if (resolveSecret && req.headers['x-resolve-secret'] !== resolveSecret) {
      return res.status(403).json({ error: 'saknar behorighet' });
    }
    const b = req.body || {};
    const day = (typeof b.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.day)) ? b.day : prevDay(gameDay());
    try {
      const result = await resolveDay(store, day);
      res.json({ ok: true, ...result });
    } catch (e) { console.error(e); res.status(500).json({ error: 'databasfel' }); }
  });

  // Pass 3: hela familjens händelser för en dag (default igår) — se
  // .claude/plans, "Stories"-digesten. Ersätter den gamla per-profil
  // /digest?since=-endpointen.
  router.get('/digest/day', async (req, res) => {
    const dayRaw = req.query.day;
    const day = (typeof dayRaw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dayRaw)) ? dayRaw : prevDay(gameDay());
    try {
      res.json({ day, entries: await store.logForDay(day) });
    } catch (e) { console.error(e); res.status(500).json({ error: 'databasfel' }); }
  });

  return router;
}

// Biljetter som lagts till i kartans tickets efter att ett spel startat finns
// inte i den sparade biljettleken. Lägg in de som saknas (inte i leken,
// inte hos någon spelare, inte i en öppen offer) på slumpade platser.
// Idempotent — körs vid varje uppstart, gör inget om inget saknas.
async function topUpTicketDeck(pool) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const r = await client.query('select remaining from ghosttrains_ticket_deck where id=1 for update');
    if (!r.rows[0]) { await client.query('commit'); return; } // skapas lat med alla biljetter
    const deck = r.rows[0].remaining;
    const gs = await client.query('select map_id from ghosttrains_game_state where id=1');
    const m = mapContext(gs.rows[0] && gs.rows[0].map_id);
    const held = await client.query('select ticket_id from ghosttrains_player_tickets');
    const offers = await client.query('select ticket_ids from ghosttrains_ticket_offers');
    const known = new Set([...deck, ...held.rows.map(x => x.ticket_id), ...offers.rows.flatMap(x => x.ticket_ids)]);
    const missing = m.tickets.map(t => t.id).filter(id => !known.has(id));
    if (missing.length) {
      const merged = shuffle(deck.concat(missing));
      await client.query('update ghosttrains_ticket_deck set remaining=$1 where id=1', [JSON.stringify(merged)]);
      console.log('Ghost Trains: lade till', missing.length, 'nya biljetter i biljettleken.');
    }
    await client.query('commit');
  } catch (e) { await client.query('rollback'); throw e; }
  finally { client.release(); }
}

/* ---------- Uppstart ---------- */
export async function createGhostTrains(pool, { resolveSecret } = {}) {
  let usablePool = pool;
  if (usablePool) {
    try { await initSchema(usablePool); }
    catch (e) {
      console.error('Ghost Trains: kunde inte initiera schema (kors i minneslage for detta spel):', e.message);
      usablePool = null;
    }
  }
  if (usablePool) {
    try { await topUpTicketDeck(usablePool); }
    catch (e) { console.error('Ghost Trains: kunde inte fylla på biljettleken:', e.message); }
  }
  const store = usablePool ? pgStore(usablePool) : memStore();
  const router = createGhostTrainsRouter(store, resolveSecret);

  cron.schedule('0 0 * * *', async () => {
    const day = prevDay(gameDay());
    try {
      const r = await resolveDay(store, day);
      if (!r.alreadyResolved) console.log('Ghost Trains: upplöste dag', day, '-', r.results.length, 'drag.');
    } catch (e) { console.error('Ghost Trains: fel vid nattlig upplosning:', e); }
  }, { timezone: 'Europe/Stockholm' });

  return { router };
}
