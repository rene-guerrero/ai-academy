(function () {
  var A = window.__aia, t = A.t;
  var root = document.getElementById("lab");
  if (!root || !window.PyClient) return;
  var py = new window.PyClient();
  var setup = document.getElementById("lab-code").value;
  var LR = [0.05, 0.1, 0.2, 0.5, 1, 2, 3, 5, 10];
  var TEMP = [0.1, 0.2, 0.3, 0.5, 0.7, 0.85, 1, 1.25, 1.5, 2, 3, 4, 5];
  var ready = false, data = null, busy = false, pendingDist = false;
  function $(s) { return root.querySelector(s); }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { if (k === "text") n.textContent = attrs[k]; else n.setAttribute(k, attrs[k]); });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  var status = $(".lab-status"), bar = $(".runner-progress"), fill = $(".runner-progress span"), go = $("[data-go]");
  var corpus = $("#tl-corpus"), lr = $("#tl-lr"), steps = $("#tl-steps"), seed = $("#tl-seed");
  var ck = $("#tl-ck"), word = $("#tl-word"), temp = $("#tl-temp"), topp = $("#tl-topp");
  function lrv() { return LR[+lr.value]; }
  function tv() { return TEMP[+temp.value]; }
  function pv() { return (+topp.value) / 20; }
  function paintOutputs() {
    $("#tl-lr-out").textContent = String(lrv());
    $("#tl-steps-out").textContent = steps.value;
    $("#tl-temp-out").textContent = String(tv());
    $("#tl-topp-out").textContent = pv().toFixed(2);
    if (data) $("#tl-ck-out").textContent = t("lab.train.stepN", { n: data.checkpoints[+ck.value] });
  }
  [lr, steps, temp, topp].forEach(function (x) { x.addEventListener("input", paintOutputs); });
  paintOutputs();
  if (!py.available()) { status.textContent = t("runner.unsupported"); go.disabled = true; return; }
  try { var saved = A.get("lab:train:corpus"); if (saved) corpus.value = saved; } catch (e) {}
  py.onEvent(function (m) {
    if (m.type === "phase" && m.phase === "downloading") { status.textContent = t("runner.downloading", { size: window.aiaFormatMB(m.bytes) }); bar.hidden = false; bar.classList.add("is-indeterminate"); }
    if (m.type === "phase" && m.phase === "packages") status.textContent = t("runner.packages", { name: m.names });
  });
  var NS = "http://www.w3.org/2000/svg";
  function svgEl(svg, tag, attrs) { var n = document.createElementNS(NS, tag); Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); }); svg.appendChild(n); return n; }
  function drawLoss() {
    var wrap = $(".loss");
    wrap.innerHTML = "";
    var losses = data.losses, n = losses.length;
    var W = Math.min(wrap.clientWidth || 640, 720), H = 240, pl = 44, pr = 92, pt = 14, pb = 30;
    var max = Math.max(data.uniform, losses[0]) * 1.05, min = 0;
    var x = function (i) { return pl + (n > 1 ? i * (W - pl - pr) / (n - 1) : 0); };
    var y = function (v) { return pt + (H - pt - pb) * (1 - (v - min) / (max - min)); };
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 " + W + " " + H); svg.setAttribute("width", W); svg.setAttribute("height", H);
    svg.setAttribute("role", "img"); svg.setAttribute("aria-label", t("lab.train.lossLabel", { final: data.final, floor: data.floor }));
    [0, 0.25, 0.5, 0.75, 1].forEach(function (f) {
      var v = min + f * (max - min);
      svgEl(svg, "line", { x1: pl, x2: W - pr, y1: y(v), y2: y(v), class: "grid" });
      svgEl(svg, "text", { x: pl - 6, y: y(v) + 4, "text-anchor": "end", class: "tick" }).textContent = v.toFixed(1);
    });
    [0, 0.5, 1].forEach(function (f) {
      var i = Math.round(f * (n - 1));
      svgEl(svg, "text", { x: x(i), y: H - 8, "text-anchor": "middle", class: "tick" }).textContent = String(i + 1);
    });
    [[data.uniform, t("lab.train.uniform")], [data.floor, t("lab.train.floor")]].forEach(function (ref) {
      svgEl(svg, "line", { x1: pl, x2: W - pr, y1: y(ref[0]), y2: y(ref[0]), class: "marker" });
      svgEl(svg, "text", { x: W - pr + 6, y: y(ref[0]) + 4, class: "tick" }).textContent = ref[1] + " " + ref[0].toFixed(2);
    });
    var step = data.checkpoints[+ck.value];
    if (step > 0) svgEl(svg, "line", { x1: x(step - 1), x2: x(step - 1), y1: pt, y2: H - pb, class: "marker" });
    svgEl(svg, "path", { d: losses.map(function (v, i) { return (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1); }).join(" "), class: "line" });
    var dot = svgEl(svg, "circle", { cx: -10, cy: -10, r: 5, class: "dot" });
    var cross = svgEl(svg, "line", { x1: -10, x2: -10, y1: pt, y2: H - pb, class: "grid" });
    var tip = el("div", { class: "chart-tip", hidden: "" });
    var hit = svgEl(svg, "rect", { x: pl, y: pt, width: W - pl - pr, height: H - pt - pb, class: "hit", tabindex: "0" });
    function show(i) {
      i = Math.max(0, Math.min(n - 1, i));
      dot.setAttribute("cx", x(i)); dot.setAttribute("cy", y(losses[i]));
      cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i));
      tip.hidden = false; tip.textContent = t("lab.train.tip", { step: i + 1, loss: losses[i].toFixed(3) });
      tip.style.left = Math.min(W - 150, x(i) + 10) + "px"; tip.style.top = Math.max(0, y(losses[i]) - 34) + "px";
    }
    var focusIndex = n - 1;
    hit.addEventListener("mousemove", function (e) { var r = svg.getBoundingClientRect(); focusIndex = Math.round((e.clientX - r.left - pl) / (W - pl - pr) * (n - 1)); show(focusIndex); });
    hit.addEventListener("mouseleave", function () { tip.hidden = true; dot.setAttribute("cx", -10); cross.setAttribute("x1", -10); cross.setAttribute("x2", -10); });
    hit.addEventListener("focus", function () { show(focusIndex); });
    hit.addEventListener("keydown", function (e) { if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); focusIndex += e.key === "ArrowRight" ? Math.max(1, Math.round(n / 40)) : -Math.max(1, Math.round(n / 40)); focusIndex = Math.max(0, Math.min(n - 1, focusIndex)); show(focusIndex); } });
    wrap.appendChild(el("div", { class: "chart-box" }, [svg, tip]));
    var picks = data.checkpoints.filter(function (s) { return s > 0; });
    wrap.appendChild(el("table", { class: "sr" }, [el("tbody", {}, picks.map(function (s) { return el("tr", {}, [el("th", { text: t("lab.train.stepN", { n: s }) }), el("td", { text: losses[s - 1].toFixed(3) })]); }))]));
  }
  function drawDist(d) {
    var wrap = $(".dist");
    wrap.innerHTML = "";
    var max = d.rows.length ? d.rows[0].p : 1;
    var list = el("ol", { class: "bars", "aria-label": t("lab.train.distLabel", { word: word.value, step: d.step }) });
    d.rows.forEach(function (r) {
      var fillBar = el("span", { class: "bar-fill" + (r.kept ? "" : " is-cut") });
      fillBar.style.width = Math.max(1, Math.round(100 * r.p / Math.max(max, 1e-9))) + "%";
      list.appendChild(el("li", { class: r.kept ? "" : "is-cut" }, [el("span", { class: "bar-label", text: r.word }), el("span", { class: "bar-track" }, [fillBar]), el("span", { class: "bar-value", text: r.p.toFixed(2) + (r.kept ? "" : " ✕") })]));
    });
    wrap.appendChild(list);
    wrap.appendChild(el("p", { class: "hint", text: t("lab.train.distNote", { entropy: d.entropy.toFixed(2) }) }));
  }
  function updateDist() {
    if (!data) return;
    if (busy) { pendingDist = true; return; }
    busy = true;
    paintOutputs();
    drawLoss();
    py.eval("__result__ = distribution(" + (+ck.value) + ", " + JSON.stringify(word.value) + ", " + tv() + ", " + pv() + ")", { persist: true }).then(function (r) { drawDist(r.value); }).catch(function (err) { status.textContent = err.message; }).then(function () {
      busy = false;
      if (pendingDist) { pendingDist = false; updateDist(); }
    });
  }
  [ck, word, temp, topp].forEach(function (x) { x.addEventListener("input", updateDist); });
  $("[data-sample]").addEventListener("click", function () {
    var s = Math.floor(Math.random() * 10000);
    py.eval("__result__ = sample(" + (+ck.value) + ", " + JSON.stringify(word.value) + ", " + tv() + ", " + pv() + ", 16, " + s + ")", { persist: true }).then(function (r) { $(".sampled").textContent = r.value; });
  });
  $("form").addEventListener("submit", function (e) {
    e.preventDefault();
    go.disabled = true;
    A.set("lab:train:corpus", corpus.value);
    status.textContent = t("runner.starting");
    var first = ready ? Promise.resolve() : py.eval(setup, { persist: true }).then(function () { ready = true; });
    var started = Date.now();
    first.then(function () {
      status.textContent = t("lab.train.training");
      return py.eval("__result__ = train(" + JSON.stringify(corpus.value) + ", " + lrv() + ", " + (+steps.value) + ", " + (+seed.value || 0) + ")", { persist: true });
    }).then(function (r) {
      data = r.value;
      bar.hidden = true;
      status.textContent = t("lab.train.done", { s: ((Date.now() - started) / 1000).toFixed(1) });
      $(".lab-output").hidden = false;
      $(".loss-summary").textContent = t("lab.train.summary", { words: data.words, v: data.vocab.length, uniform: data.uniform.toFixed(3), final: data.final.toFixed(3), floor: data.floor.toFixed(3) });
      ck.max = String(data.checkpoints.length - 1);
      ck.value = ck.max;
      var current = word.value;
      word.innerHTML = "";
      data.vocab.forEach(function (w) { word.appendChild(el("option", { value: w, text: w })); });
      word.value = data.vocab.indexOf(current) >= 0 ? current : (data.vocab.indexOf("the") >= 0 ? "the" : data.vocab[0]);
      updateDist();
    }).catch(function (err) {
      bar.hidden = true;
      status.textContent = /^missing:/.test(err.message) ? t("runner.missing", { name: err.message.slice(8) }) : t("runner.failedLoad", { error: err.message.split("\n").slice(-1)[0] });
    }).then(function () { go.disabled = false; });
  });
  var rt;
  window.addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(function () { if (data) drawLoss(); }, 200); });
})();
