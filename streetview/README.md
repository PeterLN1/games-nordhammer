# Var är jag? — Street View-gissningsspel

Test-prototyp: du ser en riktig Google Street View-bild från en slumpad
plats var som helst i världen (inte begränsat till städer/kända platser).
Du kan inte förflytta dig, men du kan snurra runt och zooma. Gissa vilket
**land** bilden är tagen i. 5 rundor, max 5000 p totalt:

- Rätt land: 1000 p
- Fel land men rätt världsdel: 300 p
- Ledtrådar, fritt valbara i valfri ordning (kostar sammanlagt max 700 p):
  - 📍 Avstånd till Stockholm (−100 p)
  - 🔤 Landets första bokstav (−300 p)
  - 🌐 Grannländer (−300 p)

  Tar man alla tre ledtrådarna och gissar rätt får man ändå 300 p kvar.

## Skaffa en Google Maps API-nyckel

Spelet använder tre Google Maps Platform-API:er. Det finns en gratisnivå,
men du behöver ett Google Cloud-konto med betalinformation kopplat (se
"Kostnadsskydd" nedan för hur du undviker överraskande kostnader).

1. Gå till [Google Cloud Console](https://console.cloud.google.com/).
2. Skapa ett nytt projekt (eller använd ett befintligt), t.ex.
   "nordhammer-spel".
3. Gå till **APIs & Services → Library** och aktivera:
   - **Maps JavaScript API** (visar Street View-panoraman)
   - **Street View Static API** (används implicit av panorama-visningen)
   - **Geocoding API** (avgör vilket land en plats faktiskt ligger i)
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

## Hur platsen väljs

`countries.js` innehåller ungefärliga mittpunkter för ~110 länder. Spelet
slumpar ett land, förskjuter punkten slumpmässigt upp till 250 km åt
valfritt håll, och letar upp närmaste Street View-panorama därifrån —
bilden hamnar alltså var som helst i (eller nära) landet, inte bara i
huvudstaden. Det faktiska rätta landet avgörs sedan genom omvänd
geokodning av panoramats verkliga koordinat, så om punkten råkar hamna
strax över en landsgräns blir svaret ändå rättvist bedömt.

## Struktur

```
streetview/
├── index.html    # Spelet (Street View + land-gissning + poäng)
├── config.js     # API-nyckel
├── countries.js  # Frö-koordinater för länder (världen över)
└── README.md
```

## Vidareutveckling (idéer)

- Fler länder / bättre spridda frö-koordinater i `countries.js`.
- Tidsbegränsning per runda.
- Flerspelarläge (samma rundor, jämför poäng) — kan återanvända
  `shared/profile.js` som andra spel i repot gör.
- Svårighetsnivåer (t.ex. bara Europa, eller kontinent-läge).
