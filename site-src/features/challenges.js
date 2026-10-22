(function () {
  var TIMEOUT = 10000;
  var HARNESS = [
    "import ast, base64, io, sys, traceback",
    "def __aia_text(s):",
    "    return base64.b64decode(s).decode('utf-8')",
    "def __aia_trace(exc, sources):",
    "    lines = ['Traceback (most recent call last):']",
    "    for fr in traceback.extract_tb(exc.__traceback__):",
    "        if fr.filename in sources:",
    "            lines.append('  File \"%s\", line %d, in %s' % (fr.filename, fr.lineno, fr.name))",
    "            src = sources[fr.filename].splitlines()",
    "            if 0 < fr.lineno <= len(src):",
    "                lines.append('    ' + src[fr.lineno - 1].strip())",
    "    if isinstance(exc, SyntaxError):",
    "        lines = ['  File \"%s\", line %s' % (exc.filename, exc.lineno)]",
    "        if exc.text:",
    "            lines.append('    ' + exc.text.rstrip())",
    "    last = traceback.format_exception_only(type(exc), exc)",
    "    lines.append(''.join(last).strip().splitlines()[-1] if last else type(exc).__name__)",
    "    return '\\n'.join(lines)",
    "def __aia_label(node, tests):",
    "    if isinstance(node, ast.Assert):",
    "        if isinstance(node.msg, ast.Constant) and isinstance(node.msg.value, str):",
    "            return node.msg.value",
    "        return ast.get_source_segment(tests, node.test) or ''",
    "    return ast.get_source_segment(tests, node) or ''",
    "def __aia_run(code, tests):",
    "    sources = {'<your code>': code, '<tests>': tests}",
    "    out = {'load': None, 'results': [], 'stdout': ''}",
    "    buf = io.StringIO()",
    "    old = sys.stdout",
    "    sys.stdout = buf",
    "    ns = {'__name__': '__challenge__'}",
    "    try:",
    "        try:",
    "            exec(compile(code, '<your code>', 'exec'), ns)",
    "        except BaseException as exc:",
    "            out['load'] = __aia_trace(exc, sources)",
    "            return out",
    "        broken = False",
    "        for node in ast.parse(tests, '<tests>').body:",
    "            is_assert = isinstance(node, ast.Assert)",
    "            item = {'label': __aia_label(node, tests), 'line': node.lineno}",
    "            if broken:",
    "                if is_assert:",
    "                    item['status'] = 'skip'",
    "                    out['results'].append(item)",
    "                continue",
    "            try:",
    "                exec(compile(ast.Module(body=[node], type_ignores=[]), '<tests>', 'exec'), ns)",
    "                if is_assert:",
    "                    item['status'] = 'pass'",
    "                    out['results'].append(item)",
    "            except BaseException as exc:",
    "                tb = traceback.extract_tb(exc.__traceback__)",
    "                if is_assert and isinstance(exc, AssertionError) and tb and tb[-1].filename == '<tests>':",
    "                    item['status'] = 'fail'",
    "                else:",
    "                    item['status'] = 'error'",
    "                    item['trace'] = __aia_trace(exc, sources)",
    "                    if not is_assert:",
    "                        item['setup'] = True",
    "                        broken = True",
    "                out['results'].append(item)",
    "    finally:",
    "        sys.stdout = old",
    "        out['stdout'] = buf.getvalue()[-4000:]",
    "    return out"
  ].join("\n");

  var client = null;
  var loading = null;
  var busy = false;
  var all = [];

  function b64(s) {
    var bytes = new TextEncoder().encode(s);
    var bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function mb(bytes) { return (bytes / 1048576).toFixed(bytes > 10485760 ? 0 : 1) + " MB"; }
  function make(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function icon(kind) {
    var paths = { pass: "M5 12.5l4.5 4.5L19 7.5", fail: "M7 7l10 10M17 7L7 17", error: "M12 7v6M12 16.5v.5", skip: "M7 12h10" };
    var ns = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", "chal-icon");
    var p = document.createElementNS(ns, "path");
    p.setAttribute("d", paths[kind]);
    svg.appendChild(p);
    return svg;
  }

  function loadClient(A) {
    if (client) return Promise.resolve(client);
    if (!loading) {
      loading = new Promise(function (resolve, reject) {
        if (window.PyClient) return resolve();
        var s = document.createElement("script");
        s.src = (A.page.rel || "./") + "pyclient.js";
        s.onload = function () { resolve(); };
        s.onerror = function () { reject(new Error("pyclient.js")); };
        document.head.appendChild(s);
      }).then(function () {
        client = new window.PyClient();
        client.onEvent(function (m) { all.forEach(function (c) { if (c.running) c.onEvent(m); }); });
        return client;
      });
      loading.catch(function () { loading = null; });
    }
    return loading;
  }

  function setup(A, li) {
    var t = A.t;
    var P = A.page;
    var R = P.runtime;
    var id = li.getAttribute("data-chal");
    var data;
    try { data = JSON.parse(li.querySelector(".chal-data").textContent); } catch (e) { return null; }
    var key = "chal:" + P.slug + ":" + id;
    var title = (li.querySelector("h3") || {}).textContent || id;
    var app = li.querySelector(".chal-app");
    var badge = li.querySelector(".chal-badge");
    var c = { li: li, running: false, passed: false };

    function saved() {
      var v = A.get(key);
      return v && typeof v === "object" ? v : {};
    }
    function save(patch) {
      var cur = saved();
      var next = { code: cur.code === undefined ? data.starter : cur.code, passed: Boolean(cur.passed), attempts: cur.attempts || 0, t: Date.now() };
      Object.keys(patch).forEach(function (k) { next[k] = patch[k]; });
      A.set(key, next);
    }

    var wrap = make("div", "runner chal-runner");
    var edId = "chal-ed-" + id;
    var label = make("label", "sr", t("challenges.editor", { title: title }));
    label.setAttribute("for", edId);
    var editor = make("textarea", "runner-editor chal-editor");
    editor.id = edId;
    editor.spellcheck = false;
    editor.setAttribute("autocapitalize", "off");
    editor.setAttribute("autocomplete", "off");
    editor.setAttribute("autocorrect", "off");
    editor.setAttribute("wrap", "off");
    var keysId = edId + "-keys";
    editor.setAttribute("aria-describedby", keysId);
    var keys = make("p", "sr", t("challenges.keys"));
    keys.id = keysId;
    var bar = make("div", "runner-bar");
    var run = make("button", "btn primary");
    run.type = "button";
    run.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7 4.5v15l12-7.5z"/></svg>';
    run.appendChild(document.createTextNode(t("challenges.run")));
    var reset = make("button", "btn", t("challenges.reset"));
    reset.type = "button";
    var attempts = make("span", "chal-attempts");
    bar.appendChild(run);
    bar.appendChild(reset);
    bar.appendChild(attempts);
    var status = make("p", "runner-status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    var progress = make("div", "runner-progress");
    progress.hidden = true;
    var fill = make("span");
    progress.appendChild(fill);
    var results = make("ul", "chal-results");
    results.hidden = true;
    var trace = make("pre", "chal-trace");
    trace.hidden = true;
    trace.tabIndex = 0;
    var output = make("details", "chal-output");
    output.hidden = true;
    output.appendChild(make("summary", "", t("challenges.output")));
    var outputPre = make("pre");
    output.appendChild(outputPre);
    var hint = make("details", "chal-hint");
    hint.appendChild(make("summary", "", t("challenges.hint")));
    var hintBody = make("p");
    hintBody.innerHTML = data.hint;
    hint.appendChild(hintBody);
    var sol = make("div", "chal-solution");
    var solBtn = make("button", "btn", t("challenges.solution"));
    solBtn.type = "button";
    solBtn.setAttribute("aria-expanded", "false");
    var lock = make("p", "chal-lock", t("challenges.solution.locked"));
    lock.id = edId + "-lock";
    solBtn.setAttribute("aria-describedby", lock.id);
    var solCode = make("div", "code");
    solCode.id = edId + "-solution";
    solCode.hidden = true;
    solBtn.setAttribute("aria-controls", solCode.id);
    var solBar = make("div", "code-bar");
    solBar.appendChild(make("span", "", t("challenges.solution.label")));
    var copy = make("button", "copy", t("code.copy"));
    copy.type = "button";
    copy.setAttribute("aria-label", t("code.copyLabel"));
    solBar.appendChild(copy);
    var solPre = make("pre");
    solPre.tabIndex = 0;
    solPre.appendChild(make("code", "", data.solution));
    solCode.appendChild(solBar);
    solCode.appendChild(solPre);
    sol.appendChild(solBtn);
    sol.appendChild(lock);
    sol.appendChild(solCode);

    [label, keys, editor, bar, status, progress, results, trace, output, hint, sol].forEach(function (n) { wrap.appendChild(n); });
    app.appendChild(wrap);

    function autosize() {
      editor.style.height = "auto";
      editor.style.height = Math.min(editor.scrollHeight + 4, window.innerHeight * 0.7) + "px";
    }
    function setStatus(text, kind) {
      status.textContent = text;
      status.setAttribute("data-kind", kind || "");
    }
    function bar_(ratio) {
      if (ratio === null) { progress.hidden = true; return; }
      progress.hidden = false;
      progress.classList.toggle("is-indeterminate", ratio === undefined);
      fill.style.width = ratio === undefined ? "" : Math.round(ratio * 100) + "%";
    }
    function paint() {
      var s = saved();
      c.passed = Boolean(s.passed);
      badge.hidden = !c.passed;
      li.classList.toggle("is-passed", c.passed);
      attempts.textContent = s.attempts ? t("challenges.attempts", { n: s.attempts }) : "";
      var unlocked = c.passed || (s.attempts || 0) >= 2;
      solBtn.disabled = !unlocked;
      lock.hidden = unlocked;
      if (!unlocked) { solCode.hidden = true; solBtn.setAttribute("aria-expanded", "false"); solBtn.textContent = t("challenges.solution"); }
      summary();
    }
    function clearResults() {
      results.textContent = "";
      results.hidden = true;
      trace.hidden = true;
      output.hidden = true;
      setStatus("");
    }

    var s0 = saved();
    editor.value = typeof s0.code === "string" ? s0.code : data.starter;
    requestAnimationFrame(autosize);

    var saveTimer;
    editor.addEventListener("input", function () {
      autosize();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(function () { save({ code: editor.value }); }, 600);
    });
    var escaped = false;
    editor.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { escaped = true; return; }
      if (e.key === "Tab" && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && !escaped) {
        e.preventDefault();
        var st = editor.selectionStart, en = editor.selectionEnd;
        editor.value = editor.value.slice(0, st) + "    " + editor.value.slice(en);
        editor.selectionStart = editor.selectionEnd = st + 4;
        editor.dispatchEvent(new Event("input"));
      } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        run.click();
      }
      if (e.key !== "Tab") escaped = false;
    });
    editor.addEventListener("blur", function () { escaped = false; });

    reset.addEventListener("click", function () {
      if (editor.value !== data.starter && !window.confirm(t("challenges.resetConfirm"))) return;
      editor.value = data.starter;
      autosize();
      clearTimeout(saveTimer);
      save({ code: data.starter });
      clearResults();
      editor.focus();
    });
    solBtn.addEventListener("click", function () {
      var open = solCode.hidden;
      solCode.hidden = !open;
      solBtn.setAttribute("aria-expanded", open ? "true" : "false");
      solBtn.textContent = open ? t("challenges.solution.hide") : t("challenges.solution");
    });

    c.onEvent = function (m) {
      if (m.type === "phase") {
        if (m.phase === "downloading") { setStatus(R.cached ? t("challenges.starting") : t("challenges.downloading", { size: mb(m.bytes) })); bar_(undefined); }
        if (m.phase === "starting") setStatus(t("challenges.starting"));
        if (m.phase === "packages") setStatus(t("challenges.packages", { name: m.names }));
      } else if (m.type === "progress") {
        bar_(m.total ? m.received / m.total : undefined);
      }
    };

    function render(out) {
      results.textContent = "";
      trace.hidden = true;
      if (out.load) {
        trace.textContent = out.load;
        trace.hidden = false;
        results.hidden = true;
        setStatus(t("challenges.loadError"), "error");
      } else {
        var list = out.results || [];
        var passed = list.filter(function (r) { return r.status === "pass"; }).length;
        var setupFailed = list.some(function (r) { return r.setup; });
        list.forEach(function (r) {
          var row = make("li", "chal-check");
          row.setAttribute("data-status", r.status);
          row.appendChild(icon(r.status));
          var body = make("div", "chal-check-body");
          var head = make("p", "chal-check-label");
          head.appendChild(make("span", "chal-check-state", t("challenges.status." + r.status)));
          head.appendChild(document.createTextNode(" " + (r.label || "")));
          body.appendChild(head);
          if (r.trace) {
            var pre = make("pre", "chal-trace", r.trace);
            pre.tabIndex = 0;
            body.appendChild(pre);
          }
          row.appendChild(body);
          results.appendChild(row);
        });
        results.hidden = !list.length;
        var total = list.filter(function (r) { return !r.setup; }).length;
        if (setupFailed) setStatus(t("challenges.setupError"), "error");
        else if (passed === total && total > 0) setStatus(t("challenges.allPassed", { total: total }), "ok");
        else setStatus(t("challenges.result", { passed: passed, total: total }), "error");
      }
      outputPre.textContent = out.stdout || "";
      output.hidden = !out.stdout;
    }

    function finish() {
      c.running = false;
      busy = false;
      bar_(null);
      all.forEach(function (x) { x.enable(); });
    }
    c.enable = function () { run.disabled = !R || busy; };
    c.enable();

    if (!R) {
      setStatus(t("challenges.unavailable"));
      run.disabled = true;
    } else if (typeof WebAssembly !== "object" || typeof Worker !== "function") {
      setStatus(t("challenges.unsupported"));
      run.disabled = true;
      R = null;
    }

    run.addEventListener("click", function () {
      if (busy || !R) return;
      busy = true;
      c.running = true;
      all.forEach(function (x) { x.enable(); });
      clearTimeout(saveTimer);
      var code = editor.value;
      var tests = data.tests;
      var needsNumpy = /\b(numpy|np)\b/.test(code + "\n" + tests);
      var count = (saved().attempts || 0) + 1;
      save({ code: code, attempts: count });
      clearResults();
      setStatus(t("challenges.starting"));
      loadClient(A).then(function (py) {
        return py.eval(needsNumpy ? "import numpy\n__result__ = None" : "__result__ = None").then(function () {
          setStatus(t("challenges.running"));
          bar_(undefined);
          var timer;
          var timeout = new Promise(function (_, reject) {
            timer = setTimeout(function () { reject(new Error("timeout")); py.stop(); }, TIMEOUT);
          });
          var job = py.eval((needsNumpy ? "import numpy\n" : "") + HARNESS + "\n__result__ = __aia_run(__aia_text('" + b64(code) + "'), __aia_text('" + b64(tests) + "'))");
          return Promise.race([job, timeout]).then(function (r) { clearTimeout(timer); return r; }, function (e) { clearTimeout(timer); throw e; });
        });
      }).then(function (r) {
        try { localStorage.setItem("aia:rt-warm", R.version); } catch (e) {}
        R.cached = true;
        var out = r.value || {};
        render(out);
        var list = out.results || [];
        var ok = !out.load && list.length > 0 && list.every(function (x) { return x.status === "pass"; });
        if (ok && !saved().passed) save({ passed: true });
        finish();
        paint();
      }).catch(function (e) {
        var msg = String(e && e.message ? e.message : e);
        if (msg === "timeout" || msg === "stopped") setStatus(t("challenges.timeout", { s: TIMEOUT / 1000 }), "error");
        else if (msg.indexOf("missing:") === 0) setStatus(t("challenges.missing", { name: msg.slice(8) }), "error");
        else if (/Traceback|Error:/.test(msg)) { trace.textContent = msg; trace.hidden = false; setStatus(t("challenges.loadError"), "error"); }
        else setStatus(t("challenges.failedLoad", { error: msg }), "error");
        finish();
        paint();
      });
    });

    A.onChange(function (k) {
      if (k !== "*" && k !== key) return;
      paint();
      var s = saved();
      if (document.activeElement !== editor && typeof s.code === "string" && s.code !== editor.value && !c.running) { editor.value = s.code; autosize(); }
    });

    try { R && (R.cached = localStorage.getItem("aia:rt-warm") === R.version); } catch (e) {}
    c.paint = paint;
    return c;
  }

  var summaryEl = null;
  function summary() {
    if (!summaryEl || !all.length) return;
    var n = all.filter(function (c) { return c.passed; }).length;
    summaryEl.textContent = n ? window.__aia.t("challenges.summary", { passed: n, total: all.length }) : "";
  }

  function init() {
    var A = window.__aia;
    if (!A || !A.page || A.page.kind !== "lesson") return;
    var section = document.getElementById("practice");
    if (!section) return;
    summaryEl = section.querySelector(".chal-summary");
    Array.prototype.forEach.call(section.querySelectorAll("li[data-chal]"), function (li) {
      var c = setup(A, li);
      if (c) all.push(c);
    });
    all.forEach(function (c) { c.paint(); });
  }

  document.addEventListener("aia:ready", init);
})();
