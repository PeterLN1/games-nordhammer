/* Delad tema-hantering för hela Nordhammer Spel (hubb + alla spel).
   Läs in synkront i <head> så temat sätts före paint (ingen blinkning).
   Sidor definierar själva sina färger via CSS med :root[data-theme="dark"]
   och @media (prefers-color-scheme: dark) — den här modulen sätter bara
   data-theme, sparar valet och kopplar ev. <select data-theme-control>. */
(function(){
  "use strict";
  var KEY = "nordhammer:theme";
  var MODES = ["auto", "light", "dark"];
  var mq = window.matchMedia("(prefers-color-scheme: dark)");

  function read(){
    var m;
    try { m = localStorage.getItem(KEY); } catch(e){}
    if(!m){
      try { var old = localStorage.getItem("spider:theme"); if(old){ m = old; localStorage.setItem(KEY, old); } } catch(e){}
    }
    return MODES.indexOf(m) >= 0 ? m : "auto";
  }
  function isDark(mode){ return mode === "dark" || (mode === "auto" && mq.matches); }

  function apply(mode){
    var root = document.documentElement;
    if(mode === "light" || mode === "dark") root.setAttribute("data-theme", mode);
    else root.removeAttribute("data-theme"); // auto -> prefers-color-scheme bestämmer
    var meta = document.querySelector('meta[name="theme-color"]');
    if(meta){
      var c = isDark(mode) ? (meta.getAttribute("data-dark") || "#0b1512")
                           : (meta.getAttribute("data-light") || "#0b6b2e");
      meta.setAttribute("content", c);
    }
  }

  // ingen blinkning: applicera direkt (körs i <head>)
  apply(read());

  function syncControls(mode){
    var els = document.querySelectorAll("[data-theme-control]");
    for(var i=0;i<els.length;i++) els[i].value = mode;
  }
  function set(mode){
    if(MODES.indexOf(mode) < 0) mode = "auto";
    try { localStorage.setItem(KEY, mode); } catch(e){}
    apply(mode);
    syncControls(mode);
  }

  function onSys(){ if(read() === "auto") apply("auto"); } // följ systemet i auto-läge
  if(mq.addEventListener) mq.addEventListener("change", onSys);
  else if(mq.addListener) mq.addListener(onSys);

  function wire(){
    var els = document.querySelectorAll("[data-theme-control]");
    for(var i=0;i<els.length;i++){
      els[i].value = read();
      els[i].addEventListener("change", function(){ set(this.value); });
    }
  }
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();

  window.NordhammerTheme = { get: read, set: set, isDark: function(){ return isDark(read()); } };
})();
