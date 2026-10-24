/* Kalendrar i riktig Postgres (PGlite): migreringen från nattaget_*,
   att data hålls isär per kalender, och att reset bara rör den aktiva.
   Kör: cd server && npm test */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import express from 'express';
import { PGlite } from '@electric-sql/pglite';
import { createKalender, migrateSchema, pgStore, SAMPLE_PATH, LEGACY_CALENDAR } from '../kalender.js';

const SAMPLE = JSON.parse(fs.readFileSync(SAMPLE_PATH, 'utf8'));
const IDS = { peter: 'pPeter01', maria: 'pMaria01', sara: 'pSara001', vilma: 'pVilma01', simon: 'pSimon01' };
const SECRET = 'testhemlighet';
const at = (date, time = '08:00') => new Date(date + 'T' + time + ':00+01:00');

// Samma gränssnitt som pg.Pool. PGlite har en enda anslutning, så frågor
// och transaktioner köas efter varandra.
function pglitePool(db) {
  let chain = Promise.resolve();
  const lock = () => {
    let release;
    const mine = new Promise(r => { release = r; });
    const prev = chain;
    chain = chain.then(() => mine);
    return prev.then(() => release);
  };
  const run = async (sql, params) => { const r = await db.query(sql, params); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length }; };
  return {
    async query(sql, params) { const release = await lock(); try { return await run(sql, params); } finally { release(); } },
    async connect() { const release = await lock(); return { query: run, release }; }
  };
}
const tables = async pool => (await pool.query("select tablename from pg_tables where schemaname = 'public' order by 1")).rows.map(r => r.tablename);

describe('migrering från nattaget_* (före kalendrarna)', () => {
  let pool;
  before(async () => {
    pool = pglitePool(new PGlite());
    // Exakt schemat från fas 1–4.
    await pool.query(`create table nattaget_players (slot text primary key, profile_id text not null unique)`);
    await pool.query(`create table nattaget_events (id bigserial primary key, day int not null, profile_id text not null, kind text not null, body text, created_at timestamptz not null default now())`);
    await pool.query(`create index nattaget_events_day_idx on nattaget_events (day, created_at)`);
    await pool.query(`create table nattaget_photos (id bigserial primary key, day int not null, profile_id text not null, mime text not null, data bytea not null, created_at timestamptz not null default now())`);
    await pool.query(`create table nattaget_solves (day int primary key, profile_id text not null, mode text not null, solved_at timestamptz not null default now())`);
    for (const [slot, id] of Object.entries(IDS)) await pool.query('insert into nattaget_players values ($1, $2)', [slot, id]);
    await pool.query(`insert into nattaget_events (day, profile_id, kind, body, created_at) values (1, $1, 'fragment', null, $2), (1, $3, 'note', 'Hej', $2)`, [IDS.maria, at('2026-10-16', '09:00'), IDS.sara]);
    await pool.query(`insert into nattaget_photos (day, profile_id, mime, data) values (3, $1, 'image/jpeg', $2)`, [IDS.peter, Buffer.from([0xFF, 0xD8, 0xFF, 1, 2, 3])]);
    await pool.query(`insert into nattaget_solves (day, profile_id, mode, solved_at) values (1, $1, 'together', $2)`, [IDS.vilma, at('2026-10-16', '21:00')]);
  });

  test('tabellerna döps om och alla rader hamnar i provkalendern', async () => {
    await migrateSchema(pool);
    assert.deepEqual(await tables(pool), ['kalender_events', 'kalender_photos', 'kalender_players', 'kalender_solves']);
    assert.equal(LEGACY_CALENDAR, SAMPLE.id);
    const st = pgStore(pool, LEGACY_CALENDAR);
    assert.equal((await st.getPlayers()).length, 5);
    assert.deepEqual((await st.listEvents()).map(e => [e.kind, e.body]), [['fragment', null], ['note', 'Hej']]);
    assert.deepEqual((await st.listSolves()).map(s => [s.day, s.mode]), [[1, 'together']]);
    const photo = await st.getPhoto(1);
    assert.deepEqual([...photo.data], [0xFF, 0xD8, 0xFF, 1, 2, 3]);
  });

  test('migreringen går att köra igen utan att något ändras', async () => {
    await migrateSchema(pool);
    await migrateSchema(pool);
    const st = pgStore(pool, LEGACY_CALENDAR);
    assert.equal((await st.listEvents()).length, 2);
    assert.equal((await st.getPlayers()).length, 5);
  });

  test('nycklarna gäller nu per kalender', async () => {
    const prov = pgStore(pool, LEGACY_CALENDAR), hw = pgStore(pool, 'halloween-2026');
    assert.equal(await prov.insertSolve({ day: 1, profileId: IDS.peter, mode: 'archive' }), false);
    assert.equal(await hw.insertSolve({ day: 1, profileId: IDS.peter, mode: 'archive' }), true);
    // Samma profil på samma plats i en annan kalender går bra.
    await hw.setPlayers(IDS);
    assert.equal((await hw.getPlayers()).length, 5);
    assert.equal((await prov.getPlayers()).length, 5);
    // Nya händelser får nya id:n efter de gamla.
    const e = await hw.insertEvent({ day: 1, profileId: IDS.peter, kind: 'note', body: 'ny' });
    assert.ok(e.id > 2);
  });
});

describe('flera kalendrar i samma databas', () => {
  let pool, prov, hw, provApp, hwApp;
  const halloween = () => {
    const c = JSON.parse(JSON.stringify(SAMPLE));
    c.id = 'halloween-2026'; c.start_date = '2026-10-25';
    return c;
  };
  async function serve(content) {
    const game = await createKalender(pool, { content, adminSecret: SECRET, now: () => at('2026-12-01', '10:00'), listProfiles: async () => [] });
    const app = express(); app.use(express.json()); app.use('/k', game.router);
    const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
    const base = 'http://127.0.0.1:' + server.address().port + '/k';
    return {
      game, server, base,
      get: async p => { const r = await fetch(base + p + (p.includes('?') ? '&' : '?') + 'profile=' + IDS.peter); return { status: r.status, body: await r.json().catch(() => null) }; },
      post: async (p, b) => { const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); return { status: r.status, body: await r.json() }; }
    };
  }
  before(async () => {
    pool = pglitePool(new PGlite());
    prov = await serve(JSON.parse(JSON.stringify(SAMPLE)));
    hw = await serve(halloween());
    for (const k of [prov, hw]) assert.equal((await k.post('/admin/players', { secret: SECRET, players: IDS })).status, 200);
  });
  after(async () => { for (const k of [prov, hw]) await new Promise(r => k.server.close(r)); });

  test('händelser, lösningar och foton syns bara i sin egen kalender', async () => {
    await prov.post('/day/1/fragment', { profile: IDS.peter });
    await prov.post('/day/1/note', { profile: IDS.peter, text: 'bara i prov' });
    const p = await prov.get('/day/1');
    const h = await hw.get('/day/1');
    assert.equal(p.body.calendar, 'prov');
    assert.equal(h.body.calendar, 'halloween-2026');
    assert.equal(p.body.board.length, 2);
    assert.equal(h.body.board.length, 0);
    await prov.game.store.insertSolve({ day: 2, profileId: IDS.peter, mode: 'archive' });
    // Halloween: lucka 2:s dag har kommit, men lucka 1 är olöst där — lösningen i prov räknas inte.
    const hwDay2 = (await hw.get('/state')).body.days[1];
    assert.deepEqual(hwDay2, { day: 2, status: 'locked', waitingFor: 1 });
    const photoId = await prov.game.store.insertPhoto({ day: 1, profileId: IDS.peter, mime: 'image/jpeg', data: Buffer.from([0xFF, 0xD8, 0xFF]) });
    assert.equal((await fetch(prov.base + '/photo/' + photoId + '?profile=' + IDS.peter)).status, 200);
    assert.equal((await fetch(hw.base + '/photo/' + photoId + '?profile=' + IDS.peter)).status, 404);
  });

  test('reset tömmer bara den aktiva kalendern och behåller spelarna', async () => {
    await hw.post('/day/1/note', { profile: IDS.peter, text: 'bara i halloween' });
    assert.equal((await hw.post('/admin/reset', { secret: SECRET })).status, 200);
    assert.equal((await hw.get('/day/1')).body.board.length, 0);
    assert.equal((await prov.get('/day/1')).body.board.length, 2);
    assert.deepEqual((await prov.game.store.listSolves()).map(x => x.day), [2]);
    assert.equal((await hw.game.store.getPlayers()).length, 5);
  });

  test('spelare kopplas per kalender', async () => {
    await hw.post('/admin/players', { secret: SECRET, players: { peter: 'pAnnan001' } });
    assert.equal((await hw.get('/state')).status, 403);
    assert.equal((await prov.get('/state')).status, 200);
  });

  test('ledtrådsspärren fungerar i Postgres', async () => {
    const [a, b] = await Promise.all([
      prov.post('/day/1/hint', { profile: IDS.peter, n: 1 }),
      prov.post('/day/1/hint', { profile: IDS.maria, n: 1 })
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  });
});
