import math

import numpy as np

state = {}


def softmax(z):
    z = z - z.max(axis=-1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=-1, keepdims=True)


def train(corpus, lr, steps, seed):
    words = corpus.split()
    if len(words) < 3:
        raise ValueError("The corpus needs at least three words.")
    vocab = sorted(set(words))
    index = {w: i for i, w in enumerate(vocab)}
    ids = np.array([index[w] for w in words])
    inputs, targets = ids[:-1], ids[1:]
    V = len(vocab)
    rng = np.random.default_rng(int(seed))
    W = rng.normal(size=(V, V)) * 0.01
    every = max(1, steps // 40)
    losses, snapshots, snap_steps = [], [W.copy()], [0]
    rows = np.arange(len(targets))
    for step in range(1, steps + 1):
        p = softmax(W[inputs])
        losses.append(float(-np.log(p[rows, targets]).mean()))
        g = p.copy()
        g[rows, targets] -= 1
        g /= len(targets)
        grad = np.zeros_like(W)
        np.add.at(grad, inputs, g)
        W -= lr * grad
        if step % every == 0 or step == steps:
            snapshots.append(W.copy())
            snap_steps.append(step)
    pairs = {}
    contexts = {}
    for a, b in zip(inputs.tolist(), targets.tolist()):
        pairs[(a, b)] = pairs.get((a, b), 0) + 1
        contexts[a] = contexts.get(a, 0) + 1
    floor = -sum(math.log(pairs[(a, b)] / contexts[a]) for a, b in zip(inputs.tolist(), targets.tolist())) / len(targets)
    final = float(-np.log(softmax(W[inputs])[rows, targets]).mean())
    state.update(vocab=vocab, index=index, snapshots=snapshots, steps=snap_steps)
    return {"vocab": vocab, "losses": [round(x, 4) for x in losses], "final": round(final, 4), "uniform": round(math.log(V), 4), "floor": round(floor, 4), "checkpoints": snap_steps, "words": len(words)}


def nucleus(p, top_p):
    order = np.argsort(-p)
    cumulative = np.cumsum(p[order])
    keep = order[: int(np.searchsorted(cumulative, top_p - 1e-12) + 1)]
    return set(keep.tolist())


def distribution(checkpoint, word, temperature, top_p):
    W = state["snapshots"][checkpoint]
    p = softmax(W[state["index"][word]] / temperature)
    kept = nucleus(p, top_p)
    order = np.argsort(-p)[:12]
    entropy = float(-(p * np.log(p + 1e-12)).sum())
    return {"step": state["steps"][checkpoint], "entropy": round(entropy, 3), "rows": [{"word": state["vocab"][i], "p": round(float(p[i]), 4), "kept": i in kept} for i in order.tolist()]}


def sample(checkpoint, start, temperature, top_p, length, seed):
    W = state["snapshots"][checkpoint]
    rng = np.random.default_rng(int(seed))
    out = [state["index"][start]]
    for _ in range(int(length)):
        p = softmax(W[out[-1]] / temperature)
        kept = sorted(nucleus(p, top_p))
        q = np.zeros_like(p)
        q[kept] = p[kept]
        q /= q.sum()
        out.append(int(rng.choice(len(p), p=q)))
    return " ".join(state["vocab"][i] for i in out)
