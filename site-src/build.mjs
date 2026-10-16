import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, rmSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
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

const dict = Object.fromEntries(LANGS.map((l) => [l, JSON.parse(readFileSync(join(src, "i18n", `${l}.json`), "utf8"))]));
const curriculum = JSON.parse(readFileSync(join(src, "curriculum.json"), "utf8"));
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
    if (lang !== DEFAULT_LANG && dict[DEFAULT_LANG][key] !== undefined) s = dict[DEFAULT_LANG][key];
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

function inlineMd(s) {
  return marked.parseInline(s.trim(), { gfm: true });
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
  const full = join(root, dir);
  if (!existsSync(full)) return [];
  return readdirSync(full).filter((f) => f.endsWith(".md")).sort().map((f) => {
    const { data, body } = parseFront(readFileSync(join(full, f), "utf8"), join(dir, f));
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

const lessons = loadContent("lessons-md", "lesson")
  .map((l) => ({ ...l, n: Number(l.versions.en.data.n), track: l.versions.en.data.area }))
  .sort((a, b) => a.n - b.n);
const notes = loadContent("notes-md", "note");
const lessonBySlug = new Map(lessons.map((l) => [l.slug, l]));
const noteBySlug = new Map(notes.map((n) => [n.slug, n]));

function pagePath(lang, name) {
  return lang === DEFAULT_LANG ? name : `${lang}/${name}`;
}
function relPrefix(lang) {
  return lang === DEFAULT_LANG ? "" : "../";
}
function altPath(lang, name) {
  const other = LANGS.find((l) => l !== lang);
  return relPrefix(lang) + pagePath(other, name);
}

function pick(entry, lang) {
  return entry.versions[lang] || entry.versions[DEFAULT_LANG];
}
function isTranslated(entry, lang) {
  return lang === DEFAULT_LANG || Boolean(entry.versions[lang]);
}

const files = [];
function emit(name, content) {
  const target = join(out, name);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  files.push(name);
}

function page({ lang, name, title, desc, body, kind, slug = "", hasMermaid = false, extra = {}, ogType = "article" }) {
  const rel = relPrefix(lang);
  const alt = altPath(lang, name);
  const pageData = { lang, kind, slug, name, rel, alt, siteUrl: SITE_URL, ...extra };
  const other = LANGS.find((l) => l !== lang);
  const L = lang;
  const tools = `<nav class="tools" aria-label="${attr(t(L, "nav.account"))}">
<a class="tool" href="${rel}index.html#search" aria-label="${attr(t(L, "nav.search"))}"><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><span class="tool-label">${t(L, "nav.search")}</span></a>
<a class="tool lang" href="${alt}" hreflang="${other}" lang="${other}" data-set-lang="${other}" title="${attr(t(L, "lang.switch"))}" aria-label="${attr(t(L, "lang.switch"))}"><span class="lang-code">${other.toUpperCase()}</span></a>
<details class="menu" id="theme-menu"><summary class="tool" aria-label="${attr(t(L, "nav.theme"))}" title="${attr(t(L, "nav.theme"))}"><svg aria-hidden="true" viewBox="0 0 24 24" class="icon-theme"><circle cx="12" cy="12" r="4.5"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/></svg></summary><div class="menu-panel" role="group" aria-label="${attr(t(L, "nav.theme"))}">
<button type="button" data-theme-choice="light" aria-pressed="false">${t(L, "theme.light")}</button>
<button type="button" data-theme-choice="dark" aria-pressed="false">${t(L, "theme.dark")}</button>
<button type="button" data-theme-choice="system" aria-pressed="true">${t(L, "theme.system")}</button>
</div></details>
<button type="button" class="tool account" id="account-btn" aria-haspopup="dialog" aria-label="${attr(t(L, "nav.account"))}"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7 18.5h10a4.5 4.5 0 0 0 .6-8.96A6 6 0 0 0 6.1 11.2 3.7 3.7 0 0 0 7 18.5z"/></svg><span class="sync-dot" id="sync-dot" data-sync="local" aria-hidden="true"></span><span class="tool-label" id="sync-label">${t(L, "sync.local")}</span></button>
</nav>`;
  const dialogs = `<dialog id="account-dialog" class="dialog" aria-labelledby="account-title">
<form method="dialog" class="dialog-head"><h2 id="account-title">${t(L, "account.title")}</h2><button type="submit" class="dialog-close" aria-label="Close">&times;</button></form>
<div class="dialog-body" id="account-body"></div>
</dialog>
<dialog id="merge-dialog" class="dialog" aria-labelledby="merge-title">
<div class="dialog-head"><h2 id="merge-title">${t(L, "merge.title")}</h2></div>
<div class="dialog-body"><p>${t(L, "merge.body")}</p>
<div class="choice-list">
<button type="button" class="choice" data-merge="merge"><strong>${t(L, "merge.merge")}</strong><span>${t(L, "merge.merge.hint")}</span></button>
<button type="button" class="choice" data-merge="cloud"><strong>${t(L, "merge.cloud")}</strong><span>${t(L, "merge.cloud.hint")}</span></button>
<button type="button" class="choice" data-merge="local"><strong>${t(L, "merge.local")}</strong></button>
</div></div></dialog>`;
  const canonical = SITE_URL + pagePath(lang, name);
  const altLinks = LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${SITE_URL + pagePath(l, name)}">`).join("\n") + `\n<link rel="alternate" hreflang="x-default" href="${SITE_URL + pagePath(DEFAULT_LANG, name)}">`;
  return shell
    .replace(/{{LANG}}/g, lang)
    .replace(/{{TITLE}}/g, esc(title))
    .replace(/{{SITE}}/g, esc(t(L, "site.name")))
    .replace(/{{DESC}}/g, esc(desc))
    .replace(/{{REL}}/g, rel)
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
    .replace("{{BODY}}", body);
}

function tocHtml(toc, L) {
  if (!toc.length) return "";
  const items = toc.map((x) => `<li class="l${x.level}"><a href="#${x.id}">${esc(x.text)}</a></li>`).join("");
  return `<nav class="toc" aria-label="${attr(t(L, "lesson.toc"))}"><details id="toc-details" open><summary>${t(L, "lesson.toc")}</summary><ol>${items}</ol></details></nav>`;
}

function lessonLink(lang, slug) {
  const l = lessonBySlug.get(slug);
  if (!l) throw new Error(`Unknown lesson reference ${slug}`);
  return `<a href="${slug}.html">${l.n}. ${esc(pick(l, lang).data.title)}</a>`;
}

const trackByKey = new Map(curriculum.tracks.map((x) => [x.key, x]));
const searchIndex = Object.fromEntries(LANGS.map((l) => [l, []]));

for (const lang of LANGS) {
  const L = lang;
  lessons.forEach((lesson, i) => {
    const v = pick(lesson, lang);
    const d = v.data;
    const { stripped, questions } = extractQuiz(v.body);
    const { html, toc } = render(stripped, L);
    const prev = lessons[i - 1];
    const next = lessons[i + 1];
    const track = trackByKey.get(lesson.track);
    const level = d.level || "core";
    const prereqs = d.prereqs ? String(d.prereqs).split(",").map((s) => s.trim()).filter(Boolean) : [];
    const noteSlug = d.note && noteBySlug.has(d.note) ? d.note : null;
    const notices = [];
    if (d.regenerated) notices.push(`<aside class="notice" role="note">${t(L, "lesson.regenerated")}</aside>`);
    if (!isTranslated(lesson, lang)) notices.push(`<aside class="notice" role="note" lang="${lang}">${t(L, "lesson.untranslated")}</aside>`);

    let quiz = "";
    if (questions.length) {
      toc.push({ level: 2, id: "knowledge-check", text: t(L, "lesson.quiz") });
      quiz = `<section class="quiz" id="knowledge-check" aria-labelledby="quiz-h"><h2 id="quiz-h">${t(L, "lesson.quiz")}</h2><p class="hint">${t(L, "lesson.quiz.hint")}</p><ol class="quiz-list">${questions.map((q, qi) => `<li class="quiz-item" data-q="${qi}"><div class="quiz-q">${inlineMd(q.q)}</div><details class="quiz-a"><summary>${t(L, "lesson.quiz.show")}</summary><div class="quiz-answer">${marked.parse(q.a, { gfm: true })}</div><div class="quiz-grade" role="group"><button type="button" class="chip" data-grade="ok" aria-pressed="false">${t(L, "lesson.quiz.ok")}</button><button type="button" class="chip" data-grade="review" aria-pressed="false">${t(L, "lesson.quiz.review")}</button><span class="quiz-state" aria-live="polite"></span></div></details></li>`).join("")}</ol></section>`;
    }

    let exercise = "";
    if (d.exercise) {
      const path = String(d.exercise);
      const code = readFileSync(join(root, path), "utf8");
      const lines = code.split("\n").length - (code.endsWith("\n") ? 1 : 0);
      toc.push({ level: 2, id: "exercise", text: t(L, "lesson.exercise") });
      exercise = `<section class="exercise" id="exercise" aria-labelledby="exercise-h"><h2 id="exercise-h">${t(L, "lesson.exercise")}</h2>
<p>${t(L, "lesson.exercise.run")}</p>${codeBlock(`.\\.venv\\Scripts\\python.exe ${path.replace(/\//g, "\\")}`, "powershell", "PowerShell", L)}${codeBlock(`.venv/bin/python ${path}`, "bash", "bash", L)}
<p><a class="btn" href="${REPO}/blob/${BRANCH}/${path}" rel="noopener">${t(L, "lesson.exercise.open")}</a></p>
<details class="source"><summary>${t(L, "lesson.exercise.show", { n: lines })}</summary>${codeBlock(code, "python", path, L)}</details></section>`;
    }
    toc.push({ level: 2, id: "my-notes", text: t(L, "lesson.notes") });

    const nextSteps = [];
    if (next) nextSteps.push(`<li><span class="muted">${t(L, "lesson.next.lesson")}</span> ${lessonLink(lang, next.slug)}</li>`);
    if (noteSlug) nextSteps.push(`<li><span class="muted">${t(L, "lesson.next.note")}</span> <a href="note-${noteSlug}.html">${esc(pick(noteBySlug.get(noteSlug), lang).data.title)}</a></li>`);

    const body = `<div class="layout"><aside class="side">${tocHtml(toc, L)}</aside>
<main id="content" class="main lesson" data-slug="${lesson.slug}" tabindex="-1">
<p class="eyebrow"><span>${t(L, "lesson.label", { n: lesson.n })}</span><span class="dot" aria-hidden="true"></span><span>${esc(track.name[lang])}</span><span class="dot" aria-hidden="true"></span><span>${t(L, "lesson.minutes", { n: d.minutes || 25 })}</span><span class="dot" aria-hidden="true"></span><span>${t(L, `lesson.level.${level}`)}</span></p>
<h1>${esc(d.title)}</h1>
<p class="lede">${esc(d.summary)}</p>
<div class="lesson-actions">
<button type="button" class="act" id="done-btn" aria-pressed="false"><span class="box" aria-hidden="true"></span><span class="label">${t(L, "lesson.done")}</span></button>
<button type="button" class="act" id="bookmark-btn" aria-pressed="false"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 3h12v18l-6-4.5L6 21z"/></svg><span class="label">${t(L, "lesson.bookmark")}</span></button>
</div>
${prereqs.length ? `<p class="prereqs"><span class="muted">${t(L, "lesson.prereqs")}:</span> ${prereqs.map((p) => lessonLink(lang, p)).join(", ")}</p>` : ""}
${notices.join("\n")}
${html}
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
${prev ? `<a class="prev" href="${prev.slug}.html" rel="prev"><small>${t(L, "lesson.prev")}</small><span>${prev.n}. ${esc(pick(prev, lang).data.title)}</span></a>` : `<a class="prev" href="index.html"><small>${t(L, "lesson.back")}</small><span>${t(L, "lesson.nextAll")}</span></a>`}
${next ? `<a class="next" href="${next.slug}.html" rel="next"><small>${t(L, "lesson.nextShort")}</small><span>${next.n}. ${esc(pick(next, lang).data.title)}</span></a>` : `<a class="next" href="index.html"><small>${t(L, "lesson.nextAll")}</small><span>${t(L, "nav.home")}</span></a>`}
</nav></main></div>`;
    emit(pagePath(lang, `${lesson.slug}.html`), page({ lang, name: `${lesson.slug}.html`, title: `${lesson.n}. ${d.title}`, desc: String(d.summary), body, kind: "lesson", slug: lesson.slug, hasMermaid: html.includes('class="mermaid"'), extra: { n: lesson.n, title: d.title, minutes: Number(d.minutes || 25), quiz: questions.length } }));
    searchIndex[lang].push({ slug: lesson.slug, url: `${lesson.slug}.html`, kind: "lesson", n: lesson.n, title: d.title, summary: d.summary, headings: toc.filter((x) => x.level <= 3).map((x) => ({ id: x.id, text: x.text })) });
  });

  for (const note of notes) {
    const v = pick(note, lang);
    const { html, toc } = render(v.body, L);
    const notices = isTranslated(note, lang) ? "" : `<aside class="notice" role="note">${t(L, "lesson.untranslated")}</aside>`;
    const body = `<div class="layout"><aside class="side">${tocHtml(toc, L)}</aside><main id="content" class="main lesson note" tabindex="-1">
<p class="eyebrow"><span>${t(L, "note.label")}</span></p><h1>${esc(v.data.title)}</h1><p class="lede">${esc(v.data.summary)}</p>${notices}${html}
<nav class="pager" aria-label="${attr(t(L, "nav.home"))}"><a class="prev" href="index.html"><small>${t(L, "lesson.back")}</small><span>${t(L, "lesson.nextAll")}</span></a><span></span></nav></main></div>`;
    emit(pagePath(lang, `note-${note.slug}.html`), page({ lang, name: `note-${note.slug}.html`, title: String(v.data.title), desc: String(v.data.summary), body, kind: "note", slug: `note-${note.slug}`, hasMermaid: html.includes('class="mermaid"'), extra: { title: v.data.title } }));
    searchIndex[lang].push({ slug: `note-${note.slug}`, url: `note-${note.slug}.html`, kind: "note", title: v.data.title, summary: v.data.summary, headings: toc.map((x) => ({ id: x.id, text: x.text })) });
  }

  const totalMinutes = lessons.reduce((s, l) => s + Number(pick(l, lang).data.minutes || 25), 0);
  const trackSections = curriculum.tracks.map((track) => {
    const items = lessons.filter((l) => l.track === track.key);
    const planned = curriculum.planned.filter((p) => p.track === track.key);
    const rows = items.map((l) => {
      const d = pick(l, lang).data;
      return `<li><a class="row" href="${l.slug}.html" data-slug="${l.slug}" data-minutes="${d.minutes || 25}" data-title="${attr(d.title)}"><span class="num" aria-hidden="true">${l.n}</span><span class="txt"><span class="row-title">${esc(d.title)}</span><span class="row-sum">${esc(d.summary)}</span><span class="row-meta"><span>${t(L, "lesson.minutes", { n: d.minutes || 25 })}</span><span class="dot" aria-hidden="true"></span><span>${t(L, `lesson.level.${d.level || "core"}`)}</span></span></span><span class="state" data-state="new">${t(L, "status.new")}</span></a></li>`;
    });
    const plannedRows = planned.map((p) => `<li class="planned"><div class="row" aria-disabled="true"><span class="num" aria-hidden="true">&middot;</span><span class="txt"><span class="row-title">${esc(p.title[lang])}</span><span class="row-sum">${esc(p.summary[lang])}</span></span><span class="state" data-state="planned">${t(L, "status.planned")}</span></div></li>`);
    return `<section class="track" id="track-${track.key}" aria-labelledby="track-${track.key}-h" data-track="${track.key}">
<h3 id="track-${track.key}-h"><span class="letter" aria-hidden="true">${track.key}</span>${esc(track.name[lang])}</h3>
<p class="blurb">${esc(track.blurb[lang])}</p>
${rows.length ? `<ol class="lesson-list">${rows.join("")}</ol>` : `<p class="empty">${t(L, "home.track.empty")}</p>`}
${plannedRows.length ? `<details class="planned-list"><summary>${t(L, "home.planned")} (${plannedRows.length})</summary><p class="hint">${t(L, "home.planned.hint")}</p><ol class="lesson-list">${plannedRows.join("")}</ol></details>` : ""}
</section>`;
  }).join("\n");

  const noteList = notes.length ? `<section class="notes-section" id="notes" aria-labelledby="notes-h"><h2 id="notes-h">${t(L, "home.notes")}</h2><p class="hint">${t(L, "home.notes.hint")}</p><ul class="note-list">${notes.map((n) => `<li><a class="row" href="note-${n.slug}.html"><span class="txt"><span class="row-title">${esc(pick(n, lang).data.title)}</span><span class="row-sum">${esc(pick(n, lang).data.summary)}</span></span></a></li>`).join("")}</ul></section>` : "";

  const lessonMeta = lessons.map((l) => ({ slug: l.slug, n: l.n, title: pick(l, lang).data.title, minutes: Number(pick(l, lang).data.minutes || 25), quiz: extractQuiz(pick(l, lang).body).questions.length }));

  const home = `<main id="content" class="main home" tabindex="-1">
<header class="hero"><p class="eyebrow"><span>${esc(t(L, "site.tagline"))}</span></p><h1>${t(L, "site.name")}</h1><p class="lede">${t(L, "home.intro")}</p></header>
<section class="continue" id="continue" aria-labelledby="continue-h"><h2 id="continue-h">${t(L, "home.continue")}</h2>
<div class="continue-card" id="continue-card"><p class="progress" id="progress"><span id="progress-text">${t(L, "home.progress", { done: 0, total: lessons.length })}</span><span class="bar" aria-hidden="true"><span id="progress-fill" style="width:0%"></span></span><span class="muted" id="progress-time">${t(L, "home.progress.time", { minutes: totalMinutes })}</span></p><div id="continue-body"></div></div></section>
<section class="review" id="review" aria-labelledby="review-h" hidden><h2 id="review-h">${t(L, "home.review")}</h2><p class="hint">${t(L, "home.review.hint")}</p><ul class="review-list" id="review-list"></ul></section>
<section class="catalog" id="catalog" aria-labelledby="catalog-h"><h2 id="catalog-h">${t(L, "home.catalog")}</h2>
<div class="catalog-tools"><div class="search" id="search"><label for="search-input" class="sr">${t(L, "home.search.label")}</label><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="search-input" type="search" placeholder="${attr(t(L, "home.search.placeholder"))}" autocomplete="off"></div>
<div class="filters" role="group" aria-label="${attr(t(L, "home.catalog"))}"><button type="button" class="chip" data-filter="all" aria-pressed="true">${t(L, "home.filter.all")}</button><button type="button" class="chip" data-filter="todo" aria-pressed="false">${t(L, "home.filter.todo")}</button><button type="button" class="chip" data-filter="progress" aria-pressed="false">${t(L, "home.filter.progress")}</button><button type="button" class="chip" data-filter="done" aria-pressed="false">${t(L, "home.filter.done")}</button><button type="button" class="chip" data-filter="saved" aria-pressed="false">${t(L, "home.filter.saved")}</button></div></div>
<div class="search-results" id="search-results" hidden><h3>${t(L, "home.search.results")}</h3><ul id="search-hits"></ul></div>
<p class="empty" id="filter-empty" hidden>${t(L, "home.filter.empty")}</p>
${trackSections}
</section>
${noteList}
<section class="data" id="data" aria-labelledby="data-h"><h2 id="data-h">${t(L, "home.data")}</h2><p class="hint">${t(L, "home.data.hint")}</p><div class="data-actions"><button type="button" class="btn" id="open-account">${t(L, "account.title")}</button><button type="button" class="btn" data-action="export">${t(L, "account.export")}</button><button type="button" class="btn" data-action="export-md">${t(L, "account.exportMd")}</button><label class="btn file"><input type="file" accept="application/json,.json" id="import-file" class="sr">${t(L, "account.import")}</label></div><p class="status" id="data-status" aria-live="polite"></p></section>
</main>`;
  emit(pagePath(lang, "index.html"), page({ lang, name: "index.html", title: t(L, "site.name"), desc: t(L, "site.description"), body: home, kind: "home", ogType: "website", extra: { lessons: lessonMeta } }));
  emit(pagePath(lang, "search.json"), JSON.stringify(searchIndex[lang]));
}

rmSync(join(out, "vendor"), { recursive: true, force: true });
for (const f of ["style.css", "app.js", "manifest.webmanifest"]) {
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

const config = { supabaseUrl: env.SUPABASE_URL || "", supabaseAnonKey: env.SUPABASE_ANON_KEY || "", supabaseTable: env.SUPABASE_TABLE || "learning_items" };
emit("config.js", `window.__CONFIG=${JSON.stringify(config)};\n`);

const sitemapUrls = files.filter((f) => f.endsWith(".html")).map((f) => `<url><loc>${SITE_URL + f.replace(/(^|\/)index\.html$/, "$1")}</loc></url>`).join("\n");
emit("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapUrls}\n</urlset>\n`);
emit("robots.txt", `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}sitemap.xml\n`);

const hash = createHash("sha1");
for (const f of [...files].sort()) hash.update(f).update(readFileSync(join(out, f)));
const version = hash.digest("hex").slice(0, 10);
const precache = ["./", ...files.filter((f) => f !== "config.js").map((f) => "./" + f)];
writeFileSync(join(out, "sw.js"), readFileSync(join(src, "sw.js"), "utf8").replace("__VERSION__", version).replace("__FILES__", JSON.stringify(precache)));
writeFileSync(join(out, ".nojekyll"), "");

for (const old of readdirSync(out)) {
  if (old.endsWith(".html") && !files.includes(old)) rmSync(join(out, old));
}
console.log(`Built ${lessons.length} lessons, ${notes.length} notes, ${LANGS.length} languages, ${files.length} files, version ${version}${config.supabaseUrl ? ", sync configured" : ", sync not configured"}`);
