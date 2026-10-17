const BASE = new URL("./", import.meta.url).href;
const SHIMS = { tiktoken: { packages: ["regex"], assets: ["cl100k_base.tiktoken"] }, sentence_transformers: { packages: ["numpy"], assets: ["minilm.npz", "minilm-vocab.txt", "minilm.json"] } };
const SHIM_FILES = ["tiktoken.py", "sentence_transformers.py"];
const ASSET_DIR = "/home/pyodide/assets";
const SHIM_DIR = "/home/pyodide/shims";

let pyodide = null;
let loadedAssets = new Set();
let manifest = null;

function post(type, data) {
  self.postMessage({ type, ...data });
}

async function getManifest() {
  if (!manifest) manifest = await (await fetch(BASE + "manifest.json")).json();
  return manifest;
}

async function fetchWithProgress(url, label, size) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`);
  const total = Number(res.headers.get("content-length")) || size || 0;
  if (!res.body || !total) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  let last = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (received - last > 262144 || received === total) {
      last = received;
      post("progress", { label, received, total });
    }
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

async function ensurePyodide() {
  if (pyodide) return pyodide;
  const m = await getManifest();
  post("phase", { phase: "downloading", bytes: m.core });
  const { loadPyodide } = await import(BASE + "pyodide/pyodide.mjs");
  pyodide = await loadPyodide({ indexURL: BASE + "pyodide/", stdout: () => {}, stderr: () => {} });
  post("phase", { phase: "starting" });
  pyodide.FS.mkdirTree(ASSET_DIR);
  pyodide.FS.mkdirTree(SHIM_DIR);
  for (const f of SHIM_FILES) {
    const text = await (await fetch(BASE + "shims/" + f)).text();
    pyodide.FS.writeFile(`${SHIM_DIR}/${f}`, text);
  }
  pyodide.runPython(`import sys, os\nsys.path.insert(0, ${JSON.stringify(SHIM_DIR)})\nos.environ["AIA_ASSETS"] = ${JSON.stringify(ASSET_DIR)}`);
  return pyodide;
}

function findImports(code) {
  const found = pyodide.pyodide_py.code.find_imports(code);
  const list = found.toJs();
  found.destroy();
  return list;
}

async function prepare(code) {
  const m = await getManifest();
  const imports = findImports(code);
  const packages = new Set();
  const assets = [];
  for (const name of imports) {
    const shim = SHIMS[name];
    if (shim) {
      shim.packages.forEach((p) => packages.add(p));
      assets.push(...shim.assets);
    } else if (m.known[name]) {
      if (!m.packages.includes(m.known[name])) throw new Error(`MISSING:${name}`);
      packages.add(m.known[name]);
    }
  }
  for (const name of imports) {
    if (SHIMS[name] && SHIMS[name].assets.some((a) => !m.assets[a])) throw new Error(`MISSING:${name}`);
  }
  if (packages.size) {
    post("phase", { phase: "packages", names: [...packages].join(", ") });
    await pyodide.loadPackage([...packages], { messageCallback: () => {}, errorCallback: () => {} });
  }
  for (const a of assets) {
    if (loadedAssets.has(a)) continue;
    const bytes = await fetchWithProgress(BASE + "assets/" + a, a, m.assets[a]);
    pyodide.FS.writeFile(`${ASSET_DIR}/${a}`, bytes);
    loadedAssets.add(a);
  }
}

function cleanTraceback(message) {
  const lines = String(message).split("\n");
  const start = lines.findIndex((l) => l.includes('File "<exec>"'));
  if (start < 0) return message;
  return ["Traceback (most recent call last):", ...lines.slice(start).filter((l) => !l.includes("/lib/python3") && !l.includes("_pyodide"))].join("\n");
}

self.onmessage = async (event) => {
  const msg = event.data;
  if (msg.type !== "run") return;
  const started = performance.now();
  try {
    await ensurePyodide();
    await prepare(msg.code);
    pyodide.setStdout({ batched: (text) => post("stdout", { text }) });
    pyodide.setStderr({ batched: (text) => post("stderr", { text }) });
    post("phase", { phase: "running" });
    const globals = pyodide.globals.get("dict")();
    globals.set("__name__", "__main__");
    const runStart = performance.now();
    await pyodide.runPythonAsync(msg.code, { globals, filename: "<exec>" });
    globals.destroy();
    post("done", { ms: performance.now() - runStart, total: performance.now() - started });
  } catch (err) {
    const text = String(err && err.message ? err.message : err);
    if (text.startsWith("MISSING:")) post("missing", { name: text.slice(8) });
    else if (err && err.type) post("error", { text: cleanTraceback(text) });
    else post("fatal", { text });
  }
};
