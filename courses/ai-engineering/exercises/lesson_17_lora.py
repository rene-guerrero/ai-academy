import numpy as np

rng = np.random.default_rng(17)

d_in, d_out = 64, 64
n_a, n_b, n_test = 2000, 48, 1000
noise = 0.3
steps, lr = 600, 0.05

w_task_a = rng.normal(size=(d_out, d_in)) / np.sqrt(d_in)
true_rank = 4
shift_left = rng.normal(size=(d_out, true_rank))
shift_right = rng.normal(size=(true_rank, d_in)) / np.sqrt(d_in)
w_task_b = w_task_a + 0.5 * shift_left @ shift_right


def make_data(weights, n):
    x = rng.normal(size=(n, d_in))
    y = x @ weights.T + noise * rng.normal(size=(n, d_out))
    return x, y


def mse(weights, x, y):
    return float(np.mean((x @ weights.T - y) ** 2))


x_a, y_a = make_data(w_task_a, n_a)
x_a_test, y_a_test = make_data(w_task_a, n_test)
x_b, y_b = make_data(w_task_b, n_b)
x_b_test, y_b_test = make_data(w_task_b, n_test)

w_pretrained = np.linalg.lstsq(x_a, y_a, rcond=None)[0].T


def grad_wrt_weights(weights, x, y):
    return 2.0 * (x @ weights.T - y).T @ x / len(x)


def full_fine_tune(w_start):
    weights = w_start.copy()
    for _ in range(steps):
        weights -= lr * grad_wrt_weights(weights, x_b, y_b)
    return weights


def lora_fine_tune(w_frozen, rank, alpha, seed):
    local = np.random.default_rng(seed)
    a = local.normal(size=(rank, d_in)) / np.sqrt(d_in)
    b = np.zeros((d_out, rank))
    scale = alpha / rank
    initial_gap = float(np.max(np.abs((w_frozen + scale * b @ a) - w_frozen)))
    for _ in range(steps):
        g = grad_wrt_weights(w_frozen + scale * b @ a, x_b, y_b)
        grad_b = scale * g @ a.T
        grad_a = scale * b.T @ g
        b -= lr * grad_b
        a -= lr * grad_a
    return w_frozen + scale * b @ a, initial_gap


def report(label, weights, trainable):
    print(f"{label:<11} trainable={trainable:>4}  B_train={mse(weights, x_b, y_b):.3f}  "
          f"B_test={mse(weights, x_b_test, y_b_test):.3f}  A_test={mse(weights, x_a_test, y_a_test):.3f}")


print("=== Lesson 17: fine-tuning and LoRA ===")
print(f"Layer: W is {d_out} x {d_in}, task A examples={n_a}, task B examples={n_b}, noise floor mse={noise ** 2:.3f}")
print(f"Task B differs from task A by a rank-{true_rank} change\n")

print("=== Pretrained model ===")
print(f"Pretrained A_test = {mse(w_pretrained, x_a_test, y_a_test):.3f}")
print(f"Pretrained B_test = {mse(w_pretrained, x_b_test, y_b_test):.3f}\n")

print("=== Fine-tuning on task B ===")
report("no tuning", w_pretrained, 0)
report("full", full_fine_tune(w_pretrained), d_out * d_in)
gaps = []
for rank in [1, 4, 16]:
    tuned, gap = lora_fine_tune(w_pretrained, rank, alpha=rank, seed=100 + rank)
    report(f"lora r={rank}", tuned, rank * (d_in + d_out))
    gaps.append(gap)
report("true B", w_task_b, 0)
print(f"\nMax |(W + BA) - W| before any LoRA step, over all ranks = {max(gaps):.4f}")
random_b = np.random.default_rng(5).normal(size=(d_out, 4)) / np.sqrt(4)
random_a = np.random.default_rng(6).normal(size=(4, d_in)) / np.sqrt(d_in)
print(f"Same gap if B were random instead of zero (r=4) = {np.max(np.abs(random_b @ random_a)):.4f}")

print("\n=== Parameter arithmetic for one 4096 x 4096 matrix ===")
d = 4096
full_params = d * d
print(f"Full matrix params = {full_params:,}")
for rank in [8, 16]:
    lora_params = rank * (d + d)
    print(f"LoRA r={rank:<2} params = {lora_params:,}  share={100 * lora_params / full_params:.2f}%")
layers, matrices = 32, 2
print(f"32 layers x 2 matrices (q, v) at r=8 = {layers * matrices * 8 * 2 * d:,} trainable params")
print(f"Same matrices fully trained = {layers * matrices * full_params:,} params")
