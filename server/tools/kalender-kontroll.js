#!/usr/bin/env node
/* Kontrollerar en innehållsfil för kalendern i klartext, innan den krypteras.
   Samma kontroll som POST /api/kalender/admin/check, plus en översikt.

     cd server && npm run kontroll -- /sökväg/till/jul-2026.json

   Utskriften innehåller aldrig något ur filen: bara dag, plats, fält,
   låstyp och antal. Den går alltså att köra utan att få spoilers. */
import fs from 'fs';
import { checkContent, dayStages, teamAttemptLimit } from '../kalender.js';

const file = process.argv[2];
if (!file) { console.error('Användning: npm run kontroll -- <innehållsfil.json>'); process.exit(2); }

let text;
try { text = fs.readFileSync(file, 'utf8'); }
catch (e) { console.error('Kunde inte läsa filen.'); process.exit(2); }

let content;
try { content = JSON.parse(text); }
catch (e) {
  // Node:s felmeddelande citerar filen; säg bara var felet är.
  const m = /position (\d+)/.exec(e.message || '');
  if (m) {
    const before = text.slice(0, Number(m[1])).split('\n');
    console.error('Ogiltig JSON nära rad ' + before.length + ', kolumn ' + (before[before.length - 1].length + 1) + '.');
  } else console.error('Ogiltig JSON.');
  process.exit(1);
}

const errors = checkContent(content);

// Översikt: lås och föremål per dag — bara typer och antal, inga namn eller svar.
const LOCK = {
  digits: l => l.length + ' siffror', word: l => l.length + ' bokstäver', coordinate: l => 'en ruta i ' + l.cols + ' × ' + l.rows,
  choice: l => (l.options || []).length + ' alternativ', sequence: l => l.length + ' symboler av ' + (l.palette || []).length,
  cells: l => l.count + ' rutor i ' + l.cols + ' × ' + l.rows, path: l => 'väg på ' + l.count + ' rutor i ' + l.cols + ' × ' + l.rows
};
if (content && Array.isArray(content.days)) {
  console.log('Kalender: ' + (content.id || '(id saknas)') + ' · ' + content.days.length + ' luckor · start ' + (content.start_date || '?'));
  content.days.forEach((d, i) => {
    if (!d) return;
    let stages = [];
    try { stages = dayStages(d); } catch (e) { stages = []; }
    const locks = stages.map(st => {
      const l = st && st.lock;
      if (!l || !LOCK[l.type]) return '?';
      let lim = '?';
      try { lim = teamAttemptLimit(l); } catch (e) { /* visas som ? */ }
      return l.type + ' (' + LOCK[l.type](l) + (l.feedback ? ', återkoppling' : '') + ', laget ' + lim + ' försök/dag)';
    });
    const kinds = d.fragments ? Object.values(d.fragments).map(f => f && f.kind).filter(Boolean) : [];
    const extras = [];
    if (kinds.length) extras.push('lappar: ' + [...new Set(kinds)].join(', '));
    if (d.fragments && Object.values(d.fragments).some(f => f && f.private)) extras.push('hemlig del');
    if (Array.isArray(d.requires_items) && d.requires_items.length) extras.push('kräver ' + d.requires_items.length + ' föremål');
    if (d.epilogue && d.epilogue.item) extras.push('ger ett föremål' + (d.epilogue.item.content && d.epilogue.item.content.overlay ? ' (genomskinligt kort)' : d.epilogue.item.content ? ' (med innehåll)' : ''));
    console.log('  dag ' + (i + 1) + ': ' + locks.join(' → ') + (extras.length ? ' · ' + extras.join(' · ') : ''));
  });
  if (Array.isArray(content.combine) && content.combine.length) console.log('  recept: ' + content.combine.length);
}

if (errors.length) {
  console.log('\n' + errors.length + (errors.length === 1 ? ' fel:' : ' fel:'));
  for (const e of errors) console.log('  - ' + e);
  process.exit(1);
}
console.log('\nOK');
