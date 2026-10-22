(function () {
  var A, P, t;
  var data = null, loading = null, loadFailed = false;
  var GRADES = ["again", "hard", "good", "easy"];
  var SECONDS_PER_REVIEW = 30;

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function dateStr(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function parseDate(s) { var p = String(s).split("-"); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); }
  function today() { return dateStr(new Date()); }
  function addDays(s, n) { var d = parseDate(s); d.setDate(d.getDate() + n); return dateStr(d); }
  function daysBetween(a, b) { return Math.round((parseDate(b) - parseDate(a)) / 86400000); }

  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "text") e.textContent = v;
      else if (k === "html") e.innerHTML = v;
      else if (k === "class") e.className = v;
      else if (k.indexOf("on") === 0) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? "" : v);
    });
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }
  function plural(key, n, vars) {
    var o = { n: n };
    Object.keys(vars || {}).forEach(function (k) { o[k] = vars[k]; });
    return t(key + (n === 1 ? ".one" : ".other"), o);
  }
  function lang() { return P.lang === "es" ? "es" : "en"; }
  function langRoot() { return new URL((P.rel || "./") + (P.lang === "es" ? "es/" : ""), location.href).href; }
  function minutes(n) { return Math.max(1, Math.round(n * SECONDS_PER_REVIEW / 60)); }

  function relDay(s) {
    var n = daysBetween(today(), s);
    if (n < 7 && n >= 0 && window.Intl && Intl.RelativeTimeFormat) return new Intl.RelativeTimeFormat(lang(), { numeric: "auto" }).format(n, "day");
    return new Intl.DateTimeFormat(lang(), { weekday: "short", month: "short", day: "numeric" }).format(parseDate(s));
  }
  function relDays(n) {
    if (n <= 0) return t("reviews.when.now");
    if (window.Intl && Intl.RelativeTimeFormat) return new Intl.RelativeTimeFormat(lang(), { numeric: "auto" }).format(n, "day");
    return t("reviews.iv.days", { n: n });
  }
  function shortIv(n) {
    if (n <= 0) return t("reviews.iv.now");
    if (n < 30) return t("reviews.iv.days", { n: n });
    if (n < 365) return t("reviews.iv.months", { n: Math.round(n / 30) });
    return t("reviews.iv.years", { n: Math.round(n / 36.5) / 10 });
  }

  function schedule(s, grade) {
    var prev = s && !s.off ? s : {};
    var reps = prev.reps || 0, ease = prev.ease || 2.5, iv = prev.interval || 0, lapses = prev.lapses || 0;
    var hard = reps === 0 ? 1 : Math.max(iv + 1, Math.round(iv * 1.2));
    var good = reps === 0 ? 3 : Math.max(hard + 1, Math.round(iv * ease));
    var easy = reps === 0 ? 5 : Math.max(good + 1, Math.round(iv * ease * 1.3));
    var cap = function (x) { return Math.min(x, 365); };
    var round = function (x) { return Math.round(x * 100) / 100; };
    if (grade === "again") return { due: today(), interval: 0, ease: round(Math.max(1.3, ease - 0.2)), reps: 0, lapses: lapses + 1, last: today() };
    var next = { hard: cap(hard), good: cap(good), easy: cap(easy) }[grade];
    var e = grade === "hard" ? Math.max(1.3, ease - 0.15) : grade === "easy" ? ease + 0.15 : ease;
    return { due: addDays(today(), next), interval: next, ease: round(e), reps: reps + 1, lapses: lapses, last: today() };
  }

  function collect() {
    var all = A.items();
    var out = {};
    Object.keys(all).forEach(function (k) {
      var v = all[k].v, ts = all[k].t;
      if (v === null || v === undefined) return;
      var m;
      if ((m = /^quiz:(.+):(\d+)$/.exec(k)) && v === "review") out["q:" + m[1] + ":" + m[2]] = Math.max(out["q:" + m[1] + ":" + m[2]] || 0, ts);
      else if ((m = /^predq:(.+):([^:]+)$/.exec(k)) && v && v.checked && v.correct === false) out["p:" + m[1] + ":" + m[2]] = ts;
    });
    var items = [];
    var seen = {};
    Object.keys(all).forEach(function (k) {
      if (k.indexOf("srs:") !== 0) return;
      var id = k.slice(4), s = all[k].v;
      if (!s) return;
      seen[id] = true;
      if (s.off) { if (out[id] && out[id] > all[k].t) items.push({ id: id, s: null }); return; }
      items.push({ id: id, s: s });
    });
    Object.keys(out).forEach(function (id) { if (!seen[id]) items.push({ id: id, s: null }); });
    return items.filter(function (it) { return !data || content(it.id); });
  }
  function due(it) { return it.s && it.s.due ? it.s.due : today(); }
  function dueItems() {
    var d = today();
    return collect().filter(function (it) { return due(it) <= d; }).sort(function (a, b) { return due(a) < due(b) ? -1 : due(a) > due(b) ? 1 : 0; });
  }
  function nextDue() {
    var d = today(), best = null;
    collect().forEach(function (it) { var x = due(it); if (x > d && (!best || x < best)) best = x; });
    return best;
  }

  function parseId(id) {
    var kind = id.slice(0, 1), rest = id.slice(2), i = rest.lastIndexOf(":");
    return { kind: kind, lesson: rest.slice(0, i), sub: rest.slice(i + 1) };
  }
  function content(id) {
    if (!data) return null;
    var p = parseId(id), l = data[p.lesson];
    if (!l) return null;
    if (p.kind === "q") { var q = l.quiz[Number(p.sub)]; return q ? { lesson: l, key: p.lesson, kind: "quiz", q: q.q, a: q.a } : null; }
    var pr = (l.pred || []).filter(function (x) { return x.id === p.sub; })[0];
    if (!pr) return null;
    var st = A.get("predq:" + p.lesson + ":" + p.sub);
    return { lesson: l, key: p.lesson, kind: "pred", q: pr.q, a: pr.a, yours: st && st.value !== undefined && st.value !== null ? String(pr.o && pr.o[st.value] ? pr.o[st.value] : st.value) : "" };
  }

  function load() {
    if (data) return Promise.resolve(data);
    if (loading) return loading;
    loading = fetch(new URL((P.rel || "./") + "review/" + lang() + ".json", location.href).href)
      .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(function (j) { data = j; loadFailed = false; renderCard(); return j; })
      .catch(function (e) { loading = null; loadFailed = true; throw e; });
    return loading;
  }

  var card = null;
  function renderCard() {
    var slot = document.getElementById("slot-home-rail");
    if (!slot || P.kind !== "home") return;
    if (!card) {
      card = h("section", { class: "reviews-home", id: "reviews", "aria-labelledby": "reviews-h" });
      slot.appendChild(card);
    }
    var items = collect(), d = dueItems().length;
    card.innerHTML = "";
    card.appendChild(h("h2", { id: "reviews-h", text: t("reviews.title") }));
    var body = h("div", { class: "card reviews-card" });
    card.appendChild(body);
    if (!items.length) {
      body.appendChild(h("p", { class: "reviews-count" }, [h("strong", { text: t("reviews.none") })]));
      body.appendChild(h("p", { class: "hint", text: t("reviews.empty") }));
      return;
    }
    var nd = nextDue();
    var meta = d ? t("reviews.time", { min: minutes(d) }) + " · " + plural("reviews.total", items.length) : (nd ? t("reviews.next", { date: relDay(nd) }) + " · " : "") + plural("reviews.total", items.length);
    body.appendChild(h("div", { class: "reviews-row" }, [
      h("p", { class: "reviews-count" }, [
        h("strong", { text: d ? plural("reviews.due", d) : t("reviews.none") }),
        h("span", { class: "muted", text: meta })
      ]),
      d ? h("button", { type: "button", class: "btn primary", onclick: function () { open(); }, text: t("reviews.start") }) : null
    ]));
  }

  var dlg = null, session = null;
  function ensureDialog() {
    if (dlg) return dlg;
    dlg = h("dialog", { class: "sheet reviews-sheet", "aria-labelledby": "rv-title" }, [
      h("div", { class: "sheet-grabber", "aria-hidden": "true" }),
      h("div", { class: "sheet-head" }, [
        h("h2", { id: "rv-title" }, [h("span", { text: t("reviews.title") }), h("span", { class: "rv-progress", "aria-live": "polite" })]),
        h("button", { type: "button", class: "sheet-done", text: t("reviews.close"), onclick: function () { dlg.close(); } })
      ]),
      h("div", { class: "rv-bar", "aria-hidden": "true" }, [h("span")]),
      h("div", { class: "sheet-body rv-body" })
    ]);
    dlg.addEventListener("close", function () {
      session = null;
      if (location.hash === "#reviews") history.replaceState(null, "", location.pathname + location.search);
      renderCard();
      var start = card && card.querySelector(".btn");
      if (start) start.focus();
    });
    dlg.addEventListener("keydown", onKey);
    document.body.appendChild(dlg);
    return dlg;
  }

  function open() {
    load().then(function () {
      var list = dueItems();
      ensureDialog();
      session = { queue: list.map(function (it) { return it.id; }), pos: 0, total: list.length, counts: { again: 0, hard: 0, good: 0, easy: 0 }, reviewed: {}, revealed: false };
      if (!dlg.open) dlg.showModal();
      if (!list.length) finish(); else show();
    }).catch(function () {
      ensureDialog();
      session = null;
      if (!dlg.open) dlg.showModal();
      var body = dlg.querySelector(".rv-body");
      body.innerHTML = "";
      body.appendChild(h("p", { role: "alert", text: t("reviews.loadError") }));
    });
  }

  function paintProgress() {
    var p = dlg.querySelector(".rv-progress"), bar = dlg.querySelector(".rv-bar span");
    if (!session || session.pos >= session.queue.length) { p.textContent = ""; bar.style.width = "100%"; return; }
    p.textContent = t("reviews.progress", { i: session.pos + 1, n: session.queue.length });
    bar.style.width = (session.pos / session.queue.length * 100) + "%";
  }

  function show() {
    var id = session.queue[session.pos], c = content(id);
    session.revealed = false;
    paintProgress();
    var body = dlg.querySelector(".rv-body");
    body.innerHTML = "";
    if (!c) { session.pos++; return session.pos < session.queue.length ? show() : finish(); }
    var href = langRoot() + c.lesson.url + (c.kind === "quiz" ? "#knowledge-check" : "");
    var q = h("div", { class: "rv-q", tabindex: "-1" }, [
      h("p", { class: "rv-meta" }, [h("span", { text: t(c.kind === "quiz" ? "reviews.kind.quiz" : "reviews.kind.pred") }), h("span", { "aria-hidden": "true", text: " · " }), h("span", { text: c.lesson.n + ". " + c.lesson.title })]),
      h("div", { class: "rv-q-text", html: c.q })
    ]);
    var ans = h("div", { class: "rv-a", tabindex: "-1", hidden: true }, [
      h("h3", { text: t("reviews.answer") }),
      h("div", { class: "rv-a-text", html: c.a }),
      c.yours ? h("p", { class: "rv-yours", text: t("reviews.yours", { value: c.yours }) }) : null,
      h("a", { class: "rv-open", href: href, text: t("reviews.open") })
    ]);
    var reveal = h("button", { type: "button", class: "btn primary rv-reveal", onclick: doReveal }, [h("span", { text: t("reviews.reveal") }), h("kbd", { "aria-hidden": "true", text: "␣" })]);
    var s = A.get("srs:" + id);
    var grades = h("div", { class: "rv-grades", role: "group", "aria-labelledby": "rv-gp" }, GRADES.map(function (g, i) {
      var ns = schedule(s, g);
      var ivTxt = shortIv(ns.interval), label = t("reviews.grade." + g);
      return h("button", { type: "button", class: "btn rv-grade rv-" + g, "data-grade": g, "aria-label": t("reviews.gradeLabel", { grade: label, when: relDays(ns.interval) }), "aria-keyshortcuts": String(i + 1), onclick: function () { grade(g); } }, [
        h("span", { class: "rv-g-label", text: label }),
        h("span", { class: "rv-g-iv", text: ivTxt }),
        h("kbd", { "aria-hidden": "true", text: String(i + 1) })
      ]);
    }));
    var gradeBox = h("div", { class: "rv-grade-box", hidden: true }, [h("p", { class: "rv-gp", id: "rv-gp", text: t("reviews.gradePrompt") }), grades]);
    body.appendChild(h("article", { class: "rv-card" }, [q, ans]));
    body.appendChild(h("div", { class: "rv-actions" }, [reveal, gradeBox]));
    q.focus();
  }

  function doReveal() {
    if (!session || session.revealed) return;
    session.revealed = true;
    var body = dlg.querySelector(".rv-body");
    body.querySelector(".rv-a").hidden = false;
    body.querySelector(".rv-reveal").hidden = true;
    body.querySelector(".rv-grade-box").hidden = false;
    body.querySelector(".rv-a").focus();
  }

  function grade(g) {
    if (!session || !session.revealed) return;
    var id = session.queue[session.pos];
    var ns = schedule(A.get("srs:" + id), g);
    A.set("srs:" + id, ns);
    session.counts[g]++;
    session.reviewed[id] = true;
    if (g === "again") session.queue.push(id);
    session.pos++;
    if (session.pos < session.queue.length) show(); else finish();
  }

  function finish() {
    paintProgress();
    var body = dlg.querySelector(".rv-body");
    body.innerHTML = "";
    var n = Object.keys(session.reviewed).length;
    var nd = nextDue();
    var rows = n ? GRADES.map(function (g) {
      return h("li", {}, [h("div", { class: "row" }, [h("span", { class: "txt" }, [h("span", { class: "row-title", text: t("reviews.grade." + g) })]), h("span", { class: "rv-sum-n", text: String(session.counts[g]) })])]);
    }) : [];
    var done = h("button", { type: "button", class: "btn primary", text: t("reviews.done.btn"), onclick: function () { dlg.close(); } });
    var head = h("h3", { class: "rv-done-title", tabindex: "-1", text: t("reviews.done.title") });
    body.appendChild(h("div", { class: "rv-done", role: "status" }, [
      head,
      n ? h("p", { text: plural("reviews.done.body", n) }) : null,
      n ? h("ul", { class: "list rv-sum" }, rows) : null,
      h("p", { class: "muted", text: nd ? t("reviews.done.next", { date: relDay(nd) }) : t("reviews.done.nothing") }),
      done
    ]));
    done.focus();
  }

  function onKey(e) {
    if (!session || e.ctrlKey || e.metaKey || e.altKey) return;
    var tg = e.target, tag = tg && tg.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (e.key === " " || e.key === "Spacebar") {
      if (tag === "BUTTON" || tag === "A") return;
      if (!session.revealed && session.pos < session.queue.length) { e.preventDefault(); doReveal(); }
      return;
    }
    var i = ["1", "2", "3", "4"].indexOf(e.key);
    if (i >= 0 && session.revealed) { e.preventDefault(); grade(GRADES[i]); }
  }

  function inReviews(id) {
    var s = A.get("srs:" + id);
    if (s && !s.off) return true;
    return collect().some(function (it) { return it.id === id; });
  }
  function toggle(id) {
    var s = A.get("srs:" + id);
    if (inReviews(id)) {
      var off = {};
      Object.keys(s || {}).forEach(function (k) { off[k] = s[k]; });
      off.off = true;
      A.set("srs:" + id, off);
    } else {
      A.set("srs:" + id, { due: today(), interval: 0, ease: s && s.ease ? s.ease : 2.5, reps: 0, lapses: s && s.lapses ? s.lapses : 0, last: s && s.last ? s.last : null });
    }
  }
  function initLesson() {
    if (P.kind !== "lesson") return;
    var items = document.querySelectorAll(".quiz-item");
    var buttons = [];
    Array.prototype.forEach.call(items, function (item) {
      var g = item.querySelector(".quiz-grade");
      if (!g) return;
      var id = "q:" + P.slug + ":" + item.getAttribute("data-q");
      var b = h("button", { type: "button", class: "chip rv-add", "aria-pressed": "false", onclick: function () { toggle(id); paint(); } });
      var st = g.querySelector(".quiz-state");
      g.insertBefore(b, st);
      buttons.push({ b: b, id: id });
    });
    function paint() {
      buttons.forEach(function (x) {
        var on = inReviews(x.id);
        x.b.setAttribute("aria-pressed", on ? "true" : "false");
        x.b.textContent = on ? t("reviews.added") : t("reviews.add");
      });
    }
    paint();
    A.onChange(function (k) { if (k === "*" || /^(srs|quiz|predq):/.test(k)) paint(); });
  }

  function onHash() {
    if (location.hash === "#reviews" && P.kind === "home") open();
  }

  function init() {
    A = window.__aia;
    if (!A) return;
    P = A.page || window.__PAGE || {};
    t = A.t;
    A.hooks = A.hooks || {};
    A.hooks.reviewsDue = function () { return dueItems().length; };
    A.hooks.openReviews = open;
    A.hooks.reminder = function (o) {
      var n = dueItems().length;
      if (!n) return null;
      return { title: plural("reviews.remind.title", n, { min: minutes(n) }), body: t("reviews.remind.body"), url: (o && o.root ? o.root : langRoot()) + "index.html#reviews" };
    };
    initLesson();
    if (P.kind === "home") {
      renderCard();
      load().catch(function () {});
      A.onChange(function (k) { if (k === "*" || /^(srs|quiz|predq):/.test(k)) { if (!session) renderCard(); } });
      window.addEventListener("hashchange", onHash);
      onHash();
      var lastDay = today();
      document.addEventListener("visibilitychange", function () { if (!document.hidden && today() !== lastDay) { lastDay = today(); renderCard(); } });
    }
  }

  document.addEventListener("aia:ready", init);
})();
