import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, rmSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";
import hljs from "highlight.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "site-src");
const out = join(root, "dist");
const REPO = process.env.REPO_URL || "https://github.com/rene-guerrero/ai-academy";
const BRANCH = process.env.REPO_BRANCH || "master";

const AREAS = {
  A: { name: "How modern AI works", blurb: "Tokens, embeddings, attention, transformers, training and generation." },
  B: { name: "LLM engineering", blurb: "Reliable applications: retrieval, prompting, structured output, evaluation, security." },
  C: { name: "Agents and agentic systems", blurb: "Tools, planning, state, MCP, orchestration and why agents fail." },
  D: { name: "ML and model development", blurb: "Datasets, training, fine-tuning, PyTorch, quantization." },
  E: { name: "AI systems engineering", blurb: "Serving, batching, caching, GPUs, cost, monitoring, deployment." },
  F: { name: "Research and future", blurb: "Breakthroughs, reasoning models, multimodal AI and open questions." },
};

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function parseFront(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new Error("Missing front matter");
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

const slugify = (s) => s.toLowerCase().replace(/<[^>]+>/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function highlight(code, lang) {
  if (lang && hljs.getLanguage(lang)) return hljs.highlight(code, { language: lang }).value;
  return esc(code);
}

function codeBlock(code, lang, label) {
  const l = lang || "text";
  return `<div class="code"><div class="code-bar"><span>${esc(label || l)}</span><button type="button" class="copy" aria-label="Copy code">Copy</button></div><pre><code class="hljs language-${esc(l)}">${highlight(code, lang)}</code></pre></div>`;
}

function render(body) {
  const toc = [];
  const used = new Set();
  const renderer = new marked.Renderer();
  renderer.code = (code, info) => {
    const lang = (info || "").split(/\s+/)[0];
    if (lang === "mermaid") return `<figure class="diagram"><pre class="mermaid" data-src="${esc(code)}">${esc(code)}</pre></figure>`;
    return codeBlock(code, lang);
  };
  renderer.heading = (text, level) => {
    let id = slugify(text) || "section";
    let n = 2;
    while (used.has(id)) id = `${slugify(text)}-${n++}`;
    used.add(id);
    if (level === 2 || level === 3) toc.push({ level, id, text: text.replace(/<[^>]+>/g, "") });
    return `<h${level} id="${id}"><a class="anchor" href="#${id}">${text}</a></h${level}>`;
  };
  renderer.table = (header, bodyHtml) => `<div class="table-wrap"><table><thead>${header}</thead><tbody>${bodyHtml}</tbody></table></div>`;
  const html = marked.parse(body, { renderer, gfm: true, breaks: false });
  return { html, toc };
}

function read(dir) {
  return readdirSync(join(root, dir)).filter((f) => f.endsWith(".md")).sort().map((f) => {
    const { data, body } = parseFront(readFileSync(join(root, dir, f), "utf8"));
    return { file: f, data, body };
  });
}

const lessons = read("lessons-md").map((x) => ({ ...x, kind: "lesson", n: Number(x.data.n), slug: x.file.replace(/\.md$/, "") })).sort((a, b) => a.n - b.n);
const notes = existsSync(join(root, "notes-md")) ? read("notes-md").map((x) => ({ ...x, kind: "note", slug: "note-" + x.file.replace(/\.md$/, "") })) : [];

const shell = readFileSync(join(src, "shell.html"), "utf8");

function page({ title, desc, body, bodyClass = "", hasMermaid = false, pageId = "" }) {
  return shell
    .replace(/{{TITLE}}/g, esc(title))
    .replace(/{{DESC}}/g, esc(desc))
    .replace("{{BODYCLASS}}", bodyClass)
    .replace("{{PAGEID}}", esc(pageId))
    .replace("{{MERMAID}}", hasMermaid ? `<script src="vendor/mermaid.min.js" defer></script>` : "")
    .replace("{{BODY}}", body);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "vendor"), { recursive: true });
mkdirSync(join(out, "icons"), { recursive: true });

const files = [];
function emit(name, content) {
  writeFileSync(join(out, name), content);
  files.push(name);
}

function tocHtml(toc) {
  if (!toc.length) return "";
  const items = toc.map((t) => `<li class="l${t.level}"><a href="#${t.id}">${esc(t.text)}</a></li>`).join("");
  return `<nav class="toc" aria-label="Table of contents"><details id="toc-details" open><summary>On this page</summary><ol>${items}</ol></details></nav>`;
}

const ordered = [...lessons];

lessons.forEach((l, i) => {
  const { html, toc } = render(l.body);
  const prev = ordered[i - 1];
  const next = ordered[i + 1];
  const area = AREAS[l.data.area];
  let exercise = "";
  if (l.data.exercise) {
    const path = String(l.data.exercise);
    const code = readFileSync(join(root, path), "utf8");
    exercise = `<section class="exercise" id="exercise"><h2><a class="anchor" href="#exercise">Exercise file</a></h2>
<p><a class="btn" href="${REPO}/blob/${BRANCH}/${path}" rel="noopener">View on GitHub</a></p>
<details><summary>Show the source (${code.split("\n").length - 1} lines)</summary>${codeBlock(code, "python", path)}</details></section>`;
    toc.push({ level: 2, id: "exercise", text: "Exercise file" });
  }
  toc.push({ level: 2, id: "my-notes", text: "My predictions" });
  const note = l.data.regenerated
    ? `<aside class="notice"><strong>Regenerated lesson.</strong> The original text of this lesson was not available. This page was rebuilt from the course summary and progress tracker. It will be replaced if the original is pasted.</aside>`
    : "";
  const body = `<article class="lesson" data-slug="${l.slug}">
<div class="layout"><aside class="side">${tocHtml(toc)}</aside>
<div class="main">
<p class="eyebrow">Lesson ${l.n} &middot; ${esc(l.data.area)} ${esc(area.name)} &middot; ${esc(l.data.minutes || "25")} min</p>
<h1>${esc(l.data.title)}</h1>
<p class="lede">${esc(l.data.summary)}</p>
${note}
${html}
${exercise}
<section class="mine" id="my-notes"><h2><a class="anchor" href="#my-notes">My predictions</a></h2>
<p class="hint">Write your predictions here before you run the exercise. They are saved in this browser only.</p>
<label class="sr" for="predictions">My predictions for lesson ${l.n}</label>
<textarea id="predictions" rows="7" placeholder="What do I expect to see, and why?"></textarea>
<p class="status" id="save-status" aria-live="polite"></p>
<button type="button" class="done-btn" id="done-btn" aria-pressed="false"><span class="box" aria-hidden="true"></span><span class="label">Mark as done</span></button>
</section>
<nav class="pager" aria-label="Lesson navigation">
${prev ? `<a class="prev" href="${prev.slug}.html"><small>Previous</small><span>${prev.n}. ${esc(prev.data.title)}</span></a>` : `<a class="prev" href="index.html"><small>Back</small><span>All lessons</span></a>`}
${next ? `<a class="next" href="${next.slug}.html"><small>Next</small><span>${next.n}. ${esc(next.data.title)}</span></a>` : `<a class="next" href="index.html"><small>Done for now</small><span>All lessons</span></a>`}
</nav></div></div></article>`;
  emit(`${l.slug}.html`, page({ title: `${l.n}. ${l.data.title}`, desc: String(l.data.summary), body, hasMermaid: html.includes('class="mermaid"'), pageId: l.slug }));
});

notes.forEach((nt) => {
  const { html, toc } = render(nt.body);
  const body = `<article class="lesson note"><div class="layout"><aside class="side">${tocHtml(toc)}</aside><div class="main">
<p class="eyebrow">Concept note</p><h1>${esc(nt.data.title)}</h1><p class="lede">${esc(nt.data.summary)}</p>${html}
<nav class="pager"><a class="prev" href="index.html"><small>Back</small><span>All lessons</span></a><span></span></nav></div></div></article>`;
  emit(`${nt.slug}.html`, page({ title: String(nt.data.title), desc: String(nt.data.summary), body, hasMermaid: html.includes('class="mermaid"'), pageId: nt.slug }));
});

const groups = Object.entries(AREAS).map(([key, a]) => {
  const items = lessons.filter((l) => l.data.area === key);
  const list = items.length
    ? `<ol class="lesson-list">${items.map((l) => `<li><a class="card" href="${l.slug}.html" data-slug="${l.slug}"><span class="num">${l.n}</span><span class="txt"><strong>${esc(l.data.title)}</strong><span class="sum">${esc(l.data.summary)}</span></span><span class="state" data-state="new" aria-label="Not done">New</span></a></li>`).join("")}</ol>`
    : `<p class="empty">No lessons delivered yet.</p>`;
  return `<section class="area${items.length ? "" : " idle"}" id="area-${key}"><h2><span class="letter">${key}</span>${esc(a.name)}</h2><p class="blurb">${esc(a.blurb)}</p>${list}</section>`;
}).join("\n");

const noteList = notes.length
  ? `<section class="area" id="notes"><h2><span class="letter">+</span>Concept notes</h2><p class="blurb">Short explanations that sit beside the lessons.</p><ol class="lesson-list">${notes.map((nt) => `<li><a class="card" href="${nt.slug}.html"><span class="num">&para;</span><span class="txt"><strong>${esc(nt.data.title)}</strong><span class="sum">${esc(nt.data.summary)}</span></span></a></li>`).join("")}</ol></section>`
  : "";

emit("index.html", page({
  title: "AI Academy",
  desc: "Daily AI engineering lessons, readable on desktop and phone.",
  pageId: "home",
  body: `<main class="home"><header class="hero"><h1>AI Academy</h1><p class="lede">One idea a day, from tokens to agents. Lessons for an engineer becoming an AI engineer.</p><p class="progress" id="progress" data-total="${lessons.length}">${lessons.length} lessons</p></header>${groups}${noteList}</main>`,
}));

for (const f of ["style.css", "app.js", "manifest.webmanifest"]) {
  copyFileSync(join(src, f), join(out, f));
  files.push(f);
}
for (const f of readdirSync(join(src, "icons"))) {
  copyFileSync(join(src, "icons", f), join(out, "icons", f));
  files.push("icons/" + f);
}
copyFileSync(join(root, "node_modules/mermaid/dist/mermaid.min.js"), join(out, "vendor/mermaid.min.js"));
files.push("vendor/mermaid.min.js");

const hash = createHash("sha1");
for (const f of files.sort()) hash.update(f).update(readFileSync(join(out, f)));
const version = hash.digest("hex").slice(0, 10);
const precache = ["./", ...files.map((f) => "./" + f)];
writeFileSync(join(out, "sw.js"), readFileSync(join(src, "sw.js"), "utf8").replace("__VERSION__", version).replace("__FILES__", JSON.stringify(precache)));
writeFileSync(join(out, ".nojekyll"), "");
console.log(`Built ${lessons.length} lessons, ${notes.length} notes, ${files.length} files, version ${version}`);
