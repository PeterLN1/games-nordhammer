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

export const CITIES = [
  { id: 'kiruna', name: 'Kiruna', x: 900, y: 30 },
  { id: 'lulea', name: 'Luleå', x: 820, y: 150 },
  { id: 'umea', name: 'Umeå', x: 760, y: 270 },
  { id: 'ostersund', name: 'Östersund', x: 580, y: 380 },
  { id: 'sundsvall', name: 'Sundsvall', x: 700, y: 420 },
  { id: 'gavle', name: 'Gävle', x: 630, y: 560 },
  { id: 'karlstad', name: 'Karlstad', x: 420, y: 630 },
  { id: 'uppsala', name: 'Uppsala', x: 650, y: 650 },
  { id: 'stockholm', name: 'Stockholm', x: 690, y: 700 },
  { id: 'orebro', name: 'Örebro', x: 500, y: 690 },
  { id: 'norrkoping', name: 'Norrköping', x: 610, y: 780 },
  { id: 'jonkoping', name: 'Jönköping', x: 490, y: 880 },
  { id: 'goteborg', name: 'Göteborg', x: 330, y: 860 },
  { id: 'vaxjo', name: 'Växjö', x: 510, y: 970 },
  { id: 'karlskrona', name: 'Karlskrona', x: 620, y: 1040 },
  { id: 'kristianstad', name: 'Kristianstad', x: 500, y: 1080 },
  { id: 'lund', name: 'Lund', x: 440, y: 1150 },
  { id: 'malmo', name: 'Malmö', x: 420, y: 1190 }
];

export const ROUTES = [
  { id: 'kiruna-lulea', cityA: 'kiruna', cityB: 'lulea', length: 4, color: 'blue', doubleTrack: false },
  // Kiruna hade annars bara denna enda anslutning — ett problem så fort
  // destinationsbiljetter (fas 2) kräver att man kan ta sig dit: om
  // kiruna-lulea claimas av en annan spelare finns ingen alternativ väg
  // in. En andra, oberoende rutt löser det (se .claude/plans).
  { id: 'kiruna-umea', cityA: 'kiruna', cityB: 'umea', length: 6, color: 'purple', doubleTrack: false },
  { id: 'lulea-umea', cityA: 'lulea', cityB: 'umea', length: 3, color: 'red', doubleTrack: false },
  { id: 'umea-ostersund', cityA: 'umea', cityB: 'ostersund', length: 3, color: 'green', doubleTrack: false },
  { id: 'umea-sundsvall', cityA: 'umea', cityB: 'sundsvall', length: 3, color: 'yellow', doubleTrack: false },
  { id: 'ostersund-sundsvall', cityA: 'ostersund', cityB: 'sundsvall', length: 2, color: 'orange', doubleTrack: false },
  { id: 'sundsvall-gavle', cityA: 'sundsvall', cityB: 'gavle', length: 3, color: 'purple', doubleTrack: false },
  { id: 'gavle-uppsala', cityA: 'gavle', cityB: 'uppsala', length: 2, color: 'black', doubleTrack: false },
  { id: 'gavle-karlstad', cityA: 'gavle', cityB: 'karlstad', length: 4, color: 'white', doubleTrack: false },
  { id: 'uppsala-stockholm', cityA: 'uppsala', cityB: 'stockholm', length: 1, color: 'red', doubleTrack: true },
  { id: 'karlstad-orebro', cityA: 'karlstad', cityB: 'orebro', length: 2, color: 'green', doubleTrack: false },
  { id: 'karlstad-goteborg', cityA: 'karlstad', cityB: 'goteborg', length: 3, color: 'blue', doubleTrack: false },
  { id: 'orebro-stockholm', cityA: 'orebro', cityB: 'stockholm', length: 2, color: 'yellow', doubleTrack: false },
  { id: 'orebro-jonkoping', cityA: 'orebro', cityB: 'jonkoping', length: 3, color: 'orange', doubleTrack: false },
  { id: 'orebro-norrkoping', cityA: 'orebro', cityB: 'norrkoping', length: 2, color: 'white', doubleTrack: false },
  { id: 'stockholm-norrkoping', cityA: 'stockholm', cityB: 'norrkoping', length: 2, color: 'purple', doubleTrack: true },
  { id: 'norrkoping-jonkoping', cityA: 'norrkoping', cityB: 'jonkoping', length: 2, color: 'black', doubleTrack: false },
  { id: 'jonkoping-goteborg', cityA: 'jonkoping', cityB: 'goteborg', length: 2, color: 'white', doubleTrack: false },
  { id: 'jonkoping-vaxjo', cityA: 'jonkoping', cityB: 'vaxjo', length: 2, color: 'red', doubleTrack: false },
  { id: 'vaxjo-karlskrona', cityA: 'vaxjo', cityB: 'karlskrona', length: 2, color: 'green', doubleTrack: false },
  { id: 'vaxjo-kristianstad', cityA: 'vaxjo', cityB: 'kristianstad', length: 2, color: 'yellow', doubleTrack: false },
  { id: 'kristianstad-karlskrona', cityA: 'kristianstad', cityB: 'karlskrona', length: 1, color: 'blue', doubleTrack: false },
  { id: 'kristianstad-lund', cityA: 'kristianstad', cityB: 'lund', length: 2, color: 'orange', doubleTrack: false },
  { id: 'lund-malmo', cityA: 'lund', cityB: 'malmo', length: 1, color: 'purple', doubleTrack: false },
  { id: 'stockholm-goteborg', cityA: 'stockholm', cityB: 'goteborg', length: 5, color: 'black', doubleTrack: true },
  { id: 'stockholm-malmo', cityA: 'stockholm', cityB: 'malmo', length: 6, color: 'white', doubleTrack: true }
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
  COLORS.forEach(c => { for (let i = 0; i < 12; i++) deck.push(c); });
  for (let i = 0; i < 12; i++) deck.push(WILD);
  return shuffle(deck);
}
async function drawTwo(store) {
  let deck = await store.getDeck();
  const drawn = [];
  for (let i = 0; i < 2; i++) {
    if (deck.length === 0) deck = freshDeck();
    drawn.push(deck.pop());
  }
  await store.saveDeck(deck);
  return drawn;
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

/* ---------- Omdirigeringsmotor ----------
   Söker utåt i cirklar (BFS) från krockstaden efter en ledig rutt,
   och faller — om det lokala området redan är fullt — tillbaka på
   närmaste lediga rutt var som helst på kartan. En spelare lämnas
   alltså bara helt utan spår (Total Crash) om HELA kartan är fullbyggd. */
function findNearestFreeRoute(startCity, excludeRouteId, builtSet) {
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
            if (freeSlots.length > 0) candidates.push(route);
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
  const allFree = ROUTES.filter(r => r.id !== excludeRouteId && trackSlots(r).some(t => !builtSet.has(r.id + '|' + t)));
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
        results.push({ profileId: claim.profile_id, kind, routeId, track, submittedAt: claim.submitted_at });
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
    const alt = findNearestFreeRoute(c.fromCity, c.routeId, builtSet);
    if (alt) {
      const track = trackSlots(alt).filter(t => !builtSet.has(alt.id + '|' + t))[0];
      builtSet.add(alt.id + '|' + track);
      results.push({ profileId: c.profileId, kind: 'rerouted', routeId: c.routeId, altRouteId: alt.id, track, otherPlayers: c.others });
    } else {
      results.push({ profileId: c.profileId, kind: 'total_crash', routeId: c.routeId, otherPlayers: c.others });
    }
  }

  for (const r of results) {
    if (r.track) await store.buildRoute(r.altRouteId || r.routeId, r.track, r.profileId, day);
    await store.insertLog({
      gameDay: day, profileId: r.profileId, kind: r.kind,
      routeId: r.routeId, altRouteId: r.altRouteId || null, otherPlayers: r.otherPlayers || []
    });
  }
  await store.markResolved(resolvedIds);
  await store.markDayResolved(day);
  return { day, results };
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
  // Samma öppna förtroendemodell som scores/profiles (se server/index.js):
  // RLS på utan policies stänger Supabases publika REST-API helt.
  for (const t of ['ghosttrains_hands', 'ghosttrains_deck', 'ghosttrains_routes', 'ghosttrains_pending_moves', 'ghosttrains_resolution_log', 'ghosttrains_resolved_days']) {
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
        `insert into ghosttrains_resolution_log (game_day, profile_id, kind, route_id, alt_route_id, other_players)
         values ($1,$2,$3,$4,$5,$6)`,
        [entry.gameDay, entry.profileId, entry.kind, entry.routeId || null, entry.altRouteId || null, JSON.stringify(entry.otherPlayers || [])]
      );
    },
    async digestSince(profileId, sinceId) {
      const r = await pool.query(
        'select id, game_day, kind, route_id, alt_route_id, other_players, created_at from ghosttrains_resolution_log where profile_id=$1 and id > $2 order by id asc',
        [profileId, sinceId || 0]
      );
      return r.rows;
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
  let nextPendingId = 1, nextLogId = 1;
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
      log.push({ id: nextLogId++, gameDay: entry.gameDay, profileId: entry.profileId, kind: entry.kind, routeId: entry.routeId || null, altRouteId: entry.altRouteId || null, otherPlayers: entry.otherPlayers || [], createdAt: new Date().toISOString() });
    },
    async digestSince(profileId, sinceId) {
      return log.filter(e => e.profileId === profileId && e.id > (sinceId || 0))
        .map(e => ({ id: e.id, game_day: e.gameDay, kind: e.kind, route_id: e.routeId, alt_route_id: e.altRouteId, other_players: e.otherPlayers, created_at: e.createdAt }));
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
      const [hand, built, pendingMine] = await Promise.all([
        store.getHand(profileId), store.builtRoutes(), store.pendingForProfileToday(profileId, day)
      ]);
      res.json({
        gameDay: day,
        hand,
        built: built.map(b => ({ routeId: b.route_id, track: b.track, ownerProfileId: b.owner_profile_id })),
        pendingToday: pendingMine.map(p => ({ id: p.id, routeId: p.route_id, fromCity: p.from_city, cards: p.cards }))
      });
    } catch (e) { console.error(e); res.status(500).json({ error: 'databasfel' }); }
  });

  router.post('/draw', async (req, res) => {
    const profileId = (req.body || {}).profileId;
    if (!validProfileId(profileId)) return res.status(400).json({ error: 'ogiltigt profileId' });
    try {
      const drawn = await drawTwo(store);
      const hand = (await store.getHand(profileId)).concat(drawn);
      await store.saveHand(profileId, hand);
      res.json({ ok: true, drawn, hand });
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
      const built = await store.builtRoutes();
      const builtSet = new Set(built.map(r => r.route_id + '|' + r.track));
      const freeSlots = trackSlots(route).filter(t => !builtSet.has(route.id + '|' + t));
      if (freeSlots.length === 0) return res.status(409).json({ error: 'rutten ar redan helt byggd' });
      const hand = await store.getHand(profileId);
      const newHand = removeCards(hand, b.cards);
      if (!newHand) return res.status(400).json({ error: 'du har inte de korten' });
      await store.saveHand(profileId, newHand);
      const day = gameDay();
      const id = await store.insertPending({ profileId, routeId: route.id, fromCity: b.fromCity, cards: b.cards, gameDay: day });
      res.json({ ok: true, id, hand: newHand });
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

  router.get('/digest', async (req, res) => {
    const profileId = req.query.profileId;
    if (!validProfileId(profileId)) return res.status(400).json({ error: 'ogiltigt profileId' });
    const since = parseInt(req.query.since, 10) || 0;
    try {
      res.json({ entries: await store.digestSince(profileId, since) });
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
