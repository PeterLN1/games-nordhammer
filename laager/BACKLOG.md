# Läger — backlog

Vad som är kvar att göra, ungefär i prioritetsordning. Det som redan är
gjort finns i `git log` — den här filen är bara framåtblickande.

Innan du börjar: läs `test/buildSystem.test.mjs` och kör `npm test`
(från `laager/`) för att se att allt fortfarande är grönt. Kör det
igen innan du committar något som rör `src/build/` eller
`src/world/collision.js`.

## Byggsystemet — UX (från utvärderingen)

- **Statustext på spöket** under placering: "fäster i hörn" / "fritt
  placerad" / "hittar ingen vägg att vila på" osv. Just nu är alla
  snap-regler osynliga tills man råkar hitta dem.
- **Fågelperspektiv-växel** för precisionsbygge (växla kameran till
  rakt ovanifrån). Löser en del av "svårt att klicka rätt"-problemet
  ytterligare, utöver raycast-fixen som redan finns.
- **Färdiga husmallar**: ett tryck droppar en grundstomme (stolpe +
  platta + väggar + tak) som man sedan justerar/river delar av, i
  stället för 15-25 separata tryck för ett hus.
- **Ångra senaste bygget**: en snabb-ångra utanför riv-läget. Riv-läge
  fungerar redan som ångra (med återbetalning) men kräver läges-byte.

## Dygn / väder

- Dygnscykeln kan redan ställas manuellt (regla get i HUD:en) men går
  inte automatiskt — `sky.setSpeed(hoursPerSecond)` i
  `src/world/sky.js` är redan kopplad i renderloopen, den är bara
  aldrig anropad. Att koppla på auto-cykel är alltså en enda rad + en
  UI-växel, ingen ombyggnad.
- Väder (regn/snö/vind) kopplat till dygnet — inte påbörjat.
- Byggnader ska ge faktiskt skydd mot väder/hot (det ursprungliga
  syftet med hela byggsystemet) — kollisionssystemet finns
  (`src/world/collision.js`) men inget väder/hot att skyddas mot än.

## Fiender / hot

Inte påbörjat alls. Kollisionssystemet (spelare vs väggar/stora
stenar/träd, våningsmedvetet via `FLOOR_TOLERANCE`) är den bit som
skulle behövas för att t.ex. ett djur/monster också ska kunna
blockeras av väggar — samma `blocked()`-logik i collision.js borde gå
att återanvända för fiende-AI:s rörelse också.

## Större satsningar (fundera innan ni börjar, inte bara "bygg det")

- **Riktigt våningssystem**: grunden finns redan (våning avgörs via
  `FLOOR_TOLERANCE` i collision.js — samma idé som redan löser
  "vägg på plattform blockerar inte marken"). Att göra det till en
  explicit, valbar "vilken våning bygger jag på"-funktion är nästa
  steg om flervåningshus efterfrågas.
- **Ångra/gör om-stack** (utöver riv-läget).
- **Visuell snap-förhandsvisning** innan man trycker (visa alla giltiga
  snap-punkter som prickar/highlights, inte bara efter att man redan
  tryckt).

## Känt men lågprioriterat

- Gavelväggen bygger nu EN korrekt stor triangel som täcker hela den
  sammanhängande väggraden (fixat), men stödjer bara raka gavlar — inga
  fönster/dörr-urklipp i gaveln, inget för icke-rektangulära rum.
- En git-commit (`2fbdcd0`) fick av misstag samma titel som en gammal
  commit från en tidigare session — själva innehållet/ändringarna är
  korrekta, bara titeln är en förvirrande dubblett. Inte åtgärdat
  (skulle kräva force-push av redan pushad historik). Ofarligt att
  lämna, men värt att veta om ni grep:ar i commit-titlar.

## Testsviten

`laager/test/buildSystem.test.mjs` (kör med `npm test` i `laager/`)
kör spelets riktiga bygglogik i ren Node — inga skärmdumpar, klart på
under en sekund. Bygger ~50 rumsformer/vinklar och kollar
hörnplacering, vägg/tak/gavel-spann, kollision runt hörn, och
takgenomskinlighet. Lägg till nya scenarier här när ni hittar/misstänker
nya buggar i stället för att bara fixa och gå vidare — det är
skillnaden mellan "fixat en gång" och "fixat och stannar fixat".
