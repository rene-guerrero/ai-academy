import numpy as np

rng = np.random.default_rng(7)

tokens = ["The", "cat", "sat", "down"]
n, d_model, d_head = len(tokens), 8, 4

x = rng.normal(size=(n, d_model))
w_q = rng.normal(size=(d_model, d_head))
w_k = rng.normal(size=(d_model, d_head))
w_v = rng.normal(size=(d_model, d_head))


def softmax(z):
    z = z - z.max(axis=-1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=-1, keepdims=True)


def attention(x, causal=True, scale=True):
    q, k, v = x @ w_q, x @ w_k, x @ w_v
    scores = q @ k.T
    if scale:
        scores = scores / np.sqrt(d_head)
    if causal:
        scores = np.where(np.tril(np.ones_like(scores)) == 1, scores, -np.inf)
    weights = softmax(scores)
    return weights, weights @ v


print("=== Lesson 3: attention ===")
print("Predict before reading the output:")
print("1. Which cells of the weight matrix are exactly 0 with the causal mask?")
print("2. What does each row sum to?")
print("3. What does the first row look like, and why?\n")

weights, out = attention(x)
print("Attention weights (rows = query token, columns = key token)")
print("            " + "  ".join(f"{t:>6}" for t in tokens))
for token, row in zip(tokens, weights):
    print(f"{token:>10}  " + "  ".join(f"{w:6.3f}" for w in row))
print("\nRow sums:", np.round(weights.sum(axis=1), 6))
print("Output shape:", out.shape)

print("\n=== Experiment A: change the LAST token, look at the FIRST output ===")
x_changed = x.copy()
x_changed[-1] = rng.normal(size=d_model)
_, out_changed = attention(x_changed)
print("Causal, first row changed?   ", not np.allclose(out[0], out_changed[0]))
print("Causal, last row changed?    ", not np.allclose(out[-1], out_changed[-1]))
_, out_full = attention(x, causal=False)
_, out_full_changed = attention(x_changed, causal=False)
print("No mask, first row changed?  ", not np.allclose(out_full[0], out_full_changed[0]))

print("\n=== Experiment B: remove the 1/sqrt(d) scaling with a larger head size ===")
print("Predict first: which version produces rows closer to one-hot?")
big = 256
xb = rng.normal(size=(n, big))
qb = xb @ (rng.normal(size=(big, big)) / np.sqrt(big))
kb = xb @ (rng.normal(size=(big, big)) / np.sqrt(big))
raw = qb @ kb.T
for label, scores in [("scaled", raw / np.sqrt(big)), ("unscaled", raw)]:
    w = softmax(scores)
    print(f"{label:9} max weight per row: {np.round(w.max(axis=1), 3)}")
print("Which one is closer to a one-hot row, and what does that do to gradients?")

print("\n=== Experiment C: multi-head shapes ===")
heads = 2
parts = []
for _ in range(heads):
    wq, wk, wv = (rng.normal(size=(d_model, d_head)) for _ in range(3))
    q, k, v = x @ wq, x @ wk, x @ wv
    s = np.where(np.tril(np.ones((n, n))) == 1, q @ k.T / np.sqrt(d_head), -np.inf)
    parts.append(softmax(s) @ v)
concat = np.concatenate(parts, axis=-1)
print("Per-head output:", parts[0].shape, " concatenated:", concat.shape)

print("\n=== Experiment D: how the cost grows with context length ===")
print("Predict: doubling the context multiplies the score-matrix size by what?")
for length in [1_000, 2_000, 4_000, 8_000, 16_000]:
    print(f"context={length:>6}  score entries per head per layer={length * length:>13,}")

print("\n=== Experiment E: KV cache ===")
keys, values, produced = [], [], []
x_stream = rng.normal(size=(6, d_model))
for step, vec in enumerate(x_stream):
    keys.append(vec @ w_k)
    values.append(vec @ w_v)
    q = vec @ w_q
    s = np.array(keys) @ q / np.sqrt(d_head)
    produced.append(softmax(s) @ np.array(values))
cached = np.array(produced)
_, full = attention(x_stream)
print("Cached decoding equals full recompute:", np.allclose(cached, full))
print("Key vectors recomputed per step with cache: 1, without cache: step+1")
