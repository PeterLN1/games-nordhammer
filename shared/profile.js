/* Delad profil ("Vem spelar?") för hela Nordhammer Spel — Netflix-liknande
   profilval utan lösenord. En profil är bara ett namn + en emoji-avatar.
   Listan synkas mot samma Railway/Supabase-backend som topplistorna (se
   server/index.js, /api/profiles) så den är gemensam över alla enheter —
   men VILKEN profil som är vald just nu på DEN HÄR enheten förblir lokal,
   precis som på Netflix. localStorage fungerar som en cache: alltid
   tillgänglig direkt (offline-vänligt, fail-open), uppdateras i
   bakgrunden. Läs in synkront i <head>, precis som theme.js — DOM-
   beroende arbete (overlayen) skjuts upp tills den faktiskt behövs. */
(function(){
  "use strict";
  var PROFILES_KEY = "nordhammer:profiles";
  var CURRENT_KEY = "nordhammer:currentProfileId";
  var LEGACY_NAME_KEYS = ["mahjong:name", "ordlek:name"];
  var AVATARS = ['🦊','🐼','🐸','🦉','🐙','🐢','🦄','🐯','🐨','🦁','🐰','🐬'];
  var COLORS = ['#ff6b6b','#ffa94d','#ffd43b','#69db7c','#38d9a9','#4dabf7','#748ffc','#da77f2','#f783ac','#20c997'];

  /* ---------- Server-synk (samma backend som topplistorna) ---------- */
  var API_BASE = 'https://games-nordhammer-production.up.railway.app';
  function apiBase(){
    try { return (localStorage.getItem('nordhammer:api') || API_BASE || '').replace(/\/+$/, ''); }
    catch(e){ return API_BASE; }
  }
  function apiFetch(path, opts, cb){
    var base = apiBase(); if(!base) return cb(new Error('ingen api'));
    fetch(base + path, opts).then(function(r){ return r.json().then(function(d){ return { status: r.status, body: d }; }); })
      .then(function(res){ cb((res.body && res.body.error) ? new Error(res.body.error) : null, res.body); })
      .catch(cb);
  }
  var JSON_HEADERS = { 'Content-Type': 'application/json' };
  function apiList(cb){ apiFetch('/api/profiles', {}, function(err, d){ cb(err, (d && d.profiles) || []); }); }
  function apiCreate(p, cb){ apiFetch('/api/profiles', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(p) }, cb); }
  function apiUpdate(id, patch, cb){ apiFetch('/api/profiles/' + id, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(patch) }, cb); }
  function apiRemove(id, cb){ apiFetch('/api/profiles/' + id, { method: 'DELETE' }, cb); }

  // Hämtar serverns profillista, laddar upp lokalt kända profiler som
  // servern inte har (t.ex. skapade innan denna uppdatering, eller
  // offline på en annan enhet), och sparar resultatet som ny cache.
  // Ingen "synkad"-flagga — körs om varje gång, självläkande.
  var syncing = false;
  function syncFromServer(cb){
    if(syncing){ if(cb) cb(new Error('synkar redan')); return; }
    syncing = true;
    apiList(function(err, serverProfiles){
      syncing = false;
      if(err){ if(cb) cb(err); return; }
      var localCache = loadProfiles();
      var serverNames = serverProfiles.map(function(p){ return (p.name || '').trim().toLowerCase(); });
      var missing = localCache.filter(function(p){ return serverNames.indexOf((p.name || '').trim().toLowerCase()) < 0; });
      missing.forEach(function(p){ apiCreate(p, function(){}); });
      var merged = serverProfiles.concat(missing);
      saveProfiles(merged);
      if(cb) cb(null, merged);
    });
  }

  function loadProfiles(){
    try { var p = JSON.parse(localStorage.getItem(PROFILES_KEY)); return Array.isArray(p) ? p : []; }
    catch(e){ return []; }
  }
  function saveProfiles(list){ try { localStorage.setItem(PROFILES_KEY, JSON.stringify(list)); } catch(e){} }
  function getCurrentId(){ try { return localStorage.getItem(CURRENT_KEY) || ''; } catch(e){ return ''; } }
  function setCurrentId(id){ try { localStorage.setItem(CURRENT_KEY, id || ''); } catch(e){} }
  function uid(){ return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  // Migrering: gamla per-spel-namn (mahjong:name / ordlek:name) blir
  // startprofiler så befintliga spelare inte behöver välja om sig.
  (function migrate(){
    if(loadProfiles().length) return;
    var names = [];
    try {
      LEGACY_NAME_KEYS.forEach(function(k){
        var n = (localStorage.getItem(k) || '').trim();
        if(n && names.indexOf(n) < 0) names.push(n);
      });
    } catch(e){}
    if(!names.length) return;
    var list = names.map(function(n, i){
      return { id: uid(), name: n, avatar: AVATARS[i % AVATARS.length], color: COLORS[i % COLORS.length] };
    });
    saveProfiles(list);
    if(list.length === 1) setCurrentId(list[0].id);
  })();

  function list(){ return loadProfiles(); }
  function current(){
    var id = getCurrentId();
    if(!id) return null;
    return loadProfiles().filter(function(p){ return p.id === id; })[0] || null;
  }
  // Alla ändringar sparas lokalt direkt (omedelbar UI-respons, fungerar
  // offline) och skickas sedan till servern i bakgrunden, best-effort.
  // Misslyckas anropet behåller enheten ändå sin lokala ändring — nästa
  // lyckade sync från en enhet som fungerar blir den som vinner i
  // praktiken. Rimligt för en liten familjesajt utan konflikthantering.
  function create(name, avatar){
    name = (name || '').trim().slice(0, 20);
    if(!name) return null;
    var l = loadProfiles();
    var p = { id: uid(), name: name, avatar: avatar || AVATARS[l.length % AVATARS.length], color: COLORS[l.length % COLORS.length] };
    l.push(p);
    saveProfiles(l);
    setCurrentId(p.id);
    apiCreate(p, function(){});
    return p;
  }
  function select(id){ setCurrentId(id); }
  function remove(id){
    saveProfiles(loadProfiles().filter(function(p){ return p.id !== id; }));
    if(getCurrentId() === id) setCurrentId('');
    apiRemove(id, function(){});
  }
  function update(id, patch){
    var l = loadProfiles();
    var p = l.filter(function(x){ return x.id === id; })[0];
    if(!p) return null;
    if(patch.name != null) p.name = String(patch.name).trim().slice(0, 20) || p.name;
    if(patch.avatar != null) p.avatar = patch.avatar;
    saveProfiles(l);
    apiUpdate(id, { name: p.name, avatar: p.avatar }, function(){});
    return p;
  }

  /* ---------- UI ---------- */
  var CSS = ""
    + ".nh-profile-overlay{position:fixed;inset:0;z-index:9999;display:none;align-items:center;justify-content:center;background:rgba(10,12,20,.72);padding:20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;}"
    + ".nh-profile-overlay.show{display:flex;}"
    + ".nh-panel{background:#fff;color:#1b2138;border-radius:18px;padding:28px 22px;max-width:420px;width:100%;max-height:88vh;overflow-y:auto;text-align:center;box-shadow:0 24px 70px rgba(0,0,0,.45);box-sizing:border-box;}"
    + "@media (prefers-color-scheme: dark){:root:not([data-theme]) .nh-panel{background:#141a33;color:#eef2ff;}}"
    + ":root[data-theme='dark'] .nh-panel{background:#141a33;color:#eef2ff;}"
    + ".nh-panel h2{margin:0 0 20px;font-size:21px;}"
    + ".nh-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(84px,1fr));gap:14px;margin-bottom:18px;}"
    + ".nh-tile{cursor:pointer;position:relative;display:flex;flex-direction:column;align-items:center;gap:6px;background:none;border:none;font-family:inherit;padding:0;}"
    + ".nh-avatar{width:64px;height:64px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:30px;box-shadow:0 2px 8px rgba(0,0,0,.25);}"
    + ".nh-avatar-add{background:rgba(120,120,140,.18);font-size:26px;font-weight:700;color:inherit;}"
    + ".nh-name{font-size:12.5px;font-weight:600;max-width:84px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}"
    + ".nh-tile:active .nh-avatar{transform:scale(.95);}"
    + ".nh-tile-del{position:absolute;top:-6px;right:8px;width:22px;height:22px;border-radius:50%;border:none;background:#e0393e;color:#fff;font-size:11px;cursor:pointer;z-index:2;}"
    + ".nh-tile-edit{position:absolute;top:-6px;left:8px;width:22px;height:22px;border-radius:50%;border:none;background:#4dabf7;color:#fff;font-size:11px;cursor:pointer;z-index:2;}"
    + ".nh-iab{position:fixed;top:0;left:0;right:0;z-index:10000;display:flex;align-items:center;gap:10px;padding:9px 14px;font-size:12.5px;line-height:1.4;background:#ffb300;color:#1a1200;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;}"
    + ".nh-iab span{flex:1;}"
    + ".nh-iab button{flex:0 0 auto;border:none;background:rgba(0,0,0,.12);color:inherit;width:22px;height:22px;border-radius:6px;font-size:12px;cursor:pointer;padding:0;}"
    + ".nh-manage,.nh-close,.nh-primary{width:100%;margin-top:8px;padding:12px;border:none;border-radius:11px;font-weight:700;font-size:14.5px;cursor:pointer;font-family:inherit;}"
    + ".nh-primary{background:#ffb300;color:#1a1200;}"
    + ".nh-manage,.nh-close{background:rgba(120,120,140,.16);color:inherit;}"
    + ".nh-input{width:100%;padding:12px;border-radius:10px;border:none;background:rgba(120,120,140,.14);color:inherit;font-family:inherit;font-size:15px;margin-bottom:16px;box-sizing:border-box;}"
    + ".nh-avgrid{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:18px;}"
    + ".nh-av{aspect-ratio:1;border-radius:10px;border:2px solid transparent;background:rgba(120,120,140,.12);font-size:22px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-family:inherit;}"
    + ".nh-av.on{border-color:#ffb300;background:rgba(255,179,0,.18);}"
    + ".nh-badge{display:inline-flex;align-items:center;gap:6px;background:rgba(120,120,140,.16);border:none;border-radius:999px;padding:4px 10px 4px 4px;color:inherit;font-family:inherit;font-size:12.5px;font-weight:600;cursor:pointer;}"
    + ".nh-badge .nh-avatar{width:24px;height:24px;font-size:14px;box-shadow:none;}";

  var styleInjected = false;
  function ensureStyle(){
    if(styleInjected) return;
    styleInjected = true;
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
  }
  var root = null;
  function ensureRoot(){
    ensureStyle();
    if(root) return root;
    root = document.createElement('div');
    root.id = 'nhProfileOverlay';
    root.className = 'nh-profile-overlay';
    if(document.body) document.body.appendChild(root);
    else document.addEventListener('DOMContentLoaded', function(){ document.body.appendChild(root); });
    return root;
  }
  function esc(s){ return String(s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }

  var lastRenderOpts = null; // senaste opts, för bakgrundssyncen — se syncAndMaybeRerender
  function renderPicker(opts){
    lastRenderOpts = opts;
    var el = ensureRoot();
    var manage = !!opts.manage;
    var profiles = list();
    var tiles = profiles.map(function(p){
      return '<button class="nh-tile" data-id="' + p.id + '">' +
        (manage ? '<span class="nh-tile-edit" data-edit="' + p.id + '" role="button" aria-label="Redigera">✎</span>' : '') +
        (manage ? '<span class="nh-tile-del" data-del="' + p.id + '" role="button" aria-label="Ta bort">✕</span>' : '') +
        '<span class="nh-avatar" style="background:' + p.color + '">' + p.avatar + '</span>' +
        '<span class="nh-name">' + esc(p.name) + '</span>' +
      '</button>';
    }).join('');
    el.innerHTML =
      '<div class="nh-panel">' +
        '<h2>Vem spelar?</h2>' +
        '<div class="nh-grid">' + tiles +
          '<button class="nh-tile" data-add="1"><span class="nh-avatar nh-avatar-add">+</span><span class="nh-name">Lägg till</span></button>' +
        '</div>' +
        (profiles.length ? '<button class="nh-manage" data-manage="1">' + (manage ? 'Klart' : 'Hantera profiler') + '</button>' : '') +
        (opts.dismissable ? '<button class="nh-close" data-close="1">Stäng</button>' : '') +
      '</div>';
    el.classList.add('show');

    Array.prototype.forEach.call(el.querySelectorAll('.nh-tile[data-id]'), function(t){
      t.addEventListener('click', function(e){
        if(manage) return;
        select(t.getAttribute('data-id'));
        closeOverlay(opts.onDone);
      });
    });
    Array.prototype.forEach.call(el.querySelectorAll('[data-del]'), function(btn){
      btn.addEventListener('click', function(e){
        e.stopPropagation();
        var id = btn.getAttribute('data-del');
        var p = profiles.filter(function(x){ return x.id === id; })[0];
        if(p && confirm('Ta bort profilen "' + p.name + '"?')){
          remove(id);
          renderPicker(opts);
        }
      });
    });
    Array.prototype.forEach.call(el.querySelectorAll('[data-edit]'), function(btn){
      btn.addEventListener('click', function(e){
        e.stopPropagation();
        var id = btn.getAttribute('data-edit');
        var p = profiles.filter(function(x){ return x.id === id; })[0];
        if(p) renderCreate(opts, p);
      });
    });
    var addTile = el.querySelector('[data-add]');
    if(addTile) addTile.addEventListener('click', function(){ renderCreate(opts); });
    var manageBtn = el.querySelector('[data-manage]');
    if(manageBtn) manageBtn.addEventListener('click', function(){
      var next = {}; for(var k in opts) next[k] = opts[k];
      next.manage = !manage;
      renderPicker(next);
    });
    var closeBtn = el.querySelector('[data-close]');
    if(closeBtn) closeBtn.addEventListener('click', function(){ closeOverlay(opts.onDone); });
  }

  function renderCreate(opts, editProfile){
    var el = ensureRoot();
    var chosen = (editProfile && editProfile.avatar) || AVATARS[0];
    el.innerHTML =
      '<div class="nh-panel">' +
        '<h2>' + (editProfile ? 'Redigera profil' : 'Ny profil') + '</h2>' +
        '<input id="nhNewName" class="nh-input" maxlength="20" placeholder="Namn" autocomplete="off" value="' + (editProfile ? esc(editProfile.name) : '') + '">' +
        '<div class="nh-avgrid">' +
          AVATARS.map(function(a){ return '<button class="nh-av' + (a === chosen ? ' on' : '') + '" data-av="' + a + '">' + a + '</button>'; }).join('') +
        '</div>' +
        '<button class="nh-primary" id="nhCreateSave">' + (editProfile ? 'Spara' : 'Skapa') + '</button>' +
        '<button class="nh-close" id="nhCreateBack">Tillbaka</button>' +
      '</div>';
    el.classList.add('show');
    Array.prototype.forEach.call(el.querySelectorAll('.nh-av'), function(btn){
      btn.addEventListener('click', function(){
        Array.prototype.forEach.call(el.querySelectorAll('.nh-av'), function(b){ b.classList.remove('on'); });
        btn.classList.add('on');
        chosen = btn.getAttribute('data-av');
      });
    });
    var save = function(){
      var name = (document.getElementById('nhNewName').value || '').trim();
      if(!name) return;
      if(editProfile) update(editProfile.id, { name: name, avatar: chosen });
      else create(name, chosen);
      closeOverlay(opts.onDone);
    };
    document.getElementById('nhCreateSave').addEventListener('click', save);
    document.getElementById('nhNewName').addEventListener('keydown', function(e){ if(e.key === 'Enter') save(); });
    document.getElementById('nhCreateBack').addEventListener('click', function(){ renderPicker(opts); });
    setTimeout(function(){ try { var f = document.getElementById('nhNewName'); f.focus(); f.select(); } catch(e){} }, 30);
  }

  function closeOverlay(cb){
    if(root) root.classList.remove('show');
    if(cb) cb(current());
  }

  // Synkar mot servern en gång när väljaren öppnas, inte vid varje
  // intern omritning (annars skulle re-rendret nedan trigga en ny sync
  // i all oändlighet). Om svaret kommer tillbaka medan man fortfarande är
  // kvar på rutnäts-vyn (oavsett om man hunnit växla "Hantera"-läge eller
  // inte) ritas listan om med färska data — läser lastRenderOpts, inte
  // det (ev. inaktuella) opts-objektet från när synken startades, annars
  // kan ett svar som kommer efter att man klickat "Hantera" nollställa
  // tillbaka till vanligt läge mitt i.
  function syncAndMaybeRerender(){
    syncFromServer(function(err, fresh){
      if(!err && fresh && root && root.classList.contains('show') && root.querySelector('.nh-grid')) renderPicker(lastRenderOpts);
    });
  }
  function ensurePicker(cb){
    var p = current();
    if(p){ if(cb) cb(p); return; }
    var opts = { dismissable: false, onDone: cb };
    renderPicker(opts);
    syncAndMaybeRerender();
  }
  function openSwitcher(cb){
    var opts = { dismissable: true, onDone: cb };
    renderPicker(opts);
    syncAndMaybeRerender();
  }

  /* ---------- App-inbyggda webbläsare (Messenger m.fl.) ----------
     Dessa kör sidan i en isolerad lagringskontext, skild från telefonens
     vanliga webbläsare — varken profiler eller spelresultat syns där när
     man senare öppnar samma länk i Safari/Chrome. Går inte att synka i
     efterhand utan inloggning, så vi varnar innan man väljer/skapar en
     profil eller spelar istället. Gäller alla sidor som laddar denna
     modul (hubben, Mahjong, Ordlek). */
  var IAB_RE = /FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|; wv\)/i;
  var IAB_DISMISS_KEY = 'nordhammer:iabDismissed';
  function isInAppBrowser(){ return IAB_RE.test(navigator.userAgent || ''); }
  function maybeShowIabBanner(){
    if(!isInAppBrowser()) return;
    try { if(sessionStorage.getItem(IAB_DISMISS_KEY)) return; } catch(e){}
    ensureStyle();
    var el = document.createElement('div');
    el.className = 'nh-iab';
    el.innerHTML =
      '<span>Du öppnade sidan i en app-inbyggd webbläsare (t.ex. Messenger). Profiler och resultat sparas bara här — tryck ⋯ eller webbläsarikonen och välj "Öppna i webbläsare" innan du väljer/skapar profil.</span>' +
      '<button aria-label="Stäng">✕</button>';
    function mount(){ document.body.insertBefore(el, document.body.firstChild); }
    if(document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
    el.querySelector('button').addEventListener('click', function(){
      el.remove();
      try { sessionStorage.setItem(IAB_DISMISS_KEY, '1'); } catch(e){}
    });
  }
  maybeShowIabBanner();

  // Synka tyst i bakgrunden varje sidladdning, inte bara när väljaren
  // öppnas. ensurePicker() hoppar över nätverksanropet helt om enheten
  // redan har en vald profil (vanligaste fallet efter första gången) —
  // utan den här raden skulle en lokalt skapad profil aldrig laddas upp
  // förrän man råkade klicka på "byt profil"-badgen minst en gång.
  syncFromServer(function(){});

  window.NordhammerProfile = {
    list: list,
    current: current,
    create: create,
    update: update,
    select: select,
    remove: remove,
    ensurePicker: ensurePicker,
    openSwitcher: openSwitcher
  };
})();
