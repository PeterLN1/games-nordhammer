/* ============================================================
   Mahjong topplista-API — Nordhammer Spel
   Node + Express + Postgres (Supabase). Deployas på Railway.

   Miljövariabler:
     DATABASE_URL      Postgres-anslutning från Supabase (krävs i produktion).
                       Saknas den körs servern i MINNESLÄGE (endast lokal test).
     ALLOWED_ORIGINS   Kommaseparerade origins som får posta, t.ex.
                       "https://games.nordhammer.se". Default "*" (alla).
     PORT              Sätts automatiskt av Railway.
   ============================================================ */
import express from 'express';
import pg from 'pg';
import { createGhostTrains } from './ghosttrains.js';

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL || '';
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || '*';
const GHOSTTRAINS_RESOLVE_SECRET = process.env.GHOSTTRAINS_RESOLVE_SECRET || '';

const MODES = new Set(['classic', 'tilematch', 'ordlek']);
// enkel olämplighetsfilter (utökas vid behov)
const BAD_WORDS = ['fitta', 'kuk', 'hora', 'knulla', 'jävla', 'javla', 'fuck', 'shit', 'bitch', 'cunt', 'nigger', 'nigga', 'slut'];

function cleanName(raw) {
  return String(raw == null ? '' : raw)
    .replace(/[\x00-\x1f\x7f]/g, "")  // kontrolltecken
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 20);
}
function isBadName(name) {
  const l = name.toLowerCase();
  return BAD_WORDS.some(w => l.includes(w));
}

/* ---------- Ordlek: maratontabell ----------
   "Golfpoäng" över en säsong (kalendermånad): varje dag ger antingen
   antal gissningar (om ordet löstes), 7 om man spelade men missade, eller
   8 om man inte spelade alls den dagen. Lägst summa vinner — som i golf
   får alla lika många "hål" oavsett hur ofta de faktiskt spelat, annars
   gynnas den som spelar sällan orättvist. Säsongen börjar tidigast
   ORDLEK_SEASON_START (så ingen får ett försprång från redan spelade dagar). */
const ORDLEK_SEASON_START = '2026-08-11';
function seasonBoundsFor(dateStr) {
  const first = dateStr.slice(0, 8) + '01';
  const y = +dateStr.slice(0, 4), m = +dateStr.slice(5, 7);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = dateStr.slice(0, 8) + String(lastDay).padStart(2, '0');
  const start = first < ORDLEK_SEASON_START ? ORDLEK_SEASON_START : first;
  return { start, end: last };
}
function nextDay(dateStr) {
  return new Date(Date.parse(dateStr + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
}
function dateRange(start, end) {
  const dates = [];
  for (let d = start; d <= end; d = nextDay(d)) dates.push(d);
  return dates;
}
// rows: [{name, day, moves}] — moves är redan 1-6 (löst) eller 7 (missat).
function computeMarathon(rows, seasonDates) {
  const byName = {};
  rows.forEach(r => { (byName[r.name] || (byName[r.name] = {}))[r.day] = r.moves; });
  const table = Object.keys(byName).map(name => {
    const days = byName[name];
    let points = 0, played = 0, solvedSum = 0, solvedCount = 0;
    seasonDates.forEach(d => {
      const m = days[d];
      if (m == null) { points += 8; return; }
      played++;
      points += Math.min(m, 7);
      if (m <= 6) { solvedSum += m; solvedCount++; }
    });
    let streak = 0;
    for (let i = seasonDates.length - 1; i >= 0; i--) {
      const m = days[seasonDates[i]];
      if (m != null && m <= 6) streak++; else break;
    }
    return {
      name, played, days: seasonDates.length, points,
      avg: solvedCount ? Math.round((solvedSum / solvedCount) * 10) / 10 : null,
      streak
    };
  });
  table.sort((a, b) => a.points - b.points);
  // Delad placering vid lika poäng ("standard competition ranking"): två
  // tvåor ger ingen trea — nästa spelare hoppar direkt till rank 4.
  let rank = 0;
  table.forEach((row, i) => {
    if (i === 0 || row.points !== table[i - 1].points) rank = i + 1;
    row.rank = rank;
  });
  return table;
}

/* ---------- Lagring (Postgres eller minne) ---------- */
let store;
let pool = null;
if (DATABASE_URL) {
  try {
    pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await pool.query(`
      create table if not exists scores (
        id bigserial primary key,
        name text not null,
        mode text not null default 'classic',
        tiles integer not null,
        seconds integer not null,
        moves integer,
        created_at timestamptz not null default now()
      );`);
    // migrering: seed-kolumn för delade givar (fanns inte i äldre tabeller)
    await pool.query(`alter table scores add column if not exists seed text;`);
    // migrering: from_share markerar resultat spelade via en känd/upprepningsbar
    // giv (delad länk eller daglig utmaning) — sådana ska INTE räknas in i den
    // vanliga topplistan (annars kan man öva in en memorerad körning och få en
    // orättvist bra tid där). Giv-specifika topplistor påverkas inte.
    await pool.query(`alter table scores add column if not exists from_share boolean not null default false;`);
    // Supabase exponerar automatiskt en publik REST-API för varje tabell,
    // skyddad enbart av Row-Level Security. Slå på RLS utan policyer så den
    // vägen stängs helt — enda avsedda ingången är detta API. Påverkar inte
    // den här anslutningen (superuser-roller kringgår alltid RLS).
    await pool.query(`alter table scores enable row level security;`);
    await pool.query(`create index if not exists scores_board_idx on scores (mode, tiles, seconds);`);
    await pool.query(`create index if not exists scores_seed_idx on scores (seed, seconds);`);
    // Delade profiler ("Vem spelar?") — id genereras klientsidan, se
    // shared/profile.js. Ingen auth, samma öppna förtroendemodell som
    // scores-tabellen (privat länk, inte ett publikt multi-familje-system).
    await pool.query(`
      create table if not exists profiles (
        id text primary key,
        name text not null,
        avatar text not null,
        color text not null,
        created_at timestamptz not null default now()
      );`);
    await pool.query(`alter table profiles enable row level security;`);
    store = {
      async insert(s) {
        await pool.query(
          'insert into scores (name, mode, tiles, seconds, moves, seed, from_share) values ($1,$2,$3,$4,$5,$6,$7)',
          [s.name, s.mode, s.tiles, s.seconds, s.moves, s.seed, !!s.fromShare]
        );
        if (s.fromShare) return null; // ingen global rank är meningsfull för ett giv-resultat
        const r = await pool.query(
          'select count(*)::int as c from scores where mode=$1 and tiles=$2 and seconds<$3 and from_share=false',
          [s.mode, s.tiles, s.seconds]
        );
        return r.rows[0].c + 1;
      },
      async top(mode, tiles, limit) {
        const r = await pool.query(
          'select name, min(seconds) as seconds from scores where mode=$1 and tiles=$2 and from_share=false group by name order by seconds asc limit $3',
          [mode, tiles, limit]
        );
        return r.rows;
      },
      async topBySeed(seed, limit) {
        // moves hämtas ihopparat med samma rad som gav bästa tiden per
        // spelare (distinct on), inte ett fristående min() — annars kunde
        // t.ex. "3 försök" råka visas bredvid någon annan inskicknings tid.
        const r = await pool.query(
          `select name, seconds, moves from (
             select distinct on (name) name, seconds, moves
             from scores where seed=$1
             order by name, seconds asc
           ) t order by seconds asc limit $2`,
          [seed, limit]
        );
        return r.rows;
      },
      // Ogiltigförklarar en giv i efterhand (t.ex. en daglig Ordlek-runda
      // som backades och gjordes om) — tar bort alla resultat för den
      // specifika seeden så de inte blockerar en omspelning eller blandas
      // ihop med den nya rundan i topplistan/maratontabellen.
      async removeScoresBySeed(seed) {
        const r = await pool.query('delete from scores where seed=$1', [seed]);
        return r.rowCount;
      },
      // Ordlek-maraton: en rad per spelare och dag (bästa resultatet den
      // dagen), för computeMarathon() att räkna golfpoäng på.
      async marathon(seasonStart, seasonEnd) {
        const r = await pool.query(
          `select name, seed, min(moves) as moves
           from scores
           where seed like 'ordlek:%' and seed >= $1 and seed <= $2
           group by name, seed`,
          ['ordlek:' + seasonStart, 'ordlek:' + seasonEnd]
        );
        return r.rows.map(row => ({ name: row.name, day: row.seed.slice(7), moves: row.moves }));
      },
      // "Utmaningar": delade givar där minst två olika spelare faktiskt
      // tävlat mot samma seed — filtrerar bort vanliga solo-partier
      // (som alla har ett unikt, aldrig delat, seed).
      async challenges(limit) {
        const r = await pool.query(`
          select b.seed, b.mode, b.tiles, b.best_name, b.best_seconds, m.players, m.last_played
          from (
            select distinct on (seed) seed, mode, tiles, name as best_name, seconds as best_seconds
            from scores where seed is not null
            order by seed, seconds asc
          ) b
          join (
            select seed, count(distinct name) as players, max(created_at) as last_played
            from scores where seed is not null
            group by seed
            having count(distinct name) >= 2
          ) m using (seed)
          order by m.last_played desc
          limit $1;`, [limit]);
        return r.rows.map(row => ({
          seed: row.seed, mode: row.mode, tiles: row.tiles,
          bestName: row.best_name, bestSeconds: row.best_seconds, players: row.players
        }));
      },
      async listProfiles() {
        const r = await pool.query('select id, name, avatar, color from profiles order by created_at asc');
        return r.rows;
      },
      async insertProfile(p) {
        await pool.query(
          'insert into profiles (id, name, avatar, color) values ($1,$2,$3,$4) on conflict (id) do nothing',
          [p.id, p.name, p.avatar, p.color]
        );
      },
      async updateProfile(id, patch) {
        const r = await pool.query(
          'update profiles set name = coalesce($2, name), avatar = coalesce($3, avatar), color = coalesce($4, color) where id = $1 returning id, name, avatar, color',
          [id, patch.name ?? null, patch.avatar ?? null, patch.color ?? null]
        );
        return r.rows[0] || null;
      },
      async removeProfile(id) {
        await pool.query('delete from profiles where id = $1', [id]);
      }
    };
    console.log('Topplista: ansluten till Postgres.');
  } catch (e) {
    // Vanligaste orsaken: Supabase-projektet är pausat (gratisnivån pausar
    // automatiskt efter inaktivitet), så redan uppstarts-migreringarna
    // failar. Innan den här catchen fanns kraschade hela processen direkt
    // (ohanterat fel i top-level await) — Railway startade om den i en
    // loop, och varje request under tiden fick ett anslutningsfel snarare
    // än ett begripligt svar. Nu startar servern ändå (store stannar på
    // null) och varje endpoint svarar tydligt 503 tills en ny
    // driftsättning/omstart lyckas ansluta.
    console.error('Topplista: kunde inte ansluta till Postgres vid uppstart (kan bero på att Supabase-projektet är pausat):', e.message);
    store = null;
    pool = null;
  }
} else {
  const mem = [];
  const memProfiles = [];
  store = {
    async insert(s) {
      mem.push(Object.assign({}, s, { fromShare: !!s.fromShare, createdAt: Date.now() }));
      if (s.fromShare) return null; // ingen global rank är meningsfull för ett giv-resultat
      return mem.filter(x => !x.fromShare && x.mode === s.mode && x.tiles === s.tiles && x.seconds < s.seconds).length + 1;
    },
    async top(mode, tiles, limit) {
      const best = {};
      mem.filter(x => !x.fromShare && x.mode === mode && x.tiles === tiles).forEach(x => {
        if (best[x.name] == null || x.seconds < best[x.name]) best[x.name] = x.seconds;
      });
      return Object.keys(best).map(name => ({ name, seconds: best[name] }))
        .sort((a, b) => a.seconds - b.seconds).slice(0, limit);
    },
    async topBySeed(seed, limit) {
      const best = {};
      mem.filter(x => x.seed === seed).forEach(x => {
        if (!best[x.name] || x.seconds < best[x.name].seconds) best[x.name] = { name: x.name, seconds: x.seconds, moves: x.moves };
      });
      return Object.values(best).sort((a, b) => a.seconds - b.seconds).slice(0, limit);
    },
    async removeScoresBySeed(seed) {
      let removed = 0;
      for (let i = mem.length - 1; i >= 0; i--) {
        if (mem[i].seed === seed) { mem.splice(i, 1); removed++; }
      }
      return removed;
    },
    async marathon(seasonStart, seasonEnd) {
      const from = 'ordlek:' + seasonStart, to = 'ordlek:' + seasonEnd;
      const best = {};
      mem.filter(x => x.seed && x.seed.indexOf('ordlek:') === 0 && x.seed >= from && x.seed <= to).forEach(x => {
        const key = x.name + '|' + x.seed;
        if (!best[key] || x.moves < best[key].moves) best[key] = { name: x.name, day: x.seed.slice(7), moves: x.moves };
      });
      return Object.values(best);
    },
    async challenges(limit) {
      const bySeed = {};
      mem.filter(x => x.seed).forEach(x => {
        const g = bySeed[x.seed] || (bySeed[x.seed] = { seed: x.seed, mode: x.mode, tiles: x.tiles, names: new Set(), best: null, lastPlayed: 0 });
        g.names.add(x.name);
        if (!g.best || x.seconds < g.best.seconds) g.best = { name: x.name, seconds: x.seconds };
        if (x.createdAt > g.lastPlayed) g.lastPlayed = x.createdAt;
      });
      return Object.values(bySeed)
        .filter(g => g.names.size >= 2)
        .sort((a, b) => b.lastPlayed - a.lastPlayed)
        .slice(0, limit)
        .map(g => ({ seed: g.seed, mode: g.mode, tiles: g.tiles, bestName: g.best.name, bestSeconds: g.best.seconds, players: g.names.size }));
    },
    async listProfiles() {
      return memProfiles.map(p => ({ id: p.id, name: p.name, avatar: p.avatar, color: p.color }));
    },
    async insertProfile(p) {
      if (memProfiles.some(x => x.id === p.id)) return;
      memProfiles.push({ id: p.id, name: p.name, avatar: p.avatar, color: p.color });
    },
    async updateProfile(id, patch) {
      const p = memProfiles.find(x => x.id === id);
      if (!p) return null;
      if (patch.name != null) p.name = patch.name;
      if (patch.avatar != null) p.avatar = patch.avatar;
      if (patch.color != null) p.color = patch.color;
      return p;
    },
    async removeProfile(id) {
      const i = memProfiles.findIndex(x => x.id === id);
      if (i >= 0) memProfiles.splice(i, 1);
    }
  };
  console.warn('DATABASE_URL saknas - kor i MINNESLAGE (data sparas inte). Endast for lokal test.');
}

/* ---------- App ---------- */
const app = express();
app.use(express.json({ limit: '8kb' }));

// CORS
const allowList = ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS === '*') res.setHeader('Access-Control-Allow-Origin', '*');
  else if (origin && allowList.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// enkel rate limit per IP (max 30 POST/min)
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < 60000);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > 30;
}

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.get('/api/leaderboard', async (req, res) => {
  if (!store) return res.status(503).json({ error: 'databasen är otillgänglig just nu' });
  const seedRaw = req.query.seed;
  const seed = (typeof seedRaw === 'string' && seedRaw.length > 0 && seedRaw.length <= 300) ? seedRaw : null;
  let limit = parseInt(req.query.limit, 10);
  if (!(limit > 0 && limit <= 50)) limit = 20;
  try {
    if (seed) {
      return res.json({ seed, scores: await store.topBySeed(seed, limit) });
    }
    const tiles = parseInt(req.query.tiles, 10);
    const mode = MODES.has(req.query.mode) ? req.query.mode : 'classic';
    if (!(tiles > 0)) return res.status(400).json({ error: 'tiles kravs' });
    res.json({ mode, tiles, scores: await store.top(mode, tiles, limit) });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'databasfel' });
  }
});

// "Utmaningar": bläddringsbar lista över delade givar som minst två
// spelare tävlat på — öppet för alla, inget krävs för att se den.
app.get('/api/challenges', async (req, res) => {
  if (!store) return res.status(503).json({ error: 'databasen är otillgänglig just nu' });
  let limit = parseInt(req.query.limit, 10);
  if (!(limit > 0 && limit <= 50)) limit = 20;
  try {
    res.json({ challenges: await store.challenges(limit) });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'databasfel' });
  }
});

app.get('/api/marathon', async (req, res) => {
  if (!store) return res.status(503).json({ error: 'databasen är otillgänglig just nu' });
  const today = new Date().toISOString().slice(0, 10);
  const { start, end } = seasonBoundsFor(today);
  const elapsedEnd = today < end ? today : end;
  if (start > elapsedEnd) {
    return res.json({ seasonStart: start, seasonEnd: end, daysElapsed: 0, rows: [] });
  }
  try {
    const dates = dateRange(start, elapsedEnd);
    const raw = await store.marathon(start, elapsedEnd);
    const rows = computeMarathon(raw, dates).slice(0, 50);
    res.json({ seasonStart: start, seasonEnd: end, daysElapsed: dates.length, rows });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'databasfel' });
  }
});

// Hall of fame: fullständig slutställning för varje AVSLUTAD tidigare
// kalendermånad (inte innevarande, ofärdiga månaden). Går bakåt månad för
// månad tills vi passerar ORDLEK_SEASON_START; hoppar över månader ingen
// spelat (rows.length === 0) så listan inte fylls med tomma poster.
app.get('/api/marathon/history', async (req, res) => {
  if (!store) return res.status(503).json({ error: 'databasen är otillgänglig just nu' });
  const today = new Date().toISOString().slice(0, 10);
  const seasonStartMonth = ORDLEK_SEASON_START.slice(0, 7);
  const months = [];
  try {
    let cursor = today.slice(0, 7); // 'YYYY-MM', innevarande månad
    while (true) {
      const y = +cursor.slice(0, 4), m = +cursor.slice(5, 7);
      const prevY = m === 1 ? y - 1 : y;
      const prevM = m === 1 ? 12 : m - 1;
      cursor = prevY + '-' + String(prevM).padStart(2, '0');
      if (cursor < seasonStartMonth) break;
      const { start, end } = seasonBoundsFor(cursor + '-01');
      const dates = dateRange(start, end);
      const raw = await store.marathon(start, end);
      const rows = computeMarathon(raw, dates);
      if (rows.length) {
        // Flera kan dela förstaplatsen (samma poäng) — champions är då fler än en.
        const champions = rows.filter(r => r.rank === 1);
        months.push({ month: cursor, seasonStart: start, seasonEnd: end, champions, rows: rows.slice(0, 10) });
      }
    }
    res.json({ months });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'databasfel' });
  }
});

// Delade profiler ("Vem spelar?") — samma öppna förtroendemodell som
// scores: ingen inloggning, id genereras och skickas av klienten
// (shared/profile.js). Se planen i .claude/plans för bakgrund.
function validAvatar(a) { return typeof a === 'string' && a.length > 0 && a.length <= 8; }
function validColor(c) { return typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c); }
function validProfileId(id) { return typeof id === 'string' && /^[a-z0-9]{4,64}$/i.test(id); }

app.get('/api/profiles', async (req, res) => {
  if (!store) return res.status(503).json({ error: 'databasen är otillgänglig just nu' });
  try {
    res.json({ profiles: await store.listProfiles() });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'databasfel' });
  }
});

app.post('/api/profiles', async (req, res) => {
  if (!store) return res.status(503).json({ error: 'databasen är otillgänglig just nu' });
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (rateLimited(ip)) return res.status(429).json({ error: 'for manga forsok, vanta lite' });
  const b = req.body || {};
  const id = validProfileId(b.id) ? b.id : null;
  const name = cleanName(b.name);
  if (!id) return res.status(400).json({ error: 'ogiltigt id' });
  if (!name) return res.status(400).json({ error: 'namn kravs' });
  if (isBadName(name)) return res.status(400).json({ error: 'olampligt namn' });
  if (!validAvatar(b.avatar)) return res.status(400).json({ error: 'ogiltig avatar' });
  if (!validColor(b.color)) return res.status(400).json({ error: 'ogiltig farg' });
  try {
    await store.insertProfile({ id, name, avatar: b.avatar, color: b.color });
    res.json({ ok: true });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'databasfel' });
  }
});

app.patch('/api/profiles/:id', async (req, res) => {
  if (!store) return res.status(503).json({ error: 'databasen är otillgänglig just nu' });
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (rateLimited(ip)) return res.status(429).json({ error: 'for manga forsok, vanta lite' });
  const id = req.params.id;
  if (!validProfileId(id)) return res.status(400).json({ error: 'ogiltigt id' });
  const b = req.body || {};
  const patch = {};
  if (b.name != null) {
    const name = cleanName(b.name);
    if (!name) return res.status(400).json({ error: 'namn kravs' });
    if (isBadName(name)) return res.status(400).json({ error: 'olampligt namn' });
    patch.name = name;
  }
  if (b.avatar != null) {
    if (!validAvatar(b.avatar)) return res.status(400).json({ error: 'ogiltig avatar' });
    patch.avatar = b.avatar;
  }
  if (b.color != null) {
    if (!validColor(b.color)) return res.status(400).json({ error: 'ogiltig farg' });
    patch.color = b.color;
  }
  try {
    const updated = await store.updateProfile(id, patch);
    if (!updated) return res.status(404).json({ error: 'profil hittades inte' });
    res.json({ ok: true, profile: updated });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'databasfel' });
  }
});

app.delete('/api/profiles/:id', async (req, res) => {
  if (!store) return res.status(503).json({ error: 'databasen är otillgänglig just nu' });
  const id = req.params.id;
  if (!validProfileId(id)) return res.status(400).json({ error: 'ogiltigt id' });
  try {
    await store.removeProfile(id);
    res.json({ ok: true });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'databasfel' });
  }
});

// Ogiltigförklarar en giv i efterhand — t.ex. en daglig Ordlek-runda som
// backades och gjordes om för att dagens ord var olämpligt. Tar bort ALLA
// resultat för den angivna seeden. Samma öppna förtroendemodell som
// resten av API:t (ingen auth) — se säkerhetsdiskussionen i README/planen.
app.delete('/api/scores', async (req, res) => {
  if (!store) return res.status(503).json({ error: 'databasen är otillgänglig just nu' });
  const seedRaw = req.query.seed;
  const seed = (typeof seedRaw === 'string' && seedRaw.length > 0 && seedRaw.length <= 300) ? seedRaw : null;
  if (!seed) return res.status(400).json({ error: 'seed kravs' });
  try {
    const removed = await store.removeScoresBySeed(seed);
    res.json({ ok: true, removed });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'databasfel' });
  }
});

app.post('/api/scores', async (req, res) => {
  if (!store) return res.status(503).json({ error: 'databasen är otillgänglig just nu' });
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (rateLimited(ip)) return res.status(429).json({ error: 'for manga forsok, vanta lite' });
  const b = req.body || {};
  const name = cleanName(b.name);
  const mode = MODES.has(b.mode) ? b.mode : 'classic';
  const tiles = parseInt(b.tiles, 10);
  const seconds = parseInt(b.seconds, 10);
  const moves = Number.isFinite(+b.moves) ? parseInt(b.moves, 10) : null;
  const seed = (typeof b.seed === 'string' && b.seed.length > 0 && b.seed.length <= 300) ? b.seed : null;
  const fromShare = b.fromShare === true;
  if (!name) return res.status(400).json({ error: 'namn kravs' });
  if (isBadName(name)) return res.status(400).json({ error: 'olampligt namn' });
  if (!(tiles >= 4 && tiles <= 400)) return res.status(400).json({ error: 'ogiltigt antal brickor' });
  if (!(seconds >= 1 && seconds <= 86400)) return res.status(400).json({ error: 'ogiltig tid' });
  try {
    const rank = await store.insert({ name, mode, tiles, seconds, moves, seed, fromShare });
    res.json({ ok: true, rank });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'databasfel' });
  }
});

const ghostTrains = await createGhostTrains(pool, { resolveSecret: GHOSTTRAINS_RESOLVE_SECRET });
app.use('/api/ghosttrains', ghostTrains.router);

app.listen(PORT, () => console.log('Topplista-API lyssnar pa port ' + PORT));
