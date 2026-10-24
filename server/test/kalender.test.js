/* Tester för kalenderns säkerhetsregler (kalender/SPEC.md, "Vad servern
   får skicka"). Körs alltid mot testinnehållet — aldrig content.enc.
   Kör: cd server && npm test */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import {
  createKalender, loadContent, makeNow, memStore, pgStore, readEnv, publicTheme, DEFAULT_THEME, checkContent, SAMPLE_PATH, photoBodyParser, MAX_PHOTO_BYTES, normalizeAnswer, computeStars
} from '../kalender.js';

const SAMPLE = JSON.parse(fs.readFileSync(SAMPLE_PATH, 'utf8'));
const SECRET = 'testhemlighet';
const IDS = { peter: 'pPeter01', maria: 'pMaria01', sara: 'pSara001', vilma: 'pVilma01', simon: 'pSimon01' };
const PROFILES = Object.entries(IDS).map(([slot, id], i) => ({ id, name: slot[0].toUpperCase() + slot.slice(1), color: '#00000' + i }));
const STRANGER = 'pStranger1';

// Stockholmstid. Testinnehållet startar 2026-12-01.
const at = (date, time = '08:00') => new Date(date + 'T' + time + ':00+01:00');

// Startar en riktig HTTP-server med routern och en klocka vi styr.
async function startGame(nowDate) {
  let current = nowDate;
  const store = memStore();
  const game = await createKalender(null, {
    content: JSON.parse(JSON.stringify(SAMPLE)),
    store, adminSecret: SECRET, now: () => current, listProfiles: async () => PROFILES
  });
  // Samma montering som server/index.js: foto-parsern före den globala 8 kB-gränsen.
  const app = express();
  app.use('/api/kalender', photoBodyParser);
  app.use(express.json({ limit: '8kb' }));
  app.use('/api/kalender', game.router);
  const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  const base = 'http://127.0.0.1:' + server.address().port + '/api/kalender';
  const responses = []; // alla svarskroppar, för "svaret läcker aldrig"-kontrollen
  const call = async (method, p, body) => {
    const r = await fetch(base + p, body ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { method });
    const text = await r.text();
    responses.push(text);
    return { status: r.status, body: JSON.parse(text), text };
  };
  const raw = async (p, profile) => fetch(base + p + '?profile=' + encodeURIComponent(profile));
  const postStatus = async (p, body) => (await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).status;
  const get = (p, profile) => call('GET', p + (p.includes('?') ? '&' : '?') + 'profile=' + encodeURIComponent(profile));
  const post = (p, body) => call('POST', p, body);
  const ev = (day, slot, kind, body, createdAt) => store.insertEvent({ day, profileId: IDS[slot], kind, body, createdAt });
  const r = await post('/admin/players', { secret: SECRET, players: IDS });
  assert.equal(r.status, 200);
  return { server, store, get, post, raw, postStatus, ev, responses, setNow: d => { current = d; }, close: () => new Promise(r => server.close(r)) };
}

function hasKeyDeep(obj, key) {
  if (!obj || typeof obj !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(obj, key)) return true;
  return Object.values(obj).some(v => hasKeyDeep(v, key));
}

function stringValues(obj) {
  if (typeof obj === 'string') return [obj];
  if (!obj || typeof obj !== 'object') return [];
  return Object.values(obj).flatMap(stringValues);
}

describe('framtida luckor', () => {
  let g;
  before(async () => { g = await startGame(at('2026-12-01', '10:00')); });
  after(() => g.close());

  test('en framtida lucka returnerar 403 utan innehåll', async () => {
    for (const n of [2, 3]) {
      const r = await g.get('/day/' + n, IDS.peter);
      assert.equal(r.status, 403);
      assert.deepEqual(r.body, { error: 'locked', reason: 'date' });
      const d = SAMPLE.days[n - 1];
      assert.ok(!r.text.includes(d.title) && !r.text.includes(d.intro));
    }
  });

  test('dagens lucka går att öppna', async () => {
    const r = await g.get('/day/1', IDS.peter);
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'today');
  });

  test('före startdatum är alla luckor låsta och prologen visas', async () => {
    g.setNow(at('2026-11-30', '23:59'));
    assert.equal((await g.get('/day/1', IDS.peter)).status, 403);
    const s = await g.get('/state', IDS.peter);
    assert.equal(s.status, 200);
    assert.equal(s.body.started, false);
    assert.equal(s.body.prologue, SAMPLE.prologue);
    assert.ok(s.body.days.every(d => d.status === 'locked' && d.title === undefined));
    g.setNow(at('2026-12-01', '10:00'));
  });

  test('luckan öppnas vid midnatt svensk tid', async () => {
    await g.store.insertSolve({ day: 1, profileId: IDS.peter, mode: 'together', solvedAt: at('2026-12-01', '20:00') });
    g.setNow(new Date('2026-12-01T22:59:59Z')); // 23:59:59 i Stockholm
    assert.equal((await g.get('/day/2', IDS.peter)).status, 403);
    g.setNow(new Date('2026-12-01T23:00:00Z')); // 00:00 den 2 december
    assert.equal((await g.get('/day/2', IDS.peter)).status, 200);
    g.setNow(at('2026-12-01', '10:00'));
  });

  test('/state skickar inga titlar för låsta dagar', async () => {
    const s = await g.get('/state', IDS.peter);
    const locked = s.body.days.filter(d => d.status === 'locked');
    assert.equal(locked.length, 2);
    assert.ok(locked.every(d => Object.keys(d).join() === 'day,status'));
    assert.ok(!s.text.includes(SAMPLE.days[1].title));
    assert.equal(s.body.prologue, undefined);
  });

  test('lucka utanför kalendern ger 404', async () => {
    assert.equal((await g.get('/day/99', IDS.peter)).status, 404);
    assert.equal((await g.get('/day/0', IDS.peter)).status, 404);
  });
});

describe('profiler', () => {
  let g;
  before(async () => { g = await startGame(at('2026-12-01')); });
  after(() => g.close());

  test('okänd profil får 403', async () => {
    assert.equal((await g.get('/state', STRANGER)).status, 403);
    assert.equal((await g.get('/day/1', STRANGER)).status, 403);
    assert.equal((await g.get('/day/1', '')).status, 403);
  });
});

describe('svaret skickas aldrig', () => {
  let g;
  before(async () => { g = await startGame(at('2026-12-03', '10:00')); });
  after(() => g.close());

  test('olösta luckor innehåller varken answer eller själva svaret', async () => {
    await g.ev(1, 'peter', 'attempt', '1111', at('2026-12-01', '09:00'));
    // Luckorna öppnas i ordning: kontrollera varje lucka medan den är öppen
    // och olöst (alla svar som samlas in här är från olösta luckor), lös den
    // sedan så att nästa öppnas.
    const solveAs = { 1: { profileId: IDS.simon, mode: 'archive', solvedAt: at('2026-12-02', '21:48') }, 2: { profileId: IDS.peter, mode: 'archive' } };
    for (const n of [1, 2, 3]) {
      const start = g.responses.length;
      for (const slot of Object.keys(IDS)) {
        const s = await g.get('/state', IDS[slot]);
        assert.ok(!hasKeyDeep(s.body, 'answer'));
        const r = await g.get('/day/' + n, IDS[slot]);
        assert.equal(r.status, 200);
        assert.ok(!hasKeyDeep(r.body, 'answer'), 'answer-nyckel i lucka ' + n);
        assert.ok(!hasKeyDeep(r.body, 'solution'), 'solution i olöst lucka ' + n);
        assert.ok(!hasKeyDeep(r.body, 'epilogue') && !hasKeyDeep(r.body, 'story'));
        assert.ok(!r.text.includes(SAMPLE.days[n - 1].epilogue.text));
        if (n < 3) assert.equal((await g.get('/day/' + (n + 1), IDS[slot])).status, 403);
      }
      // Inget strängvärde i något svar är ett svar. (Nycklar räknas inte:
      // dag 2:s svar är också en ruta i kartlappens cells, och den ska med.)
      const values = g.responses.slice(start).flatMap(t => stringValues(JSON.parse(t)));
      for (const d of SAMPLE.days) assert.ok(!values.includes(d.answer), 'svaret för lucka ' + d.day + ' läckte');
      if (solveAs[n]) await g.store.insertSolve(Object.assign({ day: n }, solveAs[n]));
    }
  });

  test('löst lucka visar epilog och "Så här gick det till", men aldrig answer-nyckeln', async () => {
    // Lucka 1 löstes av Simon i efterhand i testet ovan.
    const r = await g.get('/day/1', IDS.peter);
    assert.equal(r.body.status, 'solved');
    assert.ok(!hasKeyDeep(r.body, 'answer'));
    assert.equal(r.body.solution, SAMPLE.days[0].answer); // visas som låsrutor (SPEC 3.4)
    assert.equal(r.body.epilogue.text, SAMPLE.days[0].epilogue.text);
    assert.equal(r.body.epilogue.item.id, 'nyckel12');
    assert.ok(r.body.story.includes('Simon slog in koden.'));
    assert.ok(r.body.story.includes('Löst i efterhand.'));
    assert.equal(r.body.solved.time, '21:48');
    // Lucka 3 kräver nyckeln — den finns nu.
    const d3 = await g.get('/day/3', IDS.peter);
    assert.deepEqual(d3.body.missingItems, []);
    assert.equal(d3.body.requiresItems[0].name, 'Mässingsnyckel nr 12');
  });
});

describe('andra spelares lappar', () => {
  let g;
  before(async () => { g = await startGame(at('2026-12-01', '10:00')); });
  after(() => g.close());

  test('bara den egna lappen syns innan något lagts ut', async () => {
    for (const [slot, id] of Object.entries(IDS)) {
      const r = await g.get('/day/1', id);
      assert.deepEqual(Object.keys(r.body.fragments), [slot]);
      assert.equal(r.body.fragments[slot].posted, false);
      for (const other of Object.keys(IDS)) {
        if (other !== slot) assert.ok(!r.text.includes(SAMPLE.days[0].fragments[other].text), slot + ' såg ' + other + 's lapp');
      }
    }
  });

  test('en utlagd lapp syns för alla, de andra gör det inte', async () => {
    await g.ev(1, 'maria', 'fragment', null, at('2026-12-01', '07:42'));
    const r = await g.get('/day/1', IDS.peter);
    assert.deepEqual(Object.keys(r.body.fragments).sort(), ['maria', 'peter']);
    assert.equal(r.body.fragments.maria.text, SAMPLE.days[0].fragments.maria.text);
    assert.ok(!r.text.includes(SAMPLE.days[0].fragments.sara.text));
    assert.equal(r.body.litCount, 1);
    assert.equal(r.body.lockOpen, false);
    assert.equal(r.body.players.find(p => p.slot === 'maria').lit, true);
  });

  test('alla fem utlagda öppnar låset', async () => {
    for (const s of ['peter', 'sara', 'vilma', 'simon']) await g.ev(1, s, 'fragment', null, at('2026-12-01', '09:00'));
    const r = await g.get('/day/1', IDS.vilma);
    assert.equal(r.body.allLit, true);
    assert.equal(r.body.lockOpen, true);
    assert.equal(Object.keys(r.body.fragments).length, 5);
  });

  test('i arkivläge syns alla lappar, även de som aldrig lades ut', async () => {
    await g.store.insertSolve({ day: 1, profileId: IDS.peter, mode: 'together' });
    g.setNow(at('2026-12-02', '10:00'));
    await g.ev(2, 'peter', 'fragment', null, at('2026-12-02', '08:00'));
    g.setNow(at('2026-12-03', '10:00'));
    const r = await g.get('/day/2', IDS.sara);
    assert.equal(r.body.status, 'archive');
    assert.equal(Object.keys(r.body.fragments).length, 5);
    assert.equal(r.body.fragments.peter.posted, true);
    assert.equal(r.body.fragments.simon.posted, false);
    assert.deepEqual(r.body.fragments.simon.cells, SAMPLE.days[1].fragments.simon.cells);
    assert.equal(r.body.lockOpen, true);
    // Lyktorna visar vilka som var med samma dag.
    assert.deepEqual(r.body.players.filter(p => p.lit).map(p => p.slot), ['peter']);
  });

  test('en lapp som läggs ut i efterhand tänder inte lyktan', async () => {
    await g.ev(2, 'vilma', 'fragment', null, at('2026-12-03', '09:00'));
    const r = await g.get('/day/2', IDS.sara);
    assert.equal(r.body.players.find(p => p.slot === 'vilma').lit, false);
    assert.equal(r.body.fragments.vilma.posted, true);
  });
});

describe('fotouppgifter', () => {
  let g;
  const reveal = slot => SAMPLE.days[2].fragments[slot].reveal;
  // Lucka 3 öppnas först när lucka 2 är löst (lucka 1 lämnas olöst, så nyckeln saknas).
  before(async () => { g = await startGame(at('2026-12-03', '10:00')); await g.store.insertSolve({ day: 2, profileId: IDS.peter, mode: 'archive' }); });
  after(() => g.close());

  test('reveal skickas inte före uppladdning, inte ens till ägaren', async () => {
    const r = await g.get('/day/3', IDS.peter);
    assert.equal(r.body.fragments.peter.text, SAMPLE.days[2].fragments.peter.text);
    assert.equal(r.body.fragments.peter.reveal, undefined);
    for (const s of Object.keys(IDS)) assert.ok(!r.text.includes(reveal(s)));
  });

  test('efter uppladdning ser ägaren och de andra reveal', async () => {
    await g.ev(3, 'peter', 'photo', '1', at('2026-12-03', '09:30'));
    const own = await g.get('/day/3', IDS.peter);
    assert.equal(own.body.fragments.peter.reveal, reveal('peter'));
    assert.equal(own.body.players.find(p => p.slot === 'peter').lit, true);
    const other = await g.get('/day/3', IDS.maria);
    assert.equal(other.body.fragments.peter.reveal, reveal('peter'));
    assert.equal(other.body.fragments.maria.reveal, undefined);
    assert.ok(!other.text.includes(reveal('maria')) && !other.text.includes(reveal('simon')));
    assert.equal(other.body.board.find(b => b.kind === 'photo').photoId, '1');
  });

  test('i arkivläge visas reveal direkt', async () => {
    g.setNow(at('2026-12-04', '10:00'));
    const r = await g.get('/day/3', IDS.simon);
    assert.equal(r.body.status, 'archive');
    for (const s of Object.keys(IDS)) assert.equal(r.body.fragments[s].reveal, reveal(s));
  });

  test('saknade föremål visas', async () => {
    const r = await g.get('/day/3', IDS.simon);
    assert.deepEqual(r.body.missingItems, [{ id: 'nyckel12', name: 'Mässingsnyckel nr 12' }]);
  });
});

describe('ledtrådar', () => {
  let g;
  before(async () => { g = await startGame(at('2026-12-01', '10:00')); });
  after(() => g.close());

  test('bara avslöjade ledtrådar skickas', async () => {
    const hints = SAMPLE.days[0].hints;
    let r = await g.get('/day/1', IDS.peter);
    assert.deepEqual(r.body.hints, []);
    assert.equal(r.body.hintsTotal, 3);
    assert.ok(hints.every(h => !r.text.includes(h)));

    await g.ev(1, 'sara', 'hint', null, at('2026-12-01', '09:00'));
    r = await g.get('/day/1', IDS.peter);
    assert.deepEqual(r.body.hints, [{ n: 1, text: hints[0], taken: true, by: 'sara' }]);
    assert.ok(!r.text.includes(hints[1]) && !r.text.includes(hints[2]));

    await g.ev(1, 'peter', 'hint', null, at('2026-12-01', '09:05'));
    r = await g.get('/day/1', IDS.vilma);
    assert.equal(r.body.hints.length, 2);
    assert.ok(!r.text.includes(hints[2]));
  });

  test('ledtrådar kostar stjärnor, men stjärnorna blir aldrig negativa', async () => {
    const s = await g.get('/state', IDS.peter);
    assert.equal(s.body.stars, 0);
    assert.equal(computeStars([{ mode: 'together' }, { mode: 'archive' }], [{ kind: 'hint' }]), 3);
    assert.equal(computeStars([], [{ kind: 'hint' }, { kind: 'hint' }]), 0);
  });
});

describe('/state', () => {
  let g;
  before(async () => { g = await startGame(at('2026-12-02', '10:00')); });
  after(() => g.close());

  test('status per dag, lyktor idag, stjärnor och föremål', async () => {
    await g.store.insertSolve({ day: 1, profileId: IDS.maria, mode: 'together', solvedAt: at('2026-12-01', '21:00') });
    await g.ev(2, 'simon', 'fragment', null, at('2026-12-02', '08:00'));
    await g.ev(2, 'sara', 'fragment', null, at('2026-12-02', '08:10'));
    const s = await g.get('/state', IDS.peter);
    assert.equal(s.body.me, 'peter');
    assert.deepEqual(s.body.days.map(d => d.status), ['solved', 'today', 'locked']);
    assert.equal(s.body.days[0].solvedMode, 'together');
    assert.equal(s.body.days[1].litCount, 2);
    assert.equal(s.body.openedCount, 2);
    assert.equal(s.body.totalDays, 3);
    assert.equal(s.body.stars, 3);
    assert.deepEqual(s.body.items.map(i => i.id), ['nyckel12']);
    assert.equal(s.body.players.find(p => p.slot === 'maria').name, 'Maria');
  });
});

describe('admin', () => {
  let g;
  before(async () => { g = await startGame(at('2026-12-01')); });
  after(() => g.close());

  test('fel eller saknad hemlighet ger 403', async () => {
    assert.equal((await g.post('/admin/players', { secret: 'fel', players: { peter: STRANGER } })).status, 403);
    assert.equal((await g.post('/admin/players', { players: { peter: STRANGER } })).status, 403);
    assert.equal((await g.post('/admin/reset', { secret: 'fel' })).status, 403);
  });

  test('admin är avstängt utan KALENDER_ADMIN_SECRET', async () => {
    const game = await createKalender(null, { content: SAMPLE, store: memStore(), adminSecret: '', now: () => new Date() });
    const app = express(); app.use(express.json()); app.use('/n', game.router);
    const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
    const r = await fetch('http://127.0.0.1:' + server.address().port + '/n/admin/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"secret":""}' });
    assert.equal(r.status, 403);
    await new Promise(r => server.close(r));
  });

  test('ogiltiga platser och dubbletter avvisas', async () => {
    assert.equal((await g.post('/admin/players', { secret: SECRET, players: { kalle: STRANGER } })).status, 400);
    assert.equal((await g.post('/admin/players', { secret: SECRET, players: { peter: STRANGER, maria: STRANGER } })).status, 400);
  });

  test('en plats kan kopplas om', async () => {
    const r = await g.post('/admin/players', { secret: SECRET, players: { peter: STRANGER } });
    assert.equal(r.body.players.peter, STRANGER);
    assert.equal((await g.get('/state', STRANGER)).status, 200);
    assert.equal((await g.get('/state', IDS.peter)).status, 403);
    await g.post('/admin/players', { secret: SECRET, players: { peter: IDS.peter } });
  });

  test('reset tömmer allt utom spelarna', async () => {
    await g.ev(1, 'peter', 'fragment', null, at('2026-12-01'));
    await g.store.insertSolve({ day: 1, profileId: IDS.peter, mode: 'together' });
    assert.equal((await g.post('/admin/reset', { secret: SECRET })).status, 200);
    assert.deepEqual(await g.store.listEvents(), []);
    assert.deepEqual(await g.store.listSolves(), []);
    assert.equal((await g.get('/state', IDS.peter)).status, 200);
  });
});

describe('admin/reset och foton', () => {
  test('minneslagret: reset tömmer foton, händelser och lösningar men inte spelarna', async () => {
    const st = memStore();
    await st.setPlayers(IDS);
    const id = await st.insertPhoto({ day: 1, profileId: IDS.peter, mime: 'image/jpeg', data: Buffer.from('x') });
    assert.ok(await st.getPhoto(id));
    await st.insertEvent({ day: 1, profileId: IDS.peter, kind: 'photo', body: String(id) });
    await st.insertSolve({ day: 1, profileId: IDS.peter, mode: 'together' });
    await st.reset();
    assert.equal(await st.getPhoto(id), null);
    assert.deepEqual(await st.listEvents(), []);
    assert.deepEqual(await st.listSolves(), []);
    assert.equal((await st.getPlayers()).length, 5);
  });

  // Postgres-varianten testas mot riktig SQL (PGlite) längre ned.
});

describe('tid', () => {
  test('KALENDER_FAKE_NOW används lokalt men ignoreras i produktion', () => {
    const fake = '2026-12-05T10:00:00+01:00';
    assert.equal(makeNow({ fakeNow: fake, nodeEnv: 'development' })().toISOString(), new Date(fake).toISOString());
    const real = makeNow({ fakeNow: fake, nodeEnv: 'production' })();
    assert.ok(Math.abs(real - Date.now()) < 5000);
  });
});

describe('innehållsladdning', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kalender-'));
  const key = crypto.randomBytes(32).toString('base64');
  const encPath = path.join(tmp, 'content.enc');
  before(() => {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', Buffer.from(key, 'base64'), iv);
    const data = Buffer.concat([c.update(JSON.stringify(SAMPLE), 'utf8'), c.final()]);
    fs.writeFileSync(encPath, JSON.stringify({ v: 1, alg: 'aes-256-gcm', iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') }));
  });
  after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  // Fångar varningar och fel så att testerna kan kontrollera dem.
  function captureLogs(fn) {
    const logged = [];
    const ow = console.warn, oe = console.error;
    console.warn = (...a) => logged.push(a.join(' '));
    console.error = (...a) => logged.push(a.join(' '));
    try { return { result: fn(), logged }; } finally { console.warn = ow; console.error = oe; }
  }
  const missingEnc = path.join(tmp, 'finns-inte.enc');

  test('testinnehåll bara när KALENDER_CONTENT=sample', () => {
    const { result } = captureLogs(() => loadContent({ mode: 'sample', key: '', encPath }));
    assert.equal(result.source, 'sample');
    assert.equal(result.content.start_date, SAMPLE.start_date);
  });

  test('CONTENT_KEY + content.enc vinner alltid över sample, med varning', () => {
    const { result, logged } = captureLogs(() => loadContent({ mode: 'sample', key, sampleStart: '2026-10-17', encPath }));
    assert.equal(result.source, 'encrypted');
    assert.equal(result.content.start_date, SAMPLE.start_date); // startdatumet flyttas inte
    assert.deepEqual(logged, [
      'Kalendern: KALENDER_CONTENT ignoreras eftersom CONTENT_KEY och den krypterade filen finns.',
      'Kalendern: KALENDER_SAMPLE_START ignoreras eftersom CONTENT_KEY och den krypterade filen finns.'
    ]);
  });

  test('CONTENT_KEY + content.enc utan testinställningar ger inga varningar', () => {
    const { result, logged } = captureLogs(() => loadContent({ key, encPath }));
    assert.equal(result.source, 'encrypted');
    assert.deepEqual(logged, []);
  });

  test('CONTENT_KEY utan content.enc: sample används om det är satt, annars inte redo', () => {
    let r = captureLogs(() => loadContent({ mode: 'sample', key, encPath: missingEnc }));
    assert.equal(r.result.source, 'sample');
    r = captureLogs(() => loadContent({ key, encPath: missingEnc }));
    assert.equal(r.result.content, null);
    assert.deepEqual(r.logged, ['Kalendern: CONTENT_KEY är satt men KALENDER_ACTIVE saknas — spelet är inte redo.']);
  });

  test('KALENDER_SAMPLE_START flyttar testinnehållets startdatum', () => {
    const { result } = captureLogs(() => loadContent({ mode: 'sample', sampleStart: '2026-10-17', encPath: missingEnc }));
    assert.equal(result.content.start_date, '2026-10-17');
  });

  test('KALENDER_SAMPLE_START med fel format ignoreras med varning', () => {
    for (const bad of ['17 oktober', '2026-13-45', '2026-10-1']) {
      const { result, logged } = captureLogs(() => loadContent({ mode: 'sample', sampleStart: bad, encPath: missingEnc }));
      assert.equal(result.content.start_date, SAMPLE.start_date);
      assert.equal(logged.length, 1);
    }
  });

  test('KALENDER_SAMPLE_START öppnar luckor från det datumet', async () => {
    const game = await createKalender(null, { contentMode: 'sample', contentKey: '', sampleStart: '2026-10-17', encPath: missingEnc, store: memStore(), adminSecret: SECRET, now: () => at('2026-10-18', '12:00') });
    await game.store.setPlayers(IDS);
    const app = express(); app.use('/n', game.router);
    const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
    const base = 'http://127.0.0.1:' + server.address().port + '/n';
    const st = await (await fetch(base + '/state?profile=' + IDS.peter)).json();
    // Lucka 2:s dag har kommit, men lucka 1 är olöst.
    assert.deepEqual(st.days.map(d => d.status), ['archive', 'locked', 'locked']);
    assert.equal(st.days[1].waitingFor, 1);
    assert.equal((await fetch(base + '/day/3?profile=' + IDS.peter)).status, 403);
    await new Promise(r => server.close(r));
  });

  test('utan CONTENT_KEY och utan sample finns inget innehåll', () => {
    const orig = console.warn; console.warn = () => {};
    try {
      const r = loadContent({ key: '' });
      assert.equal(r.content, null);
      assert.equal(r.source, 'none');
      assert.equal(loadContent({ mode: '', key: undefined }).content, null);
    } finally { console.warn = orig; }
  });

  test('krypterat innehåll dekrypteras med rätt nyckel', () => {
    const r = loadContent({ key, encPath });
    assert.equal(r.source, 'encrypted');
    assert.equal(r.content.days.length, SAMPLE.days.length);
  });

  test('fel nyckel ger inget innehåll och loggar inget av innehållet', () => {
    const logged = [];
    const orig = console.error;
    console.error = (...a) => logged.push(a.join(' '));
    try {
      const r = loadContent({ key: crypto.randomBytes(32).toString('base64'), encPath });
      assert.equal(r.content, null);
    } finally { console.error = orig; }
    assert.deepEqual(logged, ['Kalendern: kunde inte dekryptera innehållet.']);
  });

  test('utan innehåll svarar /state och /day/:n 503 "inte redo"', async () => {
    const orig = console.warn; console.warn = () => {};
    let game;
    try { game = await createKalender(null, { contentMode: '', contentKey: '', store: memStore(), adminSecret: SECRET, now: () => new Date() }); }
    finally { console.warn = orig; }
    assert.equal(game.content, null);
    const app = express(); app.use('/n', game.router);
    const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
    const base = 'http://127.0.0.1:' + server.address().port + '/n';
    for (const p of ['/state', '/day/1']) {
      const r = await fetch(base + p + '?profile=' + IDS.peter);
      assert.equal(r.status, 503);
      assert.deepEqual(await r.json(), { error: 'not_ready', message: 'Kalendern är inte redo än.' });
    }
    await new Promise(r => server.close(r));
  });

});

test('normalisering av svar', () => {
  assert.equal(normalizeAnswer({ type: 'digits' }, ' 9 1-37 '), '9137');
  assert.equal(normalizeAnswer({ type: 'word' }, 'ly kta'), 'LYKTA');
  assert.equal(normalizeAnswer({ type: 'coordinate' }, 'c5'), 'C5');
  assert.equal(normalizeAnswer({ type: 'choice' }, 'Norr'), 'Norr');
});

describe('fas 2: spela lucka 1 med fem profiler', () => {
  let g;
  const D1 = SAMPLE.days[0];
  before(async () => { g = await startGame(at('2026-12-01', '07:42')); });
  after(() => g.close());

  test('låset är stängt tills alla fem lagt ut sina lappar', async () => {
    const r = await g.post('/day/1/solve', { profile: IDS.peter, answer: D1.answer });
    assert.equal(r.status, 409);
    assert.equal(r.body.error, 'lock_closed');
    assert.equal(r.body.correct, undefined);
  });

  test('att lägga ut lappen tänder lyktan, och går bara att göra en gång', async () => {
    let r = await g.post('/day/1/fragment', { profile: IDS.maria });
    assert.equal(r.status, 200);
    assert.equal(r.body.day.fragments.maria.posted, true);
    assert.equal(r.body.day.players.find(p => p.slot === 'maria').lit, true);
    r = await g.post('/day/1/fragment', { profile: IDS.maria });
    assert.equal(r.body.day.board.filter(b => b.kind === 'fragment').length, 1);
    assert.equal((await g.post('/day/1/fragment', { profile: STRANGER })).status, 403);
  });

  test('anteckningar: högst 280 tecken, ren text', async () => {
    g.setNow(at('2026-12-01', '08:15'));
    assert.equal((await g.post('/day/1/note', { profile: IDS.sara, text: '   ' })).status, 400);
    assert.equal((await g.post('/day/1/note', { profile: IDS.sara, text: 'x'.repeat(281) })).status, 400);
    assert.equal((await g.post('/day/1/note', { profile: IDS.sara, text: 'å'.repeat(280) })).status, 200);
    const r = await g.post('/day/1/note', { profile: IDS.sara, text: 'Udda\nsiffror <b>alla</b>' });
    const note = r.body.day.board.filter(b => b.kind === 'note').pop();
    assert.equal(note.text, 'Udda siffror <b>alla</b>');
    assert.equal(note.name, 'Sara');
    assert.equal(note.color, PROFILES.find(p => p.id === IDS.sara).color);
  });

  test('när alla fem lagt ut öppnas låset; fel försök syns på tavlan', async () => {
    g.setNow(at('2026-12-01', '18:00'));
    for (const s of ['peter', 'sara', 'vilma', 'simon']) await g.post('/day/1/fragment', { profile: IDS[s] });
    const v = await g.get('/day/1', IDS.peter);
    assert.equal(v.body.allLit, true);
    assert.equal(v.body.lockOpen, true);
    const r = await g.post('/day/1/solve', { profile: IDS.simon, answer: '1397' });
    assert.equal(r.body.correct, false);
    const a = r.body.day.board.find(b => b.kind === 'attempt');
    assert.equal(a.name, 'Simon');
    assert.equal(a.text, '1397');
    assert.equal(r.body.day.attemptsLeft, 9);
  });

  test('rätt svar löser luckan tillsammans och ger epilog, föremål och berättelse', async () => {
    g.setNow(at('2026-12-01', '21:48'));
    const r = await g.post('/day/1/solve', { profile: IDS.vilma, answer: ' ' + D1.answer.split('').join(' ') });
    assert.equal(r.body.correct, true);
    const d = r.body.day;
    assert.equal(d.status, 'solved');
    assert.equal(d.solved.mode, 'together');
    assert.equal(d.solved.time, '21:48');
    assert.equal(d.solution, D1.answer);
    assert.equal(d.epilogue.item.name, D1.epilogue.item.name);
    assert.equal(d.lockOpen, false);
    assert.deepEqual(d.story, [
      'Maria lade första lappen kl. 07:42.',
      'Sara skrev den första anteckningen.',
      'Laget provade ett felaktigt svar.',
      'Vilma slog in koden.',
      'Inga ledtrådar behövdes.',
      'Löst med alla fem.'
    ]);
    assert.ok(!hasKeyDeep(r.body, 'answer'));
    const s = await g.get('/state', IDS.peter);
    assert.equal(s.body.stars, 3);
    assert.equal(s.body.days[0].solvedMode, 'together');
    assert.deepEqual(s.body.items.map(i => i.id), ['nyckel12']);
  });

  test('en löst lucka går inte att lösa igen', async () => {
    const r = await g.post('/day/1/solve', { profile: IDS.peter, answer: D1.answer });
    assert.equal(r.status, 409);
    assert.equal(r.body.error, 'already_solved');
  });

  test('framtida luckor går inte att posta till', async () => {
    assert.equal((await g.post('/day/2/fragment', { profile: IDS.peter })).status, 403);
    assert.equal((await g.post('/day/2/note', { profile: IDS.peter, text: 'hej' })).status, 403);
    assert.equal((await g.post('/day/2/solve', { profile: IDS.peter, answer: 'C5' })).status, 403);
  });
});

describe('fas 2: låsregler', () => {
  let g;
  before(async () => { g = await startGame(at('2026-12-01', '10:00')); });
  after(() => g.close());

  test('högst 10 försök per spelare och dag', async () => {
    for (const s of Object.keys(IDS)) await g.post('/day/1/fragment', { profile: IDS[s] });
    for (let i = 0; i < 10; i++) {
      const r = await g.post('/day/1/solve', { profile: IDS.peter, answer: '000' + i });
      assert.equal(r.body.correct, false);
    }
    const r = await g.post('/day/1/solve', { profile: IDS.peter, answer: SAMPLE.days[0].answer });
    assert.equal(r.status, 429);
    // Andra spelare har egna försök kvar.
    assert.equal((await g.post('/day/1/solve', { profile: IDS.maria, answer: '1234' })).body.correct, false);
  });

  test('en arkivlucka löses i efterhand utan lyktor, och lappar kan inte läggas ut där', async () => {
    await g.store.insertSolve({ day: 1, profileId: IDS.maria, mode: 'archive' });
    g.setNow(at('2026-12-03', '10:00'));
    assert.equal((await g.post('/day/2/fragment', { profile: IDS.peter })).status, 409);
    const r = await g.post('/day/2/solve', { profile: IDS.peter, answer: 'c5' });
    assert.equal(r.body.correct, true);
    assert.equal(r.body.day.solved.mode, 'archive');
    assert.ok(r.body.day.story.includes('Löst i efterhand.'));
    assert.ok(r.body.day.story.includes('Peter slog in svaret.'));
  });

  test('en lucka som kräver föremål går inte att lösa utan dem', async () => {
    // Egen kalender där lucka 1 ger ett annat föremål, så nyckeln aldrig finns.
    const content = JSON.parse(JSON.stringify(SAMPLE));
    content.days[0].epilogue.item.id = 'annat';
    const store = memStore(); await store.setPlayers(IDS);
    for (const day of [1, 2]) await store.insertSolve({ day, profileId: IDS.peter, mode: 'archive' });
    const game = await createKalender(null, { content, store, adminSecret: SECRET, now: () => at('2026-12-04', '10:00') });
    const app = express(); app.use(express.json()); app.use('/k', game.router);
    const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
    try {
      const res = await fetch('http://127.0.0.1:' + server.address().port + '/k/day/3/solve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile: IDS.peter, answer: SAMPLE.days[2].answer }) });
      const body = await res.json();
      assert.equal(res.status, 409);
      assert.equal(body.error, 'missing_items');
      assert.deepEqual(body.missingItems.map(i => i.id), ['nyckel12']);
    } finally { await new Promise(r => server.close(r)); }
  });

  test('fotouppgifter läggs inte ut via /fragment', async () => {
    g.setNow(at('2026-12-03', '10:00'));
    assert.equal((await g.post('/day/3/fragment', { profile: IDS.peter })).status, 400);
  });
});

describe('fas 3: ledtrådar, stjärnor, arkiv och föremål', () => {
  let g;
  const hints = SAMPLE.days[0].hints;
  before(async () => { g = await startGame(at('2026-12-01', '09:00')); });
  after(() => g.close());

  test('ledtrådar avslöjas en i taget och syns för alla', async () => {
    let r = await g.post('/day/1/hint', { profile: IDS.sara, n: 1 });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.day.hints, [{ n: 1, text: hints[0], taken: true, by: 'sara' }]);
    assert.ok(!r.text.includes(hints[1]));
    const other = await g.get('/day/1', IDS.simon);
    assert.equal(other.body.hints[0].text, hints[0]);
    assert.equal(other.body.board.find(b => b.kind === 'hint').hint, 1);
  });

  test('två som tar samma ledtråd samtidigt tar bara en', async () => {
    const [a, b] = await Promise.all([
      g.post('/day/1/hint', { profile: IDS.peter, n: 2 }),
      g.post('/day/1/hint', { profile: IDS.maria, n: 2 })
    ]);
    // Minneslagret är synkront mellan läsning och skrivning per anrop, så
    // den andra ser alltid att ledtråd 2 redan är tagen.
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    assert.equal((await g.get('/day/1', IDS.peter)).body.hintsUsed, 2);
  });

  test('efter tre ledtrådar finns inga fler', async () => {
    assert.equal((await g.post('/day/1/hint', { profile: IDS.peter, n: 3 })).status, 200);
    const r = await g.post('/day/1/hint', { profile: IDS.peter, n: 4 });
    assert.equal(r.status, 409);
    assert.equal(r.body.error, 'no_more_hints');
  });

  test('stjärnorna blir aldrig negativa, och skulden dras av senare', async () => {
    assert.equal((await g.get('/state', IDS.peter)).body.stars, 0);
    for (const s of Object.keys(IDS)) await g.post('/day/1/fragment', { profile: IDS[s] });
    const r = await g.post('/day/1/solve', { profile: IDS.peter, answer: SAMPLE.days[0].answer });
    assert.equal(r.body.day.solved.mode, 'together');
    assert.ok(r.body.day.story.includes('Laget behövde 3 ledtrådar.'));
    assert.equal(r.body.day.stars, 0); // +3 − 3
    assert.equal((await g.post('/day/1/hint', { profile: IDS.peter, n: 4 })).body.error, 'already_solved');
  });

  test('en olöst arkivlucka kan lösas av en person och ger +1', async () => {
    g.setNow(at('2026-12-03', '10:00'));
    const v = await g.get('/day/2', IDS.vilma);
    assert.equal(v.body.status, 'archive');
    assert.equal(v.body.lockOpen, true);
    const r = await g.post('/day/2/solve', { profile: IDS.vilma, answer: SAMPLE.days[1].answer });
    assert.equal(r.body.correct, true);
    assert.equal(r.body.day.solved.mode, 'archive');
    assert.equal(r.body.day.stars, 1);
    const s = await g.get('/state', IDS.peter);
    assert.deepEqual(s.body.days.map(d => [d.status, d.solvedMode]), [['solved', 'together'], ['solved', 'archive'], ['today', undefined]]);
  });

  test('requires_items: luckan med nyckeln går att lösa när föremålet finns', async () => {
    const v = await g.get('/day/3', IDS.peter);
    assert.deepEqual(v.body.missingItems, []);
    assert.deepEqual(v.body.requiresItems, [{ id: 'nyckel12', name: 'Mässingsnyckel nr 12' }]);
    g.setNow(at('2026-12-04', '10:00'));
    const r = await g.post('/day/3/solve', { profile: IDS.sara, answer: 'lykta' });
    assert.equal(r.body.correct, true);
    assert.equal(r.body.day.solved.mode, 'archive');
  });

  test('framtida ledtrådar går inte att ta', async () => {
    g.setNow(at('2026-12-01', '10:00'));
    assert.equal((await g.post('/day/2/hint', { profile: IDS.peter, n: 1 })).status, 403);
  });
});

test('Postgres: villkorad insert tar ett lås per lucka och lägger inte till när antalet ändrats', async () => {
  const sql = [];
  let count = 1;
  const client = {
    query: async (q, params) => {
      sql.push(q);
      if (/count\(\*\)/.test(q)) return { rows: [{ c: count }] };
      if (/^insert/.test(q)) return { rows: [{ id: '7', day: params[0], profile_id: params[1], kind: params[2], body: null, created_at: new Date() }] };
      return { rows: [] };
    },
    release() {}
  };
  const st = pgStore({ connect: async () => client });
  assert.equal(await st.insertEventIfCount({ day: 1, profileId: IDS.peter, kind: 'hint' }, { kind: 'hint', count: 0 }), null);
  assert.ok(sql.some(q => q.includes('pg_advisory_xact_lock')));
  assert.ok(!sql.some(q => /^insert/.test(q)));
  count = 0;
  const e = await st.insertEventIfCount({ day: 1, profileId: IDS.peter, kind: 'hint' }, { kind: 'hint', count: 0 });
  assert.equal(e.id, 7);
  assert.equal(sql.filter(q => q === 'commit').length, 2);
});

describe('löst lucka: hela gåtan skickas', () => {
  let g;
  before(async () => { g = await startGame(at('2026-12-01', '09:00')); });
  after(() => g.close());

  test('olöst idag: andras lappar och otagna ledtrådar skickas inte', async () => {
    await g.ev(1, 'maria', 'fragment', null, at('2026-12-01', '08:00'));
    await g.ev(1, 'simon', 'hint', null, at('2026-12-01', '08:30'));
    const r = await g.get('/day/1', IDS.peter);
    assert.deepEqual(Object.keys(r.body.fragments).sort(), ['maria', 'peter']);
    assert.equal(r.body.hints.length, 1);
    assert.ok(!r.text.includes(SAMPLE.days[0].hints[1]) && !r.text.includes(SAMPLE.days[0].hints[2]));
    assert.ok(!r.text.includes(SAMPLE.days[0].fragments.sara.text));
  });

  test('när luckan är löst skickas alla fem lappar, hela tavlan och alla ledtrådar', async () => {
    // Löst direkt i lagret, så att bara Maria lagt ut sin lapp.
    await g.ev(1, 'sara', 'note', 'Udda siffror', at('2026-12-01', '08:40'));
    await g.ev(1, 'vilma', 'attempt', '1397', at('2026-12-01', '08:50'));
    await g.store.insertSolve({ day: 1, profileId: IDS.vilma, mode: 'archive', solvedAt: at('2026-12-01', '08:55') });
    await g.ev(1, 'vilma', 'solve', null, at('2026-12-01', '08:55'));
    for (const slot of Object.keys(IDS)) {
      const r = await g.get('/day/1', IDS[slot]);
      assert.equal(r.body.status, 'solved');
      assert.deepEqual(Object.keys(r.body.fragments).sort(), Object.keys(IDS).sort());
      for (const s of Object.keys(IDS)) assert.equal(r.body.fragments[s].text, SAMPLE.days[0].fragments[s].text);
      assert.equal(r.body.fragments.maria.posted, true);
      assert.equal(r.body.fragments.sara.posted, false);
      assert.deepEqual(r.body.board.map(b => b.kind), ['fragment', 'hint', 'note', 'attempt', 'solve']);
      assert.deepEqual(r.body.hints.map(h => [h.n, h.taken, h.by]), [[1, true, 'simon'], [2, false, null], [3, false, null]]);
      assert.deepEqual(r.body.hints.map(h => h.text), SAMPLE.days[0].hints);
      assert.equal(r.body.hintsUsed, 1);
      assert.ok(!hasKeyDeep(r.body, 'answer'));
    }
  });

  test('en löst fotolucka skickar reveal för alla, även utan uppladdning', async () => {
    await g.store.insertSolve({ day: 2, profileId: IDS.peter, mode: 'archive' });
    g.setNow(at('2026-12-03', '09:00'));
    await g.ev(3, 'peter', 'photo', '1', at('2026-12-03', '08:00'));
    let r = await g.get('/day/3', IDS.maria);
    assert.equal(r.body.fragments.maria.reveal, undefined);
    await g.store.insertSolve({ day: 3, profileId: IDS.peter, mode: 'archive', solvedAt: at('2026-12-03', '08:30') });
    r = await g.get('/day/3', IDS.maria);
    for (const s of Object.keys(IDS)) assert.equal(r.body.fragments[s].reveal, SAMPLE.days[2].fragments[s].reveal);
    assert.equal(r.body.board.find(b => b.kind === 'photo').photoId, '1');
  });

  test('framtida luckor skickas fortfarande aldrig', async () => {
    g.setNow(at('2026-12-01', '09:00'));
    assert.equal((await g.get('/day/3', IDS.peter)).status, 403);
  });
});

// Minsta giltiga bilder: rätt "magiska" byte i början, resten utfyllnad.
const JPEG = n => Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(n)]);
const PNG = n => Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(n)]);

describe('fas 4: fotouppgifter', () => {
  let g;
  const D3 = SAMPLE.days[2];
  // Lucka 3 öppnas när lucka 2 är löst; lucka 1 (som ger nyckeln) löses senare i testet.
  before(async () => { g = await startGame(at('2026-12-03', '09:00')); await g.store.insertSolve({ day: 2, profileId: IDS.peter, mode: 'archive' }); });
  after(() => g.close());

  test('uppladdning lägger ut fotot, tänder lyktan och visar reveal', async () => {
    const r = await g.post('/day/3/photo', { profile: IDS.peter, mime: 'image/jpeg', data: JPEG(400 * 1024).toString('base64') });
    assert.equal(r.status, 200);
    assert.equal(r.body.day.fragments.peter.posted, true);
    assert.equal(r.body.day.fragments.peter.reveal, D3.fragments.peter.reveal);
    assert.equal(r.body.day.players.find(p => p.slot === 'peter').lit, true);
    const photo = r.body.day.board.find(b => b.kind === 'photo');
    assert.equal(photo.slot, 'peter');
    // Maria ser Peters foto och reveal, men inte sin egen reveal.
    const m = await g.get('/day/3', IDS.maria);
    assert.equal(m.body.fragments.peter.reveal, D3.fragments.peter.reveal);
    assert.equal(m.body.fragments.maria.reveal, undefined);
    // Fotot går att hämta för spelare, inte för andra.
    const img = await g.raw('/photo/' + photo.photoId, IDS.maria);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/jpeg');
    assert.equal((await img.arrayBuffer()).byteLength, 400 * 1024 + 4);
    assert.equal((await g.raw('/photo/' + photo.photoId, STRANGER)).status, 403);
    assert.equal((await g.raw('/photo/999', IDS.maria)).status, 404);
  });

  test('png med data-URL-prefix går också bra', async () => {
    const r = await g.post('/day/3/photo', { profile: IDS.maria, mime: 'image/png', data: 'data:image/png;base64,' + PNG(1000).toString('base64') });
    assert.equal(r.status, 200);
  });

  test('ett foto per spelare och lucka', async () => {
    const r = await g.post('/day/3/photo', { profile: IDS.peter, mime: 'image/jpeg', data: JPEG(10).toString('base64') });
    assert.equal(r.status, 409);
    assert.equal(r.body.error, 'already_posted');
    assert.equal((await g.get('/day/3', IDS.peter)).body.board.filter(b => b.kind === 'photo').length, 2);
  });

  test('fel typ, trasig bild och för stor bild avvisas', async () => {
    const bad = [
      [{ mime: 'image/gif', data: JPEG(10).toString('base64') }, 400],
      [{ mime: 'image/jpeg', data: PNG(10).toString('base64') }, 400],
      [{ mime: 'image/jpeg', data: 'inte base64!' }, 400],
      [{ mime: 'image/jpeg' }, 400],
      [{ mime: 'image/jpeg', data: JPEG(MAX_PHOTO_BYTES).toString('base64') }, 413]
    ];
    for (const [body, status] of bad) {
      const r = await g.post('/day/3/photo', Object.assign({ profile: IDS.sara }, body));
      assert.equal(r.status, status, JSON.stringify(body).slice(0, 60));
    }
    assert.equal((await g.get('/day/3', IDS.sara)).body.fragments.sara.posted, false);
  });

  test('foton bara för fotouppgifter och bara samma dag', async () => {
    g.setNow(at('2026-12-01', '09:00'));
    assert.equal((await g.post('/day/1/photo', { profile: IDS.sara, mime: 'image/jpeg', data: JPEG(10).toString('base64') })).status, 400);
    assert.equal((await g.post('/day/3/photo', { profile: IDS.sara, mime: 'image/jpeg', data: JPEG(10).toString('base64') })).status, 403);
    g.setNow(at('2026-12-04', '09:00'));
    assert.equal((await g.post('/day/3/photo', { profile: IDS.sara, mime: 'image/jpeg', data: JPEG(10).toString('base64') })).status, 409);
  });

  test('den stora gränsen gäller bara foto-endpointen', async () => {
    g.setNow(at('2026-12-03', '09:00'));
    const big = 'x'.repeat(20 * 1024);
    assert.equal(await g.postStatus('/day/3/note', { profile: IDS.sara, text: big }), 413);
    assert.equal(await g.postStatus('/day/3/hint', { profile: IDS.sara, padding: big }), 413);
  });

  test('med alla fem foton öppnas ordlåset och löses', async () => {
    for (const s of ['sara', 'vilma', 'simon']) {
      assert.equal((await g.post('/day/3/photo', { profile: IDS[s], mime: 'image/jpeg', data: JPEG(10).toString('base64') })).status, 200);
    }
    // Lucka 3 kräver nyckeln från lucka 1.
    let r = await g.post('/day/3/solve', { profile: IDS.vilma, answer: 'lykta' });
    assert.equal(r.body.error, 'missing_items');
    await g.store.insertSolve({ day: 1, profileId: IDS.peter, mode: 'archive' });
    r = await g.post('/day/3/solve', { profile: IDS.vilma, answer: 'LYK TX' });
    assert.equal(r.body.correct, false);
    r = await g.post('/day/3/solve', { profile: IDS.vilma, answer: ' ly kta ' });
    assert.equal(r.body.correct, true);
    assert.equal(r.body.day.solved.mode, 'together');
    assert.equal(r.body.day.solution, 'LYKTA');
  });
});

describe('fas 4: lås', () => {
  test('koordinat och val normaliseras', () => {
    assert.equal(normalizeAnswer({ type: 'coordinate' }, ' c 5'), 'C5');
    assert.equal(normalizeAnswer({ type: 'word' }, 'åsa öl'), 'ÅSAÖL');
    assert.equal(normalizeAnswer({ type: 'choice', options: ['Norr', 'Söder'] }, ' Norr '), 'Norr');
    assert.notEqual(normalizeAnswer({ type: 'choice' }, 'norr'), 'Norr');
  });

  test('ett valfritt lås skickar sina alternativ men inte svaret', async () => {
    const content = JSON.parse(JSON.stringify(SAMPLE));
    content.days[0].lock = { type: 'choice', options: ['Norr', 'Söder', 'Öster'] };
    content.days[0].answer = 'Söder';
    const store = memStore(); await store.setPlayers(IDS);
    const game = await createKalender(null, { content, store, adminSecret: SECRET, now: () => at('2026-12-01', '10:00'), listProfiles: async () => PROFILES });
    const app = express(); app.use(express.json()); app.use('/n', game.router);
    const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
    const base = 'http://127.0.0.1:' + server.address().port + '/n';
    const d = await (await fetch(base + '/day/1?profile=' + IDS.peter)).json();
    assert.deepEqual(d.lock, { type: 'choice', options: ['Norr', 'Söder', 'Öster'] });
    assert.ok(!hasKeyDeep(d, 'answer'));
    // Arkivläge så att låset är öppet utan lyktor.
    await new Promise(r => server.close(r));
  });
});

describe('kalendrar, miljövariabler och tema', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kalender-tema-'));
  const quiet = fn => { const w = console.warn, e = console.error; const logged = []; console.warn = console.error = (...a) => logged.push(a.join(' ')); try { return { result: fn(), logged }; } finally { console.warn = w; console.error = e; } };
  const writeSample = (name, mutate) => { const c = JSON.parse(JSON.stringify(SAMPLE)); mutate(c); const f = path.join(tmp, name); fs.writeFileSync(f, JSON.stringify(c)); return f; };

  test('KALENDER_* gäller, NATTAGET_* används som reserv med varning', () => {
    let r = quiet(() => readEnv({ KALENDER_CONTENT: 'sample', NATTAGET_CONTENT: 'x', NATTAGET_ADMIN_SECRET: 'gammal', KALENDER_ACTIVE: 'jul-2026' }));
    assert.equal(r.result.CONTENT, 'sample');
    assert.equal(r.result.ADMIN_SECRET, 'gammal');
    assert.equal(r.result.ACTIVE, 'jul-2026');
    assert.deepEqual(r.logged, ['Kalendern: NATTAGET_ADMIN_SECRET är föråldrad — döp om den till KALENDER_ADMIN_SECRET.']);
    r = quiet(() => readEnv({}));
    assert.deepEqual(r.result, {});
  });

  test('innehållet måste ha ett giltigt id och 1–24 luckor', () => {
    const bad = [
      writeSample('utan-id.json', c => { delete c.id; }),
      writeSample('fel-id.json', c => { c.id = 'Jul 2026!'; }),
      writeSample('noll.json', c => { c.days = []; }),
      writeSample('for-manga.json', c => { c.days = Array.from({ length: 25 }, (_, i) => Object.assign({}, c.days[0], { day: i + 1 })); })
    ];
    for (const f of bad) assert.equal(quiet(() => loadContent({ mode: 'sample', samplePath: f })).result.content, null, f);
    const sju = writeSample('sju.json', c => { c.days = Array.from({ length: 7 }, (_, i) => Object.assign({}, c.days[0], { day: i + 1 })); });
    assert.equal(quiet(() => loadContent({ mode: 'sample', samplePath: sju })).result.content.days.length, 7);
  });

  test('den krypterade filen väljs med KALENDER_ACTIVE och id:t måste stämma', () => {
    const key = crypto.randomBytes(32).toString('base64');
    const enc = c => {
      const iv = crypto.randomBytes(12);
      const ci = crypto.createCipheriv('aes-256-gcm', Buffer.from(key, 'base64'), iv);
      const data = Buffer.concat([ci.update(JSON.stringify(c), 'utf8'), ci.final()]);
      return JSON.stringify({ v: 1, alg: 'aes-256-gcm', iv: iv.toString('base64'), tag: ci.getAuthTag().toString('base64'), data: data.toString('base64') });
    };
    const jul = Object.assign(JSON.parse(JSON.stringify(SAMPLE)), { id: 'jul-2026' });
    const f = path.join(tmp, 'jul-2026.enc');
    fs.writeFileSync(f, enc(jul));
    let r = quiet(() => loadContent({ key, active: 'jul-2026', encPath: f }));
    assert.equal(r.result.source, 'encrypted');
    assert.equal(r.result.content.id, 'jul-2026');
    r = quiet(() => loadContent({ key, active: 'halloween-2026', encPath: f }));
    assert.equal(r.result.content, null);
    assert.deepEqual(r.logged, ['Kalendern: innehållsfilens id stämmer inte med KALENDER_ACTIVE.']);
    r = quiet(() => loadContent({ key, active: '../hemligt' }));
    assert.equal(r.result.content, null);
    assert.ok(r.logged[0].includes('KALENDER_ACTIVE har fel format'));
  });

  test('temat fylls på med Nattågets värden och bara #hex-färger släpps igenom', () => {
    assert.deepEqual(publicTheme(undefined), DEFAULT_THEME);
    const t = publicTheme({ colors: { background: '#110D17', text: 'red; background:url(x)', glow: '#fff' }, door: { singular: 'rum', plural: '' }, icon: 'skull', back: 'x'.repeat(41), extra: 1 });
    assert.equal(t.colors.background, '#110D17');
    assert.equal(t.colors.text, DEFAULT_THEME.colors.text);
    assert.equal(t.colors.glow, '#fff');
    assert.deepEqual(t.door, { singular: 'rum', plural: 'vagnar' });
    assert.equal(t.icon, 'lantern');
    assert.equal(t.back, DEFAULT_THEME.back);
    assert.equal(t.extra, undefined);
  });

  test('state och luckor skickar kalender-id och tema; okänd profil får titel och tema men inget annat', async () => {
    const g = await startGame(at('2026-12-01', '10:00'));
    try {
      const s = await g.get('/state', IDS.peter);
      assert.equal(s.body.calendar, 'prov');
      assert.equal(s.body.theme.icon, 'candle');
      assert.deepEqual(s.body.theme.door, { singular: 'rum', plural: 'rum' });
      assert.equal((await g.get('/day/1', IDS.peter)).body.theme.back, 'Tillbaka till huset');
      const n = await g.get('/state', STRANGER);
      assert.equal(n.status, 403);
      assert.deepEqual(Object.keys(n.body).sort(), ['error', 'theme', 'title']);
    } finally { await g.close(); }
  });

  test('valfritt antal luckor: totalDays följer innehållet', async () => {
    const content = JSON.parse(JSON.stringify(SAMPLE));
    content.days = Array.from({ length: 7 }, (_, i) => Object.assign({}, SAMPLE.days[0], { day: i + 1 }));
    content.start_date = '2026-10-25';
    const store = memStore('prov'); await store.setPlayers(IDS);
    for (let day = 1; day <= 6; day++) await store.insertSolve({ day, profileId: IDS.peter, mode: 'together' });
    const game = await createKalender(null, { content, store, adminSecret: SECRET, now: () => at('2026-10-31', '12:00'), listProfiles: async () => PROFILES });
    const app = express(); app.use('/k', game.router);
    const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
    const st = await (await fetch('http://127.0.0.1:' + server.address().port + '/k/state?profile=' + IDS.peter)).json();
    assert.equal(st.totalDays, 7);
    assert.equal(st.openedCount, 7);
    assert.equal(st.days[6].status, 'today');
    await new Promise(r => server.close(r));
  });
});

describe('punkt 7: /admin/check', () => {
  const clone = () => JSON.parse(JSON.stringify(SAMPLE));
  // Alla strängar i innehållet (utom korta tecken som kartsymboler och
  // plats-/typnamn) — inga av dem får förekomma i ett felmeddelande.
  function contentStrings(c) {
    const out = [];
    const walk = v => { if (typeof v === 'string') { if (v.length >= 4) out.push(v); } else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
    c.days.forEach(walk); walk(c.title); walk(c.subtitle); walk(c.prologue);
    return out.filter(x => !['text', 'photo_task', 'grid_map', 'digits', 'word', 'coordinate', 'choice', 'svg'].includes(x));
  }
  const noLeak = (c, errors) => {
    const secrets = contentStrings(c).concat(c.days.map(d => d.answer)).concat(c.days.flatMap(d => (d.epilogue && d.epilogue.item) ? [d.epilogue.item.id, d.epilogue.item.name] : []));
    for (const e of errors) for (const x of secrets) if (x && x.length >= 2) assert.ok(!e.includes(x), 'felet "' + e + '" innehåller text ur filen');
  };

  test('testinnehållet är OK', () => {
    assert.deepEqual(checkContent(SAMPLE), []);
  });

  test('varje sorts fel hittas, med plats men utan innehåll', () => {
    const cases = [
      [c => { delete c.days[1].fragments.simon; }, 'dag 2: lapp för simon saknas'],
      [c => { c.days[0].fragments.maria.kind = 'video'; }, 'dag 1: lapp för maria har ogiltig typ (ska vara text, svg, grid_map, photo_task)'],
      [c => { c.days[0].fragments.sara.text = ''; }, 'dag 1: lapp för sara saknar text'],
      [c => { delete c.days[2].fragments.vilma.reveal; }, 'dag 3: lapp för vilma behöver text och reveal'],
      [c => { c.days[1].fragments.simon.cells.F9 = 'x'; }, 'dag 2: lapp för simon har rutor utanför kartan'],
      [c => { c.days[0].fragments.peter = { kind: 'svg', svg: '<script>' }; }, 'dag 1: lapp för peter saknar en giltig svg'],
      [c => { c.days[0].hints.pop(); }, 'dag 1: ska ha exakt 3 ledtrådar'],
      [c => { c.days[0].lock.type = 'safe'; }, 'dag 1: ogiltig låstyp (ska vara digits, word, coordinate, choice)'],
      [c => { c.days[0].answer = '91370'; }, 'dag 1: svaret passar inte låstypen digits (4 siffror)'],
      [c => { c.days[0].answer = '91a7'; }, 'dag 1: svaret passar inte låstypen digits (4 siffror)'],
      [c => { c.days[2].answer = 'LYKT4'; }, 'dag 3: svaret passar inte låstypen word (5 bokstäver A–Ö)'],
      [c => { c.days[1].answer = 'F2'; }, 'dag 2: svaret passar inte koordinatlåset (en ruta inom 5 × 5)'],
      [c => { c.days[0].lock = { type: 'choice', options: ['Norr', 'Söder'] }; c.days[0].answer = 'Väster'; }, 'dag 1: svaret är inte ett av alternativen'],
      [c => { c.days[0].lock = { type: 'choice', options: ['Norr'] }; c.days[0].answer = 'Norr'; }, 'dag 1: vallåset behöver minst två olika alternativ'],
      [c => { c.days[2].requires_items = ['finns-inte']; }, 'dag 3: föremål nr 1 i requires_items ges inte av någon tidigare lucka'],
      [c => { c.days[0].requires_items = ['nyckel12']; }, 'dag 1: föremål nr 1 i requires_items ges inte av någon tidigare lucka'],
      [c => { c.days = c.days.concat(Array.from({ length: 22 }, (_, i) => Object.assign(JSON.parse(JSON.stringify(c.days[1])), { day: i + 4 }))); }, 'antalet dagar är 25, ska vara 1–24'],
      [c => { c.days[1].day = 7; }, 'dag 2: har fel nummer i fältet day'],
      [c => { c.theme.colors.glow = 'yellow'; }, 'theme: färgen glow är ingen #hex-färg'],
      [c => { c.theme.icon = 'pumpkin'; }, 'theme: icon måste vara lantern eller candle'],
      [c => { delete c.id; }, 'id saknas eller har fel format (små bokstäver, siffror och bindestreck)']
    ];
    for (const [mutate, expected] of cases) {
      const c = clone(); mutate(c);
      const errors = checkContent(c);
      assert.ok(errors.includes(expected), 'väntade "' + expected + '", fick ' + JSON.stringify(errors));
      noLeak(clone(), errors);
    }
  });

  test('ett föremål från en senare lucka räknas inte', () => {
    const c = clone();
    c.days[0].requires_items = []; c.days[2].requires_items = [];
    c.days[1].requires_items = ['nyckel12'];
    assert.deepEqual(checkContent(c), []);
    c.days[0].epilogue.item.id = 'annan';
    assert.deepEqual(checkContent(c), ['dag 2: föremål nr 1 i requires_items ges inte av någon tidigare lucka']);
  });

  test('endpointen kräver hemligheten och svarar OK eller felen', async () => {
    const g = await startGame(at('2026-12-01'));
    try {
      assert.equal(await g.postStatus('/admin/check', { secret: 'fel' }), 403);
      const ok = await g.post('/admin/check', { secret: SECRET });
      assert.deepEqual(ok.body, { ok: true, calendar: 'prov', days: 3, message: 'OK' });
    } finally { await g.close(); }
    const c = clone(); delete c.days[3 - 1].fragments.simon; c.days[0].answer = '1';
    const store = memStore(); await store.setPlayers(IDS);
    const game = await createKalender(null, { content: c, store, adminSecret: SECRET, now: () => new Date() });
    const app = express(); app.use(express.json()); app.use('/k', game.router);
    const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
    const r = await (await fetch('http://127.0.0.1:' + server.address().port + '/k/admin/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: SECRET }) })).json();
    assert.deepEqual(r, { ok: false, calendar: 'prov', errors: ['dag 1: svaret passar inte låstypen digits (4 siffror)', 'dag 3: lapp för simon saknas'] });
    await new Promise(res => server.close(res));
  });

  test('utan innehåll säger kontrollen varför, utan att citera filen', () => {
    const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'kalender-check-'));
    const broken = path.join(tmp2, 'sample.json');
    fs.writeFileSync(broken, '{"id": "prov", "hemlig text som inte får synas');
    const w = console.warn, e = console.error; console.warn = console.error = () => {};
    try {
      const res = loadContent({ mode: 'sample', samplePath: broken });
      assert.equal(res.error, 'testinnehållet: kunde inte läsas');
      assert.ok(!res.error.includes('hemlig'));
      assert.equal(loadContent({}).error, 'CONTENT_KEY saknas och KALENDER_CONTENT=sample är inte satt');
    } finally { console.warn = w; console.error = e; fs.rmSync(tmp2, { recursive: true, force: true }); }
  });
});

describe('luckorna öppnas i ordning', () => {
  let g;
  before(async () => { g = await startGame(at('2026-12-02', '10:00')); });
  after(() => g.close());

  test('en lucka vars dag har kommit är låst tills den förra är löst, och avslöjar inget', async () => {
    const r = await g.get('/day/2', IDS.peter);
    assert.equal(r.status, 403);
    assert.deepEqual(r.body, { error: 'locked', reason: 'previous', waitingFor: 1 });
    for (const t of [SAMPLE.days[1].title, SAMPLE.days[1].intro, SAMPLE.days[1].fragments.peter.text]) assert.ok(!r.text.includes(t));
    const s = await g.get('/state', IDS.peter);
    assert.deepEqual(s.body.days[1], { day: 2, status: 'locked', waitingFor: 1 });
    assert.deepEqual(s.body.days[2], { day: 3, status: 'locked' }); // dag 3 är låst av datum
    assert.equal(s.body.openedCount, 1);
    assert.ok(!s.text.includes(SAMPLE.days[1].title));
  });

  test('en låst lucka går inte att ändra', async () => {
    const calls = [
      ['/day/2/fragment', {}], ['/day/2/note', { text: 'hej' }], ['/day/2/hint', { n: 1 }],
      ['/day/2/solve', { answer: SAMPLE.days[1].answer }],
      ['/day/2/photo', { mime: 'image/jpeg', data: Buffer.from([0xFF, 0xD8, 0xFF, 0]).toString('base64') }]
    ];
    for (const [p, body] of calls) {
      const r = await g.post(p, Object.assign({ profile: IDS.peter }, body));
      assert.equal(r.status, 403, p);
      assert.equal(r.body.reason, 'previous', p);
    }
    assert.deepEqual(await g.store.listEvents(), []);
    assert.deepEqual(await g.store.listSolves(), []);
  });

  test('lucka 1 löst i efterhand samma dag som lucka 2 → lucka 2 är dagens lucka och kan lösas med alla fem', async () => {
    let d1 = await g.get('/day/1', IDS.peter);
    assert.equal(d1.body.status, 'archive');
    assert.deepEqual(d1.body.next, { day: 2, open: false });
    const r = await g.post('/day/1/solve', { profile: IDS.peter, answer: SAMPLE.days[0].answer });
    assert.equal(r.body.correct, true);
    assert.deepEqual(r.body.day.next, { day: 2, open: true });
    const d2 = await g.get('/day/2', IDS.peter);
    assert.equal(d2.status, 200);
    assert.equal(d2.body.status, 'today');
    for (const s of Object.keys(IDS)) assert.equal((await g.post('/day/2/fragment', { profile: IDS[s] })).status, 200);
    const solved = await g.post('/day/2/solve', { profile: IDS.sara, answer: SAMPLE.days[1].answer });
    assert.equal(solved.body.day.solved.mode, 'together');
  });

  test('sista luckan har ingen nästa, och nästa är stängd tills dess dag kommer', async () => {
    const d2 = await g.get('/day/2', IDS.peter);
    assert.deepEqual(d2.body.next, { day: 3, open: false }); // dag 3 är 3 december
    g.setNow(at('2026-12-03', '00:01'));
    assert.deepEqual((await g.get('/day/2', IDS.peter)).body.next, { day: 3, open: true });
    await g.store.insertSolve({ day: 3, profileId: IDS.peter, mode: 'archive' });
    assert.equal((await g.get('/day/3', IDS.peter)).body.next, null);
  });

  test('en lucka som öppnas först efter sin dag blir en arkivlucka', async () => {
    const content = JSON.parse(JSON.stringify(SAMPLE));
    const store = memStore(); await store.setPlayers(IDS);
    const game = await createKalender(null, { content, store, adminSecret: SECRET, now: () => at('2026-12-05', '10:00') });
    const app = express(); app.use(express.json()); app.use('/k', game.router);
    const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
    const base = 'http://127.0.0.1:' + server.address().port + '/k';
    try {
      const get = async n => fetch(base + '/day/' + n + '?profile=' + IDS.peter);
      assert.equal((await get(2)).status, 403);
      await store.insertSolve({ day: 1, profileId: IDS.peter, mode: 'archive' });
      const d2 = await (await get(2)).json();
      assert.equal(d2.status, 'archive');
      assert.equal(d2.lockOpen, true);
      assert.equal((await get(3)).status, 403);
    } finally { await new Promise(r => server.close(r)); }
  });
});
