/* Tester för verktygen: föremål med innehåll (B1), genomskinligt kort
   (B2), lås i flera steg (B5), symbollås (B6), rutlås (B7), hemlig del
   (B3), återkoppling (B8) och gissningsskyddet. Körs mot testkalendern
   server/kalender/sample-verktyg.json. Kör: cd server && npm test */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import express from 'express';
import {
  createKalender, memStore, CONTENT_DIR, normalizeAnswer, answerSpace, teamAttemptLimit,
  attemptFeedback, checkContent, loadContent
} from '../kalender.js';

const V = JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, 'sample-verktyg.json'), 'utf8'));
const SECRET = 'testhemlighet';
const IDS = { peter: 'pPeter01', maria: 'pMaria01', sara: 'pSara001', vilma: 'pVilma01', simon: 'pSimon01' };
const at = (date, time = '08:00') => new Date(date + 'T' + time + ':00+01:00');

async function startGame(nowDate, content = V) {
  let current = nowDate;
  const store = memStore(content.id);
  await store.setPlayers(IDS);
  const game = await createKalender(null, { content: JSON.parse(JSON.stringify(content)), store, adminSecret: SECRET, now: () => current, listProfiles: async () => [] });
  const app = express(); app.use(express.json()); app.use('/k', game.router);
  const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  const base = 'http://127.0.0.1:' + server.address().port + '/k';
  const call = async (method, p, body) => {
    const r = await fetch(base + p, body ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { method });
    const text = await r.text();
    return { status: r.status, body: JSON.parse(text), text };
  };
  return {
    store, setNow: d => { current = d; },
    get: (p, slot = 'peter') => call('GET', p + '?profile=' + IDS[slot]),
    post: (p, slot, body = {}) => call('POST', p, Object.assign({ profile: IDS[slot] }, body)),
    lightAll: async n => { for (const s of Object.keys(IDS)) await call('POST', '/day/' + n + '/fragment', { profile: IDS[s] }); },
    close: () => new Promise(r => server.close(r))
  };
}

test('testkalendern är OK och laddas med KALENDER_CONTENT=sample-verktyg', () => {
  assert.deepEqual(checkContent(V), []);
  const r = loadContent({ mode: 'sample-verktyg' });
  assert.equal(r.content.id, 'prov-verktyg');
  const w = console.warn; console.warn = () => {};
  try { assert.equal(loadContent({ mode: 'sample-../hemligt' }).content, null); } finally { console.warn = w; }
});

describe('B3 hemlig del och B8 återkoppling (lucka 1)', () => {
  let g;
  before(async () => { g = await startGame(at('2026-12-01', '09:00')); });
  after(() => g.close());

  test('den hemliga delen syns bara för ägaren, även när lappen ligger ute', async () => {
    const priv = V.days[0].fragments.peter.private.text;
    const own = await g.get('/day/1', 'peter');
    assert.equal(own.body.fragments.peter.private.text, priv);
    await g.post('/day/1/fragment', 'peter');
    const other = await g.get('/day/1', 'maria');
    assert.equal(other.body.fragments.peter.posted, true);
    assert.equal(other.body.fragments.peter.private, undefined);
    assert.ok(!other.text.includes(priv));
  });

  test('felförsök får återkoppling på tavlan', async () => {
    await g.lightAll(1);
    const r = await g.post('/day/1/solve', 'sara', { answer: '2486' });
    assert.equal(r.body.correct, false);
    const a = r.body.day.board.find(b => b.kind === 'attempt');
    assert.deepEqual(a.feedback, { exact: 2, near: 2 });
    assert.equal(r.body.day.lock.feedback, true);
  });

  test('i arkivläge och när luckan är löst ser alla den hemliga delen', async () => {
    const r = await g.post('/day/1/solve', 'vilma', { answer: '2468' });
    assert.equal(r.body.correct, true);
    assert.equal((await g.get('/day/1', 'maria')).body.fragments.peter.private.text, V.days[0].fragments.peter.private.text);
  });
});

describe('B1 ryggsäcken och B5 två lås (lucka 2)', () => {
  let g;
  before(async () => {
    g = await startGame(at('2026-12-02', '09:00'));
    await g.store.insertSolve({ day: 1, profileId: IDS.peter, mode: 'together' });
  });
  after(() => g.close());

  test('föremålet följer med i ryggsäcken, med sitt innehåll', async () => {
    const d = await g.get('/day/2');
    assert.deepEqual(d.body.backpack.map(i => i.id), ['signaltabell']);
    assert.equal(d.body.backpack[0].content.svg, V.days[0].epilogue.item.content.svg);
    assert.equal((await g.get('/state')).body.items[0].content.svg, V.days[0].epilogue.item.content.svg);
  });

  test('det första låset gäller först; mellanspel och nästa lås syns inte än', async () => {
    const d = await g.get('/day/2');
    assert.deepEqual(d.body.stage, { index: 1, total: 2 });
    assert.equal(d.body.lock.type, 'word');
    assert.deepEqual(d.body.interludes, []);
    assert.ok(!d.text.includes(V.days[1].stages[0].after.text));
    assert.ok(!d.text.includes('"palette"'));
  });

  test('rätt svar på det första låset visar mellanspelet och öppnar det andra', async () => {
    await g.lightAll(2);
    const wrong = await g.post('/day/2/solve', 'maria', { answer: 'LAMPA' });
    assert.equal(wrong.body.correct, false);
    assert.equal(wrong.body.day.board.find(b => b.kind === 'attempt').stage, 1);
    const r = await g.post('/day/2/solve', 'sara', { answer: 'larma' });
    assert.equal(r.body.correct, true);
    assert.equal(r.body.stage, 1);
    const d = r.body.day;
    assert.equal(d.status, 'today');
    assert.deepEqual(d.stage, { index: 2, total: 2 });
    assert.equal(d.lock.type, 'sequence');
    assert.deepEqual(d.lock.palette.map(p => p.id), ['rod', 'gron', 'bla', 'gul']);
    assert.equal(d.interludes.length, 1);
    assert.equal(d.interludes[0].solution, 'LARMA');
    assert.equal(d.interludes[0].text, V.days[1].stages[0].after.text);
    assert.ok(d.interludes[0].svg.startsWith('<svg'));
    assert.equal(d.solution, undefined);
    assert.ok(!r.text.includes('rod,gul,gron,bla'));
  });

  test('ett gammalt svar på det första låset räknas som fel på det andra', async () => {
    const r = await g.post('/day/2/solve', 'peter', { answer: 'LARMA' });
    assert.equal(r.body.correct, false);
    assert.equal(r.body.day.stage.index, 2);
  });

  test('symbollåset: rätt ordning löser luckan, och den lösta vyn visar båda svaren', async () => {
    const r = await g.post('/day/2/solve', 'simon', { answer: 'rod, gul, gron, bla' });
    assert.equal(r.body.correct, true);
    const d = r.body.day;
    assert.equal(d.status, 'solved');
    assert.equal(d.solved.mode, 'together');
    assert.deepEqual(d.solutions, ['LARMA', 'rod,gul,gron,bla']);
    assert.equal(d.solution, 'rod,gul,gron,bla');
    assert.ok(d.story.includes('Sara öppnade det första låset.') || d.story.some(l => l.endsWith('öppnade det första låset.')));
    assert.ok(d.story.some(l => l.endsWith('öppnade det sista låset.')));
    assert.ok(d.board.some(b => b.kind === 'stage' && b.stage === 1));
  });

  test('B2: kortet hamnar i ryggsäcken som genomskinligt', async () => {
    const d = await g.get('/day/2');
    const kort = d.body.backpack.find(i => i.id === 'kortet');
    assert.equal(kort.content.overlay, true);
    assert.ok(kort.content.svg.startsWith('<svg'));
  });
});

describe('två som löser samma steg samtidigt', () => {
  test('mellansteget registreras bara en gång', async () => {
    const g = await startGame(at('2026-12-02', '09:00'));
    try {
      await g.store.insertSolve({ day: 1, profileId: IDS.peter, mode: 'together' });
      await g.lightAll(2);
      const [a, b] = await Promise.all([g.post('/day/2/solve', 'peter', { answer: 'LARMA', stage: 1 }), g.post('/day/2/solve', 'maria', { answer: 'LARMA', stage: 1 })]);
      // Den ena öppnar låset; den andra får "redan öppnat" eller rätt — aldrig ett felförsök.
      for (const r of [a, b]) assert.ok(r.body.correct === true || r.body.error === 'stage_already_open', JSON.stringify(r.body).slice(0, 80));
      const events = await g.store.listEvents();
      assert.equal(events.filter(e => e.kind === 'stage').length, 1);
      assert.equal(events.filter(e => e.kind === 'attempt').length, 0);
      assert.equal((await g.get('/day/2')).body.stage.index, 2);
    } finally { await g.close(); }
  });
});

describe('B7 rutlås (lucka 4) och gissningsskyddet', () => {
  let g;
  before(async () => {
    g = await startGame(at('2026-12-04', '09:00'));
    for (const day of [1, 2, 3]) await g.store.insertSolve({ day, profileId: IDS.peter, mode: 'archive' });
  });
  after(() => g.close());

  test('rutorna kan anges i valfri ordning', async () => {
    await g.lightAll(4);
    const r = await g.post('/day/4/solve', 'peter', { answer: 'e3 b2 d5' });
    assert.equal(r.body.correct, true);
  });

  test('normalisering av sekvens, rutor och väg', () => {
    assert.equal(normalizeAnswer({ type: 'sequence' }, ' Rod ; gul,gron  bla'), 'rod,gul,gron,bla');
    assert.equal(normalizeAnswer({ type: 'cells' }, 'd5, b2 E3 b2'), 'B2 D5 E3');
    assert.equal(normalizeAnswer({ type: 'path' }, 'a1 A2 b2'), 'A1 A2 B2');
    assert.notEqual(normalizeAnswer({ type: 'path' }, 'B2 A2 A1'), 'A1 A2 B2');
  });

  test('antal möjliga svar och lagets försök per dag', () => {
    assert.equal(answerSpace({ type: 'digits', length: 4 }), 10000);
    assert.equal(answerSpace({ type: 'coordinate', cols: 9, rows: 9 }), 81);
    assert.equal(answerSpace({ type: 'cells', cols: 6, rows: 6, count: 3 }), 7140);
    assert.equal(answerSpace({ type: 'sequence', length: 4, repeat: false, palette: [1, 2, 3, 4] }), 24);
    assert.equal(teamAttemptLimit({ type: 'digits', length: 4 }), 50);
    assert.equal(teamAttemptLimit({ type: 'coordinate', cols: 9, rows: 9 }), 20);
    assert.equal(teamAttemptLimit({ type: 'coordinate', cols: 5, rows: 5 }), 6);
    assert.equal(teamAttemptLimit({ type: 'choice', options: ['a', 'b', 'c', 'd'] }), 1);
    assert.equal(teamAttemptLimit({ type: 'digits', length: 4, max_attempts: 5 }), 5);
  });

  test('återkopplingen räknar rätt plats och fel plats', () => {
    assert.deepEqual(attemptFeedback('2468', '2468'), { exact: 4, near: 0 });
    assert.deepEqual(attemptFeedback('2468', '8642'), { exact: 0, near: 4 });
    assert.deepEqual(attemptFeedback('LARMA', 'AAAAA'), { exact: 2, near: 0 });
  });
});

describe('lagets gräns gäller per dag, och luckan kan aldrig låsas för gott', () => {
  test('ett koordinatlås på 5 × 5 ger laget 6 försök om dagen', async () => {
    const c = JSON.parse(JSON.stringify(V));
    c.days = [Object.assign(JSON.parse(JSON.stringify(V.days[0])), { lock: { type: 'coordinate', cols: 5, rows: 5 }, answer: 'C3' })];
    delete c.days[0].fragments.peter.private;
    const g = await startGame(at('2026-12-01', '09:00'), c);
    try {
      await g.lightAll(1);
      const wrong = ['A1', 'A2', 'A3', 'A4', 'A5', 'B1'];
      const slots = Object.keys(IDS);
      for (let i = 0; i < wrong.length; i++) assert.equal((await g.post('/day/1/solve', slots[i % 5], { answer: wrong[i] })).body.correct, false);
      const stop = await g.post('/day/1/solve', 'vilma', { answer: 'C3' });
      assert.equal(stop.status, 429);
      assert.equal(stop.body.team, true);
      assert.equal((await g.get('/day/1')).body.teamAttemptsLeft, 0);
      // Nästa dag (arkiv) räknas försöken om.
      g.setNow(at('2026-12-02', '09:00'));
      const next = await g.get('/day/1');
      assert.equal(next.body.teamAttemptsLeft, 6);
      assert.equal((await g.post('/day/1/solve', 'vilma', { answer: 'C3' })).body.correct, true);
    } finally { await g.close(); }
  });
});

describe('/admin/check känner igen de nya formerna', () => {
  const clone = () => JSON.parse(JSON.stringify(V));
  test('fel i steg, symboler, rutor, föremål och hemlig del hittas utan innehåll', () => {
    const cases = [
      [c => { c.days[1].stages = [c.days[1].stages[0]]; }, 'dag 2: stages ska vara en lista med minst två lås'],
      [c => { c.days[1].stages[1].answer = 'rod,rod,gul,bla'; }, 'dag 2, lås 2: svaret upprepar en symbol fast repeat är false'],
      [c => { c.days[1].stages[1].answer = 'rod,lila,gul,bla'; }, 'dag 2, lås 2: svaret passar inte symbollåset (4 symboler ur paletten)'],
      [c => { c.days[1].stages[1].lock.palette[0].id = 'gul'; }, 'dag 2, lås 2: symbollåset behöver minst två symboler med unika id (a–z, 0–9, -)'],
      [c => { c.days[3].answer = 'B2 D5'; }, 'dag 4: svaret passar inte låset cells (3 rutor inom 6 × 6)'],
      [c => { c.days[3].answer = 'B2 D5 G3'; }, 'dag 4: svaret passar inte låset cells (3 rutor inom 6 × 6)'],
      [c => { c.days[3].lock.count = 0; }, 'dag 4: låset cells behöver count (antal rutor)'],
      [c => { c.days[1].epilogue.item.content = { text: 'x', overlay: true }; }, 'dag 2: ett genomskinligt föremål (overlay) behöver en svg'],
      [c => { c.days[0].fragments.peter.private = { svg: 'inte svg' }; }, 'dag 1: lapp för peter: den hemliga delen behöver text eller en giltig svg'],
      [c => { c.days[2].lock.feedback = true; c.days[2].lock.type = 'coordinate'; c.days[2].lock.cols = 9; c.days[2].lock.rows = 9; c.days[2].answer = 'A1'; }, 'dag 3: feedback finns bara för digits och word'],
      [c => { c.days[0].lock = { type: 'choice', options: ['Ja', 'Nej'] }; c.days[0].answer = 'Ja'; }, 'dag 1: låset har färre än fyra möjliga svar och är lätt att gissa']
    ];
    for (const [mutate, expected] of cases) {
      const c = clone(); mutate(c);
      const errors = checkContent(c);
      assert.ok(errors.includes(expected), 'väntade "' + expected + '", fick ' + JSON.stringify(errors));
      for (const e of errors) for (const secret of ['LARMA', '31415', '2468', 'B2 D5 E3', V.days[0].fragments.peter.private.text]) assert.ok(!e.includes(secret), e);
    }
  });
});
