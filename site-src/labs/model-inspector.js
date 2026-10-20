(function () {
  var A = window.__aia, t = A.t, P = window.__PAGE;
  var root = document.getElementById("lab");
  if (!root || !window.PyClient) return;
  var py = new window.PyClient();
  var setup = document.getElementById("lab-code").value;
  var ready = false, data = null, layer = 0, head = -1, tableOn = false;

  function $(s) { return root.querySelector(s); }
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
  var status = $(".lab-status"), bar = $(".runner-progress"), fill = $(".runner-progress span");
  var form = $("form"), inA = $("#lab-a"), inB = $("#lab-b"), go = $("[data-go]");
  var out = $(".lab-output");

  if (!py.available()) { status.textContent = t("runner.unsupported"); go.disabled = true; return; }
  try { inA.value = A.get("lab:inspector:a") || inA.value; inB.value = A.get("lab:inspector:b") || inB.value; } catch (e) {}

  py.onEvent(function (m) {
    if (m.type === "phase" && m.phase === "downloading") { status.textContent = t("runner.downloading", { size: window.aiaFormatMB(m.bytes) }); bar.hidden = false; bar.classList.add("is-indeterminate"); }
    if (m.type === "phase" && m.phase === "packages") status.textContent = t("runner.packages", { name: m.names });
    if (m.type === "progress") { status.textContent = t("runner.assets", { name: m.label, size: window.aiaFormatMB(m.received) + " / " + window.aiaFormatMB(m.total) }); bar.hidden = false; bar.classList.remove("is-indeterminate"); fill.style.width = Math.round(100 * m.received / m.total) + "%"; }
  });

  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function hexToRgb(h) {
    var c = document.createElement("canvas").getContext("2d");
    c.fillStyle = h; var v = c.fillStyle;
    if (v[0] === "#") return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)];
    var m = v.match(/\d+/g); return m ? m.slice(0, 3).map(Number) : [0, 0, 0];
  }
  function ramp() {
    var lo = hexToRgb(cssVar("--heat-lo")), hi = hexToRgb(cssVar("--heat-hi"));
    return function (v) {
      var x = Math.sqrt(Math.max(0, Math.min(1, v)));
      return "rgb(" + [0, 1, 2].map(function (i) { return Math.round(lo[i] + (hi[i] - lo[i]) * x); }).join(",") + ")";
    };
  }
  function matrix() {
    var L = data.attention[layer];
    if (head >= 0) return L[head];
    var n = L[0].length, m = [];
    for (var i = 0; i < n; i++) { m.push([]); for (var j = 0; j < n; j++) { var s = 0; for (var h = 0; h < L.length; h++) s += L[h][i][j]; m[i].push(s / L.length); } }
    return m;
  }
  function drawHeat(canvas, m, size, labels) {
    var n = m.length, dpr = window.devicePixelRatio || 1;
    var pad = labels ? Math.min(90, 8 + 7 * Math.max.apply(null, data.tokens.map(function (x) { return x.length; }))) : 0;
    var cell = Math.max(2, Math.floor((size - pad) / n));
    var w = pad + cell * n, hgt = pad + cell * n;
    canvas.width = w * dpr; canvas.height = hgt * dpr; canvas.style.width = w + "px"; canvas.style.height = hgt + "px";
    var c = canvas.getContext("2d"); c.scale(dpr, dpr);
    var col = ramp(), gap = cell >= 10 ? 1 : 0;
    c.fillStyle = cssVar("--surface"); c.fillRect(0, 0, w, hgt);
    for (var i = 0; i < n; i++) for (var j = 0; j < n; j++) { c.fillStyle = col(m[i][j]); c.fillRect(pad + j * cell + gap, pad + i * cell + gap, cell - gap, cell - gap); }
    if (labels) {
      c.fillStyle = cssVar("--muted"); c.font = "11px " + getComputedStyle(document.body).fontFamily; c.textBaseline = "middle"; c.textAlign = "right";
      data.tokens.forEach(function (tok, i) { c.fillText(tok, pad - 6, pad + i * cell + cell / 2); });
      c.save(); c.translate(0, 0); c.textAlign = "left";
      data.tokens.forEach(function (tok, j) { c.save(); c.translate(pad + j * cell + cell / 2, pad - 6); c.rotate(-Math.PI / 2); c.fillText(tok, 0, 0); c.restore(); });
      c.restore();
    }
    canvas._geo = { pad: pad, cell: cell, n: n };
  }
  function renderBig() {
    var wrap = $(".heat-big");
    wrap.innerHTML = "";
    var m = matrix();
    var title = (head >= 0 ? t("lab.inspector.head", { h: head + 1 }) : t("lab.inspector.average")) + " · " + t("lab.inspector.layer", { l: layer + 1 });
    wrap.appendChild(el("h3", { text: title }));
    var size = Math.min(wrap.clientWidth || 640, 560);
    var canvas = el("canvas", { role: "img", "aria-label": t("lab.inspector.heatLabel", { title: title }) });
    var tip = el("div", { class: "chart-tip", hidden: "" });
    var box = el("div", { class: "heat-box" }, [canvas, tip]);
    wrap.appendChild(box);
    drawHeat(canvas, m, size, true);
    function hover(ev) {
      var r = canvas.getBoundingClientRect(), g = canvas._geo;
      var x = ev.clientX - r.left - g.pad, y = ev.clientY - r.top - g.pad;
      var j = Math.floor(x / g.cell), i = Math.floor(y / g.cell);
      if (i < 0 || j < 0 || i >= g.n || j >= g.n) { tip.hidden = true; return; }
      tip.hidden = false;
      tip.textContent = t("lab.inspector.tip", { q: data.tokens[i], k: data.tokens[j], w: m[i][j].toFixed(3) });
      tip.style.left = Math.min(r.width - 160, g.pad + (j + 1) * g.cell + 8) + "px";
      tip.style.top = g.pad + i * g.cell + "px";
    }
    canvas.addEventListener("mousemove", hover);
    canvas.addEventListener("click", hover);
    canvas.addEventListener("mouseleave", function () { tip.hidden = true; });
    var legend = el("div", { class: "heat-legend" }, [el("span", { text: "0" }), el("span", { class: "heat-ramp", "aria-hidden": "true" }), el("span", { text: "1" }), el("small", { text: t("lab.inspector.scale") })]);
    wrap.appendChild(legend);
    var toggle = el("button", { type: "button", class: "btn", "aria-pressed": tableOn ? "true" : "false", text: t("lab.inspector.table"), onclick: function () { tableOn = !tableOn; renderBig(); } });
    wrap.appendChild(toggle);
    if (tableOn) {
      var head_ = el("tr", {}, [el("th", { text: "" })].concat(data.tokens.map(function (x) { return el("th", { scope: "col", text: x }); })));
      var rows = m.map(function (row, i) { return el("tr", {}, [el("th", { scope: "row", text: data.tokens[i] })].concat(row.map(function (v) { return el("td", { text: v.toFixed(2) }); }))); });
      wrap.appendChild(el("div", { class: "table-wrap", tabindex: "0" }, [el("table", {}, [el("thead", {}, [head_]), el("tbody", {}, rows)])]));
    }
  }
  function renderHeads() {
    var grid = $(".heads");
    grid.innerHTML = "";
    var avg = el("button", { type: "button", class: "head-cell", "aria-pressed": head === -1 ? "true" : "false", onclick: function () { head = -1; renderHeads(); renderBig(); } }, [el("span", { text: t("lab.inspector.average") })]);
    grid.appendChild(avg);
    data.attention[layer].forEach(function (m, h) {
      var c = el("canvas", { "aria-hidden": "true" });
      var b = el("button", { type: "button", class: "head-cell", "aria-pressed": head === h ? "true" : "false", "aria-label": t("lab.inspector.head", { h: h + 1 }), onclick: function () { head = h; renderHeads(); renderBig(); } }, [c, el("span", { text: String(h + 1) })]);
      grid.appendChild(b);
      drawHeat(c, m, 64, false);
    });
  }
  function renderNorms() {
    var wrap = $(".norms");
    wrap.innerHTML = "";
    var means = data.norms.map(function (row) { return row.reduce(function (s, v) { return s + v; }, 0) / row.length; });
    var W = Math.min(wrap.clientWidth || 600, 640), H = 180, pl = 40, pb = 28, pt = 12, pr = 12;
    var max = Math.max.apply(null, means) * 1.1, min = 0;
    var x = function (i) { return pl + i * (W - pl - pr) / (means.length - 1); };
    var y = function (v) { return pt + (H - pt - pb) * (1 - (v - min) / (max - min)); };
    var ns = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 " + W + " " + H); svg.setAttribute("width", W); svg.setAttribute("height", H);
    svg.setAttribute("role", "img"); svg.setAttribute("aria-label", t("lab.inspector.normsLabel"));
    function add(tag, attrs) { var n = document.createElementNS(ns, tag); Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); }); svg.appendChild(n); return n; }
    [0, 0.5, 1].forEach(function (f) {
      var v = min + f * (max - min);
      add("line", { x1: pl, x2: W - pr, y1: y(v), y2: y(v), class: "grid" });
      var tx = add("text", { x: pl - 6, y: y(v) + 4, "text-anchor": "end", class: "tick" }); tx.textContent = v.toFixed(1);
    });
    means.forEach(function (v, i) { var tx = add("text", { x: x(i), y: H - 8, "text-anchor": "middle", class: "tick" }); tx.textContent = i === 0 ? t("lab.inspector.embed") : String(i); });
    add("path", { d: means.map(function (v, i) { return (i ? "L" : "M") + x(i) + " " + y(v); }).join(" "), class: "line" });
    var tip = el("div", { class: "chart-tip", hidden: "" });
    means.forEach(function (v, i) {
      var dot = add("circle", { cx: x(i), cy: y(v), r: 4, class: "dot" });
      var hit = add("circle", { cx: x(i), cy: y(v), r: 14, class: "hit", tabindex: "0" });
      var show = function () { tip.hidden = false; tip.textContent = (i === 0 ? t("lab.inspector.embed") : t("lab.inspector.layer", { l: i })) + ": " + v.toFixed(2); tip.style.left = Math.min(W - 120, x(i) + 10) + "px"; tip.style.top = (y(v) - 30) + "px"; dot.setAttribute("r", 6); };
      var hide = function () { tip.hidden = true; dot.setAttribute("r", 4); };
      hit.addEventListener("mouseenter", show); hit.addEventListener("focus", show); hit.addEventListener("mouseleave", hide); hit.addEventListener("blur", hide); hit.addEventListener("click", show);
    });
    wrap.appendChild(el("div", { class: "chart-box" }, [svg, tip]));
    var table = el("table", { class: "sr" }, [el("tbody", {}, means.map(function (v, i) { return el("tr", {}, [el("th", { text: i === 0 ? t("lab.inspector.embed") : t("lab.inspector.layer", { l: i }) }), el("td", { text: v.toFixed(3) })]); }))]);
    wrap.appendChild(table);
  }
  function render() {
    out.hidden = false;
    $(".tokens").innerHTML = "";
    data.tokens.forEach(function (tok) { $(".tokens").appendChild(el("span", { class: "token", text: tok })); });
    $(".token-count").textContent = t("lab.inspector.tokens", { n: data.tokens.length });
    var seg = $(".layers");
    seg.innerHTML = "";
    data.attention.forEach(function (_, l) {
      seg.appendChild(el("button", { type: "button", "aria-pressed": l === layer ? "true" : "false", text: String(l + 1), onclick: function () { layer = l; render(); } }));
    });
    renderHeads();
    renderBig();
    renderNorms();
    var sim = $(".similarity");
    if (data.compare) {
      sim.hidden = false;
      sim.querySelector("strong").textContent = data.compare.similarity.toFixed(3);
      sim.querySelector("small").textContent = t("lab.inspector.simNote", { dims: data.dims });
    } else sim.hidden = true;
  }
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var a = inA.value.trim(), b = inB.value.trim();
    if (!a) return;
    A.set("lab:inspector:a", a); A.set("lab:inspector:b", b);
    go.disabled = true;
    status.textContent = t("runner.starting");
    var started = Date.now();
    var first = ready ? Promise.resolve() : py.eval(setup, { persist: true }).then(function () { ready = true; });
    first.then(function () {
      status.textContent = t("lab.inspector.running");
      return py.eval("__result__ = inspect(" + JSON.stringify(a) + ", " + JSON.stringify(b) + ")", { persist: true });
    }).then(function (r) {
      data = r.value;
      if (head >= data.attention[0].length) head = -1;
      if (layer >= data.attention.length) layer = 0;
      bar.hidden = true;
      status.textContent = t("lab.inspector.done", { s: ((Date.now() - started) / 1000).toFixed(1) });
      render();
    }).catch(function (err) {
      bar.hidden = true;
      status.textContent = /^missing:/.test(err.message) ? t("runner.missing", { name: err.message.slice(8) }) : t("runner.failedLoad", { error: err.message });
    }).then(function () { go.disabled = false; });
  });
  var resizeTimer;
  window.addEventListener("resize", function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(function () { if (data) render(); }, 200); });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () { if (data) render(); });
  new MutationObserver(function () { if (data) render(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
})();
