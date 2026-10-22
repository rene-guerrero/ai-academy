(function () {
  var STUDY = /^(done|pred|predq|quiz|code|chal|srs|listen):/;
  var LEVELS = [0, 1, 3, 6, 10];
  var DAY = 86400000;

  document.addEventListener("aia:ready", function () {
    var A = window.__aia;
    if (!A) return;
    var P = A.page || {};
    var lang = P.lang === "es" ? "es" : "en";
    var locale = lang === "es" ? "es-ES" : "en-GB";
    var plural = new Intl.PluralRules(lang);
    var lastCount = {};

    function pad(n) { return (n < 10 ? "0" : "") + n; }
    function dayKey(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
    function fromKey(k) { var p = k.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
    function addDays(d, n) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); return x; }
    function today() { var n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
    function cap(s) { return s.charAt(0).toLocaleUpperCase(locale) + s.slice(1); }
    function mondayIndex(d) { return (d.getDay() + 6) % 7; }
    function pl(base, n, vars) {
      var form = plural.select(n) === "one" ? "one" : "other";
      var v = vars || {};
      v.n = n.toLocaleString(locale);
      return A.t(base + "." + form, v);
    }

    function days() {
      var out = {};
      var items = A.items();
      Object.keys(items).forEach(function (k) {
        if (!/^act:\d{4}-\d{2}-\d{2}$/.test(k)) return;
        var v = Number(items[k].v);
        if (v > 0) out[k.slice(4)] = v;
      });
      return out;
    }

    function compute() {
      var d = days();
      var t0 = today();
      var tk = dayKey(t0);
      var todayDone = Boolean(d[tk]);
      var cur = 0;
      var cursor = todayDone ? t0 : addDays(t0, -1);
      while (d[dayKey(cursor)]) { cur++; cursor = addDays(cursor, -1); }
      var keys = Object.keys(d).sort();
      var best = 0, run = 0, prev = null;
      keys.forEach(function (k) {
        var dt = fromKey(k);
        run = prev && Math.round((dt - prev) / DAY) === 1 ? run + 1 : 1;
        if (run > best) best = run;
        prev = dt;
      });
      return { current: cur, best: Math.max(best, cur), todayDone: todayDone, days: d };
    }
    A.hooks.streak = compute;

    function bump(dk, n) {
      var k = "act:" + dk;
      A.set(k, (Number(A.get(k)) || 0) + n);
    }

    function backfill() {
      if (A.get("act:backfilled")) return;
      var items = A.items();
      var add = {};
      Object.keys(items).forEach(function (k) {
        var it = items[k];
        if (!STUDY.test(k) || !it || !it.v || typeof it.t !== "number") return;
        var dk = dayKey(new Date(it.t));
        add[dk] = (add[dk] || 0) + 1;
      });
      Object.keys(add).forEach(function (dk) { bump(dk, add[dk]); });
      A.set("act:backfilled", true);
    }
    backfill();

    var listeners = [];
    A.onChange(function (key) {
      if (key !== "*" && STUDY.test(key)) {
        var v = A.get(key);
        var items = A.items();
        var it = items[key];
        var now = Date.now();
        var fresh = it && typeof it.t === "number" && now - it.t < 60000;
        var throttled = /^(pred|code):/.test(key) && lastCount[key] && now - lastCount[key] < 600000;
        if (v && fresh && !throttled) {
          var before = compute();
          lastCount[key] = now;
          bump(dayKey(today()), 1);
          listeners.forEach(function (fn) { fn(key, before, compute()); });
          return;
        }
      }
      if (key === "*" || key.indexOf("act:") === 0 || key === "pref:weeklyGoal") paint();
    });

    function goal() {
      var g = Number(A.get("pref:weeklyGoal"));
      return g >= 2 && g <= 7 ? g : 4;
    }

    var fmtWeekday = new Intl.DateTimeFormat(locale, { weekday: "narrow" });
    var fmtWeekdayLong = new Intl.DateTimeFormat(locale, { weekday: "long" });
    var fmtWeekdayShort = new Intl.DateTimeFormat(locale, { weekday: "short" });
    var fmtTip = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short" });
    var fmtLong = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    var fmtMonth = new Intl.DateTimeFormat(locale, { month: "short" });

    function h(tag, attrs, text) {
      var n = document.createElement(tag);
      Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
      if (text !== undefined) n.textContent = text;
      return n;
    }

    var rail = null, heat = null, mq = window.matchMedia ? window.matchMedia("(min-width: 768px)") : null;

    function buildRail(slot) {
      var sec = h("section", { class: "streak", "aria-labelledby": "streak-h" });
      sec.appendChild(h("h2", { id: "streak-h" }, A.t("streak.title")));
      var card = h("div", { class: "card streak-card" });
      sec.appendChild(card);
      slot.appendChild(sec);
      return card;
    }

    function paintRail(card, s) {
      card.textContent = "";
      var top = h("div", { class: "streak-top" });
      var big = h("p", { class: "streak-now" });
      big.appendChild(h("span", { class: "streak-num" }, s.current.toLocaleString(locale)));
      big.appendChild(h("span", { class: "streak-unit" }, pl("streak.unit", s.current)));
      top.appendChild(big);
      top.appendChild(h("p", { class: "streak-best muted" }, A.t("streak.best", { n: s.best.toLocaleString(locale) })));
      card.appendChild(top);
      var msg = s.todayDone ? A.t("streak.today.done") : s.current > 0 ? A.t("streak.today.keep") : A.t("streak.today.start");
      var st = h("p", { class: "streak-state" + (s.todayDone ? " is-done" : "") });
      st.appendChild(h("span", { class: "streak-mark", "aria-hidden": "true" }, s.todayDone ? "✓" : "○"));
      st.appendChild(h("span", {}, msg));
      card.appendChild(st);

      var t0 = today();
      var mon = addDays(t0, -mondayIndex(t0));
      var studied = 0;
      var week = h("ol", { class: "streak-week", "aria-label": A.t("streak.week.label") });
      for (var i = 0; i < 7; i++) {
        var d = addDays(mon, i);
        var on = Boolean(s.days[dayKey(d)]);
        if (on) studied++;
        var isToday = i === mondayIndex(t0);
        var li = h("li", { class: "streak-day" + (on ? " is-on" : "") + (isToday ? " is-today" : "") + (d > t0 ? " is-future" : "") });
        li.appendChild(h("span", { class: "streak-dot", "aria-hidden": "true" }));
        li.appendChild(h("span", { class: "streak-letter", "aria-hidden": "true" }, fmtWeekday.format(d)));
        li.appendChild(h("span", { class: "sr" }, fmtWeekdayLong.format(d) + ": " + (on ? A.t("streak.day.on") : A.t("streak.day.off")) + (isToday ? ", " + A.t("streak.day.today") : "")));
        week.appendChild(li);
      }
      var g = goal();
      var wk = h("div", { class: "streak-weekhead" });
      wk.appendChild(h("span", { class: "streak-weektitle" }, A.t("streak.week")));
      wk.appendChild(h("span", { class: "streak-weekprog" + (studied >= g ? " is-met" : "") }, A.t("streak.week.progress", { done: studied.toLocaleString(locale), goal: g.toLocaleString(locale) }) + (studied >= g ? " ✓" : "")));
      card.appendChild(wk);
      card.appendChild(week);

      var row = h("div", { class: "streak-goal" });
      var lab = h("span", { class: "streak-goal-label", id: "streak-goal-l" }, A.t("streak.goal"));
      row.appendChild(lab);
      var step = h("div", { class: "streak-stepper", role: "group", "aria-labelledby": "streak-goal-l" });
      var minus = h("button", { type: "button", class: "streak-step", "aria-label": A.t("streak.goal.less") }, "−");
      var val = h("output", { class: "streak-goal-val", "aria-live": "polite" }, pl("streak.goal.days", g));
      var plus = h("button", { type: "button", class: "streak-step", "aria-label": A.t("streak.goal.more") }, "+");
      if (g <= 2) minus.disabled = true;
      if (g >= 7) plus.disabled = true;
      minus.addEventListener("click", function () { setGoal(g - 1, "minus"); });
      plus.addEventListener("click", function () { setGoal(g + 1, "plus"); });
      step.appendChild(minus); step.appendChild(val); step.appendChild(plus);
      row.appendChild(step);
      card.appendChild(row);
    }

    var refocus = null;
    function setGoal(n, which) {
      n = Math.max(2, Math.min(7, n));
      refocus = which;
      A.set("pref:weeklyGoal", n);
    }

    function level(n) {
      var l = 0;
      for (var i = 1; i < LEVELS.length; i++) if (n >= LEVELS[i]) l = i;
      return l;
    }

    function buildHeat(slot) {
      var sec = h("section", { class: "streak-heat", "aria-labelledby": "streak-heat-h" });
      sec.appendChild(h("h2", { id: "streak-heat-h" }, A.t("streak.heat.title")));
      var card = h("div", { class: "card streak-heat-card" });
      sec.appendChild(card);
      slot.appendChild(sec);
      return card;
    }

    var focusKey = null;
    function paintHeat(card, s) {
      var weeks = mq && mq.matches ? 52 : 26;
      var t0 = today();
      var start = addDays(t0, -mondayIndex(t0) - (weeks - 1) * 7);
      var hadFocus = card.contains(document.activeElement);
      card.textContent = "";
      var summary = h("p", { class: "streak-heat-sum", id: "streak-heat-sum" });
      card.appendChild(summary);

      var wrap = h("div", { class: "streak-heat-wrap" });
      var grid = h("div", { class: "streak-grid", role: "grid", "aria-label": A.t("streak.heat.label"), "aria-describedby": "streak-heat-sum", style: "--weeks:" + weeks });
      var tip = h("div", { class: "streak-tip", role: "tooltip", id: "streak-tip", hidden: "" });
      var lastMonthCol = -9;
      var monthRow = h("div", { class: "streak-months", "aria-hidden": "true", style: "--weeks:" + weeks });
      for (var w = 0; w < weeks; w++) {
        var first = addDays(start, w * 7);
        for (var j = 0; j < 7; j++) {
          var dd = addDays(first, j);
          if (dd.getDate() === 1 || (w === 0 && j === 0 && dd.getDate() <= 7)) {
            if (w - lastMonthCol >= (weeks > 30 ? 3 : 4) && w <= weeks - 2) {
              var m = h("span", { style: "grid-column:" + (w + 2) }, cap(fmtMonth.format(dd).replace(".", "")));
              monthRow.appendChild(m);
              lastMonthCol = w;
            }
            break;
          }
        }
      }
      wrap.appendChild(monthRow);

      var cells = [];
      var studiedDays = 0, longest = 0, run = 0;
      for (var r = 0; r < 7; r++) {
        var row = h("div", { role: "row", class: "streak-row" });
        var labelDay = addDays(start, r);
        var rh = h("span", { role: "rowheader", class: "streak-wd" + (r % 2 || r === 6 ? " is-hidden" : ""), style: "grid-row:" + (r + 1) });
        rh.appendChild(h("span", { "aria-hidden": "true" }, cap(fmtWeekdayShort.format(labelDay).replace(".", ""))));
        rh.appendChild(h("span", { class: "sr" }, fmtWeekdayLong.format(labelDay)));
        row.appendChild(rh);
        cells[r] = [];
        for (var c = 0; c < weeks; c++) {
          var day = addDays(start, c * 7 + r);
          var future = day > t0;
          var k = dayKey(day);
          var n = s.days[k] || 0;
          var cell = h("span", { role: "gridcell", class: "streak-cell" + (future ? " is-future" : ""), style: "grid-row:" + (r + 1) + ";grid-column:" + (c + 2), "data-day": k });
          if (!future) {
            cell.setAttribute("data-l", String(level(n)));
            cell.setAttribute("tabindex", "-1");
            cell.setAttribute("aria-label", fmtLong.format(day) + ": " + (n ? pl("streak.actions", n) : A.t("streak.actions.none")));
            cell.setAttribute("data-tip", cap(fmtTip.format(day)) + " · " + (n ? pl("streak.actions", n) : A.t("streak.actions.none")));
          } else {
            cell.setAttribute("aria-hidden", "true");
          }
          if (k === dayKey(t0)) cell.classList.add("is-today");
          cells[r][c] = future ? null : cell;
          row.appendChild(cell);
        }
        grid.appendChild(row);
      }
      for (var x = 0; x < weeks * 7; x++) {
        var dx = addDays(start, x);
        if (dx > t0) break;
        if (s.days[dayKey(dx)]) { studiedDays++; run++; if (run > longest) longest = run; } else run = 0;
      }
      wrap.appendChild(grid);
      wrap.appendChild(tip);
      card.appendChild(wrap);

      summary.textContent = studiedDays ? A.t("streak.heat.summary", { days: pl("streak.heat.days", studiedDays), months: weeks === 52 ? 12 : 6, best: pl("streak.count", longest) }) : A.t("streak.heat.empty", { months: weeks === 52 ? 12 : 6 });

      var legend = h("div", { class: "streak-legend" });
      legend.appendChild(h("span", { class: "muted" }, A.t("streak.legend.less")));
      var sw = h("span", { class: "streak-swatches", role: "img", "aria-label": A.t("streak.legend.label") });
      for (var li = 0; li < LEVELS.length; li++) {
        var lo = LEVELS[li], hi = li + 1 < LEVELS.length ? LEVELS[li + 1] - 1 : null;
        var range = li === 0 ? A.t("streak.actions.none") : hi === null ? A.t("streak.legend.plus", { n: lo }) : lo === hi ? String(lo) : A.t("streak.legend.range", { lo: lo, hi: hi });
        sw.appendChild(h("span", { class: "streak-cell", "data-l": String(li), title: range }));
      }
      legend.appendChild(sw);
      legend.appendChild(h("span", { class: "muted" }, A.t("streak.legend.more")));
      card.appendChild(legend);

      var flat = [];
      cells.forEach(function (row, r) { row.forEach(function (cl, c) { if (cl) flat.push({ el: cl, r: r, c: c }); }); });
      var active = null;
      flat.forEach(function (f) { if (f.el.getAttribute("data-day") === focusKey) active = f.el; });
      if (!active) { var tc = grid.querySelector(".is-today"); active = tc || (flat.length ? flat[flat.length - 1].el : null); }
      if (active) active.setAttribute("tabindex", "0");

      function showTip(cell) {
        var text = cell.getAttribute("data-tip");
        if (!text) return;
        tip.textContent = text;
        tip.hidden = false;
        var wr = wrap.getBoundingClientRect(), cr = cell.getBoundingClientRect();
        var tw = tip.offsetWidth;
        var left = cr.left - wr.left + cr.width / 2 - tw / 2;
        left = Math.max(0, Math.min(left, wr.width - tw));
        tip.style.left = left + "px";
        tip.style.top = (cr.top - wr.top - tip.offsetHeight - 6) + "px";
      }
      function hideTip() { tip.hidden = true; }
      function move(cell) {
        if (!cell) return;
        grid.querySelectorAll('[tabindex="0"]').forEach(function (e) { e.setAttribute("tabindex", "-1"); });
        cell.setAttribute("tabindex", "0");
        focusKey = cell.getAttribute("data-day");
        cell.focus();
      }
      grid.addEventListener("mouseover", function (e) { var c = e.target.closest(".streak-cell[data-tip]"); if (c) showTip(c); });
      grid.addEventListener("mouseleave", hideTip);
      grid.addEventListener("focusin", function (e) { var c = e.target.closest(".streak-cell[data-tip]"); if (c) { focusKey = c.getAttribute("data-day"); showTip(c); } });
      grid.addEventListener("focusout", function (e) { if (!grid.contains(e.relatedTarget)) hideTip(); });
      grid.addEventListener("click", function (e) { var c = e.target.closest(".streak-cell[data-tip]"); if (c) move(c); });
      grid.addEventListener("keydown", function (e) {
        var c = e.target.closest(".streak-cell");
        if (!c) return;
        var pos = null;
        for (var r = 0; r < 7 && !pos; r++) for (var q = 0; q < weeks; q++) if (cells[r][q] === c) { pos = { r: r, c: q }; break; }
        if (!pos) return;
        var nr = pos.r, nc = pos.c;
        if (e.key === "ArrowLeft") nc--;
        else if (e.key === "ArrowRight") nc++;
        else if (e.key === "ArrowUp") nr--;
        else if (e.key === "ArrowDown") nr++;
        else if (e.key === "Home") nc = 0;
        else if (e.key === "End") { nc = weeks - 1; while (nc > 0 && !cells[nr][nc]) nc--; }
        else if (e.key === "Escape") { hideTip(); return; }
        else return;
        e.preventDefault();
        if (nr < 0 || nr > 6 || nc < 0 || nc >= weeks) return;
        var target = cells[nr][nc];
        while (!target && nc < weeks && nc >= 0) { nc--; target = nc >= 0 ? cells[nr][nc] : null; }
        move(target);
      });
      if (hadFocus && active) active.focus();
    }

    function paint() {
      var s = compute();
      if (rail) {
        var restore = refocus;
        paintRail(rail, s);
        if (restore) {
          refocus = null;
          var btns = rail.querySelectorAll(".streak-step");
          var b = restore === "minus" ? btns[0] : btns[1];
          if (b && b.disabled) b = restore === "minus" ? btns[1] : btns[0];
          if (b) b.focus();
        }
      }
      if (heat) paintHeat(heat, s);
    }

    if (P.kind === "home") {
      var rs = document.getElementById("slot-home-rail");
      var ms = document.getElementById("slot-home-main");
      if (rs) rail = buildRail(rs);
      if (ms) heat = buildHeat(ms);
      paint();
      if (mq) {
        var onMq = function () { if (heat) paintHeat(heat, compute()); };
        if (mq.addEventListener) mq.addEventListener("change", onMq); else if (mq.addListener) mq.addListener(onMq);
      }
      var lastDay = dayKey(today());
      document.addEventListener("visibilitychange", function () {
        if (document.visibilityState === "visible" && dayKey(today()) !== lastDay) { lastDay = dayKey(today()); paint(); }
      });
    }

    if (P.kind === "lesson" && P.slug) {
      var slot = document.getElementById("slot-lesson");
      if (slot) {
        var live = h("p", { class: "status streak-live", role: "status", "aria-live": "polite" });
        slot.appendChild(live);
        var timer = null;
        listeners.push(function (key, before, after) {
          if (key !== "done:" + P.slug || !A.get(key)) return;
          var items = A.items();
          var t0 = today().getTime();
          var others = Object.keys(items).some(function (k) { return k !== key && k.indexOf("done:") === 0 && items[k].v && items[k].t >= t0; });
          if (others && before.todayDone) return;
          if (after.current < 1) return;
          live.textContent = "";
          live.classList.remove("is-shown");
          setTimeout(function () {
            live.textContent = A.t("streak.toast", { days: pl("streak.count", after.current) });
            live.classList.add("is-shown");
          }, 50);
          clearTimeout(timer);
          timer = setTimeout(function () { live.textContent = ""; live.classList.remove("is-shown"); }, 6000);
        });
      }
    }
  });
})();
