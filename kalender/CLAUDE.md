# Kalendern (Nattåget, Halloween …) – instruktioner för Claude Code

Läs `SPEC.md` innan du börjar. Den beskriver hela spelet och i vilken ordning det ska byggas.

## Den viktigaste regeln: inga spoilers

Peter spelar själv. Det riktiga innehållet (berättelse, lappar, ledtrådar, svar) får därför aldrig visas för honom, och därmed aldrig för dig. Reglerna gäller **alla kalendrar**, nuvarande och kommande.

- **Läs, dekryptera eller visa aldrig någon `.enc`-fil** — varken `server/kalender/<id>.enc` (till exempel `halloween-2026.enc` eller `jul-2026.enc`) eller någon annan krypterad innehållsfil. Behandla dem som ogenomskinliga binära filer. Öppna dem inte, inte ens för att kontrollera formatet.
- **Läs eller skriv aldrig ut värdet av `CONTENT_KEY`.** Fråga aldrig efter det.
- **Skriv aldrig kod som loggar dekrypterat innehåll**, inte heller felsökningsloggar. Felmeddelanden får säga *att* något gick fel (”Kunde inte dekryptera innehållet”), aldrig *vad* innehållet är.
- **Kör aldrig servern med det riktiga innehållet** och anropa inga endpoints som returnerar det. Använd alltid `KALENDER_CONTENT=sample` lokalt. Sätt aldrig `CONTENT_KEY` lokalt.
- **Bygg och testa allt mot `server/kalender/sample.json`.** Det är testinnehåll och får läsas fritt.
- I produktion får du anropa `/state` och `/day/:n` bara när testinnehållet är aktivt (`KALENDER_CONTENT=sample` och ingen `CONTENT_KEY`). När en riktig kalender är aktiv: anropa bara endpoints som inte returnerar innehåll (t.ex. `/admin/check`, som bara svarar OK eller ett fel).
- Om du någon gång ser riktigt innehåll av misstag: säg det till Peter direkt och upprepa det inte.

## Ny kalender (t.ex. halloween-2026, jul-2026)
1. Peter lägger `server/kalender/<id>.enc` i repot. Öppna den inte.
2. I Railway: `KALENDER_ACTIVE=<id>` (och `CONTENT_KEY`, som Peter sätter själv). Ta bort `KALENDER_CONTENT` och `KALENDER_SAMPLE_START` när provkörningen är över.
3. `POST /api/kalender/admin/check` med hemligheten ska svara OK. Felen säger bara var något är fel; be Peter rätta filen.
4. Koppla spelarna för den nya kalendern med `POST /api/kalender/admin/players` (kopplingen gäller per kalender).

Felmeddelanden från `checkContent()` och innehållsladdningen får **aldrig** innehålla något ur filen — bara dag, plats, fält och låstyp. Det finns tester som kontrollerar det; håll dem gröna.

## Säkerhetsreglerna i servern
Reglerna i SPEC.md under *Vad servern får skicka* är det som gör spelet möjligt att spela. Skriv tester för dem i fas 1:
- en framtida lucka returnerar 403
- `answer` finns aldrig i något svar
- andra spelares lappar skickas bara när de är utlagda, eller i arkivläge
- `reveal` för en fotouppgift skickas bara efter uppladdning, eller i arkivläge
- ledtrådar skickas bara när de är avslöjade

## Arbetssätt
- Bygg en fas i taget, i den ordning som står i SPEC.md. Stanna efter varje fas och berätta vad som är klart och hur Peter kan testa.
- Följ repots befintliga mönster (Ghost Trains är närmaste förebild): ren HTML/CSS/JS i `kalender/`, backendmodul i `server/kalender.js`, tabeller skapas och migreras vid start. Tester: `cd server && npm test` (databastesterna kör riktig Postgres via PGlite).
- Spelare identifieras med profilens **id**, aldrig namnet.
- **En push till `main` deployar till produktion**, och kalendern är länkad från spelhubben (`index.html`) sedan oktober 2026. Familjen spelar på riktigt: testa lokalt innan du pushar. Ändringar i databasen måste vara migreringar som behåller data från tidigare kalendrar.
- Lägg till nya miljövariabler i `server/.env.example`.
