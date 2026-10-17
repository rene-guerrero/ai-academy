import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, rmSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";
import hljs from "highlight.js";

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
    return { id, dir, meta, lessons, notes, tracks: new Map(meta.tracks.map((x) => [x.key, x])) };
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
    .replace(/{{LANG}}/g, lang)
    .replace(/{{TITLE}}/g, esc(title))
    .replace(/{{SITE}}/g, esc(t(L, "site.name")))
    .replace(/{{DESC}}/g, esc(desc))
    .replace(/{{REL}}/g, rel)
    .replace(/{{HOME}}/g, rel + langPrefix(lang) + "index.html")
    .replace(/{{CANONICAL}}/g, canonical)
    .replace("{{ALTLINKS}}", altLinks)
    .replace("{{OGTYPE}}", ogType)
    .replace("{{OGLOCALE}}", lang === "es" ? "es_ES" : "en_US")
    .replace("{{OGIMAGE}}", SITE_URL + "icons/icon-512.png")
    .replace("{{PAGEDATA}}", JSON.stringify(pageData))
    .replace("{{DICT}}", JSON.stringify(dict[lang]))
    .replace("{{KIND}}", kind)
    .replace("{{SKIP}}", t(L, "nav.skip"))
    .replace("{{TOOLS}}", tools)
    .replace("{{DIALOGS}}", dialogs)
    .replace("{{FOOTER}}", t(L, "site.footer"))
    .replace("{{MERMAID}}", hasMermaid ? `<script src="${rel}vendor/mermaid.min.js" defer></script>` : "")
    .replace("{{RUNNER}}", extra.runtime ? `<script src="${rel}runner.js" defer></script>` : "")
    .replace("{{BODY}}", body);
}

function tocHtml(toc, L, inline = false) {
  if (!toc.length) return "";
  const items = toc.map((x) => `<li class="l${x.level}"><a href="#${x.id}">${esc(x.text)}</a></li>`).join("");
  return inline
    ? `<nav class="toc toc-inline" aria-label="${attr(t(L, "lesson.toc"))}"><details><summary>${t(L, "lesson.toc")}</summary><ol>${items}</ol></details></nav>`
    : `<nav class="toc" aria-label="${attr(t(L, "lesson.toc"))}"><details open><summary>${t(L, "lesson.toc")}</summary><ol>${items}</ol></details></nav>`;
}

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
      const { stripped, questions } = extractQuiz(v.body);
      const { html, toc } = render(stripped, L);
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
<div class="runner-bar"><button type="button" class="btn primary" data-run><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7 4.5v15l12-7.5z"/></svg>${t(L, "runner.run")}</button><button type="button" class="btn" data-stop hidden><svg aria-hidden="true" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>${t(L, "runner.stop")}</button><button type="button" class="btn" data-edit aria-pressed="false">${t(L, "runner.edit")}</button><button type="button" class="btn" data-reset hidden>${t(L, "runner.reset")}</button><span class="runner-edited" hidden>${t(L, "runner.edited")}</span></div>
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
      if (noteSlug) nextSteps.push(`<li><span class="muted">${t(L, "lesson.next.note")}</span> <a href="note-${noteSlug}.html">${esc(pick(noteBySlug.get(noteSlug), lang).data.title)}</a></li>`);

      const body = `<div class="layout"><aside class="side">${tocHtml(toc, L)}</aside>
<main id="content" class="main lesson" data-key="${lesson.key}" tabindex="-1">
${crumb}
<p class="eyebrow"><span>${t(L, "lesson.label", { n: lesson.n })}</span><span class="dot" aria-hidden="true"></span><span>${esc(track.name[lang])}</span><span class="dot" aria-hidden="true"></span><span>${t(L, "lesson.minutes", { n: d.minutes || 25 })}</span><span class="dot" aria-hidden="true"></span><span>${t(L, `lesson.level.${level}`)}</span></p>
<h1>${esc(d.title)}</h1>
<p class="lede">${esc(d.summary)}</p>
<div class="lesson-actions">
<button type="button" class="act" id="done-btn" aria-pressed="false"><span class="box" aria-hidden="true"></span><span class="label">${t(L, "lesson.done")}</span></button>
<button type="button" class="act" id="bookmark-btn" aria-pressed="false">${ICON.bookmark}<span class="label">${t(L, "lesson.bookmark")}</span></button>
</div>
${tocHtml(toc, L, true)}
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
${noteList}
</main>`;
    const cname = `${C}/index.html`;
    emit(outPath(lang, cname), page({ lang, name: cname, title: courseTitle, desc: course.meta.summary[lang], body: courseBody, kind: "course", course: C, ogType: "website", extra: { lessons: lessonMeta, searchScope: C } }));
  }
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
<header class="hero"><h1>${t(L, "site.name")}</h1><p class="lede">${t(L, "home.intro")}</p></header>
<section class="continue" id="continue" aria-labelledby="continue-h"><h2 id="continue-h">${t(L, "home.continue")}</h2><div class="card continue-card"><div id="continue-body"></div></div></section>
<section class="courses" id="courses" aria-labelledby="courses-h"><h2 id="courses-h">${t(L, "home.courses")}</h2><ul class="list">${courseRows}</ul></section>
<section class="review" id="review" aria-labelledby="review-h" hidden><h2 id="review-h">${t(L, "home.review")}</h2><p class="hint">${t(L, "home.review.hint")}</p><ul class="list" id="review-list"></ul></section>
<section class="global-search" id="search" aria-labelledby="search-h"><h2 id="search-h">${t(L, "nav.search")}</h2><div class="search"><label for="search-input" class="sr">${t(L, "home.search.label")}</label>${ICON.search}<input id="search-input" type="search" placeholder="${attr(t(L, "home.search.placeholder"))}" autocomplete="off"></div>
<div class="search-results card" id="search-results" hidden><ul id="search-hits"></ul></div></section>
<section class="data" id="data" aria-labelledby="data-h"><h2 id="data-h">${t(L, "home.data")}</h2><p class="hint">${t(L, "home.data.hint")}</p><div class="data-actions"><button type="button" class="btn" id="open-account">${t(L, "account.title")}</button><button type="button" class="btn" data-action="export">${t(L, "account.export")}</button><button type="button" class="btn" data-action="export-md">${t(L, "account.exportMd")}</button><label class="btn file"><input type="file" accept="application/json,.json" id="import-file" class="sr">${t(L, "account.import")}</label></div><p class="status" id="data-status" aria-live="polite"></p></section>
</main>`;
  emit(outPath(lang, "index.html"), page({ lang, name: "index.html", title: t(L, "site.name"), desc: t(L, "site.description"), body: home, kind: "home", ogType: "website", extra: { lessons: allLessonMeta[lang], courses: courses.map((c) => ({ id: c.id, title: c.meta.title[lang] || c.meta.title.en, total: c.lessons.length })), firstUrl: first ? `${courses[0].id}/${first.slug}.html` : "" } }));
  emit(outPath(lang, "search.json"), JSON.stringify(searchIndex[lang]));
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

rmSync(join(out, "vendor"), { recursive: true, force: true });
for (const f of ["style.css", "app.js", "runner.js", "manifest.webmanifest"]) {
  copyFileSync(join(src, f), join(out, f));
  files.push(f);
}
mkdirSync(join(out, "icons"), { recursive: true });
for (const f of readdirSync(join(src, "icons"))) {
  copyFileSync(join(src, "icons", f), join(out, "icons", f));
  files.push("icons/" + f);
}
mkdirSync(join(out, "vendor"), { recursive: true });
copyFileSync(join(root, "node_modules/mermaid/dist/mermaid.min.js"), join(out, "vendor/mermaid.min.js"));
files.push("vendor/mermaid.min.js");

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
