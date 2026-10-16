import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const problems = [];

const en = JSON.parse(readFileSync(join(root, "site-src/i18n/en.json"), "utf8"));
const es = JSON.parse(readFileSync(join(root, "site-src/i18n/es.json"), "utf8"));
for (const k of Object.keys(en)) if (!(k in es)) problems.push(`es.json missing key ${k}`);
for (const k of Object.keys(es)) if (!(k in en)) problems.push(`es.json has extra key ${k}`);
for (const k of Object.keys(en)) {
  const a = (en[k].match(/\{\w+\}/g) || []).sort().join(",");
  const b = ((es[k] || "").match(/\{\w+\}/g) || []).sort().join(",");
  if (a !== b) problems.push(`placeholder mismatch in ${k}`);
}

function codeBlocks(text) {
  const blocks = [];
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    if (current === null && /^```/.test(line)) { current = { lang: line.slice(3).trim(), lines: [] }; continue; }
    if (current !== null && /^```\s*$/.test(line)) { if (current.lang !== "mermaid") blocks.push(current.lines.join("\n")); current = null; continue; }
    if (current !== null) current.lines.push(line);
  }
  return blocks;
}
function front(file) {
  const text = readFileSync(file, "utf8");
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const d = {};
  for (const line of m[1].split(/\r?\n/)) { const i = line.indexOf(":"); if (i > 0) d[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  return d;
}
const courseIds = readdirSync(join(root, "courses")).filter((d) => existsSync(join(root, "courses", d, "course.json")));
if (!courseIds.length) problems.push("no courses found under courses/");
for (const cid of courseIds) {
  const cdir = join(root, "courses", cid);
  const course = JSON.parse(readFileSync(join(cdir, "course.json"), "utf8"));
  if (course.id !== cid) problems.push(`${cid}: course.json id is ${course.id}`);
  for (const lang of ["en", "es"]) {
    if (!course.title || !course.title[lang]) problems.push(`${cid}: missing ${lang} title`);
    if (!course.summary || !course.summary[lang]) problems.push(`${cid}: missing ${lang} summary`);
  }
  const tracks = new Set((course.tracks || []).map((t) => t.key));
  const ldir = join(cdir, "lessons-md");
  const lessonSlugs = existsSync(ldir) ? readdirSync(ldir).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, "")) : [];
  const known = new Set([...lessonSlugs, ...(course.planned || []).map((p) => p.slug)]);
  for (const p of course.planned || []) {
    if (!tracks.has(p.track)) problems.push(`${cid} planned ${p.slug}: unknown track ${p.track}`);
    for (const q of p.prereqs || []) if (!known.has(q)) problems.push(`${cid} planned ${p.slug}: unknown prereq ${q}`);
    for (const lang of ["en", "es"]) if (!p.title[lang] || !p.summary[lang]) problems.push(`${cid} planned ${p.slug}: missing ${lang} text`);
    if (lessonSlugs.includes(p.slug)) problems.push(`${cid} planned ${p.slug}: already published, remove it from planned`);
  }
  const numbers = new Set();
for (const slug of lessonSlugs) {
  const d = front(join(ldir, `${slug}.md`));
  if (!d) { problems.push(`${cid}/${slug}: missing front matter`); continue; }
  if (numbers.has(d.n)) problems.push(`${cid}/${slug}: duplicate lesson number ${d.n}`);
  numbers.add(d.n);
  for (const k of ["title", "summary", "area", "n", "minutes", "exercise"]) if (!d[k]) problems.push(`${cid}/${slug}: missing ${k}`);
  if (d.area && !tracks.has(d.area)) problems.push(`${cid}/${slug}: unknown area ${d.area}`);
  if (d.exercise && !existsSync(join(cdir, d.exercise))) problems.push(`${cid}/${slug}: exercise file ${d.exercise} not found`);
  if (d.level && !["foundations", "core", "advanced"].includes(d.level)) problems.push(`${cid}/${slug}: bad level ${d.level}`);
  for (const q of (d.prereqs || "").split(",").map((s) => s.trim()).filter(Boolean)) if (!lessonSlugs.includes(q)) problems.push(`${cid}/${slug}: unknown prereq ${q}`);
  const esFile = join(ldir, "es", `${slug}.md`);
  if (!existsSync(esFile)) problems.push(`warning: ${cid}/${slug} has no Spanish translation`);
  else {
    const e = front(esFile);
    if (!e || !e.title || !e.summary) problems.push(`${cid}/${slug}: Spanish file needs title and summary`);
    const enCode = codeBlocks(readFileSync(join(ldir, `${slug}.md`), "utf8"));
    const esCode = codeBlocks(readFileSync(esFile, "utf8"));
    if (enCode.length !== esCode.length) problems.push(`${cid}/${slug}: Spanish file has ${esCode.length} code blocks, English has ${enCode.length}`);
    else enCode.forEach((c, i) => { if (c !== esCode[i]) problems.push(`${cid}/${slug}: code block ${i + 1} differs between languages`); });
  }
}

}

function walk(dir) {
  return readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
}
if (!existsSync(dist)) problems.push("dist/ not built");
else {
  const pages = walk(dist).filter((f) => f.endsWith(".html"));
  const all = new Set(walk(dist).map((f) => f.slice(dist.length + 1)));
  for (const page of pages) {
    const html = readFileSync(page, "utf8");
    const base = dirname(page.slice(dist.length + 1));
    const hrefs = [...html.matchAll(/\s(?:href|src)="([^"#]+)(?:#[^"]*)?"/g)].map((m) => m[1]);
    for (const h of hrefs) {
      if (/^(https?:|mailto:|data:)/.test(h)) continue;
      const target = join(base === "." ? "" : base, h).replace(/\\/g, "/").replace(/^\.\//, "");
      if (!all.has(target)) problems.push(`${page.slice(dist.length + 1)}: broken link ${h}`);
    }
    const ids = new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
    for (const m of html.matchAll(/href="#([^"]+)"/g)) if (!ids.has(m[1])) problems.push(`${page.slice(dist.length + 1)}: missing anchor #${m[1]}`);
    if (!/<main /.test(html)) problems.push(`${page.slice(dist.length + 1)}: no <main>`);
    if ((html.match(/<h1[ >]/g) || []).length !== 1) problems.push(`${page.slice(dist.length + 1)}: h1 count`);
    if (!/rel="canonical"/.test(html)) problems.push(`${page.slice(dist.length + 1)}: no canonical`);
    if (/\{\{[A-Z]+\}\}/.test(html)) problems.push(`${page.slice(dist.length + 1)}: unreplaced template token`);
  }
  const sw = readFileSync(join(dist, "sw.js"), "utf8");
  for (const f of all) if (!f.endsWith("sw.js") && f !== "config.js" && f !== ".nojekyll" && !sw.includes(JSON.stringify("./" + f))) problems.push(`sw.js does not precache ${f}`);
}

const errors = problems.filter((p) => !p.startsWith("warning:"));
problems.forEach((p) => console.log((p.startsWith("warning:") ? "  " : "✗ ") + p));
console.log(errors.length ? `${errors.length} problems` : `checks passed (${problems.length} warnings)`);
process.exit(errors.length ? 1 : 0);
