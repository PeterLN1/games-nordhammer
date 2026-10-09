/* Sumdoku-motor: generator + lösare. Ingen DOM — körs både i webbläsaren
   (window.SumdokuEngine) och i Node (module.exports) så att generatorn
   kan testas/simuleras från terminalen.

   Ett pussel = { cages: [{ cells:[idx..], sum }], givens: {idx: siffra},
   solution: [81 siffror] }. Cellindex 0..80, rad = idx/9, kolumn = idx%9.

   Generering: slumpa en färdig sudoku → dela in i burar (sammanhängande,
   ingen siffra två gånger i samma bur) → kontrollera med lösaren att
   pusslet har exakt en lösning. Är det inte unikt provas en ny
   burindelning några gånger; sedan läggs förifyllda siffror till på en
   cell där två lösningar skiljer sig tills lösningen är unik. */
(function(root){
  "use strict";

  function mulberry32(a){
    return function(){
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function hashString(s){
    var h = 2166136261;
    for(var i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function shuffle(arr, rnd){
    for(var i = arr.length - 1; i > 0; i--){
      var j = Math.floor(rnd() * (i + 1)); var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  var ROW = [], COL = [], BOX = [], NEIGH = [];
  for(var i = 0; i < 81; i++){
    ROW[i] = Math.floor(i / 9); COL[i] = i % 9;
    BOX[i] = Math.floor(ROW[i] / 3) * 3 + Math.floor(COL[i] / 3);
    var n = [];
    if(COL[i] > 0) n.push(i - 1);
    if(COL[i] < 8) n.push(i + 1);
    if(ROW[i] > 0) n.push(i - 9);
    if(ROW[i] < 8) n.push(i + 9);
    NEIGH[i] = n;
  }
  var POP = []; for(var m = 0; m < 1024; m++){ var c = 0, x = m; while(x){ c += x & 1; x >>= 1; } POP[m] = c; }

  /* ---------- Färdig sudoku ---------- */
  function fullGrid(rnd){
    var g = new Array(81).fill(0), rows = new Array(9).fill(0), cols = new Array(9).fill(0), boxes = new Array(9).fill(0);
    function rec(i){
      if(i === 81) return true;
      var digits = shuffle([1,2,3,4,5,6,7,8,9], rnd);
      for(var k = 0; k < 9; k++){
        var d = digits[k], b = 1 << d;
        if((rows[ROW[i]] | cols[COL[i]] | boxes[BOX[i]]) & b) continue;
        g[i] = d; rows[ROW[i]] |= b; cols[COL[i]] |= b; boxes[BOX[i]] |= b;
        if(rec(i + 1)) return true;
        rows[ROW[i]] &= ~b; cols[COL[i]] &= ~b; boxes[BOX[i]] &= ~b;
      }
      g[i] = 0; return false;
    }
    rec(0);
    return g;
  }

  /* ---------- Burindelning ---------- */
  // sizeWeights[k] = relativ sannolikhet för burstorlek k.
  function makeCages(sol, rnd, sizeWeights){
    var cageOf = new Array(81).fill(-1), cages = [];
    var total = 0; for(var s in sizeWeights) total += sizeWeights[s];
    function pickSize(){
      var r = rnd() * total;
      for(var s in sizeWeights){ r -= sizeWeights[s]; if(r <= 0) return +s; }
      return 2;
    }
    var order = shuffle(Array.from({ length: 81 }, function(_, i){ return i; }), rnd);
    order.forEach(function(start){
      if(cageOf[start] >= 0) return;
      var id = cages.length, cells = [start], used = 1 << sol[start], target = pickSize();
      cageOf[start] = id;
      while(cells.length < target){
        var options = [];
        cells.forEach(function(c){
          NEIGH[c].forEach(function(nb){
            if(cageOf[nb] < 0 && !(used & (1 << sol[nb])) && options.indexOf(nb) < 0) options.push(nb);
          });
        });
        if(!options.length) break;
        var pick = options[Math.floor(rnd() * options.length)];
        cells.push(pick); cageOf[pick] = id; used |= 1 << sol[pick];
      }
      cages.push(cells);
    });
    // Enskilda celler är i praktiken förifyllda siffror — slå ihop dem med
    // en granne-bur om det går utan dubbletter.
    cages.forEach(function(cells, id){
      if(cells.length !== 1) return;
      var c = cells[0], nbs = shuffle(NEIGH[c].slice(), rnd);
      for(var k = 0; k < nbs.length; k++){
        var other = cageOf[nbs[k]], oc = cages[other];
        if(other === id || oc.length >= 6) continue;
        if(oc.some(function(x){ return sol[x] === sol[c]; })) continue;
        oc.push(c); cageOf[c] = other; cages[id] = []; return;
      }
    });
    return cages.filter(function(c){ return c.length; }).map(function(cells){
      cells.sort(function(a, b){ return a - b; });
      return { cells: cells, sum: cells.reduce(function(s, c){ return s + sol[c]; }, 0) };
    });
  }

  /* ---------- Lösare (räknar lösningar upp till limit) ----------
     Kandidatmasker per cell (bit d = siffran d möjlig) + propagering till
     fixpunkt: nakna singlar, dolda singlar i rad/kolumn/låda, och
     burfiltrering mot alla sifferkombinationer med rätt storlek och summa.
     Därefter förgrening på cellen med minst kandidater. */
  var UNITS = [];
  for(var u = 0; u < 9; u++){
    var r = [], cc = [], bx = [];
    for(var k = 0; k < 9; k++){
      r.push(u * 9 + k); cc.push(k * 9 + u);
      bx.push((Math.floor(u / 3) * 3 + Math.floor(k / 3)) * 9 + (u % 3) * 3 + k % 3);
    }
    UNITS.push(r, cc, bx);
  }
  var PEERS = [];
  for(var p = 0; p < 81; p++){
    var set = {};
    for(var q = 0; q < 81; q++) if(q !== p && (ROW[q] === ROW[p] || COL[q] === COL[p] || BOX[q] === BOX[p])) set[q] = 1;
    PEERS[p] = Object.keys(set).map(Number);
  }
  var COMBOS = {}; // "storlek,summa" -> [mask]
  for(var cm = 2; cm < 1024; cm += 2){
    var sum = 0; for(var dd = 1; dd <= 9; dd++) if(cm & (1 << dd)) sum += dd;
    var ck = POP[cm] + "," + sum; (COMBOS[ck] || (COMBOS[ck] = [])).push(cm);
  }
  function lowBit(m){ for(var d = 1; d <= 9; d++) if(m & (1 << d)) return d; return 0; }

  function solve(cages, givens, limit, collect, maxNodes){
    var cageOf = new Array(81), mates = [], combos = [];
    cages.forEach(function(cg, id){
      cg.cells.forEach(function(c){ cageOf[c] = id; });
      combos.push(COMBOS[cg.cells.length + "," + cg.sum] || []);
    });
    for(var i = 0; i < 81; i++) mates[i] = cages[cageOf[i]].cells.filter(function(x){ return x !== i; });

    function propagate(cand, val){
      var changed = true, i, j, d, b;
      while(changed){
        changed = false;
        // nakna singlar
        for(i = 0; i < 81; i++){
          if(val[i]) continue;
          if(!cand[i]) return false;
          if(POP[cand[i]] !== 1) continue;
          b = cand[i]; val[i] = lowBit(b); changed = true;
          var pr = PEERS[i], mt = mates[i];
          for(j = 0; j < pr.length; j++){ if(cand[pr[j]] & b){ if(val[pr[j]]) return false; cand[pr[j]] &= ~b; if(!cand[pr[j]]) return false; } }
          for(j = 0; j < mt.length; j++){ if(cand[mt[j]] & b){ if(val[mt[j]]) return false; cand[mt[j]] &= ~b; if(!cand[mt[j]]) return false; } }
        }
        if(changed) continue;
        // dolda singlar
        for(var un = 0; un < 27; un++){
          var unit = UNITS[un];
          for(d = 1; d <= 9; d++){
            b = 1 << d; var pos = -1, n = 0;
            for(j = 0; j < 9; j++) if(cand[unit[j]] & b){ n++; pos = unit[j]; }
            if(n === 0) return false;
            if(n === 1 && !val[pos] && cand[pos] !== b){ cand[pos] = b; changed = true; }
          }
        }
        if(changed) continue;
        // burar
        for(var c = 0; c < cages.length; c++){
          var cells = cages[c].cells, placed = 0, open = [];
          for(j = 0; j < cells.length; j++){ if(val[cells[j]]) placed |= 1 << val[cells[j]]; else open.push(cells[j]); }
          if(!open.length) continue;
          var allowed = 0, required = 0x3FE, any = false, list = combos[c];
          for(var ci = 0; ci < list.length; ci++){
            var M = list[ci];
            if((M & placed) !== placed) continue;
            var rest = M & ~placed, cover = 0, ok = true;
            for(j = 0; j < open.length; j++){ var x = cand[open[j]] & rest; if(!x){ ok = false; break; } cover |= x; }
            if(!ok || cover !== rest) continue;
            any = true; allowed |= rest; required &= rest;
          }
          if(!any) return false;
          for(j = 0; j < open.length; j++){
            var nc = cand[open[j]] & allowed;
            if(nc !== cand[open[j]]){ cand[open[j]] = nc; changed = true; if(!nc) return false; }
          }
          for(d = 1; d <= 9; d++){
            b = 1 << d; if(!(required & b)) continue;
            var cnt = 0, at = -1;
            for(j = 0; j < open.length; j++) if(cand[open[j]] & b){ cnt++; at = open[j]; }
            if(cnt === 0) return false;
            if(cnt === 1 && cand[at] !== b){ cand[at] = b; changed = true; }
          }
        }
      }
      return true;
    }

    var count = 0, sols = [], nodes = 0;
    var aborted = false;
    function rec(cand, val){
      if(maxNodes && ++nodes > maxNodes){ aborted = true; return true; }
      if(!maxNodes) nodes++;
      if(!propagate(cand, val)) return false;
      var best = -1, bestN = 10;
      for(var i = 0; i < 81; i++){
        if(val[i]) continue;
        var n = POP[cand[i]];
        if(n < bestN){ bestN = n; best = i; if(n === 2) break; }
      }
      if(best < 0){ count++; if(collect) sols.push(val.slice()); return count >= limit; }
      for(var d = 1; d <= 9; d++){
        if(!(cand[best] & (1 << d))) continue;
        var c2 = cand.slice(), v2 = val.slice();
        c2[best] = 1 << d;
        if(rec(c2, v2)) return true;
      }
      return false;
    }
    var cand0 = new Array(81).fill(0x3FE), val0 = new Array(81).fill(0);
    for(var key in givens) cand0[+key] = 1 << givens[key];
    rec(cand0, val0);
    return { count: count, solutions: sols, nodes: nodes, aborted: aborted };
  }

  function cageFrom(cells, sol){
    cells.sort(function(a, b){ return a - b; });
    return { cells: cells, sum: cells.reduce(function(s, c){ return s + sol[c]; }, 0) };
  }
  function connected(cells){
    if(!cells.length) return false;
    var seen = [cells[0]], stack = [cells[0]];
    while(stack.length){
      var c = stack.pop();
      NEIGH[c].forEach(function(nb){ if(cells.indexOf(nb) >= 0 && seen.indexOf(nb) < 0){ seen.push(nb); stack.push(nb); } });
    }
    return seen.length === cells.length;
  }
  // Dela en bur i två sammanhängande delar (båda ≥2 celler), med 'from'
  // i den ena. Returnerar null om det inte går.
  function splitCage(cells, from, rnd){
    if(cells.length < 4) return null;
    for(var t = 0; t < 8; t++){
      var size = 2 + Math.floor(rnd() * (cells.length - 3)), part = [from];
      while(part.length < size){
        var opts = [];
        part.forEach(function(c){ NEIGH[c].forEach(function(nb){ if(cells.indexOf(nb) >= 0 && part.indexOf(nb) < 0 && opts.indexOf(nb) < 0) opts.push(nb); }); });
        if(!opts.length) break;
        part.push(opts[Math.floor(rnd() * opts.length)]);
      }
      var rest = cells.filter(function(c){ return part.indexOf(c) < 0; });
      if(part.length >= 2 && rest.length >= 2 && connected(rest)) return [part, rest];
    }
    return null;
  }

  /* ---------- Generator ---------- */
  var DIFFICULTIES = {
    easy:   { sizes: { 2: 5, 3: 4, 4: 1 },        extraGivens: 10 },
    medium: { sizes: { 2: 3, 3: 4, 4: 3, 5: 1 },  extraGivens: 0 },
    hard:   { sizes: { 2: 2, 3: 3, 4: 4, 5: 3, 6: 1 }, extraGivens: 0 }
  };

  function generate(seed, difficulty){
    var cfg = DIFFICULTIES[difficulty] || DIFFICULTIES.medium;
    var rnd = mulberry32(typeof seed === "number" ? seed : hashString(String(seed)));
    // Lösaren får en nodbudget: en indelning som kräver väldigt stor
    // sökning kastas och slumpas om (håller genereringen snabb och
    // undviker pussel som bara går att lösa med ren gissning).
    var BUDGET = 6000;
    var sol = fullGrid(rnd), cages, givens, res;
    for(var attempt = 0; ; attempt++){
      cages = makeCages(sol, rnd, cfg.sizes); givens = {};
      res = solve(cages, givens, 2, true, BUDGET);
      // Inte unikt: dela i första hand en bur (≥4 celler) där två lösningar
      // skiljer sig — mindre burar begränsar mer. Går det inte fylls en
      // siffra i som sista utväg.
      while(!res.aborted && res.count > 1){
        var a = res.solutions[0], b = res.solutions[1], diff = [];
        for(var i = 0; i < 81; i++) if(a[i] !== b[i]) diff.push(i);
        shuffle(diff, rnd);
        var split = null;
        for(var di = 0; di < diff.length && !split; di++){
          var ci = cages.findIndex(function(cg){ return cg.cells.indexOf(diff[di]) >= 0; });
          split = splitCage(cages[ci].cells, diff[di], rnd);
          if(split) cages.splice(ci, 1, cageFrom(split[0], sol), cageFrom(split[1], sol));
        }
        if(!split){ var cell = diff[0]; givens[cell] = sol[cell]; }
        res = solve(cages, givens, 2, true, BUDGET);
      }
      if(!res.aborted) break;
      if(attempt > 200) return generate(String(seed) + "+", difficulty); // nödutgång
    }
    // Lätt nivå: några extra förifyllda siffror som draghjälp.
    var free = shuffle(Array.from({ length: 81 }, function(_, i){ return i; }).filter(function(i){ return !(i in givens); }), rnd);
    for(var e = 0; e < cfg.extraGivens; e++) givens[free[e]] = sol[free[e]];
    return { cages: cages, givens: givens, solution: sol, difficulty: difficulty };
  }

  // Alla sifferkombinationer (som listor) för en bur med given storlek och summa.
  function combos(size, sum){
    return (COMBOS[size + "," + sum] || []).map(function(m){
      var ds = []; for(var d = 1; d <= 9; d++) if(m & (1 << d)) ds.push(d); return ds;
    });
  }

  var api = { generate: generate, solve: solve, combos: combos, hashString: hashString, DIFFICULTIES: DIFFICULTIES };
  if(typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SumdokuEngine = api;
  // Som Web Worker: generera utan att frysa sidan (svår nivå kan ta ~1 s).
  if(typeof importScripts === "function" && typeof document === "undefined"){
    root.onmessage = function(e){ root.postMessage({ id: e.data.id, puzzle: generate(e.data.seed, e.data.difficulty) }); };
  }
})(this);
