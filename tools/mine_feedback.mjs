import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};

const config = JSON.parse(readFileSync(join(root, "site-src/public-config.json"), "utf8"));
const url = (process.env.SUPABASE_URL || config.supabaseUrl || "").replace(/\/$/, "");
const key = process.env.SUPABASE_ANON_KEY || config.supabaseAnonKey;
const fixture = opt("fixture", null);
const outFile = resolve(root, opt("out", "data/search-feedback.json"));
const issueFile = opt("issue", null);
const since = opt("since", "2020-01-01T00:00:00Z");
const minUps = Number(opt("min-ups", "2"));
const siteUrl = (process.env.SITE_URL || "https://rene-guerrero.github.io/ai-academy/").replace(/\/?$/, "/");
const chunksSource = opt("chunks", existsSync(join(root, "dist/search/en-chunks.json")) ? join(root, "dist/search") : `${siteUrl}search`);
const evalFile = join(root, "tests/search-eval.json");
const MISSING = new Set(["PGRST202", "PGRST205", "PGRST204", "42P01", "42883"]);

function done(message) {
  console.log(message);
  process.exit(0);
}

async function fetchRows() {
  if (fixture) return JSON.parse(readFileSync(resolve(fixture), "utf8"));
  if (!url || !key) done("Supabase is not configured; nothing to mine.");
  let res;
  try {
    res = await fetch(`${url}/rest/v1/rpc/search_feedback_summary`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ since }),
    });
  } catch (err) {
    console.error(`Supabase did not answer: ${err.message}`);
    process.exit(1);
  }
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch (e) {}
  if (res.status === 404 || (body && MISSING.has(body.code))) {
    done(`The search_feedback table or the search_feedback_summary function does not exist yet (HTTP ${res.status}${body && body.code ? `, ${body.code}` : ""}). Run supabase/schema.sql in the Supabase SQL editor once; nothing to mine until then.`);
  }
  if (!res.ok || !Array.isArray(body)) {
    console.error(`Supabase returned HTTP ${res.status}: ${text.slice(0, 300)}`);
    process.exit(1);
  }
  return body;
}

async function loadChunks(lang) {
  const where = `${chunksSource.replace(/\/$/, "")}/${lang}-chunks.json`;
  try {
    if (/^https?:/.test(where)) {
      const res = await fetch(where);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()).chunks;
    }
    return JSON.parse(readFileSync(where, "utf8")).chunks;
  } catch (err) {
    console.log(`Could not read ${where} (${err.message}); candidates for ${lang} will show section ids only.`);
    return null;
  }
}

function sectionTable(chunks) {
  if (!chunks) return null;
  const byKey = new Map();
  const info = new Map();
  for (const c of chunks) {
    if (info.has(c.section)) continue;
    const pageKey = c.section.split("#")[0];
    if (!byKey.has(pageKey)) byKey.set(pageKey, []);
    const list = byKey.get(pageKey);
    info.set(c.section, { key: pageKey, index: list.length, heading: c.heading, title: c.title });
    list.push(c.section);
  }
  return { byKey, info };
}

const fold = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const rate = (x) => {
  const n = x.ups + x.downs + x.misses;
  return n ? Math.round((1000 * x.ups) / n) / 1000 : null;
};

const rows = (await fetchRows()).map((r) => ({ lang: String(r.lang), mode: String(r.mode), query: String(r.query), section: r.section || null, ups: Number(r.ups) || 0, downs: Number(r.downs) || 0, misses: Number(r.misses) || 0 }));
const evalSet = JSON.parse(readFileSync(evalFile, "utf8"));
const known = new Set(evalSet.queries.flatMap((q) => Object.entries(q).filter(([k]) => k !== "expect").map(([, v]) => fold(v))));
const langs = [...new Set(["en", "es", ...rows.map((r) => r.lang)])];
const tables = Object.fromEntries(await Promise.all(langs.map(async (l) => [l, sectionTable(await loadChunks(l))])));
const describe = (lang, section) => {
  const tb = tables[lang];
  const own = tb && tb.info.get(section);
  const en = tables.en;
  let enHeading = null;
  if (own) {
    if (lang === "en") enHeading = own.heading;
    else if (en && en.byKey.get(own.key)) {
      const enSection = en.byKey.get(own.key)[own.index];
      enHeading = enSection ? en.info.get(enSection).heading : null;
    }
  }
  return { key: section.split("#")[0], heading: own ? own.heading : null, title: own ? own.title : null, enHeading };
};

const totals = { votes: 0, ups: 0, downs: 0, misses: 0, queries: 0 };
const helpful = {};
const byQuery = new Map();
for (const r of rows) {
  totals.ups += r.ups;
  totals.downs += r.downs;
  totals.misses += r.misses;
  const h = ((helpful[r.lang] ||= {})[r.mode] ||= { ups: 0, downs: 0, misses: 0 });
  h.ups += r.ups;
  h.downs += r.downs;
  h.misses += r.misses;
  const qk = `${r.lang}\u0000${r.query}`;
  if (!byQuery.has(qk)) byQuery.set(qk, { lang: r.lang, query: r.query, ups: 0, downs: 0, misses: 0, sections: new Map() });
  const q = byQuery.get(qk);
  q.ups += r.ups;
  q.downs += r.downs;
  q.misses += r.misses;
  if (r.section) {
    const s = q.sections.get(r.section) || { section: r.section, ups: 0, downs: 0 };
    s.ups += r.ups;
    s.downs += r.downs;
    q.sections.set(r.section, s);
  }
}
totals.votes = totals.ups + totals.downs + totals.misses;
totals.queries = byQuery.size;
for (const l of Object.keys(helpful)) {
  const all = { ups: 0, downs: 0, misses: 0 };
  for (const m of Object.keys(helpful[l])) {
    for (const k of Object.keys(all)) all[k] += helpful[l][m][k];
    helpful[l][m].votes = helpful[l][m].ups + helpful[l][m].downs + helpful[l][m].misses;
    helpful[l][m].rate = rate(helpful[l][m]);
  }
  helpful[l].all = { ...all, votes: all.ups + all.downs + all.misses, rate: rate(all) };
}

const queries = [...byQuery.values()];
const failing = queries
  .map((q) => ({ ...q, fail: q.downs + q.misses - q.ups }))
  .filter((q) => q.downs + q.misses > 0 && q.fail > 0)
  .sort((a, b) => b.fail - a.fail || b.misses - a.misses || a.query.localeCompare(b.query))
  .slice(0, 25)
  .map((q) => ({
    lang: q.lang,
    query: q.query,
    ups: q.ups,
    downs: q.downs,
    misses: q.misses,
    downvoted: [...q.sections.values()].filter((s) => s.downs > 0).sort((a, b) => b.downs - a.downs).map((s) => ({ section: s.section, heading: describe(q.lang, s.section).heading, downs: s.downs, ups: s.ups })),
  }));

const candidates = [];
for (const q of queries) {
  if (known.has(fold(q.query))) continue;
  const best = [...q.sections.values()].filter((s) => s.ups >= minUps && s.ups >= 3 * s.downs && s.ups - s.downs >= minUps).sort((a, b) => b.ups - b.downs - (a.ups - a.downs));
  if (!best.length) continue;
  const top = best[0];
  const d = describe(q.lang, top.section);
  const other = q.lang === "es" ? "en" : "es";
  const snippet = d.enHeading ? { en: q.query, es: q.query, expect: [[d.key, d.enHeading]] } : null;
  candidates.push({ lang: q.lang, query: q.query, section: top.section, heading: d.heading, page: d.title, ups: top.ups, downs: top.downs, translate: other, snippet });
}
candidates.sort((a, b) => b.ups - b.downs - (a.ups - a.downs) || a.query.localeCompare(b.query));

const report = { source: fixture ? "fixture" : "supabase", since, minUps, totals, helpful, failing, candidates };
mkdirSync(dirname(outFile), { recursive: true });
const next = JSON.stringify(report, null, 2) + "\n";
const prev = existsSync(outFile) ? readFileSync(outFile, "utf8") : "";
if (prev !== next) writeFileSync(outFile, next);
console.log(`${totals.votes} votes on ${totals.queries} questions; ${failing.length} failing questions; ${candidates.length} candidate questions. ${prev === next ? "No change" : "Wrote"} ${outFile}.`);

if (issueFile) {
  const lines = [
    `This issue is updated weekly by \`.github/workflows/feedback.yml\` from the "Was this the answer?" votes in Ask the course (${totals.votes} votes on ${totals.queries} questions so far).`,
    "",
    `A candidate is a reader question that is not in \`tests/search-eval.json\` yet and whose result got at least ${minUps} more thumbs up than down and at least three times as many up as down. Check that the section really answers it, fill in the translation for the other language, and paste the snippet into the \`queries\` array. Then run \`npm run build\` to see how every search mode ranks it.`,
    "",
  ];
  if (!candidates.length) lines.push("No candidates right now.");
  candidates.forEach((c, i) => {
    lines.push(`### ${i + 1}. ${c.query}`, "", `Language: ${c.lang}. Upvoted section: ${c.page ? `${c.page} › ` : ""}${c.heading || c.section} (${c.ups} up, ${c.downs} down).`, "");
    if (c.snippet) lines.push(`The \`${c.translate}\` field repeats the question; translate it before committing.`, "", "```json", JSON.stringify(c.snippet, null, 2) + ",", "```", "");
    else lines.push(`The section \`${c.section}\` was not found in the current search chunks; it may have been renamed. Label this one by hand.`, "");
  });
  if (failing.length) {
    lines.push("## Questions where search failed", "", "| Language | Question | Down | None of these | Downvoted sections |", "| --- | --- | ---: | ---: | --- |");
    for (const f of failing.slice(0, 15)) lines.push(`| ${f.lang} | ${f.query.replace(/\|/g, "\\|")} | ${f.downs} | ${f.misses} | ${f.downvoted.map((s) => (s.heading || s.section).replace(/\|/g, "\\|")).join("; ") || "—"} |`);
    lines.push("");
  }
  writeFileSync(resolve(issueFile), lines.join("\n"));
  console.log(`Wrote the issue body to ${issueFile}.`);
}
if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `candidates=${candidates.length}\n`, { flag: "a" });
