/* Tester för skrivverktygen: npm run kontroll och npm run kryptera.
   Körs mot testinnehållet med en slumpad nyckel. */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { CONTENT_DIR, loadContent } from '../kalender.js';

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const V = JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, 'sample-verktyg.json'), 'utf8'));
const run = (tool, args, env = {}) => spawnSync(process.execPath, [path.join(SERVER, 'tools', tool), ...args], { encoding: 'utf8', env: Object.assign({}, process.env, { CONTENT_KEY: '' }, env) });
// Texter ur innehållet som aldrig får synas i verktygens utskrift.
const SECRETS = ['LARMA', '31415', '2468', 'KARTA', 'B2 D5 E3', 'Signaltabellen', 'Hela kartan', V.days[0].fragments.peter.private.text, V.days[1].title];

describe('skrivverktygen', () => {
  let tmp;
  before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kalender-verktyg-')); });
  after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const write = (name, value) => { const f = path.join(tmp, name); fs.writeFileSync(f, typeof value === 'string' ? value : JSON.stringify(value)); return f; };
  const noSecrets = out => { for (const s of SECRETS) assert.ok(!out.includes(s), 'utskriften innehåller "' + s + '"'); };

  test('kontroll: OK och en översikt utan innehåll', () => {
    const r = run('kalender-kontroll.js', [write('ok.json', V)]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Kalender: prov-verktyg · 7 luckor/);
    assert.match(r.stdout, /dag 2: word \(5 bokstäver, laget 50 försök\/dag\) → sequence/);
    assert.match(r.stdout, /\nOK\n$/);
    noSecrets(r.stdout + r.stderr);
  });

  test('kontroll: fel listas utan innehåll, och avslutas med felkod', () => {
    const c = JSON.parse(JSON.stringify(V));
    delete c.days[3].fragments.simon;
    c.days[0].answer = '12';
    const r = run('kalender-kontroll.js', [write('fel.json', c)]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /dag 4: lapp för simon saknas/);
    assert.match(r.stdout, /dag 1: svaret passar inte låstypen digits/);
    noSecrets(r.stdout + r.stderr);
  });

  test('kontroll: trasig JSON anges med rad och kolumn, utan att citera filen', () => {
    const r = run('kalender-kontroll.js', [write('trasig.json', '{\n  "id": "jul-2026",\n  "title": "Hemlig titel" "x"\n}')]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Ogiltig JSON nära rad 3/);
    assert.ok(!r.stderr.includes('Hemlig'));
  });

  test('kryptera: kräver en giltig nyckel', () => {
    const r = run('kalender-kryptera.js', [write('ok2.json', V)]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /CONTENT_KEY saknas/);
  });

  test('kryptera: vägrar om kontrollen hittar fel', () => {
    const c = JSON.parse(JSON.stringify(V)); c.days[0].hints.pop();
    const key = crypto.randomBytes(32).toString('base64');
    const r = run('kalender-kryptera.js', [write('fel2.json', c)], { CONTENT_KEY: key });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Inget krypterades/);
    assert.ok(!fs.existsSync(path.join(tmp, 'prov-verktyg.enc')));
  });

  test('kryptera: skriver <id>.enc som servern kan läsa, utan att visa innehåll eller nyckel', () => {
    const key = crypto.randomBytes(32).toString('base64');
    const r = run('kalender-kryptera.js', [write('ok3.json', V)], { CONTENT_KEY: key });
    assert.equal(r.status, 0, r.stderr);
    const out = path.join(tmp, 'prov-verktyg.enc');
    assert.ok(fs.existsSync(out));
    assert.match(r.stdout, /Dekrypterad och jämförd: OK/);
    assert.ok(!r.stdout.includes(key));
    noSecrets(r.stdout + r.stderr);
    const raw = fs.readFileSync(out, 'utf8');
    for (const s of SECRETS) assert.ok(!raw.includes(s), 'klartext i .enc-filen');
    const w = console.warn; console.warn = () => {};
    try {
      const loaded = loadContent({ key, active: 'prov-verktyg', encPath: out });
      assert.equal(loaded.source, 'encrypted');
      assert.deepEqual(loaded.content, V);
    } finally { console.warn = w; }
  });

  test('kryptera --ny-nyckel ger en giltig nyckel', () => {
    const r = run('kalender-kryptera.js', ['--ny-nyckel']);
    assert.equal(r.status, 0);
    assert.equal(Buffer.from(r.stdout.trim(), 'base64').length, 32);
  });
});
