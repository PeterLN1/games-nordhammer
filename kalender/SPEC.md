# Kalendern – specifikation

Digitala kalendrar med gåtor för familjen Nordhammer på games.nordhammer.se. Fem spelare (Peter, Maria, Sara, Vilma, Simon) löser varje dag en lucka tillsammans från sina egna telefoner, när det passar dem under dagen.

Motorn byggdes för **Nattåget** (julkalendern 2026) och kör nu flera kalendrar, till exempel `halloween-2026` (7 luckor, 25–31 oktober) och `jul-2026`. En kalender i taget är aktiv; data från tidigare kalendrar finns kvar. Varje kalender har 1–24 luckor och kan ha ett eget tema (se 5.1).

Den här filen beskriver spelmotorn. Det riktiga innehållet (berättelse, gåtor, svar) levereras separat som krypterade filer och ska **aldrig** läsas av den som bygger motorn. Se `CLAUDE.md`.

---

## 1. Kärnmekanik

### En lucka per dag
- Lucka *N* öppnas tidigast kl. 00:00 svensk tid (Europe/Stockholm) dag *N*, räknat från startdatumet i innehållsfilen (`start_date`).
- **Luckorna löses i ordning.** Lucka *N* (*N* > 1) öppnas inte förrän lucka *N* − 1 är löst, oavsett datum. En lucka är alltså öppen när både dess dag har kommit och den föregående är löst.
- Löses lucka *N* − 1 i efterhand öppnas lucka *N* direkt. Är det fortfarande lucka *N*:s dag är den dagens lucka (alla fem lyktor och +3 går att få); har dagen passerat är den en arkivlucka.
- Framtida och spärrade luckor går inte att öppna eller ändra. Det kontrolleras **på servern**, aldrig bara i klienten.

### Fem lappar
- Varje lucka har en lapp (`fragment`) per spelare. Spelaren ser bara sin egen lapp.
- Spelaren trycker **”Lägg ut på tavlan”**. Då hamnar lappen på den gemensamma tavlan och spelarens lykta tänds.
- Vissa lappar är **fotouppgifter** (`kind: "photo_task"`). Spelaren laddar upp ett foto, som läggs på tavlan. Först då visas lappens text (`reveal`) och lyktan tänds.
- **Lyktor tänds bara samma dag.** En spelares lykta lyser för en lucka om spelaren lade ut sin lapp (eller sitt foto) samma dag som luckan gällde, räknat i svensk tid. En lapp som läggs ut efter midnatt tänder inte lyktan. I arkivläge visar lyktorna därför vilka som var med samma dag. Lappar kan bara läggas ut i dagens lucka.

### Låset
- Låset för dagens lucka går att använda först när **alla fem lyktor lyser**.
- När låset är öppet kan **vem som helst** slå in svaret.
- Varje felaktigt försök visas på tavlan (”Simon provade 1397”). Det är en del av känslan av att spela tillsammans.
- Löses luckan samma dag med alla fem lyktor tända blir den löst **tillsammans** (`mode: "together"`). Annars, alltså i en arkivlucka, blir den löst **i efterhand** (`mode: "archive"`).

### Arkivluckor
- En lucka som inte lösts före midnatt blir en **arkivlucka**.
- I en arkivlucka visas alla fem lappar för alla, även de som aldrig lades ut. Lapparna som inte lagts ut visas ”frosttäckta” och skrapas fram med fingret. Det är bara en visuell effekt; innehållet finns redan i klienten då. Den egna lappen är aldrig frostad. När drygt halva frosten är bortskrapad försvinner resten. Vilka lappar spelaren har skrapat fram sparas i `localStorage` på enheten, så frosten kommer inte tillbaka vid nästa besök. Med tangentbord tar Enter eller mellanslag bort frosten direkt.
- Låset i en arkivlucka går att använda direkt, utan krav på lyktor. Det räcker att en person löser den.
- Fotouppgifter i en arkivlucka: `reveal`-texten visas direkt, ingen uppladdning krävs.

### Ledtrådar och stjärnor
- Varje lucka har tre ledtrådar i stigande tydlighet. Vem som helst kan ta nästa ledtråd. Den syns för alla på tavlan.
- Lagets stjärnor (gemensamma):
  - Lucka löst samma dag med alla fem lyktor: **+3**
  - Arkivlucka löst: **+1**
  - Varje ledtråd: **−1**
  - Stjärnorna kan inte bli negativa. De räknas som summan av alla poster ovan, och blir summan negativ visas 0. Ledtrådar som tas när laget har 0 stjärnor blir alltså en skuld som dras av från stjärnor som laget får senare.

### Föremål
- En lucka kan ge ett föremål (`epilogue.item`) när den löses. Föremålet hamnar i lagets packning.
- En lucka kan kräva föremål (`requires_items`). Den kan då inte lösas förrän föremålen finns, och visar vilka som saknas.
- Lucka 24 är finalen och kräver normalt föremål från flera tidigare dagar.

### Epilog
- När en lucka löses visas `epilogue.text` och föremålet.
- Under det visas **”Så här gick det till”**, som byggs av servern från händelserna på tavlan med färdiga mallar (ingen AI). Exempel:
  - ”Maria lade första lappen kl. 07:42.”
  - ”Sara skrev den första anteckningen.”
  - ”Simon slog in koden.”
  - ”Laget behövde 1 ledtråd.” / ”Inga ledtrådar behövdes.”
  - ”Löst med alla fem.” / ”Löst i efterhand.”

### Tavlan
Tavlan per lucka visar, i tidsordning:
- utlagda lappar
- foton
- anteckningar (fritext, högst 280 tecken)
- felaktiga försök
- använda ledtrådar
- lösningen

Varje inlägg har spelarens namn och profilfärg.

---

## 2. Spelare och profiler

- Spelet använder sajtens befintliga profilsystem (`shared/profile.js`). Spelare identifieras alltid med **profilens id**, aldrig namnet.
- Innehållsfilen använder fasta platser (`slot`): `peter`, `maria`, `sara`, `vilma`, `simon`.
- Kopplingen mellan plats och profil-id lagras per kalender i tabellen `kalender_players` och sätts via en admin-endpoint (se nedan). En ny kalender behöver alltså kopplas en gång.
- En profil som inte är kopplad till en plats ser en vänlig sida: ”<Kalenderns titel> är familjens kalender. Välj din profil för att spela.”
- Det finns ingen inloggning på sajten. Det är medvetet och accepterat.

---

## 3. Skärmar (mobil först, 390 px bredd)

Designen finns som mockup. Färger och typsnitt (Nattågets tema, som används när innehållsfilen saknar `theme`; se 5.1):

| Token | Värde | Användning |
|---|---|---|
| bakgrund | `#0F1A2B` | sidan |
| yta | `#17253B` | kort, tavlans inlägg |
| yta-mörk | `#0B1422` | inmatningsfält, låsrutor |
| kant | `#3A4A63` | streckade rutor, sekundära knappar |
| text | `#E8EEF5` | brödtext |
| text-dämpad | `#A9B6C8` | etiketter, hjälptext |
| text-mjuk | `#C9D3E0` | berättelsetext |
| lyktsken | `#F2B544` | accent, tända lyktor, primärknapp |
| låga | `#FFD27A` | lyktans låga |
| släckt | `#5B6B84` | släckta lyktor |
| papper | `#F4EBDD` / text `#2A2118` | spelarens egen lapp |

- Rubriker: **DM Serif Display**. Brödtext: **Figtree**. Båda från Google Fonts.
- Varje spelares namn på tavlan visas i spelarens profilfärg.
- Ingen emoji i gränssnittet. Ikoner som inline-SVG.
- Knappar och tryckytor minst 44 px.

### 3.1 Kalendern
- Titeln (`title`) och en rad berättelse (`subtitle` från innehållet).
- Två rutor: **Lagets stjärnor** och **Öppnade <plural> X / N**, där N är antalet luckor och ordet kommer från temat (”Öppnade vagnar 3 / 24”, ”Öppnade rum 3 / 7”).
- Luckorna i rader om fyra; en ofullständig sista rad centreras (7 luckor = 4 + 3).
- Ett rutnät 4 × 6 med luckorna:
  - **Idag:** lyktsken-färg, glöd, och ”Idag · 3/5” (antal tända lyktor).
  - **Löst:** mörk med guldkant och etiketten ”Alla fem” eller ”Arkiv”.
  - **Olöst arkiv:** som löst men utan guldkant, etikett ”Olöst”.
  - **Låst (framtida):** dämpad med hänglås.
  - **Väntar på föregående** (dagen har kommit men lucka *N* − 1 är olöst): streckad kant och ”Lös <lucka> *N* − 1 först”. Ett tryck leder till luckan som väntar.
- Under rutnätet: lagets packning (föremål), om det finns några.
- Före startdatum: en ”Kommer <startdatum>”-sida med kalenderns titel, en tänd lykta eller ett ljus, en nedräkning (dagar, timmar, minuter, sekunder) till midnatt svensk tid det första datumet, och prologen (`prologue`). Nedräkningen utgår från serverns klocka (`now` i `/state`), så en felställd telefon räknar ändå rätt. Vid noll står det ”Nu öppnas <lucka> 1 …” och sidan frågar servern igen.
- Luckan heter i texterna temats ord i singular (”Vagn 3”, ”Rum 3”), och tillbakaknappen har temats text.

### 3.2 Dagens lucka
Uppifrån och ned:
1. Tillbaka-knapp, datum, stjärnor.
2. ”Lucka N”, titel och berättelse (`intro`).
3. **Lyktorna**: fem lyktor med namn. Tända lyktor glöder. Under dem en mening: ”Tre lyktor lyser. Vilma och Simon har inte hittat sina lappar än.” / ”Alla fem lyktor lyser. Låset är öppet.”
4. **Din lapp**: papperskort, lätt roterat. Knapp ”Lägg ut på tavlan” eller bocken ”Ligger på tavlan”. Fotouppgift: knapp ”Ta foto” och sedan `reveal`-texten.
5. **Tavlan**: inläggen. Saknade lappar visas som en streckad ruta: ”Väntar på Vilmas och Simons lappar …”
6. **Anteckningsfält** med ”Skicka”.
7. **Låset** (se 4. Låstyper). Låst: ”Låset går att använda när alla fem lappar ligger på tavlan.”
8. Knapp **”Ledtråd (−1 ★)”**.

### 3.3 Arkivlucka
Som dagens lucka, med skillnaderna:
- Rubriken säger ”Arkivlucka”.
- Lyktorna visar vilka som var med samma dag.
- Alla lappar visas. Lappar som aldrig lades ut är frosttäckta och skrapas fram.
- Låset är öppet direkt.

### 3.4 Löst lucka
En löst lucka är facit: hela gåtan visas. Uppifrån och ned:
- Lyktorna (alla tända om löst samma dag med alla fem).
- ”Lucka N · löst 21:48 · alla fem”, rubrik och svaret visat som låsrutor.
- Berättelsen (`intro`).
- `epilogue.text`.
- Nytt föremål, om luckan gav ett.
- ”Så här gick det till” (genererat av servern).
- **Alla fem lappar**, utan frost, med `reveal` för fotouppgifter. Lappar som aldrig lades ut är markerade.
- **Tavlan** i tidsordning.
- **Ledtrådarna**: de laget tog visas öppet med vem som tog dem. De som aldrig togs är hopfällda (”Ledtråd 3 · behövdes inte”) och fälls ut med ett tryck.
- ”Vidare till <lucka> *N* + 1” om nästa lucka är öppen, annars ”<Lucka> *N* + 1 öppnas <datum>.” under knappen.
- Knapp med temats tillbakatext (”Tillbaka till tåget”).

---

## 4. Låstyper och lapptyper

### Låstyper (`lock.type`)
| Typ | Inmatning | Normalisering |
|---|---|---|
| `digits` | `lock.length` rutor med siffertangentbord | bara siffror |
| `word` | `lock.length` rutor, bokstäver A–Ö | versaler, mellanslag bort |
| `coordinate` | rutnät `lock.cols` × `lock.rows`, tryck på en ruta; kolumner A, B, C …, rader 1, 2, 3 … | t.ex. `C5` |
| `choice` | knappar med `lock.options`; tryck för att välja, sedan ”Öppna låset” | exakt alternativ (bara mellanslag runt om tas bort) |

Svaret jämförs efter normalisering på servern.

### Lapptyper (`fragment.kind`)
| Typ | Innehåll |
|---|---|
| `text` | `text` |
| `svg` | `text` (valfri) och `svg` (en SVG-sträng). Visas med `<img src="data:image/svg+xml;base64,…">`, aldrig som inline-HTML |
| `grid_map` | `text` (valfri), `cols`, `rows`, `cells` (`{"B3": "△", …}`). Ritas som ett rutnät med symbolerna, kolumner A– och rader 1– |
| `photo_task` | `text` (uppgiften) och `reveal` (visas efter uppladdning). Knappen ”Ta foto” öppnar kameran; klienten skalar ned bilden (längsta sidan högst 1280 px) och sparar som JPEG under 600 kB. Fotot visas på tavlan |

Ingen lapp får renderas som rå HTML.

---

## 5. Innehållsfilen

### Format (klartext, JSON)
```json
{
  "version": 1,
  "id": "jul-2026",
  "title": "Nattåget",
  "subtitle": "En rad som visas på kalendern",
  "start_date": "2026-12-01",
  "timezone": "Europe/Stockholm",
  "theme": { "…": "se 5.1, valfritt" },
  "prologue": "Texten som visas före start",
  "days": [
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
      "hints": ["Ledtråd 1", "Ledtråd 2", "Ledtråd 3"],
      "epilogue": {
        "text": "Vad som händer när luckan löses",
        "item": { "id": "nyckel12", "name": "Mässingsnyckel nr 12", "description": "…" }
      }
    }
  ]
}
```
- `id`: kalenderns id, små bokstäver, siffror och bindestreck (`halloween-2026`, `jul-2026`). All data lagras under det.
- `epilogue.item` är valfritt.
- `days` innehåller 1–24 luckor, numrerade 1, 2, 3 … Lucka *N* öppnas `start_date` + *N* − 1 dagar.

### 5.1 Tema (`theme`, valfritt)
```json
"theme": {
  "colors": {
    "background": "#110D17", "surface": "#1B1524", "surface_dark": "#0A0710", "border": "#3A2F4D",
    "text": "#ECE6F3", "text_muted": "#A69CB8", "text_soft": "#CEC5DC",
    "glow": "#E3C77A", "flame": "#FFE9A8", "off": "#574C68",
    "paper": "#E6DFCF", "paper_text": "#221A12"
  },
  "door": { "singular": "rum", "plural": "rum" },
  "back": "Tillbaka till huset",
  "icon": "candle"
}
```
- Färgerna motsvarar tabellen i avsnitt 3 (bakgrund, yta, yta-mörk, kant, text, text-dämpad, text-mjuk, lyktsken, låga, släckt, papper och papperstext). Bara `#rgb` och `#rrggbb` godtas; allt annat ersätts med Nattågets värde. Text på knappar i glödfärgen blir mörk eller ljus beroende på hur ljus glöden är.
- `door`: ordet för en lucka i singular och plural (”vagn”/”vagnar”, ”rum”/”rum”).
- `back`: texten på tillbakaknappen (”Tillbaka till tåget”).
- `icon`: `lantern` (lyktor som lyser) eller `candle` (ljus som brinner). Texterna om de fem följer ikonen (”Tre lyktor lyser.” / ”Tre ljus brinner.”).
- Saknas `theme`, eller en del av det, används Nattågets värden.
- **Spöktemat** (exemplet ovan, och i testinnehållet): nästan svart med en ton av violett, levande ljus i stället för lyktor och ett svagt gult sken.

### Filer
- `server/kalender/sample.json` – testinnehåll i klartext (id `prov`, med spöktemat). Används **bara** när `KALENDER_CONTENT=sample` är satt (och det riktiga innehållet inte finns, se nedan).
- `server/kalender/<id>.enc` – det riktiga innehållet för kalendern `<id>`, krypterat. Levereras separat. Alla `.enc`-filer omfattas av reglerna i `CLAUDE.md`.

### Kryptering
Varje `<id>.enc` är JSON:
```json
{ "v": 1, "alg": "aes-256-gcm", "iv": "<base64, 12 byte>", "tag": "<base64, 16 byte>", "data": "<base64, krypterad text>" }
```
Nyckeln ligger i miljövariabeln `CONTENT_KEY` (base64, 32 byte). Dekryptering i Node:
```js
const crypto = require('crypto');
function decryptContent(file, keyB64) {
  const key = Buffer.from(keyB64, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(file.iv, 'base64'));
  d.setAuthTag(Buffer.from(file.tag, 'base64'));
  const plain = Buffer.concat([d.update(Buffer.from(file.data, 'base64')), d.final()]);
  return JSON.parse(plain.toString('utf8'));
}
```
Servern dekrypterar en gång vid start och håller innehållet i minnet. Innehållet loggas aldrig.

### Vilket innehåll som används
Servern väljer i den här ordningen:
1. **`CONTENT_KEY` är satt och `server/kalender/<KALENDER_ACTIVE>.enc` finns** → alltid det riktiga innehållet för den kalendern. Filens `id` måste vara samma som `KALENDER_ACTIVE`, annars har servern inget innehåll. `KALENDER_CONTENT` och `KALENDER_SAMPLE_START` ignoreras, med en varning i loggen. Testinställningar som glömts kvar i Railway kan alltså aldrig ersätta det riktiga innehållet.
2. **`KALENDER_CONTENT=sample`** → testinnehållet. Är `KALENDER_SAMPLE_START` satt (`ÅÅÅÅ-MM-DD`) flyttas testinnehållets `start_date` dit, så att testluckor kan öppnas på riktigt i produktion före december. Klockan går som vanligt. Fel format ignoreras med en varning.
3. **Annars** har servern inget innehåll.

### När innehållet saknas
- Saknas `CONTENT_KEY`, `KALENDER_ACTIVE` eller den aktiva kalenderns `.enc`-fil utan `KALENDER_CONTENT=sample`, eller går dekrypteringen fel, har servern inget innehåll. Då svarar `/state` och `/day/:n` med **503** och `{"error": "not_ready", "message": "Kalendern är inte redo än."}`. Testinnehållet används aldrig som reserv.
- Sidan visar då ”Kalendern är inte redo än”.

---

## 6. Backend (`server/kalender.js`, monterad på `/api/kalender`)

Samma mönster som Ghost Trains: egen modul, tabellerna skapas (eller migreras) vid start. `/api/nattaget` finns kvar som alias för sidor som telefonerna har i cacheminnet.

### Tabeller
Alla tabeller har kolumnen `calendar` (kalenderns `id`). Varje fråga gäller bara den aktiva kalendern.
```
kalender_players   (calendar, slot, profile_id; primary key (calendar, slot), unique (calendar, profile_id))
kalender_events    (id bigserial primary key, calendar text not null, day int not null, profile_id text not null,
                    kind text not null,            -- fragment | photo | note | attempt | hint | solve
                    body text, created_at timestamptz not null default now())
kalender_photos    (id bigserial primary key, calendar text not null, day int not null, profile_id text not null,
                    mime text not null, data bytea not null, created_at timestamptz not null default now())
kalender_solves    (calendar, day, profile_id, mode, -- together | archive
                    solved_at; primary key (calendar, day))
```
Stjärnor och föremål räknas fram från händelserna och `kalender_solves`; de lagras inte separat.

**Migrering:** före kalendrarna hette tabellerna `nattaget_*` och saknade `calendar`. Vid start döps de om, får kolumnen (befintliga rader hamnar i kalendern `prov`, testinnehållets id) och nya nycklar. Allt sker i en transaktion och går att köra flera gånger. Migreringen testas mot riktig Postgres (PGlite) i `server/test/kalender-db.test.js`.

### Endpoints
Alla anrop skickar `profile` (profil-id). Okänd profil → 403.

| Metod | Sökväg | Beskrivning |
|---|---|---|
| GET | `/state?profile=` | Kalendern: `calendar` (id), `theme`, titel, undertitel, prolog (före start), antal luckor, vilka dagar som är öppna, status per dag, antal lyktor idag, stjärnor, föremål. Okänd profil → 403 med bara `title` och `theme` |
| GET | `/day/:n?profile=` | En lucka: se *Vad servern får skicka* nedan |
| POST | `/day/:n/fragment` | `{profile}`. Lägger ut spelarens lapp. Bara i dagens lucka (annars 409), inte för `photo_task` (400). Går att anropa flera gånger utan att lappen läggs ut igen. Svarar `{ok, day}` |
| POST | `/day/:n/photo` | `{profile, mime, data}` (base64, eventuellt med `data:`-prefix, `image/jpeg` eller `image/png`, högst 600 kB avkodat efter klientens nedskalning till 1280 px). Lägger ut fotot och lappen och tänder lyktan. Servern kontrollerar bildens första byte mot typen. Bara i dagens lucka (409), bara för `photo_task` (400), ett foto per spelare och lucka (409 `already_posted`), för stor bild → 413. Svarar `{ok, day}`. Det här är den enda endpointen som får större kroppar än sajtens 8 kB (gränsen är 900 kB, se `photoBodyParser`) |
| GET | `/photo/:id?profile=` | Hämtar ett foto (rätt `Content-Type`, cachas privat i ett dygn). Bara för kopplade spelare (annars 403) och bara från öppnade luckor (annars 404) |
| POST | `/day/:n/note` | `{profile, text}`, högst 280 tecken. Radbrytningar och kontrolltecken blir mellanslag. Svarar `{ok, day}` |
| POST | `/day/:n/hint` | `{profile, n}` där `n` är numret på ledtråden spelaren vill ta (nästa i tur). Om någon hann före svarar servern 409 `hint_already_taken` med den nya vyn, så att två samtidiga tryck bara kostar en stjärna. Inga fler → 409 `no_more_hints`. Löst lucka → 409 `already_solved`. Går i dagens lucka och i arkivluckor. Svarar `{ok, day}` |
| POST | `/day/:n/solve` | `{profile, answer}` → `{correct: bool, day}`. Felaktigt försök sparas som `attempt`. Högst 10 försök per spelare och dag (429). Stängt lås → 409 `lock_closed`, saknade föremål → 409 `missing_items`, redan löst → 409 `already_solved` |
| POST | `/admin/players` | `{secret, players: {peter: "<id>", …}}`. Kopplar platserna i den aktiva kalendern. Skyddas av `KALENDER_ADMIN_SECRET` |
| POST | `/admin/check` | `{secret}`. Kontrollerar den aktiva innehållsfilen och svarar `{ok: true, calendar, days, message: "OK"}` eller `{ok: false, errors: [...]}`. Felen säger bara *var* något är fel, aldrig *vad* som står i filen (inga texter, svar, föremål eller id:n ur innehållet), till exempel ”dag 4: lapp för simon saknas”. Kontrollerar: id, titel, startdatum, prolog, tema, 1–24 dagar numrerade i ordning, titel och intro per dag, giltig låstyp med rätt parametrar, att svaret passar låstypen (antal siffror eller bokstäver A–Ö, en ruta inom rutnätet, ett av alternativen), fem lappar med giltig typ och det typen behöver, exakt tre ledtrådar, epilog, unika föremål och att varje `requires_items` ges av en tidigare lucka. Saknas innehållet säger svaret varför (t.ex. att `KALENDER_ACTIVE` saknas). Samma kontroll körs vid start och felen loggas. Svarar aldrig med innehåll, så den får anropas även när en riktig kalender är aktiv |
| POST | `/admin/reset` | `{secret}`. Tömmer den aktiva kalenderns händelser, foton och lösningar, men inte spelarna och inget från andra kalendrar. Bara för test |

### Vad servern får skicka för en lucka
- Aldrig en framtida lucka (inte ens till admin), och aldrig en lucka vars föregående lucka är olöst. Båda svarar 403 med bara `{"error": "locked", "reason": "date"}` respektive `{"error": "locked", "reason": "previous", "waitingFor": N − 1}`, för läsning och för alla ändringar (lapp, foto, anteckning, ledtråd, lås).
- I `/state` har en låst lucka bara `day` och `status`, plus `waitingFor` när den väntar på föregående lucka.
- `next`: `{day, open}` för nästa lucka (eller `null` för den sista), så att den lösta vyn kan visa ”Vidare till …”.
- Aldrig `answer`.
- `intro`, `title`, `lock` (utan svaret), `requires_items` och vilka som saknas.
- Spelarens **egen** lapp. För `photo_task`: `reveal` bara efter att spelaren lagt upp foto, i arkivläge eller när luckan är löst.
- Andra spelares lappar **bara** om de är utlagda på tavlan, i arkivläge eller när luckan är löst.
- Ledtrådar bara om de är avslöjade, eller när luckan är löst. Varje ledtråd har `n`, `text`, `taken` och `by` (platsen som tog den, annars `null`).
- **När luckan är löst skickas hela gåtan:** alla fem lappar (med `reveal` och `posted`), hela tavlan (även foton) och alla ledtrådar, där de som aldrig togs har `taken: false`. `answer` skickas ändå aldrig. Svaret finns bara som `solution`.
- `epilogue` och ”Så här gick det till” bara när luckan är löst.
- `solution` bara när luckan är löst: svaret efter normalisering, så att den lösta vyn kan visa det som låsrutor (3.4). Fältet heter aldrig `answer`, och det finns inte i en olöst lucka.
- `day` är samma vy i svaren från `fragment`, `note` och `solve`, så att klienten slipper hämta luckan igen.
- Lyktorna, tavlan och status (`today` | `archive` | `solved`).

### Tid
- `/state` skickar serverns klocka som `now` (ISO-tid), för nedräkningen före start.
- Aktuellt datum beräknas i `Europe/Stockholm`.
- `KALENDER_FAKE_NOW` (ISO-tid) får sättas lokalt för test. Den ska ignoreras när `NODE_ENV=production`.

### Miljövariabler (lägg till i `server/.env.example`)
```
CONTENT_KEY=              # base64, 32 byte, samma för alla kalendrar. Saknas → 503 "inte redo" (om inte sample)
KALENDER_ACTIVE=          # id för den aktiva kalendern, t.ex. halloween-2026 → server/kalender/halloween-2026.enc
KALENDER_CONTENT=         # "sample" = testinnehållet
KALENDER_ADMIN_SECRET=
KALENDER_SAMPLE_START=    # ÅÅÅÅ-MM-DD, flyttar testinnehållets startdatum (bara med sample)
KALENDER_FAKE_NOW=        # bara lokalt
```
De gamla namnen `NATTAGET_*` läses fortfarande som reserv, med en varning i loggen, tills de döpts om i Railway.

---

## 7. Frontend (`kalender/index.html`, på `/kalender/`)

- `/nattaget/` omdirigerar till `/kalender/` (och behåller `#dag-N`).
- Temat från servern sätts som CSS-variabler och sparas i `localStorage`, så att sidan inte blinkar i fel färger nästa gång.

- Samma upplägg som övriga spel: ren HTML/CSS/JS utan byggsteg, `shared/theme.js` och `shared/profile.js` i `<head>`.
- Spelet har alltid kalenderns eget tema oavsett sajtens ljusa eller mörka läge.
- En enda sida med vyerna kalender, lucka och löst lucka. Navigering med `#dag-3` i URL:en.
- Uppdatering: hämtar luckan var 20:e sekund medan sidan är synlig (`visibilitychange`), så att lyktor och tavla uppdateras. Inte medan någon skriver, skrapar frost eller laddar upp ett foto.
- Rörelse: en lykta eller ett ljus som tänds medan man tittar flammar upp (bara de som just tänts, inte de som redan lyste när sidan öppnades), och tända lågor fladdrar svagt. När låset öppnas glöder låsrutan och bygeln slår upp. Vid rätt svar lyser rutorna, låset öppnas och den lösta vyn glider in med svaret ruta för ruta. Allt stängs av med `prefers-reduced-motion`.
- Felhantering: varje anrop ger upp efter 15 s (20 s för foton). Svarar servern inte, eller svarar med ett serverfel, under en tyst uppdatering ligger vyn kvar och en rad överst säger ”Ingen kontakt med servern. Försöker igen …”; raden försvinner vid nästa lyckade hämtning eller när telefonen är online igen. Misslyckade åtgärder visar ett kort meddelande. Oväntade fel i sidan ger ”Något gick fel. Ladda om sidan om det inte fungerar.”
- Foto: `<input type="file" accept="image/*" capture="environment">`, skalas ned i klienten med canvas innan uppladdning.
- Spelet är länkat från spelhubben (`index.html`) som kortet ”Kalendern”.

---

## 8. Faser

| Fas | Innehåll | Klart när |
|---|---|---|
| 1 | Tabeller, innehållsladdning (sample + krypterad), `/state`, `/day/:n` med alla regler i *Vad servern får skicka*, tid och datumlås, admin-endpoints | Tester visar att framtida luckor, svar och andras lappar aldrig skickas |
| 2 | Kalendervyn och luckvyn med `text`-lappar, lyktor, tavla, anteckningar, `digits`-lås, löst vy, epilog och ”Så här gick det till” | Testdag 1 går att spela igenom med fem profiler |
| 3 | Arkivläge med frosteffekt, ledtrådar, stjärnor, föremål och `requires_items` | Hela testfilen går att spela, även i efterhand |
| 4 | Låstyperna `word`, `coordinate`, `choice` och lapptyperna `svg`, `grid_map`, `photo_task` med uppladdning | Testdag 2 och 3 går att spela |
| 5 | Finputs: animationer när lyktor tänds och låset öppnas, ”Kommer <startdatum>”-sidan med nedräkning, mobiltest, felhantering. **Resedagboken** (en vy där laget kan bläddra igenom alla lösta luckor i ordning, med berättelse, epilog och ”Så här gick det till”) väntar till julen | Familjen kan köra en provlucka |
| Kalendrar | Flera kalendrar med `id` och kolumnen `calendar` i alla tabeller, `KALENDER_ACTIVE`, sidan på `/kalender/`, 1–24 luckor, `theme` (spöktemat i testinnehållet), `/admin/check` | Halloween-kalendern (7 luckor, 25–31 oktober) kan köras, klar senast 22 oktober |

---

## 9. Utanför omfattningen
- Push-notiser.
- AI-anrop när spelet körs.
- Inloggning eller annan autentisering än sajtens profiler.
