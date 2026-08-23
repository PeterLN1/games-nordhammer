/* ============================================================
   Ghost Trains — asynkront familjespel (Nordhammer Spel)
   Se .claude/plans/dapper-enchanting-snowflake.md för bakgrund.

   Kartan (städer/rutter) hålls bara här på servern — klienten hämtar
   den via GET /api/ghosttrains/map istället för att duplicera datan,
   eftersom Railways "Root Directory" för server-tjänsten är satt till
   server/ och alltså inte ser filer utanför den mappen.
   ============================================================ */
import express from 'express';
import cron from 'node-cron';

export const COLORS = ['red', 'blue', 'green', 'yellow', 'orange', 'purple', 'black', 'white'];
export const WILD = 'wild';

// Destinationsbiljetter (Pass 2). Poängen är kontrollerade mot faktiska
// kartavstånd (viktad kortaste väg) — "Öestersund" i ursprungsdatan var
// en felstavning av Östersund, och kiruna-ostersund var felprissatt som
// kortast på kartan (5p) trots att den är lika lång som umea-stockholm
// (9p) — rättad till 9 (se .claude/plans).
export const TICKETS = [
  { id: 't1', cityA: 'kiruna', cityB: 'malmo', points: 15 },
  { id: 't2', cityA: 'lulea', cityB: 'goteborg', points: 14 },
  { id: 't3', cityA: 'ostersund', cityB: 'karlskrona', points: 12 },
  { id: 't4', cityA: 'umea', cityB: 'stockholm', points: 9 },
  { id: 't5', cityA: 'mora', cityB: 'goteborg', points: 9 },
  { id: 't6', cityA: 'karlstad', cityB: 'malmo', points: 8 },
  { id: 't7', cityA: 'stockholm', cityB: 'kristianstad', points: 7 },
  { id: 't8', cityA: 'orebro', cityB: 'lund', points: 7 },
  { id: 't9', cityA: 'kiruna', cityB: 'ostersund', points: 9 },
  { id: 't10', cityA: 'goteborg', cityB: 'karlskrona', points: 5 },
  { id: 't11', cityA: 'sundsvall', cityB: 'karlstad', points: 5 },
  { id: 't12', cityA: 'jonkoping', cityB: 'malmo', points: 5 },
  { id: 't13', cityA: 'vaxjo', cityB: 'lund', points: 4 },
  { id: 't14', cityA: 'uppsala', cityB: 'orebro', points: 4 },
  { id: 't15', cityA: 'gavle', cityB: 'stockholm', points: 3 }
];
const TICKETS_BY_ID = new Map(TICKETS.map(t => [t.id, t]));
function ticketTier(points) { return points >= 12 ? 'long' : points >= 7 ? 'medium' : 'short'; }

// Officiell Ticket to Ride-poängtabell för ruttlängd.
const ROUTE_POINTS = { 1: 1, 2: 2, 3: 4, 4: 7, 5: 10, 6: 15 };
const STARTING_TRAIN_CARS = 35;
const FINAL_ROUND_THRESHOLD = 2;

export const CITIES = [
  // Koordinater beräknade från städernas verkliga lat/long (enkel
  // ekvirektangulär projektion mot Sveriges yttre gränser), sedan
  // passade mot Sverigekonturens bounding box (ghosttrains/index.html) —
  // annars hamnar städer som Stockholm/Göteborg utanför konturen (se
  // .claude/plans, felrapport "kartan är inte i synk med städerna").
  { id: 'kiruna', name: 'Kiruna', x: 702, y: 72 },
  { id: 'lulea', name: 'Luleå', x: 785, y: 282 },
  { id: 'umea', name: 'Umeå', x: 704, y: 444 },
  { id: 'ostersund', name: 'Östersund', x: 463, y: 504 },
  { id: 'sundsvall', name: 'Sundsvall', x: 578, y: 577 },
  { id: 'gavle', name: 'Gävle', x: 570, y: 737 },
  // "Inlandsbanan": Gävle var en hård flaskhals — plockar man bort
  // Gävle delas kartan i två helt oberoende delar (norra klustret
  // Kiruna/Luleå/Umeå/Östersund/Sundsvall vs. resten). Karlstad hade
  // dessutom ingen väg norrut alls utom via Gävle. Borlänge/Mora öppnar
  // en andra, oberoende väg norrut genom Dalarna (se ROUTES nedan).
  { id: 'borlange', name: 'Borlänge', x: 497, y: 754 },
  { id: 'mora', name: 'Mora', x: 459, y: 706 },
  { id: 'karlstad', name: 'Karlstad', x: 414, y: 856 },
  { id: 'uppsala', name: 'Uppsala', x: 592, y: 812 },
  { id: 'stockholm', name: 'Stockholm', x: 610, y: 861 },
  { id: 'orebro', name: 'Örebro', x: 487, y: 866 },
  { id: 'norrkoping', name: 'Norrköping', x: 529, y: 929 },
  { id: 'jonkoping', name: 'Jönköping', x: 442, y: 1004 },
  { id: 'goteborg', name: 'Göteborg', x: 348, y: 1011 },
  { id: 'vaxjo', name: 'Växjö', x: 470, y: 1087 },
  { id: 'karlskrona', name: 'Karlskrona', x: 504, y: 1154 },
  { id: 'kristianstad', name: 'Kristianstad', x: 442, y: 1166 },
  // Lund och Malmö låg bara 12 enheter isär (verkligt avstånd ~18 km,
  // kortast av alla stadspar på kartan) — stadsprickarna (radie 10 var)
  // överlappade då helt och dolde hela rutten mellan dem. Flyttade isär
  // symmetriskt längs samma geografiska riktning (~30 enheter) tills
  // linjen syns, utan att ändra deras position i förhållande till varandra.
  { id: 'lund', name: 'Lund', x: 407, y: 1190 },
  { id: 'malmo', name: 'Malmö', x: 387, y: 1213 }
];

export const ROUTES = [
  { id: 'kiruna-lulea', cityA: 'kiruna', cityB: 'lulea', length: 4, color: 'blue', doubleTrack: false },
  // Kiruna hade annars bara denna enda anslutning — ett problem så fort
  // destinationsbiljetter (fas 2) kräver att man kan ta sig dit: om
  // kiruna-lulea claimas av en annan spelare finns ingen alternativ väg
  // in. En andra, oberoende rutt löser det (se .claude/plans).
  { id: 'kiruna-umea', cityA: 'kiruna', cityB: 'umea', length: 6, color: 'purple', doubleTrack: false },
  { id: 'lulea-umea', cityA: 'lulea', cityB: 'umea', length: 3, color: 'red', doubleTrack: false },
  // Umeå var en enda felpunkt för Kiruna+Luleå: plockar man bort Umeå
  // blev de två helt avskurna från resten av kartan (samma mönster som
  // Gävle hade för hela Norrland). Kustexpress-genväg löser det —
  // orange var lägsta färgen (9), håller balansen jämn (9->13).
  { id: 'lulea-sundsvall', cityA: 'lulea', cityB: 'sundsvall', length: 4, color: 'orange', doubleTrack: false },
  { id: 'umea-ostersund', cityA: 'umea', cityB: 'ostersund', length: 3, color: 'green', doubleTrack: false },
  { id: 'umea-sundsvall', cityA: 'umea', cityB: 'sundsvall', length: 3, color: 'yellow', doubleTrack: false },
  // Svart istället för orange: orange möttes redan med den nya
  // lulea-sundsvall i Sundsvall (samma stad, samma färg = förvirrande).
  { id: 'ostersund-sundsvall', cityA: 'ostersund', cityB: 'sundsvall', length: 2, color: 'black', doubleTrack: false },
  // "Norrlandsporten": Östersund som knutpunkt mellan Norrlands inland
  // och kusten söderut — andra benet (ostersund-sundsvall fanns redan).
  { id: 'ostersund-gavle', cityA: 'ostersund', cityB: 'gavle', length: 3, color: 'blue', doubleTrack: false },
  { id: 'sundsvall-gavle', cityA: 'sundsvall', cityB: 'gavle', length: 3, color: 'purple', doubleTrack: false },
  { id: 'gavle-uppsala', cityA: 'gavle', cityB: 'uppsala', length: 2, color: 'black', doubleTrack: false },
  // Färgbalans: vit (14 rutor) var kraftigt överrepresenterad, röd (6)
  // kraftigt underrepresenterad över hela kartan — bytte denna till röd.
  { id: 'gavle-karlstad', cityA: 'gavle', cityB: 'karlstad', length: 4, color: 'red', doubleTrack: false },
  // "Inlandsbanan" — separerar flödet väster-/inlandsifrån (Karlstad,
  // Örebro, Uppsala) från östkustens Gävle-flaskhals, precis som
  // riktiga Ticket to Ride-kartor separerar regionala flöden. mora-
  // ostersund gjordes vit (inte lila, som annars hade blivit
  // kraftigt överrepresenterad igen) för att hålla färgbalansen jämn.
  { id: 'karlstad-borlange', cityA: 'karlstad', cityB: 'borlange', length: 2, color: 'orange', doubleTrack: false },
  // Blå istället för gul: gul mötte redan orebro-stockholm i Örebro.
  { id: 'orebro-borlange', cityA: 'orebro', cityB: 'borlange', length: 2, color: 'blue', doubleTrack: false },
  // Grön istället för svart: svart mötte redan gavle-uppsala i Uppsala.
  { id: 'uppsala-borlange', cityA: 'uppsala', cityB: 'borlange', length: 2, color: 'green', doubleTrack: false },
  { id: 'borlange-mora', cityA: 'borlange', cityB: 'mora', length: 2, color: 'red', doubleTrack: false },
  { id: 'mora-ostersund', cityA: 'mora', cityB: 'ostersund', length: 4, color: 'white', doubleTrack: false },
  { id: 'uppsala-stockholm', cityA: 'uppsala', cityB: 'stockholm', length: 1, color: 'red', doubleTrack: true },
  { id: 'karlstad-orebro', cityA: 'karlstad', cityB: 'orebro', length: 2, color: 'green', doubleTrack: false },
  { id: 'karlstad-goteborg', cityA: 'karlstad', cityB: 'goteborg', length: 3, color: 'blue', doubleTrack: false },
  // Örebro har grad 5, samma som Stockholm, men hade 0 dubbelspår mot
  // Stockholms 4 av 5 — ojämnt jämfört med sin lika stora hubb-granne.
  // Speglar Uppsala-Stockholm som redan är dubbelspår.
  { id: 'orebro-stockholm', cityA: 'orebro', cityB: 'stockholm', length: 2, color: 'yellow', doubleTrack: true },
  { id: 'orebro-jonkoping', cityA: 'orebro', cityB: 'jonkoping', length: 3, color: 'orange', doubleTrack: false },
  { id: 'orebro-norrkoping', cityA: 'orebro', cityB: 'norrkoping', length: 2, color: 'white', doubleTrack: false },
  { id: 'stockholm-norrkoping', cityA: 'stockholm', cityB: 'norrkoping', length: 2, color: 'purple', doubleTrack: true },
  { id: 'norrkoping-jonkoping', cityA: 'norrkoping', cityB: 'jonkoping', length: 2, color: 'black', doubleTrack: false },
  // Färgbalans (vit ner ytterligare) + Jönköping är nu en 4-vägshubb
  // (Örebro/Norrköping/Göteborg/Växjö) helt utan dubbelspår — samma
  // avlastning som Stockholm redan fått på två av sina fem anslutningar.
  // Gul (inte orange) för att undvika samma färg som orebro-jonkoping,
  // som redan är orange och möts i samma stad.
  { id: 'jonkoping-goteborg', cityA: 'jonkoping', cityB: 'goteborg', length: 2, color: 'yellow', doubleTrack: true },
  { id: 'jonkoping-vaxjo', cityA: 'jonkoping', cityB: 'vaxjo', length: 2, color: 'red', doubleTrack: false },
  { id: 'vaxjo-karlskrona', cityA: 'vaxjo', cityB: 'karlskrona', length: 2, color: 'green', doubleTrack: false },
  { id: 'vaxjo-kristianstad', cityA: 'vaxjo', cityB: 'kristianstad', length: 2, color: 'yellow', doubleTrack: false },
  { id: 'kristianstad-karlskrona', cityA: 'kristianstad', cityB: 'karlskrona', length: 1, color: 'blue', doubleTrack: false },
  { id: 'kristianstad-lund', cityA: 'kristianstad', cityB: 'lund', length: 2, color: 'orange', doubleTrack: false },
  { id: 'lund-malmo', cityA: 'lund', cityB: 'malmo', length: 1, color: 'purple', doubleTrack: false },
  { id: 'stockholm-goteborg', cityA: 'stockholm', cityB: 'goteborg', length: 5, color: 'black', doubleTrack: true },
  { id: 'stockholm-malmo', cityA: 'stockholm', cityB: 'malmo', length: 6, color: 'white', doubleTrack: true },
  // "Västkustlinjen": direktförbindelse längs västkusten mellan de två
  // städerna, utöver den längre vägen via Jönköping/Karlstad/Örebro.
  { id: 'goteborg-malmo', cityA: 'goteborg', cityB: 'malmo', length: 3, color: 'green', doubleTrack: false }
];

const ROUTES_BY_ID = new Map(ROUTES.map(r => [r.id, r]));

function buildAdjacency() {
  const adj = new Map();
  CITIES.forEach(c => adj.set(c.id, []));
  ROUTES.forEach(r => {
    adj.get(r.cityA).push({ routeId: r.id, other: r.cityB, length: r.length });
    adj.get(r.cityB).push({ routeId: r.id, other: r.cityA, length: r.length });
  });
  return adj;
}
const ADJACENCY = buildAdjacency();

function trackSlots(route) { return route.doubleTrack ? ['A', 'B'] : ['single']; }

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
async function drawOneFromDeck(store) {
  let deck = await store.getDeck();
  if (deck.length === 0) deck = freshDeck();
  const card = deck.pop();
  await store.saveDeck(deck);
  return card;
}
function freshMarket(drawFn) { return [drawFn(), drawFn(), drawFn(), drawFn(), drawFn()]; }
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
function findNearestFreeRoute(startCity, excludeRouteId, builtSet, maxAffordableLength) {
  const affordable = r => r.length <= maxAffordableLength;
  const visitedCities = new Set([startCity]);
  let frontier = [startCity];
  const seenRoutes = new Set();
  while (frontier.length) {
    const candidates = [];
    const nextFrontier = [];
    for (const city of frontier) {
      for (const edge of ADJACENCY.get(city)) {
        if (!seenRoutes.has(edge.routeId)) {
          seenRoutes.add(edge.routeId);
          if (edge.routeId !== excludeRouteId) {
            const route = ROUTES_BY_ID.get(edge.routeId);
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
  const allFree = ROUTES.filter(r => r.id !== excludeRouteId && affordable(r) && trackSlots(r).some(t => !builtSet.has(r.id + '|' + t)));
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

  const claims = await store.unresolvedForDay(day);
  const built = await store.builtRoutes();
  const builtSet = new Set(built.map(b => b.route_id + '|' + b.track));

  const byRoute = new Map();
  claims.forEach(c => {
    if (!byRoute.has(c.route_id)) byRoute.set(c.route_id, []);
    byRoute.get(c.route_id).push(c);
  });

  const results = [];
  const collided = [];
  const resolvedIds = [];

  for (const [routeId, group] of byRoute) {
    const route = ROUTES_BY_ID.get(routeId);
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

  collided.sort((a, b) => new Date(a.submittedAt) - new Date(b.submittedAt));
  for (const c of collided) {
    // Omdirigering får bara ge en rutt spelaren faktiskt har råd med
    // (kvarvarande tågvagnar) — annars Total Crash (se .claude/plans,
    // Pass 2: "reroute constraints").
    const player = await store.getPlayer(c.profileId);
    const alt = findNearestFreeRoute(c.fromCity, c.routeId, builtSet, player.trainCars);
    if (alt) {
      const track = trackSlots(alt).filter(t => !builtSet.has(alt.id + '|' + t))[0];
      builtSet.add(alt.id + '|' + track);
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
  await checkFinalRoundAndGameOver(store, day, results);
  return { day, results };
}

// Enkel BFS över bara EN spelares egna byggda rutter — avgör om en
// destinationsbiljett är uppfylld vid spelslut.
function isConnectedForProfile(ownedRouteIds, cityA, cityB) {
  if (cityA === cityB) return true;
  const adj = new Map();
  ROUTES.forEach(r => {
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

// Efter varje upplösning: kolla om någon spelares tågvagnar gått i
// botten (utlöser en sista spelrunda), och — om den sista rundans dag
// just upplöstes — räkna ut slutpoäng (ruttpoäng + biljetter) och
// avsluta spelet. Se .claude/plans, Pass 2.
async function checkFinalRoundAndGameOver(store, day, results) {
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
        gameState = { status: 'final_round', finalDay };
        break;
      }
    }
  }

  if (gameState.status === 'final_round' && gameState.finalDay && day >= gameState.finalDay) {
    const built = await store.builtRoutes();
    const ownedByProfile = new Map();
    built.forEach(b => {
      if (!ownedByProfile.has(b.owner_profile_id)) ownedByProfile.set(b.owner_profile_id, new Set());
      ownedByProfile.get(b.owner_profile_id).add(b.route_id);
    });

    const allTickets = await store.allPlayerTickets();
    const ticketsByProfile = new Map();
    allTickets.forEach(t => {
      if (!ticketsByProfile.has(t.profileId)) ticketsByProfile.set(t.profileId, []);
      ticketsByProfile.get(t.profileId).push(t.ticketId);
    });

    const allPlayers = await store.allPlayers();
    for (const p of allPlayers) {
      const ownedRouteIds = ownedByProfile.get(p.profileId) || new Set();
      const ticketIds = ticketsByProfile.get(p.profileId) || [];
      const breakdown = [];
      let ticketDelta = 0;
      ticketIds.forEach(ticketId => {
        const ticket = TICKETS_BY_ID.get(ticketId);
        if (!ticket) return;
        const ok = isConnectedForProfile(ownedRouteIds, ticket.cityA, ticket.cityB);
        ticketDelta += ok ? ticket.points : -ticket.points;
        breakdown.push({ ticketId, cityA: ticket.cityA, cityB: ticket.cityB, points: ticket.points, success: ok });
      });
      const total = p.score + ticketDelta;
      await store.insertLog({
        gameDay: day, profileId: p.profileId, kind: 'game_over',
        routeId: null, altRouteId: null, otherPlayers: [],
        details: { routeScore: p.score, ticketDelta, total, breakdown }
      });
    }
    await store.setGameState('finished', gameState.finalDay);
  }
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
    remaining int not null default 3
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

function pgStore(pool) {
  return {
    async getHand(profileId) {
      const r = await pool.query('select hand from ghosttrains_hands where profile_id=$1', [profileId]);
      return r.rows[0] ? r.rows[0].hand : [];
    },
    async saveHand(profileId, hand) {
      await pool.query(
        `insert into ghosttrains_hands (profile_id, hand, updated_at) values ($1,$2,now())
         on conflict (profile_id) do update set hand=$2, updated_at=now()`,
        [profileId, JSON.stringify(hand)]
      );
    },
    async getDeck() {
      const r = await pool.query('select remaining from ghosttrains_deck where id=1');
      if (!r.rows[0]) {
        const deck = freshDeck();
        await pool.query('insert into ghosttrains_deck (id, remaining) values (1,$1) on conflict (id) do nothing', [JSON.stringify(deck)]);
        return deck;
      }
      return r.rows[0].remaining;
    },
    async saveDeck(deck) {
      await pool.query(
        `insert into ghosttrains_deck (id, remaining) values (1,$1)
         on conflict (id) do update set remaining=$1`, [JSON.stringify(deck)]);
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
      const r = await pool.query('select train_cars, score, initial_tickets_dealt from ghosttrains_players where profile_id=$1', [profileId]);
      if (r.rows[0]) return { trainCars: r.rows[0].train_cars, score: r.rows[0].score, initialTicketsDealt: r.rows[0].initial_tickets_dealt };
      await pool.query('insert into ghosttrains_players (profile_id) values ($1) on conflict (profile_id) do nothing', [profileId]);
      return { trainCars: STARTING_TRAIN_CARS, score: 0, initialTicketsDealt: false };
    },
    async allPlayers() {
      const r = await pool.query('select profile_id, train_cars, score from ghosttrains_players');
      return r.rows.map(row => ({ profileId: row.profile_id, trainCars: row.train_cars, score: row.score }));
    },
    async deductTrainCars(profileId, amount) {
      await pool.query(
        `insert into ghosttrains_players (profile_id, train_cars) values ($1, ${STARTING_TRAIN_CARS} - $2)
         on conflict (profile_id) do update set train_cars = ghosttrains_players.train_cars - $2`,
        [profileId, amount]
      );
    },
    async addScore(profileId, amount) {
      await pool.query(
        `insert into ghosttrains_players (profile_id, score) values ($1, $2)
         on conflict (profile_id) do update set score = ghosttrains_players.score + $2`,
        [profileId, amount]
      );
    },
    async setInitialTicketsDealt(profileId) {
      await pool.query(
        `insert into ghosttrains_players (profile_id, initial_tickets_dealt) values ($1, true)
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
      const r = await pool.query('select status, final_day from ghosttrains_game_state where id=1');
      if (!r.rows[0]) return { status: 'active', finalDay: null };
      return { status: r.rows[0].status, finalDay: r.rows[0].final_day };
    },
    async setGameState(status, finalDay) {
      await pool.query(
        `insert into ghosttrains_game_state (id, status, final_day) values (1,$1,$2)
         on conflict (id) do update set status=$1, final_day=$2`,
        [status, finalDay || null]
      );
    },
    // Delad, cirkulerande biljettlek — samma FOR UPDATE-transaktionsmönster
    // som kortmarknaden i Pass 1 (delad, muterbar state, samma racerisk).
    async dealTickets(count) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const r = await client.query('select remaining from ghosttrains_ticket_deck where id=1 for update');
        let deck = r.rows[0] ? r.rows[0].remaining : shuffle(TICKETS.map(t => t.id));
        const dealt = [];
        for (let i = 0; i < count && deck.length > 0; i++) dealt.push(deck.pop());
        await client.query('insert into ghosttrains_ticket_deck (id, remaining) values (1,$1) on conflict (id) do update set remaining=$1', [JSON.stringify(deck)]);
        await client.query('commit');
        return dealt;
      } catch (e) { await client.query('rollback'); throw e; }
      finally { client.release(); }
    },
    // Dealar EXAKT en biljett per given tier (initial gratis-deal).
    async dealTicketsByTier(tiers) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const r = await client.query('select remaining from ghosttrains_ticket_deck where id=1 for update');
        let deck = r.rows[0] ? r.rows[0].remaining : shuffle(TICKETS.map(t => t.id));
        const dealt = [];
        for (const tier of tiers) {
          let idx = -1;
          for (let i = deck.length - 1; i >= 0; i--) {
            if (ticketTier(TICKETS_BY_ID.get(deck[i]).points) === tier) { idx = i; break; }
          }
          if (idx >= 0) dealt.push(deck.splice(idx, 1)[0]);
        }
        await client.query('insert into ghosttrains_ticket_deck (id, remaining) values (1,$1) on conflict (id) do update set remaining=$1', [JSON.stringify(deck)]);
        await client.query('commit');
        return dealt;
      } catch (e) { await client.query('rollback'); throw e; }
      finally { client.release(); }
    },
    async returnTicketsToDeck(ticketIds) {
      if (!ticketIds.length) return;
      const client = await pool.connect();
      try {
        await client.query('begin');
        const r = await client.query('select remaining from ghosttrains_ticket_deck where id=1 for update');
        let deck = r.rows[0] ? r.rows[0].remaining : shuffle(TICKETS.map(t => t.id));
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
         select $1, $2, 3 - $3 where 3 - $3 >= 0
         on conflict (profile_id) do update set
           remaining = case when ghosttrains_ap.game_day = $2 then ghosttrains_ap.remaining - $3 else 3 - $3 end,
           game_day = $2
         where (ghosttrains_ap.game_day <> $2 and 3 - $3 >= 0)
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
          const dres = await client.query('select remaining from ghosttrains_deck where id=1 for update');
          let deck = dres.rows[0] ? dres.rows[0].remaining : freshDeck();
          const draw = () => { if (deck.length === 0) deck = freshDeck(); return deck.pop(); };
          cards = freshMarket(draw);
          await client.query('insert into ghosttrains_deck (id, remaining) values (1,$1) on conflict (id) do update set remaining=$1', [JSON.stringify(deck)]);
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
    async drawMarketCard(profileId, day, index) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const mres = await client.query('select cards from ghosttrains_market where id=1 for update');
        const dres = await client.query('select remaining from ghosttrains_deck where id=1 for update');
        let cards = mres.rows[0] ? mres.rows[0].cards : null;
        let deck = dres.rows[0] ? dres.rows[0].remaining : freshDeck();
        const draw = () => { if (deck.length === 0) deck = freshDeck(); return deck.pop(); };
        if (!cards) cards = freshMarket(draw);
        if (!(index >= 0 && index < cards.length)) { await client.query('rollback'); return { error: 'ogiltigt kortval' }; }

        const drawnCard = cards[index];
        const cost = drawnCard === WILD ? 2 : 1;
        const apRes = await client.query(
          `insert into ghosttrains_ap (profile_id, game_day, remaining)
           select $1, $2, 3 - $3 where 3 - $3 >= 0
           on conflict (profile_id) do update set
             remaining = case when ghosttrains_ap.game_day = $2 then ghosttrains_ap.remaining - $3 else 3 - $3 end,
             game_day = $2
           where (ghosttrains_ap.game_day <> $2 and 3 - $3 >= 0)
              or (ghosttrains_ap.game_day = $2 and ghosttrains_ap.remaining - $3 >= 0)
           returning remaining`,
          [profileId, day, cost]
        );
        if (!apRes.rows[0]) { await client.query('rollback'); return { error: 'ap' }; }

        let newCards = cards.slice();
        newCards[index] = draw();
        if (newCards.filter(c => c === WILD).length >= 3) newCards = freshMarket(draw);

        await client.query('insert into ghosttrains_deck (id, remaining) values (1,$1) on conflict (id) do update set remaining=$1', [JSON.stringify(deck)]);
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
  let deck = null;
  const routes = [];
  const pending = [];
  const resolvedDays = new Set();
  const log = [];
  const apState = new Map();
  let market = null;
  const players = new Map();
  const playerTickets = new Map();
  const ticketOffers = new Map();
  let ticketDeck = null;
  let gameState = { status: 'active', finalDay: null };
  let nextPendingId = 1, nextLogId = 1;
  function drawOneMem() { if (!deck || deck.length === 0) deck = freshDeck(); return deck.pop(); }
  function getPlayerMem(profileId) {
    let p = players.get(profileId);
    if (!p) { p = { trainCars: STARTING_TRAIN_CARS, score: 0, initialTicketsDealt: false }; players.set(profileId, p); }
    return p;
  }
  function ensureTicketDeck() { if (!ticketDeck) ticketDeck = shuffle(TICKETS.map(t => t.id)); return ticketDeck; }
  return {
    async getHand(profileId) { return hands.get(profileId) || []; },
    async saveHand(profileId, hand) { hands.set(profileId, hand); },
    async getDeck() { if (!deck) deck = freshDeck(); return deck; },
    async saveDeck(d) { deck = d; },
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
    async getPlayer(profileId) { const p = getPlayerMem(profileId); return { trainCars: p.trainCars, score: p.score, initialTicketsDealt: p.initialTicketsDealt }; },
    async allPlayers() { return Array.from(players.entries()).map(([profileId, p]) => ({ profileId, trainCars: p.trainCars, score: p.score })); },
    async deductTrainCars(profileId, amount) { getPlayerMem(profileId).trainCars -= amount; },
    async addScore(profileId, amount) { getPlayerMem(profileId).score += amount; },
    async setInitialTicketsDealt(profileId) { getPlayerMem(profileId).initialTicketsDealt = true; },
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
    async setGameState(status, finalDay) { gameState = { status, finalDay: finalDay || null }; },
    async dealTickets(count) {
      const d = ensureTicketDeck();
      const dealt = [];
      for (let i = 0; i < count && d.length > 0; i++) dealt.push(d.pop());
      return dealt;
    },
    async dealTicketsByTier(tiers) {
      const d = ensureTicketDeck();
      const dealt = [];
      tiers.forEach(tier => {
        let idx = -1;
        for (let i = d.length - 1; i >= 0; i--) {
          if (ticketTier(TICKETS_BY_ID.get(d[i]).points) === tier) { idx = i; break; }
        }
        if (idx >= 0) dealt.push(d.splice(idx, 1)[0]);
      });
      return dealt;
    },
    async returnTicketsToDeck(ticketIds) {
      const d = ensureTicketDeck();
      ticketIds.forEach(id => d.unshift(id));
    },
    async spendAP(profileId, day, amount) {
      let s = apState.get(profileId);
      if (!s || s.day !== day) s = { day, remaining: 3 };
      if (s.remaining - amount < 0) return null;
      s.remaining -= amount;
      apState.set(profileId, s);
      return s.remaining;
    },
    async getMarketSnapshot() {
      if (!market) market = freshMarket(drawOneMem);
      return market.slice();
    },
    async drawMarketCard(profileId, day, index) {
      if (!market) market = freshMarket(drawOneMem);
      if (!(index >= 0 && index < market.length)) return { error: 'ogiltigt kortval' };
      const drawnCard = market[index];
      const cost = drawnCard === WILD ? 2 : 1;
      let s = apState.get(profileId);
      if (!s || s.day !== day) s = { day, remaining: 3 };
      if (s.remaining - cost < 0) return { error: 'ap' };
      s.remaining -= cost;
      apState.set(profileId, s);
      market = market.slice();
      market[index] = drawOneMem();
      if (market.filter(c => c === WILD).length >= 3) market = freshMarket(drawOneMem);
      return { drawnCard, market: market.slice(), apRemaining: s.remaining };
    }
  };
}

/* ---------- Router ---------- */
function validProfileId(id) { return typeof id === 'string' && /^[a-z0-9]{4,64}$/i.test(id); }

function createGhostTrainsRouter(store, resolveSecret) {
  const router = express.Router();

  router.get('/map', (req, res) => {
    res.json({ cities: CITIES, routes: ROUTES });
  });

  router.get('/state', async (req, res) => {
    const profileId = req.query.profileId;
    if (!validProfileId(profileId)) return res.status(400).json({ error: 'ogiltigt profileId' });
    try {
      const day = gameDay();
      const [hand, built, pendingMine, apRemaining, market, player, ticketIds, gameState] = await Promise.all([
        store.getHand(profileId), store.builtRoutes(), store.pendingForProfileToday(profileId, day),
        store.spendAP(profileId, day, 0), store.getMarketSnapshot(), store.getPlayer(profileId),
        store.getPlayerTickets(profileId), store.getGameState()
      ]);

      // Gratis startbiljetter (1 lång + 1 medium + 1 kort) delas ut lat,
      // första gången någon läser /state för profilen — se .claude/plans.
      let ticketOffer = await store.getTicketOffer(profileId);
      if (!ticketOffer && !player.initialTicketsDealt) {
        const dealt = await store.dealTicketsByTier(['long', 'medium', 'short']);
        if (dealt.length) {
          await store.setTicketOffer(profileId, dealt, 2);
          await store.setInitialTicketsDealt(profileId);
          ticketOffer = { ticketIds: dealt, minKeep: 2 };
        }
      }

      let finalScores = null;
      if (gameState.status === 'finished') {
        const all = await store.allPlayers();
        finalScores = all.map(p => ({ profileId: p.profileId, score: p.score }));
      }

      res.json({
        gameDay: day,
        hand,
        built: built.map(b => ({ routeId: b.route_id, track: b.track, ownerProfileId: b.owner_profile_id })),
        pendingToday: pendingMine.map(p => ({ id: p.id, routeId: p.route_id, fromCity: p.from_city, cards: p.cards })),
        apRemaining,
        market,
        trainCars: player.trainCars,
        score: player.score,
        tickets: ticketIds.map(id => TICKETS_BY_ID.get(id)).filter(Boolean),
        ticketOffer: ticketOffer ? { tickets: ticketOffer.ticketIds.map(id => TICKETS_BY_ID.get(id)).filter(Boolean), minKeep: ticketOffer.minKeep } : null,
        gameStatus: gameState.status,
        finalScores
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
      if ((await store.getGameState()).status === 'finished') return res.status(409).json({ error: 'spelet ar slut' });
      const day = gameDay();
      const apRemaining = await store.spendAP(profileId, day, 1);
      if (apRemaining == null) return res.status(402).json({ error: 'inte tillrackligt med AP' });
      const card = await drawOneFromDeck(store);
      const hand = (await store.getHand(profileId)).concat([card]);
      await store.saveHand(profileId, hand);
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
      if ((await store.getGameState()).status === 'finished') return res.status(409).json({ error: 'spelet ar slut' });
      const day = gameDay();
      const result = await store.drawMarketCard(profileId, day, index);
      if (result.error === 'ap') return res.status(402).json({ error: 'inte tillrackligt med AP' });
      if (result.error) return res.status(400).json({ error: result.error });
      const hand = (await store.getHand(profileId)).concat([result.drawnCard]);
      await store.saveHand(profileId, hand);
      res.json({ ok: true, drawn: result.drawnCard, hand, apRemaining: result.apRemaining, market: result.market });
    } catch (e) { console.error(e); res.status(500).json({ error: 'databasfel' }); }
  });

  router.post('/claim', async (req, res) => {
    const b = req.body || {};
    const profileId = b.profileId;
    if (!validProfileId(profileId)) return res.status(400).json({ error: 'ogiltigt profileId' });
    const route = ROUTES_BY_ID.get(b.routeId);
    if (!route) return res.status(400).json({ error: 'okand rutt' });
    if (b.fromCity !== route.cityA && b.fromCity !== route.cityB) return res.status(400).json({ error: 'ogiltig startstad' });
    if (!validateClaimCards(route, b.cards)) return res.status(400).json({ error: 'ogiltiga kort for denna rutt' });
    try {
      if ((await store.getGameState()).status === 'finished') return res.status(409).json({ error: 'spelet ar slut' });
      const built = await store.builtRoutes();
      const builtSet = new Set(built.map(r => r.route_id + '|' + r.track));
      const freeSlots = trackSlots(route).filter(t => !builtSet.has(route.id + '|' + t));
      if (freeSlots.length === 0) return res.status(409).json({ error: 'rutten ar redan helt byggd' });
      const player = await store.getPlayer(profileId);
      if (player.trainCars < route.length) return res.status(400).json({ error: 'inte tillrackligt med tagvagnar kvar' });
      const hand = await store.getHand(profileId);
      const newHand = removeCards(hand, b.cards);
      if (!newHand) return res.status(400).json({ error: 'du har inte de korten' });
      const day = gameDay();
      // AP spenderas sist — misslyckas det har varken hand eller PENDING
      // muterats än (kortvalideringen ovan är ren läsning).
      const apRemaining = await store.spendAP(profileId, day, 2);
      if (apRemaining == null) return res.status(402).json({ error: 'inte tillrackligt med AP' });
      await store.saveHand(profileId, newHand);
      const id = await store.insertPending({ profileId, routeId: route.id, fromCity: b.fromCity, cards: b.cards, gameDay: day });
      res.json({ ok: true, id, hand: newHand, apRemaining });
    } catch (e) { console.error(e); res.status(500).json({ error: 'databasfel' }); }
  });

  router.post('/tickets/draw', async (req, res) => {
    const profileId = (req.body || {}).profileId;
    if (!validProfileId(profileId)) return res.status(400).json({ error: 'ogiltigt profileId' });
    try {
      if ((await store.getGameState()).status === 'finished') return res.status(409).json({ error: 'spelet ar slut' });
      const existing = await store.getTicketOffer(profileId);
      if (existing) return res.status(409).json({ error: 'du har redan olästa biljetter att välja bland' });
      const day = gameDay();
      const apRemaining = await store.spendAP(profileId, day, 1);
      if (apRemaining == null) return res.status(402).json({ error: 'inte tillrackligt med AP' });
      const dealt = await store.dealTickets(3);
      if (!dealt.length) return res.json({ ok: true, offer: null, apRemaining, note: 'inga fler biljetter kvar i leken' });
      await store.setTicketOffer(profileId, dealt, 1);
      res.json({ ok: true, offer: { tickets: dealt.map(id => TICKETS_BY_ID.get(id)).filter(Boolean), minKeep: 1 }, apRemaining });
    } catch (e) { console.error(e); res.status(500).json({ error: 'databasfel' }); }
  });

  router.post('/tickets/choose', async (req, res) => {
    const b = req.body || {};
    const profileId = b.profileId;
    if (!validProfileId(profileId)) return res.status(400).json({ error: 'ogiltigt profileId' });
    const keepIds = Array.isArray(b.keepIds) ? b.keepIds : [];
    try {
      const offer = await store.getTicketOffer(profileId);
      if (!offer) return res.status(400).json({ error: 'ingen biljett-offer att svara pa' });
      const offeredSet = new Set(offer.ticketIds);
      const validKeep = keepIds.filter(id => offeredSet.has(id));
      if (validKeep.length !== keepIds.length || keepIds.length < offer.minKeep) {
        return res.status(400).json({ error: 'maste behalla minst ' + offer.minKeep + ' av de erbjudna biljetterna' });
      }
      const discard = offer.ticketIds.filter(id => !keepIds.includes(id));
      await store.addPlayerTickets(profileId, keepIds);
      await store.returnTicketsToDeck(discard);
      await store.clearTicketOffer(profileId);
      const ticketIds = await store.getPlayerTickets(profileId);
      res.json({ ok: true, tickets: ticketIds.map(id => TICKETS_BY_ID.get(id)).filter(Boolean) });
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
