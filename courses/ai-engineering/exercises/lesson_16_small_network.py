import numpy as np


def make_moons(n, noise, rng):
    half = n // 2
    angle_top = rng.uniform(0, np.pi, half)
    angle_bottom = rng.uniform(0, np.pi, n - half)
    top = np.stack([np.cos(angle_top), np.sin(angle_top)], axis=1)
    bottom = np.stack([1 - np.cos(angle_bottom), 0.5 - np.sin(angle_bottom)], axis=1)
    x = np.concatenate([top, bottom]) + rng.normal(0, noise, (n, 2))
    y = np.concatenate([np.zeros(half, dtype=int), np.ones(n - half, dtype=int)])
    order = rng.permutation(n)
    return x[order], y[order]


def init_params(hidden, rng):
    return {
        "W1": rng.normal(0, 1, (2, hidden)),
        "b1": np.zeros(hidden),
        "W2": rng.normal(0, 1 / np.sqrt(hidden), (hidden, 2)),
        "b2": np.zeros(2),
    }


def forward(params, x):
    h = np.tanh(x @ params["W1"] + params["b1"])
    logits = h @ params["W2"] + params["b2"]
    shifted = logits - logits.max(axis=1, keepdims=True)
    probs = np.exp(shifted) / np.exp(shifted).sum(axis=1, keepdims=True)
    return h, probs


def loss_and_grads(params, x, y, weight_decay=0.0, skip_tanh_derivative=False):
    n = len(y)
    h, probs = forward(params, x)
    data_loss = -np.log(probs[np.arange(n), y]).mean()
    penalty = 0.5 * weight_decay * ((params["W1"] ** 2).sum() + (params["W2"] ** 2).sum())
    d_logits = probs.copy()
    d_logits[np.arange(n), y] -= 1
    d_logits /= n
    d_h = d_logits @ params["W2"].T
    d_z1 = d_h if skip_tanh_derivative else d_h * (1 - h ** 2)
    grads = {
        "W2": h.T @ d_logits + weight_decay * params["W2"],
        "b2": d_logits.sum(axis=0),
        "W1": x.T @ d_z1 + weight_decay * params["W1"],
        "b1": d_z1.sum(axis=0),
    }
    return data_loss + penalty, grads


def evaluate(params, x, y):
    _, probs = forward(params, x)
    loss = -np.log(probs[np.arange(len(y)), y]).mean()
    accuracy = (probs.argmax(axis=1) == y).mean()
    return loss, accuracy


def train(params, x_train, y_train, x_val, y_val, epochs, lr, batch_size, weight_decay, rng, report_every):
    history = []
    for epoch in range(1, epochs + 1):
        order = rng.permutation(len(y_train))
        for start in range(0, len(order), batch_size):
            batch = order[start:start + batch_size]
            _, grads = loss_and_grads(params, x_train[batch], y_train[batch], weight_decay)
            for name in params:
                params[name] -= lr * grads[name]
        train_loss, train_acc = evaluate(params, x_train, y_train)
        val_loss, val_acc = evaluate(params, x_val, y_val)
        history.append((epoch, train_loss, train_acc, val_loss, val_acc))
        if report_every and epoch % report_every == 0:
            print(f"  epoch {epoch:>4}  train loss {train_loss:.3f} acc {train_acc:.3f}  |  val loss {val_loss:.3f} acc {val_acc:.3f}")
    return history


rng = np.random.default_rng(16)
x_all, y_all = make_moons(600, 0.2, rng)
x_train, y_train, x_val, y_val = x_all[:400], y_all[:400], x_all[400:], y_all[400:]

print("=== Part 1: shapes ===")
params = init_params(16, rng)
hidden, probs = forward(params, x_train[:32])
print(f"x batch {x_train[:32].shape} -> hidden {hidden.shape} -> probs {probs.shape}")
print(f"parameters: W1 {params['W1'].shape}, b1 {params['b1'].shape}, W2 {params['W2'].shape}, b2 {params['b2'].shape}")
print(f"parameter count = {sum(p.size for p in params.values())}")
untrained_loss, untrained_acc = evaluate(params, x_val, y_val)
print(f"untrained val loss = {untrained_loss:.3f}  (ln 2 = {np.log(2):.3f})")

print("\n=== Part 2: gradient check against finite differences ===")
check_x, check_y = x_train[:20], y_train[:20]


def max_relative_error(skip_tanh_derivative):
    _, analytic = loss_and_grads(params, check_x, check_y, 0.01, skip_tanh_derivative)
    eps = 1e-5
    worst = 0.0
    for name in params:
        for index in np.ndindex(params[name].shape):
            saved = params[name][index]
            params[name][index] = saved + eps
            plus, _ = loss_and_grads(params, check_x, check_y, 0.01)
            params[name][index] = saved - eps
            minus, _ = loss_and_grads(params, check_x, check_y, 0.01)
            params[name][index] = saved
            numeric = (plus - minus) / (2 * eps)
            denominator = max(abs(numeric) + abs(analytic[name][index]), 1e-8)
            worst = max(worst, abs(numeric - analytic[name][index]) / denominator)
    return worst


print(f"checked {sum(p.size for p in params.values())} partial derivatives, two loss evaluations each")
print(f"correct backprop: max relative error below 1e-6 = {max_relative_error(False) < 1e-6}")
print(f"buggy backprop (tanh derivative left out): max relative error = {max_relative_error(True):.3f}")

print("\n=== Part 3: mini-batch SGD, 400 train / 200 validation points ===")
history = train(params, x_train, y_train, x_val, y_val, 100, 0.5, 32, 0.0, rng, 20)
print(f"steps per epoch = {int(np.ceil(400 / 32))}")
final = history[-1]
print(f"final train acc = {final[2]:.3f}, final val acc = {final[4]:.3f}")

print("\n=== Part 4: a big network on 30 noisy points ===")
small_rng = np.random.default_rng(160)
x_small, y_small = make_moons(30, 0.35, small_rng)
x_big_val, y_big_val = make_moons(500, 0.35, small_rng)
start_params = init_params(100, small_rng)
print(f"parameters = {sum(p.size for p in start_params.values())}, training points = {len(y_small)}")
runs = {}
for label, decay in [("no weight decay", 0.0), ("weight decay 0.01", 0.01)]:
    print(f"{label}:")
    params = {name: value.copy() for name, value in start_params.items()}
    runs[label] = train(params, x_small, y_small, x_big_val, y_big_val, 1500, 0.2, 30, decay, np.random.default_rng(1), 300)

plain = runs["no weight decay"]
best = min(plain, key=lambda row: row[3])
print(f"no decay, final: train acc {plain[-1][2]:.3f}, val acc {plain[-1][4]:.3f}, val loss {plain[-1][3]:.3f}")
print(f"early stopping: best val loss {best[3]:.3f} at epoch {best[0]}, val acc there {best[4]:.3f}")
decayed = runs["weight decay 0.01"]
print(f"weight decay, final: train acc {decayed[-1][2]:.3f}, val acc {decayed[-1][4]:.3f}, val loss {decayed[-1][3]:.3f}")
