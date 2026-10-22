(function () {
  "use strict";
  var RATES = [0.8, 1, 1.25, 1.5];
  var SKIP = "pre, .code, figure, .diagram, .mermaid, .predictions, details, script, style, .visual, .runner, .runner-bar, .exercise, .mine, textarea, input, select, [aria-hidden=\"true\"]";
  var ICONS = {
    speaker: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="fill" d="M8 5.5v13l10.5-6.5z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="fill" d="M7 5.5h3.5v13H7zM13.5 5.5H17v13h-3.5z"/></svg>',
    prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="fill" d="M6 6h2v12H6zM19 6v12l-9-6z"/></svg>',
    next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="fill" d="M16 6h2v12h-2zM5 6v12l9-6z"/></svg>',
    options: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>'
  };

  var A, P, T, units = [], idx = 0, chunks = [], ci = 0, playing = false, active = false, gen = 0;
  var engine = null, userJump = false, current = null;
  var ui = {};

  function key() { return "listen:" + P.slug; }
  function rate() { var r = Number(A.get("pref:listenRate")); return RATES.indexOf(r) >= 0 ? r : 1; }
  function voicePref(lang) { return A.get("pref:listenVoice:" + lang) || ""; }
  function reduced() { return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
  function base(l) { return String(l || "").toLowerCase().split(/[-_]/)[0]; }

  function textOf(el, drop) {
    var c = el.cloneNode(true);
    c.querySelectorAll(".anchor, button, .sr, script, style, [aria-hidden=\"true\"]" + (drop ? ", " + drop : "")).forEach(function (n) { n.remove(); });
    return (c.textContent || "").replace(/\s+/g, " ").trim();
  }

  function langOf(el) {
    var n = el.closest("[lang]");
    return base(n ? n.getAttribute("lang") : P.lang) || P.lang;
  }

  function collect() {
    var main = document.querySelector("main.lesson");
    if (!main) return [];
    var out = [];
    var prose = main.querySelector(".prose");
    var proseLang = prose ? langOf(prose) : P.lang;
    function add(el, text, lang) { if (text && /[\p{L}\p{N}]/u.test(text)) out.push({ el: el, text: text, lang: lang || langOf(el) }); }
    var h1 = main.querySelector("h1");
    if (h1) add(h1, textOf(h1), proseLang);
    var lede = main.querySelector(".lede");
    if (lede) add(lede, textOf(lede), proseLang);
    if (prose) {
      prose.querySelectorAll("h2, h3, h4, h5, h6, p, li, tr, dt, dd").forEach(function (el) {
        if (el.parentElement.closest(SKIP) || el.matches(SKIP)) return;
        var tag = el.tagName;
        if (tag === "LI") {
          if (el.querySelector(":scope > p")) return;
          add(el, textOf(el, "ul, ol"));
          return;
        }
        if (tag === "P" && el.closest("li") && !el.parentElement.matches("li")) return;
        if (tag === "TR") {
          var cells = Array.prototype.map.call(el.children, function (c) { return textOf(c).replace(/[.;:,]+$/, ""); }).filter(Boolean);
          add(el, cells.length ? cells.join(". ") + "." : "");
          return;
        }
        add(el, textOf(el));
      });
    }
    var qh = main.querySelector("#quiz-h");
    if (qh) {
      add(qh, textOf(qh));
      main.querySelectorAll(".quiz-q").forEach(function (q) { add(q, textOf(q)); });
    }
    return out;
  }

  function split(text) {
    var parts = text.split(/(?<=[.!?…:;])\s+(?=\S)/u);
    var out = [];
    parts.forEach(function (p) {
      while (p.length > 260) {
        var cut = p.lastIndexOf(", ", 220);
        if (cut < 80) cut = p.lastIndexOf(" ", 220);
        if (cut < 80) cut = 220;
        out.push(p.slice(0, cut + 1).trim());
        p = p.slice(cut + 1).trim();
      }
      if (!p) return;
      var last = out[out.length - 1];
      if (last && last.length + p.length < 120) out[out.length - 1] = last + " " + p;
      else out.push(p);
    });
    return out.length ? out : [text];
  }

  function scoreVoice(v, lang) {
    var s = 0;
    var vl = String(v.lang || "").replace("_", "-").toLowerCase();
    var prefs = (navigator.languages || [navigator.language || ""]).map(function (x) { return String(x).toLowerCase(); });
    var exact = prefs.indexOf(vl);
    if (exact >= 0) s += 8 - Math.min(exact, 4);
    if (v.default) s += 3;
    if (/natural|neural|premium|enhanced|siri/i.test(v.name || "")) s += 4;
    if (/google/i.test(v.name || "")) s += 2;
    if (v.localService) s += navigator.onLine === false ? 6 : 1;
    if (lang === "es" && /es-(es|mx|us|419)/.test(vl)) s += 1;
    if (lang === "en" && /en-(us|gb)/.test(vl)) s += 1;
    return s;
  }

  function voicesFor(lang) {
    return engine.voices().filter(function (v) { return base(v.lang) === lang; });
  }

  function pickVoice(lang) {
    var list = voicesFor(lang);
    if (!list.length) return null;
    var want = voicePref(lang);
    var chosen = want && list.find(function (v) { return v.voiceURI === want; });
    if (chosen) return chosen;
    return list.slice().sort(function (a, b) { return scoreVoice(b, lang) - scoreVoice(a, lang); })[0];
  }

  function webEngine() {
    var S = window.speechSynthesis;
    var list = [];
    var holder = null;
    function load() { try { list = S.getVoices() || []; } catch (e) { list = []; } }
    load();
    if (S.addEventListener) S.addEventListener("voiceschanged", function () { load(); refreshVoices(); });
    return {
      name: "web",
      voices: function () { return list; },
      speak: function (text, opts, done) {
        var u = new SpeechSynthesisUtterance(text);
        u.lang = opts.voice ? opts.voice.lang : opts.lang;
        if (opts.voice) u.voice = opts.voice;
        u.rate = opts.rate;
        u.onend = function () { done(null); };
        u.onerror = function (e) { done(e && e.error ? e.error : "error"); };
        holder = u;
        try { if (S.paused) S.resume(); S.speak(u); } catch (e) { done("error"); }
      },
      stop: function () { holder = null; try { S.cancel(); } catch (e) {} }
    };
  }

  function nativeEngine(tts) {
    var list = [];
    tts.getSupportedVoices().then(function (r) { list = (r && r.voices) || []; refreshVoices(); }).catch(function () {});
    return {
      name: "native",
      voices: function () { return list; },
      speak: function (text, opts, done) {
        var o = { text: text, lang: opts.voice ? opts.voice.lang : opts.lang, rate: opts.rate, pitch: 1, volume: 1, category: "playback", queueStrategy: 0 };
        var vi = opts.voice ? list.indexOf(opts.voice) : -1;
        if (vi >= 0) o.voice = vi;
        tts.speak(o).then(function () { done(null); }).catch(function (e) { done(String(e && e.message || "error")); });
      },
      stop: function () { try { tts.stop().catch(function () {}); } catch (e) {} }
    };
  }

  function el(tag, attrs, html) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (html !== undefined) n.innerHTML = html;
    return n;
  }

  function iconBtn(cls, label, icon) {
    var b = el("button", { type: "button", class: "listen-ib " + cls, "aria-label": label, title: label }, icon);
    return b;
  }

  function build(slot) {
    var wrap = el("div", { class: "listen-inline" });
    ui.start = el("button", { type: "button", class: "act listen-start" });
    ui.startLabel = el("span", { class: "label" });
    ui.start.innerHTML = ICONS.speaker;
    ui.start.appendChild(ui.startLabel);
    ui.resumeNote = el("span", { class: "listen-resume-note muted" });
    ui.over = el("button", { type: "button", class: "chip listen-over" });
    ui.over.textContent = T("listen.startOver");
    wrap.appendChild(ui.start);
    wrap.appendChild(ui.resumeNote);
    wrap.appendChild(ui.over);
    slot.appendChild(wrap);

    var bar = el("section", { class: "listen-bar", "aria-label": T("listen.player"), hidden: "" });
    var opts = el("div", { class: "listen-opts", id: "listen-opts", hidden: "" });
    var speed = el("div", { class: "listen-field" });
    speed.appendChild(el("span", { class: "listen-field-label", id: "listen-speed-l" }, T("listen.speed")));
    ui.rates = el("div", { class: "segmented", role: "radiogroup", "aria-labelledby": "listen-speed-l" });
    RATES.forEach(function (r) {
      var b = el("button", { type: "button", role: "radio", "data-rate": String(r), "aria-checked": "false" });
      b.textContent = T("listen.rate", { r: String(r).replace(".", P.lang === "es" ? "," : ".") });
      ui.rates.appendChild(b);
    });
    speed.appendChild(ui.rates);
    var voice = el("div", { class: "listen-field" });
    voice.appendChild(el("label", { class: "listen-field-label", for: "listen-voice" }, T("listen.voice")));
    ui.voice = el("select", { id: "listen-voice" });
    voice.appendChild(ui.voice);
    opts.appendChild(speed);
    opts.appendChild(voice);
    ui.opts = opts;

    var row = el("div", { class: "listen-row" });
    var info = el("div", { class: "listen-info" });
    ui.title = el("p", { class: "listen-title" });
    ui.title.textContent = document.querySelector("main.lesson h1") ? document.querySelector("main.lesson h1").textContent.trim() : document.title;
    ui.progress = el("p", { class: "listen-progress" });
    info.appendChild(ui.title);
    info.appendChild(ui.progress);
    var ctl = el("div", { class: "listen-ctl" });
    ui.prev = iconBtn("listen-prev", T("listen.prev"), ICONS.prev);
    ui.play = iconBtn("listen-play", T("listen.play"), ICONS.play);
    ui.next = iconBtn("listen-next", T("listen.next"), ICONS.next);
    ui.more = iconBtn("listen-more", T("listen.options"), ICONS.options);
    ui.more.setAttribute("aria-expanded", "false");
    ui.more.setAttribute("aria-controls", "listen-opts");
    ui.close = iconBtn("listen-close", T("listen.close"), ICONS.close);
    [ui.prev, ui.play, ui.next].forEach(function (b) { ctl.appendChild(b); });
    var side = el("div", { class: "listen-side" });
    side.appendChild(ui.more);
    side.appendChild(ui.close);
    row.appendChild(info);
    row.appendChild(ctl);
    row.appendChild(side);
    ui.live = el("p", { class: "sr", "aria-live": "polite" });
    bar.appendChild(opts);
    bar.appendChild(row);
    bar.appendChild(ui.live);
    document.body.appendChild(bar);
    ui.bar = bar;

    ui.start.addEventListener("click", function () {
      if (playing) { pause(); return; }
      if (!active) { var s = Number(A.get(key())) || 0; idx = s > 0 && s < units.length ? s : 0; ci = 0; }
      userJump = true;
      play();
    });
    ui.over.addEventListener("click", function () { idx = 0; ci = 0; userJump = true; play(); });
    ui.play.addEventListener("click", function () { if (playing) pause(); else { userJump = !active || !current; play(); } });
    ui.prev.addEventListener("click", function () { go(idx - 1); });
    ui.next.addEventListener("click", function () { go(idx + 1); });
    ui.close.addEventListener("click", close);
    ui.more.addEventListener("click", function () {
      var open = ui.opts.hidden;
      ui.opts.hidden = !open;
      ui.more.setAttribute("aria-expanded", String(open));
    });
    ui.rates.addEventListener("click", function (e) {
      var b = e.target.closest("[data-rate]");
      if (!b) return;
      A.set("pref:listenRate", Number(b.getAttribute("data-rate")));
      paintRates();
      restartChunk();
    });
    ui.rates.addEventListener("keydown", function (e) {
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].indexOf(e.key) < 0) return;
      e.preventDefault();
      var i = RATES.indexOf(rate()) + (e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1);
      i = Math.max(0, Math.min(RATES.length - 1, i));
      A.set("pref:listenRate", RATES[i]);
      paintRates();
      ui.rates.querySelector('[aria-checked="true"]').focus();
      restartChunk();
    });
    ui.voice.addEventListener("change", function () {
      A.set("pref:listenVoice:" + voiceLang(), ui.voice.value);
      restartChunk();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !ui.opts.hidden && ui.bar.contains(document.activeElement)) { ui.opts.hidden = true; ui.more.setAttribute("aria-expanded", "false"); ui.more.focus(); }
    });
    paintRates();
    refreshVoices();
    paint();
  }

  function voiceLang() { return units.length ? units[Math.min(idx, units.length - 1)].lang : P.lang; }

  function paintRates() {
    var r = rate();
    ui.rates.querySelectorAll("[data-rate]").forEach(function (b) {
      var on = Number(b.getAttribute("data-rate")) === r;
      b.setAttribute("aria-checked", String(on));
      b.tabIndex = on ? 0 : -1;
    });
  }

  function refreshVoices() {
    if (!ui.voice || !engine) return;
    var lang = voiceLang();
    var list = voicesFor(lang);
    var want = voicePref(lang);
    ui.voice.innerHTML = "";
    var auto = el("option", { value: "" });
    auto.textContent = T("listen.voiceAuto");
    ui.voice.appendChild(auto);
    list.forEach(function (v) {
      var o = el("option", { value: v.voiceURI });
      o.textContent = v.name + (v.lang ? " (" + v.lang + ")" : "");
      ui.voice.appendChild(o);
    });
    ui.voice.value = list.some(function (v) { return v.voiceURI === want; }) ? want : "";
    ui.voice.disabled = !list.length;
  }

  function paint() {
    var saved = Number(A.get(key())) || 0;
    var resumable = !active && saved > 0 && saved < units.length;
    ui.startLabel.textContent = playing ? T("listen.pauseListening") : active ? T("listen.resume") : resumable ? T("listen.resume") : T("listen.listen");
    ui.start.classList.toggle("is-playing", playing);
    ui.resumeNote.textContent = resumable ? T("listen.resumeAt", { n: saved + 1, total: units.length }) : "";
    ui.resumeNote.hidden = !resumable;
    ui.over.hidden = !resumable;
    ui.bar.hidden = !active;
    document.documentElement.classList.toggle("listen-on", active);
    ui.play.innerHTML = playing ? ICONS.pause : ICONS.play;
    ui.play.setAttribute("aria-label", playing ? T("listen.pause") : T("listen.play"));
    ui.play.title = ui.play.getAttribute("aria-label");
    ui.prev.disabled = idx <= 0;
    ui.next.disabled = idx >= units.length - 1;
    ui.progress.textContent = idx >= units.length ? T("listen.state.done") : T("listen.progress", { n: Math.min(idx, units.length - 1) + 1, total: units.length });
    media();
  }

  function announce(k) { ui.live.textContent = T(k); }

  function visible(node) {
    if (!node) return false;
    var r = node.getBoundingClientRect();
    var top = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
    var bottom = window.innerHeight - (ui.bar && !ui.bar.hidden ? ui.bar.offsetHeight + 16 : 0);
    return r.bottom > top && r.top < bottom && r.width > 0;
  }

  function fullyVisible(node) {
    var r = node.getBoundingClientRect();
    var top = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
    var bottom = window.innerHeight - (ui.bar && !ui.bar.hidden ? ui.bar.offsetHeight + 16 : 0);
    return r.top >= top && r.bottom <= bottom;
  }

  function highlight(u) {
    var wasVisible = current ? visible(current) : true;
    var keep = userJump || wasVisible || visible(u.el);
    userJump = false;
    if (current) current.classList.remove("listen-current");
    current = u.el;
    current.classList.add("listen-current");
    if (keep && !fullyVisible(current)) {
      var d = current.closest("details");
      if (d && !d.open) return;
      var tall = current.getBoundingClientRect().height > window.innerHeight * 0.6;
      current.scrollIntoView({ block: tall ? "start" : "center", behavior: reduced() ? "auto" : "smooth" });
    }
  }

  function unhighlight() {
    if (current) current.classList.remove("listen-current");
    current = null;
  }

  function prepare() { chunks = split(units[idx].text); }

  function speakCurrent() {
    if (!playing) return;
    if (idx >= units.length) { finish(); return; }
    var u = units[idx];
    if (ci === 0 || !current) { highlight(u); A.set(key(), idx); }
    var g = ++gen;
    engine.speak(chunks[ci], { lang: u.lang, rate: rate(), voice: pickVoice(u.lang) }, function (err) {
      if (g !== gen || !playing) return;
      if (err && err !== "interrupted" && err !== "canceled") {
        playing = false;
        gen++;
        ui.progress.textContent = T("listen.error");
        announce("listen.error");
        ui.play.innerHTML = ICONS.play;
        ui.play.setAttribute("aria-label", T("listen.play"));
        ui.start.classList.remove("is-playing");
        ui.startLabel.textContent = T("listen.resume");
        media();
        return;
      }
      ci++;
      if (ci < chunks.length) { speakCurrent(); return; }
      idx++;
      ci = 0;
      if (idx >= units.length) { finish(); return; }
      prepare();
      paint();
      speakCurrent();
    });
  }

  function play() {
    if (!units.length) return;
    if (idx >= units.length) idx = 0;
    var wasActive = active;
    active = true;
    playing = true;
    if (!chunks.length || ci === 0) prepare();
    if (ci >= chunks.length) ci = 0;
    engine.stop();
    paint();
    refreshVoices();
    announce("listen.state.playing");
    if (!wasActive && ui.bar) ui.bar.classList.add("listen-enter");
    speakCurrent();
  }

  function pause() {
    playing = false;
    gen++;
    engine.stop();
    paint();
    announce("listen.state.paused");
  }

  function go(i) {
    if (!units.length) return;
    i = Math.max(0, Math.min(units.length - 1, i));
    gen++;
    engine.stop();
    idx = i;
    ci = 0;
    prepare();
    userJump = true;
    if (playing) { paint(); speakCurrent(); }
    else { highlight(units[idx]); A.set(key(), idx); paint(); refreshVoices(); }
  }

  function restartChunk() {
    if (!playing) return;
    gen++;
    engine.stop();
    speakCurrent();
  }

  function finish() {
    playing = false;
    gen++;
    idx = units.length;
    unhighlight();
    A.set(key(), 0);
    paint();
    announce("listen.state.done");
    idx = 0;
    ci = 0;
    chunks = [];
    ui.prev.disabled = true;
    ui.next.disabled = units.length < 2;
  }

  function close() {
    var focusBack = ui.bar.contains(document.activeElement);
    playing = false;
    gen++;
    engine.stop();
    active = false;
    unhighlight();
    ui.opts.hidden = true;
    ui.more.setAttribute("aria-expanded", "false");
    paint();
    if (focusBack) ui.start.focus();
  }

  function media() {
    var ms = navigator.mediaSession;
    if (!ms) return;
    try {
      if (active && window.MediaMetadata) {
        var course = P.courseTitle || "";
        ms.metadata = new MediaMetadata({ title: ui.title.textContent, artist: course || "AI Academy", album: "AI Academy" });
      }
      ms.playbackState = playing ? "playing" : active ? "paused" : "none";
    } catch (e) {}
  }

  function bindMedia() {
    var ms = navigator.mediaSession;
    if (!ms || !ms.setActionHandler) return;
    var h = {
      play: function () { if (active && !playing) play(); },
      pause: function () { if (playing) pause(); },
      stop: function () { if (active) close(); },
      previoustrack: function () { if (active) go(idx - 1); },
      nexttrack: function () { if (active) go(idx + 1); }
    };
    Object.keys(h).forEach(function (k) { try { ms.setActionHandler(k, h[k]); } catch (e) {} });
  }

  function start(eng) {
    if (engine) return;
    var slot = document.getElementById("slot-lesson") || document.getElementById("slot-note");
    if (!slot) return;
    units = collect();
    if (!units.length) return;
    engine = eng;
    engine.stop();
    build(slot);
    bindMedia();
    window.addEventListener("pagehide", function () { playing = false; gen++; engine.stop(); });
    window.addEventListener("pageshow", function (e) { if (e.persisted && active) { playing = false; paint(); } });
    A.onChange(function (k) {
      if (k === "pref:listenRate") paintRates();
      else if (k.indexOf("pref:listenVoice:") === 0) refreshVoices();
      else if (k === key() && !active) paint();
    });
    A.hooks.listen = { units: function () { return units.map(function (u) { return { text: u.text, lang: u.lang }; }); }, state: function () { return { idx: idx, ci: ci, playing: playing, active: active, engine: engine.name }; } };
  }

  function init() {
    A = window.__aia;
    if (!A) return;
    P = A.page || window.__PAGE || {};
    if (P.kind !== "lesson" && P.kind !== "note") return;
    T = A.t;
    var inApp = !!(window.androidBridge || (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()));
    var web = "speechSynthesis" in window && typeof window.SpeechSynthesisUtterance === "function";
    if (!inApp) { if (web) start(webEngine()); return; }
    var settled = false;
    function onNative() {
      if (settled) return;
      settled = true;
      var tts = A.native && A.native.tts;
      if (tts) start(nativeEngine(tts));
      else if (web) start(webEngine());
    }
    if (A.native) onNative();
    else {
      document.addEventListener("aia:native", onNative);
      setTimeout(onNative, 4000);
    }
  }

  if (window.__aia) init();
  else document.addEventListener("aia:ready", init);
})();
