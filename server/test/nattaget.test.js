/* Tester för Nattågets säkerhetsregler (nattaget/SPEC.md, "Vad servern
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
  createNattaget, loadContent, makeNow, memStore, SAMPLE_PATH, normalizeAnswer, computeStars
} from '../nattaget.js';

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
  const game = await createNattaget(null, {
    content: JSON.parse(JSON.stringify(SAMPLE)),
    store, adminSecret: SECRET, now: () => current, listProfiles: async () => PROFILES
  });
  const app = express();
  app.use(express.json({ limit: '8kb' }));
  app.use('/api/nattaget', game.router);
  const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  const base = 'http://127.0.0.1:' + server.address().port + '/api/nattaget';
  const responses = []; // alla svarskroppar, för "svaret läcker aldrig"-kontrollen
  const call = async (method, p, body) => {
    const r = await fetch(base + p, body ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { method });
    const text = await r.text();
    responses.push(text);
    return { status: r.status, body: JSON.parse(text), text };
  };
  const get = (p, profile) => call('GET', p + (p.includes('?') ? '&' : '?') + 'profile=' + encodeURIComponent(profile));
  const post = (p, body) => call('POST', p, body);
  const ev = (day, slot, kind, body, createdAt) => store.insertEvent({ day, profileId: IDS[slot], kind, body, createdAt });
  const r = await post('/admin/players', { secret: SECRET, players: IDS });
  assert.equal(r.status, 200);
  return { server, store, get, post, ev, responses, setNow: d => { current = d; }, close: () => new Promise(r => server.close(r)) };
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
      assert.deepEqual(Object.keys(r.body), ['error']);
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
    for (const slot of Object.keys(IDS)) {
      const s = await g.get('/state', IDS[slot]);
      assert.ok(!hasKeyDeep(s.body, 'answer'));
      for (const n of [1, 2, 3]) {
        const r = await g.get('/day/' + n, IDS[slot]);
        assert.equal(r.status, 200);
        assert.ok(!hasKeyDeep(r.body, 'answer'), 'answer-nyckel i lucka ' + n);
        assert.ok(!hasKeyDeep(r.body, 'solution'), 'solution i olöst lucka ' + n);
        assert.ok(!hasKeyDeep(r.body, 'epilogue') && !hasKeyDeep(r.body, 'story'));
        assert.ok(!r.text.includes(SAMPLE.days[n - 1].epilogue.text));
      }
    }
    // Inget strängvärde i något svar är ett svar. (Nycklar räknas inte:
    // dag 2:s svar är också en ruta i kartlappens cells, och den ska med.)
    const values = g.responses.flatMap(t => stringValues(JSON.parse(t)));
    for (const d of SAMPLE.days) assert.ok(!values.includes(d.answer), 'svaret för lucka ' + d.day + ' läckte');
  });

  test('löst lucka visar epilog och "Så här gick det till", men aldrig answer-nyckeln', async () => {
    await g.store.insertSolve({ day: 1, profileId: IDS.simon, mode: 'archive', solvedAt: at('2026-12-02', '21:48') });
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
  before(async () => { g = await startGame(at('2026-12-03', '10:00')); });
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
    assert.deepEqual(r.body.hints, [{ n: 1, text: hints[0], by: 'sara' }]);
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

  test('admin är avstängt utan NATTAGET_ADMIN_SECRET', async () => {
    const game = await createNattaget(null, { content: SAMPLE, store: memStore(), adminSecret: '', now: () => new Date() });
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

describe('tid', () => {
  test('NATTAGET_FAKE_NOW används lokalt men ignoreras i produktion', () => {
    const fake = '2026-12-05T10:00:00+01:00';
    assert.equal(makeNow({ fakeNow: fake, nodeEnv: 'development' })().toISOString(), new Date(fake).toISOString());
    const real = makeNow({ fakeNow: fake, nodeEnv: 'production' })();
    assert.ok(Math.abs(real - Date.now()) < 5000);
  });
});

describe('innehållsladdning', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nattaget-'));
  const key = crypto.randomBytes(32).toString('base64');
  const encPath = path.join(tmp, 'content.enc');
  before(() => {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', Buffer.from(key, 'base64'), iv);
    const data = Buffer.concat([c.update(JSON.stringify(SAMPLE), 'utf8'), c.final()]);
    fs.writeFileSync(encPath, JSON.stringify({ v: 1, alg: 'aes-256-gcm', iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') }));
  });
  after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  test('testinnehåll när CONTENT_KEY saknas eller NATTAGET_CONTENT=sample', () => {
    assert.equal(loadContent({ key: '' }).source, 'sample');
    assert.equal(loadContent({ mode: 'sample', key, encPath }).source, 'sample');
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
    assert.deepEqual(logged, ['Nattåget: kunde inte dekryptera innehållet.']);
  });

  test('utan innehåll svarar spelet 503', async () => {
    const game = await createNattaget(null, { content: null, store: memStore(), adminSecret: SECRET, now: () => new Date() });
    const app = express(); app.use('/n', game.router);
    const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
    const r = await fetch('http://127.0.0.1:' + server.address().port + '/n/state?profile=' + IDS.peter);
    assert.equal(r.status, 503);
    await new Promise(r => server.close(r));
  });
});

test('normalisering av svar', () => {
  assert.equal(normalizeAnswer({ type: 'digits' }, ' 9 1-37 '), '9137');
  assert.equal(normalizeAnswer({ type: 'word' }, 'ly kta'), 'LYKTA');
  assert.equal(normalizeAnswer({ type: 'coordinate' }, 'c5'), 'C5');
  assert.equal(normalizeAnswer({ type: 'choice' }, 'Norr'), 'Norr');
});
