const STOP = new Set(("a an and are as at be by can do does for from has have how i if in into is it its of on or so than that the their then there these this to was what when where which who why will with you your " +
  "al como con cual cuando de del donde el en es esta este esto la las lo los mas para pero por que se sin son su sus un una uno y o hay qué cómo").split(" ").map((w) => fold(w)));

export function fold(s) {
  return String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function stem(w) {
  if (w.length > 5 && w.endsWith("es") && !w.endsWith("ses")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

export function tokenize(s) {
  return (fold(s).match(/[a-z0-9@]+/g) || []).filter((w) => w.length > 1 && !STOP.has(w)).map(stem);
}

export function bm25(docs, k1 = 1.2, b = 0.75) {
  const tf = docs.map((d) => {
    const m = new Map();
    for (const w of d) m.set(w, (m.get(w) || 0) + 1);
    return m;
  });
  const df = new Map();
  for (const m of tf) for (const w of m.keys()) df.set(w, (df.get(w) || 0) + 1);
  const n = docs.length;
  const avg = docs.reduce((s, d) => s + d.length, 0) / Math.max(1, n);
  return function score(query) {
    const out = new Float64Array(n);
    for (const w of new Set(query)) {
      const f = df.get(w);
      if (!f) continue;
      const idf = Math.log(1 + (n - f + 0.5) / (f + 0.5));
      for (let i = 0; i < n; i++) {
        const c = tf[i].get(w);
        if (c) out[i] += idf * (c * (k1 + 1)) / (c + k1 * (1 - b + b * docs[i].length / avg));
      }
    }
    return out;
  };
}

export function decodeF16(u16) {
  const out = new Float32Array(u16.length);
  for (let i = 0; i < u16.length; i++) {
    const h = u16[i];
    const s = h & 0x8000 ? -1 : 1;
    const e = (h >> 10) & 0x1f;
    const f = h & 0x3ff;
    out[i] = e === 0 ? s * 2 ** -14 * (f / 1024) : e === 31 ? (f ? NaN : s * Infinity) : s * 2 ** (e - 15) * (1 + f / 1024);
  }
  return out;
}

export function cosine(vectors, dim, q) {
  const n = vectors.length / dim;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const o = i * dim;
    for (let j = 0; j < dim; j++) s += vectors[o + j] * q[j];
    out[i] = s;
  }
  return out;
}

export function sections(scores, chunks, positiveOnly) {
  const order = [...scores.keys()].filter((i) => !positiveOnly || scores[i] > 0).sort((a, b) => scores[b] - scores[a]);
  const seen = new Map();
  for (const i of order) if (!seen.has(chunks[i].section)) seen.set(chunks[i].section, i);
  return [...seen].map(([section, chunk]) => ({ section, chunk, score: scores[chunk] }));
}

export function rrf(lists, k = 60) {
  const total = new Map();
  for (const list of lists) list.forEach((x, r) => {
    const cur = total.get(x.section) || { section: x.section, chunk: x.chunk, score: 0 };
    cur.score += 1 / (k + r + 1);
    total.set(x.section, cur);
  });
  return [...total.values()].sort((a, b) => b.score - a.score);
}

export function search(index, query, qvec) {
  const lexical = sections(index.bm25(tokenize(query)), index.chunks, true);
  if (!qvec || !index.vectors) return { mode: "bm25", results: lexical };
  const semantic = sections(cosine(index.vectors, index.dim, qvec), index.chunks, false);
  return { mode: "hybrid", results: rrf([lexical.slice(0, 50), semantic.slice(0, 50)]), lexical, semantic };
}

export function makeIndex(data, vectors) {
  const chunks = data.chunks;
  return { chunks, bm25: bm25(chunks.map((c) => tokenize(`${c.title} ${c.heading} ${c.heading} ${c.text}`))), vectors: vectors || null, dim: data.dim || 384 };
}

export function metrics(ranks, depth = 10) {
  const n = ranks.length || 1;
  const hit = (k) => ranks.filter((r) => r > 0 && r <= k).length / n;
  return { hit1: hit(1), hit3: hit(3), mrr: ranks.reduce((s, r) => s + (r > 0 && r <= depth ? 1 / r : 0), 0) / n };
}
