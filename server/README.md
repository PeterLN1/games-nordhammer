# Mahjong topplista — backend

Litet API för den globala topplistan i Mahjong (Nordhammer Spel).
**Railway** kör servern, **Supabase** är databasen (Postgres).

Endpoints:
- `GET /api/health` → `{ ok: true }`
- `GET /api/leaderboard?tiles=80&mode=classic&limit=20` → topplista för ett bräde
- `POST /api/scores` med `{ name, mode, tiles, seconds, moves }` → sparar en tid

---

## Uppsättning (engångs)

### 1. Skapa databasen i Supabase
1. Gå till [supabase.com](https://supabase.com) → **New project**. Välj lösenord och region.
2. När projektet är klart: **Project Settings → Database → Connection string → URI**.
3. Välj **Connection pooling** (port `6543`) och kopiera strängen. Byt ut `[YOUR-PASSWORD]`
   mot databaslösenordet. Det är din `DATABASE_URL`.

> Tabellen `scores` skapas automatiskt när servern startar första gången — du behöver
> inte köra någon SQL manuellt.

### 2. Deploya servern på Railway
1. Gå till [railway.app](https://railway.app) → **New Project → Deploy from GitHub repo**
   och välj `games-nordhammer`.
2. I tjänstens inställningar, sätt **Root Directory** till `server`.
   (Railway kör då `npm install` och `npm start` i den mappen.)
3. Under **Variables**, lägg till:
   - `DATABASE_URL` = strängen från steg 1
   - `ALLOWED_ORIGINS` = `https://games.nordhammer.se`
4. Deploya. Railway ger dig en URL, t.ex. `https://mahjong-production.up.railway.app`.
   Testa `https://…/api/health` → ska svara `{ "ok": true }`.

### 3. Koppla spelet till API:t
I `mahjong/index.html`, hitta raden:

```js
var LEADERBOARD_API = '';
```

och sätt din Railway-URL (utan avslutande snedstreck):

```js
var LEADERBOARD_API = 'https://mahjong-production.up.railway.app';
```

Committa och pusha — Vercel deployar om, och topplistan är live.

---

## Köra lokalt
```bash
cd server
npm install
# utan DATABASE_URL körs servern i minnesläge (data sparas inte) — bra för test:
npm start
# eller mot en riktig databas:
DATABASE_URL="postgresql://…" npm start
```

## Säkerhet & begränsningar
- Namn saneras (max 20 tecken, kontrolltecken bort) och ett enkelt olämplighetsfilter finns.
- Enkel rate limit: max 30 inskick per minut och IP.
- Rimlighetskontroll av tid/antal brickor.
- Ingen inloggning — topplistan bygger på angivet visningsnamn (som i klassiska arkadspel).
