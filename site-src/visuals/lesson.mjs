import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, BufferGeometry, BufferAttribute, Points, LineSegments,
  ShaderMaterial, AdditiveBlending, NormalBlending, Vector2,
} from "three";

const POINT_VERT = `
attribute float size;
attribute vec4 tint;
uniform float uScale;
uniform float uPixel;
varying vec4 vTint;
varying float vFade;
void main() {
  vTint = tint;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vFade = clamp((-mv.z - 4.0) / 10.0, 0.0, 1.0);
  gl_PointSize = clamp(size * uScale / -mv.z, 1.5 * uPixel, size * 0.7 * uPixel);
  gl_Position = projectionMatrix * mv;
}`;

const POINT_FRAG = `
varying vec4 vTint;
varying float vFade;
uniform float uGlow;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float core = smoothstep(0.5, 0.42, d);
  float halo = smoothstep(0.5, 0.0, d) * uGlow;
  float a = max(core, halo * 0.55) * vTint.a * (1.0 - vFade * 0.6);
  if (a <= 0.003) discard;
  gl_FragColor = vec4(vTint.rgb, a);
}`;

const LINE_VERT = `
attribute vec4 tint;
varying vec4 vTint;
varying float vFade;
void main() {
  vTint = tint;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vFade = clamp((-mv.z - 4.0) / 10.0, 0.0, 1.0);
  gl_Position = projectionMatrix * mv;
}`;

const LINE_FRAG = `
varying vec4 vTint;
varying float vFade;
void main() {
  float a = vTint.a * (1.0 - vFade * 0.6);
  if (a <= 0.003) discard;
  gl_FragColor = vec4(vTint.rgb, a);
}`;

function rand(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = Math.imul(s ^ (s >>> 15), 1 | s);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (x) => { const y = Math.max(0, Math.min(1, x)); return y * y * (3 - 2 * y); };
const pulse = (t, period) => smooth(0.5 - 0.5 * Math.cos((2 * Math.PI * t) / period));

class Field {
  constructor(maxPoints, maxLines, p) {
    this.p = p;
    this.np = maxPoints;
    this.nl = maxLines;
    this.pos = new Float32Array(maxPoints * 3);
    this.size = new Float32Array(maxPoints);
    this.tint = new Float32Array(maxPoints * 4);
    this.lpos = new Float32Array(maxLines * 6);
    this.ltint = new Float32Array(maxLines * 8);
    const pg = new BufferGeometry();
    pg.setAttribute("position", new BufferAttribute(this.pos, 3));
    pg.setAttribute("size", new BufferAttribute(this.size, 1));
    pg.setAttribute("tint", new BufferAttribute(this.tint, 4));
    const blending = p.dark ? AdditiveBlending : NormalBlending;
    this.pointMat = new ShaderMaterial({ vertexShader: POINT_VERT, fragmentShader: POINT_FRAG, uniforms: { uScale: { value: 1 }, uPixel: { value: 1 }, uGlow: { value: p.dark ? 1 : 0 } }, transparent: true, depthWrite: false, blending });
    this.points = new Points(pg, this.pointMat);
    this.points.frustumCulled = false;
    const lg = new BufferGeometry();
    lg.setAttribute("position", new BufferAttribute(this.lpos, 3));
    lg.setAttribute("tint", new BufferAttribute(this.ltint, 4));
    this.lines = new LineSegments(lg, new ShaderMaterial({ vertexShader: LINE_VERT, fragmentShader: LINE_FRAG, transparent: true, depthWrite: false, blending }));
    this.lines.frustumCulled = false;
    this.group = new Group();
    this.group.add(this.lines, this.points);
    this.i = 0;
    this.j = 0;
  }
  begin() { this.i = 0; this.j = 0; }
  point(x, y, z, size, c, a) {
    if (this.i >= this.np) return;
    const i = this.i++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.size[i] = size;
    this.tint[i * 4] = c.r; this.tint[i * 4 + 1] = c.g; this.tint[i * 4 + 2] = c.b; this.tint[i * 4 + 3] = a;
  }
  line(a, b, c, alpha, c2, alpha2) {
    if (this.j >= this.nl || alpha <= 0.002) return;
    const j = this.j++;
    this.lpos.set(a, j * 6);
    this.lpos.set(b, j * 6 + 3);
    const d = c2 || c;
    this.ltint[j * 8] = c.r; this.ltint[j * 8 + 1] = c.g; this.ltint[j * 8 + 2] = c.b; this.ltint[j * 8 + 3] = alpha;
    this.ltint[j * 8 + 4] = d.r; this.ltint[j * 8 + 5] = d.g; this.ltint[j * 8 + 6] = d.b; this.ltint[j * 8 + 7] = alpha2 === undefined ? alpha : alpha2;
  }
  end() {
    const pg = this.points.geometry, lg = this.lines.geometry;
    pg.setDrawRange(0, this.i);
    lg.setDrawRange(0, this.j * 2);
    for (const k of ["position", "size", "tint"]) pg.attributes[k].needsUpdate = true;
    for (const k of ["position", "tint"]) lg.attributes[k].needsUpdate = true;
  }
}

function ramp(p, k) {
  const lo = p.dark ? p.text : p.muted;
  return p.accent.clone().lerp(lo, Math.max(0, Math.min(1, k)));
}

function tokens(p) {
  const f = new Field(220, 220, p);
  const r = rand(11);
  const text = "the model never sees letters only token ids";
  const chars = [...text];
  const groups = [];
  let cur = [];
  chars.forEach((ch, i) => {
    if (ch === " ") { if (cur.length) groups.push(cur); cur = []; return; }
    cur.push(i);
    if (cur.length >= 2 + Math.floor(r() * 3)) { groups.push(cur); cur = []; }
  });
  if (cur.length) groups.push(cur);
  const n = chars.length;
  const jitter = chars.map(() => [r() - 0.5, r() - 0.5]);
  return {
    f,
    camera: [0, 0.9, 9], extent: [10.2, 3.2], center: 0.45,
    update(t) {
      f.begin();
      const merge = pulse(t, 8);
      const span = 9;
      const flow = (t * 0.35) % 1;
      groups.forEach((g, gi) => {
        const center = g.reduce((s, i) => s + i, 0) / g.length;
        const cx = ((center / (n - 1)) - 0.5) * span;
        const col = ramp(p, (gi % 5) * 0.12);
        const idY = 1.25 + Math.sin(t * 0.7 + gi) * 0.06;
        const idZ = Math.sin(gi * 1.7) * 0.4;
        const idPos = [cx, idY, idZ];
        f.point(idPos[0], idPos[1], idPos[2], 12 + 8 * merge, col, 0.35 + 0.65 * merge);
        g.forEach((i, k) => {
          const base = ((i / (n - 1)) - 0.5) * span;
          const tight = cx + (k - (g.length - 1) / 2) * 0.16;
          const x = base + (tight - base) * merge;
          const wave = Math.sin(base * 1.2 - t * 1.4) * 0.18 * (1 - merge * 0.6);
          const y = -0.35 + wave + jitter[i][1] * 0.12 * (1 - merge);
          const z = jitter[i][0] * 0.5 * (1 - merge);
          const lit = Math.max(0, 1 - Math.abs(((i / n) - flow + 1) % 1 - 0.0) * 6);
          f.point(x, y, z, 9 + 4 * lit, ramp(p, 0.15 + 0.5 * (1 - merge)), 0.75 + 0.25 * lit);
          if (k > 0) {
            const pi = g[k - 1];
            const pb = ((pi / (n - 1)) - 0.5) * span;
            const pt = cx + (k - 1 - (g.length - 1) / 2) * 0.16;
            const px = pb + (pt - pb) * merge;
            const py = -0.35 + Math.sin(pb * 1.2 - t * 1.4) * 0.18 * (1 - merge * 0.6) + jitter[pi][1] * 0.12 * (1 - merge);
            f.line([px, py, jitter[pi][0] * 0.5 * (1 - merge)], [x, y, z], col, 0.25 + 0.55 * merge);
          }
          f.line([x, y, z], idPos, col, 0.05 + 0.3 * merge * merge, col, 0.02 + 0.5 * merge * merge);
        });
      });
      f.end();
    },
  };
}

function attention(p) {
  const f = new Field(80, 400, p);
  const n = 12;
  const r = rand(5);
  const affinity = Array.from({ length: n }, () => Array.from({ length: n }, () => r() * 2.6));
  const rowPos = (i, y, t) => {
    const x = (i / (n - 1) - 0.5) * 8.4;
    return [x, y + Math.sin(x * 0.6 + t * 0.5) * 0.08, -Math.cos((i / (n - 1) - 0.5) * 2.2) * 0.9 + 0.6];
  };
  return {
    f,
    camera: [0, 1.4, 8.6], extent: [9.6, 3.0],
    update(t) {
      f.begin();
      const cycle = (t / 1.3) % n;
      const q = Math.floor(cycle);
      const ease = smooth((cycle - q) * 2.5);
      const muted = p.dark ? p.text : p.muted;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j <= i; j++) {
          if (i === q) continue;
          f.line(rowPos(i, 1.1, t), rowPos(j, -1.1, t), muted, 0.05);
        }
      }
      const scores = [];
      let sum = 0;
      for (let j = 0; j <= q; j++) { const s = Math.exp(affinity[q][j] + (j === q ? 0.8 : 0)); scores.push(s); sum += s; }
      for (let j = 0; j <= q; j++) {
        const w = scores[j] / sum;
        f.line(rowPos(q, 1.1, t), rowPos(j, -1.1, t), p.accent, Math.min(1, 0.15 + 2.4 * w) * ease, p.accent, Math.min(1, 0.1 + 2 * w) * ease);
      }
      for (let i = 0; i < n; i++) {
        const a = rowPos(i, 1.1, t);
        const on = i === q;
        f.point(a[0], a[1], a[2], on ? 30 : 14, on ? p.accent : ramp(p, 0.55), on ? 1 : 0.8);
        const b = rowPos(i, -1.1, t);
        const w = i <= q ? scores[i] / sum : 0;
        f.point(b[0], b[1], b[2], 12 + 34 * w * ease, ramp(p, 0.6 - 0.6 * Math.min(1, w * 3 * ease)), i > q ? 0.35 : 0.9);
      }
      f.end();
    },
  };
}

function layers(p) {
  const f = new Field(160, 900, p);
  const L = 7, N = 9;
  const node = (l, k) => {
    const a = (k / N) * Math.PI * 2;
    return [(l / (L - 1) - 0.5) * 8.6, Math.sin(a) * 1.15, Math.cos(a) * 0.9];
  };
  const r = rand(3);
  const signals = Array.from({ length: 26 }, (_, i) => ({ off: r() * L, k0: Math.floor(r() * N), seed: i * 7 + 1 }));
  const pick = (seed, l) => Math.floor(rand(seed * 31 + l * 7)() * N);
  return {
    f,
    camera: [0, 0.6, 9.4], extent: [9.6, 3.0],
    update(t) {
      f.begin();
      const muted = p.dark ? p.text : p.muted;
      const glow = new Float32Array(L * N);
      for (let l = 0; l < L - 1; l++) for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) {
        if ((a + b + l) % 2) continue;
        f.line(node(l, a), node(l + 1, b), muted, 0.07);
      }
      for (const s of signals) {
        const prog = (t * 0.9 + s.off) % L;
        const l = Math.floor(prog);
        if (l >= L - 1) continue;
        const local = smooth(prog - l);
        const a = l === 0 ? s.k0 : pick(s.seed, l);
        const b = pick(s.seed, l + 1);
        const A = node(l, a), B = node(l + 1, b);
        const x = A[0] + (B[0] - A[0]) * local, y = A[1] + (B[1] - A[1]) * local, z = A[2] + (B[2] - A[2]) * local;
        const tail = Math.max(0, local - 0.35);
        const T = [A[0] + (B[0] - A[0]) * tail, A[1] + (B[1] - A[1]) * tail, A[2] + (B[2] - A[2]) * tail];
        f.line(T, [x, y, z], p.accent, 0.0, p.accent, 0.85);
        f.point(x, y, z, 11, p.accent, 1);
        glow[(l + 1) * N + b] = Math.max(glow[(l + 1) * N + b], local);
        glow[l * N + a] = Math.max(glow[l * N + a], 1 - local);
      }
      for (let l = 0; l < L; l++) for (let k = 0; k < N; k++) {
        const g = glow[l * N + k];
        const P = node(l, k);
        f.point(P[0], P[1], P[2], 13 + 12 * g, ramp(p, 0.55 - 0.55 * g), 0.75 + 0.25 * g);
      }
      f.end();
    },
  };
}

function orbit(p) {
  const f = new Field(260, 260, p);
  const tools = 6;
  const r = rand(9);
  const msgs = Array.from({ length: 14 }, () => ({ tool: Math.floor(r() * tools), off: r() * 4, speed: 0.7 + r() * 0.5 }));
  const toolPos = (i, t) => {
    const ring = i % 2;
    const a = t * (ring ? -0.16 : 0.12) + (i / tools) * Math.PI * 2;
    const R = ring ? 3.4 : 2.3;
    const tilt = ring ? 0.35 : -0.25;
    return [Math.cos(a) * R, Math.sin(a) * R * Math.sin(tilt), Math.sin(a) * R * Math.cos(tilt) * 0.6];
  };
  return {
    f,
    camera: [0, 1.1, 8.6], extent: [7.8, 3.2],
    update(t) {
      f.begin();
      const muted = p.dark ? p.text : p.muted;
      for (let ring = 0; ring < 2; ring++) {
        const R = ring ? 3.4 : 2.3, tilt = ring ? 0.35 : -0.25;
        for (let k = 0; k < 60; k++) {
          const a = (k / 60) * Math.PI * 2;
          f.point(Math.cos(a) * R, Math.sin(a) * R * Math.sin(tilt), Math.sin(a) * R * Math.cos(tilt) * 0.6, 3.5, muted, 0.35);
        }
      }
      f.point(0, 0, 0, 46 + 4 * Math.sin(t * 2), p.accent, 1);
      f.point(0, 0, 0, 80, p.accent, 0.18);
      for (let i = 0; i < tools; i++) {
        const P = toolPos(i, t);
        f.line([0, 0, 0], P, muted, 0.1);
        f.point(P[0], P[1], P[2], 22, ramp(p, 0.35), 0.95);
      }
      for (const m of msgs) {
        const prog = ((t * m.speed + m.off) % 4) / 4;
        const P = toolPos(m.tool, t);
        const out = prog < 0.5;
        const k = smooth(out ? prog * 2 : (1 - prog) * 2);
        const lift = Math.sin(k * Math.PI) * 0.7;
        const x = P[0] * k, y = P[1] * k + lift * (out ? 1 : -1), z = P[2] * k;
        const k2 = Math.max(0, k - 0.12);
        const lift2 = Math.sin(k2 * Math.PI) * 0.7;
        f.line([P[0] * k2, P[1] * k2 + lift2 * (out ? 1 : -1), P[2] * k2], [x, y, z], out ? p.accent : ramp(p, 0.3), 0, out ? p.accent : ramp(p, 0.3), 0.8);
        f.point(x, y, z, 9, out ? p.accent : ramp(p, 0.3), 0.95);
      }
      f.end();
    },
  };
}

function quant(p) {
  const nx = 36, nz = 8, levels = 7;
  const f = new Field(nx * nz + levels * 50, nx * nz, p);
  return {
    f,
    camera: [0, 1.8, 8.8], extent: [9.4, 3.2],
    update(t) {
      f.begin();
      const q = pulse(t, 7);
      const step = 2.4 / (levels - 1);
      const muted = p.dark ? p.text : p.muted;
      for (let l = 0; l < levels; l++) {
        const y = -1.2 + l * step;
        for (let k = 0; k < 50; k++) f.point((k / 49 - 0.5) * 8.8, y, -1.4, 3, muted, 0.28);
      }
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        const x = (i / (nx - 1) - 0.5) * 8.6;
        const z = (j / (nz - 1) - 0.5) * 2.6;
        const y = Math.sin(x * 0.85 + t * 0.55 + j * 0.3) * 0.8 + Math.sin(x * 0.31 - j * 0.45 + t * 0.2) * 0.32;
        const yq = Math.max(-1.2, Math.min(1.2, Math.round((y + 1.2) / step) * step - 1.2));
        const err = Math.abs(yq - y) / (step / 2);
        const yy = y + (yq - y) * q;
        if (q > 0.05) f.line([x, y, z], [x, yy, z], p.accent, 0.35 * q * err);
        f.point(x, yy, z, 4.5 + 5 * err * q, ramp(p, 0.5 - 0.5 * err * q), 0.9);
      }
      f.end();
    },
  };
}

function cloud(p) {
  const r = rand(21);
  const K = 6, per = 26;
  const centers = Array.from({ length: K }, (_, c) => [Math.cos(c * 2.3) * 3.1, Math.sin(c * 1.9) * 0.9, Math.sin(c * 2.3) * 1.4]);
  const gauss = () => { const u = Math.max(1e-6, r()), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const pts = [];
  centers.forEach((c, ci) => { for (let k = 0; k < per; k++) pts.push({ x: c[0] + gauss() * 0.42, y: c[1] + gauss() * 0.3, z: c[2] + gauss() * 0.42, c: ci }); });
  const knn = pts.map((a, i) => pts.map((b, j) => [j, (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2]).filter(([j]) => j !== i).sort((u, v) => u[1] - v[1]).slice(0, 2).map(([j]) => j));
  const f = new Field(pts.length + 4, pts.length * 2 + 10, p);
  return {
    f,
    camera: [0, 1.0, 9.2], extent: [8.6, 3.0],
    update(t) {
      f.begin();
      const muted = p.dark ? p.text : p.muted;
      const seg = (t / 4) % K;
      const a = centers[Math.floor(seg)], b = centers[(Math.floor(seg) + 1) % K];
      const k = smooth((seg % 1) * 1.6 - 0.3);
      const Q = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k + Math.sin(k * Math.PI) * 0.9, a[2] + (b[2] - a[2]) * k];
      const dist = pts.map((pt, i) => [i, (pt.x - Q[0]) ** 2 + (pt.y - Q[1]) ** 2 + (pt.z - Q[2]) ** 2]).sort((u, v) => u[1] - v[1]);
      const near = new Map(dist.slice(0, 5).map(([i], rank) => [i, rank]));
      pts.forEach((pt, i) => knn[i].forEach((j) => { if (j > i || !knn[j].includes(i)) f.line([pt.x, pt.y, pt.z], [pts[j].x, pts[j].y, pts[j].z], muted, 0.16); }));
      near.forEach((rank, i) => f.line(Q, [pts[i].x, pts[i].y, pts[i].z], p.accent, 0.95 - rank * 0.13, p.accent, 0.6 - rank * 0.08));
      pts.forEach((pt, i) => {
        const hit = near.has(i);
        f.point(pt.x, pt.y, pt.z, hit ? 19 : 10, hit ? p.accent : ramp(p, 0.2 + 0.12 * pt.c), hit ? 1 : 0.85);
      });
      f.point(Q[0], Q[1], Q[2], 30, p.accent, 1);
      f.point(Q[0], Q[1], Q[2], 64, p.accent, 0.16);
      f.end();
    },
  };
}

const BUILDERS = { tokens, attention, layers, orbit, quant, cloud };

export function mountLesson(el, kind, palette) {
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
  let scene, camera, world;
  let visible = true, raf = 0, baseScale = 1;
  const tilt = new Vector2(0, 0), target = new Vector2(0, 0);
  const start = performance.now();
  function build() {
    scene = new Scene();
    camera = new PerspectiveCamera(34, 1, 0.1, 100);
    world = (BUILDERS[kind] || cloud)(palette(el));
    scene.add(world.f.group);
    resize();
  }
  function resize() {
    const w = el.clientWidth || 1, h = el.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    baseScale = Math.min(h, 360) * renderer.getPixelRatio() * (world.f.p.dark ? 0.05 : 0.042);
    world.f.pointMat.uniforms.uPixel.value = renderer.getPixelRatio();
  }
  function frame(now) {
    raf = 0;
    const t = reduce.matches ? 9.5 : Math.max(0, (now - start) / 1000);
    tilt.lerp(target, 0.06);
    const [cx, cy, cz] = world.camera;
    const half = Math.tan((camera.fov * Math.PI) / 360);
    const d = Math.max(world.extent[0] / (0.86 * 2 * half * camera.aspect), world.extent[1] / (0.8 * 2 * half), 4.5);
    const lift = cy / Math.hypot(cx, cz);
    const yaw = (reduce.matches ? 0 : Math.sin(t * 0.12) * 0.22) + tilt.x * 0.35;
    const pitch = tilt.y * 0.2;
    camera.position.set(Math.sin(yaw) * d, (lift + pitch) * d, Math.cos(yaw) * d);
    world.f.pointMat.uniforms.uScale.value = baseScale * d / 9;
    camera.position.y += world.center || 0;
    camera.lookAt(0, world.center || 0, 0);
    world.update(t);
    renderer.render(scene, camera);
    if (!reduce.matches && visible && !document.hidden) raf = requestAnimationFrame(frame);
  }
  function kick() { if (!raf) raf = requestAnimationFrame(frame); }
  build();
  kick();
  new IntersectionObserver((entries) => { visible = entries[0].isIntersecting; if (visible) kick(); }).observe(el);
  new ResizeObserver(() => { resize(); kick(); }).observe(el);
  document.addEventListener("visibilitychange", kick);
  reduce.addEventListener("change", kick);
  el.addEventListener("pointermove", (e) => {
    const b = el.getBoundingClientRect();
    target.set(((e.clientX - b.left) / b.width - 0.5) * 2, ((e.clientY - b.top) / b.height - 0.5) * 2);
    kick();
  });
  el.addEventListener("pointerleave", () => { target.set(0, 0); kick(); });
  const rebuild = () => { scene.remove(world.f.group); build(); kick(); };
  new MutationObserver(rebuild).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", rebuild);
  el.classList.add("is-ready");
  return { kick };
}


