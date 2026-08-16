// Google Maps API-nyckel för Street View-spelet.
//
// Skapa en nyckel i Google Cloud Console (se README i denna mapp för steg-
// för-steg-instruktioner) och klistra in den nedan. Nyckeln körs i klienten
// (precis som Google Maps normalt fungerar) — begränsa den till din domän
// under "API restrictions" / "Application restrictions: HTTP referrers" i
// Google Cloud Console, så är det säkert att ha den i koden.
//
// Aktivera minst dessa API:er för nyckeln i Google Cloud Console:
//   - Maps JavaScript API
//   - Street View Static API (används implicit av panorama-visningen)
window.STREETVIEW_CONFIG = {
  apiKey: "AIzaSyDzHicZYe-2x8kxubuduv8zazqVLA22h0Y"
};
