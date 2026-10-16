import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".xml": "application/xml", ".txt": "text/plain" };

let chromium;
for (const candidate of ["playwright", "/opt/node22/lib/node_modules/playwright/index.mjs"]) {
  try { chromium = (await import(candidate)).chromium; break; } catch (e) {}
}
if (!chromium) { console.log("smoke: playwright not available, skipping browser tests"); process.exit(0); }

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

const launch = { executablePath: process.env.CHROMIUM_PATH || (existsSync("/opt/pw-browsers/chromium-1194/chrome-linux/chrome") ? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" : undefined) };
const browser = await chromium.launch(launch);
const failures = [];
let passed = 0;
function check(name, ok, detail) { if (ok) passed++; else failures.push(name + (detail ? ": " + detail : "")); }

async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 390, height: 800 }, colorScheme: opts.scheme || "light", locale: opts.locale || "en-US", permissions: ["clipboard-read", "clipboard-write"] });
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") page.errors.push(m.text()); });
  if (opts.init) await page.addInitScript(opts.init);
  if (!opts.noLang) await page.addInitScript(() => { try { if (!localStorage.getItem("aia:lang")) localStorage.setItem("aia:lang", "en"); } catch (e) {} });
  return { ctx, page };
}

for (const [w, h] of [[320, 700], [375, 800], [390, 844], [768, 1024], [1024, 768], [1440, 900], [1920, 1080]]) {
  const { ctx, page } = await newPage({ viewport: { width: w, height: h } });
  for (const url of ["index.html", "03-attention.html", "es/index.html", "es/06-semantic-search-evaluation.html", "note-rag.html"]) {
    await page.goto(base + url, { waitUntil: "load" });
    await page.waitForTimeout(600);
    const m = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      main: document.querySelectorAll("main").length,
      small: [...document.querySelectorAll("a,button,summary,input")].filter((el) => { const r = el.getBoundingClientRect(); const inline = getComputedStyle(el).display === "inline" && el.closest("p,li,td"); return r.width > 0 && r.height > 0 && (r.height < 24 || r.width < 24) && !el.classList.contains("anchor") && !el.classList.contains("sr") && !inline; }).map((el) => (el.className || el.tagName) + "@" + Math.round(r.width) + "x" + Math.round(r.height)),
    }));
    check(`${w}px ${url} no overflow`, !m.overflow);
    check(`${w}px ${url} has main`, m.main === 1);
    check(`${w}px ${url} tap targets`, m.small.length === 0, m.small.join(","));
  }
  check(`${w}px console clean`, page.errors.length === 0, page.errors.join(" | "));
  await ctx.close();
}

{
  const { ctx, page } = await newPage();
  await page.goto(base + "index.html");
  check("home empty state shows start", (await page.textContent("#continue-body")).includes("Start the course"));
  await page.click("#theme-menu summary");
  await page.click('[data-theme-choice="dark"]');
  check("theme attr set", (await page.getAttribute("html", "data-theme")) === "dark");
  await page.reload(); await page.waitForTimeout(300);
  check("theme persisted before paint", (await page.evaluate(() => document.documentElement.getAttribute("data-theme"))) === "dark");
  check("theme menu pressed state", (await page.getAttribute('[data-theme-choice="dark"]', "aria-pressed")) === "true");
  await page.click("#theme-menu summary");
  await page.click('[data-theme-choice="system"]');
  check("system theme clears attr", (await page.getAttribute("html", "data-theme")) === null);

  await page.goto(base + "02-embeddings.html"); await page.waitForTimeout(500);
  await page.fill("#predictions", "pair 2 will score high"); await page.waitForTimeout(700);
  await page.click("#done-btn");
  await page.click("#bookmark-btn");
  await page.click(".quiz-item[data-q='0'] summary");
  await page.click(".quiz-item[data-q='0'] [data-grade='review']");
  await page.reload(); await page.waitForTimeout(500);
  check("notes persist", (await page.inputValue("#predictions")) === "pair 2 will score high");
  check("done persists", (await page.getAttribute("#done-btn", "aria-pressed")) === "true");
  check("bookmark persists", (await page.getAttribute("#bookmark-btn", "aria-pressed")) === "true");
  check("quiz grade persists", await page.evaluate(() => document.querySelector(".quiz-item[data-q='0']").classList.contains("is-review")));

  await page.goto(base + "03-attention.html"); await page.waitForTimeout(400);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight * 0.5)); await page.waitForTimeout(900);
  await page.click("a[data-set-lang]");
  await page.waitForTimeout(1200);
  check("lang switch lands on es page", page.url().includes("/es/03-attention.html"));
  check("lang pref stored", (await page.evaluate(() => localStorage.getItem("aia:lang"))) === "es");
  check("scroll restored after switch", (await page.evaluate(() => window.scrollY)) > 200, String(await page.evaluate(() => window.scrollY)));
  check("es html lang", (await page.getAttribute("html", "lang")) === "es");
  await page.goto(base + "es/index.html"); await page.waitForTimeout(500);
  const progress = await page.textContent("#progress-text");
  check("es home reads same progress", progress.includes("1 de 6"), progress);
  check("es home resume card", (await page.textContent("#continue-body")).includes("Reanudar"));
  check("review section visible", !(await page.isHidden("#review")));
  const doneBadge = await page.getAttribute('.row[data-slug="02-embeddings"] .state', "data-state");
  check("done badge on catalog", doneBadge === "done");
  await page.click('[data-filter="done"]'); await page.waitForTimeout(100);
  const visibleRows = await page.evaluate(() => [...document.querySelectorAll("a.row[data-slug]")].filter((r) => !r.parentElement.classList.contains("is-hidden")).map((r) => r.dataset.slug));
  check("done filter", visibleRows.length === 1 && visibleRows[0] === "02-embeddings", visibleRows.join(","));
  await page.click('[data-filter="all"]');
  await page.fill("#search-input", "cache"); await page.waitForTimeout(600);
  const hits = await page.evaluate(() => document.querySelectorAll("#search-hits li a").length);
  check("heading search finds results", hits > 0);
  await page.goto(base + "index.html"); await page.waitForTimeout(400);
  const [download] = await Promise.all([page.waitForEvent("download"), page.click('[data-action="export"]')]);
  const exported = readFileSync(await download.path(), "utf8");
  const json = JSON.parse(exported);
  check("export contains notes", json.items["pred:02-embeddings"] && json.items["pred:02-embeddings"].v === "pair 2 will score high");
  await page.evaluate(() => { localStorage.removeItem("aia:state"); });
  await page.reload(); await page.waitForTimeout(400);
  check("cleared state shows start", (await page.textContent("#continue-body")).includes("Start the course"));
  await page.setInputFiles("#import-file", { name: "x.json", mimeType: "application/json", buffer: Buffer.from(exported) });
  await page.waitForTimeout(400);
  check("import restores", (await page.textContent("#progress-text")).includes("1 of 6"));
  check("clipboard copy", await (async () => { await page.goto(base + "03-attention.html"); await page.waitForTimeout(400); await page.click(".copy >> nth=0"); await page.waitForTimeout(200); return (await page.textContent(".copy >> nth=0")) === "Copied"; })());
  check("account dialog opens", await (async () => { await page.click("#account-btn"); await page.waitForTimeout(200); return page.evaluate(() => document.getElementById("account-dialog").open && document.getElementById("account-body").textContent.includes("not configured")); })());
  check("console clean in flow", page.errors.length === 0, page.errors.join(" | "));
  await ctx.close();
}

{
  const { ctx, page } = await newPage({ init: () => { Object.defineProperty(window, "localStorage", { get() { throw new Error("blocked"); } }); } });
  await page.goto(base + "02-embeddings.html"); await page.waitForTimeout(500);
  await page.click("#done-btn"); await page.fill("#predictions", "x"); await page.waitForTimeout(600);
  check("blocked storage message", (await page.textContent("#save-status")).length > 0);
  await page.goto(base + "index.html"); await page.waitForTimeout(400);
  check("blocked storage no errors", page.errors.length === 0, page.errors.join(" | "));
  await ctx.close();
}

{
  const { ctx, page } = await newPage({ locale: "es-ES", noLang: true });
  await page.goto(base + "index.html"); await page.waitForTimeout(800);
  check("first visit es redirect", page.url().includes("/es/index.html"), page.url());
  await page.click("a[data-set-lang]"); await page.waitForTimeout(600);
  check("explicit choice wins", page.url().endsWith("/index.html") && !page.url().includes("/es/"), page.url());
  await page.goto(base + "es/01-tokenization.html"); await page.waitForTimeout(600);
  check("direct es link honored after choice", page.url().includes("/es/01-tokenization.html"));
  await ctx.close();
}

{
  const { ctx, page } = await newPage();
  await page.goto(base + "index.html"); await page.waitForTimeout(2500);
  const sw = await page.evaluate(async () => Boolean(await navigator.serviceWorker.getRegistration()));
  check("service worker registered", sw);
  if (sw) {
    await page.waitForTimeout(1500);
    await ctx.setOffline(true);
    await page.goto(base + "es/04-transformer-block.html"); await page.waitForTimeout(1200);
    check("offline page loads", (await page.title()).includes("4."), await page.title());
    check("offline mermaid renders", (await page.evaluate(() => document.querySelectorAll(".mermaid svg").length)) === 1);
    check("offline badge shown", !(await page.isHidden("#offline")));
    await ctx.setOffline(false);
  }
  await ctx.close();
}

await browser.close();
server.close();
console.log(`smoke: ${passed} passed, ${failures.length} failed`);
failures.forEach((f) => console.log("  ✗ " + f));
process.exit(failures.length ? 1 : 0);
