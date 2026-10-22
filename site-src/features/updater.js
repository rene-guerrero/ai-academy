(function () {
  var API = "https://api.github.com/repos/rene-guerrero/ai-academy/releases?per_page=10";
  var TAG = /^android-v1\.0\.(\d+)$/;
  var ASSET = "ai-academy.apk";
  var DAY = 86400000;
  var SNOOZE_DAYS = 3;
  var K_LAST = "updater:lastCheck";
  var K_LATEST = "updater:latest";
  var K_SNOOZE = "updater:snoozeUntil";
  var started = false;
  var plugin = null;
  var installed = null;
  var latest = null;
  var ui = null;
  var banner = null;
  var busy = false;
  var waitingForPermission = false;
  var progressHandle = null;

  function api() { return window.__aia || null; }
  function t(key, vars) { var A = api(); return A && A.t ? A.t(key, vars) : key; }

  function store(op, key, value) {
    try {
      if (op === "get") return window.localStorage.getItem(key);
      if (op === "set") window.localStorage.setItem(key, value);
      if (op === "del") window.localStorage.removeItem(key);
    } catch (e) {}
    return null;
  }

  function readLatest() {
    try {
      var v = JSON.parse(store("get", K_LATEST) || "null");
      return v && typeof v.code === "number" && typeof v.url === "string" ? v : null;
    } catch (e) { return null; }
  }

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "text") n.textContent = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  function lang() { var A = api(); var P = (A && A.page) || window.__PAGE || {}; return P.lang === "es" ? "es" : "en"; }

  function formatDate(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    try { return new Intl.DateTimeFormat(lang(), { dateStyle: "medium" }).format(d); } catch (e) { return d.toDateString(); }
  }

  function versionLabel(code) { return "1.0." + code; }

  function installedLabel() {
    if (!installed) return "";
    return installed.versionName ? installed.versionName : versionLabel(installed.versionCode);
  }

  function pickRelease(list) {
    var best = null;
    (Array.isArray(list) ? list : []).forEach(function (r) {
      if (!r || r.draft) return;
      var m = TAG.exec(String(r.tag_name || ""));
      if (!m) return;
      var asset = (r.assets || []).find(function (a) { return a && a.name === ASSET && a.browser_download_url; });
      if (!asset) return;
      var code = parseInt(m[1], 10);
      if (!best || code > best.code) best = { code: code, url: String(asset.browser_download_url), date: r.published_at || r.created_at || "", tag: r.tag_name };
    });
    return best;
  }

  function fetchLatest() {
    if (navigator.onLine === false) return Promise.reject({ kind: "offline" });
    return fetch(API, { headers: { Accept: "application/vnd.github+json" }, cache: "no-store" }).then(function (r) {
      if (!r.ok) throw { kind: "api" };
      return r.json();
    }, function () {
      throw { kind: navigator.onLine === false ? "offline" : "api" };
    }).then(function (list) {
      var best = pickRelease(list);
      store("set", K_LAST, String(Date.now()));
      if (best) store("set", K_LATEST, JSON.stringify(best));
      return best;
    }).catch(function (e) {
      if (e && e.kind) throw e;
      throw { kind: "api" };
    });
  }

  function isNewer(rel) { return Boolean(rel && installed && rel.code > installed.versionCode); }

  function focusSafe(node) { if (node && typeof node.focus === "function") { try { node.focus({ preventScroll: false }); } catch (e) { node.focus(); } } }

  function buildGroup() {
    var body = document.querySelector("#account-dialog .sheet-body");
    if (!body) return null;
    var existing = document.getElementById("app-update");
    if (existing) existing.remove();
    var version = el("p", { class: "upd-version", text: t("updater.version", { version: installedLabel() }) });
    var status = el("p", { class: "upd-status", id: "upd-status", "aria-live": "polite", tabindex: "-1" });
    var date = el("p", { class: "upd-date", hidden: "" });
    var check = el("button", { type: "button", class: "btn upd-check", text: t("updater.check") });
    var update = el("button", { type: "button", class: "btn primary upd-update", hidden: "", text: t("updater.update") });
    var allow = el("button", { type: "button", class: "btn primary upd-allow", hidden: "", text: t("updater.allow") });
    var fill = el("span");
    var bar = el("div", { class: "upd-bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-label": t("updater.progress") }, [fill]);
    var pct = el("span", { class: "upd-pct", "aria-hidden": "true" });
    var progress = el("div", { class: "upd-progress", hidden: "" }, [bar, pct]);
    var card = el("div", { class: "upd-card" }, [
      el("div", { class: "upd-head" }, [el("div", { class: "upd-text" }, [version, status, date]), el("div", { class: "upd-actions" }, [check, update, allow])]),
      progress
    ]);
    var group = el("section", { class: "group upd", id: "app-update", "aria-labelledby": "upd-h" }, [
      el("h3", { id: "upd-h", text: t("updater.title") }),
      card,
      el("p", { class: "hint", text: t("updater.hint") })
    ]);
    body.appendChild(group);
    check.addEventListener("click", function () { runCheck(true); });
    update.addEventListener("click", startUpdate);
    allow.addEventListener("click", function () {
      waitingForPermission = true;
      plugin.openInstallSettings().catch(function (e) { waitingForPermission = false; setStatus(errorText(e)); });
    });
    return { group: group, version: version, status: status, date: date, check: check, update: update, allow: allow, progress: progress, bar: bar, fill: fill, pct: pct };
  }

  function setStatus(text) { if (ui) ui.status.textContent = text || ""; }

  function showButtons(which) {
    if (!ui) return;
    var active = document.activeElement;
    var lost = false;
    ["check", "update", "allow"].forEach(function (name) {
      var b = ui[name];
      var on = which.indexOf(name) >= 0;
      if (!on && active === b) lost = true;
      b.hidden = !on;
    });
    if (lost) {
      var target = which.length ? ui[which[0]] : ui.status;
      focusSafe(target);
    }
  }

  function showRelease(rel) {
    if (!ui) return;
    if (rel && rel.date) {
      ui.date.textContent = t("updater.released", { date: formatDate(rel.date) });
      ui.date.hidden = false;
    } else {
      ui.date.hidden = true;
      ui.date.textContent = "";
    }
  }

  function presentAvailable(rel) {
    if (!ui) return;
    setStatus(t("updater.available", { version: versionLabel(rel.code) }));
    showRelease(rel);
    showButtons(["update"]);
  }

  function presentLatest() {
    setStatus(t("updater.latest"));
    showRelease(null);
    showButtons(["check"]);
  }

  function errorText(e) {
    var kind = e && e.kind;
    if (kind === "offline") return t("updater.offline");
    if (kind === "api") return t("updater.apiError");
    var code = e && e.code;
    var reason = code === "DOWNLOAD_FAILED" ? t("updater.err.download")
      : code === "INVALID_APK" || code === "WRONG_PACKAGE" ? t("updater.err.invalid")
      : code === "NOT_NEWER" ? t("updater.err.notNewer")
      : code === "NO_INSTALLER" || code === "PROVIDER" ? t("updater.err.installer")
      : t("updater.err.generic");
    return t("updater.installError", { message: reason });
  }

  function runCheck(manual) {
    if (busy) return Promise.resolve();
    busy = true;
    if (ui && manual) {
      ui.check.disabled = true;
      setStatus(t("updater.checking"));
    }
    return fetchLatest().then(function (rel) {
      latest = rel;
      if (isNewer(rel)) {
        presentAvailable(rel);
        if (!manual) showBanner();
      } else {
        presentLatest();
        hideBanner();
      }
    }, function (e) {
      if (manual) {
        setStatus(errorText(e));
        showRelease(null);
        showButtons(["check"]);
      }
    }).then(function () {
      busy = false;
      if (ui) ui.check.disabled = false;
    });
  }

  function setProgress(received, total) {
    if (!ui) return;
    ui.progress.hidden = false;
    if (total > 0) {
      var p = Math.max(0, Math.min(100, Math.floor(100 * received / total)));
      ui.bar.classList.remove("is-indeterminate");
      ui.fill.style.width = p + "%";
      ui.bar.setAttribute("aria-valuenow", String(p));
      ui.bar.removeAttribute("aria-valuetext");
      ui.pct.textContent = p + "%";
    } else {
      var mb = (received / 1048576).toFixed(1);
      ui.bar.classList.add("is-indeterminate");
      ui.bar.removeAttribute("aria-valuenow");
      ui.bar.setAttribute("aria-valuetext", t("updater.received", { mb: mb }));
      ui.pct.textContent = t("updater.received", { mb: mb });
    }
  }

  function stopProgress() {
    if (progressHandle && typeof progressHandle.remove === "function") { try { progressHandle.remove(); } catch (e) {} }
    progressHandle = null;
  }

  function startUpdate() {
    if (busy || !latest || !isNewer(latest)) return;
    busy = true;
    plugin.canInstall().then(function (r) {
      if (!r || !r.allowed) {
        busy = false;
        setStatus(t("updater.allowHint"));
        showButtons(["allow"]);
        return null;
      }
      return download();
    }).catch(function (e) {
      busy = false;
      setStatus(errorText(e));
      showButtons(["update"]);
    });
  }

  function download() {
    waitingForPermission = false;
    setStatus(t("updater.downloading"));
    showButtons([]);
    setProgress(0, 1);
    var listening = Promise.resolve(plugin.addListener("progress", function (d) {
      setProgress(Number(d && d.received) || 0, Number(d && d.total) || 0);
    })).then(function (h) { progressHandle = h; }, function () {});
    return listening.then(function () { return plugin.install({ url: latest.url }); }).then(function () {
      stopProgress();
      busy = false;
      ui.progress.hidden = true;
      setStatus(t("updater.installer"));
      showButtons(["update"]);
      hideBanner();
    }, function (e) {
      stopProgress();
      busy = false;
      ui.progress.hidden = true;
      setStatus(errorText(e));
      showButtons(["update"]);
    });
  }

  function onVisible() {
    if (document.visibilityState !== "visible" || !waitingForPermission || !plugin) return;
    plugin.canInstall().then(function (r) {
      if (r && r.allowed && !busy && latest && isNewer(latest)) {
        busy = true;
        download();
      }
    }).catch(function () {});
  }

  function snoozed() {
    var until = parseInt(store("get", K_SNOOZE) || "0", 10);
    return until > Date.now();
  }

  function hideBanner() {
    if (banner) { banner.remove(); banner = null; }
  }

  function openGroup() {
    var A = api();
    if (A && typeof A.openSettings === "function") A.openSettings();
    setTimeout(function () {
      if (!ui) return;
      ui.group.scrollIntoView({ block: "start" });
      var target = !ui.update.hidden ? ui.update : !ui.allow.hidden ? ui.allow : !ui.check.hidden ? ui.check : ui.status;
      focusSafe(target);
    }, 60);
  }

  function showBanner() {
    if (banner || snoozed() || !latest || !isNewer(latest)) return;
    var top = document.querySelector("header.topbar");
    if (!top || !top.parentNode) return;
    var go = el("button", { type: "button", class: "btn primary upd-banner-go", text: t("updater.update") });
    var later = el("button", { type: "button", class: "btn upd-banner-later", text: t("updater.later") });
    banner = el("div", { class: "upd-banner", role: "region", "aria-label": t("updater.bannerLabel") }, [
      el("span", { class: "upd-banner-icon", "aria-hidden": "true" }),
      el("p", { class: "upd-banner-text" }, [
        el("strong", { text: t("updater.banner") }),
        el("span", { class: "upd-banner-ver", text: t("updater.bannerVersion", { version: versionLabel(latest.code) }) })
      ]),
      el("div", { class: "upd-banner-actions" }, [later, go])
    ]);
    go.addEventListener("click", function () { hideBanner(); openGroup(); });
    later.addEventListener("click", function () {
      store("set", K_SNOOZE, String(Date.now() + SNOOZE_DAYS * DAY));
      var next = document.getElementById("content") || document.querySelector("main");
      hideBanner();
      if (next) { if (!next.hasAttribute("tabindex")) next.setAttribute("tabindex", "-1"); focusSafe(next); }
    });
    top.parentNode.insertBefore(banner, top.nextSibling);
  }

  function start() {
    var A = api();
    if (started || !A || !A.native || !A.native.updater) return;
    started = true;
    plugin = A.native.updater;
    plugin.info().then(function (info) {
      installed = { versionCode: Number(info && info.versionCode) || 0, versionName: info && info.versionName ? String(info.versionName) : "" };
      ui = buildGroup();
      var cached = readLatest();
      if (cached && isNewer(cached)) {
        latest = cached;
        presentAvailable(cached);
      }
      document.addEventListener("visibilitychange", onVisible);
      var last = parseInt(store("get", K_LAST) || "0", 10);
      if (!last || Date.now() - last >= DAY || last > Date.now()) runCheck(false);
      else if (latest) showBanner();
    }).catch(function () { started = false; });
  }

  document.addEventListener("aia:ready", start);
  document.addEventListener("aia:native", function () { setTimeout(start, 0); });
  if (window.__aia && window.__aia.native) start();
})();
