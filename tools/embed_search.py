import json
import sys
from pathlib import Path

import numpy as np
from sentence_transformers import SentenceTransformer

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist" / "search"
OUT = ROOT / "runtime-cache" / "search"
LANGS = ["en", "es"]
MODELS = {
    "minilm": {"name": "all-MiniLM-L6-v2", "query": "", "passage": ""},
    "e5": {"name": "intfloat/multilingual-e5-small", "query": "query: ", "passage": "passage: "},
}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    queries = json.loads((ROOT / "tests" / "search-eval.json").read_text(encoding="utf-8"))["queries"]
    result = {}
    for key, spec in MODELS.items():
        model = SentenceTransformer(spec["name"], device="cpu")
        result[key] = {"model": spec["name"]}
        for lang in LANGS:
            source = DIST / f"{lang}-chunks.json"
            if not source.exists():
                raise SystemExit(f"{source} is missing; run npm run build first")
            data = json.loads(source.read_text(encoding="utf-8"))
            texts = [spec["passage"] + f"{c['title']}. {c['heading']}\n{c['text']}" for c in data["chunks"]]
            vectors = model.encode(texts, normalize_embeddings=True, batch_size=32).astype(np.float16)
            (OUT / f"{lang}-{key}-vectors.bin").write_bytes(vectors.tobytes())
            (OUT / f"{lang}-{key}-vectors.json").write_text(json.dumps({"hash": data["hash"], "dim": int(vectors.shape[1]), "n": int(vectors.shape[0]), "model": spec["name"]}))
            print(f"[search] {key} {lang}: {len(texts)} chunks embedded ({vectors.nbytes // 1024} KB)", flush=True)
            qtexts = [q[lang] for q in queries]
            qv = model.encode([spec["query"] + t for t in qtexts], normalize_embeddings=True)
            result[key][lang] = {t: [round(float(x), 6) for x in v] for t, v in zip(qtexts, qv)}
    (OUT / "queries.json").write_text(json.dumps(result))
    print(f"[search] {len(queries)} evaluation queries embedded per language and model", flush=True)


if __name__ == "__main__":
    sys.exit(main())
