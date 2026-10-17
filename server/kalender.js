/* ============================================================
   Kalendern — familjens kalendrar med gåtor (Nordhammer Spel)
   Första kalendern var Nattåget (jul 2026). Se kalender/SPEC.md (hela
   spelet) och kalender/CLAUDE.md (regler för den som bygger motorn —
   framför allt: inga spoilers).

   Varje kalender har ett id (t.ex. "halloween-2026", "jul-2026"). Det
   riktiga innehållet (berättelse, lappar, ledtrådar, svar) ligger
   krypterat i server/kalender/<id>.enc; testinnehållet i klartext i
   server/kalender/sample.json. KALENDER_ACTIVE väljer vilken kalender
   som är aktiv. Servern dekrypterar en gång vid start och håller
   innehållet i minnet. Innehållet loggas ALDRIG — felmeddelanden säger
   bara att något gick fel, aldrig vad.

   All data (händelser, foton, lösningar, spelare) lagras per kalender,
   så tidigare kalendrar finns kvar när en ny blir aktiv.

   All spoilerskydd sker här på servern: buildDayView() är det enda
   stället som bestämmer vad en spelare får se av en lucka (se SPEC.md,
   "Vad servern får skicka"). Klienten får aldrig mer än så.
   ============================================================ */
import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export const CONTENT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'kalender');
export const SAMPLE_PATH = path.join(CONTENT_DIR, 'sample.json');
export function encPathFor(id) { return path.join(CONTENT_DIR, id + '.enc'); }

export const SLOTS = ['peter', 'maria', 'sara', 'vilma', 'simon'];
const TIMEZONE = 'Europe/Stockholm';
const HINT_COUNT = 3;
export const MAX_DAYS = 24;
export const MAX_ATTEMPTS_PER_DAY = 10;
const STARS_TOGETHER = 3;
const STARS_ARCHIVE = 1;
const CALENDAR_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
// Data som spelades innan kalendrar fick id (provkörningen av Nattåget
// med testinnehållet) hamnar under testinnehållets id.
export const LEGACY_CALENDAR = 'prov';

/* ---------- Miljövariabler ----------
   KALENDER_* gäller. De gamla NATTAGET_* läses som reserv (med en
   varning) så att en driftsättning inte slår ut en pågående provkörning
   innan variablerna hunnit döpas om i Railway. */
export function readEnv(env = process.env) {
  const out = {};
  for (const name of ['CONTENT', 'SAMPLE_START', 'ADMIN_SECRET', 'FAKE_NOW', 'ACTIVE']) {
    const now = env['KALENDER_' + name], old = env['NATTAGET_' + name];
    if (now != null && now !== '') out[name] = now;
    else if (old != null && old !== '') {
      out[name] = old;
      console.warn('Kalendern: NATTAGET_' + name + ' är föråldrad — döp om den till KALENDER_' + name + '.');
    }
  }
  return out;
}

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
  if (typeof c.id !== 'string' || !CALENDAR_ID.test(c.id)) throw new Error('id saknas eller har fel format');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.start_date || '')) throw new Error('start_date saknas eller har fel format');
  if (!Array.isArray(c.days) || c.days.length < 1 || c.days.length > MAX_DAYS) throw new Error('days måste ha 1–' + MAX_DAYS + ' luckor');
  c.days.forEach((d, i) => {
    if (!d || d.day !== i + 1) throw new Error('dagarna är inte numrerade 1, 2, 3 …');
    if (!d.lock || typeof d.lock.type !== 'string') throw new Error('lucka ' + (i + 1) + ' saknar lock');
    if (typeof d.answer !== 'string' || !d.answer) throw new Error('lucka ' + (i + 1) + ' saknar svar');
    if (!d.fragments || SLOTS.some(s => !d.fragments[s])) throw new Error('lucka ' + (i + 1) + ' saknar lappar');
  });
  return c;
}

function readSample(samplePath, sampleStart) {
  let c;
  try { c = validateContent(JSON.parse(fs.readFileSync(samplePath, 'utf8'))); }
  catch (e) {
    console.error('Kalendern: kunde inte läsa testinnehållet.');
    return { content: null, source: 'sample' };
  }
  if (sampleStart) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(sampleStart) && !Number.isNaN(Date.parse(sampleStart + 'T00:00:00Z'))) c.start_date = sampleStart;
    else console.warn('Kalendern: KALENDER_SAMPLE_START har fel format (ska vara ÅÅÅÅ-MM-DD) och ignoreras.');
  }
  return { content: c, source: 'sample' };
}

// Väljer källa, i den här ordningen:
//  1. CONTENT_KEY satt och server/kalender/<KALENDER_ACTIVE>.enc finns →
//     alltid det riktiga innehållet. KALENDER_CONTENT och
//     KALENDER_SAMPLE_START ignoreras (med en varning), så att
//     testinställningar som glömts kvar i Railway aldrig kan ersätta det
//     riktiga innehållet. Filens id måste vara samma som KALENDER_ACTIVE.
//  2. KALENDER_CONTENT=sample → testinnehållet, med startdatumet flyttat
//     till KALENDER_SAMPLE_START om den är satt.
//  3. Annars inget innehåll → spelet svarar 503 ("inte redo än").
// Går dekrypteringen fel blir det också inget innehåll — aldrig testinnehåll.
export function loadContent({ mode, key, sampleStart, active, encPath, samplePath = SAMPLE_PATH } = {}) {
  const validActive = typeof active === 'string' && CALENDAR_ID.test(active);
  if (active && !validActive) console.warn('Kalendern: KALENDER_ACTIVE har fel format och ignoreras.');
  const enc = encPath || (validActive ? encPathFor(active) : null);
  if (key && enc && fs.existsSync(enc)) {
    if (mode) console.warn('Kalendern: KALENDER_CONTENT ignoreras eftersom CONTENT_KEY och den krypterade filen finns.');
    if (sampleStart) console.warn('Kalendern: KALENDER_SAMPLE_START ignoreras eftersom CONTENT_KEY och den krypterade filen finns.');
    let file;
    try { file = JSON.parse(fs.readFileSync(enc, 'utf8')); }
    catch (e) {
      console.error('Kalendern: kunde inte läsa den krypterade innehållsfilen.');
      return { content: null, source: 'encrypted' };
    }
    let c;
    try { c = validateContent(decryptContent(file, key)); }
    catch (e) {
      console.error('Kalendern: kunde inte dekryptera innehållet.');
      return { content: null, source: 'encrypted' };
    }
    if (validActive && c.id !== active) {
      console.error('Kalendern: innehållsfilens id stämmer inte med KALENDER_ACTIVE.');
      return { content: null, source: 'encrypted' };
    }
    return { content: c, source: 'encrypted' };
  }
  if (mode === 'sample') return readSample(samplePath, sampleStart);
  if (key && !validActive) console.warn('Kalendern: CONTENT_KEY är satt men KALENDER_ACTIVE saknas — spelet är inte redo.');
  else if (key) console.warn('Kalendern: CONTENT_KEY är satt men den krypterade filen för den aktiva kalendern saknas — spelet är inte redo.');
  else console.warn('Kalendern: CONTENT_KEY saknas och KALENDER_CONTENT=sample är inte satt — spelet är inte redo.');
  return { content: null, source: 'none' };
}

/* ---------- Tema ----------
   Färgerna, ordet för en lucka, tillbakaknappens text och ikonen för de
   fem. Saknas något används Nattågets värden. Färgerna kontrolleras här
   (bara #hex) eftersom klienten sätter dem som CSS-variabler. */
export const DEFAULT_THEME = {
  colors: {
    background: '#0F1A2B', surface: '#17253B', surface_dark: '#0B1422', border: '#3A4A63',
    text: '#E8EEF5', text_muted: '#A9B6C8', text_soft: '#C9D3E0',
    glow: '#F2B544', flame: '#FFD27A', off: '#5B6B84', paper: '#F4EBDD', paper_text: '#2A2118'
  },
  door: { singular: 'vagn', plural: 'vagnar' },
  back: 'Tillbaka till tåget',
  icon: 'lantern'
};
const ICONS = ['lantern', 'candle'];
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const shortText = (v, max) => typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null;
export function publicTheme(theme) {
  const t = theme && typeof theme === 'object' ? theme : {};
  const colors = {};
  for (const k of Object.keys(DEFAULT_THEME.colors)) {
    const v = t.colors && t.colors[k];
    colors[k] = typeof v === 'string' && HEX.test(v) ? v : DEFAULT_THEME.colors[k];
  }
  const door = t.door || {};
  return {
    colors,
    door: {
      singular: shortText(door.singular, 20) || DEFAULT_THEME.door.singular,
      plural: shortText(door.plural, 20) || DEFAULT_THEME.door.plural
    },
    back: shortText(t.back, 40) || DEFAULT_THEME.back,
    icon: ICONS.includes(t.icon) ? t.icon : DEFAULT_THEME.icon
  };
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

// KALENDER_FAKE_NOW får bara användas lokalt — i produktion ignoreras den.
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

  // En löst lucka är facit: då skickas hela gåtan — alla lappar (med
  // reveal), hela tavlan och alla ledtrådar, även de som aldrig togs.
  const showAll = archiveMode || !!solve;
  const fragments = {};
  SLOTS.forEach(slot => {
    const f = d.fragments[slot];
    const mine = slot === me;
    if (!(mine || showAll || posted.has(slot))) return;
    const pf = publicFragment(f, { withReveal: showAll || photoed.has(slot) });
    pf.posted = posted.has(slot);
    fragments[slot] = pf;
  });

  const hintEvents = dayEvents.filter(e => e.kind === 'hint');
  const hintTexts = (d.hints || []).slice(0, HINT_COUNT).map(String);
  const hintsUsed = Math.min(hintEvents.length, hintTexts.length);
  // Olöst: bara tagna ledtrådar. Löst: alla, med taken: false på dem
  // laget aldrig behövde.
  const hints = hintTexts.slice(0, solve ? hintTexts.length : hintsUsed).map((text, i) => ({
    n: i + 1, text, taken: i < hintsUsed, by: i < hintsUsed ? (slotByProfile.get(hintEvents[i].profile_id) || null) : null
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
    calendar: content.id, theme: publicTheme(content.theme),
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
    hints, hintsUsed, hintsTotal: hintTexts.length,
    lockOpen: !solve && (archiveMode || allLit),
    stars: computeStars(solves, events),
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
    calendar: content.id, theme: publicTheme(content.theme),
    title: content.title || 'Kalendern',
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

/* ---------- Lagring (Postgres eller minne, samma dubbla mönster som Ghost Trains) ----------
   Fyra tabeller, alla med kolumnen `calendar`. Före kalendrarna hette de
   nattaget_* och saknade kolumnen; migrateSchema() döper om dem, lägger
   till kolumnen (befintliga rader får LEGACY_CALENDAR) och byter
   nycklarna. Allt i en transaktion, och den går att köra hur många gånger
   som helst. */
const TABLES = ['players', 'events', 'photos', 'solves'];
export async function migrateSchema(pool) {
  const client = await pool.connect();
  const q = (sql, params) => client.query(sql, params);
  const exists = async name => (await q('select 1 from pg_constraint where conname = $1', [name])).rows.length > 0;
  try {
    await q('begin');
    for (const t of TABLES) {
      const [oldReg, newReg] = (await q('select to_regclass($1) as o, to_regclass($2) as n', ['nattaget_' + t, 'kalender_' + t])).rows.map(r => [r.o, r.n])[0];
      if (oldReg && !newReg) await q(`alter table nattaget_${t} rename to kalender_${t}`);
    }
    await q(`create table if not exists kalender_players (
      calendar text not null,
      slot text not null,
      profile_id text not null,
      primary key (calendar, slot),
      unique (calendar, profile_id)
    )`);
    await q(`create table if not exists kalender_events (
      id bigserial primary key,
      calendar text not null,
      day int not null,
      profile_id text not null,
      kind text not null,
      body text,
      created_at timestamptz not null default now()
    )`);
    await q(`create table if not exists kalender_photos (
      id bigserial primary key,
      calendar text not null,
      day int not null,
      profile_id text not null,
      mime text not null,
      data bytea not null,
      created_at timestamptz not null default now()
    )`);
    await q(`create table if not exists kalender_solves (
      calendar text not null,
      day int not null,
      profile_id text not null,
      mode text not null,
      solved_at timestamptz not null default now(),
      primary key (calendar, day)
    )`);
    // Omdöpta tabeller från före kalendrarna: lägg till kolumnen och byt nycklar.
    for (const t of TABLES) {
      await q(`alter table kalender_${t} add column if not exists calendar text not null default '${LEGACY_CALENDAR}'`);
      await q(`alter table kalender_${t} alter column calendar drop default`);
    }
    if (await exists('nattaget_players_pkey')) await q('alter table kalender_players drop constraint nattaget_players_pkey');
    if (await exists('nattaget_players_profile_id_key')) await q('alter table kalender_players drop constraint nattaget_players_profile_id_key');
    if (!(await exists('kalender_players_pkey'))) await q('alter table kalender_players add constraint kalender_players_pkey primary key (calendar, slot)');
    if (!(await exists('kalender_players_calendar_profile_id_key'))) await q('alter table kalender_players add constraint kalender_players_calendar_profile_id_key unique (calendar, profile_id)');
    if (await exists('nattaget_solves_pkey')) await q('alter table kalender_solves drop constraint nattaget_solves_pkey');
    if (!(await exists('kalender_solves_pkey'))) await q('alter table kalender_solves add constraint kalender_solves_pkey primary key (calendar, day)');
    await q('drop index if exists nattaget_events_day_idx');
    await q('create index if not exists kalender_events_cal_day_idx on kalender_events (calendar, day, created_at)');
    await q('create index if not exists kalender_photos_cal_idx on kalender_photos (calendar, id)');
    for (const t of TABLES) await q(`alter table kalender_${t} enable row level security`);
    await q('commit');
  } catch (e) { await q('rollback'); throw e; }
  finally { client.release(); }
}

// Ett lager bundet till en kalender: alla frågor gäller bara den.
export function pgStore(pool, calendar) {
  const ev = r => ({ id: Number(r.id), day: r.day, profile_id: r.profile_id, kind: r.kind, body: r.body, created_at: r.created_at });
  const INSERT_EVENT = 'insert into kalender_events (calendar, day, profile_id, kind, body, created_at) values ($1,$2,$3,$4,$5, coalesce($6, now())) returning id, day, profile_id, kind, body, created_at';
  return {
    calendar,
    async getPlayers() {
      const r = await pool.query('select slot, profile_id from kalender_players where calendar = $1', [calendar]);
      return r.rows.map(x => ({ slot: x.slot, profileId: x.profile_id }));
    },
    async setPlayers(map) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        for (const [slot, pid] of Object.entries(map)) {
          await client.query('delete from kalender_players where calendar = $1 and (slot = $2 or profile_id = $3)', [calendar, slot, pid]);
          await client.query('insert into kalender_players (calendar, slot, profile_id) values ($1, $2, $3)', [calendar, slot, pid]);
        }
        await client.query('commit');
      } catch (e) { await client.query('rollback'); throw e; }
      finally { client.release(); }
    },
    async listEvents() {
      const r = await pool.query('select id, day, profile_id, kind, body, created_at from kalender_events where calendar = $1 order by created_at, id', [calendar]);
      return r.rows.map(ev);
    },
    async insertEvent({ day, profileId, kind, body, createdAt }) {
      const r = await pool.query(INSERT_EVENT, [calendar, day, profileId, kind, body ?? null, createdAt ?? null]);
      return ev(r.rows[0]);
    },
    // Lägger bara till händelsen om det finns exakt `count` händelser av
    // typen `kind` för luckan (och profilen, om given). Ett transaktionslås
    // per kalender och lucka gör att två samtidiga anrop inte båda kan lyckas.
    async insertEventIfCount({ day, profileId, kind, body, createdAt }, guard) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        await client.query('select pg_advisory_xact_lock(hashtext($1), $2)', ['kalender:' + calendar, day]);
        const c = await client.query(
          'select count(*)::int as c from kalender_events where calendar = $1 and day = $2 and kind = $3 and ($4::text is null or profile_id = $4)',
          [calendar, day, guard.kind, guard.profileId ?? null]
        );
        let row = null;
        if (c.rows[0].c === guard.count) {
          const r = await client.query(INSERT_EVENT, [calendar, day, profileId, kind, body ?? null, createdAt ?? null]);
          row = ev(r.rows[0]);
        }
        await client.query('commit');
        return row;
      } catch (e) { await client.query('rollback'); throw e; }
      finally { client.release(); }
    },
    async listSolves() {
      const r = await pool.query('select day, profile_id, mode, solved_at from kalender_solves where calendar = $1 order by day', [calendar]);
      return r.rows;
    },
    async insertSolve({ day, profileId, mode, solvedAt }) {
      const r = await pool.query(
        'insert into kalender_solves (calendar, day, profile_id, mode, solved_at) values ($1,$2,$3,$4, coalesce($5, now())) on conflict (calendar, day) do nothing returning day',
        [calendar, day, profileId, mode, solvedAt ?? null]
      );
      return r.rowCount > 0;
    },
    async insertPhoto({ day, profileId, mime, data }) {
      const r = await pool.query('insert into kalender_photos (calendar, day, profile_id, mime, data) values ($1,$2,$3,$4,$5) returning id', [calendar, day, profileId, mime, data]);
      return Number(r.rows[0].id);
    },
    async getPhoto(id) {
      const r = await pool.query('select id, day, profile_id, mime, data from kalender_photos where calendar = $1 and id = $2', [calendar, id]);
      return r.rows[0] || null;
    },
    async deletePhoto(id) { await pool.query('delete from kalender_photos where calendar = $1 and id = $2', [calendar, id]); },
    // Tömmer den här kalenderns händelser, foton och lösningar — inte
    // spelarna, och inget från andra kalendrar.
    async reset() {
      const client = await pool.connect();
      try {
        await client.query('begin');
        for (const t of ['events', 'photos', 'solves']) await client.query(`delete from kalender_${t} where calendar = $1`, [calendar]);
        await client.query('commit');
      } catch (e) { await client.query('rollback'); throw e; }
      finally { client.release(); }
    }
  };
}

// Minnesläge (lokalt utan DATABASE_URL). Flera kalendrar kan dela samma db.
export function memDb() { return { players: [], events: [], solves: [], photos: [], nextId: 1, nextPhoto: 1 }; }
export function memStore(calendar = LEGACY_CALENDAR, db = memDb()) {
  const mine = x => x.calendar === calendar;
  const strip = x => { const o = Object.assign({}, x); delete o.calendar; return o; };
  return {
    calendar,
    async getPlayers() { return db.players.filter(mine).map(p => ({ slot: p.slot, profileId: p.profileId })); },
    async setPlayers(map) {
      for (const [slot, pid] of Object.entries(map)) {
        db.players = db.players.filter(p => !(mine(p) && (p.slot === slot || p.profileId === pid)));
        db.players.push({ calendar, slot, profileId: pid });
      }
    },
    async listEvents() { return db.events.filter(mine).map(strip); },
    async insertEvent({ day, profileId, kind, body, createdAt }) {
      const e = { calendar, id: db.nextId++, day, profile_id: profileId, kind, body: body ?? null, created_at: createdAt ? new Date(createdAt) : new Date() };
      db.events.push(e);
      return strip(e);
    },
    async insertEventIfCount(e, guard) {
      const c = db.events.filter(x => mine(x) && x.day === e.day && x.kind === guard.kind && (guard.profileId == null || x.profile_id === guard.profileId)).length;
      return c === guard.count ? this.insertEvent(e) : null;
    },
    async listSolves() { return db.solves.filter(mine).map(strip); },
    async insertSolve({ day, profileId, mode, solvedAt }) {
      if (db.solves.some(s => mine(s) && s.day === day)) return false;
      db.solves.push({ calendar, day, profile_id: profileId, mode, solved_at: solvedAt ? new Date(solvedAt) : new Date() });
      return true;
    },
    async insertPhoto({ day, profileId, mime, data }) {
      const p = { calendar, id: db.nextPhoto++, day, profile_id: profileId, mime, data };
      db.photos.push(p);
      return p.id;
    },
    async getPhoto(id) { const p = db.photos.find(x => mine(x) && x.id === Number(id)); return p ? strip(p) : null; },
    async deletePhoto(id) { db.photos = db.photos.filter(x => !(mine(x) && x.id === Number(id))); },
    async reset() {
      db.events = db.events.filter(x => !mine(x));
      db.solves = db.solves.filter(x => !mine(x));
      db.photos = db.photos.filter(x => !mine(x));
    }
  };
}

/* ---------- Foton ---------- */
export const MAX_PHOTO_BYTES = 600 * 1024;
const PHOTO_MIMES = {
  'image/jpeg': b => b.length > 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF,
  'image/png': b => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47
};
// Sajtens globala JSON-gräns är 8 kB. Bara foto-endpointen får större
// kroppar (600 kB bild ≈ 800 kB base64). Monteras på API-sökvägen FÖRE
// den globala parsern; den globala hoppar sedan över redan tolkade kroppar.
const photoJson = express.json({ limit: '900kb' });
export function photoBodyParser(req, res, next) {
  if (req.method === 'POST' && /^\/day\/\d+\/photo\/?$/.test(req.path)) return photoJson(req, res, next);
  next();
}
// Avkodar och kontrollerar en uppladdad bild. Returnerar { buf } eller { error, status }.
export function decodePhoto(mime, data) {
  const check = PHOTO_MIMES[mime];
  if (!check) return { status: 400, error: 'bara jpeg eller png' };
  if (typeof data !== 'string' || !data) return { status: 400, error: 'bild saknas' };
  const b64 = data.replace(/^data:[^,]*,/, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return { status: 400, error: 'ogiltig bild' };
  const buf = Buffer.from(b64, 'base64');
  if (buf.length > MAX_PHOTO_BYTES) return { status: 413, error: 'bilden ar for stor' };
  if (!check(buf)) return { status: 400, error: 'ogiltig bild' };
  return { buf };
}

/* ---------- Router ---------- */
const MAX_NOTE = 280;
// Kontrolltecken och radbrytningar blir mellanslag; texten visas alltid
// som ren text i klienten, aldrig som HTML.
function cleanNote(raw) {
  return String(raw == null ? '' : raw).replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim();
}
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
    if (!content) { res.status(503).json({ error: 'not_ready', message: 'Kalendern är inte redo än.' }); return null; }
    // Titel och tema är inga spoilers; de behövs för att visa "välj din profil"-sidan i rätt utseende.
    const notPlayer = () => res.status(403).json({ error: 'not_player', title: content.title || 'Kalendern', theme: publicTheme(content.theme) });
    const profileId = req.method === 'GET' ? req.query.profile : (req.body && req.body.profile);
    if (!validProfileId(profileId)) { notPlayer(); return null; }
    const players = await store.getPlayers();
    const me = players.find(p => p.profileId === profileId);
    if (!me) { notPlayer(); return null; }
    return { slot: me.slot, profileId, players };
  }

  router.get('/state', async (req, res) => {
    try {
      const p = await player(req, res); if (!p) return;
      const [events, solves, profiles] = await Promise.all([store.listEvents(), store.listSolves(), profilesSafe()]);
      res.json(buildStateView({ content, today: today(), me: p.slot, players: p.players, profiles, events, solves }));
    } catch (e) { console.error('Kalendern: fel i /state:', e.message); res.status(500).json({ error: 'serverfel' }); }
  });

  // Luckans nummer ur URL:en. Svarar själv 404/403 och returnerar null
  // för okända och framtida luckor (datumlåset gäller alla anrop).
  function openDayNumber(req, res) {
    const n = Number(req.params.n);
    if (!Number.isInteger(n) || n < 1 || n > content.days.length) { res.status(404).json({ error: 'ingen sådan lucka' }); return null; }
    if (dayDate(content, n) > today()) { res.status(403).json({ error: 'locked' }); return null; }
    return n;
  }
  async function dayView(n, p) {
    const [events, solves, profiles] = await Promise.all([store.listEvents(), store.listSolves(), profilesSafe()]);
    return buildDayView({ content, n, today: today(), me: p.slot, players: p.players, profiles, events, solves });
  }
  // Gemensamt skal för luckans endpoints: spelare + öppen lucka + felhantering.
  const dayRoute = (name, fn) => async (req, res) => {
    try {
      const p = await player(req, res); if (!p) return;
      const n = openDayNumber(req, res); if (n == null) return;
      await fn(req, res, p, n);
    } catch (e) { console.error('Kalendern: fel i ' + name + ':', e.message); res.status(500).json({ error: 'serverfel' }); }
  };

  router.get('/day/:n', dayRoute('/day', async (req, res, p, n) => {
    res.json(await dayView(n, p));
  }));

  // Lägger ut spelarens lapp på tavlan. Bara samma dag (dagens lucka),
  // och inte för fotouppgifter (de läggs ut via /photo). Idempotent.
  router.post('/day/:n/fragment', dayRoute('/fragment', async (req, res, p, n) => {
    const view = await dayView(n, p);
    if (view.status !== 'today') return res.status(409).json({ error: 'not_today' });
    if (content.days[n - 1].fragments[p.slot].kind === 'photo_task') return res.status(400).json({ error: 'photo_task' });
    if (!view.fragments[p.slot].posted) {
      await store.insertEventIfCount({ day: n, profileId: p.profileId, kind: 'fragment', createdAt: now() }, { kind: 'fragment', profileId: p.profileId, count: 0 });
    }
    res.json({ ok: true, day: await dayView(n, p) });
  }));

  // Fotouppgift: lägger ut fotot och lappen (tänder lyktan). Bara samma
  // dag; i arkivläge visas reveal ändå direkt. Ett foto per spelare och lucka.
  router.post('/day/:n/photo', dayRoute('/photo', async (req, res, p, n) => {
    const view = await dayView(n, p);
    if (view.status !== 'today') return res.status(409).json({ error: 'not_today' });
    if (content.days[n - 1].fragments[p.slot].kind !== 'photo_task') return res.status(400).json({ error: 'not_photo_task' });
    if (view.fragments[p.slot].posted) return res.status(409).json({ error: 'already_posted', day: view });
    const b = req.body || {};
    const photo = decodePhoto(b.mime, b.data);
    if (photo.error) return res.status(photo.status).json({ error: photo.error });
    const id = await store.insertPhoto({ day: n, profileId: p.profileId, mime: b.mime, data: photo.buf });
    const added = await store.insertEventIfCount(
      { day: n, profileId: p.profileId, kind: 'photo', body: String(id), createdAt: now() },
      { kind: 'photo', profileId: p.profileId, count: 0 }
    );
    if (!added) { await store.deletePhoto(id); return res.status(409).json({ error: 'already_posted', day: await dayView(n, p) }); }
    res.json({ ok: true, day: await dayView(n, p) });
  }));

  // Ett foto från tavlan. Bara för spelare, och bara för luckor som öppnats.
  router.get('/photo/:id', async (req, res) => {
    try {
      const p = await player(req, res); if (!p) return;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) return res.status(404).json({ error: 'inget sadant foto' });
      const photo = await store.getPhoto(id);
      if (!photo || dayDate(content, photo.day) > today()) return res.status(404).json({ error: 'inget sadant foto' });
      res.setHeader('Content-Type', photo.mime);
      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.end(Buffer.from(photo.data));
    } catch (e) { console.error('Kalendern: fel i /photo:', e.message); res.status(500).json({ error: 'serverfel' }); }
  });

  router.post('/day/:n/note', dayRoute('/note', async (req, res, p, n) => {
    const text = cleanNote((req.body || {}).text);
    if (!text) return res.status(400).json({ error: 'tom anteckning' });
    if ([...text].length > MAX_NOTE) return res.status(400).json({ error: 'for lang anteckning' });
    await store.insertEvent({ day: n, profileId: p.profileId, kind: 'note', body: text, createdAt: now() });
    res.json({ ok: true, day: await dayView(n, p) });
  }));

  // Avslöjar nästa ledtråd för hela laget (kostar en stjärna). Klienten
  // skickar vilket nummer den tror är nästa (`n`), så att två som trycker
  // samtidigt inte tar två ledtrådar — den andra får 409 och den nya vyn.
  router.post('/day/:n/hint', dayRoute('/hint', async (req, res, p, n) => {
    const view = await dayView(n, p);
    if (view.status === 'solved') return res.status(409).json({ error: 'already_solved', day: view });
    if (view.hintsUsed >= view.hintsTotal) return res.status(409).json({ error: 'no_more_hints', day: view });
    const want = (req.body || {}).n;
    if (want != null && Number(want) !== view.hintsUsed + 1) return res.status(409).json({ error: 'hint_already_taken', day: view });
    const added = await store.insertEventIfCount({ day: n, profileId: p.profileId, kind: 'hint', createdAt: now() }, { kind: 'hint', count: view.hintsUsed });
    if (!added) return res.status(409).json({ error: 'hint_already_taken', day: await dayView(n, p) });
    res.json({ ok: true, day: await dayView(n, p) });
  }));

  // Låset. Felaktiga försök sparas som 'attempt' och syns på tavlan.
  router.post('/day/:n/solve', dayRoute('/solve', async (req, res, p, n) => {
    const d = content.days[n - 1];
    const view = await dayView(n, p);
    if (view.status === 'solved') return res.status(409).json({ error: 'already_solved', day: view });
    if (!view.lockOpen) return res.status(409).json({ error: 'lock_closed' });
    if (view.missingItems.length) return res.status(409).json({ error: 'missing_items', missingItems: view.missingItems });
    if (view.attemptsLeft <= 0) return res.status(429).json({ error: 'too_many_attempts' });
    const given = normalizeAnswer(d.lock, (req.body || {}).answer).slice(0, 40);
    if (!given) return res.status(400).json({ error: 'tomt svar' });
    if (given === normalizeAnswer(d.lock, d.answer)) {
      // Samma dag med alla fem = tillsammans; annars i efterhand.
      const mode = view.status === 'today' && view.allLit ? 'together' : 'archive';
      const at = now();
      if (await store.insertSolve({ day: n, profileId: p.profileId, mode, solvedAt: at })) {
        await store.insertEvent({ day: n, profileId: p.profileId, kind: 'solve', createdAt: at });
      }
      return res.json({ correct: true, day: await dayView(n, p) });
    }
    await store.insertEvent({ day: n, profileId: p.profileId, kind: 'attempt', body: given, createdAt: now() });
    res.json({ correct: false, day: await dayView(n, p) });
  }));

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
    } catch (e) { console.error('Kalendern: fel i /admin/players:', e.message); res.status(500).json({ error: 'serverfel' }); }
  });

  router.post('/admin/reset', async (req, res) => {
    if (!secretOk(adminSecret, (req.body || {}).secret)) return res.status(403).json({ error: 'fel hemlighet' });
    try { await store.reset(); res.json({ ok: true }); }
    catch (e) { console.error('Kalendern: fel i /admin/reset:', e.message); res.status(500).json({ error: 'serverfel' }); }
  });

  return router;
}

/* ---------- Uppstart ---------- */
// Alla val kan skickas in (används av testerna); annars läses miljön
// (KALENDER_*, med NATTAGET_* som reserv — se readEnv).
export async function createKalender(pool, opts = {}) {
  const env = opts.env ? readEnv(opts.env) : readEnv();
  const nodeEnv = (opts.env || process.env).NODE_ENV;
  const { content, source } = opts.content !== undefined
    ? { content: opts.content, source: 'given' }
    : loadContent({
      mode: opts.contentMode ?? env.CONTENT,
      key: opts.contentKey ?? (opts.env || process.env).CONTENT_KEY,
      sampleStart: opts.sampleStart ?? env.SAMPLE_START,
      active: opts.active ?? env.ACTIVE,
      encPath: opts.encPath
    });
  const now = opts.now || makeNow({ fakeNow: env.FAKE_NOW, nodeEnv });
  if (env.FAKE_NOW && nodeEnv === 'production') console.warn('Kalendern: KALENDER_FAKE_NOW ignoreras i produktion.');
  const calendar = content ? content.id : LEGACY_CALENDAR;

  let store = opts.store || null;
  if (!store) {
    let usablePool = pool;
    if (usablePool) {
      try { await migrateSchema(usablePool); }
      catch (e) {
        console.error('Kalendern: kunde inte initiera schema (kors i minneslage):', e.message);
        usablePool = null;
      }
    }
    store = usablePool ? pgStore(usablePool, calendar) : memStore(calendar);
  }
  // Id:t är inget innehåll och får loggas.
  if (content) console.log('Kalendern: "' + content.id + '" laddad (' + (source === 'sample' ? 'testinnehåll' : source === 'encrypted' ? 'krypterat' : 'givet') + ').');

  const router = createRouter({
    store, content, now,
    adminSecret: opts.adminSecret ?? env.ADMIN_SECRET ?? '',
    listProfiles: opts.listProfiles
  });
  return { router, store, content };
}
