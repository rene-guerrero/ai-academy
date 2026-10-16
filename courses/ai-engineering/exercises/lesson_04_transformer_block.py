import numpy as np

rng = np.random.default_rng(11)

vocab = ["the", "cat", "sat", "on", "mat", "dog", "ran", "."]
token_ids = np.array([0, 1, 2, 3, 0, 4])
n, d_model, n_heads, d_ff, n_layers = len(token_ids), 16, 2, 64, 4
d_head = d_model // n_heads


def softmax(z):
    z = z - z.max(axis=-1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=-1, keepdims=True)


def layer_norm(x, eps=1e-5):
    mean = x.mean(axis=-1, keepdims=True)
    var = x.var(axis=-1, keepdims=True)
    return (x - mean) / np.sqrt(var + eps)


def gelu(x):
    return 0.5 * x * (1 + np.tanh(np.sqrt(2 / np.pi) * (x + 0.044715 * x**3)))


def make_block():
    scale = 0.1
    return {
        "wq": rng.normal(size=(d_model, d_model)) * scale,
        "wk": rng.normal(size=(d_model, d_model)) * scale,
        "wv": rng.normal(size=(d_model, d_model)) * scale,
        "wo": rng.normal(size=(d_model, d_model)) * scale,
        "w1": rng.normal(size=(d_model, d_ff)) * scale,
        "w2": rng.normal(size=(d_ff, d_model)) * scale,
    }


def attention_sublayer(x, p):
    q, k, v = x @ p["wq"], x @ p["wk"], x @ p["wv"]
    heads = []
    mask = np.tril(np.ones((x.shape[0], x.shape[0]))) == 1
    for h in range(n_heads):
        sl = slice(h * d_head, (h + 1) * d_head)
        s = q[:, sl] @ k[:, sl].T / np.sqrt(d_head)
        heads.append(softmax(np.where(mask, s, -np.inf)) @ v[:, sl])
    return np.concatenate(heads, axis=-1) @ p["wo"]


def mlp_sublayer(x, p):
    return gelu(x @ p["w1"]) @ p["w2"]


def block(x, p, use_residual=True, use_norm=True):
    a = attention_sublayer(layer_norm(x) if use_norm else x, p)
    x = x + a if use_residual else a
    m = mlp_sublayer(layer_norm(x) if use_norm else x, p)
    return x + m if use_residual else m


embedding = rng.normal(size=(len(vocab), d_model))
blocks = [make_block() for _ in range(n_layers)]

print("=== Lesson 4: the transformer block ===")
params_attn = 4 * d_model * d_model
params_mlp = 2 * d_model * d_ff
print("Predict first: which sublayer holds more parameters, attention or MLP, and by what ratio?")
print(f"attention params per block = {params_attn}")
print(f"MLP params per block       = {params_mlp}")
print(f"MLP / attention            = {params_mlp / params_attn:.1f}")

x = embedding[token_ids]
print("\n=== The residual stream through the stack ===")
print("Predict: does the norm of each token's vector grow, shrink or stay flat with depth?")
print(f"layer 0 (embeddings) mean norm = {np.linalg.norm(x, axis=-1).mean():.2f}")
stream = x
for i, p in enumerate(blocks, start=1):
    new = block(stream, p)
    delta = np.linalg.norm(new - stream, axis=-1).mean()
    stream = new
    print(f"after block {i}: mean norm = {np.linalg.norm(stream, axis=-1).mean():.2f}   mean update size = {delta:.2f}")

print("\n=== Ablation: does the original token identity survive the stack? ===")
print("Predict: compare cosine(output, original embedding) with and without the residual path.")


def cosine_to_input(out):
    return np.sum(out * x, axis=-1) / (np.linalg.norm(out, axis=-1) * np.linalg.norm(x, axis=-1))


plain = x
for p in blocks:
    plain = block(plain, p, use_residual=False)
print("with residual   :", np.round(cosine_to_input(stream), 2))
print("without residual:", np.round(cosine_to_input(plain), 2))

print("\n=== Layer norm ===")
sample = rng.normal(size=(3, d_model)) * np.array([[1.0], [10.0], [100.0]])
normed = layer_norm(sample)
print("Input std per row :", np.round(sample.std(axis=-1), 2))
print("Output std per row:", np.round(normed.std(axis=-1), 2))
print("Output mean per row:", np.round(normed.mean(axis=-1), 4))

print("\n=== Unembedding: from the last position to next-token probabilities ===")
logits = layer_norm(stream[-1]) @ embedding.T / np.sqrt(d_model)
probs = softmax(logits)
print("Predict: what is the sum of the probabilities, and what shape are the logits?")
print("logits shape:", logits.shape, " probabilities sum:", round(float(probs.sum()), 6))
for i in np.argsort(-probs)[:3]:
    print(f"  {vocab[i]:>4}  p={probs[i]:.3f}")
print("\nNote: the weights are random, so these predictions mean nothing yet. Training (lesson 5) is what makes them useful.")
