import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync(new URL("../site-src/public-config.json", import.meta.url), "utf8"));
const url = process.env.SUPABASE_URL || config.supabaseUrl;
const key = process.env.SUPABASE_ANON_KEY || config.supabaseAnonKey;
const table = config.supabaseTable || "learning_items";
if (!url || !key) {
  console.log("Supabase is not configured; nothing to do.");
  process.exit(0);
}
const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

async function attempt(name, request) {
  for (let i = 1; i <= 3; i++) {
    try {
      const res = await request();
      const body = (await res.text()).slice(0, 200);
      console.log(`${name}: HTTP ${res.status} ${body}`);
      return res.status;
    } catch (err) {
      console.log(`${name}: attempt ${i} failed: ${err.message}`);
      await new Promise((r) => setTimeout(r, 5000 * i));
    }
  }
  return 0;
}

let status = await attempt("rpc ping", () => fetch(`${url}/rest/v1/rpc/ping`, { method: "POST", headers, body: "{}" }));
if (status === 404 || status === 0) status = await attempt("table query", () => fetch(`${url}/rest/v1/${table}?select=key&limit=1`, { headers }));
if (status === 0 || status >= 500) {
  console.log("Supabase did not answer. If the project is paused, restore it in the Supabase dashboard.");
  process.exit(1);
}
console.log("Supabase answered; the project stays active.");
