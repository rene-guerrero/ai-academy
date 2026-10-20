(function () {
  var A = window.__aia;
  var P = window.__PAGE || {};
  var R = P.runtime;
  if (!A || !R) return;
  var t = A.t;
  var TIMEOUT = 60000;

  function mb(bytes) {
    return (bytes / 1048576).toFixed(bytes > 10485760 ? 0 : 1) + " MB";
  }
  function q(sel, el) { return (el || document).querySelector(sel); }

  var root = q("[data-runner]");
  if (!root) return;
  var key = root.getAttribute("data-key");
  var original = q("textarea.runner-original", root).value;
  var editor = q("textarea.runner-editor", root);
  var view = q(".runner-view", root);
  var runBtn = q("[data-run]", root);
  var stopBtn = q("[data-stop]", root);
  var editBtn = q("[data-edit]", root);
  var resetBtn = q("[data-reset]", root);
  var status = q(".runner-status", root);
  var bar = q(".runner-progress", root);
  var fill = q(".runner-progress span", root);
  var outWrap = q(".runner-out", root);
  var out = q(".runner-out pre", root);
  var nudge = q(".runner-nudge", root);
  var badge = q(".runner-edited", root);
  var shareBtn = q("[data-share]", root);
  var sharedBox = q(".runner-shared", root);
  var sharedCode = null;

  root.hidden = false;
  root.classList.add("is-ready");
  if (typeof WebAssembly !== "object" || typeof Worker !== "function") {
    runBtn.disabled = true;
    editBtn.disabled = true;
    status.textContent = t("runner.unsupported");
    return;
  }

  var worker = null, timer = null, running = false, stickBottom = true;

  function savedCode() {
    var v = A.get("code:" + key);
    return typeof v === "string" && v !== original ? v : null;
  }
  function setEditing(on, focus) {
    editBtn.setAttribute("aria-pressed", on ? "true" : "false");
    editBtn.textContent = on ? t("runner.view") : t("runner.edit");
    editor.hidden = !on;
    view.hidden = on;
    if (on) {
      editor.value = savedCode() || original;
      autosize();
      if (focus !== false) editor.focus();
    }
  }
  function paintEdited() {
    var edited = Boolean(savedCode());
    badge.hidden = !edited;
    resetBtn.hidden = !edited;
    shareBtn.hidden = !(edited || sharedCode !== null || (!editor.hidden && editor.value !== original));
  }
  function b64url(bytes) {
    var bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function fromB64url(s) {
    var bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function pipe(bytes, stream) {
    return new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  function encodeCode(code) {
    var bytes = new TextEncoder().encode(code);
    if (typeof CompressionStream === "function") return pipe(bytes, new CompressionStream("deflate-raw")).then(function (z) { return "z" + b64url(z); });
    return Promise.resolve("p" + b64url(bytes));
  }
  function decodeCode(s) {
    var kind = s[0], bytes = fromB64url(s.slice(1));
    if (kind === "z") return pipe(bytes, new DecompressionStream("deflate-raw")).then(function (b) { return new TextDecoder().decode(b); });
    return Promise.resolve(new TextDecoder().decode(bytes));
  }
  function autosize() {
    editor.style.height = "auto";
    editor.style.height = Math.min(editor.scrollHeight + 4, window.innerHeight * 0.7) + "px";
  }
  function currentCode() {
    if (!editor.hidden) return editor.value;
    return savedCode() || original;
  }
  function setStatus(text, kind) {
    status.textContent = text;
    status.setAttribute("data-kind", kind || "");
  }
  function progress(ratio) {
    if (ratio === null) { bar.hidden = true; return; }
    bar.hidden = false;
    bar.classList.toggle("is-indeterminate", ratio === undefined);
    fill.style.width = ratio === undefined ? "" : Math.round(ratio * 100) + "%";
  }
  function append(text, cls) {
    var nearBottom = out.scrollHeight - out.scrollTop - out.clientHeight < 24;
    var span = document.createElement("span");
    if (cls) span.className = cls;
    span.textContent = text + "\n";
    out.appendChild(span);
    if (nearBottom || stickBottom) out.scrollTop = out.scrollHeight;
  }
  function finish() {
    running = false;
    clearTimeout(timer);
    runBtn.hidden = false;
    stopBtn.hidden = true;
    editBtn.disabled = false;
    progress(null);
  }
  function killWorker() {
    if (worker) worker.terminate();
    worker = null;
  }
  function makeWorker() {
    var w = new Worker(R.base + "py-worker.mjs", { type: "module" });
    w.onmessage = function (e) {
      var m = e.data;
      if (m.type === "phase") {
        if (m.phase === "downloading") { setStatus(R.cached ? t("runner.starting") : t("runner.downloading", { size: mb(m.bytes) })); progress(undefined); }
        if (m.phase === "starting") setStatus(t("runner.starting"));
        if (m.phase === "packages") setStatus(t("runner.packages", { name: m.names }));
        if (m.phase === "running") { setStatus(t("runner.running")); progress(undefined); }
      } else if (m.type === "progress") {
        setStatus(t("runner.assets", { name: m.label, size: mb(m.received) + " / " + mb(m.total) }));
        progress(m.total ? m.received / m.total : undefined);
      } else if (m.type === "stdout") {
        append(m.text);
      } else if (m.type === "stderr") {
        append(m.text, "err");
      } else if (m.type === "done") {
        try { localStorage.setItem("aia:rt-warm", R.version); } catch (err) {}
        R.cached = true;
        setStatus(t("runner.done", { s: (m.ms / 1000).toFixed(m.ms < 10000 ? 2 : 1) }), "ok");
        finish();
      } else if (m.type === "error") {
        append(m.text, "err");
        setStatus(t("runner.error"), "error");
        finish();
      } else if (m.type === "missing") {
        setStatus(t("runner.missing", { name: m.name }), "error");
        finish();
      } else if (m.type === "fatal") {
        setStatus(t("runner.failedLoad", { error: m.text }), "error");
        killWorker();
        finish();
      }
    };
    w.onerror = function (e) {
      setStatus(t("runner.failedLoad", { error: e.message || "worker error" }), "error");
      killWorker();
      finish();
    };
    return w;
  }

  try { R.cached = localStorage.getItem("aia:rt-warm") === R.version; } catch (err) { R.cached = false; }
  var hint = q(".runner-hint", root.parentNode);
  if (hint && R.cached) hint.hidden = true;

  runBtn.addEventListener("click", function () {
    if (running) return;
    var code = currentCode();
    if (!editor.hidden) {
      if (editor.value !== original) A.set("code:" + key, editor.value);
      else if (savedCode()) A.set("code:" + key, null);
      paintEdited();
    }
    var notes = A.get("pred:" + key);
    nudge.hidden = Boolean(typeof notes === "string" && notes.trim());
    out.textContent = "";
    outWrap.hidden = false;
    stickBottom = true;
    running = true;
    runBtn.hidden = true;
    stopBtn.hidden = false;
    editBtn.disabled = true;
    setStatus(t("runner.starting"));
    if (!worker) worker = makeWorker();
    timer = setTimeout(function () {
      killWorker();
      append(t("runner.timeout", { s: TIMEOUT / 1000 }), "err");
      setStatus(t("runner.timeout", { s: TIMEOUT / 1000 }), "error");
      finish();
    }, TIMEOUT);
    worker.postMessage({ type: "run", code: code });
    stopBtn.focus();
  });
  stopBtn.addEventListener("click", function () {
    killWorker();
    append(t("runner.stopped"), "err");
    setStatus(t("runner.stopped"), "error");
    finish();
    runBtn.focus();
  });
  editBtn.addEventListener("click", function () {
    var on = editBtn.getAttribute("aria-pressed") !== "true";
    if (!on) {
      if (editor.value !== original) A.set("code:" + key, editor.value);
      else if (savedCode()) A.set("code:" + key, null);
      paintEdited();
    }
    setEditing(on);
  });
  resetBtn.addEventListener("click", function () {
    A.set("code:" + key, null);
    editor.value = original;
    autosize();
    paintEdited();
    if (editor.hidden) setEditing(false);
  });
  var saveTimer;
  editor.addEventListener("input", function () {
    autosize();
    if (sharedCode !== null) { paintEdited(); return; }
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      if (editor.value !== original) A.set("code:" + key, editor.value);
      else if (savedCode()) A.set("code:" + key, null);
      paintEdited();
    }, 600);
  });
  editor.addEventListener("keydown", function (e) {
    if (e.key === "Tab" && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      var s = editor.selectionStart, end = editor.selectionEnd;
      editor.value = editor.value.slice(0, s) + "    " + editor.value.slice(end);
      editor.selectionStart = editor.selectionEnd = s + 4;
      editor.dispatchEvent(new Event("input"));
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      runBtn.click();
    }
  });
  out.addEventListener("scroll", function () {
    stickBottom = out.scrollHeight - out.scrollTop - out.clientHeight < 24;
  });
  A.onChange(function (k) {
    if (k === "*" || k === "code:" + key) {
      paintEdited();
      if (!editor.hidden && document.activeElement !== editor) editor.value = savedCode() || original;
    }
  });
  shareBtn.addEventListener("click", function () {
    var code = !editor.hidden ? editor.value : (sharedCode !== null ? sharedCode : savedCode() || original);
    encodeCode(code).then(function (enc) {
      var url = location.origin + location.pathname + "#x=" + enc;
      var label = shareBtn.textContent;
      function done(msg) { shareBtn.textContent = msg; setTimeout(function () { shareBtn.textContent = label; }, 1800); }
      if (navigator.share && window.matchMedia("(pointer: coarse)").matches) {
        navigator.share({ title: document.title, url: url }).catch(function () {});
      } else if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(url).then(function () { done(t("runner.linkCopied")); }, function () { prompt(t("runner.share"), url); });
      } else prompt(t("runner.share"), url);
    });
  });
  var m = location.hash.match(/^#x=([A-Za-z0-9_-]+)/);
  if (m) {
    decodeCode(m[1]).then(function (code) {
      sharedCode = code;
      sharedBox.hidden = false;
      setEditing(true, false);
      editor.value = code;
      autosize();
      paintEdited();
      root.scrollIntoView({ block: "start" });
    }).catch(function () {});
    q("[data-keep]", root).addEventListener("click", function () {
      A.set("code:" + key, editor.value);
      sharedCode = null; sharedBox.hidden = true;
      history.replaceState(null, "", location.pathname);
      paintEdited();
    });
    q("[data-discard]", root).addEventListener("click", function () {
      sharedCode = null; sharedBox.hidden = true;
      history.replaceState(null, "", location.pathname);
      editor.value = savedCode() || original;
      if (!savedCode()) setEditing(false);
      paintEdited();
    });
  }
  paintEdited();
  if (savedCode() && !m) setEditing(true, false);
})();
