(function () {
  var P = window.__PAGE || {};
  var T = window.__T || {};
  var CFG = window.__CONFIG || {};
  var STATE_KEY = "aia:state";
  var LEGACY_COURSE = "ai-engineering";
  var SUPABASE_CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js";

  function t(key, vars) {
    var s = T[key] || key;
    return s.replace(/\{(\w+)\}/g, function (_, k) { return vars && vars[k] !== undefined ? vars[k] : "{" + k + "}"; });
  }
  function $(sel, el) { return (el || document).querySelector(sel); }
  function $$(sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); }
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "text") n.textContent = attrs[k];
      else if (k === "html") n.innerHTML = attrs[k];
      else if (k.indexOf("on") === 0) n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  function ls(op, key, value) {
    try {
      if (op === "get") return window.localStorage.getItem(key);
      if (op === "set") { window.localStorage.setItem(key, value); return true; }
      if (op === "del") { window.localStorage.removeItem(key); return true; }
    } catch (e) {}
    return op === "get" ? null : false;
  }
  function ss(op, key, value) {
    try {
      if (op === "get") return window.sessionStorage.getItem(key);
      if (op === "set") { window.sessionStorage.setItem(key, value); return true; }
      if (op === "del") { window.sessionStorage.removeItem(key); return true; }
    } catch (e) {}
    return null;
  }

  var storageOk = true;
  var state = loadState();
  var listeners = [];
  function loadState() {
    var raw = ls("get", STATE_KEY);
    var s = null;
    if (raw) { try { s = JSON.parse(raw); } catch (e) { s = null; } }
    if (!s || s.v !== 2) s = { v: 2, items: {}, meta: { account: null, dirty: {}, lastSync: 0 } };
    if (!s.meta.dirty) s.meta.dirty = {};
    migrateV1(s);
    migrateKeys(s);
    return s;
  }
  function normalizeKey(k) {
    var m = k.match(/^(done|pred|bm|pos):([^/]+)$/);
    if (m) return m[1] + ":" + LEGACY_COURSE + "/" + m[2];
    m = k.match(/^quiz:([^/:]+):(\d+)$/);
    if (m) return "quiz:" + LEGACY_COURSE + "/" + m[1] + ":" + m[2];
    return k;
  }
  function normalizeValue(k, v) {
    if (k === "last" && v && typeof v === "object") {
      var key = v.key || v.slug;
      if (key && key.indexOf("/") < 0) key = LEGACY_COURSE + "/" + key;
      return { key: key, n: v.n, title: v.title, url: v.url || key + ".html" };
    }
    return v;
  }
  function normalizeItems(items) {
    var outItems = {}, now = Date.now();
    Object.keys(items || {}).forEach(function (k) {
      var it = items[k];
      if (!it) return;
      var nk = normalizeKey(k);
      var value = { v: normalizeValue(nk, it.v), t: it.t };
      if (!outItems[nk] || outItems[nk].t < value.t) outItems[nk] = value;
      if (nk !== k && it.v !== null) outItems[k] = { v: null, t: Math.max(it.t + 1, now) };
    });
    return outItems;
  }
  function migrateKeys(s) {
    var changed = false;
    Object.keys(s.items).forEach(function (k) {
      var it = s.items[k];
      var nk = normalizeKey(k);
      var nv = normalizeValue(nk, it.v);
      if (nk === k && nv === it.v) return;
      if (nk === k) { s.items[k] = { v: nv, t: it.t }; changed = true; return; }
      if (it.v === null) return;
      var cur = s.items[nk];
      if (!cur || cur.t < it.t) { s.items[nk] = { v: nv, t: it.t }; s.meta.dirty[nk] = 1; }
      s.items[k] = { v: null, t: Date.now() };
      s.meta.dirty[k] = 1;
      changed = true;
    });
    if (changed) { s.v = 2; s.meta.migrated = 3; ls("set", STATE_KEY, JSON.stringify(s)); }
  }
  function migrateV1(s) {
    var keys = [];
    try { for (var i = 0; i < window.localStorage.length; i++) keys.push(window.localStorage.key(i)); } catch (e) { return; }
    var moved = false;
    keys.forEach(function (k) {
      if (!/^aia:(done|pred):/.test(k)) return;
      var key = k.slice(4);
      var v = ls("get", k);
      if (v !== null && !s.items[key]) {
        s.items[key] = { v: key.indexOf("done:") === 0 ? v === "1" : v, t: Date.now() };
        s.meta.dirty[key] = 1;
        moved = true;
      }
      ls("del", k);
    });
    if (moved) ls("set", STATE_KEY, JSON.stringify(s));
  }
  function saveState() {
    storageOk = ls("set", STATE_KEY, JSON.stringify(state));
    return storageOk;
  }
  function get(key) {
    var it = state.items[key];
    return it && it.v !== null && it.v !== undefined ? it.v : undefined;
  }
  function set(key, value) {
    state.items[key] = { v: value, t: Date.now() };
    state.meta.dirty[key] = 1;
    var ok = saveState();
    listeners.forEach(function (fn) { fn(key); });
    scheduleSync();
    return ok;
  }
  function onChange(fn) { listeners.push(fn); }
  function learningKeys() {
    return Object.keys(state.items).filter(function (k) { return k.indexOf("pref:") !== 0 && state.items[k].v !== null && state.items[k].v !== undefined; });
  }
  function mergeItems(incoming, conflictAll) {
    var applied = 0;
    incoming = normalizeItems(incoming);
    Object.keys(incoming).forEach(function (key) {
      var r = incoming[key];
      if (!r || typeof r.t !== "number") return;
      var l = state.items[key];
      if (!l) { state.items[key] = { v: r.v, t: r.t }; applied++; return; }
      if (r.t > l.t) {
        var changedHere = conflictAll || state.meta.dirty[key];
        if (key.indexOf("pred:") === 0 && changedHere && typeof l.v === "string" && typeof r.v === "string" && l.v.trim() && r.v.trim() && l.v !== r.v && l.v.indexOf(r.v) < 0 && r.v.indexOf(l.v) < 0) {
          state.items[key] = { v: l.v + "\n\n---\n" + t("merge.conflict") + ":\n" + r.v, t: Date.now() };
          state.meta.dirty[key] = 1;
        } else {
          state.items[key] = { v: r.v, t: r.t };
          if (!conflictAll) delete state.meta.dirty[key];
        }
        applied++;
      } else if (r.t < l.t) {
        state.meta.dirty[key] = 1;
      }
    });
    saveState();
    listeners.forEach(function (fn) { fn("*"); });
    return applied;
  }

  function resolvedTheme() {
    var a = document.documentElement.getAttribute("data-theme");
    if (a === "light" || a === "dark") return a;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function applyTheme(choice) {
    if (choice === "light" || choice === "dark") document.documentElement.setAttribute("data-theme", choice);
    else document.documentElement.removeAttribute("data-theme");
    $$("[data-theme-choice]").forEach(function (b) { b.setAttribute("aria-checked", b.getAttribute("data-theme-choice") === choice ? "true" : "false"); });
    renderMermaid();
  }
  function initNav() {
    var nav = $("#course-nav");
    if (!nav) return;
    function apply(hidden) {
      document.documentElement.classList.toggle("nav-hidden", hidden);
      $$("[data-nav-toggle]").forEach(function (b) { b.setAttribute("aria-expanded", hidden ? "false" : "true"); });
    }
    apply(ls("get", "aia:nav") === "hidden");
    $$("[data-nav-toggle]").forEach(function (b) {
      b.addEventListener("click", function () {
        var hidden = !document.documentElement.classList.contains("nav-hidden");
        if (hidden) ls("set", "aia:nav", "hidden"); else ls("del", "aia:nav");
        apply(hidden);
        if (!hidden) { var first = $(".nav-hide"); if (first) first.focus(); } else { var show = $(".nav-show"); if (show) show.focus(); }
      });
    });
    function paint() {
      var done = {};
      $$(".nav-item[data-key]", nav).forEach(function (a) {
        var key = a.getAttribute("data-key");
        var st = lessonStatus(key, 0);
        a.setAttribute("data-state", st);
        var c = key.split("/")[0];
        done[c] = done[c] || { d: 0, n: 0 };
        done[c].n++;
        if (st === "done") done[c].d++;
      });
      Object.keys(done).forEach(function (c) {
        var pEl = nav.querySelector('[data-nav-progress="' + c + '"]');
        if (pEl) pEl.textContent = t("home.progress", { done: done[c].d, total: done[c].n });
      });
    }
    paint();
    onChange(paint);
    var cur = nav.querySelector('[aria-current="page"]');
    if (cur) nav.scrollTop = Math.max(0, cur.offsetTop - nav.clientHeight / 2);
  }

  function initOfflineSettings() {
    var body = $("#offline-body");
    if (!body || !("caches" in window) || !("serviceWorker" in navigator)) return;
    var langRoot = new URL((P.rel || "./") + (P.lang === "es" ? "es/" : ""), location.href).href;
    var rt = P.runtime ? new URL(P.runtime.base, location.href).href : null;
    var pages = null;
    function pageCache() {
      return caches.keys().then(function (keys) {
        var k = keys.filter(function (x) { return x.indexOf("aia-") === 0 && x.indexOf("aia-rt-") !== 0; });
        return caches.open(k.length ? k[k.length - 1] : "aia-pages");
      });
    }
    function pageList() {
      if (pages) return Promise.resolve(pages);
      return fetch(langRoot + "search.json").then(function (r) { return r.json(); }).then(function (j) {
        var urls = j.map(function (d) { return langRoot + d.url; });
        var courses = {};
        j.forEach(function (d) { if (d.course) courses[langRoot + d.course + "/index.html"] = 1; });
        pages = [langRoot + "index.html"].concat(Object.keys(courses), urls);
        return pages;
      });
    }
    function runtimeList() {
      if (!rt) return Promise.resolve([]);
      return Promise.all([fetch(rt + "manifest.json").then(function (r) { return r.json(); }), fetch(rt + "pyodide/pyodide-lock.json").then(function (r) { return r.json(); })]).then(function (res) {
        var m = res[0], lock = res[1];
        var list = ["manifest.json", "py-worker.mjs", "shims/tiktoken.py", "shims/sentence_transformers.py", "pyodide/pyodide.mjs", "pyodide/pyodide.asm.mjs", "pyodide/pyodide.asm.wasm", "pyodide/python_stdlib.zip", "pyodide/pyodide-lock.json"];
        var seen = {};
        function addPkg(name) {
          if (seen[name] || !lock.packages[name]) return;
          seen[name] = 1;
          list.push("pyodide/" + lock.packages[name].file_name);
          (lock.packages[name].depends || []).forEach(addPkg);
        }
        m.packages.forEach(addPkg);
        Object.keys(m.assets).forEach(function (a) { list.push("assets/" + a); });
        var bytes = m.core + Object.keys(m.assets).reduce(function (n, a) { return n + m.assets[a]; }, 0);
        return { urls: list.map(function (f) { return rt + f; }), bytes: bytes };
      });
    }
    function countCached(urls, cache) {
      return Promise.all(urls.map(function (u) { return cache.match(u, { ignoreSearch: true }).then(function (h) { return h ? 1 : 0; }); })).then(function (r) { return r.reduce(function (a, b) { return a + b; }, 0); });
    }
    var pagesLine = el("p", { class: "offline-line" });
    var pagesBtn = el("button", { type: "button", class: "btn", text: t("offline.savePages") });
    var rtLine = el("p", { class: "offline-line" });
    var rtBtn = el("button", { type: "button", class: "btn", text: t("offline.saveRuntime") });
    var bar = el("div", { class: "runner-progress", hidden: "" }, [el("span")]);
    function paint() {
      pageList().then(function (urls) {
        return pageCache().then(function (c) { return countCached(urls, c); }).then(function (n) {
          var lessonsTotal = urls.length;
          pagesLine.textContent = n >= lessonsTotal ? t("offline.pagesReady", { n: lessonsTotal }) : t("offline.pagesPartial", { n: n, total: lessonsTotal });
          pagesLine.setAttribute("data-ready", n >= lessonsTotal ? "1" : "0");
          pagesBtn.hidden = n >= lessonsTotal;
        });
      }).catch(function () { pagesLine.textContent = t("offline.offlineNow"); pagesBtn.hidden = true; });
      if (!rt) { rtLine.textContent = t("offline.runtimeHere"); rtBtn.hidden = true; return; }
      runtimeList().then(function (info) {
        return caches.keys().then(function (keys) {
          var k = keys.filter(function (x) { return x.indexOf("aia-rt-") === 0; });
          return k.length ? caches.open(k[k.length - 1]).then(function (c) { return countCached(info.urls, c); }) : 0;
        }).then(function (n) {
          var ready = n >= info.urls.length;
          rtLine.textContent = ready ? t("offline.runtimeReady") : t("offline.runtimeMissing", { size: (info.bytes / 1048576).toFixed(0) + " MB" });
          rtLine.setAttribute("data-ready", ready ? "1" : "0");
          rtBtn.hidden = ready;
        });
      }).catch(function () { rtLine.textContent = t("offline.offlineNow"); rtBtn.hidden = true; });
    }
    function fetchAll(urls, label, store) {
      bar.hidden = false;
      var fill = bar.firstChild;
      var done = 0;
      return urls.reduce(function (chain, u) {
        return chain.then(function () {
          return (store ? store.add(new Request(u, { cache: "reload" })) : fetch(u)).catch(function () {}).then(function () {
            done++;
            fill.style.width = Math.round(100 * done / urls.length) + "%";
            label.textContent = t("offline.saving", { n: done, total: urls.length });
          });
        });
      }, Promise.resolve()).then(function () { bar.hidden = true; paint(); });
    }
    pagesBtn.addEventListener("click", function () {
      pagesBtn.disabled = true;
      navigator.serviceWorker.ready.then(function () { return Promise.all([pageList(), pageCache()]); }).then(function (r) { return fetchAll(r[0], pagesLine, r[1]); }).catch(function () {}).then(function () { pagesBtn.disabled = false; });
    });
    rtBtn.addEventListener("click", function () {
      rtBtn.disabled = true;
      navigator.serviceWorker.ready.then(runtimeList).then(function (info) { return fetchAll(info.urls, rtLine, null); }).catch(function () {}).then(function () { rtBtn.disabled = false; });
    });
    body.innerHTML = "";
    body.appendChild(el("p", { class: "hint", text: t("offline.hint") }));
    body.appendChild(el("div", { class: "offline-row" }, [pagesLine, pagesBtn]));
    body.appendChild(el("div", { class: "offline-row" }, [rtLine, rtBtn]));
    body.appendChild(bar);
    var dlg = $("#account-dialog");
    if (dlg) {
      var observer = new MutationObserver(function () { if (dlg.open) paint(); });
      observer.observe(dlg, { attributes: true, attributeFilter: ["open"] });
    }
  }

  function initNative() {
    if (!window.Capacitor && !window.androidBridge) return;
    import(new URL(P.rel + "native.js", location.href).href).then(function (m) {
      if (m.isNative) setupNative(m.notifications);
    }).catch(function () {});
  }

  function setupNative(LN) {
    document.documentElement.classList.add("in-app");
    var root = new URL((P.rel || "./") + (P.lang === "es" ? "es/" : ""), location.href).href;
    var lessons = null;
    var timer;
    var ALL = [1, 2, 3, 4, 5, 6, 0];
    function pref() {
      var v = get("pref:remind");
      v = v && typeof v === "object" ? v : {};
      return { on: Boolean(v.on), time: v.time || "19:00", days: Array.isArray(v.days) && v.days.length ? v.days : ALL.slice() };
    }
    function loadLessons() {
      if (lessons) return Promise.resolve(lessons);
      return fetch(root + "search.json").then(function (r) { return r.json(); }).then(function (j) {
        lessons = j.filter(function (d) { return d.kind === "lesson"; }).sort(function (a, b) { return a.n - b.n; });
        return lessons;
      });
    }
    function studiedToday() {
      var start = new Date(); start.setHours(0, 0, 0, 0);
      return Object.keys(state.items).some(function (k) { return /^(done|pred|predq|quiz|code):/.test(k) && state.items[k].v !== null && state.items[k].t >= start.getTime(); });
    }
    function schedule() {
      if (!LN) return Promise.resolve();
      var p = pref();
      return LN.getPending().then(function (res) {
        var ids = (res.notifications || []).map(function (x) { return { id: x.id }; });
        return ids.length ? LN.cancel({ notifications: ids }) : null;
      }).then(function () {
        if (!p.on) return null;
        return loadLessons().then(function (list) {
          var next = list.find(function (l) { return !get("done:" + l.key); });
          var parts = String(p.time).split(":");
          var out = [];
          for (var d = 0; d < 21 && out.length < 10; d++) {
            var at = new Date();
            at.setDate(at.getDate() + d);
            at.setHours(+parts[0] || 0, +parts[1] || 0, 0, 0);
            if (p.days.indexOf(at.getDay()) < 0) continue;
            if (at.getTime() <= Date.now() + 60000) continue;
            if (d === 0 && studiedToday()) continue;
            out.push({
              id: 1001 + d,
              title: next ? t("remind.title", { n: next.n, title: next.title }) : t("remind.allDone"),
              body: next ? t("remind.body") : t("remind.allDone.body"),
              schedule: { at: at, allowWhileIdle: true },
              smallIcon: "ic_stat_aia",
              extra: { url: root + (next ? next.url : "index.html#review") }
            });
          }
          return out.length ? LN.schedule({ notifications: out }) : null;
        });
      }).catch(function () {});
    }
    if (LN) LN.addListener("localNotificationActionPerformed", function (a) {
      var u = a && a.notification && a.notification.extra && a.notification.extra.url;
      if (u) location.href = u;
    });
    var dialogBody = $("#account-dialog .sheet-body");
    if (dialogBody && !$("#remind-h")) {
      var p0 = pref();
      var toggle = el("button", { type: "button", role: "switch", class: "switch", "aria-checked": p0.on ? "true" : "false", "aria-labelledby": "remind-h" });
      var time = el("input", { type: "time", id: "remind-time", value: p0.time });
      var fmt = new Intl.DateTimeFormat(P.lang === "es" ? "es" : "en", { weekday: "short" });
      var dayButtons = ALL.map(function (d) {
        var ref = new Date(2024, 0, 7 + d);
        return el("button", { type: "button", class: "chip day", "data-day": String(d), "aria-pressed": p0.days.indexOf(d) >= 0 ? "true" : "false", text: fmt.format(ref).replace(".", "") });
      });
      var status = el("p", { class: "status", "aria-live": "polite" });
      function current() {
        var days = dayButtons.filter(function (b) { return b.getAttribute("aria-pressed") === "true"; }).map(function (b) { return +b.getAttribute("data-day"); });
        return { on: toggle.getAttribute("aria-checked") === "true", time: time.value || "19:00", days: days };
      }
      function summary(v) {
        if (!v.on) return t("remind.off");
        var names = v.days.length === 7 ? t("remind.everyDay") : dayButtons.filter(function (b) { return b.getAttribute("aria-pressed") === "true"; }).map(function (b) { return b.textContent; }).join(", ");
        return t("remind.saved", { time: v.time, days: names });
      }
      function save() {
        var v = current();
        if (!v.days.length) { status.textContent = t("remind.noDays"); return; }
        set("pref:remind", v);
        schedule().then(function () { status.textContent = summary(v); });
      }
      toggle.addEventListener("click", function () {
        var on = toggle.getAttribute("aria-checked") !== "true";
        if (!on) { toggle.setAttribute("aria-checked", "false"); save(); return; }
        if (!LN) { status.textContent = t("remind.update"); return; }
        LN.checkPermissions().then(function (r) { return r.display === "granted" ? r : LN.requestPermissions(); }).then(function (r) {
          if (r.display === "granted") { toggle.setAttribute("aria-checked", "true"); save(); }
          else status.textContent = t("remind.denied");
        }).catch(function () { status.textContent = t("remind.denied"); });
      });
      time.addEventListener("change", save);
      dayButtons.forEach(function (b) { b.addEventListener("click", function () { b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") === "true" ? "false" : "true"); save(); }); });
      var group = el("section", { class: "group reminders", id: "reminders", "aria-labelledby": "remind-h" }, [
        el("div", { class: "switch-row" }, [el("h3", { id: "remind-h", text: t("remind.label") }), toggle]),
        el("div", { class: "time-row" }, [el("label", { for: "remind-time", text: t("remind.time") }), time]),
        el("div", { class: "days-row", role: "group", "aria-label": t("remind.days") }, dayButtons),
        el("p", { class: "hint", text: t("remind.hint") }),
        status
      ]);
      status.textContent = LN ? summary(p0) : t("remind.update");
      var first = dialogBody.querySelector(".group");
      dialogBody.insertBefore(group, first);
    }
    var bell = $("#remind-btn");
    if (bell) {
      bell.hidden = false;
      bell.addEventListener("click", function () {
        openAccount();
        setTimeout(function () { var g = $("#reminders"); if (g) { g.scrollIntoView({ block: "start" }); var sw = $(".reminders .switch"); if (sw) sw.focus(); } }, 50);
      });
    }
    schedule();
    onChange(function () { clearTimeout(timer); timer = setTimeout(schedule, 1500); });
    document.addEventListener("visibilitychange", function () { if (!document.hidden) schedule(); });
  }

  function initVisuals() {
    var slots = $$("[data-visual]");
    if (!slots.length || !("IntersectionObserver" in window)) return;
    var conn = navigator.connection;
    if (conn && conn.saveData) return;
    var probe = document.createElement("canvas");
    var gl = null;
    try { gl = probe.getContext("webgl2") || probe.getContext("webgl"); } catch (e) {}
    if (!gl) return;
    var mod = null;
    function load() { if (!mod) mod = import(new URL(P.rel + "visuals.js", location.href).href); return mod; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        io.unobserve(entry.target);
        var el = entry.target;
        load().then(function (m) {
          if (el.hasAttribute("data-map")) return m.courseMap(P.rel, P.lang).then(function (data) { m.mountMap(el, data); });
          m.mount(el, el.getAttribute("data-visual"));
        }).catch(function () {});
      });
    }, { rootMargin: "120px" });
    slots.forEach(function (el) { io.observe(el); });
  }

  function initFontSize() {
    var SIZES = { s: "90%", m: "", l: "112.5%", xl: "125%" };
    function apply(c) {
      document.documentElement.style.fontSize = SIZES[c] || "";
      $$("[data-font-choice]").forEach(function (b) { b.setAttribute("aria-checked", b.getAttribute("data-font-choice") === c ? "true" : "false"); });
    }
    var saved = ls("get", "aia:font");
    apply(SIZES[saved] !== undefined ? saved : "m");
    $$("[data-font-choice]").forEach(function (b) {
      b.addEventListener("click", function () {
        var c = b.getAttribute("data-font-choice");
        if (c === "m") ls("del", "aia:font"); else ls("set", "aia:font", c);
        apply(c);
      });
    });
  }

  function initTheme() {
    var saved = ls("get", "aia:theme");
    applyTheme(saved === "light" || saved === "dark" ? saved : "system");
    $$("[data-theme-choice]").forEach(function (b) {
      b.addEventListener("click", function () {
        var c = b.getAttribute("data-theme-choice");
        if (c === "system") ls("del", "aia:theme"); else ls("set", "aia:theme", c);
        set("pref:theme", c);
        applyTheme(c);
        var m = $("#theme-menu");
        if (m) m.removeAttribute("open");
      });
    });
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () { renderMermaid(); });
    window.matchMedia("(max-width: 40rem)").addEventListener("change", function () { renderMermaid(); });
    document.addEventListener("click", function (e) {
      var m = $("#theme-menu");
      if (m && m.hasAttribute("open") && !m.contains(e.target)) m.removeAttribute("open");
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { var m = $("#theme-menu"); if (m) m.removeAttribute("open"); }
    });
  }
  function initLang() {
    $$("[data-set-lang]").forEach(function (a) {
      a.addEventListener("click", function () {
        var lang = a.getAttribute("data-set-lang");
        ls("set", "aia:lang", lang);
        set("pref:lang", lang);
        if (P.kind === "lesson" || P.kind === "note") ss("set", "aia:restore", P.slug + ":" + scrollRatio());
      });
    });
  }

  function initCopy() {
    document.addEventListener("click", function (e) {
      var btn = e.target.closest && e.target.closest(".copy");
      if (!btn) return;
      var code = btn.closest(".code").querySelector("code");
      var text = code.innerText;
      function done(ok) {
        btn.textContent = ok ? t("code.copied") : t("code.copyFailed");
        setTimeout(function () { btn.textContent = t("code.copy"); }, 1600);
      }
      function legacy() {
        try {
          var ta = document.createElement("textarea");
          ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
          document.body.appendChild(ta); ta.select();
          var ok = document.execCommand("copy");
          document.body.removeChild(ta);
          done(ok);
        } catch (err) { done(false); }
      }
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(function () { done(true); }, legacy);
      else legacy();
    });
  }

  function fold(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }
  function scrollRatio() {
    var h = document.documentElement.scrollHeight - window.innerHeight;
    return h > 0 ? Math.min(1, Math.max(0, window.scrollY / h)) : 0;
  }
  function restoreScroll(ratio) {
    var attempts = 0;
    function go() {
      var h = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo(0, Math.round(ratio * h));
      if (++attempts < 3) setTimeout(go, 250);
    }
    requestAnimationFrame(go);
  }
  function lessonStatus(slug, quizCount) {
    if (get("done:" + slug)) return "done";
    var notes = get("pred:" + slug);
    if (typeof notes === "string" && notes.trim()) return "progress";
    if ((get("pos:" + slug) || 0) > 0.08) return "progress";
    for (var i = 0; i < (quizCount || 0); i++) if (get("quiz:" + slug + ":" + i)) return "progress";
    return "new";
  }

  function initLesson() {
    if (P.kind !== "lesson") return;
    var slug = P.slug;
    var doneBtn = $("#done-btn"), bmBtn = $("#bookmark-btn"), area = $("#predictions"), status = $("#save-status");
    function paintDone() {
      var on = Boolean(get("done:" + slug));
      doneBtn.setAttribute("aria-pressed", on ? "true" : "false");
      $(".label", doneBtn).textContent = on ? t("lesson.done.on") : t("lesson.done");
    }
    function paintBm() {
      var on = Boolean(get("bm:" + slug));
      bmBtn.setAttribute("aria-pressed", on ? "true" : "false");
      $(".label", bmBtn).textContent = on ? t("lesson.bookmarked") : t("lesson.bookmark");
    }
    paintDone(); paintBm();
    doneBtn.addEventListener("click", function () {
      var ok = set("done:" + slug, !get("done:" + slug));
      paintDone();
      if (!ok) status.textContent = t("lesson.notes.nostorage");
    });
    bmBtn.addEventListener("click", function () { set("bm:" + slug, !get("bm:" + slug)); paintBm(); });

    var saved = get("pred:" + slug);
    if (typeof saved === "string") area.value = saved;
    var timer;
    area.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        var ok = set("pred:" + slug, area.value);
        status.textContent = ok ? t("lesson.notes.saved") : t("lesson.notes.nostorage");
      }, 400);
    });
    onChange(function (key) {
      if (key === "*" || key === "pred:" + slug) {
        var v = get("pred:" + slug);
        if (typeof v === "string" && v !== area.value && document.activeElement !== area) area.value = v;
        paintDone(); paintBm(); paintQuiz();
      }
    });

    function paintQuiz() {
      $$(".quiz-item").forEach(function (item) {
        var i = item.getAttribute("data-q");
        var g = get("quiz:" + slug + ":" + i);
        item.classList.toggle("is-ok", g === "ok");
        item.classList.toggle("is-review", g === "review");
        $$("[data-grade]", item).forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-grade") === g ? "true" : "false"); });
        $(".quiz-state", item).textContent = g === "ok" ? t("lesson.quiz.state.ok") : g === "review" ? t("lesson.quiz.state.review") : "";
      });
    }
    paintQuiz();
    $$(".quiz-item").forEach(function (item) {
      var d = $("details", item), s = $("summary", item);
      d.addEventListener("toggle", function () { s.textContent = d.open ? t("lesson.quiz.hide") : t("lesson.quiz.show"); });
      $$("[data-grade]", item).forEach(function (b) {
        b.addEventListener("click", function () {
          var i = item.getAttribute("data-q"), g = b.getAttribute("data-grade");
          set("quiz:" + slug + ":" + i, get("quiz:" + slug + ":" + i) === g ? null : g);
          paintQuiz();
        });
      });
    });

    set("last", { key: slug, n: P.n, title: P.title, url: P.name });
    var posTimer, lastSavedPos = get("pos:" + slug) || 0;
    window.addEventListener("scroll", function () {
      clearTimeout(posTimer);
      posTimer = setTimeout(function () {
        var r = scrollRatio();
        if (Math.abs(r - lastSavedPos) > 0.03) { lastSavedPos = r; set("pos:" + slug, Math.round(r * 100) / 100); }
      }, 500);
    }, { passive: true });
    var restore = ss("get", "aia:restore");
    if (restore && restore.indexOf(slug + ":") === 0) { ss("del", "aia:restore"); restoreScroll(parseFloat(restore.split(":")[1]) || 0); }
    else if (location.hash === "#resume" && get("pos:" + slug)) restoreScroll(get("pos:" + slug));
  }

  function courseLessons(courseId) {
    return (P.lessons || []).filter(function (l) { return !courseId || (l.key.indexOf(courseId + "/") === 0); });
  }
  function paintRings(lessons) {
    $$("[data-ring]").forEach(function (r) {
      var id = r.getAttribute("data-ring");
      var list = lessons.filter(function (l) { return l.key.indexOf(id + "/") === 0; });
      var done = list.filter(function (l) { return lessonStatus(l.key, l.quiz) === "done"; }).length;
      var fill = $(".ring-fill", r);
      var c = parseFloat(fill.getAttribute("data-c"));
      var ratio = list.length ? done / list.length : 0;
      fill.style.strokeDashoffset = String(c * (1 - ratio));
      r.classList.toggle("is-done", list.length > 0 && done === list.length);
    });
  }
  function continueBlock(body, lessons, prefix) {
    body.innerHTML = "";
    body.className = "continue-body";
    var last = get("last");
    var lastKey = last && (last.key || last.slug);
    var lastLesson = lastKey && lessons.filter(function (l) { return l.key === lastKey; })[0];
    var scope = lastLesson ? lessons.filter(function (l) { return l.key.split("/")[0] === lastLesson.key.split("/")[0]; }) : lessons;
    var nextLesson = scope.filter(function (l) { return lessonStatus(l.key, l.quiz) !== "done"; })[0] || lessons.filter(function (l) { return lessonStatus(l.key, l.quiz) !== "done"; })[0];
    var anyProgress = lessons.some(function (l) { return lessonStatus(l.key, l.quiz) !== "new"; });
    if (!anyProgress && !lastLesson) {
      body.appendChild(el("p", { class: "hint", text: t("home.continue.start.hint") }));
      if (lessons[0]) body.appendChild(el("a", { class: "btn primary", href: prefix + lessons[0].url, text: t("home.continue.start") }));
      return;
    }
    var courseName = function (l) {
      var c = (P.courses || []).filter(function (x) { return l.key.indexOf(x.id + "/") === 0; })[0];
      return c && P.kind === "home" ? " · " + t("home.continue.in", { course: c.title }) : "";
    };
    if (lastLesson && lessonStatus(lastLesson.key, lastLesson.quiz) !== "done") {
      body.appendChild(el("div", { class: "continue-lesson" }, [
        el("span", { class: "big" }, [el("small", { text: t("home.continue.resume") + courseName(lastLesson) }), lastLesson.n + ". " + lastLesson.title]),
        el("a", { class: "btn primary", href: prefix + lastLesson.url + "#resume", text: t("home.continue.resume") })
      ]));
    }
    if (nextLesson && (!lastLesson || nextLesson.key !== lastLesson.key || lessonStatus(lastLesson.key, lastLesson.quiz) === "done")) {
      body.appendChild(el("div", { class: "continue-lesson" }, [
        el("span", { class: "big" }, [el("small", { text: t("home.continue.next") + courseName(nextLesson) }), nextLesson.n + ". " + nextLesson.title]),
        el("a", { class: "btn" + (body.children.length ? "" : " primary"), href: prefix + nextLesson.url, text: t("home.continue.next") })
      ]));
    }
    if (!nextLesson) body.appendChild(el("p", { class: "hint", text: t("home.continue.allDone") }));
  }
  function reviewBlock(lessons, prefix) {
    var review = $("#review"), list = $("#review-list");
    if (!review || !list) return;
    list.innerHTML = "";
    lessons.forEach(function (l) {
      var reviewCount = 0;
      for (var i = 0; i < l.quiz; i++) if (get("quiz:" + l.key + ":" + i) === "review") reviewCount++;
      var bm = Boolean(get("bm:" + l.key));
      if (!reviewCount && !bm) return;
      var labels = [];
      if (bm) labels.push(t("home.review.bookmarked"));
      if (reviewCount) labels.push(t("home.review.questions", { n: reviewCount }));
      list.appendChild(el("li", {}, [el("a", { class: "row", href: prefix + l.url + (reviewCount ? "#knowledge-check" : "") }, [
        el("span", { class: "num", "aria-hidden": "true", text: String(l.n) }),
        el("span", { class: "txt" }, [el("span", { class: "row-title", text: l.title }), el("span", { class: "row-sum", text: labels.join(" · ") })])
      ])]));
    });
    review.hidden = !list.children.length;
  }
  function initSearch(scope, prefix, indexUrl, onQuery) {
    var input = $("#search-input"), results = $("#search-results"), hits = $("#search-hits");
    if (!input) return;
    var index = null, st;
    function loadIndex() {
      if (index) return Promise.resolve(index);
      return fetch(indexUrl).then(function (r) { return r.json(); }).then(function (j) { index = j.filter(function (d) { return !scope || d.course === scope; }); return index; }).catch(function () { return []; });
    }
    function run(query) {
      if (onQuery) onQuery(query);
      if (query.length < 2) { results.hidden = true; return; }
      loadIndex().then(function (idx) {
        hits.innerHTML = "";
        var found = 0;
        idx.forEach(function (doc) {
          var label = (doc.n ? doc.n + ". " : "") + doc.title + (scope ? "" : " · " + doc.courseTitle);
          if (!scope && found < 20 && fold(doc.title + " " + doc.summary).indexOf(query) >= 0) {
            found++;
            hits.appendChild(el("li", {}, [el("a", { href: prefix + doc.url, text: doc.title }), el("small", { text: label })]));
          }
          doc.headings.forEach(function (h) {
            if (found >= 20) return;
            if (fold(h.text).indexOf(query) >= 0) {
              found++;
              hits.appendChild(el("li", {}, [el("a", { href: prefix + doc.url + "#" + h.id, text: h.text }), el("small", { text: label })]));
            }
          });
        });
        if (!found) hits.appendChild(el("li", { class: "muted", text: t("home.search.none") }));
        results.hidden = false;
      });
    }
    input.addEventListener("input", function () {
      clearTimeout(st);
      st = setTimeout(function () { run(fold(input.value.trim())); }, 150);
    });
    if (location.hash === "#search") setTimeout(function () { input.focus(); }, 50);
  }

  function initCourse() {
    if (P.kind !== "course") return;
    var lessons = P.lessons || [];
    var total = lessons.length;
    var totalMinutes = lessons.reduce(function (s, l) { return s + l.minutes; }, 0);
    var filter = "all", query = "";
    function paint() {
      var done = 0, left = 0;
      lessons.forEach(function (l) {
        var st = lessonStatus(l.key, l.quiz);
        if (st === "done") done++; else left += l.minutes;
        var row = $('.row[data-key="' + l.key + '"]');
        if (row) {
          var badge = $(".state", row);
          badge.setAttribute("data-state", st);
          badge.textContent = t("status." + st);
          row.setAttribute("data-status", st);
          row.setAttribute("data-saved", get("bm:" + l.key) ? "1" : "0");
        }
      });
      $("#progress-text").textContent = t("home.progress", { done: done, total: total });
      $("#progress-fill").style.width = total ? Math.round(done / total * 100) + "%" : "0%";
      $("#progress-time").textContent = t("home.progress.time", { minutes: left || totalMinutes });
      $("#progress-time").hidden = done === total;
      paintRings(lessons);
      continueBlock($("#continue-body"), lessons, "");
      applyFilter();
    }
    function applyFilter() {
      var any = false;
      $$(".track").forEach(function (track) {
        var visible = 0;
        $$("a.row[data-key]", track).forEach(function (row) {
          var st = row.getAttribute("data-status") || "new";
          var ok = filter === "all" || (filter === "saved" ? row.getAttribute("data-saved") === "1" : filter === "todo" ? st === "new" : st === filter);
          if (ok && query) ok = fold(row.getAttribute("data-title") + " " + $(".row-sum", row).textContent).indexOf(query) >= 0;
          row.parentElement.classList.toggle("is-hidden", !ok);
          if (ok) visible++;
        });
        var planned = $(".planned-list", track);
        if (planned) planned.hidden = filter !== "all" || Boolean(query);
        track.hidden = (filter !== "all" || query) && !visible;
        if (visible) any = true;
      });
      $("#filter-empty").hidden = any || !$$("a.row[data-key]").length;
    }
    $$("[data-filter]").forEach(function (b) {
      b.addEventListener("click", function () {
        filter = b.getAttribute("data-filter");
        $$("[data-filter]").forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
        applyFilter();
      });
    });
    initSearch(P.course, "../", "../search.json", function (q) { query = q; applyFilter(); });
    paint();
    onChange(function () { paint(); });
  }

  function initHome() {
    if (P.kind !== "home") return;
    var lessons = P.lessons || [];
    function paint() {
      paintRings(lessons);
      (P.courses || []).forEach(function (c) {
        var meta = $('[data-course-progress="' + c.id + '"]');
        var list = lessons.filter(function (l) { return l.key.indexOf(c.id + "/") === 0; });
        var done = list.filter(function (l) { return lessonStatus(l.key, l.quiz) === "done"; }).length;
        var started = list.some(function (l) { return lessonStatus(l.key, l.quiz) !== "new"; });
        if (meta) meta.textContent = !started ? t("course.lessons", { n: list.length }) + " · " + t("course.notStarted") : done === list.length ? t("course.lessons", { n: list.length }) + " · " + t("course.complete") : t("course.progress", { done: done, total: list.length });
      });
      continueBlock($("#continue-body"), lessons, "");
      reviewBlock(lessons, "");
    }
    initSearch("", "", "search.json");
    paint();
    onChange(function () { paint(); });

    var dataStatus = $("#data-status");
    $("#open-account").addEventListener("click", openAccount);
    $$("[data-action]").forEach(function (b) {
      b.addEventListener("click", function () {
        var a = b.getAttribute("data-action");
        if (a === "export") download("ai-academy-data.json", JSON.stringify({ app: "ai-academy", version: 3, exportedAt: new Date().toISOString(), items: state.items }, null, 2), "application/json");
        if (a === "export-md") download("ai-academy-notes.md", notesMarkdown(lessons), "text/markdown");
      });
    });
    $("#import-file").addEventListener("change", function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var j = JSON.parse(reader.result);
          if (!j || j.app !== "ai-academy" || !j.items) throw new Error("bad");
          var n = mergeItems(j.items, true);
          dataStatus.textContent = t("account.imported", { n: n });
          scheduleSync();
        } catch (err) { dataStatus.textContent = t("account.importFailed"); }
        e.target.value = "";
      };
      reader.readAsText(f);
    });
  }
  function notesMarkdown(lessons) {
    var lines = ["# AI Academy notes", "", new Date().toISOString().slice(0, 10), ""];
    (P.courses || []).forEach(function (c) {
      var list = lessons.filter(function (l) { return l.key.indexOf(c.id + "/") === 0 && typeof get("pred:" + l.key) === "string" && get("pred:" + l.key).trim(); });
      if (!list.length) return;
      lines.push("## " + c.title, "");
      list.forEach(function (l) {
        lines.push("### " + l.n + ". " + l.title, "", (get("done:" + l.key) ? "Status: done" : "Status: in progress"), "", get("pred:" + l.key).trim(), "");
      });
    });
    return lines.join("\n");
  }
  function download(name, content, type) {
    var blob = new Blob([content], { type: type });
    var a = el("a", { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function initToc() {
    var links = $$(".side .toc a");
    $$(".toc-inline a").forEach(function (a) {
      a.addEventListener("click", function () { var d = a.closest("details"); if (d) d.removeAttribute("open"); });
    });
    if (!links.length || !("IntersectionObserver" in window)) return;
    var map = {};
    links.forEach(function (a) { map[a.getAttribute("href").slice(1)] = a; });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting && map[en.target.id]) {
          links.forEach(function (a) { a.classList.remove("active"); });
          map[en.target.id].classList.add("active");
        }
      });
    }, { rootMargin: "-10% 0px -80% 0px" });
    Object.keys(map).forEach(function (id) { var e = document.getElementById(id); if (e) io.observe(e); });
  }

  var mermaidNodes = null;
  function renderMermaid() {
    if (!window.mermaid) return;
    if (!mermaidNodes) mermaidNodes = $$("pre.mermaid");
    if (!mermaidNodes.length) return;
    var dark = resolvedTheme() === "dark";
    window.mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "base", fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif", flowchart: { useMaxWidth: true, htmlLabels: true }, sequence: { useMaxWidth: true }, themeVariables: dark ? { background: "#1b2129", primaryColor: "#232b35", primaryTextColor: "#e8e6e1", primaryBorderColor: "#3b4654", lineColor: "#9b998f", secondaryColor: "#163038", tertiaryColor: "#1b2129", textColor: "#e8e6e1", fontSize: "14px" } : { background: "#fffdf9", primaryColor: "#efece5", primaryTextColor: "#1f1d1a", primaryBorderColor: "#cfcabf", lineColor: "#6c685f", secondaryColor: "#e0f0f2", tertiaryColor: "#fffdf9", textColor: "#1f1d1a", fontSize: "14px" } });
    var narrow = window.matchMedia("(max-width: 40rem)").matches;
    mermaidNodes.forEach(function (n) {
      var src = n.getAttribute("data-src");
      if (narrow) src = src.replace(/^(\s*(?:flowchart|graph))\s+(LR|RL)\b/m, "$1 TD");
      n.removeAttribute("data-processed");
      n.textContent = src;
    });
    window.mermaid.run({ nodes: mermaidNodes }).catch(function () {});
  }
  function initMermaid() {
    if (!$("pre.mermaid")) return;
    if (window.mermaid) renderMermaid(); else window.addEventListener("load", renderMermaid);
  }

  function initOffline() {
    var badge = $("#offline");
    function sync() {
      var off = navigator.onLine === false;
      if (badge) { badge.hidden = !off; badge.textContent = t("offline.badge"); badge.title = navigator.serviceWorker && navigator.serviceWorker.controller ? t("offline.cached") : ""; }
      paintSync();
      if (!off) scheduleSync(200);
    }
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    sync();
    if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
      window.addEventListener("load", function () { navigator.serviceWorker.register((P.rel || "") + "sw.js").catch(function () {}); });
    }
  }

  var sync = { configured: Boolean(CFG.supabaseUrl && CFG.supabaseAnonKey), client: null, session: null, status: "local", loading: false, loadError: false, running: false, queued: false, retry: 0, timer: null, message: "" };
  function paintSync() {
    var s = sync.status;
    if (!sync.session) s = "local";
    else if (navigator.onLine === false) s = Object.keys(state.meta.dirty).length ? "offline" : "synced";
    var dot = $("#sync-dot"), label = $("#sync-label");
    if (dot) dot.setAttribute("data-sync", s);
    var text = s === "local" ? (sync.configured ? t("sync.signin") : t("sync.local")) : t("sync." + s);
    if (label) label.textContent = text;
    var btn = $("#account-btn");
    if (btn) btn.title = t("nav.settings") + " · " + text;
    if ($("#account-dialog") && $("#account-dialog").open) renderAccount();
  }
  function loadSupabase() {
    if (sync.client) return Promise.resolve(sync.client);
    if (!sync.configured) return Promise.reject(new Error("not configured"));
    sync.loading = true;
    return new Promise(function (resolve, reject) {
      if (window.supabase) return resolve();
      var s = document.createElement("script");
      s.src = SUPABASE_CDN; s.async = true;
      s.onload = resolve; s.onerror = function () { reject(new Error("load")); };
      document.head.appendChild(s);
    }).then(function () {
      sync.client = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey);
      sync.loading = false;
      sync.client.auth.onAuthStateChange(function (event, session) {
        var had = Boolean(sync.session);
        sync.session = session;
        if (session && (!had || event === "SIGNED_IN")) onSignedIn(session);
        if (!session) { sync.status = "local"; }
        paintSync();
      });
      return sync.client.auth.getSession().then(function (r) {
        sync.session = r.data && r.data.session;
        if (sync.session) onSignedIn(sync.session);
        paintSync();
        return sync.client;
      });
    }).catch(function (e) { sync.loading = false; sync.loadError = true; paintSync(); throw e; });
  }
  function rowsToItems(rows) {
    var items = {};
    (rows || []).forEach(function (r) { items[r.key] = { v: r.value && r.value.v !== undefined ? r.value.v : null, t: new Date(r.updated_at).getTime() }; });
    return items;
  }
  function table() { return sync.client.from(CFG.supabaseTable || "learning_items"); }
  function pull(all) {
    var q = table().select("key,value,updated_at");
    if (!all && state.meta.lastSync) q = q.gt("updated_at", new Date(state.meta.lastSync - 120000).toISOString());
    return q.then(function (r) { if (r.error) throw r.error; return rowsToItems(r.data); });
  }
  function push() {
    var keys = Object.keys(state.meta.dirty).filter(function (k) { return state.items[k]; });
    if (!keys.length) return Promise.resolve();
    var snapshot = {};
    var rows = keys.map(function (k) { snapshot[k] = state.items[k].t; return { user_id: sync.session.user.id, key: k, value: { v: state.items[k].v }, updated_at: new Date(state.items[k].t).toISOString() }; });
    return table().upsert(rows, { onConflict: "user_id,key" }).then(function (r) {
      if (r.error) throw r.error;
      keys.forEach(function (k) { if (state.items[k] && state.items[k].t === snapshot[k]) delete state.meta.dirty[k]; });
      saveState();
    });
  }
  function runSync() {
    if (!sync.client || !sync.session || navigator.onLine === false) { paintSync(); return Promise.resolve(); }
    if (sync.running) { sync.queued = true; return Promise.resolve(); }
    sync.running = true; sync.status = "syncing"; paintSync();
    var started = Date.now();
    return pull(false).then(function (items) { mergeItems(items, false); return push(); }).then(function () {
      state.meta.lastSync = started; saveState();
      sync.status = "synced"; sync.retry = 0; sync.message = "";
    }).catch(function (e) {
      sync.status = "error"; sync.message = e && e.message ? e.message : String(e);
      sync.retry = Math.min(sync.retry + 1, 6);
      scheduleSync(Math.pow(2, sync.retry) * 1000);
    }).then(function () {
      sync.running = false; paintSync();
      if (sync.queued) { sync.queued = false; scheduleSync(300); }
    });
  }
  function scheduleSync(delay) {
    if (!sync.session) return;
    clearTimeout(sync.timer);
    sync.timer = setTimeout(runSync, delay || 1500);
    if (sync.status !== "syncing") { sync.status = "pending"; paintSync(); }
  }
  function onSignedIn(session) {
    var uid = session.user.id;
    if (state.meta.account === uid) { scheduleSync(100); return; }
    pull(true).then(function (remote) {
      var remoteKeys = Object.keys(remote);
      var localKeys = learningKeys();
      if (remoteKeys.length && localKeys.length) {
        askMerge().then(function (choice) {
          if (choice === "local") { return sync.client.auth.signOut(); }
          if (choice === "cloud") { state.items = {}; state.meta.dirty = {}; mergeItems(remote, false); }
          if (choice === "merge") { mergeItems(remote, true); localKeys.forEach(function (k) { state.meta.dirty[k] = 1; }); }
          state.meta.account = uid; saveState();
          return runSync();
        });
      } else {
        if (remoteKeys.length) mergeItems(remote, false);
        else localKeys.forEach(function (k) { state.meta.dirty[k] = 1; });
        state.meta.account = uid; saveState();
        runSync();
      }
    }).catch(function (e) { sync.status = "error"; sync.message = e && e.message ? e.message : String(e); paintSync(); scheduleSync(4000); });
  }
  function askMerge() {
    return new Promise(function (resolve) {
      var d = $("#merge-dialog");
      $$("[data-merge]", d).forEach(function (b) {
        b.onclick = function () { d.close(); resolve(b.getAttribute("data-merge")); };
      });
      d.showModal();
    });
  }
  function timeAgo(ts) {
    var m = Math.round((Date.now() - ts) / 60000);
    if (m < 1) return t("time.justNow");
    if (m < 60) return t("time.minutes", { n: m });
    if (m < 1440) return t("time.hours", { n: Math.round(m / 60) });
    return t("time.days", { n: Math.round(m / 1440) });
  }
  function renderAccount() {
    var body = $("#account-body");
    if (!body) return;
    body.innerHTML = "";
    var s = sync.session ? (navigator.onLine === false ? "offline" : sync.status) : "local";
    body.appendChild(el("p", { class: "sync-line" }, [el("span", { class: "sync-dot", "data-sync": s }), s === "local" ? t("sync.local") + ". " + t("sync.local.hint") : t("sync." + s) + (state.meta.lastSync ? " · " + t("sync.lastSync", { time: timeAgo(state.meta.lastSync) }) : "")]));
    if (sync.status === "error" && sync.message) body.appendChild(el("p", { class: "status", text: sync.message }));
    if (!sync.configured) {
      body.appendChild(el("p", { text: t("account.notConfigured") }));
    } else if (sync.loadError) {
      body.appendChild(el("p", { text: t("account.loadFailed") }));
    } else if (sync.loading || !sync.client) {
      body.appendChild(el("p", { class: "muted", text: t("account.loading") }));
    } else if (!sync.session) {
      body.appendChild(el("p", { text: t("account.intro") }));
      var input = el("input", { type: "email", id: "account-email", required: "", autocomplete: "email", placeholder: "you@example.com" });
      var msg = el("p", { class: "status", "aria-live": "polite" });
      var submit = el("button", { type: "submit", class: "btn primary", text: t("account.send") });
      var form = el("form", { onsubmit: function (e) {
        e.preventDefault();
        submit.disabled = true; submit.textContent = t("account.sending");
        sync.client.auth.signInWithOtp({ email: input.value.trim(), options: { emailRedirectTo: location.origin + location.pathname } }).then(function (r) {
          if (r.error) throw r.error;
          msg.textContent = t("account.sent");
          codeForm.hidden = false;
          code.focus();
        }).catch(function (err) { msg.textContent = t("account.sendFailed", { error: err.message || String(err) }); }).then(function () { submit.disabled = false; submit.textContent = t("account.send"); });
      } }, [el("label", { for: "account-email", text: t("account.email") }), input, submit, msg]);
      body.appendChild(form);
      var code = el("input", { type: "text", id: "account-code", inputmode: "numeric", autocomplete: "one-time-code", pattern: "[0-9]{6,10}", maxlength: "10", required: "", placeholder: "123456" });
      var verify = el("button", { type: "submit", class: "btn primary", text: t("account.verify") });
      var codeMsg = el("p", { class: "status", "aria-live": "polite" });
      var codeForm = el("form", { class: "code-form", onsubmit: function (e) {
        e.preventDefault();
        verify.disabled = true;
        sync.client.auth.verifyOtp({ email: input.value.trim(), token: code.value.trim(), type: "email" }).then(function (r) {
          if (r.error) throw r.error;
          codeMsg.textContent = t("account.verified");
        }).catch(function (err) { codeMsg.textContent = t("account.verifyFailed", { error: err.message || String(err) }); }).then(function () { verify.disabled = false; });
      } }, [el("label", { for: "account-code", text: t("account.code") }), el("p", { class: "hint", text: t("account.code.hint") }), code, verify, codeMsg]);
      codeForm.hidden = true;
      body.appendChild(codeForm);
    } else {
      body.appendChild(el("p", { text: t("account.signedInAs", { email: sync.session.user.email || "" }) }));
      var msg2 = el("p", { class: "status", "aria-live": "polite" });
      body.appendChild(el("div", { class: "dialog-actions" }, [
        el("button", { type: "button", class: "btn", text: t("account.syncNow"), onclick: function () { runSync(); } }),
        el("button", { type: "button", class: "btn", text: t("account.signOut"), onclick: function () { sync.client.auth.signOut().then(function () { sync.session = null; sync.status = "local"; paintSync(); }); } }),
        el("button", { type: "button", class: "btn danger", text: t("account.deleteCloud"), onclick: function () {
          if (!window.confirm(t("account.deleteCloud.confirm"))) return;
          table().delete().eq("user_id", sync.session.user.id).then(function (r) {
            if (r.error) throw r.error;
            state.meta.lastSync = 0; Object.keys(state.items).forEach(function (k) { state.meta.dirty[k] = 1; }); saveState();
            msg2.textContent = t("account.deleted");
          }).catch(function (err) { msg2.textContent = err.message || String(err); });
        } })
      ]));
      body.appendChild(el("p", { class: "hint", text: t("account.signOut.hint") }));
      body.appendChild(msg2);
    }
    body.appendChild(el("div", { class: "dialog-actions" }, [
      el("button", { type: "button", class: "btn", text: t("account.export"), onclick: function () { download("ai-academy-data.json", JSON.stringify({ app: "ai-academy", version: 2, exportedAt: new Date().toISOString(), items: state.items }, null, 2), "application/json"); } }),
      el("button", { type: "button", class: "btn danger", text: t("account.clearLocal"), onclick: function () {
        if (!window.confirm(t("account.clearLocal.confirm"))) return;
        ls("del", STATE_KEY); ls("del", "aia:theme"); ls("del", "aia:lang");
        state = loadState();
        listeners.forEach(function (fn) { fn("*"); });
        renderAccount();
        $("#account-body").appendChild(el("p", { class: "status", text: t("account.cleared") }));
      } })
    ]));
    if (!storageOk) body.appendChild(el("p", { class: "status", text: t("lesson.notes.nostorage") }));
  }
  function openAccount() {
    var d = $("#account-dialog");
    renderAccount();
    d.showModal();
    if (sync.configured && !sync.client && !sync.loadError) loadSupabase().then(renderAccount, renderAccount);
  }
  function initSync() {
    var btn = $("#account-btn");
    if (btn) btn.addEventListener("click", openAccount);
    paintSync();
    if (!sync.configured) return;
    var hasSession = false;
    try { for (var i = 0; i < window.localStorage.length; i++) if (/^sb-.*-auth-token$/.test(window.localStorage.key(i))) hasSession = true; } catch (e) {}
    var returning = /access_token=|code=|type=magiclink|type=recovery/.test(location.hash + location.search);
    if (hasSession || returning) loadSupabase().catch(function () {});
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible" && sync.session) scheduleSync(300); });
  }


  function parseNumber(v) {
    var x = String(v || "").trim().replace(/\s/g, "").replace(",", ".");
    return x === "" || isNaN(Number(x)) ? null : Number(x);
  }
  function initPredictions() {
    $$("[data-predictions]").forEach(function (sec) {
      var key = P.slug;
      var answers = {};
      try { JSON.parse($(".pred-answers", sec).textContent).forEach(function (a) { answers[a.id] = a; }); } catch (e) { return; }
      var items = $$(".pred", sec);
      var lockBtn = $("[data-lock]", sec), checkBtn = $("[data-check]", sec), againBtn = $("[data-again]", sec), summary = $(".pred-summary", sec);
      function stateOf(id) { return get("predq:" + key + ":" + id); }
      function readItem(li) {
        var id = li.getAttribute("data-pred");
        var input = $("[data-pred-input]", li);
        var choice = $("[data-choice][aria-checked='true']", li);
        var conf = $("[data-conf][aria-pressed='true']", li);
        return { id: id, value: input ? input.value.trim() : choice ? choice.getAttribute("data-choice") : "", conf: conf ? Number(conf.getAttribute("data-conf")) : 0 };
      }
      function isRight(id, value) {
        var a = answers[id];
        if (!a) return false;
        if (a.kind === "number") { var n = parseNumber(value); return n !== null && Math.abs(n - a.answer) <= a.tolerance + 1e-9; }
        return value === a.answer;
      }
      function paint() {
        var locked = false, checked = false, right = 0, total = 0;
        items.forEach(function (li) {
          var id = li.getAttribute("data-pred"), st = stateOf(id), input = $("[data-pred-input]", li), res = $(".pred-result", li);
          li.classList.remove("is-right", "is-wrong");
          res.textContent = "";
          if (st) {
            locked = true;
            if (input) input.value = st.value;
            $$("[data-choice]", li).forEach(function (b) { b.setAttribute("aria-checked", b.getAttribute("data-choice") === st.value ? "true" : "false"); });
            $$("[data-conf]", li).forEach(function (b) { b.setAttribute("aria-pressed", Number(b.getAttribute("data-conf")) === st.conf ? "true" : "false"); });
            if (st.checked) {
              checked = true; total++;
              if (st.correct) right++;
              li.classList.add(st.correct ? "is-right" : "is-wrong");
              res.textContent = t(st.correct ? "pred.right" : "pred.wrong", { answer: answers[id] ? answers[id].label : "?" });
            }
          }
          $$("input, button", li).forEach(function (x) { x.disabled = locked; });
        });
        lockBtn.hidden = locked;
        checkBtn.hidden = !locked || checked;
        againBtn.hidden = !checked;
        summary.textContent = checked ? t("pred.summary", { right: right, total: total }) : locked ? t("pred.locked") : "";
      }
      items.forEach(function (li) {
        $$("[data-choice]", li).forEach(function (b) {
          b.addEventListener("click", function () { $$("[data-choice]", li).forEach(function (x) { x.setAttribute("aria-checked", x === b ? "true" : "false"); }); });
        });
        $$("[data-conf]", li).forEach(function (b) {
          b.addEventListener("click", function () { $$("[data-conf]", li).forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); }); });
        });
      });
      lockBtn.addEventListener("click", function () {
        var all = items.map(readItem);
        if (all.some(function (x) { return !x.value || !x.conf; })) { summary.textContent = t("pred.missing"); return; }
        all.forEach(function (x) { set("predq:" + key + ":" + x.id, { value: x.value, conf: x.conf, checked: false }); });
        paint();
      });
      checkBtn.addEventListener("click", function () {
        items.forEach(function (li) {
          var id = li.getAttribute("data-pred"), st = stateOf(id);
          if (st) set("predq:" + key + ":" + id, { value: st.value, conf: st.conf, checked: true, correct: isRight(id, st.value) });
        });
        paint();
      });
      againBtn.addEventListener("click", function () {
        items.forEach(function (li) {
          set("predq:" + key + ":" + li.getAttribute("data-pred"), null);
          var input = $("[data-pred-input]", li);
          if (input) input.value = "";
          $$("[data-choice]", li).forEach(function (x) { x.setAttribute("aria-checked", "false"); });
          $$("[data-conf]", li).forEach(function (x) { x.setAttribute("aria-pressed", "false"); });
        });
        paint();
      });
      onChange(function (k) { if (k === "*" || k.indexOf("predq:" + key) === 0) paint(); });
      paint();
    });
  }
  function calibration() {
    var buckets = { 50: { n: 0, right: 0 }, 70: { n: 0, right: 0 }, 90: { n: 0, right: 0 } };
    var total = 0, right = 0;
    Object.keys(state.items).forEach(function (k) {
      if (k.indexOf("predq:") !== 0) return;
      var v = state.items[k].v;
      if (!v || !v.checked || !buckets[v.conf]) return;
      buckets[v.conf].n++; total++;
      if (v.correct) { buckets[v.conf].right++; right++; }
    });
    return { buckets: buckets, total: total, right: right };
  }
  function paintIntuition() {
    var sec = $("#intuition");
    if (!sec) return;
    var c = calibration(), body = $("#intuition-body");
    body.innerHTML = "";
    if (!c.total) { body.appendChild(el("p", { class: "hint", text: t("home.intuition.empty") })); return; }
    body.appendChild(el("p", { class: "intuition-overall", text: t("home.intuition.overall", { right: c.right, total: c.total }) }));
    var list = el("ol", { class: "calib", "aria-label": t("home.intuition.chart") });
    [50, 70, 90].forEach(function (conf) {
      var b = c.buckets[conf];
      var pct = b.n ? Math.round(100 * b.right / b.n) : 0;
      var fill = el("span", { class: "calib-fill" });
      fill.style.width = (b.n ? pct : 0) + "%";
      var mark = el("span", { class: "calib-mark", title: t("home.intuition.expected") + " " + conf + "%" });
      mark.style.left = conf + "%";
      list.appendChild(el("li", { class: b.n ? "" : "is-empty" }, [
        el("span", { class: "calib-label", text: conf + "%" }),
        el("span", { class: "calib-track" }, [fill, mark]),
        el("span", { class: "calib-value", text: b.n ? pct + "% · " + b.n : "–" }),
        el("span", { class: "sr", text: t("home.intuition.row", { conf: conf, pct: pct, n: b.n }) })
      ]));
    });
    body.appendChild(list);
  }
  window.__aia = { get: get, set: set, onChange: onChange, t: t };

  document.addEventListener("DOMContentLoaded", function () {
    initTheme(); initFontSize(); initLang(); initCopy(); initLesson(); initPredictions(); initCourse(); initHome(); paintIntuition(); onChange(function () { paintIntuition(); }); initToc(); initNav(); initVisuals(); initNative(); initOfflineSettings(); initMermaid(); initOffline(); initSync();
  });
})();
