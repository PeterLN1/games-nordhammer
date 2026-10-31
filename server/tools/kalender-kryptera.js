#!/usr/bin/env node
/* Krypterar en innehållsfil för kalendern till <id>.enc.

     CONTENT_KEY=<nyckel> npm run kryptera -- /sökväg/till/jul-2026.json [utfil.enc]
     npm run kryptera -- --ny-nyckel          (skriver ut en ny slumpad nyckel)

   - Kör samma kontroll som npm run kontroll först, och krypterar bara om
     den är OK.
   - Utfilen hamnar som <id>.enc bredvid infilen om ingen anges. Den läggs
     sedan i server/kalender/ i repot.
   - Efter krypteringen dekrypteras utfilen och jämförs med infilen.
   - Skriver aldrig ut något ur filen eller nyckeln (utom --ny-nyckel).
   - Samma CONTENT_KEY gäller alla kalendrar i Railway. Byts nyckeln går
     äldre .enc-filer inte längre att läsa. */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { checkContent, encryptContent, decryptContent } from '../kalender.js';

const args = process.argv.slice(2);
if (args[0] === '--ny-nyckel') { console.log(crypto.randomBytes(32).toString('base64')); process.exit(0); }

const [input, outArg] = args;
if (!input) { console.error('Användning: CONTENT_KEY=<nyckel> npm run kryptera -- <innehållsfil.json> [utfil.enc]'); process.exit(2); }
const key = process.env.CONTENT_KEY || '';
if (Buffer.from(key, 'base64').length !== 32) { console.error('CONTENT_KEY saknas eller är inte 32 byte i base64.'); process.exit(2); }

let content;
try { content = JSON.parse(fs.readFileSync(input, 'utf8')); }
catch (e) { console.error('Kunde inte läsa filen som JSON. Kör npm run kontroll -- ' + input + ' för att se var felet är.'); process.exit(1); }

const errors = checkContent(content);
if (errors.length) {
  console.error('Kontrollen hittade ' + errors.length + ' fel. Inget krypterades:');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}

const out = outArg || path.join(path.dirname(input), content.id + '.enc');
const enc = encryptContent(content, key);
fs.writeFileSync(out, JSON.stringify(enc));

// Läs tillbaka och jämför, så att filen säkert går att dekryptera med nyckeln.
const back = decryptContent(JSON.parse(fs.readFileSync(out, 'utf8')), key);
if (JSON.stringify(back) !== JSON.stringify(content)) { console.error('Kontrollen efter krypteringen misslyckades. Använd inte utfilen.'); process.exit(1); }

console.log('Skrev ' + out + ' (' + fs.statSync(out).size + ' byte) för kalendern ' + content.id + ' med ' + content.days.length + ' luckor.');
console.log('Dekrypterad och jämförd: OK. Lägg filen i server/kalender/ och sätt KALENDER_ACTIVE=' + content.id + ' i Railway.');
