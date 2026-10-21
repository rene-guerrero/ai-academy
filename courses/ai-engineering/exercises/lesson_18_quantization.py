import numpy as np

rng = np.random.default_rng(18)

d_in, d_out, batch = 256, 128, 64
outlier_channels = [7, 91, 200]

weights = rng.normal(0.0, 0.02, size=(d_out, d_in))
weights[:, outlier_channels] *= 25.0
activations = rng.normal(0.0, 1.0, size=(batch, d_in))
reference = activations @ weights.T


def quantize(w, bits, scheme, group=64, clip=None):
    qmax = 2 ** (bits - 1) - 1
    if scheme == "tensor":
        blocks = w.reshape(1, -1)
    elif scheme == "channel":
        blocks = w.reshape(w.shape[0], -1)
    else:
        blocks = w.reshape(-1, group)
    absmax = np.abs(blocks).max(axis=1, keepdims=True)
    if clip is not None:
        absmax = np.quantile(np.abs(blocks), clip, axis=1, keepdims=True)
    scale = absmax / qmax
    codes = np.clip(np.round(blocks / scale), -qmax - 1, qmax)
    return (codes * scale).reshape(w.shape)


def quantize_asymmetric(values, bits):
    levels = 2 ** bits - 1
    low, high = values.min(), values.max()
    scale = (high - low) / levels
    zero_point = np.round(-low / scale)
    codes = np.clip(np.round(values / scale) + zero_point, 0, levels)
    return (codes - zero_point) * scale


def report(label, approx):
    weight_error = np.sqrt(np.mean((approx - weights) ** 2)) / np.sqrt(np.mean(weights ** 2))
    output = activations @ approx.T
    output_error = np.linalg.norm(output - reference) / np.linalg.norm(reference)
    cosine = np.sum(output * reference) / (np.linalg.norm(output) * np.linalg.norm(reference))
    print(f"{label:<22} weight_rel_err={weight_error:.4f}  output_rel_err={output_error:.4f}  cosine={cosine:.4f}")


print("=== Lesson 18: quantization and memory ===")
print(f"Weight matrix {d_out}x{d_in}, outlier input channels {outlier_channels}")
column_absmax = np.abs(weights).max(axis=0)
typical = np.median(column_absmax)
print(f"Largest |w| in an outlier column / median column max = {column_absmax.max() / typical:.1f}")

print("\n=== Experiment A: symmetric absmax, three scale granularities ===")
for bits in [8, 4]:
    report(f"int{bits} per-tensor", quantize(weights, bits, "tensor"))
    report(f"int{bits} per-channel", quantize(weights, bits, "channel"))
    report(f"int{bits} group-64", quantize(weights, bits, "group", group=64))
    report(f"int{bits} group-32", quantize(weights, bits, "group", group=32))

print("\n=== Experiment B: remove the outliers and quantize again ===")
clean = weights.copy()
clean[:, outlier_channels] /= 25.0
clean_reference = activations @ clean.T
clean_q = quantize(clean, 4, "tensor")
clean_error = np.linalg.norm(activations @ clean_q.T - clean_reference) / np.linalg.norm(clean_reference)
print(f"int4 per-tensor without outliers output_rel_err={clean_error:.4f}")

print("\n=== Experiment C: clip the outliers, or keep them aside in full precision ===")
for quantile in [0.999, 0.99, 0.95]:
    report(f"int4 tensor clip {quantile}", quantize(weights, 4, "tensor", clip=quantile))
inliers = weights.copy()
inliers[:, outlier_channels] = 0.0
mixed = quantize(inliers, 4, "tensor")
mixed[:, outlier_channels] = weights[:, outlier_channels]
report("int4 + fp outlier cols", mixed)

print("\n=== Experiment D: asymmetric (zero point) for one-sided values ===")
relu_out = np.maximum(activations[:, :64], 0.0)
symmetric = quantize(relu_out, 4, "tensor")
asymmetric = quantize_asymmetric(relu_out, 4)
sym_error = np.linalg.norm(symmetric - relu_out) / np.linalg.norm(relu_out)
asym_error = np.linalg.norm(asymmetric - relu_out) / np.linalg.norm(relu_out)
print(f"ReLU outputs int4 symmetric rel_err={sym_error:.4f}")
print(f"ReLU outputs int4 asymmetric rel_err={asym_error:.4f}")

print("\n=== Experiment E: weight memory = parameters x bytes per parameter ===")
formats = [("fp16", 2.0), ("int8", 1.0), ("int4", 0.5)]
print(f"{'model':<6}" + "".join(f"{name:>10}" for name, _ in formats))
for billions in [7, 13, 70]:
    cells = "".join(f"{billions * size:>8.1f}GB" for _, size in formats)
    print(f"{str(billions) + 'B':<6}{cells}")
group_overhead_bits = 16 / 64
print(f"int4 group-64 with one fp16 scale per group = {4 + group_overhead_bits:.2f} bits per weight")

print("\n=== Experiment F: KV cache = 2 x layers x kv_heads x head_dim x context x batch x bytes ===")
layers, kv_heads, head_dim, context, users, kv_bytes = 32, 8, 128, 8192, 8, 2
per_token = 2 * layers * kv_heads * head_dim * kv_bytes
total = per_token * context * users
print(f"Config: layers={layers} kv_heads={kv_heads} head_dim={head_dim} context={context} batch={users} fp16")
print(f"KV bytes per token = {per_token}")
print(f"KV cache total = {total / 1e9:.2f} GB")
print(f"KV cache total at int8 = {total / 2 / 1e9:.2f} GB")
