# Var är jag? — Street View-gissningsspel

Du ser en riktig Google Street View-bild från en slumpad plats var som
helst i världen (inte begränsat till städer/kända platser). Du kan inte
förflytta dig, men du kan snurra runt och zooma. Gissa vilket **land**
bilden är tagen i genom att peka på en klickbar jordglob (rotera med
drag, zooma med scroll/pinch).

- Rätt land direkt = rundan klar.
- Fel land: landet markeras grått och du får peka på ett nytt (en
  toast bekräftar felet). Landet läggs till i en lista längst upp —
  sorterad efter avstånd till rätt svar, närmast överst, och växer för
  varje gissning (som i spelet Globle). Varje rad har landets flagga.
- Max **10 gissningar per runda** — når du taket avslöjas rätt land och
  räknas som 10, och spelet går vidare.
- Varje land du pekar på (rätt eller fel) visar sitt namn direkt, så man
  lär sig geografi på vägen.
- 5 rundor per spel. Totalt antal gissningar (lägre är bättre, tid som
  utslag vid lika) skickas automatiskt till en global topplista — spela
  hur många gånger du vill, ingen daglig begränsning.

## Skaffa en Google Maps API-nyckel

Spelet använder tre Google Maps Platform-API:er (för Street View-bilden
och för att avgöra vilket land en plats faktiskt ligger i — själva
kartan man pekar på är en gratis, nyckelfri vektorkarta, se nedan). Det
finns en gratisnivå, men du behöver ett Google Cloud-konto med
betalinformation kopplat (se "Kostnadsskydd" nedan för hur du undviker
överraskande kostnader).

1. Gå till [Google Cloud Console](https://console.cloud.google.com/).
2. Skapa ett nytt projekt (eller använd ett befintligt), t.ex.
   "nordhammer-spel".
3. Gå till **APIs & Services → Library** och aktivera:
   - **Maps JavaScript API** (visar Street View-panoraman)
   - **Street View Static API** (används implicit av panorama-visningen)
   - **Geocoding API** (avgör vilket land en slumpad plats ligger i)
4. Gå till **APIs & Services → Credentials → Create Credentials → API key**.
   En nyckel skapas direkt.
5. Klicka på nyckeln för att redigera den och lägg på begränsningar
   (viktigt, annars kan andra använda din nyckel):
   - **Application restrictions → Websites**, lägg till:
     - `https://games.nordhammer.se/*`
     - `http://localhost:*/*` (för lokal testning)
   - **API restrictions → Restrict key**, välj de tre API:erna ovan.
6. Kopiera nyckeln.

## Kostnadsskydd

- **Kvoter (rekommenderas starkast):** för varje API — **APIs & Services →
  [API-namn] → Quotas & System Limits** — sätt en låg daglig gräns (t.ex.
  500 anrop/dag). Det stoppar faktiska anrop hårt istället för att bara
  varna, så en bugg eller ovanligt mycket spelande aldrig kan kosta pengar.
  **Går inte att sätta under en gratis testperiod ("trial")** i Google
  Cloud — sätt kvoterna så fort kontot är uppgraderat till ett vanligt
  betalkonto.
- **Budgetalarm (fungerar även under trial):** **Billing → Budgets &
  alerts → Create budget**, sätt ett litet belopp och trösklar (50/90/100%)
  så du får mejl om något drar iväg. Stoppar inget automatiskt, men ger en
  tidig varning.
- Nyckeln är redan domän-begränsad (steg 5 ovan), vilket skyddar mot att
  andra använder den från andra sajter.

## Lägg in nyckeln

Öppna [`config.js`](config.js) och ersätt platshållaren:

```js
window.STREETVIEW_CONFIG = {
  apiKey: "DIN_GOOGLE_MAPS_API_NYCKEL"
};
```

`config.js` committas till git (det är så statiska Vercel-sajter utan
byggsteg måste göra det för att nyckeln ska finnas i produktion) — det är
säkert så länge nyckeln är domän-begränsad enligt steg 5 ovan, precis som
Google själva rekommenderar för klientsidans Maps-nycklar.

## Hur jordgloben och gissningen fungerar

Jordgloben renderas med [globe.gl](https://github.com/vasturiano/globe.gl)
(Three.js under huven) — ingen Google-nyckel behövs för själva globen.
`world-countries.geo.json` är ett öppet, gratis dataset (Natural Earth,
via [johan/world.geo.json](https://github.com/johan/world.geo.json)) med
180 länder som riktiga klickbara polygoner. Varje land har ett ISO
alpha-3-id (t.ex. `SWE`, `FRA`).

**Viktigt om datasetet:** de flesta ringarna i filen är medurs, men
enstaka länder (upptäckt: Bermuda) har fel varvriktning, vilket får
globe.gl att rendera landets yta "inverterad" (hela klotet utom landet
själv, och alla klick tolkas som det landet). `index.html` normaliserar
varvriktningen för alla polygoner vid inläsning (`normalizeWinding()`)
— rör inte den funktionen utan att förstå varför den finns.

`countries.js` innehåller:
- `STREETVIEW_SEED_LOCATIONS` — ungefärliga mittpunkter för ~106 länder
  (bara de som faktiskt finns som egen yta i 180-landsdatasetet). Spelet
  slumpar ett av dessa, förskjuter punkten slumpmässigt upp till 250 km
  åt valfritt håll, och letar upp närmaste Street View-panorama därifrån
  — bilden hamnar alltså var som helst i (eller nära) landet, inte bara
  i huvudstaden.
- `STREETVIEW_COUNTRY_NAMES_SV` — svenska namn för alla 180 länder.
- `STREETVIEW_ALPHA2_TO_ALPHA3` — Google Geocoding ger ISO alpha-2 (t.ex.
  `SE`), kartans GeoJSON använder alpha-3 (`SWE`) — den här tabellen
  kopplar ihop dem (och används omvänd för flaggemoji).

Det faktiska rätta landet avgörs genom omvänd geokodning av panoramats
verkliga koordinat, så om punkten råkar hamna strax över en landsgräns
blir svaret ändå rättvist bedömt (även om den seedade avsikten var ett
annat land).

Avstånd i gissningslistan räknas till närmaste punkt på det gissade
landets faktiska gräns (`distanceToCountryKm()`), inte till landets
mittpunkt — annars kan ett stort grannland (t.ex. Ryssland eller Kanada)
visa flera hundra mil trots att gränsen ligger precis intill.

## Topplista

Använder samma delade Railway/Supabase-backend (`server/index.js`) som
Ordlek och Mahjong, mode `"streetview"`. Till skillnad från de andra
spelen rankas topplistan efter **flest → färst gissningar** (med tid som
utslag), inte tid — se `sortBy=moves` på `/api/leaderboard` samt
`store.topByMoves()` i `server/index.js`. Namnet hämtas automatiskt från
den valda "Vem spelar?"-profilen (`shared/profile.js`); spelet ber om en
profil innan första rundan om ingen är vald än.

## Struktur

```
streetview/
├── index.html               # Spelet (Street View + jordglob + topplista)
├── config.js                # Google Maps API-nyckel
├── countries.js              # Frö-koordinater, landnamn, alpha2->alpha3
├── world-countries.geo.json  # Klickbara landgränser (globe.gl, gratis)
└── README.md
```

## Vidareutveckling (idéer)

- Fler frö-koordinater i `STREETVIEW_SEED_LOCATIONS` för jämnare global
  spridning.
- Svårighetsnivåer (t.ex. bara Europa).
- Ljusare/mer detaljerad globtextur (just nu `earth-dark.jpg` — små
  länder kan vara svåra att träffa exakt mot den mörka bakgrunden).
