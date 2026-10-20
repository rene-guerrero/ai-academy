import json
import sys
from pathlib import Path

import numpy as np
from sentence_transformers import SentenceTransformer

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist" / "search"
OUT = ROOT / "runtime-cache" / "search"
LANGS = ["en", "es"]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    model = SentenceTransformer("all-MiniLM-L6-v2", device="cpu")
    for lang in LANGS:
        source = DIST / f"{lang}-chunks.json"
        if not source.exists():
            raise SystemExit(f"{source} is missing; run npm run build first")
        data = json.loads(source.read_text(encoding="utf-8"))
        texts = [f"{c['title']}. {c['heading']}\n{c['text']}" for c in data["chunks"]]
        vectors = model.encode(texts, normalize_embeddings=True, batch_size=32).astype(np.float16)
        (OUT / f"{lang}-vectors.bin").write_bytes(vectors.tobytes())
        (OUT / f"{lang}-vectors.json").write_text(json.dumps({"hash": data["hash"], "dim": int(vectors.shape[1]), "n": int(vectors.shape[0])}))
        print(f"[search] {lang}: {len(texts)} chunks embedded ({vectors.nbytes // 1024} KB)", flush=True)
    queries = json.loads((ROOT / "tests" / "search-eval.json").read_text(encoding="utf-8"))["queries"]
    result = {"model": "all-MiniLM-L6-v2"}
    for lang in LANGS:
        texts = [q[lang] for q in queries]
        vectors = model.encode(texts, normalize_embeddings=True)
        result[lang] = {t: [round(float(x), 6) for x in v] for t, v in zip(texts, vectors)}
    (OUT / "queries.json").write_text(json.dumps(result))
    print(f"[search] {len(queries)} evaluation queries embedded per language", flush=True)


if __name__ == "__main__":
    sys.exit(main())
