import { makeIndex, search, tokenize, decodeF16 } from "./search-core.mjs";

const A = window.__aia;
const P = window.__PAGE || {};
const t = A.t;
const root = document.getElementById("ask");
if (root) start();

function el(tag, attrs, kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "text") n.textContent = v;
    else n.setAttribute(k, v);
  }
  for (const c of kids || []) if (c) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  return n;
}

function start() {
  const input = root.querySelector("#ask-input");
  const list = root.querySelector("#ask-results");
  const status = root.querySelector(".ask-status");
  const bar = root.querySelector(".runner-progress");
  const fill = bar.querySelector("span");
  const modeButtons = [...root.querySelectorAll("[data-ask-mode]")];
  const base = P.rel + "search/";
  let index = null;
  let model = null;
  let loading = null;
  let mode = "bm25";
  let py = null;
  let modelReady = false;
  let seq = 0;
  let timer;

  try { if (A.get("pref:ask") === "hybrid") mode = "hybrid"; } catch (e) {}

  function load() {
    if (!loading) {
      loading = fetch(`${base}${P.lang}-chunks.json`).then((r) => r.json()).then(async (data) => {
        let vectors = null;
        if (data.vectors) {
          try {
            const buf = await (await fetch(base + data.vectors)).arrayBuffer();
            vectors = decodeF16(new Uint16Array(buf));
          } catch (e) {}
        }
        index = makeIndex(data, vectors);
        model = data.model;
        if (!vectors) {
          modeButtons.find((b) => b.dataset.askMode === "hybrid").disabled = true;
          if (mode === "hybrid") setMode("bm25", true);
        }
        return index;
      });
    }
    return loading;
  }

  function paintMode() {
    modeButtons.forEach((b) => b.setAttribute("aria-checked", b.dataset.askMode === mode ? "true" : "false"));
  }

  function setMode(m, quiet) {
    mode = m;
    paintMode();
    if (!quiet) try { A.set("pref:ask", m); } catch (e) {}
    status.textContent = "";
    if (mode === "hybrid" && !modelReady) load().then(() => { if (mode === "hybrid" && !modelReady && model) status.textContent = t("ask.hybrid.hint", { model: model.label, size: window.aiaFormatMB ? window.aiaFormatMB(model.bytes) : "" }); });
    if (input.value.trim().length > 1) run();
  }

  function ensureModel() {
    if (modelReady) return Promise.resolve();
    if (!window.PyClient) return Promise.reject(new Error("unsupported"));
    if (!py) {
      py = new window.PyClient();
      if (!py.available()) return Promise.reject(new Error("unsupported"));
      py.onEvent((m) => {
        if (m.type === "phase" && m.phase === "downloading") { status.textContent = t("runner.downloading", { size: window.aiaFormatMB(m.bytes) }); bar.hidden = false; bar.classList.add("is-indeterminate"); }
        if (m.type === "phase" && m.phase === "packages") status.textContent = t("runner.packages", { name: m.names });
        if (m.type === "progress") { status.textContent = t("runner.assets", { name: m.label, size: window.aiaFormatMB(m.received) + " / " + window.aiaFormatMB(m.total) }); bar.hidden = false; bar.classList.remove("is-indeterminate"); fill.style.width = Math.round(100 * m.received / m.total) + "%"; }
      });
    }
    return py.eval(`import numpy\nimport importlib\nif '_ask_model' not in globals():\n    _ask_model = importlib.import_module('sentence_transformers').SentenceTransformer(${JSON.stringify(model.name)})\n__result__ = True`, { persist: true, assets: model.assets }).then(() => { modelReady = true; bar.hidden = true; });
  }

  async function embed(q) {
    await ensureModel();
    const r = await py.eval(`import json\n__result__ = [round(float(x), 6) for x in _ask_model.encode([json.loads(${JSON.stringify(JSON.stringify(model.query + q))})], normalize_embeddings=True)[0]]`, { persist: true });
    return { vec: r.value, ms: r.ms };
  }

  function snippet(text, qset) {
    const words = text.split(/\s+/);
    let at = words.findIndex((w) => tokenize(w).some((x) => qset.has(x)));
    if (at < 0) at = 0;
    const from = Math.max(0, at - 8);
    const part = words.slice(from, from + 34);
    const out = el("span", { class: "row-sum" });
    if (from > 0) out.appendChild(document.createTextNode("… "));
    part.forEach((w, i) => {
      if (i) out.appendChild(document.createTextNode(" "));
      out.appendChild(tokenize(w).some((x) => qset.has(x)) ? el("mark", { text: w }) : document.createTextNode(w));
    });
    if (from + 34 < words.length) out.appendChild(document.createTextNode(" …"));
    return out;
  }

  function paint(q, r, ms) {
    const qset = new Set(tokenize(q));
    list.innerHTML = "";
    const lexRank = new Map((r.lexical || r.results).map((x, i) => [x.section, i + 1]));
    const semRank = new Map((r.semantic || []).map((x, i) => [x.section, i + 1]));
    r.results.slice(0, 6).forEach((x) => {
      const c = index.chunks[x.chunk];
      const why = r.mode === "hybrid" ? [lexRank.has(x.section) ? t("ask.why.keywords", { n: lexRank.get(x.section) }) : t("ask.why.noKeywords"), t("ask.why.meaning", { n: semRank.get(x.section) })].join(" · ") : "";
      list.appendChild(el("li", { "data-section": x.section }, [el("a", { class: "row", href: c.url }, [
        el("span", { class: "txt" }, [el("span", { class: "row-title", text: c.heading }), snippet(c.text, qset), el("span", { class: "row-meta", text: c.title + (why ? " · " + why : "") })])
      ])]));
    });
    if (!r.results.length) list.appendChild(el("li", { class: "empty", text: t("ask.none") }));
    root.dispatchEvent(new CustomEvent("aia:ask-results", { bubbles: true, detail: { query: q, mode: r.mode, lang: P.lang, sections: r.results.slice(0, 6).map((x) => x.section) } }));
    status.textContent = r.results.length ? t(r.mode === "hybrid" ? "ask.done.hybrid" : "ask.done.bm25", { ms: Math.max(1, Math.round(ms)), model: model ? model.label : "" }) : "";
  }

  async function run() {
    const q = input.value.trim();
    const my = ++seq;
    if (q.length < 2) { list.innerHTML = ""; status.textContent = ""; root.dispatchEvent(new CustomEvent("aia:ask-results", { bubbles: true, detail: { query: q, mode, lang: P.lang, sections: [] } })); return; }
    await load();
    if (my !== seq) return;
    const t0 = performance.now();
    if (mode === "hybrid" && index.vectors) {
      if (!modelReady) paint(q, search(index, q), performance.now() - t0);
      try {
        const { vec } = await embed(q);
        if (my !== seq) return;
        paint(q, search(index, q, vec), performance.now() - t0);
      } catch (e) {
        if (my === seq) status.textContent = t(String(e.message).startsWith("missing:") || e.message === "unsupported" ? "ask.hybrid.unavailable" : "ask.hybrid.failed");
        bar.hidden = true;
      }
      return;
    }
    paint(q, search(index, q), performance.now() - t0);
  }

  modeButtons.forEach((b) => b.addEventListener("click", () => { if (!b.disabled) setMode(b.dataset.askMode); }));
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, mode === "hybrid" ? 250 : 120); });
  root.querySelector("form").addEventListener("submit", (e) => { e.preventDefault(); clearTimeout(timer); run(); });
  input.addEventListener("focus", load, { once: true });
  root.querySelectorAll("[data-ask-example]").forEach((b) => b.addEventListener("click", () => { input.value = b.textContent; run(); input.focus(); }));
  paintMode();
  if (location.hash === "#search") setTimeout(() => input.focus(), 50);
}
