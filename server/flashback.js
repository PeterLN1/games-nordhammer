/* ============================================================
   Flashback — veckovis tidslinje-pussel (Nordhammer Spel)

   AI-genererat en gång per vecka (natt till måndag, Europe/Stockholm):
   8 historiska händelser, varav en ankare (årtal synligt från start).
   Spelaren placerar de återstående 7 i rätt lucka på tidslinjen. Samma
   pussel för alla — se flashback/index.html. Topplistan återanvänder
   den generiska scores-tabellen i index.js (mode 'flashback', seed
   'flashback:<vecko-id>'), precis som Ordlek gör per dag.
   ============================================================ */
import express from 'express';
import cron from 'node-cron';

const EVENT_COUNT = 8; // 1 ankare + 7 att placera
const AVOID_REPEAT_WEEKS = 26; // ~ ett halvår bakåt, se buildPrompt()
const MODEL = 'claude-sonnet-5';

const WEEK_FMT = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' });
function stockholmDateStr(date = new Date()) { return WEEK_FMT.format(date); }

// ISO 8601-veckonummer (torsdags-regeln), räknat på ett 'YYYY-MM-DD'-datum.
function isoWeekId(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = (d.getUTCDay() + 6) % 7; // 0=mån .. 6=sön
  d.setUTCDate(d.getUTCDate() - day + 3); // torsdag i samma vecka
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const fDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - fDay + 3);
  const week = 1 + Math.round((d - firstThursday) / (7 * 86400000));
  return d.getUTCFullYear() + '-W' + String(week).padStart(2, '0');
}
function currentWeekId(date = new Date()) { return isoWeekId(stockholmDateStr(date)); }

// Reservpussel ifall AI-anropet misslyckas (efter en retry) och veckan
// annars skulle stå helt utan pussel. Bara en krockkudde — tänkt att
// användas i undantagsfall, inte som återkommande innehåll.
const FALLBACK_EVENTS = [
  { description: 'Regalskeppet Vasa kantrar och sjunker på sin jungfrufärd i Stockholms hamn, mindre än en kilometer från kaj. Skeppet låg kvar på botten i 333 år innan det bärgades 1961.', year: 1628, isAnchor: true },
  { description: 'Allmän och lika rösträtt för kvinnor och män införs i Sverige. Det dröjer ändå till valet 1921 innan reformen faktiskt används första gången.', year: 1919, isAnchor: false },
  { description: 'Astrid Lindgrens första bok om Pippi Långstrump ges ut, efter att ha skrivits ner som julklapp till dottern Karin några år tidigare.', year: 1945, isAnchor: false },
  { description: 'Sverige byter från vänster- till högertrafik på natten till "Dagen H". Hela landets vägmärken och busshållplatser hade förberetts i hemlighet under lång tid.', year: 1967, isAnchor: false },
  { description: 'Berlinmuren faller sedan en östtysk tjänsteman av misstag meddelar att nya reseregler gäller "omedelbart, utan dröjsmål" på en pressträff.', year: 1989, isAnchor: false },
  { description: 'ABBA vinner Eurovision Song Contest med låten "Waterloo" och blir samtidigt gruppens internationella genombrott över en natt.', year: 1974, isAnchor: false },
  { description: 'Sverige tar VM-brons i fotboll på hemmaplan efter att ha slagit Bulgarien i bronsmatchen — landets bästa VM-resultat sedan finalen 1958.', year: 1994, isAnchor: false },
  { description: 'Spotify grundas i Stockholm av Daniel Ek och Martin Lorentzon, som ett svar på den utbredda musikpirat­kopieringen.', year: 2006, isAnchor: false }
];

function validateEvents(events) {
  if (!Array.isArray(events) || events.length !== EVENT_COUNT) return false;
  const years = new Set();
  let anchors = 0;
  const thisYear = new Date().getFullYear();
  for (const e of events) {
    if (!e || typeof e.description !== 'string') return false;
    const len = e.description.trim().length;
    if (len < 40 || len > 400) return false;
    if (!Number.isInteger(e.year) || e.year < 1000 || e.year > thisYear) return false;
    if (years.has(e.year)) return false;
    years.add(e.year);
    if (e.isAnchor) anchors++;
  }
  return anchors === 1;
}

function buildPrompt(excluded) {
  const excludeList = excluded.length
    ? '\n\nAnvänd INTE någon av dessa händelser igen (redan använda de senaste ' + AVOID_REPEAT_WEEKS + ' veckorna):\n' +
      excluded.map(e => '- ' + e.description + ' (' + e.year + ')').join('\n')
    : '';
  return `Du skapar ett veckopussel för ett svenskt familjespel som heter "Flashback" (ett tidslinjepussel, inte quiz).

Ge mig exakt ${EVENT_COUNT} historiska händelser som en svensk familj (blandade åldrar, från barn till mor-/farföräldrar) rimligen känner till eller kan resonera sig fram till. Blanda kategorier: svensk och världshistoria, sport, politik, populärkultur, teknik/vetenskap. Sprid årtalen brett (inte allt klumpat inom samma decennium) så att pusslet blir lagom svårt.

Varje "description" ska vara 2 meningar på svenska, ca 100–220 tecken: första meningen är själva huvudhändelsen (kort och tydlig), andra meningen en konkret, gärna lite kuriosaartad eller underhållande detalj eller följd av händelsen — inte bara en omskrivning. Undvik torra uppslagsverks-formuleringar; skriv som en intresseväckande liten historia. Nämn INTE årtalet i själva texten (det visas separat).

Exakt en händelse ska märkas "isAnchor": true — den ska vara särskilt allmänt känd, bra som startankare. Övriga 7 ska ha "isAnchor": false.

Alla årtal måste vara unika heltal mellan 1000 och ${new Date().getFullYear()}.
${excludeList}

Svara ENDAST med giltig JSON, inget annat, i exakt detta format:
{"title": "kort svensk rubrik för veckans tema", "events": [{"description": "...", "year": 1234, "isAnchor": true}, ...]}`;
}

async function callAnthropic(apiKey, prompt) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2500,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!resp.ok) throw new Error('Anthropic API svarade ' + resp.status + ': ' + (await resp.text()).slice(0, 300));
  const data = await resp.json();
  const text = (data.content || []).map(b => b.text || '').join('');
  const jsonStr = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  return JSON.parse(jsonStr);
}

async function generatePuzzle(apiKey, excluded) {
  const prompt = buildPrompt(excluded);
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const parsed = await callAnthropic(apiKey, prompt);
      if (validateEvents(parsed.events)) {
        return { title: String(parsed.title || 'Veckans Flashback').slice(0, 80), events: parsed.events };
      }
      console.error('Flashback: AI-svaret klarade inte valideringen (försök ' + attempt + ').');
    } catch (e) {
      console.error('Flashback: fel vid AI-generering (försök ' + attempt + '):', e.message);
    }
  }
  return null;
}

// Ordningen på de 7 icke-ankarhändelserna i events-arrayen ÄR den ordning
// klienten visar dem i (samma pussel för alla, se flashback/index.html) —
// så den måste blandas här, annars serveras de i den ordning modellen
// råkade lista dem (ofta kronologisk, vilket gör pusslet trivialt).
// Ankarets position i arrayen spelar ingen roll (klienten hittar den via
// isAnchor), så bara icke-ankare blandas.
function shuffleQueueOrder(events) {
  const anchor = events.find(e => e.isAnchor);
  const rest = events.filter(e => !e.isAnchor);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return [anchor, ...rest];
}

function assignIds(events) {
  return shuffleQueueOrder(events).map((e, i) => ({ id: i + 1, description: e.description, year: e.year, isAnchor: !!e.isAnchor }));
}

/* ---------- Lagring ---------- */
async function initSchema(pool) {
  await pool.query(`
    create table if not exists flashback_puzzles (
      week_id text primary key,
      title text not null,
      events jsonb not null,
      created_at timestamptz not null default now()
    );`);
  await pool.query(`alter table flashback_puzzles enable row level security;`);
  await pool.query(`
    create table if not exists flashback_used_events (
      id bigserial primary key,
      week_id text not null,
      description text not null,
      year integer not null,
      created_at timestamptz not null default now()
    );`);
  await pool.query(`alter table flashback_used_events enable row level security;`);
  await pool.query(`create index if not exists flashback_used_events_created_idx on flashback_used_events (created_at);`);
}

function pgStore(pool) {
  return {
    async getPuzzle(weekId) {
      const r = await pool.query('select week_id, title, events from flashback_puzzles where week_id = $1', [weekId]);
      return r.rows[0] || null;
    },
    async savePuzzle(weekId, title, events, { overwrite = false } = {}) {
      await pool.query(
        `insert into flashback_puzzles (week_id, title, events) values ($1,$2,$3)
         on conflict (week_id) do ${overwrite ? 'update set title = excluded.title, events = excluded.events, created_at = now()' : 'nothing'}`,
        [weekId, title, JSON.stringify(events)]
      );
      for (const e of events) {
        await pool.query('insert into flashback_used_events (week_id, description, year) values ($1,$2,$3)', [weekId, e.description, e.year]);
      }
    },
    async recentlyUsed(weeks) {
      const r = await pool.query(
        `select description, year from flashback_used_events where created_at > now() - ($1 || ' weeks')::interval`,
        [String(weeks)]
      );
      return r.rows;
    }
  };
}

function memStore() {
  const puzzles = new Map();
  const used = [];
  return {
    async getPuzzle(weekId) { return puzzles.get(weekId) || null; },
    async savePuzzle(weekId, title, events, { overwrite = false } = {}) {
      if (puzzles.has(weekId) && !overwrite) return;
      puzzles.set(weekId, { week_id: weekId, title, events });
      const now = Date.now();
      events.forEach(e => used.push({ description: e.description, year: e.year, createdAt: now }));
    },
    async recentlyUsed(weeks) {
      const cutoff = Date.now() - weeks * 7 * 86400000;
      return used.filter(u => u.createdAt > cutoff);
    }
  };
}

/* ---------- Uppstart ---------- */
async function ensureWeekPuzzle(store, apiKey, weekId) {
  const existing = await store.getPuzzle(weekId);
  if (existing) return existing;
  if (!apiKey) {
    console.warn('Flashback: ANTHROPIC_API_KEY saknas — kan inte generera nya pussel.');
    return null;
  }
  const excluded = await store.recentlyUsed(AVOID_REPEAT_WEEKS);
  let generated = await generatePuzzle(apiKey, excluded);
  if (!generated) {
    console.error('Flashback: AI-generering misslyckades för vecka ' + weekId + ' — använder reservpussel.');
    generated = { title: 'Veckans Flashback', events: FALLBACK_EVENTS };
  }
  const events = assignIds(generated.events);
  await store.savePuzzle(weekId, generated.title, events);
  return { week_id: weekId, title: generated.title, events };
}

function createFlashbackRouter(store, apiKey, generateSecret) {
  const router = express.Router();

  router.get('/puzzle', async (req, res) => {
    const weekRaw = req.query.week;
    const weekId = (typeof weekRaw === 'string' && /^\d{4}-W\d{2}$/.test(weekRaw)) ? weekRaw : currentWeekId();
    try {
      let puzzle = await store.getPuzzle(weekId);
      // Innevarande vecka saknar pussel (t.ex. servern startade om strax
      // innan cronen hann köra) — generera nu istället för att visa ett
      // tomt spel. Äldre veckor genereras aldrig i efterhand.
      if (!puzzle && weekId === currentWeekId()) puzzle = await ensureWeekPuzzle(store, apiKey, weekId);
      if (!puzzle) return res.status(404).json({ error: 'inget pussel för den veckan' });
      res.json(puzzle);
    } catch (e) { console.error(e); res.status(500).json({ error: 'databasfel' }); }
  });

  // Manuell trigger för drift/test — skyddad av hemlig header, samma
  // mönster som Ghost Trains /resolve. force skriver över en redan
  // publicerad veckas pussel (t.ex. om AI-svaret blev konstigt).
  router.post('/generate', async (req, res) => {
    if (generateSecret && req.headers['x-generate-secret'] !== generateSecret) {
      return res.status(403).json({ error: 'saknar behorighet' });
    }
    const b = req.body || {};
    const weekId = (typeof b.week === 'string' && /^\d{4}-W\d{2}$/.test(b.week)) ? b.week : currentWeekId();
    const force = b.force === true;
    try {
      if (force) {
        const excluded = await store.recentlyUsed(AVOID_REPEAT_WEEKS);
        const generated = await generatePuzzle(apiKey, excluded);
        if (!generated) return res.status(502).json({ error: 'AI-generering misslyckades' });
        const events = assignIds(generated.events);
        await store.savePuzzle(weekId, generated.title, events, { overwrite: true });
        return res.json({ ok: true, week_id: weekId, title: generated.title, events });
      }
      const puzzle = await ensureWeekPuzzle(store, apiKey, weekId);
      if (!puzzle) return res.status(502).json({ error: 'kunde inte generera pussel' });
      res.json({ ok: true, ...puzzle });
    } catch (e) { console.error(e); res.status(500).json({ error: 'databasfel' }); }
  });

  return router;
}

export async function createFlashback(pool, { anthropicApiKey, generateSecret } = {}) {
  let usablePool = pool;
  if (usablePool) {
    try { await initSchema(usablePool); }
    catch (e) {
      console.error('Flashback: kunde inte initiera schema (kor i minneslage for detta spel):', e.message);
      usablePool = null;
    }
  }
  const store = usablePool ? pgStore(usablePool) : memStore();
  const router = createFlashbackRouter(store, anthropicApiKey, generateSecret);

  // Måndag 00:05 Europe/Stockholm — några minuter efter midnatt så att
  // veckoidentiteten hunnit växla. Idempotent: gör inget om veckans
  // pussel redan finns (t.ex. skapat manuellt eller av ett tidigare
  // cron-varv efter en omstart).
  cron.schedule('5 0 * * 1', async () => {
    const weekId = currentWeekId();
    try {
      const existing = await store.getPuzzle(weekId);
      if (existing) return;
      await ensureWeekPuzzle(store, anthropicApiKey, weekId);
      console.log('Flashback: genererade pussel för vecka', weekId);
    } catch (e) { console.error('Flashback: fel vid veckogenerering:', e); }
  }, { timezone: 'Europe/Stockholm' });

  return { router };
}
