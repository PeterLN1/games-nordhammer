// Referensdata för "Var är jag?" v2 (peka-på-kartan).
//
// Kartan (world-countries.geo.json) har 180 länder som riktiga polygoner,
// med ISO alpha-3-koder som id (t.ex. "SWE", "FRA"). Google Geocoding API
// ger oss ISO alpha-2 ("SE", "FR") för den verkliga platsen — därför
// STREETVIEW_ALPHA2_TO_ALPHA3 nedan, för att kunna slå ihop de två.

// Frö-koordinater (ungefärlig mittpunkt) för länder, spridda över hela
// jorden. Spelet slumpar ett land, gör en liten slumpmässig förskjutning
// (jitter) runt mittpunkten och letar upp närmaste Street View-panorama
// därifrån (se index.html) — så bilden hamnar var som helst i landet, inte
// bara i huvudstaden. Endast länder som faktiskt finns som egen yta på
// kartan ska vara med här (annars går rätt svar inte att peka ut) — t.ex.
// Singapore, Mauritius och Réunion är för små för att finnas med i
// 180-landsdatasetet och är därför uteslutna.
window.STREETVIEW_SEED_LOCATIONS = [
  { code: "SWE", lat: 62.0, lng: 15.0 },
  { code: "NOR", lat: 62.0, lng: 10.0 },
  { code: "DNK", lat: 56.0, lng: 10.0 },
  { code: "FIN", lat: 64.0, lng: 26.0 },
  { code: "ISL", lat: 65.0, lng: -18.0 },
  { code: "GBR", lat: 54.0, lng: -2.0 },
  { code: "IRL", lat: 53.0, lng: -8.0 },
  { code: "FRA", lat: 46.6, lng: 2.4 },
  { code: "DEU", lat: 51.2, lng: 10.4 },
  { code: "NLD", lat: 52.2, lng: 5.3 },
  { code: "BEL", lat: 50.6, lng: 4.5 },
  { code: "LUX", lat: 49.8, lng: 6.1 },
  { code: "CHE", lat: 46.8, lng: 8.2 },
  { code: "AUT", lat: 47.6, lng: 14.1 },
  { code: "ITA", lat: 42.8, lng: 12.6 },
  { code: "ESP", lat: 40.0, lng: -4.0 },
  { code: "PRT", lat: 39.6, lng: -8.0 },
  { code: "POL", lat: 52.0, lng: 19.0 },
  { code: "CZE", lat: 49.8, lng: 15.5 },
  { code: "SVK", lat: 48.7, lng: 19.5 },
  { code: "HUN", lat: 47.2, lng: 19.5 },
  { code: "ROU", lat: 45.9, lng: 25.0 },
  { code: "BGR", lat: 42.7, lng: 25.5 },
  { code: "GRC", lat: 39.0, lng: 22.0 },
  { code: "HRV", lat: 45.1, lng: 15.2 },
  { code: "SVN", lat: 46.1, lng: 14.8 },
  { code: "BIH", lat: 44.2, lng: 17.8 },
  { code: "SRB", lat: 44.0, lng: 21.0 },
  { code: "MNE", lat: 42.7, lng: 19.3 },
  { code: "MKD", lat: 41.6, lng: 21.7 },
  { code: "ALB", lat: 41.0, lng: 20.0 },
  { code: "EST", lat: 58.6, lng: 25.0 },
  { code: "LVA", lat: 56.9, lng: 24.6 },
  { code: "LTU", lat: 55.3, lng: 23.9 },
  { code: "UKR", lat: 48.4, lng: 31.2 },
  { code: "MDA", lat: 47.2, lng: 28.5 },
  { code: "MLT", lat: 35.9, lng: 14.5 },
  { code: "CYP", lat: 35.1, lng: 33.4 },

  { code: "USA", lat: 39.8, lng: -98.5 },
  { code: "CAN", lat: 56.1, lng: -106.3 },
  { code: "MEX", lat: 23.6, lng: -102.5 },
  { code: "GTM", lat: 15.8, lng: -90.2 },
  { code: "BLZ", lat: 17.2, lng: -88.5 },
  { code: "HND", lat: 15.2, lng: -86.2 },
  { code: "CRI", lat: 9.7, lng: -83.8 },
  { code: "PAN", lat: 8.5, lng: -80.8 },
  { code: "CUB", lat: 21.5, lng: -77.8 },
  { code: "JAM", lat: 18.1, lng: -77.3 },
  { code: "DOM", lat: 18.7, lng: -70.2 },
  { code: "PRI", lat: 18.2, lng: -66.6 },
  { code: "COL", lat: 4.6, lng: -74.3 },
  { code: "VEN", lat: 6.4, lng: -66.6 },
  { code: "ECU", lat: -1.8, lng: -78.2 },
  { code: "PER", lat: -9.2, lng: -75.0 },
  { code: "BOL", lat: -16.3, lng: -63.6 },
  { code: "CHL", lat: -35.7, lng: -71.5 },
  { code: "ARG", lat: -38.4, lng: -63.6 },
  { code: "URY", lat: -32.5, lng: -55.8 },
  { code: "PRY", lat: -23.4, lng: -58.4 },
  { code: "BRA", lat: -14.2, lng: -51.9 },

  { code: "ZAF", lat: -30.6, lng: 22.9 },
  { code: "BWA", lat: -22.3, lng: 24.7 },
  { code: "NAM", lat: -22.9, lng: 18.5 },
  { code: "LSO", lat: -29.6, lng: 28.2 },
  { code: "SWZ", lat: -26.5, lng: 31.5 },
  { code: "KEN", lat: 0.0, lng: 37.9 },
  { code: "UGA", lat: 1.4, lng: 32.3 },
  { code: "RWA", lat: -1.9, lng: 29.9 },
  { code: "TZA", lat: -6.4, lng: 34.9 },
  { code: "SEN", lat: 14.5, lng: -14.5 },
  { code: "GHA", lat: 7.9, lng: -1.0 },
  { code: "NGA", lat: 9.1, lng: 8.7 },
  { code: "EGY", lat: 26.8, lng: 30.8 },
  { code: "TUN", lat: 34.0, lng: 9.5 },
  { code: "MAR", lat: 31.8, lng: -7.1 },
  { code: "MDG", lat: -18.8, lng: 47.0 },

  { code: "TUR", lat: 39.0, lng: 35.0 },
  { code: "ISR", lat: 31.5, lng: 34.8 },
  { code: "JOR", lat: 31.2, lng: 36.2 },
  { code: "ARE", lat: 24.0, lng: 54.0 },
  { code: "SAU", lat: 24.0, lng: 45.0 },
  { code: "QAT", lat: 25.3, lng: 51.2 },
  { code: "KWT", lat: 29.3, lng: 47.5 },
  { code: "OMN", lat: 21.5, lng: 57.5 },
  { code: "IND", lat: 21.0, lng: 78.0 },
  { code: "LKA", lat: 7.9, lng: 80.8 },
  { code: "NPL", lat: 28.2, lng: 84.0 },
  { code: "BGD", lat: 23.7, lng: 90.4 },
  { code: "THA", lat: 15.9, lng: 100.9 },
  { code: "MYS", lat: 4.2, lng: 101.9 },
  { code: "IDN", lat: -2.5, lng: 118.0 },
  { code: "PHL", lat: 12.9, lng: 121.8 },
  { code: "VNM", lat: 14.1, lng: 108.3 },
  { code: "KHM", lat: 12.6, lng: 105.0 },
  { code: "LAO", lat: 19.9, lng: 102.6 },
  { code: "CHN", lat: 35.0, lng: 105.0 },
  { code: "JPN", lat: 36.2, lng: 138.3 },
  { code: "KOR", lat: 36.5, lng: 127.9 },
  { code: "TWN", lat: 23.7, lng: 121.0 },
  { code: "MNG", lat: 46.9, lng: 103.8 },
  { code: "KAZ", lat: 48.0, lng: 66.9 },
  { code: "GEO", lat: 42.3, lng: 43.4 },
  { code: "ARM", lat: 40.1, lng: 45.0 },
  { code: "AZE", lat: 40.1, lng: 47.6 },

  { code: "AUS", lat: -25.3, lng: 133.8 },
  { code: "NZL", lat: -41.0, lng: 174.0 }
];

// Svenska namn för alla 180 länder i world-countries.geo.json (nyckel =
// samma id som i GeoJSON-filen, dvs mestadels ISO alpha-3, plus "CS-KM"
// för Kosovo som saknar en officiell ISO-kod).
window.STREETVIEW_COUNTRY_NAMES_SV = {
  AFG: "Afghanistan", AGO: "Angola", ALB: "Albanien", ARE: "Förenade Arabemiraten",
  ARG: "Argentina", ARM: "Armenien", ATA: "Antarktis", ATF: "Franska sydterritorierna",
  AUS: "Australien", AUT: "Österrike", AZE: "Azerbajdzjan", BDI: "Burundi",
  BEL: "Belgien", BEN: "Benin", BFA: "Burkina Faso", BGD: "Bangladesh",
  BGR: "Bulgarien", BHS: "Bahamas", BIH: "Bosnien och Hercegovina", BLR: "Vitryssland",
  BLZ: "Belize", BMU: "Bermuda", BOL: "Bolivia", BRA: "Brasilien",
  BRN: "Brunei", BTN: "Bhutan", BWA: "Botswana", CAF: "Centralafrikanska republiken",
  CAN: "Kanada", CHE: "Schweiz", CHL: "Chile", CHN: "Kina",
  CIV: "Elfenbenskusten", CMR: "Kamerun", COD: "Demokratiska republiken Kongo",
  COG: "Kongo-Brazzaville", COL: "Colombia", CRI: "Costa Rica", "CS-KM": "Kosovo",
  CUB: "Kuba", CYP: "Cypern", CZE: "Tjeckien", DEU: "Tyskland",
  DJI: "Djibouti", DNK: "Danmark", DOM: "Dominikanska republiken", DZA: "Algeriet",
  ECU: "Ecuador", EGY: "Egypten", ERI: "Eritrea", ESH: "Västsahara",
  ESP: "Spanien", EST: "Estland", ETH: "Etiopien", FIN: "Finland",
  FJI: "Fiji", FLK: "Falklandsöarna", FRA: "Frankrike", GAB: "Gabon",
  GBR: "Storbritannien", GEO: "Georgien", GHA: "Ghana", GIN: "Guinea",
  GMB: "Gambia", GNB: "Guinea-Bissau", GNQ: "Ekvatorialguinea", GRC: "Grekland",
  GRL: "Grönland", GTM: "Guatemala", GUF: "Franska Guyana", GUY: "Guyana",
  HND: "Honduras", HRV: "Kroatien", HTI: "Haiti", HUN: "Ungern",
  IDN: "Indonesien", IND: "Indien", IRL: "Irland", IRN: "Iran",
  IRQ: "Irak", ISL: "Island", ISR: "Israel", ITA: "Italien",
  JAM: "Jamaica", JOR: "Jordanien", JPN: "Japan", KAZ: "Kazakstan",
  KEN: "Kenya", KGZ: "Kirgizistan", KHM: "Kambodja", KOR: "Sydkorea",
  KWT: "Kuwait", LAO: "Laos", LBN: "Libanon", LBR: "Liberia",
  LBY: "Libyen", LKA: "Sri Lanka", LSO: "Lesotho", LTU: "Litauen",
  LUX: "Luxemburg", LVA: "Lettland", MAR: "Marocko", MDA: "Moldavien",
  MDG: "Madagaskar", MEX: "Mexiko", MKD: "Nordmakedonien", MLI: "Mali",
  MLT: "Malta", MMR: "Myanmar", MNE: "Montenegro", MNG: "Mongoliet",
  MOZ: "Moçambique", MRT: "Mauretanien", MWI: "Malawi", MYS: "Malaysia",
  NAM: "Namibia", NCL: "Nya Kaledonien", NER: "Niger", NGA: "Nigeria",
  NIC: "Nicaragua", NLD: "Nederländerna", NOR: "Norge", NPL: "Nepal",
  NZL: "Nya Zeeland", OMN: "Oman", PAK: "Pakistan", PAN: "Panama",
  PER: "Peru", PHL: "Filippinerna", PNG: "Papua Nya Guinea", POL: "Polen",
  PRI: "Puerto Rico", PRK: "Nordkorea", PRT: "Portugal", PRY: "Paraguay",
  PSE: "Västbanken", QAT: "Qatar", ROU: "Rumänien", RUS: "Ryssland",
  RWA: "Rwanda", SAU: "Saudiarabien", SDN: "Sudan", SEN: "Senegal",
  SLB: "Salomonöarna", SLE: "Sierra Leone", SLV: "El Salvador", SOM: "Somalia",
  SRB: "Serbien", SSD: "Sydsudan", SUR: "Surinam", SVK: "Slovakien",
  SVN: "Slovenien", SWE: "Sverige", SWZ: "Eswatini", SYR: "Syrien",
  TCD: "Tchad", TGO: "Togo", THA: "Thailand", TJK: "Tadzjikistan",
  TKM: "Turkmenistan", TLS: "Östtimor", TTO: "Trinidad och Tobago", TUN: "Tunisien",
  TUR: "Turkiet", TWN: "Taiwan", TZA: "Tanzania", UGA: "Uganda",
  UKR: "Ukraina", URY: "Uruguay", USA: "USA", UZB: "Uzbekistan",
  VEN: "Venezuela", VNM: "Vietnam", VUT: "Vanuatu", YEM: "Jemen",
  ZAF: "Sydafrika", ZMB: "Zambia", ZWE: "Zimbabwe"
};

// Två öar/regioner i datasetet saknar en riktig ISO-kod (id "-99") och
// särskiljs istället på engelska namnet. Räknas som samma svar som sitt
// "moderland" om spelaren pekar/gissar på dem.
window.STREETVIEW_DASH99_OVERRIDES = {
  "Northern Cyprus": { code: "CYP", nameSv: "Norra Cypern" },
  "Somaliland": { code: "SOM", nameSv: "Somaliland" }
};

// ISO alpha-2 (det Google Geocoding API ger oss) -> alpha-3/CS-KM (det
// kartans GeoJSON använder som id). Täcker exakt de 180 länderna ovan —
// om Google skulle ge en kod som inte finns här (t.ex. för ett mikroland
// som inte finns med som egen yta på kartan) körs en ny sökning istället,
// se findRoundLocation() i index.html.
window.STREETVIEW_ALPHA2_TO_ALPHA3 = {
  AF: "AFG", AO: "AGO", AL: "ALB", AE: "ARE", AR: "ARG", AM: "ARM", AQ: "ATA", TF: "ATF",
  AU: "AUS", AT: "AUT", AZ: "AZE", BI: "BDI", BE: "BEL", BJ: "BEN", BF: "BFA", BD: "BGD",
  BG: "BGR", BS: "BHS", BA: "BIH", BY: "BLR", BZ: "BLZ", BM: "BMU", BO: "BOL", BR: "BRA",
  BN: "BRN", BT: "BTN", BW: "BWA", CF: "CAF", CA: "CAN", CH: "CHE", CL: "CHL", CN: "CHN",
  CI: "CIV", CM: "CMR", CD: "COD", CG: "COG", CO: "COL", CR: "CRI", XK: "CS-KM", CU: "CUB",
  CY: "CYP", CZ: "CZE", DE: "DEU", DJ: "DJI", DK: "DNK", DO: "DOM", DZ: "DZA", EC: "ECU",
  EG: "EGY", ER: "ERI", EH: "ESH", ES: "ESP", EE: "EST", ET: "ETH", FI: "FIN", FJ: "FJI",
  FK: "FLK", FR: "FRA", GA: "GAB", GB: "GBR", GE: "GEO", GH: "GHA", GN: "GIN", GM: "GMB",
  GW: "GNB", GQ: "GNQ", GR: "GRC", GL: "GRL", GT: "GTM", GF: "GUF", GY: "GUY", HN: "HND",
  HR: "HRV", HT: "HTI", HU: "HUN", ID: "IDN", IN: "IND", IE: "IRL", IR: "IRN", IQ: "IRQ",
  IS: "ISL", IL: "ISR", IT: "ITA", JM: "JAM", JO: "JOR", JP: "JPN", KZ: "KAZ", KE: "KEN",
  KG: "KGZ", KH: "KHM", KR: "KOR", KW: "KWT", LA: "LAO", LB: "LBN", LR: "LBR", LY: "LBY",
  LK: "LKA", LS: "LSO", LT: "LTU", LU: "LUX", LV: "LVA", MA: "MAR", MD: "MDA", MG: "MDG",
  MX: "MEX", MK: "MKD", ML: "MLI", MT: "MLT", MM: "MMR", ME: "MNE", MN: "MNG", MZ: "MOZ",
  MR: "MRT", MW: "MWI", MY: "MYS", NA: "NAM", NC: "NCL", NE: "NER", NG: "NGA", NI: "NIC",
  NL: "NLD", NO: "NOR", NP: "NPL", NZ: "NZL", OM: "OMN", PK: "PAK", PA: "PAN", PE: "PER",
  PH: "PHL", PG: "PNG", PL: "POL", PR: "PRI", KP: "PRK", PT: "PRT", PY: "PRY", PS: "PSE",
  QA: "QAT", RO: "ROU", RU: "RUS", RW: "RWA", SA: "SAU", SD: "SDN", SN: "SEN", SB: "SLB",
  SL: "SLE", SV: "SLV", SO: "SOM", RS: "SRB", SS: "SSD", SR: "SUR", SK: "SVK", SI: "SVN",
  SE: "SWE", SZ: "SWZ", SY: "SYR", TD: "TCD", TG: "TGO", TH: "THA", TJ: "TJK", TM: "TKM",
  TL: "TLS", TT: "TTO", TN: "TUN", TR: "TUR", TW: "TWN", TZ: "TZA", UG: "UGA", UA: "UKR",
  UY: "URY", US: "USA", UZ: "UZB", VE: "VEN", VN: "VNM", VU: "VUT", YE: "YEM", ZA: "ZAF",
  ZM: "ZMB", ZW: "ZWE"
};
