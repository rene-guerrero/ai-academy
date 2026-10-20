import numpy as np
from sentence_transformers import SentenceTransformer

model = SentenceTransformer("all-MiniLM-L6-v2")
MAX_TOKENS = 40


def _embed(states, mask):
    m = mask[..., None].astype(np.float32)
    pooled = (states * m).sum(axis=1) / np.clip(m.sum(axis=1), 1e-9, None)
    return pooled / np.clip(np.linalg.norm(pooled, axis=1, keepdims=True), 1e-12, None)


def trace(text):
    ids = model.tokenizer.encode(text, MAX_TOKENS)
    ids_arr = np.array([ids], dtype=np.int64)
    mask = np.ones_like(ids_arr)
    steps = []
    states = model._forward(ids_arr, mask, steps)
    tokens = [model.tokenizer.ids_to_tokens[i] for i in ids]
    attention = [np.round(s["attention"][0], 3).tolist() for s in steps if "attention" in s]
    norms = [np.round(np.linalg.norm(s["states"][0], axis=-1), 3).tolist() for s in steps]
    return {"tokens": tokens, "attention": attention, "norms": norms, "embedding": _embed(states, mask)[0]}


def inspect(a, b=""):
    first = trace(a)
    result = {"tokens": first["tokens"], "attention": first["attention"], "norms": first["norms"], "dims": int(first["embedding"].shape[0])}
    if b.strip():
        second = trace(b)
        result["compare"] = {"tokens": second["tokens"], "similarity": round(float(first["embedding"] @ second["embedding"]), 4)}
    return result
