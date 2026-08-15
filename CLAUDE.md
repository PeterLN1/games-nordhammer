# Instruktioner för Claude — games-nordhammer

## Ordlek: avslöja aldrig dagens eller framtida ord i chatten

Berätta inte vilket dagens ord (eller ett kommande dagens ord) i Ordlek
är, i chattsvar till användaren — om användaren inte uttryckligen
frågar efter det.

**Varför:** hela poängen med Ordlek är att gissa ordet själv. Om svaret
råkar dyka upp i chatten (t.ex. vid felsökning, tester eller när
ordlistan diskuteras) spoilar det gissningen för den som läser eller
spelar efteråt.

**Hur det tillämpas:**
- Vid felsökning/tester av `ordlek/` (t.ex. `dailyAnswer(...)`,
  `state.answer`, `ORDLEK_DAILY_OVERRIDES`): kör och verifiera gärna
  internt, men skriv inte ut själva ordet i svaret till användaren om
  det inte uttryckligen efterfrågats.
- Undantag: användaren frågar rakt ut ("vad är dagens ord?", "har X
  varit?") — då är det förstås okej att svara.
