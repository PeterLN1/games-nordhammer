# Nattåget – specifikation

En digital adventskalender med gåtor för familjen Nordhammer på games.nordhammer.se. Fem spelare (Peter, Maria, Sara, Vilma, Simon) löser varje dag en lucka tillsammans från sina egna telefoner, när det passar dem under dagen.

Den här filen beskriver spelmotorn. Det riktiga innehållet (berättelse, gåtor, svar) levereras separat som en krypterad fil och ska **aldrig** läsas av den som bygger motorn. Se `CLAUDE.md`.

---

## 1. Kärnmekanik

### En lucka per dag
- Lucka *N* öppnas kl. 00:00 svensk tid (Europe/Stockholm) den *N*:e december. Startdatum anges i innehållsfilen (`start_date`).
- Framtida luckor går inte att öppna. Det kontrolleras **på servern**, aldrig bara i klienten.

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
- Kopplingen mellan plats och profil-id lagras i tabellen `nattaget_players` och sätts via en admin-endpoint (se nedan).
- En profil som inte är kopplad till en plats ser en vänlig sida: ”Nattåget är familjens julkalender. Välj din profil för att spela.”
- Det finns ingen inloggning på sajten. Det är medvetet och accepterat.

---

## 3. Skärmar (mobil först, 390 px bredd)

Designen finns som mockup. Färger och typsnitt:

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
- Titel ”Nattåget” och en rad berättelse (`subtitle` från innehållet).
- Två rutor: **Lagets stjärnor** och **Vagnar öppnade X / 24**.
- Ett rutnät 4 × 6 med luckorna:
  - **Idag:** lyktsken-färg, glöd, och ”Idag · 3/5” (antal tända lyktor).
  - **Löst:** mörk med guldkant och etiketten ”Alla fem” eller ”Arkiv”.
  - **Olöst arkiv:** som löst men utan guldkant, etikett ”Olöst”.
  - **Låst (framtida):** dämpad med hänglås.
- Under rutnätet: lagets packning (föremål), om det finns några.
- Före startdatum: en ”Kommer 1 december”-sida med prologen (`prologue`).

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
- Knapp ”Tillbaka till tåget”.

---

## 4. Låstyper och lapptyper

### Låstyper (`lock.type`)
| Typ | Inmatning | Normalisering |
|---|---|---|
| `digits` | `lock.length` rutor med siffertangentbord | bara siffror |
| `word` | `lock.length` rutor, bokstäver A–Ö | versaler, mellanslag bort |
| `coordinate` | rutnät `lock.cols` × `lock.rows`, tryck på en ruta; kolumner A, B, C …, rader 1, 2, 3 … | t.ex. `C5` |
| `choice` | knappar med `lock.options` | exakt alternativ |

Svaret jämförs efter normalisering på servern.

### Lapptyper (`fragment.kind`)
| Typ | Innehåll |
|---|---|
| `text` | `text` |
| `svg` | `text` (valfri) och `svg` (en SVG-sträng). Visas med `<img src="data:image/svg+xml;base64,…">`, aldrig som inline-HTML |
| `grid_map` | `text` (valfri), `cols`, `rows`, `cells` (`{"B3": "△", …}`). Ritas som ett rutnät med symbolerna, kolumner A– och rader 1– |
| `photo_task` | `text` (uppgiften) och `reveal` (visas efter uppladdning) |

Ingen lapp får renderas som rå HTML.

---

## 5. Innehållsfilen

### Format (klartext, JSON)
```json
{
  "version": 1,
  "title": "Nattåget",
  "subtitle": "En rad som visas på kalendern",
  "start_date": "2026-12-01",
  "timezone": "Europe/Stockholm",
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
- `epilogue.item` är valfritt.
- `days` innehåller 24 element i den riktiga filen. Testfilen har färre.

### Filer
- `server/nattaget/content.sample.json` – testinnehåll i klartext. Används **bara** när `NATTAGET_CONTENT=sample` är satt (och det riktiga innehållet inte finns, se nedan).
- `server/nattaget/content.enc` – det riktiga innehållet, krypterat. Levereras separat.

### Kryptering
`content.enc` är JSON:
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
1. **`CONTENT_KEY` är satt och `content.enc` finns** → alltid det riktiga innehållet. `NATTAGET_CONTENT` och `NATTAGET_SAMPLE_START` ignoreras, med en varning i loggen. Testinställningar som glömts kvar i Railway kan alltså aldrig ersätta det riktiga innehållet.
2. **`NATTAGET_CONTENT=sample`** → testinnehållet. Är `NATTAGET_SAMPLE_START` satt (`ÅÅÅÅ-MM-DD`) flyttas testinnehållets `start_date` dit, så att testluckor kan öppnas på riktigt i produktion före december. Klockan går som vanligt. Fel format ignoreras med en varning.
3. **Annars** har servern inget innehåll.

### När innehållet saknas
- Saknas `CONTENT_KEY` (eller `content.enc`) utan `NATTAGET_CONTENT=sample`, eller går dekrypteringen fel, har servern inget innehåll. Då svarar `/state` och `/day/:n` med **503** och `{"error": "not_ready", "message": "Nattåget är inte redo än."}`. Testinnehållet används aldrig som reserv.
- Sidan visar då ”Nattåget är inte redo än”.

---

## 6. Backend (`server/nattaget.js`, monterad på `/api/nattaget`)

Samma mönster som Ghost Trains: egen modul, tabeller skapas med `create table if not exists` vid start.

### Tabeller
```
nattaget_players   (slot text primary key, profile_id text not null unique)
nattaget_events    (id bigserial primary key, day int not null, profile_id text not null,
                    kind text not null,            -- fragment | photo | note | attempt | hint | solve
                    body text, created_at timestamptz not null default now())
nattaget_photos    (id bigserial primary key, day int not null, profile_id text not null,
                    mime text not null, data bytea not null, created_at timestamptz not null default now())
nattaget_solves    (day int primary key, profile_id text not null, mode text not null, -- together | archive
                    solved_at timestamptz not null default now())
```
Stjärnor och föremål räknas fram från händelserna och `nattaget_solves`; de lagras inte separat.

### Endpoints
Alla anrop skickar `profile` (profil-id). Okänd profil → 403.

| Metod | Sökväg | Beskrivning |
|---|---|---|
| GET | `/state?profile=` | Kalendern: titel, undertitel, prolog (före start), vilka dagar som är öppna, status per dag, antal lyktor idag, stjärnor, föremål |
| GET | `/day/:n?profile=` | En lucka: se *Vad servern får skicka* nedan |
| POST | `/day/:n/fragment` | `{profile}`. Lägger ut spelarens lapp. Bara i dagens lucka (annars 409), inte för `photo_task` (400). Går att anropa flera gånger utan att lappen läggs ut igen. Svarar `{ok, day}` |
| POST | `/day/:n/photo` | `{profile, mime, data}` (base64, jpeg/png, högst 600 kB efter klientens nedskalning till 1280 px). Lägger ut fotot och lappen |
| GET | `/photo/:id?profile=` | Hämtar ett foto |
| POST | `/day/:n/note` | `{profile, text}`, högst 280 tecken. Radbrytningar och kontrolltecken blir mellanslag. Svarar `{ok, day}` |
| POST | `/day/:n/hint` | `{profile, n}` där `n` är numret på ledtråden spelaren vill ta (nästa i tur). Om någon hann före svarar servern 409 `hint_already_taken` med den nya vyn, så att två samtidiga tryck bara kostar en stjärna. Inga fler → 409 `no_more_hints`. Löst lucka → 409 `already_solved`. Går i dagens lucka och i arkivluckor. Svarar `{ok, day}` |
| POST | `/day/:n/solve` | `{profile, answer}` → `{correct: bool, day}`. Felaktigt försök sparas som `attempt`. Högst 10 försök per spelare och dag (429). Stängt lås → 409 `lock_closed`, saknade föremål → 409 `missing_items`, redan löst → 409 `already_solved` |
| POST | `/admin/players` | `{secret, players: {peter: "<id>", …}}`. Skyddas av `NATTAGET_ADMIN_SECRET` |
| POST | `/admin/reset` | `{secret}`. Tömmer `nattaget_events`, `nattaget_photos` och `nattaget_solves`, men inte `nattaget_players`. Bara för test |

### Vad servern får skicka för en lucka
- Aldrig en framtida lucka (inte ens till admin).
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
- Aktuellt datum beräknas i `Europe/Stockholm`.
- `NATTAGET_FAKE_NOW` (ISO-tid) får sättas lokalt för test. Den ska ignoreras när `NODE_ENV=production`.

### Miljövariabler (lägg till i `server/.env.example`)
```
CONTENT_KEY=              # base64, 32 byte. Saknas → 503 "inte redo" (om inte sample)
NATTAGET_CONTENT=         # "sample" tvingar testinnehåll
NATTAGET_ADMIN_SECRET=
NATTAGET_SAMPLE_START=    # ÅÅÅÅ-MM-DD, flyttar testinnehållets startdatum (bara med sample)
NATTAGET_FAKE_NOW=        # bara lokalt
```

---

## 7. Frontend (`nattaget/index.html`)

- Samma upplägg som övriga spel: ren HTML/CSS/JS utan byggsteg, `shared/theme.js` och `shared/profile.js` i `<head>`.
- Spelet har alltid sitt mörka tema oavsett sajtens tema.
- En enda sida med vyerna kalender, lucka och löst lucka. Navigering med `#dag-3` i URL:en.
- Uppdatering: hämtar luckan var 20:e sekund medan sidan är synlig (`visibilitychange`), så att lyktor och tavla uppdateras.
- Foto: `<input type="file" accept="image/*" capture="environment">`, skalas ned i klienten med canvas innan uppladdning.
- Länk till spelet läggs i sajtens meny först när allt är klart.

---

## 8. Faser

| Fas | Innehåll | Klart när |
|---|---|---|
| 1 | Tabeller, innehållsladdning (sample + krypterad), `/state`, `/day/:n` med alla regler i *Vad servern får skicka*, tid och datumlås, admin-endpoints | Tester visar att framtida luckor, svar och andras lappar aldrig skickas |
| 2 | Kalendervyn och luckvyn med `text`-lappar, lyktor, tavla, anteckningar, `digits`-lås, löst vy, epilog och ”Så här gick det till” | Testdag 1 går att spela igenom med fem profiler |
| 3 | Arkivläge med frosteffekt, ledtrådar, stjärnor, föremål och `requires_items` | Hela testfilen går att spela, även i efterhand |
| 4 | Låstyperna `word`, `coordinate`, `choice` och lapptyperna `svg`, `grid_map`, `photo_task` med uppladdning | Testdag 2 och 3 går att spela |
| 5 | Finputs: animationer när lyktor tänds och låset öppnas, ”Kommer 1 december”-sidan, **resedagboken** (en vy där laget kan bläddra igenom alla lösta luckor i ordning, med berättelse, epilog och ”Så här gick det till”), mobiltest, felhantering | Familjen kan köra en provlucka |

---

## 9. Utanför omfattningen
- Push-notiser.
- AI-anrop när spelet körs.
- Inloggning eller annan autentisering än sajtens profiler.
