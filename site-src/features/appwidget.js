(function () {
  var ACTIVITY = /^(done|pred|predq|quiz|code):/;
  var started = false;
  var lessons = null;
  var timer = null;
  var last = "";

  function api() { return window.__aia || null; }

  function langRoot(A) {
    var P = A.page || window.__PAGE || {};
    return new URL((P.rel || "./") + (P.lang === "es" ? "es/" : ""), location.href).href;
  }

  function dayKey(d) {
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return d.getFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
  }

  function fallbackStreak(A) {
    var items = typeof A.items === "function" ? A.items() : {};
    var days = {};
    Object.keys(items).forEach(function (k) {
      var it = items[k];
      if (ACTIVITY.test(k) && it && it.v !== null && it.v !== undefined && it.t) days[dayKey(new Date(it.t))] = true;
    });
    var d = new Date();
    var todayDone = Boolean(days[dayKey(d)]);
    if (!todayDone) d.setDate(d.getDate() - 1);
    var n = 0;
    while (days[dayKey(d)]) { n++; d.setDate(d.getDate() - 1); }
    return { current: n, todayDone: todayDone };
  }

  function streakInfo(A) {
    var hook = A.hooks && A.hooks.streak;
    if (typeof hook === "function") {
      try {
        var s = hook();
        if (s && typeof s.current === "number" && isFinite(s.current)) return { current: Math.max(0, Math.round(s.current)), todayDone: Boolean(s.todayDone) };
      } catch (e) {}
    }
    return fallbackStreak(A);
  }

  function reviewsDue(A) {
    var hook = A.hooks && A.hooks.reviewsDue;
    if (typeof hook !== "function") return 0;
    try {
      var n = Number(hook());
      return isFinite(n) && n > 0 ? Math.round(n) : 0;
    } catch (e) { return 0; }
  }

  function loadLessons(A) {
    if (lessons) return Promise.resolve(lessons);
    return fetch(langRoot(A) + "search.json").then(function (r) { return r.json(); }).then(function (j) {
      lessons = j.filter(function (d) { return d.kind === "lesson"; }).sort(function (a, b) { return a.n - b.n; });
      return lessons;
    });
  }

  function summary(A, list) {
    var root = langRoot(A);
    var s = streakInfo(A);
    var active = new Date();
    if (!s.todayDone) active.setDate(active.getDate() - 1);
    var next = list.find(function (l) { return !A.get("done:" + l.key); });
    return {
      streak: s.current,
      activeDay: s.current > 0 ? dayKey(active) : "",
      nextTitle: next ? A.t("appwidget.next", { n: next.n, title: next.title }) : "",
      nextUrl: new URL(next ? next.url : "index.html#review", root).href,
      reviewsDue: reviewsDue(A),
      updatedAt: Date.now()
    };
  }

  function push(force) {
    var A = api();
    var W = A && A.native && A.native.widget;
    if (!W || typeof W.update !== "function") return Promise.resolve(null);
    return loadLessons(A).then(function (list) {
      var data = summary(A, list);
      var sig = JSON.stringify([data.streak, data.activeDay, data.nextTitle, data.nextUrl, data.reviewsDue]);
      if (!force && sig === last) return null;
      last = sig;
      return W.update(data);
    }).catch(function () { return null; });
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(function () { push(false); }, 1500);
  }

  function start() {
    var A = api();
    if (started || !A || !A.native || !A.native.widget) return;
    started = true;
    push(true);
    if (typeof A.onChange === "function") A.onChange(schedule);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") { clearTimeout(timer); push(true); }
    });
    window.__aia.hooks = window.__aia.hooks || {};
    window.__aia.hooks.widgetRefresh = function () { return push(true); };
  }

  document.addEventListener("aia:native", start);
  document.addEventListener("aia:ready", start);
  if (window.__aia && window.__aia.native) start();
})();
