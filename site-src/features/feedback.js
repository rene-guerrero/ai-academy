(function () {
  var CFG = window.__CONFIG || {};
  var VOTES = "aia:fb:votes";
  var QUEUE = "aia:fb:queue";
  var TOP = 3;
  var MAX_QUEUE = 200;
  var MAX_VOTES = 150;
  var configured = Boolean(CFG.supabaseUrl && CFG.supabaseAnonKey);
  var flushing = false;
  var current = null;
  var foot = null;

  var THUMB = "M7 10v11M15 5.9 14 10h5.8a2 2 0 0 1 1.9 2.6l-2.3 7.9A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.8a2 2 0 0 0 1.8-1.1L12 2a3.1 3.1 0 0 1 3 3.9z";

  function t(key, vars) {
    var A = window.__aia;
    return A && A.t ? A.t(key, vars) : key;
  }
  function read(key, fallback) {
    try { var v = JSON.parse(window.localStorage.getItem(key)); return v == null ? fallback : v; } catch (e) { return fallback; }
  }
  function write(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }
  function norm(q) {
    return String(q || "").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 300);
  }
  function token() {
    var a = new Uint8Array(9);
    (window.crypto || {}).getRandomValues ? window.crypto.getRandomValues(a) : a.forEach(function (_, i) { a[i] = Math.floor(Math.random() * 256); });
    return "q_" + Array.prototype.map.call(a, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
  }
  function svg(down) {
    var ns = "http://www.w3.org/2000/svg";
    var s = document.createElementNS(ns, "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("aria-hidden", "true");
    var p = document.createElementNS(ns, "path");
    p.setAttribute("d", THUMB);
    if (down) p.setAttribute("transform", "matrix(1 0 0 -1 0 24)");
    s.appendChild(p);
    return s;
  }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "text") n.textContent = attrs[k];
      else if (k.indexOf("on") === 0) n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }

  function entryKey(c) { return c.lang + "|" + c.mode + "|" + c.query; }
  function entry(c) {
    var all = read(VOTES, {});
    return all[entryKey(c)] || null;
  }
  function saveEntry(c, e) {
    var all = read(VOTES, {});
    e.t = Date.now();
    all[entryKey(c)] = e;
    var keys = Object.keys(all);
    if (keys.length > MAX_VOTES) keys.sort(function (a, b) { return all[a].t - all[b].t; }).slice(0, keys.length - MAX_VOTES).forEach(function (k) { delete all[k]; });
    write(VOTES, all);
  }

  function enqueue(row) {
    var q = read(QUEUE, []);
    q.push(row);
    if (q.length > MAX_QUEUE) q = q.slice(q.length - MAX_QUEUE);
    write(QUEUE, q);
    flush();
  }

  function flush() {
    if (!configured || flushing) return Promise.resolve();
    var q = read(QUEUE, []);
    if (!q.length || navigator.onLine === false) return Promise.resolve();
    var batch = q.slice(0, 50);
    flushing = true;
    return fetch(CFG.supabaseUrl.replace(/\/$/, "") + "/rest/v1/search_feedback", {
      method: "POST",
      keepalive: true,
      headers: { apikey: CFG.supabaseAnonKey, Authorization: "Bearer " + CFG.supabaseAnonKey, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(batch)
    }).then(function (res) {
      var retry = res.status >= 500 || res.status === 408 || res.status === 429;
      if (!retry) {
        var rest = read(QUEUE, []);
        write(QUEUE, rest.slice(batch.length));
      }
      flushing = false;
      if (!retry && read(QUEUE, []).length) return flush();
    }, function () { flushing = false; });
  }

  function record(c, section, rank, vote) {
    var e = entry(c) || { c: token(), v: {}, m: 0 };
    if (section) {
      if (vote) e.v[section] = vote; else delete e.v[section];
    } else e.m = vote;
    saveEntry(c, e);
    enqueue({ lang: c.lang, mode: c.mode, query: c.query, section: section, rank: rank, vote: vote, client: e.c });
  }

  function paintVote(box, vote) {
    box.querySelectorAll("button").forEach(function (b) {
      var on = Number(b.getAttribute("data-vote")) === vote;
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    var done = box.querySelector(".fb-thanks");
    done.textContent = vote ? t("feedback.thanks") : "";
  }

  function voteBox(c, li, section, rank) {
    var heading = li.querySelector(".row-title");
    var box = el("div", { class: "fb-vote", role: "group", "aria-label": t("feedback.group", { title: heading ? heading.textContent : "" }) }, [
      el("span", { class: "fb-ask", "aria-hidden": "true", text: t("feedback.ask") })
    ]);
    [1, -1].forEach(function (v) {
      var b = el("button", { type: "button", class: "fb-btn", "data-vote": String(v), "aria-pressed": "false", title: t(v > 0 ? "feedback.up" : "feedback.down") }, [svg(v < 0), el("span", { class: "sr", text: t(v > 0 ? "feedback.up" : "feedback.down") })]);
      b.addEventListener("click", function () {
        var e = entry(c);
        var prev = e && e.v[section] ? e.v[section] : 0;
        var next = prev === v ? 0 : v;
        record(c, section, rank, next);
        paintVote(box, next);
      });
      box.appendChild(b);
    });
    box.appendChild(el("span", { class: "fb-thanks", "aria-live": "polite" }));
    var e = entry(c);
    paintVote(box, e && e.v[section] ? e.v[section] : 0);
    return box;
  }

  function qualityUrl() {
    var P = window.__PAGE || {};
    return (P.rel || "./") + (P.lang === "es" ? "es/" : "") + "quality.html#search-quality";
  }

  function paintFoot(c) {
    foot.innerHTML = "";
    var e = entry(c);
    var missed = Boolean(e && e.m === -1);
    var status = el("p", { class: "fb-none-status", role: "status" });
    var btn = el("button", { type: "button", class: "fb-none", "aria-pressed": missed ? "true" : "false", text: missed ? t("feedback.undo") : t("feedback.none") });
    btn.addEventListener("click", function () {
      var now = entry(c);
      var on = Boolean(now && now.m === -1);
      record(c, null, null, on ? 0 : -1);
      paintFoot(c);
      var s = foot.querySelector(".fb-none-status");
      s.textContent = on ? "" : t("feedback.none.done");
      foot.querySelector(".fb-none").focus();
    });
    if (missed) status.textContent = t("feedback.none.done");
    foot.appendChild(el("div", { class: "fb-none-row" }, [btn, status]));
    foot.appendChild(el("p", { class: "fb-note" }, [t("feedback.note") + " ", el("a", { href: qualityUrl(), text: t("feedback.note.link") })]));
  }

  function onResults(ev) {
    var d = ev.detail || {};
    var list = document.getElementById("ask-results");
    if (!list || !configured) return;
    if (!foot) {
      foot = el("div", { class: "fb-foot", id: "fb-foot" });
      list.parentNode.insertBefore(foot, list.nextSibling);
    }
    var query = norm(d.query);
    if (!d.sections || !d.sections.length || query.length < 2) { foot.hidden = true; foot.innerHTML = ""; current = null; return; }
    current = { lang: d.lang || "en", mode: d.mode === "hybrid" ? "hybrid" : "bm25", query: query };
    var c = current;
    Array.prototype.slice.call(list.querySelectorAll("li[data-section]"), 0, TOP).forEach(function (li, i) {
      if (li.querySelector(".fb-vote")) return;
      li.classList.add("fb-item");
      li.appendChild(voteBox(c, li, li.getAttribute("data-section"), i + 1));
    });
    foot.hidden = false;
    paintFoot(c);
  }

  document.addEventListener("aia:ask-results", onResults);
  window.addEventListener("online", function () { flush(); });
  document.addEventListener("aia:ready", function () { flush(); });
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") flush(); });
  window.__aiaFeedback = { flush: flush, queue: function () { return read(QUEUE, []); } };
})();
