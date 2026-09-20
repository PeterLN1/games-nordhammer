/* ============================================================
   Flashback — veckovis tidslinje-pussel (Nordhammer Spel)

   AI-genererat en gång per vecka (natt till måndag, Europe/Stockholm):
   8 historiska händelser, varav en ankare (årtal synligt från start).
   Spelaren placerar de återstående 7 i rätt lucka på tidslinjen. Samma
   pussel för alla — se flashback/index.html.

   Två VARIANTER genereras varje vecka (samma mekanik, olika
   innehållspool): "standard" (hela familjen, brett) och "remix"
   (anpassad för en 15-åring — högstadiets historieundervisning +
   digital/ungdomskultur). De är helt separata pussel och topplistor,
   inte olika svårighetsgrader av samma pussel. Topplistan återanvänder
   den generiska scores-tabellen i index.js (mode 'flashback', seed
   'flashback:<variant>:<vecko-id>'), precis som Ordlek gör per dag.
   ============================================================ */
import express from 'express';
import cron from 'node-cron';

const EVENT_COUNT = 8; // 1 ankare + 7 att placera
const AVOID_REPEAT_WEEKS = 26; // ~ ett halvår bakåt, se buildPrompt()
const MODEL = 'claude-sonnet-5';

const VARIANTS = {
  standard: {
    focus: `Blanda kategorier brett: svensk och världshistoria, sport, politik, populärkultur, teknik/vetenskap, från alla tidsepoker. Målgrupp: hela familjen, blandade åldrar från barn till mor-/farföräldrar — händelser de rimligen känner till eller kan resonera sig fram till.`
  },
  remix: {
    focus: `Målgruppen är en 15-åring i högstadiet (åk 7–9), så anpassa innehållet efter det:
- Historiska händelser: fokusera på perioden som täcks av högstadiets historieundervisning — franska revolutionen, industriella revolutionen, imperialism, första och andra världskriget, kalla kriget, och tiden fram till idag. Undvik forntid/medeltid, det hör till tidigare årskurser.
- Digital- och ungdomskultur: 3–4 av de 8 händelserna ska vara sånt en 15-åring känner igen från sin vardag — sociala medier och appar (YouTube, Instagram, TikTok, Snapchat), spel och e-sport (Minecraft, Fortnite, stora e-sportturneringar), streamingtjänster (Spotify, Netflix), kända youtubers/streamers, virala internetfenomen.
- Luta gärna åt händelser inom en 15-årings egen livstid (ungefär år 2011 och framåt) när det går, blandat med några tydliga milstolpar från tiden strax innan.
- Skriv enkelt och konkret utan att kräva förkunskaper utöver högstadienivå. Undvik krystad slang — skriv naturligt, inte "på ett ungdomligt sätt".`
  }
};
const VARIANT_IDS = Object.keys(VARIANTS);
function normalizeVariant(v) { return VARIANT_IDS.includes(v) ? v : 'standard'; }

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
const FALLBACK_EVENTS = {
  standard: [
    { description: 'Regalskeppet Vasa kantrar och sjunker på sin jungfrufärd i Stockholms hamn, mindre än en kilometer från kaj. Skeppet låg kvar på botten i 333 år innan det bärgades 1961.', year: 1628, isAnchor: true },
    { description: 'Allmän och lika rösträtt för kvinnor och män införs i Sverige. Det dröjer ändå till valet 1921 innan reformen faktiskt används första gången.', year: 1919, isAnchor: false },
    { description: 'Astrid Lindgrens första bok om Pippi Långstrump ges ut, efter att ha skrivits ner som julklapp till dottern Karin några år tidigare.', year: 1945, isAnchor: false },
    { description: 'Sverige byter från vänster- till högertrafik på natten till "Dagen H". Hela landets vägmärken och busshållplatser hade förberetts i hemlighet under lång tid.', year: 1967, isAnchor: false },
    { description: 'Berlinmuren faller sedan en östtysk tjänsteman av misstag meddelar att nya reseregler gäller "omedelbart, utan dröjsmål" på en pressträff.', year: 1989, isAnchor: false },
    { description: 'ABBA vinner Eurovision Song Contest med låten "Waterloo" och blir samtidigt gruppens internationella genombrott över en natt.', year: 1974, isAnchor: false },
    { description: 'Sverige tar VM-brons i fotboll på hemmaplan efter att ha slagit Bulgarien i bronsmatchen — landets bästa VM-resultat sedan finalen 1958.', year: 1994, isAnchor: false },
    { description: 'Spotify grundas i Stockholm av Daniel Ek och Martin Lorentzon, som ett svar på den utbredda musikpiratkopieringen.', year: 2006, isAnchor: false }
  ],
  remix: [
    { description: 'YouTube lanseras och blir startskottet för en helt ny sorts kändisskap. Den allra första videon som laddades upp är bara 19 sekunder lång och visar grundaren på en djurpark.', year: 2005, isAnchor: true },
    { description: 'Den första iPhone lanseras och gör pekskärmsmobiler till standard. Steve Jobs hade tidigare samma år lurat pressen genom att gå runt med en hemlig prototyp i fickan.', year: 2007, isAnchor: false },
    { description: 'Instagram lanseras och blir snabbt appen för att dela bilder från vardagen. Appen hade bara 25 000 användare på sitt första dygn.', year: 2010, isAnchor: false },
    { description: 'Minecraft släpps och blir ett av världens mest sålda spel någonsin. Spelet skapades ursprungligen av en enda person, Markus "Notch" Persson.', year: 2011, isAnchor: false },
    { description: 'Den svenska youtubern PewDiePie blir världens mest prenumererade kanal på YouTube. Han behöll den positionen i flera år innan stora mediebolag gick om honom.', year: 2013, isAnchor: false },
    { description: 'Fortnite släpps och blir ett globalt fenomen tack vare sitt gratis Battle Royale-läge. Spelets danser och emotes blir snabbt en egen del av populärkulturen.', year: 2017, isAnchor: false },
    { description: 'TikTok lanseras internationellt efter att ha slagits ihop med appen Musical.ly. Appens korta videoformat förändrar snart hur andra sociala medier fungerar.', year: 2018, isAnchor: false },
    { description: 'Coronapandemin gör att skolor i Sverige och stora delar av världen stänger och undervisning flyttar till distans. Många möten och lektioner hålls istället över videolänk.', year: 2020, isAnchor: false }
  ]
};

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

function buildPrompt(excluded, variant) {
  const v = VARIANTS[variant] || VARIANTS.standard;
  const excludeList = excluded.length
    ? '\n\nAnvänd INTE någon av dessa händelser igen (redan använda de senaste ' + AVOID_REPEAT_WEEKS + ' veckorna i den här varianten):\n' +
      excluded.map(e => '- ' + e.description + ' (' + e.year + ')').join('\n')
    : '';
  return `Du skapar ett veckopussel för ett svenskt familjespel som heter "Flashback" (ett tidslinjepussel, inte quiz).

Ge mig exakt ${EVENT_COUNT} historiska händelser. ${v.focus}

Sprid årtalen brett (inte allt klumpat inom samma decennium) så att pusslet blir lagom svårt.

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
      max_tokens: 3000,
      // Sonnet 5 kör adaptive thinking som standard om "thinking" utelämnas
      // — det åt upp hela max_tokens-budgeten innan JSON-svaret hann
      // skrivas klart ("Unexpected end of JSON input" i loggarna). Den
      // här genereringen är ett enkelt textformuleringsjobb utan
      // resonemang som behöver synas, så stäng av det explicit istället.
      thinking: { type: 'disabled' },
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!resp.ok) throw new Error('Anthropic API svarade ' + resp.status + ': ' + (await resp.text()).slice(0, 300));
  const data = await resp.json();
  const text = (data.content || []).map(b => b.text || '').join('');
  const jsonStr = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  return JSON.parse(jsonStr);
}

async function generatePuzzle(apiKey, excluded, variant) {
  const prompt = buildPrompt(excluded, variant);
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const parsed = await callAnthropic(apiKey, prompt);
      if (validateEvents(parsed.events)) {
        return { title: String(parsed.title || 'Veckans Flashback').slice(0, 80), events: parsed.events };
      }
      console.error('Flashback: AI-svaret klarade inte valideringen (' + variant + ', försök ' + attempt + ').');
    } catch (e) {
      console.error('Flashback: fel vid AI-generering (' + variant + ', försök ' + attempt + '):', e.message);
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
      week_id text not null,
      variant text not null default 'standard',
      title text not null,
      events jsonb not null,
      created_at timestamptz not null default now()
    );`);
  // migrering: variant-kolumn + sammansatt primärnyckel fanns inte i den
  // ursprungliga tabellen (bara en variant då) — lägg till kolumnen
  // (befintliga rader blir 'standard') och byt ut den gamla ensam-
  // week_id-nyckeln mot (week_id, variant).
  await pool.query(`alter table flashback_puzzles add column if not exists variant text not null default 'standard';`);
  await pool.query(`alter table flashback_puzzles drop constraint if exists flashback_puzzles_pkey;`);
  await pool.query(`alter table flashback_puzzles add primary key (week_id, variant);`);
  await pool.query(`alter table flashback_puzzles enable row level security;`);
  await pool.query(`
    create table if not exists flashback_used_events (
      id bigserial primary key,
      week_id text not null,
      description text not null,
      year integer not null,
      created_at timestamptz not null default now()
    );`);
  await pool.query(`alter table flashback_used_events add column if not exists variant text not null default 'standard';`);
  await pool.query(`alter table flashback_used_events enable row level security;`);
  await pool.query(`create index if not exists flashback_used_events_variant_idx on flashback_used_events (variant, created_at);`);
}

function pgStore(pool) {
  return {
    async getPuzzle(weekId, variant) {
      const r = await pool.query('select week_id, variant, title, events from flashback_puzzles where week_id = $1 and variant = $2', [weekId, variant]);
      return r.rows[0] || null;
    },
    async savePuzzle(weekId, variant, title, events, { overwrite = false } = {}) {
      await pool.query(
        `insert into flashback_puzzles (week_id, variant, title, events) values ($1,$2,$3,$4)
         on conflict (week_id, variant) do ${overwrite ? 'update set title = excluded.title, events = excluded.events, created_at = now()' : 'nothing'}`,
        [weekId, variant, title, JSON.stringify(events)]
      );
      for (const e of events) {
        await pool.query('insert into flashback_used_events (week_id, variant, description, year) values ($1,$2,$3,$4)', [weekId, variant, e.description, e.year]);
      }
    },
    async recentlyUsed(weeks, variant) {
      const r = await pool.query(
        `select description, year from flashback_used_events where variant = $1 and created_at > now() - ($2 || ' weeks')::interval`,
        [variant, String(weeks)]
      );
      return r.rows;
    }
  };
}

function memStore() {
  const puzzles = new Map();
  const used = [];
  const key = (weekId, variant) => weekId + '|' + variant;
  return {
    async getPuzzle(weekId, variant) { return puzzles.get(key(weekId, variant)) || null; },
    async savePuzzle(weekId, variant, title, events, { overwrite = false } = {}) {
      const k = key(weekId, variant);
      if (puzzles.has(k) && !overwrite) return;
      puzzles.set(k, { week_id: weekId, variant, title, events });
      const now = Date.now();
      events.forEach(e => used.push({ variant, description: e.description, year: e.year, createdAt: now }));
    },
    async recentlyUsed(weeks, variant) {
      const cutoff = Date.now() - weeks * 7 * 86400000;
      return used.filter(u => u.variant === variant && u.createdAt > cutoff);
    }
  };
}

/* ---------- Uppstart ---------- */
async function ensureWeekPuzzle(store, apiKey, weekId, variant) {
  const existing = await store.getPuzzle(weekId, variant);
  if (existing) return existing;
  if (!apiKey) {
    console.warn('Flashback: ANTHROPIC_API_KEY saknas — kan inte generera nya pussel.');
    return null;
  }
  const excluded = await store.recentlyUsed(AVOID_REPEAT_WEEKS, variant);
  let generated = await generatePuzzle(apiKey, excluded, variant);
  if (!generated) {
    console.error('Flashback: AI-generering misslyckades för vecka ' + weekId + ' (' + variant + ') — använder reservpussel.');
    generated = { title: 'Veckans Flashback', events: FALLBACK_EVENTS[variant] || FALLBACK_EVENTS.standard };
  }
  const events = assignIds(generated.events);
  await store.savePuzzle(weekId, variant, generated.title, events);
  return { week_id: weekId, variant, title: generated.title, events };
}

// Individuell statistik ("personbästa", antal perfekta rundor) — läser
// direkt ur den generiska scores-tabellen (index.js), samma tabell
// leaderboarden redan bygger på, istället för att duplicera lagring här.
// distinct on (seed) plockar bästa raden per vecka (skyddar mot ev.
// dubbletter), och eftersom "seconds" redan är den kombinerade
// rangordningssiffran (se flashback/index.html, encodeRank) är lägst
// värde = bästa resultatet totalt sett, rätt-antal + tid i ett.
async function statsForName(pool, variant, name) {
  if (!pool || !name) return { gamesPlayed: 0, perfectCount: 0, best: null };
  const r = await pool.query(
    `select seconds, moves from (
       select distinct on (seed) seed, seconds, moves
       from scores
       where mode = 'flashback' and seed like $1 and lower(name) = lower($2)
       order by seed, seconds asc
     ) t`,
    ['flashback:' + variant + ':%', name]
  );
  const rows = r.rows;
  const perfectCount = rows.filter(row => row.moves === EVENT_COUNT - 1).length;
  let best = null;
  for (const row of rows) { if (!best || row.seconds < best.seconds) best = row; }
  return { gamesPlayed: rows.length, perfectCount, best: best ? { moves: best.moves, seconds: best.seconds } : null };
}

function createFlashbackRouter(store, apiKey, generateSecret, pool) {
  const router = express.Router();

  // Personbästa/antal perfekta rundor för en profil, i en given variant
  // (oberoende av vecka) — hämtas INNAN klienten skickar in veckans
  // resultat, så den kan avgöra om det just spelade partiet slår
  // tidigare bästa eller är ett nytt perfekt-antal. Utan namn (t.ex.
  // ingen profil vald ännu) svaras det med nollställd statistik.
  router.get('/stats', async (req, res) => {
    const variant = normalizeVariant(req.query.variant);
    const name = typeof req.query.name === 'string' ? req.query.name.trim() : '';
    try {
      res.json(await statsForName(pool, variant, name));
    } catch (e) { console.error(e); res.status(500).json({ error: 'databasfel' }); }
  });

  router.get('/puzzle', async (req, res) => {
    const variant = normalizeVariant(req.query.variant);
    const weekRaw = req.query.week;
    const weekId = (typeof weekRaw === 'string' && /^\d{4}-W\d{2}$/.test(weekRaw)) ? weekRaw : currentWeekId();
    try {
      let puzzle = await store.getPuzzle(weekId, variant);
      // Innevarande vecka saknar pussel (t.ex. servern startade om strax
      // innan cronen hann köra) — generera nu istället för att visa ett
      // tomt spel. Äldre veckor genereras aldrig i efterhand.
      if (!puzzle && weekId === currentWeekId()) puzzle = await ensureWeekPuzzle(store, apiKey, weekId, variant);
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
    const variant = normalizeVariant(b.variant);
    const weekId = (typeof b.week === 'string' && /^\d{4}-W\d{2}$/.test(b.week)) ? b.week : currentWeekId();
    const force = b.force === true;
    try {
      if (force) {
        const excluded = await store.recentlyUsed(AVOID_REPEAT_WEEKS, variant);
        const generated = await generatePuzzle(apiKey, excluded, variant);
        if (!generated) return res.status(502).json({ error: 'AI-generering misslyckades' });
        const events = assignIds(generated.events);
        await store.savePuzzle(weekId, variant, generated.title, events, { overwrite: true });
        return res.json({ ok: true, week_id: weekId, variant, title: generated.title, events });
      }
      const puzzle = await ensureWeekPuzzle(store, apiKey, weekId, variant);
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
  // statsForName läser scores-tabellen direkt (index.js), oberoende av om
  // flashback-schemat ovan lyckades initieras — därför originalet `pool`,
  // inte den ev. nollställda `usablePool`.
  const router = createFlashbackRouter(store, anthropicApiKey, generateSecret, pool);

  // Måndag 00:05 Europe/Stockholm — några minuter efter midnatt så att
  // veckoidentiteten hunnit växla. Genererar båda varianterna. Idempotent
  // per (vecka, variant): gör inget om den redan finns (t.ex. skapad
  // manuellt eller av ett tidigare cron-varv efter en omstart).
  cron.schedule('5 0 * * 1', async () => {
    const weekId = currentWeekId();
    for (const variant of VARIANT_IDS) {
      try {
        const existing = await store.getPuzzle(weekId, variant);
        if (existing) continue;
        await ensureWeekPuzzle(store, anthropicApiKey, weekId, variant);
        console.log('Flashback: genererade pussel för vecka', weekId, 'variant', variant);
      } catch (e) { console.error('Flashback: fel vid veckogenerering (' + variant + '):', e); }
    }
  }, { timezone: 'Europe/Stockholm' });

  return { router };
}
