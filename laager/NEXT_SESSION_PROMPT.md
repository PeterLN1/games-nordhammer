Jag jobbar vidare på "Läger" (games-nordhammer/laager) — ett 3D
mobil-webb survival/bygg-spel (Three.js, ES-moduler, ingen
build-process, statisk sajt, deployas via Vercel/git push till main).

Innan du gör något annat:
1. Läs `laager/BACKLOG.md` — det är den prioriterade listan över vad
   som är kvar. Fråga mig vilken punkt vi ska ta, om det inte redan
   framgår av mitt nästa meddelande.
2. Kör `cd laager && npm test` för att se att den automatiska
   testsviten (`laager/test/buildSystem.test.mjs`) är grön innan du
   börjar. Den kör spelets riktiga bygg-/kollisionslogik i ren Node
   (inga skärmdumpar, klart på under en sekund) och bygger ~50
   rumsformer/vinklar för att fånga regressioner. Kör den igen efter
   varje ändring i `src/build/` eller `src/world/collision.js`, och
   lägg till nya testfall där när du hittar/misstänker en bugg i
   stället för att bara fixa och gå vidare.
3. `laager/package.json`/`node_modules` (three.js som devDependency)
   finns BARA för testsviten — själva spelet laddar three.js via ett
   importmap från en CDN i `index.html`, ingen build-process för
   sajten. Rör inte det.

Arbetssätt i tidigare sessioner (funkade bra, fortsätt så):
- Lokal testserver: `.claude/nocache_server.py` + `.claude/launch.json`
  (namn `"static"`, port 8934) — öppna via
  `preview_start({name:"static"})`, sidan för spelet är `/laager/`.
- Webbläsarfliken i den här miljön är en bakgrundsflik — rAF/render-
  loopen kan vara ordentligt strypt där, vilket gör manuell
  skärmdumps-verifiering av spellogik opålitlig (kamera-vy återställs,
  matriser blir inaktuella). Verifiera ny bygg-/kollisionslogik i
  Node-testsviten först (den har inga sådana problem), och använd
  webbläsaren bara för en sista visuell sanity-koll (en skärmdump)
  efter att logiken redan är bevisat rätt.
- Jag vill ha commit+push automatiskt när en uppgift är klar (push
  till main auto-deployar till produktion). Commit-meddelanden på
  svenska, i samma stil som tidigare commits (`git log` för
  referens).

Fråga mig vad nästa uppgift är, eller föreslå den högst prioriterade
punkten från BACKLOG.md om jag inte redan sagt något.
