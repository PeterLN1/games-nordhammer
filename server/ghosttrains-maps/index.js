/* Ghost Trains kartor. Varje spel spelas på EN karta, vald när spelet
   startas (POST /new-game { mapId }) och sparad i
   ghosttrains_game_state.map_id. Ny karta: lägg till en modul här med
   samma exporter som sverige.js och kör server/test/ghosttrains-maps.test.js. */
import * as sverige from './sverige.js';
import * as norden from './norden.js';

export const MAPS = { sverige, norden };
// Spel som startades innan kartval fanns spelas på Sverigekartan.
export const DEFAULT_MAP_ID = 'sverige';
