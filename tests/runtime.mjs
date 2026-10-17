import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const outputs = join(root, "runtime-cache", "outputs");
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".wasm": "application/wasm", ".zip": "application/zip", ".whl": "application/zip", ".npz": "application/octet-stream", ".py": "text/plain; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".tiktoken": "text/plain", ".webmanifest": "application/manifest+json", ".png": "image/png" };

let chromium;
for (const candidate of ["playwright", "/opt/node22/lib/node_modules/playwright/index.mjs"]) {
  try { chromium = (await import(candidate)).chromium; break; } catch (e) {}
}
if (!chromium) { console.log("runtime: playwright not available, skipping"); process.exit(0); }

const runtimeDir = join(dist, "runtime");
const version = existsSync(runtimeDir) ? readdirSync(runtimeDir).find((d) => existsSync(join(runtimeDir, d, "manifest.json"))) : null;
const manifest = version ? JSON.parse(readFileSync(join(runtimeDir, version, "manifest.json"), "utf8")) : null;
if (!manifest || !manifest.packages.includes("numpy")) {
  console.log("runtime: the Python packages are not in this build (run npm run runtime first); skipping");
  process.exit(0);
}

const server = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  const file = join(dist, p);
  if (!file.startsWith(dist) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}/`;
const browser = await chromium.launch(existsSync("/opt/pw-browsers/chromium-1194/chrome-linux/chrome") ? { executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" } : {});
const failures = [];
let passed = 0;
function check(name, ok, detail) { if (ok) passed++; else failures.push(name + (detail ? ": " + detail : "")); }
const nums = (s) => (s.match(/-?\d+\.\d+/g) || []).map(Number);

const lessons = [
  ["ai-engineering", "01-tokenization", "lesson_01_tokenization", "exact"],
  ["ai-engineering", "02-embeddings", "lesson_02_embeddings", "close"],
  ["ai-engineering", "03-attention", "lesson_03_attention", "exact"],
  ["ai-engineering", "04-transformer-block", "lesson_04_transformer_block", "exact"],
  ["ai-engineering", "05-training-and-generation", "lesson_05_training_generation", "exact"],
  ["ai-engineering", "06-semantic-search-evaluation", "lesson_06_semantic_search", "close"],
];

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.addInitScript(() => { try { localStorage.setItem("aia:lang", "en"); } catch (e) {} });
for (const [course, slug, script, mode] of lessons) {
  const refFile = join(outputs, course, script + ".txt");
  await page.goto(`${base}${course}/${slug}.html`);
  await page.waitForSelector("[data-runner]:not([hidden])", { timeout: 15000 });
  const started = Date.now();
  await page.click("[data-run]");
  await page.waitForFunction(() => /Done|error|available|Couldn|Stopped/.test(document.querySelector(".runner-status").textContent), null, { timeout: 180000 });
  const status = await page.textContent(".runner-status");
  const got = (await page.textContent(".runner-out pre")).replace(/\n+$/, "");
  check(`${slug} ran`, status.startsWith("Done"), status + " " + got.slice(-400));
  if (existsSync(refFile)) {
    const want = readFileSync(refFile, "utf8").replace(/\n+$/, "");
    if (mode === "exact") check(`${slug} output identical to real Python`, got === want, `first difference near: ${[...got].findIndex((c, i) => c !== want[i])}`);
    else {
      const a = nums(got), b = nums(want);
      const worst = Math.max(0, ...a.map((x, i) => Math.abs(x - (b[i] ?? Infinity))));
      check(`${slug} numbers within 0.02 of real Python`, a.length === b.length && worst <= 0.02, `count ${a.length}/${b.length}, worst ${worst}`);
    }
  }
  console.log(`runtime: ${slug} ${status} (${Date.now() - started} ms)`);
}
await page.goto(`${base}ai-engineering/03-attention.html`);
await page.waitForSelector("[data-runner]:not([hidden])");
const t0 = Date.now();
await page.click("[data-run]");
await page.waitForFunction(() => /Done/.test(document.querySelector(".runner-status").textContent), null, { timeout: 60000 });
check("warm start under 5 s", Date.now() - t0 < 5000, `${Date.now() - t0} ms`);
await ctx.setOffline(true);
await page.reload();
await page.waitForSelector("[data-runner]:not([hidden])");
await page.click("[data-run]");
await page.waitForFunction(() => /Done|error|Couldn/.test(document.querySelector(".runner-status").textContent), null, { timeout: 60000 });
check("runs offline after first use", (await page.textContent(".runner-status")).startsWith("Done"), await page.textContent(".runner-status"));
await ctx.setOffline(false);
check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
server.close();
console.log(`runtime: ${passed} passed, ${failures.length} failed`);
failures.forEach((f) => console.log("  ✗ " + f));
process.exit(failures.length ? 1 : 0);
