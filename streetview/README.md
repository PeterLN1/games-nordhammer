# Var är jag? — Street View-gissningsspel

Test-prototyp: en GeoGuessr-liknande gissningslek. Spelet visar en riktig
Google Street View-panorama och du gissar platsen på en världskarta
(OpenStreetMap/Leaflet, ingen nyckel behövs för själva kartan). 5 rundor,
poäng efter avstånd till rätt plats (max 5000 p/runda).

## Skaffa en Google Maps API-nyckel

Street View kräver en nyckel från Google. Det finns en gratisnivå
(månatlig kredit), men du behöver ett Google Cloud-konto med
betalinformation kopplat (Google debiterar inte om du håller dig under
kreditgränsen, men kortet måste vara registrerat).

1. Gå till [Google Cloud Console](https://console.cloud.google.com/).
2. Skapa ett nytt projekt (eller använd ett befintligt), t.ex.
   "nordhammer-spel".
3. Gå till **APIs & Services → Library** och aktivera:
   - **Maps JavaScript API**
   - **Street View Static API**
4. Gå till **APIs & Services → Credentials → Create Credentials → API key**.
   En nyckel skapas direkt.
5. Klicka på nyckeln för att redigera den och lägg på begränsningar
   (viktigt, annars kan andra använda din nyckel):
   - **Application restrictions → HTTP referrers (web sites)**, lägg till:
     - `https://games.nordhammer.se/*`
     - `http://localhost:*` (för lokal testning)
   - **API restrictions → Restrict key**, välj de två API:erna ovan.
6. Kopiera nyckeln.

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

## Struktur

```
streetview/
├── index.html    # Spelet (Street View + gissningskarta + poäng)
├── config.js     # API-nyckel
├── locations.js  # Pool av platser med bra Street View-täckning
└── README.md
```

## Vidareutveckling (idéer)

- Fler/bättre platser i `locations.js`, ev. per kontinent/svårighetsgrad.
- Tidsbegränsning per runda.
- Flerspelarläge (samma rundor, jämför poäng) — kan återanvända
  `shared/profile.js` som andra spel i repot gör.
- Svårighetsnivåer (t.ex. bara Sverige, eller dölj vägskyltar).
