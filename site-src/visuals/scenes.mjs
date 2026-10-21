import {
  WebGLRenderer, Scene, PerspectiveCamera, Color, Group, Mesh, MeshBasicMaterial, SphereGeometry,
  BufferGeometry, Float32BufferAttribute, Points, PointsMaterial, Line, LineBasicMaterial, CanvasTexture,
  QuadraticBezierCurve3, Vector3, Raycaster, Vector2, RingGeometry, DoubleSide, AdditiveBlending, NormalBlending,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { decodeF16, tokenize } from "../search-core.mjs";
export { mountMap, courseMap } from "./map.mjs";

export function resolveColor(el, cssVar) {
  const probe = document.createElement("span");
  probe.style.color = `var(${cssVar})`;
  probe.style.display = "none";
  el.appendChild(probe);
  const value = getComputedStyle(probe).color;
  probe.remove();
  return new Color(value);
}

export function palette(el) {
  const accent = resolveColor(el, "--accent");
  const text = resolveColor(el, "--text");
  const muted = resolveColor(el, "--muted");
  const surface = resolveColor(el, "--surface");
  const dark = surface.r + surface.g + surface.b < 1.2;
  return { accent, text, muted, surface, dark, mix: (a, b, t) => a.clone().lerp(b, t) };
}

let dotTexture = null;
function dot() {
  if (dotTexture) return dotTexture;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.55, "rgba(255,255,255,0.95)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  dotTexture = new CanvasTexture(c);
  return dotTexture;
}

function hash(i) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function gauss(i) {
  const u = Math.max(1e-6, hash(i));
  const v = hash(i + 0.5);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const smooth = (x) => x * x * (3 - 2 * x);
const pulse = (t, period) => smooth(0.5 - 0.5 * Math.cos((2 * Math.PI * t) / period));

function tokens(scene, p) {
  const group = new Group();
  const n = 8;
  const geo = new RoundedBoxGeometry(1, 0.62, 0.62, 3, 0.14);
  const boxes = [];
  for (let i = 0; i < n; i++) {
    const mat = new MeshBasicMaterial({ color: p.muted, transparent: true, opacity: 0.9 });
    const m = new Mesh(geo, mat);
    group.add(m);
    boxes.push(m);
  }
  const edges = [];
  for (let i = 0; i < n; i++) {
    const g = new BufferGeometry().setFromPoints([new Vector3(-0.5, -0.31, 0.32), new Vector3(0.5, -0.31, 0.32), new Vector3(0.5, 0.31, 0.32), new Vector3(-0.5, 0.31, 0.32), new Vector3(-0.5, -0.31, 0.32)]);
    const l = new Line(g, new LineBasicMaterial({ color: p.surface, transparent: true, opacity: 0.5 }));
    boxes[i].add(l);
    edges.push(l);
  }
  scene.add(group);
  return {
    camera: [0, 1.6, 9.5],
    update(t) {
      const level = pulse(t, 9);
      const deep = pulse(t - 2.2, 9);
      for (let i = 0; i < n; i++) {
        const pair = Math.floor(i / 2);
        const quad = Math.floor(i / 4);
        const d = 1.3 - 0.27 * level;
        const x = (i - 3.5) * d + (pair - 1.5) * 0.55 * level * (1 - deep) + (quad - 0.5) * 1.1 * deep;
        const b = boxes[i];
        b.position.set(x, Math.sin(t * 0.8 + i * 0.6) * 0.06, 0);
        b.rotation.y = -0.35 + Math.sin(t * 0.25) * 0.12;
        b.rotation.x = 0.18;
        b.material.color.copy(p.mix(p.muted, p.accent, Math.min(1, level * 0.8 + deep * 0.4)));
        b.material.opacity = 0.55 + 0.4 * level;
        edges[i].material.opacity = 0.65 * (1 - level);
      }
      group.rotation.y = Math.sin(t * 0.15) * 0.08;
    },
  };
}

function cloud(scene, p, data) {
  const group = new Group();
  const pts = data && data.points ? data.points : synthetic(160, 6);
  const positions = new Float32Array(pts.length * 3);
  const colors = new Float32Array(pts.length * 3);
  pts.forEach((q, i) => {
    positions.set([q[0], q[1], q[2]], i * 3);
    const c = p.mix(p.accent, p.dark ? p.text : p.muted, (q[3] || 0) * 0.75);
    colors.set([c.r, c.g, c.b], i * 3);
  });
  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new Float32BufferAttribute(colors, 3));
  const mat = new PointsMaterial({ size: data && data.points ? 0.26 : 0.18, map: dot(), vertexColors: true, transparent: true, depthWrite: false, opacity: 0.95, blending: p.dark ? AdditiveBlending : NormalBlending, sizeAttenuation: true });
  const points = new Points(geo, mat);
  group.add(points);
  const highlight = new Mesh(new RingGeometry(0.17, 0.23, 32), new MeshBasicMaterial({ color: p.accent, side: DoubleSide, transparent: true, opacity: 0 }));
  group.add(highlight);
  scene.add(group);
  let drag = 0;
  let yaw = 0;
  return {
    camera: [0, 0.4, 7.2],
    group,
    points,
    highlight,
    rotate(dx) { drag += dx; },
    update(t) {
      yaw += (drag - yaw) * 0.12;
      group.rotation.y = t * 0.06 + yaw;
      group.rotation.x = 0.22 + Math.sin(t * 0.1) * 0.05;
      highlight.lookAt(scene.userData.camera.position);
    },
  };
}

function synthetic(n, k) {
  const centers = [];
  for (let c = 0; c < k; c++) centers.push([Math.cos(c * 2.4) * 2.1, Math.sin(c * 1.7) * 0.7, Math.sin(c * 2.4) * 1.4]);
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = i % k;
    const s = 0.3;
    out.push([centers[c][0] + Math.max(-2.5, Math.min(2.5, gauss(i * 7 + 11))) * s, centers[c][1] + Math.max(-2.5, Math.min(2.5, gauss(i * 7 + 13))) * s, centers[c][2] + Math.max(-2.5, Math.min(2.5, gauss(i * 7 + 17))) * s, c / (k - 1)]);
  }
  return out;
}

function attention(scene, p) {
  const group = new Group();
  const n = 7;
  const nodes = [];
  const sphere = new SphereGeometry(0.2, 24, 16);
  for (let i = 0; i < n; i++) {
    const m = new Mesh(sphere, new MeshBasicMaterial({ color: p.muted }));
    m.position.set((i - (n - 1) / 2) * 1.15, 0, 0);
    group.add(m);
    nodes.push(m);
  }
  const arcs = [];
  for (let q = 0; q < n; q++) {
    for (let k = 0; k <= q; k++) {
      const a = nodes[q].position;
      const b = nodes[k].position;
      const h = 0.35 + Math.abs(q - k) * 0.38;
      const curve = k === q
        ? new QuadraticBezierCurve3(a.clone().add(new Vector3(-0.18, 0.2, 0)), a.clone().add(new Vector3(0, 0.9, 0)), a.clone().add(new Vector3(0.18, 0.2, 0)))
        : new QuadraticBezierCurve3(a.clone().add(new Vector3(0, 0.2, 0)), new Vector3((a.x + b.x) / 2, h + 0.2, 0), b.clone().add(new Vector3(0, 0.2, 0)));
      const line = new Line(new BufferGeometry().setFromPoints(curve.getPoints(40)), new LineBasicMaterial({ color: p.accent, transparent: true, opacity: 0 }));
      group.add(line);
      arcs.push({ q, k, line });
    }
  }
  scene.add(group);
  return {
    camera: [0, 1.2, 8.4],
    update(t) {
      const cycle = (t / 1.6) % n;
      const q = Math.floor(cycle);
      const f = smooth(Math.min(1, (cycle - q) * 2.2));
      const weights = [];
      let sum = 0;
      for (let k = 0; k <= q; k++) {
        const s = Math.exp(1.6 * Math.cos(k * 1.7 + q * 0.9) + (k === 0 ? 0.8 : 0) + (k === q ? 0.6 : 0));
        weights[k] = s;
        sum += s;
      }
      for (const arc of arcs) {
        const w = arc.q === q ? weights[arc.k] / sum : 0;
        arc.line.material.opacity = arc.q === q ? Math.min(1, 0.12 + 1.8 * w) * f : 0;
      }
      nodes.forEach((m, i) => {
        const on = i === q;
        const w = i <= q && weights[i] ? weights[i] / sum : 0;
        m.material.color.copy(on ? p.accent : p.mix(p.muted, p.accent, Math.min(1, w * 2.2 * f)));
        const s = on ? 1.35 : 1 + w * 0.6 * f;
        m.scale.setScalar(s);
      });
      group.rotation.y = Math.sin(t * 0.2) * 0.18;
      group.rotation.x = 0.12;
    },
  };
}

function layers(scene, p) {
  const group = new Group();
  const sizes = [4, 6, 6, 3];
  const cols = [];
  const sphere = new SphereGeometry(0.13, 20, 14);
  sizes.forEach((count, c) => {
    const col = [];
    for (let i = 0; i < count; i++) {
      const m = new Mesh(sphere, new MeshBasicMaterial({ color: p.muted }));
      m.position.set((c - (sizes.length - 1) / 2) * 2.1, (i - (count - 1) / 2) * 0.62, Math.sin(i * 1.3 + c) * 0.25);
      group.add(m);
      col.push(m);
    }
    cols.push(col);
  });
  const edges = [];
  for (let c = 0; c < sizes.length - 1; c++) {
    for (const a of cols[c]) for (const b of cols[c + 1]) {
      const l = new Line(new BufferGeometry().setFromPoints([a.position, b.position]), new LineBasicMaterial({ color: p.muted, transparent: true, opacity: 0.16 }));
      group.add(l);
      edges.push({ c, a, b, l });
    }
  }
  const pulses = [];
  const pulseGeo = new SphereGeometry(0.075, 12, 10);
  for (let i = 0; i < 14; i++) {
    const m = new Mesh(pulseGeo, new MeshBasicMaterial({ color: p.accent, transparent: true, opacity: 0 }));
    group.add(m);
    pulses.push({ m, seed: i });
  }
  scene.add(group);
  return {
    camera: [0, 0.3, 8.2],
    update(t) {
      const wave = (t * 0.55) % (sizes.length + 0.6);
      cols.forEach((col, c) => col.forEach((m, i) => {
        const near = Math.max(0, 1 - Math.abs(wave - c - 0.15) * 1.6);
        m.material.color.copy(p.mix(p.muted, p.accent, near * (0.5 + 0.5 * hash(i + c * 9))));
        m.scale.setScalar(1 + near * 0.35);
      }));
      for (const e of edges) e.l.material.opacity = 0.1 + 0.3 * Math.max(0, 1 - Math.abs(wave - e.c - 0.6) * 1.4);
      pulses.forEach((pl, i) => {
        const c = Math.floor(wave);
        const local = wave - c;
        if (c >= sizes.length - 1) { pl.m.material.opacity = 0; return; }
        const a = cols[c][Math.floor(hash(i * 3 + c) * cols[c].length)];
        const b = cols[c + 1][Math.floor(hash(i * 5 + c + 1) * cols[c + 1].length)];
        pl.m.position.lerpVectors(a.position, b.position, smooth(Math.min(1, local)));
        pl.m.material.opacity = Math.sin(Math.PI * Math.min(1, local)) * 0.95;
      });
      group.rotation.y = Math.sin(t * 0.18) * 0.32;
    },
  };
}

function orbit(scene, p) {
  const group = new Group();
  const core = new Mesh(new SphereGeometry(0.55, 40, 28), new MeshBasicMaterial({ color: p.accent }));
  group.add(core);
  const halo = new Mesh(new RingGeometry(0.72, 0.76, 64), new MeshBasicMaterial({ color: p.accent, transparent: true, opacity: 0.35, side: DoubleSide }));
  group.add(halo);
  const ringPts = [];
  for (let i = 0; i <= 96; i++) ringPts.push(new Vector3(Math.cos((i / 96) * Math.PI * 2) * 2.4, 0, Math.sin((i / 96) * Math.PI * 2) * 2.4));
  const ring = new Line(new BufferGeometry().setFromPoints(ringPts), new LineBasicMaterial({ color: p.muted, transparent: true, opacity: 0.3 }));
  group.add(ring);
  const toolGeo = new RoundedBoxGeometry(0.42, 0.42, 0.42, 3, 0.08);
  const tools = [];
  for (let i = 0; i < 4; i++) {
    const m = new Mesh(toolGeo, new MeshBasicMaterial({ color: p.muted }));
    group.add(m);
    tools.push(m);
  }
  const msg = new Mesh(new SphereGeometry(0.09, 14, 10), new MeshBasicMaterial({ color: p.accent, transparent: true }));
  group.add(msg);
  const link = new Line(new BufferGeometry().setFromPoints([new Vector3(), new Vector3()]), new LineBasicMaterial({ color: p.accent, transparent: true, opacity: 0 }));
  group.add(link);
  scene.add(group);
  return {
    camera: [0, 2.3, 7],
    update(t) {
      tools.forEach((m, i) => {
        const a = t * 0.22 + (i * Math.PI) / 2;
        m.position.set(Math.cos(a) * 2.4, 0, Math.sin(a) * 2.4);
        m.rotation.set(t * 0.3 + i, t * 0.4 + i, 0);
      });
      const step = (t / 2.4) % 4;
      const k = Math.floor(step);
      const local = step - k;
      const target = tools[Math.floor(hash(k + Math.floor(t / 9.6) * 4) * 4)];
      const go = local < 0.5 ? smooth(local * 2) : smooth(2 - local * 2);
      msg.position.lerpVectors(core.position, target.position, go);
      msg.material.opacity = Math.sin(Math.PI * local);
      link.geometry.setFromPoints([core.position, target.position]);
      link.material.opacity = 0.45 * Math.sin(Math.PI * local);
      tools.forEach((m) => m.material.color.copy(m === target && local > 0.35 && local < 0.65 ? p.accent : p.muted));
      core.scale.setScalar(1 + 0.04 * Math.sin(t * 2));
      halo.lookAt(scene.userData.camera.position);
      group.rotation.z = 0.08;
    },
  };
}

function quant(scene, p) {
  const group = new Group();
  const nx = 34;
  const nz = 12;
  const count = nx * nz;
  const positions = new Float32Array(count * 3);
  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(positions, 3));
  const points = new Points(geo, new PointsMaterial({ size: 0.12, map: dot(), color: p.accent, transparent: true, depthWrite: false }));
  group.add(points);
  const levels = 7;
  for (let l = 0; l < levels; l++) {
    const y = ((l / (levels - 1)) * 2 - 1) * 1.2;
    const line = new Line(new BufferGeometry().setFromPoints([new Vector3(-4.2, y, 0), new Vector3(4.2, y, 0)]), new LineBasicMaterial({ color: p.muted, transparent: true, opacity: 0.18 }));
    group.add(line);
  }
  scene.add(group);
  return {
    camera: [0, 1.4, 7.6],
    update(t) {
      const q = pulse(t, 8);
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        const x = (i / (nx - 1) - 0.5) * 8.4;
        const z = (j / (nz - 1) - 0.5) * 2.4;
        const y = Math.sin(x * 0.9 + t * 0.6 + j * 0.25) * 0.85 + Math.sin(x * 0.37 - j * 0.4) * 0.3;
        const step = 2.4 / (levels - 1);
        const yq = Math.max(-1.2, Math.min(1.2, Math.round(y / step) * step));
        positions.set([x, y + (yq - y) * q, z], (i * nz + j) * 3);
      }
      geo.attributes.position.needsUpdate = true;
      group.rotation.x = 0.25;
      group.rotation.y = Math.sin(t * 0.12) * 0.15;
    },
  };
}

const BUILDERS = { tokens, cloud, attention, layers, orbit, quant };

export function mount(el, kind, data) {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  let renderer;
  try {
    renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  } catch (e) {
    return null;
  }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(0x000000, 0);
  el.appendChild(renderer.domElement);
  let scene;
  let camera;
  let world;
  let visible = true;
  let raf = 0;
  const start = performance.now() - (hash(kind.length) * 20000);
  function build() {
    scene = new Scene();
    camera = new PerspectiveCamera(36, 1, 0.1, 100);
    scene.userData.camera = camera;
    world = (BUILDERS[kind] || cloud)(scene, palette(el), data);
    camera.position.set(...world.camera);
    camera.lookAt(0, 0, 0);
    resize();
  }
  function resize() {
    const w = el.clientWidth || 1;
    const h = el.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const fit = Math.max(1, 1.9 / camera.aspect);
    camera.position.set(world.camera[0] * fit, world.camera[1] * fit, world.camera[2] * fit);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }
  function frame(now) {
    raf = 0;
    const t = reduce.matches ? 14 : (now - start) / 1000;
    world.update(t);
    renderer.render(scene, camera);
    if (!reduce.matches && visible && !document.hidden) raf = requestAnimationFrame(frame);
  }
  function kick() { if (!raf) raf = requestAnimationFrame(frame); }
  build();
  kick();
  const io = new IntersectionObserver((entries) => { visible = entries[0].isIntersecting; if (visible) kick(); });
  io.observe(el);
  new ResizeObserver(() => { resize(); kick(); }).observe(el);
  document.addEventListener("visibilitychange", kick);
  reduce.addEventListener("change", kick);
  const rebuild = () => { build(); kick(); };
  new MutationObserver(rebuild).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", rebuild);
  el.classList.add("is-ready");
  return { kick };
}

