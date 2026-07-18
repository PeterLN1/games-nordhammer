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

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL || '';
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || '*';

const MODES = new Set(['classic', 'tilematch']);
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

/* ---------- Lagring (Postgres eller minne) ---------- */
let store;
if (DATABASE_URL) {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
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
  await pool.query(`create index if not exists scores_board_idx on scores (mode, tiles, seconds);`);
  store = {
    async insert(s) {
      await pool.query(
        'insert into scores (name, mode, tiles, seconds, moves) values ($1,$2,$3,$4,$5)',
        [s.name, s.mode, s.tiles, s.seconds, s.moves]
      );
      const r = await pool.query(
        'select count(*)::int as c from scores where mode=$1 and tiles=$2 and seconds<$3',
        [s.mode, s.tiles, s.seconds]
      );
      return r.rows[0].c + 1;
    },
    async top(mode, tiles, limit) {
      const r = await pool.query(
        'select name, min(seconds) as seconds from scores where mode=$1 and tiles=$2 group by name order by seconds asc limit $3',
        [mode, tiles, limit]
      );
      return r.rows;
    }
  };
  console.log('Topplista: ansluten till Postgres.');
} else {
  const mem = [];
  store = {
    async insert(s) {
      mem.push(s);
      return mem.filter(x => x.mode === s.mode && x.tiles === s.tiles && x.seconds < s.seconds).length + 1;
    },
    async top(mode, tiles, limit) {
      const best = {};
      mem.filter(x => x.mode === mode && x.tiles === tiles).forEach(x => {
        if (best[x.name] == null || x.seconds < best[x.name]) best[x.name] = x.seconds;
      });
      return Object.keys(best).map(name => ({ name, seconds: best[name] }))
        .sort((a, b) => a.seconds - b.seconds).slice(0, limit);
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
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
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
  const tiles = parseInt(req.query.tiles, 10);
  const mode = MODES.has(req.query.mode) ? req.query.mode : 'classic';
  let limit = parseInt(req.query.limit, 10);
  if (!(limit > 0 && limit <= 50)) limit = 20;
  if (!(tiles > 0)) return res.status(400).json({ error: 'tiles kravs' });
  try {
    res.json({ mode, tiles, scores: await store.top(mode, tiles, limit) });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'databasfel' });
  }
});

app.post('/api/scores', async (req, res) => {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (rateLimited(ip)) return res.status(429).json({ error: 'for manga forsok, vanta lite' });
  const b = req.body || {};
  const name = cleanName(b.name);
  const mode = MODES.has(b.mode) ? b.mode : 'classic';
  const tiles = parseInt(b.tiles, 10);
  const seconds = parseInt(b.seconds, 10);
  const moves = Number.isFinite(+b.moves) ? parseInt(b.moves, 10) : null;
  if (!name) return res.status(400).json({ error: 'namn kravs' });
  if (isBadName(name)) return res.status(400).json({ error: 'olampligt namn' });
  if (!(tiles >= 4 && tiles <= 400)) return res.status(400).json({ error: 'ogiltigt antal brickor' });
  if (!(seconds >= 1 && seconds <= 86400)) return res.status(400).json({ error: 'ogiltig tid' });
  try {
    const rank = await store.insert({ name, mode, tiles, seconds, moves });
    res.json({ ok: true, rank });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'databasfel' });
  }
});

app.listen(PORT, () => console.log('Topplista-API lyssnar pa port ' + PORT));
