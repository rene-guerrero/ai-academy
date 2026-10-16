import numpy as np

rng = np.random.default_rng(3)
sample_rng = np.random.default_rng(5)

corpus = (
    "the cat sat on the mat . the dog sat on the rug . "
    "the cat ran to the dog . the dog ran to the cat . "
    "the cat sat on the rug . the dog sat on the mat ."
).split()
vocab = sorted(set(corpus))
index = {w: i for i, w in enumerate(vocab)}
ids = np.array([index[w] for w in corpus])
V = len(vocab)
inputs, targets = ids[:-1], ids[1:]


def softmax(z):
    z = z - z.max(axis=-1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=-1, keepdims=True)


def cross_entropy(logits, targets):
    p = softmax(logits)
    return float(-np.log(p[np.arange(len(targets)), targets]).mean())


print("=== Lesson 5: training and generation ===")
print(f"Vocabulary size = {V}, training pairs = {len(inputs)}")
print("Predict first: what is the loss of a model that knows nothing (uniform over the vocabulary)?")
print(f"ln(V) = {np.log(V):.4f}")

W = rng.normal(size=(V, V)) * 0.01
print(f"Loss of the untrained model = {cross_entropy(W[inputs], targets):.4f}")

print("\n=== Training: gradient descent on next-token cross-entropy ===")
print("Predict: will the loss reach 0? What is the lowest it can go on this corpus, and why?")
lr = 1.0
for step in range(1, 301):
    logits = W[inputs]
    p = softmax(logits)
    grad_logits = p.copy()
    grad_logits[np.arange(len(targets)), targets] -= 1
    grad_logits /= len(targets)
    grad_W = np.zeros_like(W)
    np.add.at(grad_W, inputs, grad_logits)
    W -= lr * grad_W
    if step in (1, 5, 20, 50, 100, 300):
        print(f"step {step:>3}  loss = {cross_entropy(W[inputs], targets):.4f}")

print("\n=== What did it learn? Next-token distribution after selected words ===")
for word in ["the", "sat", "ran", "to", "."]:
    p = softmax(W[index[word]])
    top = np.argsort(-p)[:4]
    print(f"after {word!r:6}: " + ", ".join(f"{vocab[i]} {p[i]:.2f}" for i in top))

print("\n=== Teacher forcing: every position is a training example, computed in one pass ===")
print("Sequence length", len(ids), "gives", len(inputs), "loss terms from a single forward pass.")

print("\n=== Generation: temperature and top-p ===")
print("Predict: what happens to the distribution after 'the' as temperature goes to 0 and to infinity?")
base = W[index["the"]]
for t in [0.2, 0.7, 1.0, 2.0, 5.0]:
    p = softmax(base / t)
    print(f"T={t:<4} " + "  ".join(f"{vocab[i]}={p[i]:.2f}" for i in np.argsort(-p)[:4]) + f"   entropy={-(p * np.log(p + 1e-12)).sum():.2f}")


def sample(logits, temperature=1.0, top_p=1.0):
    p = softmax(logits / temperature)
    order = np.argsort(-p)
    cumulative = np.cumsum(p[order])
    keep = order[: int(np.searchsorted(cumulative, top_p) + 1)]
    q = np.zeros_like(p)
    q[keep] = p[keep]
    q /= q.sum()
    return int(sample_rng.choice(len(p), p=q))


def generate(start, length, temperature, top_p):
    out = [index[start]]
    for _ in range(length):
        out.append(sample(W[out[-1]], temperature, top_p))
    return " ".join(vocab[i] for i in out)


print("\nTop-p keeps the smallest set of tokens whose probability adds up to p.")
for t, tp in [(0.2, 1.0), (1.0, 1.0), (1.0, 0.5), (3.0, 1.0), (3.0, 0.5)]:
    print(f"T={t} top_p={tp}: {generate('the', 14, t, tp)}")
print("\nRun the file twice: both seeds are fixed, so the output repeats. Change the seed of sample_rng and only the sampled lines change.")
