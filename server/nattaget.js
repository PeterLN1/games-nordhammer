/* ============================================================
   Nattåget — familjens adventskalender med gåtor (Nordhammer Spel)
   Se nattaget/SPEC.md (hela spelet) och nattaget/CLAUDE.md (regler
   för den som bygger motorn — framför allt: inga spoilers).

   Innehållet (berättelse, lappar, ledtrådar, svar) ligger antingen i
   klartext i nattaget/content.sample.json (testinnehåll) eller
   krypterat i nattaget/content.enc (det riktiga). Servern dekrypterar
   en gång vid start och håller det i minnet. Innehållet loggas ALDRIG
   — felmeddelanden säger bara att något gick fel, aldrig vad.

   All spoilerskydd sker här på servern: buildDayView() är det enda
   stället som bestämmer vad en spelare får se av en lucka (se SPEC.md,
   "Vad servern får skicka"). Klienten får aldrig mer än så.
   ============================================================ */
import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'nattaget');
export const SAMPLE_PATH = path.join(DIR, 'content.sample.json');
export const ENC_PATH = path.join(DIR, 'content.enc');

export const SLOTS = ['peter', 'maria', 'sara', 'vilma', 'simon'];
const TIMEZONE = 'Europe/Stockholm';
const HINT_COUNT = 3;
export const MAX_ATTEMPTS_PER_DAY = 10;
const STARS_TOGETHER = 3;
const STARS_ARCHIVE = 1;

/* ---------- Innehåll ---------- */
export function decryptContent(file, keyB64) {
  const key = Buffer.from(keyB64, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(file.iv, 'base64'));
  d.setAuthTag(Buffer.from(file.tag, 'base64'));
  const plain = Buffer.concat([d.update(Buffer.from(file.data, 'base64')), d.final()]);
  return JSON.parse(plain.toString('utf8'));
}

// Kontrollerar bara formen, aldrig innehållet i texterna. Kastar fel
// med generiska meddelanden (inga värden ur filen).
function validateContent(c) {
  if (!c || typeof c !== 'object') throw new Error('innehållet är inte ett objekt');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.start_date || '')) throw new Error('start_date saknas eller har fel format');
  if (!Array.isArray(c.days) || !c.days.length) throw new Error('days saknas');
  c.days.forEach((d, i) => {
    if (!d || d.day !== i + 1) throw new Error('dagarna är inte numrerade 1, 2, 3 …');
    if (!d.lock || typeof d.lock.type !== 'string') throw new Error('lucka ' + (i + 1) + ' saknar lock');
    if (typeof d.answer !== 'string' || !d.answer) throw new Error('lucka ' + (i + 1) + ' saknar svar');
    if (!d.fragments || SLOTS.some(s => !d.fragments[s])) throw new Error('lucka ' + (i + 1) + ' saknar lappar');
  });
  return c;
}

// Väljer källa: testinnehåll BARA om NATTAGET_CONTENT=sample är satt,
// annars den krypterade filen med CONTENT_KEY. Saknas nyckeln, eller går
// dekrypteringen fel, returneras { content: null } — spelet svarar då
// 503 ("Nattåget är inte redo än") hellre än att visa testinnehåll i
// produktion.
export function loadContent({ mode, key, encPath = ENC_PATH, samplePath = SAMPLE_PATH } = {}) {
  if (mode === 'sample') {
    try {
      return { content: validateContent(JSON.parse(fs.readFileSync(samplePath, 'utf8'))), source: 'sample' };
    } catch (e) {
      console.error('Nattåget: kunde inte läsa testinnehållet.');
      return { content: null, source: 'sample' };
    }
  }
  if (!key) {
    console.warn('Nattåget: CONTENT_KEY saknas och NATTAGET_CONTENT=sample är inte satt — spelet är inte redo.');
    return { content: null, source: 'none' };
  }
  let file;
  try { file = JSON.parse(fs.readFileSync(encPath, 'utf8')); }
  catch (e) {
    console.error('Nattåget: kunde inte läsa den krypterade innehållsfilen.');
    return { content: null, source: 'encrypted' };
  }
  try { return { content: validateContent(decryptContent(file, key)), source: 'encrypted' }; }
  catch (e) {
    console.error('Nattåget: kunde inte dekryptera innehållet.');
    return { content: null, source: 'encrypted' };
  }
}

/* ---------- Tid ---------- */
const dateFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false });
export function stockholmDate(d) { return dateFmt.format(new Date(d)); } // "YYYY-MM-DD"
export function stockholmTime(d) { return timeFmt.format(new Date(d)); } // "HH:MM"

function addDays(dateStr, n) {
  return new Date(Date.parse(dateStr + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
}
export function dayDate(content, n) { return addDays(content.start_date, n - 1); }

// NATTAGET_FAKE_NOW får bara användas lokalt — i produktion ignoreras den.
export function makeNow({ fakeNow, nodeEnv } = {}) {
  if (fakeNow && nodeEnv !== 'production' && !Number.isNaN(Date.parse(fakeNow))) {
    const t = Date.parse(fakeNow);
    return () => new Date(t);
  }
  return () => new Date();
}

/* ---------- Normalisering av svar (SPEC 4) ---------- */
export function normalizeAnswer(lock, raw) {
  const s = String(raw == null ? '' : raw);
  switch (lock && lock.type) {
    case 'digits': return s.replace(/\D/g, '');
    case 'word': return s.toUpperCase().replace(/\s+/g, '');
    case 'coordinate': return s.toUpperCase().replace(/\s+/g, '');
    default: return s.trim();
  }
}

/* ---------- Vad servern får skicka (SPEC 6) ---------- */
// Whitelistor — inga okända fält ur innehållsfilen följer med av misstag.
function publicLock(lock) {
  const out = { type: lock.type };
  ['length', 'cols', 'rows'].forEach(k => { if (Number.isInteger(lock[k])) out[k] = lock[k]; });
  if (Array.isArray(lock.options)) out.options = lock.options.map(String);
  return out;
}
function publicFragment(f, { withReveal }) {
  const out = { kind: f.kind };
  if (typeof f.text === 'string') out.text = f.text;
  if (f.kind === 'svg' && typeof f.svg === 'string') out.svg = f.svg;
  if (f.kind === 'grid_map') {
    out.cols = f.cols; out.rows = f.rows;
    out.cells = Object.assign({}, f.cells || {});
  }
  if (f.kind === 'photo_task' && withReveal && typeof f.reveal === 'string') out.reveal = f.reveal;
  return out;
}

function itemIndex(content) {
  const byId = new Map();
  content.days.forEach(d => {
    const it = d.epilogue && d.epilogue.item;
    if (it && it.id) byId.set(it.id, { day: d.day, item: it });
  });
  return byId;
}
function publicItem(it) { return { id: it.id, name: it.name, description: it.description || '' }; }

// Föremål laget har: de som lösta luckor gav, i ordning efter lucka.
function ownedItems(content, solves) {
  const solved = new Set(solves.map(s => s.day));
  return content.days
    .filter(d => solved.has(d.day) && d.epilogue && d.epilogue.item)
    .map(d => publicItem(d.epilogue.item));
}

// Stjärnor räknas fram, lagras inte: +3 löst tillsammans, +1 arkiv,
// −1 per ledtråd. Summan kan inte bli negativ.
export function computeStars(solves, events) {
  let total = 0;
  solves.forEach(s => { total += s.mode === 'together' ? STARS_TOGETHER : STARS_ARCHIVE; });
  events.forEach(e => { if (e.kind === 'hint') total -= 1; });
  return Math.max(0, total);
}

function dayStatus(content, n, today, solvedDays) {
  const date = dayDate(content, n);
  if (date > today) return 'locked';
  if (solvedDays.has(n)) return 'solved';
  return date === today ? 'today' : 'archive';
}

const isPostEvent = e => e.kind === 'fragment' || e.kind === 'photo';

// Lyktor: en spelare är tänd om hen lade ut sin lapp (eller sitt foto)
// samma dag som luckan gällde. I arkivläge visar de alltså vilka som
// var med den dagen.
function litSlots(date, events, slotByProfile) {
  const lit = new Set();
  events.forEach(e => {
    if (isPostEvent(e) && stockholmDate(e.created_at) === date) {
      const slot = slotByProfile.get(e.profile_id);
      if (slot) lit.add(slot);
    }
  });
  return lit;
}

function nameList(names) {
  if (names.length <= 1) return names.join('');
  return names.slice(0, -1).join(', ') + ' och ' + names[names.length - 1];
}

// "Så här gick det till" — byggs av färdiga mallar, ingen AI.
export function buildStory(dayContent, events, solve, nameOf) {
  const lines = [];
  const firstPost = events.find(isPostEvent);
  if (firstPost) lines.push(nameOf(firstPost.profile_id) + ' lade första lappen kl. ' + stockholmTime(firstPost.created_at) + '.');
  const firstNote = events.find(e => e.kind === 'note');
  if (firstNote) lines.push(nameOf(firstNote.profile_id) + ' skrev den första anteckningen.');
  const wrong = events.filter(e => e.kind === 'attempt').length;
  if (wrong === 1) lines.push('Laget provade ett felaktigt svar.');
  else if (wrong > 1) lines.push('Laget provade ' + wrong + ' felaktiga svar.');
  lines.push(nameOf(solve.profile_id) + (dayContent.lock.type === 'digits' ? ' slog in koden.' : ' slog in svaret.'));
  const hints = events.filter(e => e.kind === 'hint').length;
  lines.push(hints === 0 ? 'Inga ledtrådar behövdes.' : 'Laget behövde ' + hints + (hints === 1 ? ' ledtråd.' : ' ledtrådar.'));
  lines.push(solve.mode === 'together' ? 'Löst med alla fem.' : 'Löst i efterhand.');
  return lines;
}

// Det enda stället som bestämmer vad en spelare ser av en lucka.
// Förutsätter att anroparen redan har avvisat framtida luckor.
export function buildDayView({ content, n, today, me, players, profiles, events, solves }) {
  const d = content.days[n - 1];
  const date = dayDate(content, n);
  const solvedDays = new Set(solves.map(s => s.day));
  const status = dayStatus(content, n, today, solvedDays);
  if (status === 'locked') throw new Error('framtida lucka');
  const solve = solves.find(s => s.day === n) || null;
  // Arkivläge: luckan är passerad, oavsett om den sedan lösts i efterhand.
  const archiveMode = date < today;

  const slotByProfile = new Map(players.map(p => [p.profileId, p.slot]));
  const profileBySlot = new Map(players.map(p => [p.slot, p.profileId]));
  const profById = new Map(profiles.map(p => [p.id, p]));
  const nameOf = pid => { const p = profById.get(pid); return p ? p.name : (slotByProfile.get(pid) || 'Någon'); };
  const colorOf = pid => { const p = profById.get(pid); return p ? p.color : null; };

  const dayEvents = events.filter(e => e.day === n).sort((a, b) => new Date(a.created_at) - new Date(b.created_at) || a.id - b.id);
  const posted = new Set();   // spelare vars lapp ligger på tavlan
  const photoed = new Set();  // spelare som laddat upp foto
  dayEvents.forEach(e => {
    const slot = slotByProfile.get(e.profile_id);
    if (!slot) return;
    if (isPostEvent(e)) posted.add(slot);
    if (e.kind === 'photo') photoed.add(slot);
  });
  const lit = litSlots(date, dayEvents, slotByProfile);

  const fragments = {};
  SLOTS.forEach(slot => {
    const f = d.fragments[slot];
    const mine = slot === me;
    if (!(mine || archiveMode || posted.has(slot))) return;
    const pf = publicFragment(f, { withReveal: archiveMode || photoed.has(slot) });
    pf.posted = posted.has(slot);
    fragments[slot] = pf;
  });

  const hintEvents = dayEvents.filter(e => e.kind === 'hint');
  const hints = hintEvents.slice(0, HINT_COUNT).map((e, i) => ({
    n: i + 1, text: String((d.hints || [])[i] || ''), by: slotByProfile.get(e.profile_id) || null
  }));

  const board = dayEvents
    .filter(e => e.kind !== 'solve' || solve)
    .map(e => {
      const item = { id: e.id, kind: e.kind, slot: slotByProfile.get(e.profile_id) || null, name: nameOf(e.profile_id), color: colorOf(e.profile_id), at: new Date(e.created_at).toISOString() };
      if (e.kind === 'note' || e.kind === 'attempt') item.text = e.body || '';
      if (e.kind === 'photo') item.photoId = e.body;
      if (e.kind === 'hint') item.hint = hintEvents.indexOf(e) + 1;
      return item;
    });

  const items = itemIndex(content);
  const owned = new Set(ownedItems(content, solves).map(i => i.id));
  const todayN = Math.floor((Date.parse(today) - Date.parse(content.start_date)) / 86400000) + 1;
  const reqItem = id => {
    const src = items.get(id);
    // Namnet på ett föremål från en framtida lucka avslöjas inte.
    return src && src.day <= todayN ? { id, name: src.item.name } : { id, name: null };
  };
  const requiresItems = (d.requires_items || []).map(reqItem);
  const missingItems = requiresItems.filter(i => !owned.has(i.id));

  const allLit = SLOTS.every(s => lit.has(s));
  const myProfile = profileBySlot.get(me);
  const myAttempts = dayEvents.filter(e => e.kind === 'attempt' && e.profile_id === myProfile).length;

  const view = {
    day: n, date, status,
    title: d.title || '', intro: d.intro || '',
    lock: publicLock(d.lock),
    requiresItems, missingItems,
    me,
    players: SLOTS.map(slot => {
      const pid = profileBySlot.get(slot);
      return { slot, name: pid ? nameOf(pid) : slot, color: pid ? colorOf(pid) : null, lit: lit.has(slot) };
    }),
    litCount: lit.size, allLit,
    fragments,
    board,
    hints, hintsUsed: hints.length, hintsTotal: HINT_COUNT,
    lockOpen: !solve && (archiveMode || allLit),
    attemptsLeft: Math.max(0, MAX_ATTEMPTS_PER_DAY - myAttempts)
  };
  if (solve) {
    view.solved = {
      at: new Date(solve.solved_at).toISOString(), time: stockholmTime(solve.solved_at),
      by: slotByProfile.get(solve.profile_id) || null, name: nameOf(solve.profile_id), mode: solve.mode
    };
    // Svaret visas som låsrutor i den lösta vyn (SPEC 3.4) — bara här.
    view.solution = normalizeAnswer(d.lock, d.answer);
    view.epilogue = { text: (d.epilogue && d.epilogue.text) || '' };
    if (d.epilogue && d.epilogue.item) view.epilogue.item = publicItem(d.epilogue.item);
    view.story = buildStory(d, dayEvents, solve, nameOf);
  }
  return view;
}

export function buildStateView({ content, today, me, players, profiles, events, solves }) {
  const solvedDays = new Set(solves.map(s => s.day));
  const started = today >= content.start_date;
  const slotByProfile = new Map(players.map(p => [p.profileId, p.slot]));
  const profById = new Map(profiles.map(p => [p.id, p]));
  const days = content.days.map(d => {
    const status = dayStatus(content, d.day, today, solvedDays);
    const out = { day: d.day, status };
    if (status === 'locked') return out;
    out.title = d.title || '';
    const solve = solves.find(s => s.day === d.day);
    if (solve) out.solvedMode = solve.mode;
    if (status === 'today') out.litCount = litSlots(dayDate(content, d.day), events.filter(e => e.day === d.day), slotByProfile).size;
    return out;
  });
  const state = {
    title: content.title || 'Nattåget',
    subtitle: content.subtitle || '',
    startDate: content.start_date,
    today, started,
    totalDays: content.days.length,
    openedCount: days.filter(d => d.status !== 'locked').length,
    days,
    stars: computeStars(solves, events),
    items: ownedItems(content, solves),
    me,
    players: SLOTS.map(slot => {
      const p = players.find(x => x.slot === slot);
      const prof = p && profById.get(p.profileId);
      return { slot, name: prof ? prof.name : slot, color: prof ? prof.color : null };
    })
  };
  if (!started) state.prologue = content.prologue || '';
  return state;
}

/* ---------- Lagring (Postgres eller minne, samma dubbla mönster som Ghost Trains) ---------- */
async function initSchema(pool) {
  await pool.query(`create table if not exists nattaget_players (
    slot text primary key,
    profile_id text not null unique
  );`);
  await pool.query(`create table if not exists nattaget_events (
    id bigserial primary key,
    day int not null,
    profile_id text not null,
    kind text not null,
    body text,
    created_at timestamptz not null default now()
  );`);
  await pool.query(`create index if not exists nattaget_events_day_idx on nattaget_events (day, created_at);`);
  await pool.query(`create table if not exists nattaget_photos (
    id bigserial primary key,
    day int not null,
    profile_id text not null,
    mime text not null,
    data bytea not null,
    created_at timestamptz not null default now()
  );`);
  await pool.query(`create table if not exists nattaget_solves (
    day int primary key,
    profile_id text not null,
    mode text not null,
    solved_at timestamptz not null default now()
  );`);
  for (const t of ['nattaget_players', 'nattaget_events', 'nattaget_photos', 'nattaget_solves']) {
    await pool.query(`alter table ${t} enable row level security;`);
  }
}

function pgStore(pool) {
  const ev = r => ({ id: Number(r.id), day: r.day, profile_id: r.profile_id, kind: r.kind, body: r.body, created_at: r.created_at });
  return {
    async getPlayers() {
      const r = await pool.query('select slot, profile_id from nattaget_players');
      return r.rows.map(x => ({ slot: x.slot, profileId: x.profile_id }));
    },
    async setPlayers(map) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        for (const [slot, pid] of Object.entries(map)) {
          await client.query('delete from nattaget_players where slot = $1 or profile_id = $2', [slot, pid]);
          await client.query('insert into nattaget_players (slot, profile_id) values ($1, $2)', [slot, pid]);
        }
        await client.query('commit');
      } catch (e) { await client.query('rollback'); throw e; }
      finally { client.release(); }
    },
    async listEvents() {
      const r = await pool.query('select id, day, profile_id, kind, body, created_at from nattaget_events order by created_at, id');
      return r.rows.map(ev);
    },
    async insertEvent({ day, profileId, kind, body, createdAt }) {
      const r = await pool.query(
        'insert into nattaget_events (day, profile_id, kind, body, created_at) values ($1,$2,$3,$4, coalesce($5, now())) returning id, day, profile_id, kind, body, created_at',
        [day, profileId, kind, body ?? null, createdAt ?? null]
      );
      return ev(r.rows[0]);
    },
    async listSolves() {
      const r = await pool.query('select day, profile_id, mode, solved_at from nattaget_solves order by day');
      return r.rows;
    },
    async insertSolve({ day, profileId, mode, solvedAt }) {
      const r = await pool.query(
        'insert into nattaget_solves (day, profile_id, mode, solved_at) values ($1,$2,$3, coalesce($4, now())) on conflict (day) do nothing returning day',
        [day, profileId, mode, solvedAt ?? null]
      );
      return r.rowCount > 0;
    },
    async reset() {
      await pool.query('truncate nattaget_events, nattaget_photos, nattaget_solves restart identity');
    }
  };
}

export function memStore() {
  let players = [], events = [], solves = [], nextId = 1;
  return {
    async getPlayers() { return players.map(p => Object.assign({}, p)); },
    async setPlayers(map) {
      for (const [slot, pid] of Object.entries(map)) {
        players = players.filter(p => p.slot !== slot && p.profileId !== pid);
        players.push({ slot, profileId: pid });
      }
    },
    async listEvents() { return events.map(e => Object.assign({}, e)); },
    async insertEvent({ day, profileId, kind, body, createdAt }) {
      const e = { id: nextId++, day, profile_id: profileId, kind, body: body ?? null, created_at: createdAt ? new Date(createdAt) : new Date() };
      events.push(e);
      return Object.assign({}, e);
    },
    async listSolves() { return solves.map(s => Object.assign({}, s)); },
    async insertSolve({ day, profileId, mode, solvedAt }) {
      if (solves.some(s => s.day === day)) return false;
      solves.push({ day, profile_id: profileId, mode, solved_at: solvedAt ? new Date(solvedAt) : new Date() });
      return true;
    },
    async reset() { events = []; solves = []; nextId = 1; }
  };
}

/* ---------- Router ---------- */
function validProfileId(id) { return typeof id === 'string' && /^[a-z0-9]{4,64}$/i.test(id); }

function secretOk(expected, given) {
  if (!expected || typeof given !== 'string') return false; // utan hemlighet är admin avstängt
  const a = Buffer.from(expected), b = Buffer.from(given);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createRouter({ store, content, now, adminSecret, listProfiles }) {
  const router = express.Router();
  const today = () => stockholmDate(now());
  const profilesSafe = async () => {
    try { return listProfiles ? await listProfiles() : []; } catch (e) { return []; }
  };

  // Gemensamt för alla spelaranrop: innehållet måste finnas och profilen
  // måste vara kopplad till en plats. Okänd profil → 403.
  async function player(req, res) {
    if (!content) { res.status(503).json({ error: 'not_ready', message: 'Nattåget är inte redo än.' }); return null; }
    const profileId = req.method === 'GET' ? req.query.profile : (req.body && req.body.profile);
    if (!validProfileId(profileId)) { res.status(403).json({ error: 'not_player' }); return null; }
    const players = await store.getPlayers();
    const me = players.find(p => p.profileId === profileId);
    if (!me) { res.status(403).json({ error: 'not_player' }); return null; }
    return { slot: me.slot, profileId, players };
  }

  router.get('/state', async (req, res) => {
    try {
      const p = await player(req, res); if (!p) return;
      const [events, solves, profiles] = await Promise.all([store.listEvents(), store.listSolves(), profilesSafe()]);
      res.json(buildStateView({ content, today: today(), me: p.slot, players: p.players, profiles, events, solves }));
    } catch (e) { console.error('Nattåget: fel i /state:', e.message); res.status(500).json({ error: 'serverfel' }); }
  });

  router.get('/day/:n', async (req, res) => {
    try {
      const p = await player(req, res); if (!p) return;
      const n = Number(req.params.n);
      if (!Number.isInteger(n) || n < 1 || n > content.days.length) return res.status(404).json({ error: 'ingen sådan lucka' });
      // Datumlåset: en framtida lucka skickas aldrig, till någon.
      if (dayDate(content, n) > today()) return res.status(403).json({ error: 'locked' });
      const [events, solves, profiles] = await Promise.all([store.listEvents(), store.listSolves(), profilesSafe()]);
      res.json(buildDayView({ content, n, today: today(), me: p.slot, players: p.players, profiles, events, solves }));
    } catch (e) { console.error('Nattåget: fel i /day:', e.message); res.status(500).json({ error: 'serverfel' }); }
  });

  router.post('/admin/players', async (req, res) => {
    const b = req.body || {};
    if (!secretOk(adminSecret, b.secret)) return res.status(403).json({ error: 'fel hemlighet' });
    const map = b.players;
    if (!map || typeof map !== 'object' || Array.isArray(map)) return res.status(400).json({ error: 'players kravs' });
    const entries = Object.entries(map);
    if (!entries.length) return res.status(400).json({ error: 'players ar tom' });
    for (const [slot, pid] of entries) {
      if (!SLOTS.includes(slot)) return res.status(400).json({ error: 'okand plats: ' + slot });
      if (!validProfileId(pid)) return res.status(400).json({ error: 'ogiltigt profil-id for ' + slot });
    }
    if (new Set(entries.map(e => e[1])).size !== entries.length) return res.status(400).json({ error: 'samma profil pa flera platser' });
    try {
      await store.setPlayers(map);
      const players = await store.getPlayers();
      res.json({ ok: true, players: Object.fromEntries(players.map(p => [p.slot, p.profileId])) });
    } catch (e) { console.error('Nattåget: fel i /admin/players:', e.message); res.status(500).json({ error: 'serverfel' }); }
  });

  router.post('/admin/reset', async (req, res) => {
    if (!secretOk(adminSecret, (req.body || {}).secret)) return res.status(403).json({ error: 'fel hemlighet' });
    try { await store.reset(); res.json({ ok: true }); }
    catch (e) { console.error('Nattåget: fel i /admin/reset:', e.message); res.status(500).json({ error: 'serverfel' }); }
  });

  return router;
}

/* ---------- Uppstart ---------- */
// Alla val kan skickas in (används av testerna); annars läses miljön.
export async function createNattaget(pool, opts = {}) {
  const env = process.env;
  const { content, source } = opts.content !== undefined
    ? { content: opts.content, source: 'given' }
    : loadContent({ mode: opts.contentMode ?? env.NATTAGET_CONTENT, key: opts.contentKey ?? env.CONTENT_KEY, encPath: opts.encPath });
  const now = opts.now || makeNow({ fakeNow: env.NATTAGET_FAKE_NOW, nodeEnv: env.NODE_ENV });
  if (env.NATTAGET_FAKE_NOW && env.NODE_ENV === 'production') console.warn('Nattåget: NATTAGET_FAKE_NOW ignoreras i produktion.');

  let store = opts.store || null;
  if (!store) {
    let usablePool = pool;
    if (usablePool) {
      try { await initSchema(usablePool); }
      catch (e) {
        console.error('Nattåget: kunde inte initiera schema (kors i minneslage):', e.message);
        usablePool = null;
      }
    }
    store = usablePool ? pgStore(usablePool) : memStore();
  }
  if (content) console.log('Nattåget: innehåll laddat (' + (source === 'sample' ? 'testinnehåll' : source === 'encrypted' ? 'krypterat' : 'givet') + ').');

  const router = createRouter({
    store, content, now,
    adminSecret: opts.adminSecret ?? env.NATTAGET_ADMIN_SECRET ?? '',
    listProfiles: opts.listProfiles
  });
  return { router, store, content };
}
