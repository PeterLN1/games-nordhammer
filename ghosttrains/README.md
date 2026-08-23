# Ghost Trains

Asynkront, Ticket to Ride-inspirerat familjespel. Familjen bygger ett
gemensamt tågnät över Sverige, dag för dag. Alla drag under dagen
hålls hemliga; en midnattsupplösning kör dubbelspårs- och
krockmotorn och skriver resultatet permanent till kartan. Nästa
morgon ser familjen vad som hände i natt som en helskärms "Stories"-
sekvens.

Detta dokument är tänkt att ge en NY chattsession (utan tillgång till
den ursprungliga utvecklingskonversationen) tillräcklig kontext för
att göra ändringar tryggt. Läs det innan du ändrar spelregler,
kartdata eller resolutionsmotorn.

## Arkitektur

```
ghosttrains/
└── index.html        # Hela klienten: karta, hand, marknad, biljetter,
                       # claim-dialog, "Stories"-digest. Ren HTML/JS,
                       # inget byggsteg (samma mönster som övriga spel
                       # i repot).

server/
├── ghosttrains.js     # Allt spellogik: kartdata, regler, upplösnings-
                       # motor, databasschema, Express-router.
└── index.js           # Mountar ghosttrains-routern på /api/ghosttrains/*
                       # och startar node-cron-schemat.
```

**Kartan (städer/rutter) finns BARA på servern.** Klienten hämtar den
via `GET /api/ghosttrains/map` istället för att duplicera datan i en
delad fil. Anledning: Railways "Root Directory" för `server`-tjänsten
är satt till `server/`, så filer utanför den mappen följer inte med
i den deployen — en delad fil mellan klient och server skulle behöva
underhållas i synk manuellt. Servern är redan facit för allt
speltillstånd, så detta är även konceptuellt rätt.

Backend delar Express-process/Postgres-databas med Mahjong-
topplistan, Ordlek-maratontabellen och det gemensamma profilsystemet
— se `server/README.md` för drift/deploy av hela servern (Railway +
Supabase). Alla `ghosttrains_*`-tabeller skapas automatiskt vid
uppstart (`create table if not exists`), ingen manuell migrering
behövs.

**Identitet**: återanvänder `shared/profile.js` ("Vem spelar?") —
inget eget inloggningssystem. En profils `id` är det som skickas som
`profileId` till alla endpoints.

## Databas­lagring: två speglade implementationer

Varje stycke tillstånd finns i BÅDA en Postgres-version (`pgStore`)
och en minnesversion (`memStore`) i `server/ghosttrains.js` — samma
dubbla mönster som redan fanns i `server/index.js` för scores/profiler.
Utan `DATABASE_URL` körs allt i minnet (bra för lokal test, nollställs
vid omstart). **Ändrar du en store-metod måste du ändra båda
implementationerna.**

**Delad, muterbar state hanteras annorlunda än allt annat**: handen,
tågvagnar, poäng etc. är alltid scopade till EN profil (inga races).
Men kortmarknaden och biljettleken är delade resurser flera spelare
kan träffa samtidigt. Dessa skyddas i Postgres med en riktig
transaktion (`BEGIN; SELECT ... FOR UPDATE; ...; COMMIT;` via en
dedikerad klient, inte `pool.query`) så att två samtidiga drag aldrig
kan ge samma kort/biljett till båda. AP-förbrukning använder istället
en enda atomär `INSERT ... ON CONFLICT ... WHERE`-sats (se
`spendAP` i koden) eftersom det bara rör en tabell. **Om du lägger
till ny delad, muterbar state — återanvänd något av dessa två mönster,
inte ett enkelt "läs, mutera i JS, skriv tillbaka".**

## Kartan

`CITIES` och `ROUTES` i `server/ghosttrains.js` är den enda källan.

- **Koordinater**: beräknade från städernas verkliga lat/long via en
  enkel ekvirektangulär projektion, sedan passade mot Sverigekonturens
  uppmätta bounding box (se `ghosttrains/index.html`, sök efter
  `SWEDEN_OUTLINE_SVG` — en inbäddad, förenklad Sverigesiluett från
  [djaiss/mapsicon](https://github.com/djaiss/mapsicon), krediterad i
  en kommentar). Ändrar du en stads koordinater: verifiera att den
  fortfarande hamnar INNANFÖR konturen (`isPointInFill` i webbläsarens
  konsol går snabbt att testa manuellt) och att den inte hamnar för
  nära en granne (två städer närmare än ~20 enheter får sina prickar
  att överlappa och dölja rutten mellan dem — hände med Lund/Malmö).
- **Designprinciper** (upptäcktes/etablerades under utveckling, håll
  koll på dessa om du lägger till städer/rutter):
  - **Inga artikulationspunkter**: ingen enskild stad får, om den
    plockas bort, dela kartan i flera separata delar. Kolla med en
    enkel BFS-per-borttagen-stad (gjordes manuellt via node-skript
    under utvecklingen, finns inte som automatiserat test än).
  - **Inga grad-1-städer**: varje stad ska ha minst 2 rutter, annars
    blir den permanent otillgänglig om dess enda rutt claimas av
    någon annan (hände Kiruna, löstes med en andra rutt).
  - **Ingen samma-färg-krock i en stad**: två rutter med samma färg
    som möts i samma stad är visuellt förvirrande (vilken kräver
    vilka kort?). Kolla per stad, inte bara lokalt vid varje ny rutt.
  - **Färgbalans**: summan av rutt-längder per färg (8 färger) bör
    ligga inom ett smalt spann (senast ~9–13) — annars blir vissa
    färger värdelösa (för lite efterfrågan) eller för eftertraktade.
  - **Dubbelspår ges selektivt**, bara till hubbar (hög grad) som är
    tydliga avvikare jämfört med sina gradkamrater — inte till alla
    flaskhalsar. Kollisioner är en avsiktlig spelmekanik, inte något
    att eliminera överallt.
  - Alla dessa kontrollerades med små, engångs node-skript under
    utvecklingen (inte sparade som filer) — skriv om vid behov, det
    är enkel grafteori över `CITIES`/`ROUTES`.

## Spelregler (nuvarande implementation)

### Dagscykel & Action Points (AP)
- Varje profil får 3 AP vid midnatt (Europe/Stockholm). Oanvända AP
  sparas INTE till nästa dag.
- AP är **lat-återställda** — ingen cron behövs för det. Vid varje
  läsning/förbrukning jämförs lagrat `game_day` mot dagens datum;
  skiljer de sig får spelaren fulla 3 AP igen (se `spendAP`).
- Kostnader: blint kort-drag 1 AP, marknadsdrag 1 AP (2 AP om det
  dragna kortet är ett lokomotiv/joker — avgörs server-sidan, aldrig
  klienten), claima en rutt 2 AP, dra biljetter 1 AP.
- **Bekväm bieffekt**: en spelare kan max skicka in ETT claim per dag
  (2 av 3 AP) — flera claims samma dag som tillsammans skulle
  överskrida tågvagnsbudgeten kan alltså aldrig inträffa.

### Kortlek & marknad
- 126 kort: 14 per färg (8 färger) + 14 lokomotiv/joker.
- Delad, synlig marknad med 5 kort. Tas ett kort fylls platsen direkt
  på från leken. Innehåller marknaden 3+ lokomotiv vid något tillfälle
  kastas alla 5 och 5 nya dras.
- Claima en rutt kostar exakt `route.length` kort av ruttens färg
  (jokrar går alltid). **Kort dras vid INSKICKET, inte vid
  upplösningen** — konsumeras även om claimet senare krockar eller
  blir en Total Crash. En omdirigerad spelare betalar inga extra kort
  för ersättningsrutten.

### Claim → PENDING → nattlig upplösning
`POST /claim` validerar (kort, tågvagnar, AP) och skapar en hemlig
`PENDING`-rad — bygger INGET direkt. `resolveDay()` (körs av
`node-cron` `'0 0 * * *'` Europe/Stockholm, eller manuellt via
`POST /resolve` med hemlig header för test/drift) grupperar dagens
PENDING-claims per rutt:

1. **1 claimare** → lyckas.
2. **Exakt 2 claimare på en dubbelspårsrutt DÄR BÅDA spåren är
   lediga** → båda lyckas (tidigast → spår A, senare → spår B).
3. **Allt annat** (2+ på enkelspår, ELLER 3+ på en dubbelspårsrutt) →
   full krock för ALLA inblandade — dubbelspår ger bara automatisk
   delning vid exakt två claimare, en tredje gör det till en vanlig
   krock för alla, inte "två vinner, resten krockar".

### Omdirigering (efter en krock)
Krockade spelare söks en ersättningsrutt via BFS utåt från deras
`fromCity` (den ändstation de valde vid claimet) genom kartgrafen —
först rutter direkt vid `fromCity`, sedan en station bort, osv., tills
en ledig OCH prisvärd rutt hittas. Prisvärd = `route.length <=`
spelarens kvarvarande tågvagnar. Om det lokala området är fullt/för
dyrt söks GLOBALT över hela kartan. Redan tilldelade
ersättningsrutter i samma upplösningskörning räknas som upptagna
(sekventiell tilldelning, aldrig samma rutt till två spelare).
**Total Crash** (inget byggs, korten redan förlorade) inträffar bara
om HELA kartan är fullbyggd eller ingen ledig rutt är prisvärd för
just den spelaren — extremt ovanligt i normalt spel.

### Tågvagnar & poäng
- 35 tågvagnar per spelare. `/claim` avvisas direkt om spelaren inte
  har råd med ruttens längd (ren kontroll, ingen mutation).
- Vid lyckad upplösning (vanlig, dubbelspår, ELLER omdirigering) dras
  tågvagnar av och poäng läggs på — båda baserat på den FAKTISKT
  byggda ruttens längd (alt-ruttens vid omdirigering, inte den
  ursprungligen claimade). Poängtabell (officiell Ticket to Ride):
  längd 1→1p, 2→2p, 3→4p, 4→7p, 5→10p, 6→15p.

### Destinationsbiljetter
- 15 biljetter totalt (`TICKETS`), delad cirkulerande lek (samma
  transaktionsmönster som kortmarknaden).
- Gratis startdeal: 1 lång (12–15p) + 1 medium (7–9p) + 1 kort (3–5p),
  behåll minst 2. Delas ut lat vid en profils FÖRSTA `/state`-anrop.
- Dra fler när som helst för 1 AP: 3 nya, behåll minst 1, resten
  tillbaka till lekens botten.
- En biljett är uppfylld om dess två städer hänger ihop via ENDAST
  spelarens EGNA byggda rutter (BFS, se `isConnectedForProfile`) —
  räknas ut FÖRST vid spelslut, inte löpande.

### Spelslut
En spelares tågvagnar ≤2 efter en upplösning sätter spelstatus till
`final_round` och pekar ut NÄSTA dag som sista dagen. När den dagen
upplösts: slutpoäng räknas ut för alla spelare med biljetter
(ackumulerad ruttpoäng ± biljettpoäng), status blir `finished`.
**När `finished`: nya `/claim`, `/draw`, `/market/draw` och
`/tickets/draw` avvisas** (en tillagd regel, inte uttryckligen
specificerad men uppenbart nödvändig).

### Morgondigest ("Stories")
`GET /digest/day?day=YYYY-MM-DD` (default: igår) returnerar HELA
familjens händelser för en dag — inte bara en profils egna (medvetet
val: "vi spelar detta tillsammans"). Klienten bygger en kortsekvens
(Welcome → Success/Dubbelspår → Kollision+Reroute/Crash-kort grupperat
per rutt → Sista rundan/Game Over) och visar den som en helskärms,
tryck-navigerad "Stories"-vy. En dag-flagga i `localStorage`
(`ghosttrains:storiesSeenDay:<profileId>`) hindrar automatisk
återvisning — headerns "📰"-knapp spelar om samma dags reel på
begäran oavsett flagga.

## API-endpoints (`server/ghosttrains.js`, mountas som `/api/ghosttrains/*`)

| Endpoint | Metod | Beskrivning |
|---|---|---|
| `/map` | GET | Statisk kartdata (städer, rutter). |
| `/state?profileId=` | GET | Allt en klient behöver i en runda: hand, karta-ägarskap, AP, marknad, tågvagnar, poäng, biljetter, ev. biljett-offer, spelstatus, slutresultat. |
| `/market` | GET | Marknadens 5 kort (lat-initieras vid behov). |
| `/draw` | POST | `{profileId}` — blint kort, 1 AP. |
| `/market/draw` | POST | `{profileId, index}` — draget kort från marknaden, 1 eller 2 AP. |
| `/claim` | POST | `{profileId, routeId, fromCity, cards}` — skapar en PENDING-rad. |
| `/tickets/draw` | POST | `{profileId}` — 1 AP, skapar en biljett-offer. |
| `/tickets/choose` | POST | `{profileId, keepIds}` — löser en öppen offer. |
| `/resolve` | POST | Hemlig header `x-resolve-secret` (miljövariabel `GHOSTTRAINS_RESOLVE_SECRET`, se `server/.env.example`). Kör upplösning för en dag (default igår), idempotent. |
| `/digest/day?day=` | GET | Hela familjens loggrader för en dag (default igår). |

## Utveckling & test

```bash
cd server
npm install
npm start          # utan DATABASE_URL: minnesläge, nollställs vid omstart
```

Testa endpoints direkt med curl (se conversation-historiken för många
exempel) — vanligt mönster:

```bash
BASE=http://localhost:3000/api/ghosttrains
curl -s -X POST $BASE/draw -H 'Content-Type: application/json' -d '{"profileId":"test0001"}'
curl -s -X POST $BASE/resolve -H 'Content-Type: application/json' -d '{"day":"2026-08-23"}'
```

**Fallgrop**: `resolveDay` är idempotent per dag (`ghosttrains_resolved_days`)
— anropar du `/resolve` för en dag som redan är markerad löst, blir
svaret `{alreadyResolved: true}` och nya PENDING-rader för DEN dagen
kan aldrig upplösas. Skicka in ALLA dagens claims INNAN du anropar
`/resolve`, inte inkrementellt.

**Fallgrop**: AP-ekonomin gör det svårt att snabbt simulera flera
claims/kort-drag för samma testprofil samma dag (max 3 AP). Använd
hellre många olika engångs-profil-id:n än att försöka kringgå AP:t.

**Testa resolutionsmotorn isolerat** (rekommenderas för ändringar i
krock-/omdirigeringslogik): `resolveDay(store, day)` och `ROUTES`/
`TICKETS` är exporterade från `ghosttrains.js`. Bygg en liten fake
`store` (se conversation-historiken för exempel) istället för att gå
via HTTP/AP — mycket snabbare att konstruera exakta scenarier
(krockar, låg tågvagnsbudget, biljett-koppling) och undviker
AP-begränsningen helt.

Klienten pekas mot en lokal backend via
`localStorage.setItem('nordhammer:api', 'http://localhost:3000')`
(samma override-nyckel som `shared/profile.js` redan använder).

I produktion: Railway (server, `server/README.md`) + Vercel (klient,
root-`README.md`). Deploy sker automatiskt vid push till `main`.

## Vad som INTE är byggt (medvetet avgränsat)

- Riktiga push-notiser (Web Push/service worker) — morgondigesten
  visas istället vid nästa inloggning, vilket redan matchar
  ursprungs-PRD:ts "Upon Next Login".
- Flera parallella spelbräden/rum — ett enda delat bräde för hela
  familjen, som Ordleks maratontabell.
- Automatiserade tester för kartans designprinciper (artikulations-
  punkter, färgbalans, etc.) — kontrollerades manuellt med engångs-
  skript under utvecklingen, se ovan.
- Admin-UI för att t.ex. nollställa spelet eller justera kartan utan
  kodändring — allt görs idag genom att redigera `CITIES`/`ROUTES`/
  `TICKETS` direkt i `server/ghosttrains.js` och pusha.
