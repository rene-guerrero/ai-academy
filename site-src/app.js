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
    if (btn) btn.title = text;
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
        }).catch(function (err) { msg.textContent = t("account.sendFailed", { error: err.message || String(err) }); }).then(function () { submit.disabled = false; submit.textContent = t("account.send"); });
      } }, [el("label", { for: "account-email", text: t("account.email") }), input, submit, msg]);
      body.appendChild(form);
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

  document.addEventListener("DOMContentLoaded", function () {
    initTheme(); initLang(); initCopy(); initLesson(); initCourse(); initHome(); initToc(); initMermaid(); initOffline(); initSync();
  });
})();
