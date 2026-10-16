# Nattåget – instruktioner för Claude Code

Läs `SPEC.md` innan du börjar. Den beskriver hela spelet och i vilken ordning det ska byggas.

## Den viktigaste regeln: inga spoilers

Peter spelar själv. Det riktiga innehållet (berättelse, lappar, ledtrådar, svar) får därför aldrig visas för honom, och därmed aldrig för dig.

- **Läs, dekryptera eller visa aldrig `server/nattaget/content.enc`.** Behandla den som en ogenomskinlig binär fil. Öppna den inte, inte ens för att kontrollera formatet.
- **Läs eller skriv aldrig ut värdet av `CONTENT_KEY`.** Fråga aldrig efter det.
- **Skriv aldrig kod som loggar dekrypterat innehåll**, inte heller felsökningsloggar. Felmeddelanden får säga *att* något gick fel (”Kunde inte dekryptera innehållet”), aldrig *vad* innehållet är.
- **Kör aldrig servern med det riktiga innehållet** och anropa inga endpoints som returnerar det. Använd alltid `NATTAGET_CONTENT=sample` lokalt.
- **Bygg och testa allt mot `server/nattaget/content.sample.json`.** Det är testinnehåll och får läsas fritt.
- Om du någon gång ser riktigt innehåll av misstag: säg det till Peter direkt och upprepa det inte.

## Säkerhetsreglerna i servern
Reglerna i SPEC.md under *Vad servern får skicka* är det som gör spelet möjligt att spela. Skriv tester för dem i fas 1:
- en framtida lucka returnerar 403
- `answer` finns aldrig i något svar
- andra spelares lappar skickas bara när de är utlagda, eller i arkivläge
- `reveal` för en fotouppgift skickas bara efter uppladdning, eller i arkivläge
- ledtrådar skickas bara när de är avslöjade

## Arbetssätt
- Bygg en fas i taget, i den ordning som står i SPEC.md. Stanna efter varje fas och berätta vad som är klart och hur Peter kan testa.
- Följ repots befintliga mönster (Ghost Trains är närmaste förebild): ren HTML/CSS/JS i `nattaget/`, backendmodul i `server/nattaget.js`, tabeller skapas vid start.
- Spelare identifieras med profilens **id**, aldrig namnet.
- **En push till `main` deployar till produktion.** Det är okej, eftersom spelet inte är länkat från menyn och inga luckor öppnas före 1 december. Lägg inte till länken i menyn förrän Peter ber om det.
- Lägg till nya miljövariabler i `server/.env.example`.
