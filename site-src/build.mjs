import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, rmSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";
import hljs from "highlight.js";
import { buildSync } from "esbuild";
import { makeIndex, search, metrics, decodeF16 } from "./search-core.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "site-src");
const out = join(root, "dist");

const env = loadEnv();
const SITE_URL = (env.SITE_URL || "https://rene-guerrero.github.io/ai-academy/").replace(/\/?$/, "/");
const REPO = env.REPO_URL || "https://github.com/rene-guerrero/ai-academy";
const BRANCH = env.REPO_BRANCH || "master";
const LANGS = ["en", "es"];
const DEFAULT_LANG = "en";
const LEGACY_COURSE = "ai-engineering";
const VISUALS = { "01": "tokens", "02": "cloud", "03": "attention", "04": "layers", "05": "layers", "06": "cloud", "07": "cloud", "08": "tokens", "09": "attention", "10": "layers", "11": "quant", "12": "orbit", "13": "orbit", "14": "orbit", "15": "orbit", "16": "layers", "17": "layers", "18": "quant", "19": "tokens", "20": "quant", "21": "attention", "22": "cloud" };
const TRACK_VISUALS = { A: "attention", B: "cloud", C: "orbit", D: "layers", E: "quant", F: "cloud" };
const visualSlot = (kind) => `<div class="visual" data-visual="${kind}" aria-hidden="true"></div>`;

const dict = Object.fromEntries(LANGS.map((l) => [l, JSON.parse(readFileSync(join(src, "i18n", `${l}.json`), "utf8"))]));
const shell = readFileSync(join(src, "shell.html"), "utf8");

function loadEnv() {
  const result = { ...process.env };
  const file = join(root, ".env");
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) result[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  return result;
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const attr = esc;

function t(lang, key, vars = {}) {
  let s = dict[lang][key];
  if (s === undefined) {
    if (dict[DEFAULT_LANG][key] !== undefined) s = dict[DEFAULT_LANG][key];
    else throw new Error(`Missing translation ${lang}:${key}`);
  }
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`));
}

function parseFront(text, file) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new Error(`Missing front matter in ${file}`);
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i < 0) continue;
    let v = line.slice(i + 1).trim();
    if (/^".*"$/.test(v)) v = v.slice(1, -1);
    if (v === "true") v = true;
    else if (v === "false") v = false;
    data[line.slice(0, i).trim()] = v;
  }
  return { data, body: m[2] };
}

const slugify = (s) => s.toLowerCase().replace(/<[^>]+>/g, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function highlight(code, lang) {
  if (lang && hljs.getLanguage(lang)) return hljs.highlight(code, { language: lang }).value;
  return esc(code);
}

function codeBlock(code, lang, label, L) {
  const l = lang || "text";
  return `<div class="code"><div class="code-bar"><span>${esc(label || l)}</span><button type="button" class="copy" aria-label="${attr(t(L, "code.copyLabel"))}">${t(L, "code.copy")}</button></div><pre tabindex="0"><code class="hljs language-${attr(l)}">${highlight(code, lang)}</code></pre></div>`;
}

function extractQuiz(body) {
  const questions = [];
  const stripped = body.replace(/^::: ?quiz\s*\r?\n([\s\S]*?)\r?\n:::\s*$/gm, (_, inner) => {
    let current = null;
    for (const line of inner.split(/\r?\n/)) {
      if (/^Q:\s?/.test(line)) {
        current = { q: line.replace(/^Q:\s?/, ""), a: "" };
        questions.push(current);
      } else if (/^A:\s?/.test(line) && current) {
        current.a = line.replace(/^A:\s?/, "");
      } else if (current) {
        if (current.a) current.a += "\n" + line;
        else current.q += "\n" + line;
      }
    }
    return "";
  });
  return { stripped, questions };
}

function extractPredict(body) {
  const items = [];
  const stripped = body.replace(/^::: ?predict\s*\r?\n([\s\S]*?)\r?\n:::\s*$/gm, (_, inner) => {
    for (const line of inner.split(/\r?\n/)) {
      const m = line.match(/^P:\s*(.*)$/);
      if (!m) continue;
      const parts = m[1].split("|").map((x) => x.trim());
      if (parts.length < 5) throw new Error(`Bad predict line: ${line}`);
      const [id, kind, answer, tolerance, ...prompt] = parts;
      const item = { id, kind: kind.startsWith("choice:") ? "choice" : "number", answer, tolerance: Number(tolerance || 0), prompt: prompt.join("|") };
      if (item.kind === "choice") item.options = kind.slice(7).split(";").map((o) => { const [k, ...v] = o.split("="); return { key: k.trim(), label: v.join("=").trim() }; });
      items.push(item);
    }
    return "\n<!--PREDICT-->\n";
  });
  return { stripped, items };
}

function substituteClaims(body, values, where) {
  const used = new Set();
  const swap = (text, inCode) => text.replace(/\{\{claim:([\w-]+)\}\}/g, (_, name) => {
    if (!(name in values)) throw new Error(`${where}: unknown claim ${name}`);
    used.add(name);
    const v = values[name];
    return inCode ? v : `<span class="claim" data-claim="${attr(name)}">${esc(v)}</span>`;
  });
  const out = body.split(/(^```[^\n]*\n[\s\S]*?^```\s*$)/m).map((chunk, i) => {
    if (i % 2 === 1) return swap(chunk, true);
    return chunk.split(/(`[^`\n]+`)/).map((part, j) => (j % 2 === 1 ? swap(part, true) : swap(part, false))).join("");
  }).join("");
  return { text: out, used };
}

const claimErrors = [];
const claimTotals = { ok: 0, lessons: 0, seen: new Set() };
function resolveClaims(course, slug, scriptStem) {
  const defs = (course.claims || {})[slug] || {};
  const names = Object.keys(defs);
  const values = Object.fromEntries(names.map((n) => [n, defs[n].value]));
  let verified = false;
  const ref = runtime && scriptStem ? join(runtime.outputsDir, course.id, scriptStem + ".txt") : null;
  if (ref && existsSync(ref) && names.length) {
    const text = readFileSync(ref, "utf8");
    verified = true;
    for (const n of names) {
      const m = text.match(new RegExp(defs[n].pattern, "m"));
      const got = m ? m[1] : null;
      if (got !== defs[n].value) {
        verified = false;
        claimErrors.push(`${course.id}/${slug}: claim "${n}" is ${JSON.stringify(defs[n].value)} in claims.json but the exercise now prints ${JSON.stringify(got)}`);
      }
    }
  }
  const id = `${course.id}/${slug}`;
  if (verified && !claimTotals.seen.has(id)) {
    claimTotals.seen.add(id);
    claimTotals.ok += names.length;
    claimTotals.lessons += 1;
  }
  return { values, count: names.length, verified };
}

function predictHtml(items, values, L, key) {
  if (!items.length) return "";
  const answers = items.map((it) => {
    let a = it.answer;
    if (a.startsWith("claim:")) {
      const n = a.slice(6);
      if (!(n in values)) throw new Error(`${key}: prediction ${it.id} uses unknown claim ${n}`);
      a = values[n];
    }
    return { id: it.id, kind: it.kind, answer: it.kind === "number" ? Number(a) : a, tolerance: it.tolerance, label: it.kind === "choice" ? (it.options.find((o) => o.key === a) || {}).label : a };
  });
  const conf = [50, 70, 90].map((c) => `<button type="button" data-conf="${c}" aria-pressed="false">${c}%</button>`).join("");
  const rows = items.map((it) => {
    const input = it.kind === "number"
      ? `<input type="text" inputmode="decimal" autocomplete="off" data-pred-input aria-labelledby="pq-${it.id}">`
      : `<div class="segmented choices" role="radiogroup" aria-labelledby="pq-${it.id}">${it.options.map((o) => `<button type="button" role="radio" aria-checked="false" data-choice="${attr(o.key)}">${esc(o.label)}</button>`).join("")}</div>`;
    return `<li class="pred" data-pred="${attr(it.id)}"><p class="pred-q" id="pq-${it.id}">${marked.parseInline(it.prompt, { gfm: true })}</p>${input}<div class="pred-conf"><span class="muted">${t(L, "pred.confidence")}</span><div class="segmented" role="group" aria-label="${attr(t(L, "pred.confidence"))}">${conf}</div></div><p class="pred-result" aria-live="polite"></p></li>`;
  }).join("");
  return `<section class="predictions card" id="predictions-${key.replace(/[^\w-]/g, "-")}" data-predictions aria-labelledby="pred-h"><h3 id="pred-h">${t(L, "pred.title")}</h3><p class="hint">${t(L, "pred.hint")}</p><ol class="pred-list">${rows}</ol><div class="runner-bar"><button type="button" class="btn primary" data-lock>${t(L, "pred.lock")}</button><button type="button" class="btn" data-check hidden>${t(L, "pred.check")}</button><button type="button" class="btn" data-again hidden>${t(L, "pred.again")}</button></div><p class="pred-summary" aria-live="polite"></p><script type="application/json" class="pred-answers">${JSON.stringify(answers).replace(/</g, "\\u003c")}</script></section>`;
}

function render(body, L) {
  const toc = [];
  const used = new Set();
  const renderer = new marked.Renderer();
  renderer.code = (code, info) => {
    const lang = (info || "").split(/\s+/)[0];
    if (lang === "mermaid") return `<figure class="diagram"><pre class="mermaid" data-src="${attr(code)}">${esc(code)}</pre></figure>`;
    return codeBlock(code, lang, null, L);
  };
  renderer.heading = (text, level) => {
    const base = slugify(text) || "section";
    let id = base;
    let n = 2;
    while (used.has(id)) id = `${base}-${n++}`;
    used.add(id);
    const plain = text.replace(/<[^>]+>/g, "");
    if (level === 2 || level === 3) toc.push({ level, id, text: plain });
    return `<h${level} id="${id}">${text}<a class="anchor" href="#${id}" aria-label="${attr(plain)}">#</a></h${level}>`;
  };
  renderer.table = (header, bodyHtml) => `<div class="table-wrap" tabindex="0"><table><thead>${header}</thead><tbody>${bodyHtml}</tbody></table></div>`;
  const html = marked.parse(body, { renderer, gfm: true, breaks: false });
  return { html, toc };
}

function readDir(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".md")).sort().map((f) => {
    const { data, body } = parseFront(readFileSync(join(dir, f), "utf8"), join(dir, f));
    return { file: f, slug: f.replace(/\.md$/, ""), data, body };
  });
}

function loadContent(dir, kind) {
  const base = readDir(dir);
  const bySlug = new Map(base.map((x) => [x.slug, { en: x }]));
  for (const lang of LANGS.filter((l) => l !== DEFAULT_LANG)) {
    for (const x of readDir(join(dir, lang))) {
      const entry = bySlug.get(x.slug);
      if (!entry) throw new Error(`${dir}/${lang}/${x.file} has no English source`);
      entry[lang] = { ...x, data: { ...entry.en.data, ...x.data } };
    }
  }
  return [...bySlug.values()].map((v) => ({ kind, slug: v.en.slug, versions: v }));
}

const pick = (entry, lang) => entry.versions[lang] || entry.versions[DEFAULT_LANG];
const isTranslated = (entry, lang) => lang === DEFAULT_LANG || Boolean(entry.versions[lang]);

const courses = readdirSync(join(root, "courses"))
  .filter((d) => statSync(join(root, "courses", d)).isDirectory() && existsSync(join(root, "courses", d, "course.json")))
  .map((id) => {
    const dir = join(root, "courses", id);
    const meta = JSON.parse(readFileSync(join(dir, "course.json"), "utf8"));
    if (meta.id !== id) throw new Error(`courses/${id}/course.json id must be "${id}"`);
    const lessons = loadContent(join(dir, "lessons-md"), "lesson")
      .map((l) => ({ ...l, n: Number(l.versions.en.data.n), track: l.versions.en.data.area, key: `${id}/${l.slug}` }))
      .sort((a, b) => a.n - b.n);
    const notes = loadContent(join(dir, "notes-md"), "note").map((n) => ({ ...n, key: `${id}/note-${n.slug}` }));
    const claims = existsSync(join(dir, "claims.json")) ? JSON.parse(readFileSync(join(dir, "claims.json"), "utf8")) : {};
    return { id, dir, meta, lessons, notes, claims, tracks: new Map(meta.tracks.map((x) => [x.key, x])) };
  })
  .sort((a, b) => (a.meta.order || 99) - (b.meta.order || 99));

const files = [];
const runtimeFiles = [];
const runtime = assembleRuntime();

function assembleRuntime() {
  const pyDir = join(root, "node_modules", "pyodide");
  if (!existsSync(join(pyDir, "pyodide.mjs"))) return null;
  const cacheDir = join(root, "runtime-cache");
  const lock = JSON.parse(readFileSync(join(pyDir, "pyodide-lock.json"), "utf8"));
  const coreFiles = ["pyodide.mjs", "pyodide.asm.mjs", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json"];
  const wheelDir = join(cacheDir, "pyodide");
  const wheels = existsSync(wheelDir) ? readdirSync(wheelDir).filter((f) => f.endsWith(".whl") || f.endsWith(".zip")) : [];
  const haveWheel = new Set(wheels);
  const packages = Object.entries(lock.packages)
    .filter(([name, info]) => {
      const seen = new Set();
      const ok = (n) => {
        if (seen.has(n)) return true;
        seen.add(n);
        const i = lock.packages[n];
        return Boolean(i) && haveWheel.has(i.file_name) && (i.depends || []).every(ok);
      };
      return ok(name) && info.package_type !== "cpython_module";
    })
    .map(([name, info]) => ({ name, imports: info.imports || [name], size: statSync(join(wheelDir, info.file_name)).size, file: info.file_name, depends: info.depends || [] }));
  const assetDir = join(cacheDir, "assets");
  const assets = existsSync(assetDir) ? Object.fromEntries(readdirSync(assetDir).map((f) => [f, statSync(join(assetDir, f)).size])) : {};
  const shimDir = join(src, "runtime", "shims");
  const shimFiles = readdirSync(shimDir).filter((f) => f.endsWith(".py"));
  const hash = createHash("sha1");
  hash.update(JSON.stringify(lock.info)).update(JSON.stringify(packages.map((p) => p.file))).update(JSON.stringify(assets));
  for (const f of shimFiles) hash.update(readFileSync(join(shimDir, f)));
  hash.update(readFileSync(join(src, "runtime", "py-worker.mjs")));
  const version = hash.digest("hex").slice(0, 10);
  const base = `runtime/${version}/`;
  const core = coreFiles.filter((f) => f !== "pyodide-lock.json").reduce((n, f) => n + statSync(join(pyDir, f)).size, 0);
  const put = (from, to) => {
    const target = join(out, base, to);
    mkdirSync(dirname(target), { recursive: true });
    if (!existsSync(target) || statSync(target).size !== statSync(from).size) copyFileSync(from, target);
    runtimeFiles.push(base + to);
  };
  for (const f of coreFiles) put(join(pyDir, f), "pyodide/" + f);
  for (const p of packages) put(join(wheelDir, p.file), "pyodide/" + p.file);
  for (const f of Object.keys(assets)) put(join(assetDir, f), "assets/" + f);
  for (const f of shimFiles) put(join(shimDir, f), "shims/" + f);
  put(join(src, "runtime", "py-worker.mjs"), "py-worker.mjs");
  const known = {};
  for (const [name, info] of Object.entries(lock.packages)) if (info.package_type !== "cpython_module") for (const i of info.imports || [name]) known[i] = name;
  const manifest = { version, python: lock.info.python, core, packages: packages.map((p) => p.name), known, assets };
  mkdirSync(join(out, base), { recursive: true });
  writeFileSync(join(out, base, "manifest.json"), JSON.stringify(manifest));
  runtimeFiles.push(base + "manifest.json");
  const importMap = {};
  for (const p of packages) for (const i of p.imports) importMap[i] = p.name;
  const sizeOf = (name, seen = new Set()) => {
    if (seen.has(name)) return 0;
    seen.add(name);
    const p = packages.find((x) => x.name === name);
    return p ? p.size + p.depends.reduce((n, d) => n + sizeOf(d, seen), 0) : 0;
  };
  const SHIMS = { tiktoken: { packages: ["regex"], assets: ["cl100k_base.tiktoken"] }, sentence_transformers: { packages: ["numpy"], assets: ["minilm.npz", "minilm-vocab.txt", "minilm.json"] } };
  const outputsDir = join(cacheDir, "outputs");
  const outputsMeta = existsSync(join(outputsDir, "meta.json")) ? JSON.parse(readFileSync(join(outputsDir, "meta.json"), "utf8")) : null;
  return {
    base,
    version,
    manifest,
    outputsDir,
    outputsMeta,
    minilm: existsSync(join(assetDir, "minilm.json")) ? JSON.parse(readFileSync(join(assetDir, "minilm.json"), "utf8")) : null,
    e5: existsSync(join(assetDir, "e5.json")) ? JSON.parse(readFileSync(join(assetDir, "e5.json"), "utf8")) : null,
    estimate(code) {
      const imports = new Set([...code.matchAll(/^\s*(?:from|import)\s+([A-Za-z_][\w]*)/gm)].map((m) => m[1]));
      let bytes = core;
      const pk = new Set();
      const missing = [];
      for (const i of imports) {
        const shim = SHIMS[i];
        if (shim) {
          shim.packages.forEach((x) => pk.add(x));
          for (const a of shim.assets) {
            if (assets[a] === undefined) missing.push(i);
            else bytes += assets[a];
          }
        } else if (importMap[i]) pk.add(importMap[i]);
        else if (Object.values(lock.packages).some((x) => (x.imports || []).includes(i))) missing.push(i);
      }
      const seen = new Set();
      for (const x of pk) {
        if (!packages.find((p) => p.name === x)) missing.push(x);
        bytes += sizeOf(x, seen);
      }
      return { bytes, missing: [...new Set(missing)] };
    },
  };
}
function emit(name, content) {
  const target = join(out, name);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  files.push(name);
}

const rel_ = (lang, name) => relPrefix(lang, name);
const langPrefix = (lang) => (lang === DEFAULT_LANG ? "" : `${lang}/`);
const outPath = (lang, name) => langPrefix(lang) + name;
function relPrefix(lang, name) {
  const depth = outPath(lang, name).split("/").length - 1;
  return "../".repeat(depth);
}

const ICON = {
  search: '<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  cloud: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7 18.5h10a4.5 4.5 0 0 0 .6-8.96A6 6 0 0 0 6.1 11.2 3.7 3.7 0 0 0 7 18.5z"/></svg>',
  bookmark: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 3.5h12v17l-6-4.4-6 4.4z"/></svg>',
  chevron: '<svg aria-hidden="true" viewBox="0 0 24 24" class="chev"><path d="m9 6 6 6-6 6"/></svg>',
  back: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m15 6-6 6 6 6"/></svg>',
};

function ring(key, size = 44) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  return `<span class="ring" data-ring="${attr(key)}" style="--size:${size}px" aria-hidden="true"><svg viewBox="0 0 ${size} ${size}"><circle class="ring-track" cx="${size / 2}" cy="${size / 2}" r="${r}"/><circle class="ring-fill" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${c.toFixed(2)}" data-c="${c.toFixed(2)}"/></svg></span>`;
}

function page({ lang, name, title, desc, body, kind, slug = "", course = "", hasMermaid = false, extra = {}, ogType = "article" }) {
  const rel = relPrefix(lang, name);
  const other = LANGS.find((l) => l !== lang);
  const alt = rel + outPath(other, name);
  const L = lang;
  const pageData = { lang, kind, slug, course, name, rel, alt, ...extra };
  const tools = `<nav class="tools" aria-label="${attr(t(L, "nav.settings"))}">
<a class="tool" href="${rel}${langPrefix(lang)}index.html#search" aria-label="${attr(t(L, "nav.search"))}">${ICON.search}</a>
<a class="tool lang" href="${alt}" hreflang="${other}" lang="${other}" data-set-lang="${other}" title="${attr(t(L, "lang.switch"))}" aria-label="${attr(t(L, "lang.switch"))}"><span class="lang-code">${other.toUpperCase()}</span></a>
<button type="button" class="tool sync" id="account-btn" aria-haspopup="dialog" title="${attr(t(L, "nav.settings"))}">${ICON.cloud}<span class="sync-dot" id="sync-dot" data-sync="local" aria-hidden="true"></span><span class="sr" id="sync-label">${t(L, "sync.local")}</span></button>
</nav>`;
  const themeButtons = ["system", "light", "dark"].map((c) => `<button type="button" role="radio" data-theme-choice="${c}" aria-checked="${c === "system" ? "true" : "false"}">${t(L, `theme.${c}`)}</button>`).join("");
  const dialogs = `<dialog id="account-dialog" class="sheet" aria-labelledby="account-title">
<div class="sheet-grabber" aria-hidden="true"></div>
<form method="dialog" class="sheet-head"><h2 id="account-title">${t(L, "account.title")}</h2><button type="submit" class="sheet-done">${t(L, "sheet.done")}</button></form>
<div class="sheet-body">
<section class="group" aria-labelledby="appearance-h"><h3 id="appearance-h">${t(L, "settings.appearance")}</h3><div class="segmented" role="radiogroup" aria-labelledby="appearance-h">${themeButtons}</div><p class="hint">${t(L, "settings.appearance.hint")}</p></section>
<section class="group" aria-labelledby="language-h"><h3 id="language-h">${t(L, "settings.language")}</h3><div class="segmented" role="radiogroup" aria-labelledby="language-h">${LANGS.map((l) => l === lang ? `<span role="radio" aria-checked="true" class="seg-on">${dict[l]["lang.name"]}</span>` : `<a role="radio" aria-checked="false" href="${rel + outPath(l, name)}" data-set-lang="${l}" lang="${l}">${dict[l]["lang.name"]}</a>`).join("")}</div></section>
<section class="group" aria-labelledby="sync-h"><h3 id="sync-h">${t(L, "settings.sync")}</h3><div id="account-body"></div></section>
</div>
</dialog>
<dialog id="merge-dialog" class="sheet" aria-labelledby="merge-title">
<div class="sheet-head"><h2 id="merge-title">${t(L, "merge.title")}</h2></div>
<div class="sheet-body"><p>${t(L, "merge.body")}</p>
<div class="choice-list">
<button type="button" class="choice" data-merge="merge"><strong>${t(L, "merge.merge")}</strong><span>${t(L, "merge.merge.hint")}</span></button>
<button type="button" class="choice" data-merge="cloud"><strong>${t(L, "merge.cloud")}</strong><span>${t(L, "merge.cloud.hint")}</span></button>
<button type="button" class="choice" data-merge="local"><strong>${t(L, "merge.local")}</strong></button>
</div></div></dialog>`;
  const canonical = SITE_URL + outPath(lang, name);
  const altLinks = LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${SITE_URL + outPath(l, name)}">`).join("\n") + `\n<link rel="alternate" hreflang="x-default" href="${SITE_URL + outPath(DEFAULT_LANG, name)}">`;
  return shell
    .replace(/{{LANG}}/g, () => lang)
    .replace(/{{TITLE}}/g, () => esc(title))
    .replace(/{{SITE}}/g, () => esc(t(L, "site.name")))
    .replace(/{{DESC}}/g, () => esc(desc))
    .replace(/{{REL}}/g, () => rel)
    .replace(/{{HOME}}/g, () => rel + langPrefix(lang) + "index.html")
    .replace(/{{CANONICAL}}/g, () => canonical)
    .replace("{{ALTLINKS}}", () => altLinks)
    .replace("{{OGTYPE}}", () => ogType)
    .replace("{{OGLOCALE}}", () => lang === "es" ? "es_ES" : "en_US")
    .replace("{{OGIMAGE}}", () => SITE_URL + "icons/icon-512.png")
    .replace("{{PAGEDATA}}", () => JSON.stringify(pageData))
    .replace("{{DICT}}", () => JSON.stringify(dict[lang]))
    .replace("{{KIND}}", () => kind)
    .replace("{{SKIP}}", () => t(L, "nav.skip"))
    .replace("{{TOOLS}}", () => tools)
    .replace("{{DIALOGS}}", () => dialogs)
    .replace("{{FOOTER}}", () => t(L, "site.footer"))
    .replace("{{MERMAID}}", () => hasMermaid ? `<script src="${rel}vendor/mermaid.min.js" defer></script>` : "")
    .replace("{{RUNNER}}", () => extra.ask ? `${extra.runtime ? `<script src="${rel}pyclient.js" defer></script>` : ""}<script type="module" src="${rel}ask.js"></script>` : extra.lab ? `<script src="${rel}pyclient.js" defer></script><script src="${rel}labs/${extra.lab}.js" defer></script>` : extra.runtime ? `<script src="${rel}runner.js" defer></script>` : "")
    .replace("{{BODY}}", () => body);
}

function provenanceHtml(lesson, d, claims, L, lang, course) {
  const checks = runtime && runtime.outputsMeta ? runtime.outputsMeta.checks || {} : {};
  const script = d.exercise ? String(d.exercise).replace(/^.*\//, "") : "";
  const parity = checks[`${course.id}/${script}`];
  const items = [];
  const who = d.author === "claude" ? t(L, "prov.byClaude") : t(L, "prov.byOwner");
  items.push(["draft", `${who}${d.drafted ? " · " + esc(d.drafted) : ""}${d.regenerated ? " · " + t(L, "prov.regenerated") : ""}`, true]);
  if (claims.count) items.push(["claims", claims.verified ? t(L, "prov.claims", { n: claims.count }) : t(L, "prov.claimsPending", { n: claims.count }), claims.verified]);
  if (d.exercise) items.push(["exercise", parity ? (parity === "real" ? t(L, "prov.runsReal") : parity === "identical" ? t(L, "prov.identical") : t(L, "prov.close", { d: parity.replace("within ", "") })) : t(L, "prov.notRun"), Boolean(parity)]);
  items.push(["translation", lesson.versions.es ? t(L, "prov.translated") : t(L, "prov.untranslated"), Boolean(lesson.versions.es)]);
  items.push(["review", d.reviewed ? t(L, "prov.reviewed", { date: esc(d.reviewed) }) : t(L, "prov.notReviewed"), Boolean(d.reviewed)]);
  const passed = items.filter((x) => x[2]).length;
  return `<details class="provenance"><summary><span class="prov-badge" aria-hidden="true">${passed}/${items.length}</span>${t(L, "prov.title")}</summary><ul>${items.map(([k, text, ok]) => `<li class="${ok ? "ok" : "pending"}" data-prov="${k}"><span class="prov-mark" aria-hidden="true">${ok ? "✓" : "○"}</span><span class="sr">${ok ? t(L, "prov.ok") : t(L, "prov.pending")}: </span>${text}</li>`).join("")}</ul><p class="hint">${t(L, "prov.hint")}</p></details>`;
}

function tocHtml(toc, L, inline = false) {
  if (!toc.length) return "";
  const items = toc.map((x) => `<li class="l${x.level}"><a href="#${x.id}">${esc(x.text)}</a></li>`).join("");
  return inline
    ? `<nav class="toc toc-inline" aria-label="${attr(t(L, "lesson.toc"))}"><details><summary>${t(L, "lesson.toc")}</summary><ol>${items}</ol></details></nav>`
    : `<nav class="toc" aria-label="${attr(t(L, "lesson.toc"))}"><details open><summary>${t(L, "lesson.toc")}</summary><ol>${items}</ol></details></nav>`;
}

const decodeEntities = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
function chunkSections(html, key, url, title) {
  const clean = html.replace(/<div class="code">[\s\S]*?<\/pre><\/div>/g, " ").replace(/<figure class="diagram">[\s\S]*?<\/figure>/g, " ").replace(/<!--[\s\S]*?-->/g, " ").replace(/<a class="anchor"[^>]*>#<\/a>/g, "");
  const parts = clean.split(/(?=<h[23] id=")/);
  const out = [];
  for (const part of parts) {
    const m = part.match(/^<h([23]) id="([^"]+)">([\s\S]*?)<\/h\1>/);
    const heading = m ? decodeEntities(m[3].replace(/<[^>]+>/g, "")).trim() : title;
    if (/^(references|referencias|takeaways|ideas clave)$/i.test(heading)) continue;
    const anchor = m ? m[2] : "";
    const paras = decodeEntities((m ? part.slice(m[0].length) : part).replace(/<\/(p|li|tr|h4|blockquote)>/g, "\n").replace(/<[^>]+>/g, " ")).split("\n").map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);
    const windows = [];
    let cur = [];
    const words = (a) => a.join(" ").split(" ").length;
    for (const p of paras) {
      if (cur.length && words([...cur, p]) > 140) { windows.push(cur.join(" ")); cur = []; }
      cur.push(p);
    }
    if (cur.length) windows.push(cur.join(" "));
    out.push({ section: `${key}#${anchor}`, heading, windows: windows.length ? windows : [heading] });
  }
  return out.filter((x, i) => i > 0 || x.windows.join("").length > 40).flatMap((x, si) => x.windows.map((text) => ({ section: x.section, key, url: url + (x.section.endsWith("#") ? "" : "#" + x.section.split("#")[1]), title, heading: x.heading, text })));
}
const evalFile = join(root, "tests", "search-eval.json");
const evalSet = existsSync(evalFile) ? JSON.parse(readFileSync(evalFile, "utf8")) : { queries: [], thresholds: {} };
const askChunks = Object.fromEntries(LANGS.map((l) => [l, []]));
const askSections = Object.fromEntries(LANGS.map((l) => [l, new Map()]));
const searchIndex = Object.fromEntries(LANGS.map((l) => [l, []]));
const allLessonMeta = Object.fromEntries(LANGS.map((l) => [l, []]));

for (const course of courses) {
  const C = course.id;
  const lessonBySlug = new Map(course.lessons.map((l) => [l.slug, l]));
  const noteBySlug = new Map(course.notes.map((n) => [n.slug, n]));
  for (const lang of LANGS) {
    const L = lang;
    const courseTitle = course.meta.title[lang] || course.meta.title.en;
    const lessonLink = (slug) => {
      const l = lessonBySlug.get(slug);
      if (!l) throw new Error(`${C}: unknown lesson reference ${slug}`);
      return `<a href="${slug}.html">${l.n}. ${esc(pick(l, lang).data.title)}</a>`;
    };
    const crumb = `<a class="crumb" href="index.html">${ICON.back}<span>${esc(courseTitle)}</span></a>`;

    course.lessons.forEach((lesson, i) => {
      const v = pick(lesson, lang);
      const d = v.data;
      const scriptStem = d.exercise ? String(d.exercise).replace(/^.*\//, "").replace(/\.py$/, "") : "";
      const claims = resolveClaims(course, lesson.slug, scriptStem);
      const sub = substituteClaims(v.body, claims.values, `${C}/${lang}/${lesson.slug}`);
      const pred = extractPredict(sub.text);
      const { stripped, questions } = extractQuiz(pred.stripped);
      let { html, toc } = render(stripped, L);
      const proseHtml = html;
      html = html.replace(/<!--PREDICT-->/, () => predictHtml(pred.items, claims.values, L, lesson.key));
      const prev = course.lessons[i - 1];
      const next = course.lessons[i + 1];
      const track = course.tracks.get(lesson.track);
      if (!track) throw new Error(`${C}/${lesson.slug}: unknown area ${lesson.track}`);
      const level = d.level || "core";
      const prereqs = d.prereqs ? String(d.prereqs).split(",").map((s) => s.trim()).filter(Boolean) : [];
      const noteSlug = d.note && noteBySlug.has(d.note) ? d.note : null;
      const notices = [];
      if (d.regenerated) notices.push(`<aside class="notice" role="note">${t(L, "lesson.regenerated")}</aside>`);
      if (!isTranslated(lesson, lang)) notices.push(`<aside class="notice" role="note">${t(L, "lesson.untranslated")}</aside>`);

      let quiz = "";
      if (questions.length) {
        toc.push({ level: 2, id: "knowledge-check", text: t(L, "lesson.quiz") });
        quiz = `<section class="quiz" id="knowledge-check" aria-labelledby="quiz-h"><h2 id="quiz-h">${t(L, "lesson.quiz")}</h2><p class="hint">${t(L, "lesson.quiz.hint")}</p><ol class="quiz-list">${questions.map((q, qi) => `<li class="quiz-item" data-q="${qi}"><div class="quiz-q">${marked.parseInline(q.q.trim(), { gfm: true })}</div><details class="quiz-a"><summary>${t(L, "lesson.quiz.show")}</summary><div class="quiz-answer">${marked.parse(q.a, { gfm: true })}</div><div class="quiz-grade" role="group"><button type="button" class="chip" data-grade="ok" aria-pressed="false">${t(L, "lesson.quiz.ok")}</button><button type="button" class="chip" data-grade="review" aria-pressed="false">${t(L, "lesson.quiz.review")}</button><span class="quiz-state" aria-live="polite"></span></div></details></li>`).join("")}</ol></section>`;
      }

      let exercise = "";
      let runtimeInfo = null;
      if (d.exercise) {
        const rel = String(d.exercise);
        const repoPath = posix.join("courses", C, rel);
        const code = readFileSync(join(course.dir, rel), "utf8");
        const lines = code.split("\n").length - (code.endsWith("\n") ? 1 : 0);
        toc.push({ level: 2, id: "exercise", text: t(L, "lesson.exercise") });
        const local = `<p>${t(L, "lesson.exercise.run")}</p>${codeBlock(`.\\.venv\\Scripts\\python.exe ${repoPath.replace(/\//g, "\\")}`, "powershell", "PowerShell", L)}${codeBlock(`.venv/bin/python ${repoPath}`, "bash", "bash", L)}
<p><a class="btn" href="${REPO}/blob/${BRANCH}/${repoPath}" rel="noopener">${t(L, "lesson.exercise.open")}</a></p>`;
        const useRuntime = Boolean(d.runtime === "pyodide" && runtime);
        let reference = "";
        const refFile = runtime && join(runtime.outputsDir, C, rel.replace(/^exercises\//, "").replace(/\.py$/, ".txt"));
        if (refFile && existsSync(refFile)) {
          const date = runtime.outputsMeta && runtime.outputsMeta.date ? runtime.outputsMeta.date : "";
          reference = `<details class="reference"><summary>${t(L, "runner.reference")}</summary><p class="hint">${t(L, "runner.reference.hint", { date })}</p><div class="code"><div class="code-bar"><span>${t(L, "runner.output")}</span><button type="button" class="copy" aria-label="${attr(t(L, "code.copyLabel"))}">${t(L, "code.copy")}</button></div><pre tabindex="0"><code>${esc(readFileSync(refFile, "utf8"))}</code></pre></div></details>`;
        }
        if (useRuntime) {
          const est = runtime.estimate(code);
          runtimeInfo = { base: rel_(lang, `${C}/${lesson.slug}.html`) + runtime.base, version: runtime.version, missing: est.missing };
          exercise = `<section class="exercise" id="exercise" aria-labelledby="exercise-h"><h2 id="exercise-h">${t(L, "lesson.exercise")}</h2>
<div class="runner" data-runner data-key="${lesson.key}" hidden>
<div class="runner-bar"><button type="button" class="btn primary" data-run><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7 4.5v15l12-7.5z"/></svg>${t(L, "runner.run")}</button><button type="button" class="btn" data-stop hidden><svg aria-hidden="true" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>${t(L, "runner.stop")}</button><button type="button" class="btn" data-edit aria-pressed="false">${t(L, "runner.edit")}</button><button type="button" class="btn" data-reset hidden>${t(L, "runner.reset")}</button><button type="button" class="btn" data-share hidden>${t(L, "runner.share")}</button><span class="runner-edited" hidden>${t(L, "runner.edited")}</span></div>
<div class="runner-shared notice" hidden role="status"><p>${t(L, "runner.shared")}</p><div class="runner-bar"><button type="button" class="btn primary" data-keep>${t(L, "runner.keep")}</button><button type="button" class="btn" data-discard>${t(L, "runner.discard")}</button></div></div>
<p class="runner-status" role="status" aria-live="polite"></p>
<div class="runner-progress" hidden><span></span></div>
<p class="runner-nudge" hidden><a href="#my-notes">${t(L, "runner.predictFirst")}</a></p>
<div class="runner-view">${codeBlock(code, "python", repoPath, L)}</div>
<label class="sr" for="runner-editor">${t(L, "runner.edit")}</label><textarea id="runner-editor" class="runner-editor" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" wrap="off" hidden></textarea>
<textarea class="runner-original" hidden aria-hidden="true" tabindex="-1">${esc(code)}</textarea>
<div class="runner-out code" hidden><div class="code-bar"><span>${t(L, "runner.output")}</span><button type="button" class="copy" aria-label="${attr(t(L, "code.copyLabel"))}">${t(L, "code.copy")}</button></div><pre tabindex="0"><code></code></pre></div>
<p class="hint runner-hint">${t(L, "runner.hint", { size: (est.bytes / 1048576).toFixed(0) + " MB" })}</p>
</div>
<noscript>${codeBlock(code, "python", repoPath, L)}</noscript>
${reference}
<details class="local-run"><summary>${t(L, "runner.local")}</summary>${local}</details></section>`;
        } else {
          exercise = `<section class="exercise" id="exercise" aria-labelledby="exercise-h"><h2 id="exercise-h">${t(L, "lesson.exercise")}</h2>
${local}
<details class="source"><summary>${t(L, "lesson.exercise.show", { n: lines })}</summary>${codeBlock(code, "python", repoPath, L)}</details>${reference}</section>`;
        }
      }
      toc.push({ level: 2, id: "my-notes", text: t(L, "lesson.notes") });

      const nextSteps = [];
      if (next) nextSteps.push(`<li><span class="muted">${t(L, "lesson.next.lesson")}</span> ${lessonLink(next.slug)}</li>`);
      for (const lab of (course.meta.labs || []).filter((x) => (x.lessons || []).includes(lesson.slug))) nextSteps.push(`<li><span class="muted">${t(L, "lab.label")}</span> <a href="lab-${lab.id}.html">${esc(lab.title[lang])}</a></li>`);
      if (noteSlug) nextSteps.push(`<li><span class="muted">${t(L, "lesson.next.note")}</span> <a href="note-${noteSlug}.html">${esc(pick(noteBySlug.get(noteSlug), lang).data.title)}</a></li>`);

      const body = `<div class="layout"><aside class="side">${tocHtml(toc, L)}</aside>
<main id="content" class="main lesson" data-key="${lesson.key}" tabindex="-1">
${crumb}
<p class="eyebrow"><span>${t(L, "lesson.label", { n: lesson.n })}</span><span class="dot" aria-hidden="true"></span><span>${esc(track.name[lang])}</span><span class="dot" aria-hidden="true"></span><span>${t(L, "lesson.minutes", { n: d.minutes || 25 })}</span><span class="dot" aria-hidden="true"></span><span>${t(L, `lesson.level.${level}`)}</span></p>
<h1>${esc(d.title)}</h1>
<p class="lede">${esc(d.summary)}</p>
${visualSlot(d.visual || VISUALS[lesson.slug.slice(0, 2)] || TRACK_VISUALS[lesson.track] || "cloud")}
<div class="lesson-actions">
<button type="button" class="act" id="done-btn" aria-pressed="false"><span class="box" aria-hidden="true"></span><span class="label">${t(L, "lesson.done")}</span></button>
<button type="button" class="act" id="bookmark-btn" aria-pressed="false">${ICON.bookmark}<span class="label">${t(L, "lesson.bookmark")}</span></button>
</div>
${tocHtml(toc, L, true)}
${provenanceHtml(lesson, d, claims, L, lang, course)}
${prereqs.length ? `<p class="prereqs"><span class="muted">${t(L, "lesson.prereqs")}:</span> ${prereqs.map(lessonLink).join(", ")}</p>` : ""}
${notices.join("\n")}
<div class="prose">${html}</div>
${quiz}
${exercise}
<section class="mine" id="my-notes" aria-labelledby="notes-h"><h2 id="notes-h">${t(L, "lesson.notes")}</h2>
<p class="hint">${t(L, "lesson.notes.hint")}</p>
<label class="sr" for="predictions">${t(L, "lesson.notes")}</label>
<textarea id="predictions" rows="7" placeholder="${attr(t(L, "lesson.notes.placeholder"))}"></textarea>
<p class="status" id="save-status" aria-live="polite"></p>
</section>
${nextSteps.length ? `<section class="next-steps" aria-labelledby="next-h"><h2 id="next-h">${t(L, "lesson.next")}</h2><ul>${nextSteps.join("")}</ul></section>` : ""}
<nav class="pager" aria-label="${attr(t(L, "lesson.next"))}">
${prev ? `<a class="prev" href="${prev.slug}.html" rel="prev"><small>${t(L, "lesson.prev")}</small><span>${prev.n}. ${esc(pick(prev, lang).data.title)}</span></a>` : `<a class="prev" href="index.html"><small>${t(L, "lesson.back")}</small><span>${esc(courseTitle)}</span></a>`}
${next ? `<a class="next" href="${next.slug}.html" rel="next"><small>${t(L, "lesson.nextShort")}</small><span>${next.n}. ${esc(pick(next, lang).data.title)}</span></a>` : `<a class="next" href="index.html"><small>${t(L, "lesson.nextAll")}</small><span>${esc(courseTitle)}</span></a>`}
</nav></main></div>`;
      const name = `${C}/${lesson.slug}.html`;
      emit(outPath(lang, name), page({ lang, name, title: `${lesson.n}. ${d.title}`, desc: String(d.summary), body, kind: "lesson", slug: lesson.key, course: C, hasMermaid: html.includes('class="mermaid"'), extra: { n: lesson.n, title: d.title, minutes: Number(d.minutes || 25), quiz: questions.length, courseTitle, ...(runtimeInfo ? { runtime: runtimeInfo } : {}) } }));
      const lessonChunks = chunkSections(proseHtml, lesson.key, name, `${lesson.n}. ${d.title}`);
      askChunks[lang].push(...lessonChunks);
      askSections[lang].set(lesson.key, [...new Set(lessonChunks.map((c) => c.section))].map((sec) => ({ section: sec, heading: lessonChunks.find((c) => c.section === sec).heading })));
      searchIndex[lang].push({ key: lesson.key, url: name, course: C, courseTitle, kind: "lesson", n: lesson.n, title: d.title, summary: d.summary, headings: toc.map((x) => ({ id: x.id, text: x.text })) });
      allLessonMeta[lang].push({ key: lesson.key, course: C, url: name, n: lesson.n, title: d.title, minutes: Number(d.minutes || 25), quiz: questions.length });
    });

    for (const note of course.notes) {
      const v = pick(note, lang);
      const { html, toc } = render(v.body, L);
      const notices = isTranslated(note, lang) ? "" : `<aside class="notice" role="note">${t(L, "lesson.untranslated")}</aside>`;
      const body = `<div class="layout"><aside class="side">${tocHtml(toc, L)}</aside><main id="content" class="main lesson note" tabindex="-1">
${crumb}<p class="eyebrow"><span>${t(L, "note.label")}</span></p><h1>${esc(v.data.title)}</h1><p class="lede">${esc(v.data.summary)}</p>${tocHtml(toc, L, true)}${notices}<div class="prose">${html}</div>
<nav class="pager" aria-label="${attr(t(L, "nav.home"))}"><a class="prev" href="index.html"><small>${t(L, "lesson.back")}</small><span>${esc(courseTitle)}</span></a><span></span></nav></main></div>`;
      const name = `${C}/note-${note.slug}.html`;
      emit(outPath(lang, name), page({ lang, name, title: String(v.data.title), desc: String(v.data.summary), body, kind: "note", slug: note.key, course: C, hasMermaid: html.includes('class="mermaid"'), extra: { title: v.data.title } }));
      const noteChunks = chunkSections(html, note.key, name, String(v.data.title));
      askChunks[lang].push(...noteChunks);
      askSections[lang].set(note.key, [...new Set(noteChunks.map((c) => c.section))].map((sec) => ({ section: sec, heading: noteChunks.find((c) => c.section === sec).heading })));
      searchIndex[lang].push({ key: note.key, url: name, course: C, courseTitle, kind: "note", title: v.data.title, summary: v.data.summary, headings: toc.map((x) => ({ id: x.id, text: x.text })) });
    }

    const trackSections = course.meta.tracks.map((track) => {
      const items = course.lessons.filter((l) => l.track === track.key);
      const planned = (course.meta.planned || []).filter((p) => p.track === track.key);
      const rows = items.map((l) => {
        const d = pick(l, lang).data;
        return `<li><a class="row" href="${l.slug}.html" data-key="${l.key}" data-title="${attr(d.title)}"><span class="num" aria-hidden="true">${l.n}</span><span class="txt"><span class="row-title">${esc(d.title)}</span><span class="row-sum">${esc(d.summary)}</span><span class="row-meta">${t(L, "lesson.minutes", { n: d.minutes || 25 })}<span class="dot" aria-hidden="true"></span>${t(L, `lesson.level.${d.level || "core"}`)}</span></span><span class="state" data-state="new">${t(L, "status.new")}</span>${ICON.chevron}</a></li>`;
      });
      const plannedRows = planned.map((p) => `<li class="planned"><div class="row" aria-disabled="true"><span class="num" aria-hidden="true">&middot;</span><span class="txt"><span class="row-title">${esc(p.title[lang])}</span><span class="row-sum">${esc(p.summary[lang])}</span></span><span class="state" data-state="planned">${t(L, "status.planned")}</span></div></li>`);
      return `<section class="track" id="track-${track.key}" aria-labelledby="track-${track.key}-h" data-track="${track.key}">
<h3 id="track-${track.key}-h" class="group-title"><span class="letter" aria-hidden="true">${track.key}</span>${esc(track.name[lang])}</h3>
<p class="blurb">${esc(track.blurb[lang])}</p>
${rows.length ? `<ol class="list">${rows.join("")}</ol>` : `<p class="empty">${t(L, "home.track.empty")}</p>`}
${plannedRows.length ? `<details class="planned-list"><summary>${t(L, "home.planned")} (${plannedRows.length})</summary><p class="hint">${t(L, "home.planned.hint")}</p><ol class="list">${plannedRows.join("")}</ol></details>` : ""}
</section>`;
    }).join("\n");

    for (const lab of course.meta.labs || []) {
      const name = `${C}/lab-${lab.id}.html`;
      const tpl = readFileSync(join(src, "labs", `${lab.id}.html`), "utf8").replace(/\{\{t:([\w.]+)\}\}/g, (_, k) => esc(t(L, k)));
      const py = readFileSync(join(src, "labs", `${lab.id}.py`), "utf8");
      const est = runtime ? runtime.estimate(py) : { bytes: 0, missing: [] };
      const labBody = `<main id="content" class="main lab-page" tabindex="-1">
${crumb}
<p class="eyebrow"><span>${t(L, "lab.label")}</span></p><h1>${esc(lab.title[lang])}</h1><p class="lede">${esc(lab.summary[lang])}</p>
<p class="hint">${t(L, "lab.download", { size: (est.bytes / 1048576).toFixed(0) + " MB" })}</p>
${tpl}
<textarea id="lab-code" hidden aria-hidden="true" tabindex="-1">${esc(py)}</textarea>
<noscript><p class="notice">${t(L, "runner.unsupported")}</p></noscript>
</main>`;
      emit(outPath(lang, name), page({ lang, name, title: lab.title[lang], desc: lab.summary[lang], body: labBody, kind: "lab", slug: `${C}/lab-${lab.id}`, course: C, extra: { lab: lab.id, ...(runtime ? { runtime: { base: rel_(lang, name) + runtime.base, version: runtime.version, missing: est.missing } } : {}) } }));
    }
    const labList = (course.meta.labs || []).length ? `<section class="labs-section" id="labs" aria-labelledby="labs-h"><h2 id="labs-h">${t(L, "home.labs")}</h2><p class="hint">${t(L, "home.labs.hint")}</p><ul class="list">${course.meta.labs.map((lab) => `<li><a class="row" href="lab-${lab.id}.html"><span class="txt"><span class="row-title">${esc(lab.title[lang])}</span><span class="row-sum">${esc(lab.summary[lang])}</span></span>${ICON.chevron}</a></li>`).join("")}</ul></section>` : "";
    const noteList = course.notes.length ? `<section class="notes-section" id="notes" aria-labelledby="notes-h"><h2 id="notes-h">${t(L, "home.notes")}</h2><p class="hint">${t(L, "home.notes.hint")}</p><ul class="list">${course.notes.map((n) => `<li><a class="row" href="note-${n.slug}.html"><span class="txt"><span class="row-title">${esc(pick(n, lang).data.title)}</span><span class="row-sum">${esc(pick(n, lang).data.summary)}</span></span>${ICON.chevron}</a></li>`).join("")}</ul></section>` : "";

    const lessonMeta = course.lessons.map((l) => ({ key: l.key, url: `${l.slug}.html`, n: l.n, title: pick(l, lang).data.title, minutes: Number(pick(l, lang).data.minutes || 25), quiz: extractQuiz(pick(l, lang).body).questions.length }));
    const totalMinutes = lessonMeta.reduce((s, l) => s + l.minutes, 0);
    const courseBody = `<main id="content" class="main home course-page" tabindex="-1">
<a class="crumb" href="../index.html">${ICON.back}<span>${t(L, "nav.courses")}</span></a>
<header class="hero course-hero">${ring(C, 64)}<div><p class="eyebrow"><span>${t(L, "course.label")}</span></p><h1>${esc(courseTitle)}</h1><p class="lede">${esc(course.meta.summary[lang])}</p></div></header>
<section class="continue" id="continue" aria-labelledby="continue-h"><h2 id="continue-h" class="sr">${t(L, "home.continue")}</h2>
<div class="card continue-card"><p class="progress"><span id="progress-text">${t(L, "home.progress", { done: 0, total: lessonMeta.length })}</span><span class="bar" aria-hidden="true"><span id="progress-fill" style="width:0%"></span></span><span class="muted" id="progress-time">${t(L, "home.progress.time", { minutes: totalMinutes })}</span></p><div id="continue-body"></div></div></section>
<section class="catalog" id="catalog" aria-labelledby="catalog-h"><h2 id="catalog-h">${t(L, "home.catalog")}</h2>
<div class="catalog-tools"><div class="search"><label for="search-input" class="sr">${t(L, "home.search.label")}</label>${ICON.search}<input id="search-input" type="search" placeholder="${attr(t(L, "home.search.placeholder"))}" autocomplete="off"></div>
<div class="segmented filters" role="group" aria-label="${attr(t(L, "home.catalog"))}"><button type="button" data-filter="all" aria-pressed="true">${t(L, "home.filter.all")}</button><button type="button" data-filter="todo" aria-pressed="false">${t(L, "home.filter.todo")}</button><button type="button" data-filter="progress" aria-pressed="false">${t(L, "home.filter.progress")}</button><button type="button" data-filter="done" aria-pressed="false">${t(L, "home.filter.done")}</button><button type="button" data-filter="saved" aria-pressed="false">${t(L, "home.filter.saved")}</button></div></div>
<div class="search-results card" id="search-results" hidden><h3>${t(L, "home.search.sections")}</h3><ul id="search-hits"></ul></div>
<p class="empty" id="filter-empty" hidden>${t(L, "home.filter.empty")}</p>
${trackSections}
</section>
${labList}
${noteList}
</main>`;
    const cname = `${C}/index.html`;
    emit(outPath(lang, cname), page({ lang, name: cname, title: courseTitle, desc: course.meta.summary[lang], body: courseBody, kind: "course", course: C, ogType: "website", extra: { lessons: lessonMeta, searchScope: C } }));
  }
}

function askRuntime(lang) {
  if (!runtime) return null;
  if (runtime.estimate("import numpy").missing.length) return null;
  return { runtime: { base: rel_(lang, "index.html") + runtime.base, version: runtime.version, missing: [] } };
}

for (const lang of LANGS) {
  const L = lang;
  const courseRows = courses.map((c) => {
    const title = c.meta.title[lang] || c.meta.title.en;
    const tracks = c.meta.tracks.filter((tr) => c.lessons.some((l) => l.track === tr.key)).map((tr) => tr.name[lang]);
    return `<li><a class="row course-row" href="${c.id}/index.html" data-course="${c.id}" data-total="${c.lessons.length}">${ring(c.id, 52)}<span class="txt"><span class="row-title">${esc(title)}</span><span class="row-sum">${esc(c.meta.summary[lang])}</span><span class="row-meta" data-course-progress="${c.id}">${t(L, "course.lessons", { n: c.lessons.length })}${tracks.length ? `<span class="dot" aria-hidden="true"></span>${esc(tracks.join(", "))}` : ""}</span></span>${ICON.chevron}</a></li>`;
  }).join("");
  const first = courses[0] && courses[0].lessons[0];
  const home = `<main id="content" class="main home" tabindex="-1">
<header class="hero"><h1>${t(L, "site.name")}</h1><p class="lede">${t(L, "home.intro")}</p>
<figure class="visual-figure"><div class="visual visual-map" data-visual="cloud" data-map aria-hidden="true"><span class="visual-tip" hidden></span></div><figcaption class="hint">${t(L, "home.map")}</figcaption></figure></header>
<section class="continue" id="continue" aria-labelledby="continue-h"><h2 id="continue-h">${t(L, "home.continue")}</h2><div class="card continue-card"><div id="continue-body"></div></div></section>
<section class="intuition" id="intuition" aria-labelledby="intuition-h"><h2 id="intuition-h">${t(L, "home.intuition")}</h2><p class="hint">${t(L, "home.intuition.hint")}</p><div class="card" id="intuition-body"></div></section>
<section class="courses" id="courses" aria-labelledby="courses-h"><h2 id="courses-h">${t(L, "home.courses")}</h2><ul class="list">${courseRows}</ul></section>
<section class="review" id="review" aria-labelledby="review-h" hidden><h2 id="review-h">${t(L, "home.review")}</h2><p class="hint">${t(L, "home.review.hint")}</p><ul class="list" id="review-list"></ul></section>
<section class="ask" id="ask" aria-labelledby="search-h"><span id="search" class="anchor-target"></span><h2 id="search-h">${t(L, "ask.title")}</h2><p class="hint">${t(L, "ask.hint")}</p>
<form class="ask-form" role="search"><div class="search"><label for="ask-input" class="sr">${t(L, "ask.label")}</label>${ICON.search}<input id="ask-input" type="search" placeholder="${attr(t(L, "ask.placeholder"))}" autocomplete="off" enterkeyhint="search"></div></form>
<div class="ask-tools"><div class="segmented" role="radiogroup" aria-label="${attr(t(L, "ask.mode"))}"><button type="button" role="radio" data-ask-mode="bm25" aria-checked="true">${t(L, "ask.mode.bm25")}</button><button type="button" role="radio" data-ask-mode="hybrid" aria-checked="false">${t(L, "ask.mode.hybrid")}</button></div></div>
<p class="ask-examples"><span class="muted">${t(L, "ask.try")}</span> ${evalSet.queries.filter((_, i) => [2, 11, 21].includes(i)).map((q) => `<button type="button" class="chip" data-ask-example>${esc(q[lang])}</button>`).join(" ")}</p>
<p class="hint ask-status" role="status" aria-live="polite"></p>
<div class="runner-progress" hidden><span></span></div>
<ol class="list ask-results" id="ask-results" aria-live="polite"></ol>
<p class="hint"><a href="quality.html">${t(L, "ask.quality")}</a></p></section>
<section class="built" id="built" aria-labelledby="built-h"><h2 id="built-h">${t(L, "home.built")}</h2><p class="hint">${t(L, "home.built.hint")}</p><ul class="list"><li><a class="row" href="case-study.html"><span class="txt"><span class="row-title">${t(L, "home.built.cs")}</span><span class="row-sum">${t(L, "home.built.cs.sum")}</span></span>${ICON.chevron}</a></li><li><a class="row" href="quality.html"><span class="txt"><span class="row-title">${t(L, "home.built.q")}</span><span class="row-sum">${t(L, "home.built.q.sum")}</span></span>${ICON.chevron}</a></li></ul></section>
<section class="data" id="data" aria-labelledby="data-h"><h2 id="data-h">${t(L, "home.data")}</h2><p class="hint">${t(L, "home.data.hint")}</p><div class="data-actions"><button type="button" class="btn" id="open-account">${t(L, "account.title")}</button><button type="button" class="btn" data-action="export">${t(L, "account.export")}</button><button type="button" class="btn" data-action="export-md">${t(L, "account.exportMd")}</button><label class="btn file"><input type="file" accept="application/json,.json" id="import-file" class="sr">${t(L, "account.import")}</label></div><p class="status" id="data-status" aria-live="polite"></p></section>
</main>`;
  emit(outPath(lang, "index.html"), page({ lang, name: "index.html", title: t(L, "site.name"), desc: t(L, "site.description"), body: home, kind: "home", ogType: "website", extra: { ask: true, ...(askRuntime(lang) || {}), lessons: allLessonMeta[lang], courses: courses.map((c) => ({ id: c.id, title: c.meta.title[lang] || c.meta.title.en, total: c.lessons.length })), firstUrl: first ? `${courses[0].id}/${first.slug}.html` : "" } }));
  emit(outPath(lang, "search.json"), JSON.stringify(searchIndex[lang]));
}

const searchCache = join(root, "runtime-cache", "search");
const readJson = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null);
const queryVectors = readJson(join(searchCache, "queries.json"));
const requireSemantic = env.AIA_REQUIRE_SEARCH === "1";
const SEARCH_MODELS = [
  { key: "minilm", name: "all-MiniLM-L6-v2", label: "MiniLM", query: "", assets: ["minilm.npz", "minilm-vocab.txt", "minilm.json"], vector: "vector", hybrid: "hybrid" },
  { key: "e5", name: "intfloat/multilingual-e5-small", label: "multilingual E5", query: "query: ", assets: ["e5.npz", "e5-vocab.json", "e5.json"], vector: "e5", hybrid: "hybrid-e5" },
];
const quality = { date: new Date().toISOString().slice(0, 10), models: Object.fromEntries(SEARCH_MODELS.map((m) => [m.key, m.name])), queries: evalSet.queries.length, languages: {} };
const searchFailures = [];
mkdirSync(join(out, "search"), { recursive: true });
const browserBytes = (model) => {
  if (!runtime || model.assets.some((x) => runtime.manifest.assets[x] === undefined)) return null;
  return runtime.estimate("import numpy").bytes + model.assets.reduce((n, x) => n + runtime.manifest.assets[x], 0);
};
for (const lang of LANGS) {
  const chunks = askChunks[lang];
  const hash = createHash("sha1").update(JSON.stringify(chunks.map((c) => `${c.title}. ${c.heading}\n${c.text}`))).digest("hex").slice(0, 12);
  const lexicalIndex = makeIndex({ chunks }, null);
  const expectFor = (q) => new Set(q.expect.map(([key, heading]) => {
    const enList = askSections[DEFAULT_LANG].get(key);
    if (!enList) throw new Error(`search-eval: unknown page ${key}`);
    const i = enList.findIndex((x) => x.heading === heading);
    if (i < 0) throw new Error(`search-eval: ${key} has no section "${heading}"`);
    const list = askSections[lang].get(key);
    if (list.length !== enList.length) throw new Error(`search-eval: ${lang}/${key} has ${list.length} sections, English has ${enList.length}`);
    return list[i].section;
  }));
  const rankOf = (list, expect) => list.slice(0, 10).findIndex((x) => expect.has(x.section)) + 1;
  const top = (list) => (list && list[0] ? chunks[list[0].chunk].heading : "");
  const rows = evalSet.queries.map((q) => {
    const expect = expectFor(q);
    const r = search(lexicalIndex, q[lang]);
    return { query: q[lang], expectSet: expect, expect: [...expect].map((sec) => { const c = chunks.find((x) => x.section === sec); return `${c.title} › ${c.heading}`; }), ranks: { bm25: rankOf(r.results, expect) }, top: { bm25: top(r.results) } };
  });
  const loaded = [];
  for (const model of SEARCH_MODELS) {
    const meta = readJson(join(searchCache, `${lang}-${model.key}-vectors.json`));
    const qv = queryVectors && queryVectors[model.key] && queryVectors[model.key][lang];
    if (!meta || meta.hash !== hash || !qv || !evalSet.queries.every((q) => qv[q[lang]])) {
      if (requireSemantic) searchFailures.push(`${lang} ${model.key}: chunk or query vectors are ${meta ? "stale" : "missing"}; run python3 tools/embed_search.py after a build`);
      continue;
    }
    const buf = readFileSync(join(searchCache, `${lang}-${model.key}-vectors.bin`));
    const vectors = decodeF16(new Uint16Array(buf.buffer, buf.byteOffset, buf.length / 2));
    const index = makeIndex({ chunks, dim: meta.dim }, vectors);
    evalSet.queries.forEach((q, i) => {
      const r = search(index, q[lang], qv[q[lang]]);
      rows[i].ranks[model.vector] = rankOf(r.semantic, rows[i].expectSet);
      rows[i].ranks[model.hybrid] = rankOf(r.results, rows[i].expectSet);
      rows[i].top[model.vector] = top(r.semantic);
      rows[i].top[model.hybrid] = top(r.results);
    });
    loaded.push({ model, meta, buf });
  }
  rows.forEach((r) => delete r.expectSet);
  const modes = Object.keys(rows[0] ? rows[0].ranks : { bm25: 0 });
  const result = Object.fromEntries(modes.map((m) => [m, metrics(rows.map((x) => x.ranks[m]))]));
  const shippable = loaded.filter((x) => browserBytes(x.model) !== null);
  const chosen = shippable.reduce((best, x) => (!best || result[x.model.hybrid].mrr > result[best.model.hybrid].mrr + 1e-9 ? x : best), null);
  let vectorFile = null;
  if (chosen) {
    vectorFile = `search/${lang}-${chosen.model.key}-${hash}.bin`;
    writeFileSync(join(out, vectorFile), chosen.buf);
    files.push(vectorFile);
  }
  const data = { hash, dim: chosen ? chosen.meta.dim : 384, vectors: vectorFile ? vectorFile.replace("search/", "") : null, model: chosen ? { key: chosen.model.key, name: chosen.model.name, label: chosen.model.label, query: chosen.model.query, assets: chosen.model.assets, bytes: browserBytes(chosen.model) } : null, chunks: chunks.map(({ section, url, title, heading, text }) => ({ section, url, title, heading, text })) };
  emit(`search/${lang}-chunks.json`, JSON.stringify(data));
  quality.languages[lang] = { chunks: chunks.length, sections: new Set(chunks.map((c) => c.section)).size, semantic: loaded.length > 0, shipped: chosen ? chosen.model.key : null, shippedMode: chosen ? chosen.model.hybrid : "bm25", metrics: result, rows };
  const limits = (evalSet.thresholds || {})[lang] || {};
  for (const [mode, lim] of Object.entries(limits)) {
    if (!result[mode]) continue;
    for (const [k, v] of Object.entries(lim)) if (result[mode][k] + 1e-9 < v) searchFailures.push(`${lang} ${mode} ${k} = ${result[mode][k].toFixed(3)}, below the threshold ${v}`);
  }
  console.log(`Ask the course (${lang}): ${chunks.length} chunks, ${modes.map((m) => `${m} hit@1 ${result[m].hit1.toFixed(2)} hit@3 ${result[m].hit3.toFixed(2)} MRR ${result[m].mrr.toFixed(2)}`).join("; ")}${chosen ? `; ships ${chosen.model.key}` : ""}`);
}
quality.claims = { verified: claimTotals.ok, lessons: claimTotals.lessons };
quality.runtime = runtime && runtime.outputsMeta ? { date: runtime.outputsMeta.date, python: runtime.outputsMeta.python, checks: runtime.outputsMeta.checks, minilm: runtime.minilm, e5: runtime.e5 } : null;
emit("quality.json", JSON.stringify(quality));
const pct = (x) => (x * 100).toFixed(0) + "%";
const qval = (path) => {
  const [lang, mode, metric] = path.split(".");
  const m = quality.languages[lang] && quality.languages[lang].metrics[mode];
  return m ? (metric === "mrr" ? m.mrr.toFixed(2) : pct(m[metric])) : "n/a";
};
for (const lang of LANGS) {
  const L = lang;
  const name = "quality.html";
  const modeName = (m) => t(L, `q.mode.${m}`);
  const bar = (v) => `<span class="qbar" aria-hidden="true"><span style="width:${(v * 100).toFixed(1)}%"></span></span>`;
  const langBlocks = LANGS.map((l) => {
    const q = quality.languages[l];
    const modes = Object.keys(q.metrics);
    const rows = modes.map((m) => `<tr><th scope="row">${modeName(m)}</th>${["hit1", "hit3", "mrr"].map((k) => `<td><span class="qcell">${k === "mrr" ? q.metrics[m][k].toFixed(2) : pct(q.metrics[m][k])}${bar(q.metrics[m][k])}</span></td>`).join("")}</tr>`).join("");
    const detail = q.rows.map((r) => `<tr><td>${esc(r.query)}</td><td>${r.expect.map(esc).join("<br>")}</td>${modes.map((m) => `<td class="num">${r.ranks[m] ? r.ranks[m] : "—"}</td>`).join("")}</tr>`).join("");
    return `<section class="group-card" aria-labelledby="q-${l}-h"><h3 id="q-${l}-h">${dict[l]["lang.name"]}</h3><p class="hint">${t(L, "q.search.counts", { chunks: q.chunks, sections: q.sections })}${q.semantic ? "" : " " + t(L, "q.search.noSemantic")}${q.shipped ? " " + t(L, "q.search.shipped", { mode: modeName(q.shippedMode) }) : ""}</p>
<div class="table-wrap" tabindex="0"><table class="qtable"><thead><tr><th scope="col">${t(L, "q.mode")}</th><th scope="col">hit@1</th><th scope="col">hit@3</th><th scope="col">MRR</th></tr></thead><tbody>${rows}</tbody></table></div>
<details class="qdetail"><summary>${t(L, "q.search.perQuery", { n: q.rows.length })}</summary><div class="table-wrap" tabindex="0"><table><thead><tr><th scope="col">${t(L, "q.query")}</th><th scope="col">${t(L, "q.expected")}</th>${modes.map((m) => `<th scope="col" class="num">${modeName(m)}</th>`).join("")}</tr></thead><tbody>${detail}</tbody></table></div><p class="hint">${t(L, "q.rankHint")}</p></details></section>`;
  }).join("");
  const rt = quality.runtime;
  const parity = rt ? Object.entries(rt.checks).map(([k, v]) => `<tr><td><code>${esc(k.split("/").pop())}</code></td><td>${esc(v === "identical" ? t(L, "q.parity.identical") : v === "real" ? t(L, "q.parity.real") : Number(v.replace("within ", "")) === 0 ? t(L, "q.parity.zero") : t(L, "q.parity.within", { d: v.replace("within ", "") }))}</td></tr>`).join("") : "";
  const body = `<main id="content" class="main quality-page" tabindex="-1">
<a class="crumb" href="index.html">${ICON.back}<span>${t(L, "nav.home")}</span></a>
<p class="eyebrow"><span>${t(L, "q.eyebrow")}</span><span class="dot" aria-hidden="true"></span><span>${t(L, "q.date", { date: quality.date })}</span></p>
<h1>${t(L, "q.title")}</h1>
<p class="lede">${t(L, "q.lede")}</p>
<div class="stat-row">
<div class="card stat"><span>${t(L, "q.stat.search")}</span><strong>${qval(`${lang}.${quality.languages[lang].shippedMode}.hit3`)}</strong><small>${t(L, "q.stat.search.hint", { mode: modeName(quality.languages[lang].shippedMode), n: quality.queries })}</small></div>
<div class="card stat"><span>${t(L, "q.stat.claims")}</span><strong>${quality.claims.verified}</strong><small>${t(L, "q.stat.claims.hint", { n: quality.claims.lessons })}</small></div>
${rt && rt.minilm ? `<div class="card stat"><span>${t(L, "q.stat.minilm")}</span><strong>${rt.minilm.max_cosine_difference.toFixed(4)}</strong><small>${t(L, "q.stat.minilm.hint")}</small></div>` : ""}
</div>
<section id="search-quality" aria-labelledby="sq-h"><h2 id="sq-h">${t(L, "q.search")}</h2><p>${t(L, "q.search.body")}</p>${langBlocks}<p class="hint">${t(L, "q.search.gate")}</p></section>
<section id="claims" aria-labelledby="cl-h"><h2 id="cl-h">${t(L, "q.claims")}</h2><p>${t(L, "q.claims.body", { n: quality.claims.verified, lessons: quality.claims.lessons })}</p></section>
${rt ? `<section id="parity" aria-labelledby="pa-h"><h2 id="pa-h">${t(L, "q.parity")}</h2><p>${t(L, "q.parity.body", { python: rt.python, date: rt.date })}</p><div class="table-wrap" tabindex="0"><table><thead><tr><th scope="col">${t(L, "q.parity.script")}</th><th scope="col">${t(L, "q.parity.result")}</th></tr></thead><tbody>${parity}</tbody></table></div>${rt.minilm ? `<p>${t(L, "q.minilm.body", { d: rt.minilm.max_cosine_difference.toFixed(5), w: rt.minilm.weights })}</p>` : ""}${rt.e5 ? `<p>${t(L, "q.e5.body", { d: rt.e5.max_cosine_difference.toFixed(5), w: rt.e5.weights, v: rt.e5.vocab_size, exact: rt.e5.tokenizer_exact, n: rt.e5.tokenizer_checked })}</p>` : ""}</section>` : `<p class="notice">${t(L, "q.noRuntime")}</p>`}
<p><a href="case-study.html">${t(L, "q.caseStudy")}</a> · <a href="${REPO}/blob/${BRANCH}/tests/search-eval.json" rel="noopener">${t(L, "q.evalSet")}</a></p>
</main>`;
  emit(outPath(lang, name), page({ lang, name, title: t(L, "q.title"), desc: t(L, "q.lede"), body, kind: "quality", ogType: "website" }));

  const csFile = join(src, "pages", lang === DEFAULT_LANG ? "case-study.md" : `${lang}/case-study.md`);
  const cs = parseFront(readFileSync(csFile, "utf8").replace(/\{\{q:([\w.-]+)\}\}/g, (_, k) => k === "claims" ? String(quality.claims.verified) : k === "minilm" ? (rt && rt.minilm ? rt.minilm.max_cosine_difference.toFixed(4) : "n/a") : k === "queries" ? String(quality.queries) : /\.shipped$/.test(k) ? (quality.languages[k.split(".")[0]].shipped ? modeName(quality.languages[k.split(".")[0]].shippedMode) : modeName("bm25")) : qval(k)), csFile);
  const { html: csHtml, toc: csToc } = render(cs.body, L);
  const csName = "case-study.html";
  const csBody = `<div class="layout"><aside class="side">${tocHtml(csToc, L)}</aside><main id="content" class="main lesson note case-study" tabindex="-1">
<a class="crumb" href="index.html">${ICON.back}<span>${t(L, "nav.home")}</span></a><p class="eyebrow"><span>${t(L, "cs.eyebrow")}</span></p><h1>${esc(cs.data.title)}</h1><p class="lede">${esc(cs.data.summary)}</p>${tocHtml(csToc, L, true)}<div class="prose">${csHtml}</div></main></div>`;
  emit(outPath(lang, csName), page({ lang, name: csName, title: String(cs.data.title), desc: String(cs.data.summary), body: csBody, kind: "page", hasMermaid: csHtml.includes('class="mermaid"'), ogType: "article" }));
}
if (searchFailures.length) {
  console.error(searchFailures.join("\n"));
  throw new Error("Ask the course quality regressed or its vectors are out of date.");
}

const legacy = courses.find((c) => c.id === LEGACY_COURSE);
if (legacy) {
  const targets = [...legacy.lessons.map((l) => l.slug), ...legacy.notes.map((n) => `note-${n.slug}`)];
  for (const lang of LANGS) {
    for (const slug of targets) {
      const name = `${slug}.html`;
      const target = `${LEGACY_COURSE}/${slug}.html`;
      emit(outPath(lang, name), `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(t(lang, "redirect.moved"))}</title><link rel="canonical" href="${SITE_URL + outPath(lang, target)}"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0; url=${target}"><script>location.replace(${JSON.stringify(target)}+location.hash)</script></head><body><main id="content"><h1>${esc(t(lang, "redirect.moved"))}</h1><p><a href="${target}">${esc(t(lang, "redirect.go"))}</a></p></main></body></html>`);
    }
  }
}

if (claimErrors.length) {
  console.error(claimErrors.join("\n"));
  throw new Error(`${claimErrors.length} lesson claims no longer match their exercises. Update the lesson text and courses/<course>/claims.json.`);
}
rmSync(join(out, "vendor"), { recursive: true, force: true });
for (const f of ["style.css", "app.js", "runner.js", "pyclient.js", "ask.js", "search-core.mjs", "manifest.webmanifest"]) {
  copyFileSync(join(src, f), join(out, f));
  files.push(f);
}
mkdirSync(join(out, "labs"), { recursive: true });
for (const f of readdirSync(join(src, "labs")).filter((x) => x.endsWith(".js"))) {
  copyFileSync(join(src, "labs", f), join(out, "labs", f));
  files.push("labs/" + f);
}
mkdirSync(join(out, "icons"), { recursive: true });
for (const f of readdirSync(join(src, "icons"))) {
  copyFileSync(join(src, "icons", f), join(out, "icons", f));
  files.push("icons/" + f);
}
mkdirSync(join(out, "vendor"), { recursive: true });
copyFileSync(join(root, "node_modules/mermaid/dist/mermaid.min.js"), join(out, "vendor/mermaid.min.js"));
files.push("vendor/mermaid.min.js");
buildSync({ entryPoints: [join(src, "visuals", "scenes.mjs")], bundle: true, format: "esm", minify: true, target: "es2020", outfile: join(out, "visuals.js"), legalComments: "none", logLevel: "warning" });
files.push("visuals.js");

const publicConfigFile = join(src, "public-config.json");
const publicConfig = existsSync(publicConfigFile) ? JSON.parse(readFileSync(publicConfigFile, "utf8")) : {};
const config = { supabaseUrl: env.SUPABASE_URL || publicConfig.supabaseUrl || "", supabaseAnonKey: env.SUPABASE_ANON_KEY || publicConfig.supabaseAnonKey || "", supabaseTable: env.SUPABASE_TABLE || publicConfig.supabaseTable || "learning_items" };
if (/service_role|sb_secret_/.test(config.supabaseAnonKey)) throw new Error("Refusing to build: the Supabase key looks like a secret key. Use the anon or publishable key.");
emit("config.js", `window.__CONFIG=${JSON.stringify(config)};\n`);

const sitemapUrls = files.filter((f) => f.endsWith(".html") && !readFileSync(join(out, f), "utf8").includes('name="robots" content="noindex"')).map((f) => `<url><loc>${SITE_URL + f.replace(/(^|\/)index\.html$/, "$1")}</loc></url>`).join("\n");
emit("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapUrls}\n</urlset>\n`);
emit("robots.txt", `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}sitemap.xml\n`);

const hash = createHash("sha1");
for (const f of [...files].sort()) hash.update(f).update(readFileSync(join(out, f)));
const version = hash.digest("hex").slice(0, 10);
const precache = ["./", ...files.filter((f) => f !== "config.js").map((f) => "./" + f)];
writeFileSync(join(out, "sw.js"), readFileSync(join(src, "sw.js"), "utf8").replace("__VERSION__", version).replace("__RUNTIME__", runtime ? runtime.version : "none").replace("__FILES__", JSON.stringify(precache)));
writeFileSync(join(out, ".nojekyll"), "");

function walk(dir) {
  return readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
}
const keep = new Set([...files, ...runtimeFiles, "sw.js", ".nojekyll"]);
for (const f of walk(out)) {
  const relName = f.slice(out.length + 1).replace(/\\/g, "/");
  if (!keep.has(relName)) rmSync(f);
}
if (runtime && existsSync(join(out, "runtime"))) {
  for (const d of readdirSync(join(out, "runtime"))) if (d !== runtime.version) rmSync(join(out, "runtime", d), { recursive: true, force: true });
}
const lessonCount = courses.reduce((s, c) => s + c.lessons.length, 0);
console.log(runtime ? `Python runtime ${runtime.version}: Python ${runtime.manifest.python}, packages [${runtime.manifest.packages.join(", ") || "none"}], assets [${Object.keys(runtime.manifest.assets).join(", ") || "none"}]${runtime.outputsMeta ? ", reference outputs" : ""}` : "Python runtime: not available (run npm install)");
console.log(`Built ${courses.length} course(s), ${lessonCount} lessons, ${LANGS.length} languages, ${files.length} files, version ${version}${config.supabaseUrl ? ", sync configured" : ", sync not configured"}`);
