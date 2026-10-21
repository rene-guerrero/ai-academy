import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, BufferGeometry, Float32BufferAttribute, Points, ShaderMaterial,
  LineSegments, LineBasicMaterial, Vector3, Color, AdditiveBlending, NormalBlending,
} from "three";
import { decodeF16, tokenize } from "../search-core.mjs";
import { palette } from "./scenes.mjs";

function normalize(v) {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  s = Math.sqrt(s) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= s;
  return v;
}

function pca3(rows, dim) {
  const n = rows.length;
  const mean = new Float64Array(dim);
  rows.forEach((r) => { for (let j = 0; j < dim; j++) mean[j] += r[j] / n; });
  const X = rows.map((r) => Float64Array.from(r, (x, j) => x - mean[j]));
  const comps = [];
  for (let c = 0; c < 3; c++) {
    let v = Float64Array.from({ length: dim }, (_, j) => Math.sin(j * 12.9898 + c * 78.233));
    for (let it = 0; it < 50; it++) {
      const xv = X.map((r) => { let s = 0; for (let j = 0; j < dim; j++) s += r[j] * v[j]; return s; });
      const next = new Float64Array(dim);
      X.forEach((r, i) => { for (let j = 0; j < dim; j++) next[j] += r[j] * xv[i]; });
      for (const u of comps) { let d = 0; for (let j = 0; j < dim; j++) d += next[j] * u[j]; for (let j = 0; j < dim; j++) next[j] -= d * u[j]; }
      v = normalize(next);
    }
    comps.push(v);
  }
  return X.map((r) => comps.map((u) => { let s = 0; for (let j = 0; j < dim; j++) s += r[j] * u[j]; return s; }));
}

function layout(start, edges, iterations) {
  const n = start.length;
  const pos = start.map((p) => p.slice());
  const scale = Math.sqrt(start.reduce((s, p) => s + p[0] * p[0] + p[1] * p[1] + p[2] * p[2], 0) / n) || 1;
  pos.forEach((p) => { p[0] /= scale; p[1] /= scale; p[2] /= scale; });
  const rest = 0.32;
  for (let it = 0; it < iterations; it++) {
    const cool = 0.06 * (1 - it / iterations);
    const force = pos.map(() => [0, 0, 0]);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = pos[i][0] - pos[j][0], dy = pos[i][1] - pos[j][1], dz = pos[i][2] - pos[j][2];
        const d2 = dx * dx + dy * dy + dz * dz + 0.01;
        const f = 0.0025 / d2;
        force[i][0] += dx * f; force[i][1] += dy * f; force[i][2] += dz * f;
        force[j][0] -= dx * f; force[j][1] -= dy * f; force[j][2] -= dz * f;
      }
    }
    for (const [a, b, w] of edges) {
      const dx = pos[b][0] - pos[a][0], dy = pos[b][1] - pos[a][1], dz = pos[b][2] - pos[a][2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
      const f = 0.08 * w * (d - rest) / d;
      force[a][0] += dx * f; force[a][1] += dy * f; force[a][2] += dz * f;
      force[b][0] -= dx * f; force[b][1] -= dy * f; force[b][2] -= dz * f;
    }
    for (let i = 0; i < n; i++) {
      const p = pos[i], f = force[i];
      const len = Math.sqrt(f[0] * f[0] + f[1] * f[1] + f[2] * f[2]) || 1;
      const step = Math.min(len, cool) / len;
      p[0] += f[0] * step - p[0] * 0.002; p[1] += f[1] * step - p[1] * 0.002; p[2] += f[2] * step - p[2] * 0.002;
    }
  }
  return pos;
}

export async function courseMap(base, lang) {
  const data = await (await fetch(`${base}search/${lang}-chunks.json`)).json();
  const chunks = data.chunks;
  let chunkVec;
  if (data.vectors) {
    const buf = await (await fetch(base + "search/" + data.vectors)).arrayBuffer();
    const v = decodeF16(new Uint16Array(buf));
    const dim = v.length / chunks.length;
    chunkVec = chunks.map((_, i) => Float64Array.from(v.subarray(i * dim, (i + 1) * dim)));
  } else {
    const docs = chunks.map((c) => tokenize(`${c.heading} ${c.text}`));
    const df = new Map();
    docs.forEach((d) => new Set(d).forEach((w) => df.set(w, (df.get(w) || 0) + 1)));
    const vocab = [...df.keys()].filter((w) => df.get(w) > 1 && df.get(w) < chunks.length * 0.4).sort();
    const index = new Map(vocab.map((w, i) => [w, i]));
    chunkVec = docs.map((d) => {
      const r = new Float64Array(vocab.length);
      d.forEach((w) => { if (index.has(w)) r[index.get(w)] += Math.log(chunks.length / df.get(w)); });
      return normalize(r);
    });
  }
  const dim = chunkVec[0].length;
  const order = [];
  const bySection = new Map();
  chunks.forEach((c, i) => {
    if (!bySection.has(c.section)) { bySection.set(c.section, { chunks: [], c }); order.push(c.section); }
    bySection.get(c.section).chunks.push(i);
  });
  const nodes = order.map((sec) => {
    const { chunks: ids, c } = bySection.get(sec);
    const v = new Float64Array(dim);
    ids.forEach((i) => { for (let j = 0; j < dim; j++) v[j] += chunkVec[i][j]; });
    return { section: sec, url: c.url, page: c.url.split("#")[0], title: c.title, heading: c.heading, vec: normalize(v) };
  });
  const pages = [...new Set(nodes.map((n) => n.page))];
  nodes.forEach((n, i) => { n.lesson = pages.indexOf(n.page); n.anchor = i === 0 || nodes[i - 1].page !== n.page; });
  const n = nodes.length;
  const sim = nodes.map((a) => nodes.map((b) => { let s = 0; for (let j = 0; j < dim; j++) s += a.vec[j] * b.vec[j]; return s; }));
  const k = 3;
  const indeg = new Float64Array(n);
  const neighbors = nodes.map((_, i) => {
    const list = [...Array(n).keys()].filter((j) => j !== i).sort((a, b) => sim[i][b] - sim[i][a]).slice(0, k);
    list.forEach((j) => { indeg[j] += 1; });
    return list;
  });
  const cross = new Map();
  nodes.forEach((a, i) => {
    const list = [...Array(n).keys()].filter((j) => nodes[j].lesson !== a.lesson).sort((x, y) => sim[i][y] - sim[i][x]).slice(0, 2);
    list.forEach((j) => { const key = i < j ? `${i}-${j}` : `${j}-${i}`; if (!cross.has(key)) cross.set(key, [Math.min(i, j), Math.max(i, j), sim[i][j]]); });
  });
  const crossLinks = [...cross.values()].sort((a, b) => b[2] - a[2]);
  const keep = crossLinks.slice(0, Math.round(crossLinks.length * 0.7));
  const strands = [];
  for (let i = 1; i < n; i++) if (nodes[i].page === nodes[i - 1].page) strands.push([i - 1, i, 1]);
  const springs = [...strands, ...keep.map(([a, b, w]) => [a, b, Math.max(0.2, w)])];
  const pos = layout(pca3(nodes.map((x) => x.vec), dim), springs, 220);
  const center = [0, 1, 2].map((a) => pos.reduce((s, p) => s + p[a], 0) / n);
  pos.forEach((p) => { p[0] -= center[0]; p[1] -= center[1]; p[2] -= center[2]; });
  const std = [0, 1, 2].map((a) => Math.sqrt(pos.reduce((s, p) => s + p[a] * p[a], 0) / n) || 1);
  const spread = [1.5, 0.95, 1.25];
  const maxDeg = Math.max(1, ...indeg);
  nodes.forEach((x, i) => {
    x.pos = [0, 1, 2].map((a) => Math.max(-3.2, Math.min(3.2, pos[i][a] / std[a] * spread[a])));
    x.weight = Math.sqrt(indeg[i] / maxDeg);
    x.neighbors = neighbors[i];
    delete x.vec;
  });
  return { nodes, strands: strands.map(([a, b]) => [a, b]), links: keep.map(([a, b]) => [a, b]), lessons: pages.length, semantic: Boolean(data.vectors) };
}

const VERT = `
attribute float size;
attribute vec3 tint;
uniform float uScale;
uniform float uPixel;
varying vec3 vTint;
varying float vDepth;
void main() {
  vTint = tint;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDepth = clamp((-mv.z - 3.0) / 9.0, 0.0, 1.0);
  gl_PointSize = clamp(size * uScale / -mv.z, 2.0 * uPixel, size * 0.62 * uPixel);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = `
varying vec3 vTint;
varying float vDepth;
uniform float uFade;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float a = smoothstep(0.5, 0.42, d);
  if (a <= 0.0) discard;
  float rim = smoothstep(0.3, 0.42, d) * 0.25;
  gl_FragColor = vec4(vTint * (1.0 - rim), a * (1.0 - vDepth * uFade));
}`;

export function mountMap(el, data) {
  const A = window.__aia || { t: (k) => k };
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  let renderer;
  try {
    renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  } catch (e) {
    return null;
  }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.setAttribute("aria-hidden", "true");
  el.appendChild(renderer.domElement);
  const tip = el.querySelector(".visual-tip");
  if (tip) tip.setAttribute("aria-hidden", "true");
  const labelLayer = document.createElement("div");
  labelLayer.className = "map-labels";
  labelLayer.setAttribute("aria-hidden", "true");
  el.appendChild(labelLayer);
  const controls = document.createElement("div");
  controls.className = "map-controls";
  const mk = (txt, key, fn) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "map-btn";
    b.textContent = txt;
    b.setAttribute("aria-label", A.t(key));
    b.title = A.t(key);
    b.addEventListener("click", (e) => { e.stopPropagation(); fn(); });
    controls.appendChild(b);
    return b;
  };
  el.appendChild(controls);

  const nodes = data.nodes;
  const n = nodes.length;
  let scene, camera, group, points, strandLines, linkLines, hot, p, sizes;
  let yaw = 0.4, pitch = 0.28, zoom = 1, targetZoom = 1, idleUntil = 0, hit = -1, pinned = -1;
  const labels = [];
  nodes.forEach((x, i) => {
    if (!x.anchor) return;
    const s = document.createElement("span");
    s.className = "map-label";
    const m = String(x.title).match(/^(\d+)\./);
    s.textContent = m ? m[1] : String(x.title).replace(/^(What is |Qué es )/i, "").replace(/\?$/, "");
    labelLayer.appendChild(s);
    labels.push({ i, s });
  });

  function lineGeo(pairs) {
    const arr = new Float32Array(pairs.length * 6);
    pairs.forEach(([a, b], k) => { arr.set(nodes[a].pos, k * 6); arr.set(nodes[b].pos, k * 6 + 3); });
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(arr, 3));
    return g;
  }

  function build() {
    p = palette(el);
    scene = new Scene();
    camera = new PerspectiveCamera(40, 1, 0.1, 100);
    group = new Group();
    scene.add(group);
    const positions = new Float32Array(n * 3);
    const tints = new Float32Array(n * 3);
    sizes = new Float32Array(n);
    const far = p.dark ? p.text : p.surface;
    nodes.forEach((x, i) => {
      positions.set(x.pos, i * 3);
      const tone = data.lessons > 1 ? x.lesson / (data.lessons - 1) : 0;
      const c = x.anchor ? p.accent.clone() : p.mix(p.accent, far, (p.dark ? 0.15 : 0.2) + 0.5 * (1 - x.weight) * (0.7 + 0.3 * tone));
      tints.set([c.r, c.g, c.b], i * 3);
      sizes[i] = x.anchor ? 26 : 9 + 17 * x.weight;
    });
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(positions, 3));
    g.setAttribute("tint", new Float32BufferAttribute(tints, 3));
    g.setAttribute("size", new Float32BufferAttribute(sizes.slice(), 1));
    points = new Points(g, new ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { uScale: { value: 1 }, uPixel: { value: 1 }, uFade: { value: 0.55 } }, transparent: true, depthWrite: false, blending: p.dark ? AdditiveBlending : NormalBlending }));
    strandLines = new LineSegments(lineGeo(data.strands), new LineBasicMaterial({ color: p.accent, transparent: true, opacity: p.dark ? 0.45 : 0.38 }));
    linkLines = new LineSegments(lineGeo(data.links), new LineBasicMaterial({ color: p.dark ? p.text : p.muted, transparent: true, opacity: p.dark ? 0.16 : 0.13 }));
    hot = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: p.accent, transparent: true, opacity: 0.95 }));
    group.add(linkLines, strandLines, hot, points);
    resize();
    setHot(hit);
  }

  function resize() {
    const w = el.clientWidth || 1;
    const h = el.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    points.material.uniforms.uScale.value = Math.min(h, 420) * renderer.getPixelRatio() * 0.016;
    points.material.uniforms.uPixel.value = renderer.getPixelRatio();
  }

  function setHot(i) {
    const attr = points.geometry.attributes.size;
    for (let k = 0; k < n; k++) attr.array[k] = sizes[k];
    if (i >= 0) {
      const pairs = nodes[i].neighbors.map((j) => [i, j]);
      nodes.forEach((x, j) => { if (x.neighbors.includes(i) && !nodes[i].neighbors.includes(j)) pairs.push([j, i]); });
      hot.geometry.dispose();
      hot.geometry = lineGeo(pairs);
      attr.array[i] = sizes[i] * 1.6;
      pairs.forEach(([, j]) => { attr.array[j] = Math.max(attr.array[j], sizes[j] * 1.25); });
      pairs.forEach(([a]) => { attr.array[a] = Math.max(attr.array[a], sizes[a] * 1.25); });
      attr.array[i] = sizes[i] * 1.6;
      strandLines.material.opacity = 0.2;
      linkLines.material.opacity = 0.06;
    } else {
      hot.geometry.dispose();
      hot.geometry = new BufferGeometry();
      strandLines.material.opacity = p.dark ? 0.45 : 0.38;
      linkLines.material.opacity = p.dark ? 0.16 : 0.13;
    }
    attr.needsUpdate = true;
  }

  const tmp = new Vector3();
  function project(i, w, h) {
    tmp.set(...nodes[i].pos).applyMatrix4(group.matrixWorld).project(camera);
    return { x: (tmp.x * 0.5 + 0.5) * w, y: (-tmp.y * 0.5 + 0.5) * h, z: tmp.z };
  }

  function placeLabels() {
    const w = el.clientWidth, h = el.clientHeight;
    for (const { i, s } of labels) {
      const q = project(i, w, h);
      const show = q.z < 1 && q.x > 8 && q.x < w - 8 && q.y > 8 && q.y < h - 8;
      s.style.transform = `translate(${q.x.toFixed(1)}px, ${q.y.toFixed(1)}px)`;
      s.style.opacity = show ? String(0.35 + 0.65 * Math.max(0, Math.min(1, (0.995 - q.z) * 40))) : "0";
      s.classList.toggle("is-hot", i === hit);
    }
  }

  let raf = 0, visible = true;
  const start = performance.now();
  function frame(now) {
    raf = 0;
    const t = (now - start) / 1000;
    if (!reduce.matches && now > idleUntil) yaw += 0.0012;
    zoom += (targetZoom - zoom) * 0.18;
    const dist = 8.4 / zoom * Math.max(1, 1.7 / camera.aspect);
    camera.position.set(Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, Math.cos(yaw) * Math.cos(pitch) * dist);
    camera.lookAt(0, 0, 0);
    group.updateMatrixWorld();
    renderer.render(scene, camera);
    placeLabels();
    const moving = Math.abs(targetZoom - zoom) > 0.001;
    if (visible && !document.hidden && (moving || (!reduce.matches && now > idleUntil) || t < 0.1)) raf = requestAnimationFrame(frame);
  }
  function kick() { if (!raf) raf = requestAnimationFrame(frame); }

  function pick(clientX, clientY) {
    const r = renderer.domElement.getBoundingClientRect();
    const x = clientX - r.left, y = clientY - r.top;
    let best = -1, bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const q = project(i, r.width, r.height);
      if (q.z >= 1) continue;
      const radius = Math.max(10, Math.min(sizes[i] * 0.62, sizes[i] * points.material.uniforms.uScale.value / renderer.getPixelRatio() / camera.position.length()) / 2 + 5);
      const d = Math.hypot(q.x - x, q.y - y);
      if (d < radius && d - radius * 0.2 < bestD) { best = i; bestD = d; }
    }
    return { i: best, x, y, w: r.width };
  }

  function showTip(i, x, y, w) {
    if (!tip) return;
    if (i < 0) { tip.hidden = true; return; }
    tip.textContent = `${nodes[i].title} · ${nodes[i].heading}`;
    tip.hidden = false;
    tip.style.left = Math.min(w - 12, Math.max(12, x)) + "px";
    tip.style.top = y + "px";
  }

  function hover(i, x, y, w) {
    if (i !== hit) { hit = i; setHot(i); }
    showTip(i, x, y, w);
    renderer.domElement.style.cursor = i >= 0 ? "pointer" : "grab";
    kick();
  }

  const setZoom = (z) => { targetZoom = Math.max(0.55, Math.min(4, z)); idleUntil = performance.now() + 6000; kick(); };
  mk("+", "map.zoomIn", () => setZoom(targetZoom * 1.35));
  mk("−", "map.zoomOut", () => setZoom(targetZoom / 1.35));
  mk("↺", "map.reset", () => { yaw = 0.4; pitch = 0.28; pinned = -1; hover(-1, 0, 0, 0); setZoom(1); });

  const ptrs = new Map();
  let drag = null, pinch = 0, moved = false;
  const cv = renderer.domElement;
  cv.addEventListener("pointerdown", (e) => {
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    cv.setPointerCapture(e.pointerId);
    moved = false;
    drag = { x: e.clientX, y: e.clientY };
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
    idleUntil = performance.now() + 6000;
  });
  cv.addEventListener("pointermove", (e) => {
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 2 && pinch) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      setZoom(targetZoom * d / pinch);
      pinch = d;
      moved = true;
      return;
    }
    if (drag && ptrs.size === 1) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      if (moved) {
        yaw -= dx * 0.008;
        pitch = Math.max(-1.1, Math.min(1.1, pitch + dy * 0.006));
        drag = { x: e.clientX, y: e.clientY };
        idleUntil = performance.now() + 6000;
        kick();
      }
      return;
    }
    if (e.pointerType === "mouse") { const r = pick(e.clientX, e.clientY); hover(r.i, r.x, r.y, r.w); }
  });
  const end = (e) => {
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch = 0;
    if (ptrs.size) return;
    const wasDrag = moved;
    drag = null;
    if (wasDrag) return;
    const r = pick(e.clientX, e.clientY);
    if (r.i < 0) { pinned = -1; hover(-1, 0, 0, 0); return; }
    if (e.pointerType !== "mouse" && pinned !== r.i) { pinned = r.i; hover(r.i, r.x, r.y, r.w); return; }
    location.href = nodes[r.i].url;
  };
  cv.addEventListener("pointerup", end);
  cv.addEventListener("pointercancel", (e) => { ptrs.delete(e.pointerId); drag = null; pinch = 0; });
  cv.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse" && !ptrs.size) hover(-1, 0, 0, 0); });
  cv.addEventListener("wheel", (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setZoom(targetZoom * Math.exp(-e.deltaY * 0.0025));
  }, { passive: false });
  cv.addEventListener("dblclick", (e) => { e.preventDefault(); setZoom(targetZoom * 1.5); });

  build();
  kick();
  new IntersectionObserver((entries) => { visible = entries[0].isIntersecting; if (visible) kick(); }).observe(el);
  new ResizeObserver(() => { resize(); kick(); }).observe(el);
  document.addEventListener("visibilitychange", kick);
  const rebuild = () => { build(); kick(); };
  new MutationObserver(rebuild).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", rebuild);
  el.classList.add("is-ready");
  return { kick };
}
