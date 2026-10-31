# Skrivguide: innehåll till Kalendern

Den här guiden är till den som skriver en kalender: berättelse, lappar, lås, ledtrådar och föremål. Den beskriver allt som motorn kan i dag och vad kontrollen kräver. Hur motorn är byggd står i [SPEC.md](SPEC.md); den behöver du inte läsa för att skriva innehåll.

**Peter spelar själv.** Han får aldrig se innehållet: inte filen i klartext, inte utkast, inte svar eller ledtrådar. Skriv inget av innehållet i en chatt som Peter läser. Han får bara den krypterade filen och utskrifter från verktygen (de innehåller aldrig något ur filen).

---

## 1. Spelet på en minut

- **Fem spelare** med var sin telefon: platserna `peter`, `maria`, `sara`, `vilma`, `simon`. De spelar när det passar under dagen, ofta på olika ställen.
- **En lucka per dag**, 1–24 luckor från `start_date`. Lucka *N* öppnas vid midnatt dag *N*, men bara om lucka *N* − 1 är löst. Luckorna löses alltså i ordning, och alla tidigare svar finns alltid i arkivet.
- **Fem lappar per lucka**, en per spelare. Var och en ser bara sin egen tills den läggs ut på den gemensamma **tavlan**. Då tänds spelarens lykta (eller ljus). En utlagd lapp syns hel för alla.
- **Låset** går att använda först när alla fem har lagt ut sina lappar samma dag. Sedan kan vem som helst slå in svaret. Felförsök syns på tavlan.
- **Anteckningar** (högst 280 tecken) är hur laget pratar med varandra.
- **Tre ledtrådar** per lucka, i stigande tydlighet. Var och en kostar laget en stjärna och syns för alla.
- **Stjärnor:** +3 om luckan löses samma dag med alla fem, +1 om den löses i efterhand.
- **Arkivet:** en lucka som inte löstes före midnatt kan lösas i efterhand. Då ser alla alla fem lapparna (under frost som skrapas bort) och låset kräver inga lyktor. **Varje lucka måste därför gå att lösa av en person ensam.**
- **Ryggsäcken:** föremål som lösta luckor gett. Ett föremål kan ha innehåll (en tabell, en karta, ett genomskinligt kort) och användas igen senare. Två föremål kan kombineras till ett nytt.
- **Epilogen** visas när luckan är löst och för berättelsen vidare.

---

## 2. Arbetsflöde

1. **Skriv** innehållet som en JSON-fil, t.ex. `jul-2026.json` (formatet nedan). Utgå gärna från [server/kalender/sample-verktyg.json](../server/kalender/sample-verktyg.json), som har ett exempel på varje verktyg.
2. **Kontrollera** filen:
   ```bash
   cd server && npm run kontroll -- /sökväg/till/jul-2026.json
   ```
   Den visar en översikt (låstyper, antal försök per dag, föremål) och alla fel, t.ex. `dag 4: lapp för simon saknas`. Rätta tills den säger `OK`. Utskriften innehåller aldrig något ur filen, så Peter kan köra den åt dig om du inte har repot.
3. **Kryptera** filen med samma nyckel som i Railway (`CONTENT_KEY`, gemensam för alla kalendrar):
   ```bash
   cd server && CONTENT_KEY=<nyckeln> npm run kryptera -- /sökväg/till/jul-2026.json
   ```
   Den kör kontrollen igen, skriver `jul-2026.enc` bredvid infilen, dekrypterar den och jämför. Nyckeln skrivs aldrig ut. Peter kan köra steget själv och klistra in nyckeln.
4. **Lämna** `jul-2026.enc` till Peter. Han lägger den i `server/kalender/`, sätter `KALENDER_ACTIVE=jul-2026` i Railway och kör `/api/kalender/admin/check`.
5. **Radera** klartextfilen när den krypterade filen är på plats, eller förvara den där Peter inte ser den.

`id` i filen och filnamnet måste vara samma (`jul-2026` → `jul-2026.enc`).

---

## 3. Filens form

```json
{
  "version": 1,
  "id": "jul-2026",
  "title": "Nattåget",
  "subtitle": "En rad som visas på kalendern",
  "start_date": "2026-12-01",
  "timezone": "Europe/Stockholm",
  "theme": { },
  "prologue": "Texten som visas före start, ovanför nedräkningen",
  "days": [ { }, { } ],
  "combine": [ ]
}
```

| Fält | Krav |
|---|---|
| `id` | små bokstäver, siffror och bindestreck, högst 40 tecken |
| `title`, `prologue` | måste finnas |
| `start_date` | `ÅÅÅÅ-MM-DD`; lucka 1 öppnas vid midnatt svensk tid den dagen |
| `days` | 1–24 luckor, numrerade 1, 2, 3 … i ordning |
| `theme` | valfritt, se avsnitt 8 |
| `combine` | valfritt, recept på föremål, se avsnitt 6 |

### En lucka

```json
{
  "day": 1,
  "title": "Förrådsvagnens kodlås",
  "intro": "Berättelsen för dagen",
  "lock": { "type": "digits", "length": 4 },
  "answer": "9137",
  "requires_items": [],
  "fragments": {
    "peter": { "kind": "text", "text": "…" },
    "maria": { "kind": "text", "text": "…" },
    "sara":  { "kind": "text", "text": "…" },
    "vilma": { "kind": "text", "text": "…" },
    "simon": { "kind": "text", "text": "…" }
  },
  "hints": ["Var man ska titta", "Hur man gör", "Ett löst delsteg"],
  "epilogue": {
    "text": "Vad som händer när luckan löses",
    "item": { "id": "nyckel12", "name": "Mässingsnyckel nr 12", "description": "…" }
  }
}
```

- `title`, `intro`, `epilogue.text` och exakt **tre** `hints` måste finnas.
- Alla fem platser måste ha en lapp.
- `requires_items`: föremål som laget måste ha för att kunna öppna låset. Varje föremål måste ges av en **tidigare** lucka (eller kombineras av föremål från tidigare luckor).
- `epilogue.item` är valfritt. Föremålens `id` måste vara unika.

### Flera lås i samma lucka

I stället för `lock` och `answer` kan en lucka ha `stages`, minst två lås i följd. När ett lås öppnas visas `after` (text och/eller svg) för alla, och nästa lås tar vid — som att öppna en låda och hitta nya kort.

```json
"stages": [
  { "lock": { "type": "word", "length": 5 }, "answer": "LARMA",
    "after": { "text": "Skåpet glider upp …", "svg": "<svg …>" } },
  { "lock": { "type": "sequence", "length": 4, "repeat": false,
              "palette": [ { "id": "rod", "label": "Röd" }, { "id": "gron", "label": "Grön" },
                           { "id": "bla", "label": "Blå" }, { "id": "gul", "label": "Gul" } ] },
    "answer": "rod,gul,gron,bla" }
]
```

De tre ledtrådarna gäller hela luckan, inte varje lås. Lägg dessa luckor på helger och i finalen; de tar längre tid.

---

## 4. Låstyper

| `type` | Fält | Svaret skrivs | Laget får per dag |
|---|---|---|---|
| `digits` | `length` (1–12) | bara siffror, exakt så många: `"9137"` | 50 (4 siffror) |
| `word` | `length` (1–12) | bokstäver A–Ö, versaler eller gemener spelar ingen roll: `"LYKTA"` | 50 |
| `coordinate` | `cols` (≤ 26), `rows` (≤ 30) | en ruta: `"C5"` (kolumn A, B, C …, rad 1 överst) | en fjärdedel av rutorna: 9 × 9 → 20 |
| `choice` | `options` (minst 2, olika) | exakt ett av alternativen | en fjärdedel: 8 alternativ → 2 |
| `sequence` | `length`, `palette` (`[{id, label?, svg?}]`, id med a–z, 0–9, -), `repeat` (standard `true`) | id:n i ordning med komma: `"rod,gul,gron,bla"` | 4 symboler ur 8 → 50 |
| `cells` | `cols`, `rows`, `count` | rutorna i valfri ordning: `"B2 D5 E3"` | 3 rutor i 6 × 6 → 50 |
| `path` | `cols`, `rows`, `count` | rutorna i ordning: `"A1 A2 B2 C2 C3"` | 50 |

- **Gissningsskydd:** laget får högst en fjärdedel av alla möjliga svar per dag (minst 1, högst 50), och varje spelare högst 10. Ett vallås med fyra alternativ ger laget **ett** försök om dagen. Kontrollen godkänner inte lås med färre än fyra möjliga svar. `max_attempts` (1–50) sänker gränsen ytterligare.
- **Återkoppling:** `"feedback": true` på `digits` och `word` gör att varje felförsök visas med ”2 rätt plats, 1 fel plats”. Gör då koden så lång (5–6 tecken) att lapparna behövs för att försöken ska räcka.
- Försöken räknas om varje dag, så en lucka kan aldrig låsas för gott.

---

## 5. Lapptyper

| `kind` | Fält | Visas som |
|---|---|---|
| `text` | `text` | text på ett papper |
| `svg` | `text` (valfri), `svg` | bild, med förstoring och ”Lägg över” för genomskinliga kort |
| `grid_map` | `text` (valfri), `cols`, `rows`, `cells` (`{"B3": "△", …}`) | rutnät med symboler, kolumner A– och rader 1– |
| `photo_task` | `text` (uppdraget), `reveal` | knappen ”Ta foto”; efter uppladdning visas `reveal` |
| `fold` | `text` (valfri), `svg`, `axis` (`vertical` standard eller `horizontal`) | bild med knappen ”Vik”: högra (nedre) halvan läggs spegelvänd över den vänstra (övre) |

**Hemlig del:** varje lapp kan ha `"private": { "text": "…", "svg": "…" }`. Den syns bara för ägaren och följer inte med ut på tavlan, så ägaren måste beskriva den med egna ord. I arkivet och när luckan är löst ser alla den.

**Fotouppdrag** granskas inte; alla foton godtas och `reveal` visas. Uppdragen måste gå att göra var man än är: ”något runt”, inte ”något i köket”.

### Bilder (svg)

- Bara ren SVG: inga skript, inga länkar, inga externa bilder eller typsnitt. Bilden visas som en bild, aldrig som HTML.
- Ange alltid `viewBox`. Rita för en skärm som är ungefär 360 px bred: tjocka linjer, stora symboler, text på minst 12 enheter i en `viewBox` på 100.
- Använd typsnittet `sans-serif` och mörka färger mot papprets ljusa bakgrund (`#F4EBDD`).
- Vikbara lappar och genomskinliga kort ritas med **genomskinlig bakgrund**.
- Allt kan förstoras med nypzoom, så små detaljer är okej i en detaljjakt — men räkna inte med att alla zoomar.

---

## 6. Föremål, ryggsäcken och recept

```json
"item": {
  "id": "signaltabell",
  "name": "Signaltabellen",
  "description": "Symboler och deras bokstäver.",
  "content": { "text": "…", "svg": "<svg …>" }
}
```

- `content` (text och/eller svg) gör föremålet till ett **verktyg** som laget öppnar i ryggsäcken och använder igen. Hänvisa till det indirekt på lapparna (”tabellen från kajutan”).
- **Genomskinligt kort:** `"content": { "svg": "…", "overlay": true }`. Under varje bild finns ”Lägg över …”; kortet kan vridas 90° och spegelvändas. Kortet och bilderna måste ha **samma `viewBox`**; kontrollen jämför kortet med bilderna i varje lucka som kräver det. Rita kortet mörkt och halvgenomskinligt med hål eller fönster (`fill-rule="evenodd"`).
- **Recept:** två föremål blir ett nytt för hela laget. Delarna finns kvar. Fel par ger ”Inget händer”.
  ```json
  "combine": [
    { "a": "kartbit-v", "b": "kartbit-h",
      "result": { "id": "hela-kartan", "name": "Hela kartan", "description": "…", "content": { "svg": "…" } } }
  ]
  ```
  En senare lucka kan kräva `hela-kartan`. Lägg en vecka mellan delarna, så att laget hinner glömma och sedan minnas.
- Låt ungefär var tredje lucka ge ett föremål, och se till att varje föremål används minst en gång till, gärna i finalen.

---

## 7. Det kontrollen kräver

`npm run kontroll` (och `/admin/check`) underkänner filen om något av detta inte stämmer:

- `id`, `title`, `start_date`, `prologue` finns och har rätt form; 1–24 luckor i ordning.
- Varje lucka har `title`, `intro`, fem lappar med giltig typ och det typen behöver, exakt tre ledtrådar och `epilogue.text`.
- Låset har giltig typ och rätt fält, och svaret passar låset (antal siffror, bokstäver A–Ö, en ruta inom rutnätet, ett av alternativen, symboler ur paletten, rätt antal rutor).
- Låset har minst fyra möjliga svar.
- `stages` har minst två lås, och `after` har text eller en giltig svg.
- Varje `requires_items` ges av en tidigare lucka eller av ett recept vars delar ges tidigare.
- Föremål har unika `id`, och innehållet har text eller en giltig svg.
- Genomskinliga kort har `viewBox`, samma som bilderna där de används.
- Recepten pekar på föremål som finns.
- `theme` har giltiga färger (`#rgb` eller `#rrggbb`), `icon` är `lantern` eller `candle`.

Kontrollen kan inte avgöra om en gåta är **lösbar**, **entydig** eller **rolig**. Det är ditt jobb (avsnitt 9).

---

## 8. Tema

```json
"theme": {
  "colors": {
    "background": "#0F1A2B", "surface": "#17253B", "surface_dark": "#0B1422", "border": "#3A4A63",
    "text": "#E8EEF5", "text_muted": "#A9B6C8", "text_soft": "#C9D3E0",
    "glow": "#F2B544", "flame": "#FFD27A", "off": "#5B6B84",
    "paper": "#F4EBDD", "paper_text": "#2A2118"
  },
  "door": { "singular": "vagn", "plural": "vagnar" },
  "back": "Tillbaka till tåget",
  "icon": "lantern"
}
```

Utan `theme` används Nattågets tema (värdena ovan). `door` är ordet för en lucka (”Vagn 3”, ”Öppnade vagnar 3 / 24”). `icon` är `lantern` (lyktor som lyser) eller `candle` (ljus som brinner).

---

## 9. Råd för bra luckor

- **Varje lapp ska behövas.** Ta bort en lapp i taget och fråga: går svaret att gissa ändå? Om ja, ge den lappen mer tyngd. Fyra av fem bokstäver räcker ofta för att gissa ett ord.
- **Tre sätt att dela upp informationen:** data och regel (fyra lappar har material, den femte säger hur det läses), parallella bitar (varje lapp ger en del av svaret), korsberoenden (varje lapp pekar på något på en annan). De bästa luckorna blandar minst två.
- **Asynkront:** ge varje lapp en liten egen uppgift som ägaren löser innan den läggs ut (räkna, avkoda, fota). Då bidrar den som spelar tidigt, och slutsatsen dras på tavlan.
- **Arkivet:** en person ensam med alla fem lappar måste kunna lösa luckan.
- **Ledtrådarna:** 1 säger var man ska titta, 2 ger metoden, 3 ger ett löst delsteg eller halva svaret — aldrig hela.
- **Entydiga svar:** välj ord utan vanliga synonymer, skriv formatet i berättelsen (”fyra siffror”, ”ttmm, 24 h”), och låt gärna svaret förekomma i berättelsen så att laget känner igen det.
- **Tid:** 10–30 minuter per lucka för hela laget. Längre gåtor och dubbla lås på helger; finalen gärna 30–45 minuter.
- **Mobilen:** stora symboler, korta texter, högst 9 × 9 i rutnät.
- **Variation över 24 dagar:** blanda logik, ordlekar, chiffer, kartor, mönster, foto, matematik, kommunikation och meta-gåtor som använder gamla svar och föremål.
- **Finalen** (lucka 24): ett dubbelt lås där varje spelares lapp pekar ut ett föremål i ryggsäcken och en tidigare lucka; tillsammans ger de svaret.

### Mekaniker som motorn stödjer

Dokumentet ”Uppgiftstyper för adventskalendern” (Claude, oktober 2026) beskriver mekanikerna i detalj. Så här motsvarar de motorn:

| Mekanik | Används med |
|---|---|
| Lagerkartan, schablonen, vittnena, lögnaren, vägbeskrivningen, tidslinjen | `grid_map`, `text`, `coordinate`, `word`, `digits` |
| Sjusegmentsdisplayen, vågskålarna, ögonblicksbilderna, loggboken | `svg`, `text` |
| Vardagsnyckeln, fotouppdragen, återblicken | `text`, `photo_task` |
| Verktyget | föremål med `content` |
| Det genomskinliga kortet | föremål med `overlay` |
| Handboken | `private` |
| Det dubbla låset | `stages` |
| Symbollåset | `sequence` |
| Rutlåset | `cells`, `path` |
| Mastermindlåset | `feedback` |
| Vikbara lappen | `fold` |
| Detaljjakten | `svg` (förstoring finns alltid) |
| Kombinera i ryggsäcken | `combine` |

**Finns inte än:** stafetten (en lapp som visar mer när en annan spelare lagt ut sin), ljudlappar, klickbara scener, sidospår över flera dagar, delad spelplan och val som förgrenar berättelsen. Be om dem i god tid om du vill använda dem.
