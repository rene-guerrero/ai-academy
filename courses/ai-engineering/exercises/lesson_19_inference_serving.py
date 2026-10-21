import math

import numpy as np

PARAMS = 7e9
BYTES_PER_PARAM = 2
BANDWIDTH = 2e12
PEAK_FLOPS = 300e12
WEIGHT_READ_MS = PARAMS * BYTES_PER_PARAM / BANDWIDTH * 1000
PER_SEQ_MS = 0.15
PREFILL_MS_PER_TOKEN = 2 * PARAMS / PEAK_FLOPS * 1000
SLOTS = 16
LAYERS, HIDDEN, MAX_LEN, PAGE = 32, 4096, 2048, 16
KV_BYTES_PER_TOKEN = 2 * LAYERS * HIDDEN * 2

print("=== Lesson 19: inference serving (a cost model, not a benchmark) ===")
print("Assumptions: 7B parameters in fp16, 2 TB/s memory bandwidth, 300 TFLOP/s compute")
print(f"Weight read per decode step = {WEIGHT_READ_MS:.2f} ms")
print(f"Upper bound at batch 1 = {1000 / WEIGHT_READ_MS:.1f} tokens/s")
print(f"Prefill cost per prompt token = {PREFILL_MS_PER_TOKEN:.4f} ms")

print("\n=== Arithmetic intensity of one decode step (weights only) ===")
ridge = PEAK_FLOPS / BANDWIDTH
print(f"Ridge point = {ridge:.0f} FLOP/byte")
for batch in [1, 8, 32, 128, 512]:
    intensity = 2 * PARAMS * batch / (PARAMS * BYTES_PER_PARAM)
    step_ms = max(WEIGHT_READ_MS, 2 * PARAMS * batch / PEAK_FLOPS * 1000)
    bound = "memory" if intensity < ridge else "compute"
    print(f"batch={batch:>4}  intensity={intensity:6.1f} FLOP/byte  step={step_ms:6.2f} ms  tokens/s={batch * 1000 / step_ms:8.0f}  {bound}-bound")

rng = np.random.default_rng(19)
count = 300
arrivals = np.cumsum(rng.exponential(200.0, size=count))
prompts = rng.integers(50, 1200, size=count)
outputs = np.minimum(rng.geometric(1 / 180, size=count), 800)


def simulate(mode):
    clock, nxt = 0.0, 0
    waiting, running = [], []
    first, done = np.zeros(count), np.zeros(count)
    remaining = outputs.astype(int).copy()
    slot_used, slot_total = 0, 0
    while nxt < count or waiting or running:
        while nxt < count and arrivals[nxt] <= clock:
            waiting.append(nxt)
            nxt += 1
        if not waiting and not running:
            clock = arrivals[nxt]
            continue
        admit = []
        if mode == "continuous" or not running:
            admit = waiting[: SLOTS - len(running)]
            waiting = waiting[len(admit):]
        if admit:
            clock += sum(int(prompts[r]) for r in admit) * PREFILL_MS_PER_TOKEN
            for r in admit:
                first[r] = clock
                remaining[r] -= 1
                if remaining[r] == 0:
                    done[r] = clock
            running += admit
        active = [r for r in running if remaining[r] > 0]
        if not active:
            running = []
            continue
        occupied = len(running) if mode == "static" else len(active)
        clock += WEIGHT_READ_MS + PER_SEQ_MS * occupied
        slot_used += len(active)
        slot_total += SLOTS
        for r in active:
            remaining[r] -= 1
            if remaining[r] == 0:
                done[r] = clock
        if mode == "continuous":
            running = [r for r in running if remaining[r] > 0]
    ttft = first - arrivals
    latency = done - arrivals
    throughput = outputs.sum() / ((done.max() - arrivals[0]) / 1000)
    return throughput, ttft, latency, slot_used / slot_total


print(f"\n=== Simulation: {count} requests, {SLOTS} slots, mean arrival gap 200 ms ===")
print(f"Mean prompt = {prompts.mean():.0f} tokens, mean output = {outputs.mean():.0f} tokens")
for mode in ["static", "continuous"]:
    throughput, ttft, latency, utilization = simulate(mode)
    print(f"{mode} throughput = {throughput:.0f} tokens/s")
    print(f"{mode} TTFT p50 = {np.percentile(ttft, 50) / 1000:.2f} s, p95 = {np.percentile(ttft, 95) / 1000:.2f} s")
    print(f"{mode} latency p50 = {np.percentile(latency, 50) / 1000:.2f} s, p95 = {np.percentile(latency, 95) / 1000:.2f} s")
    print(f"{mode} slot utilization = {utilization:.3f}")

print("\n=== KV cache memory ===")
print(f"KV cache per token = {KV_BYTES_PER_TOKEN / 2**20:.2f} MiB")
lengths = prompts + outputs
print(f"Mean request = {lengths.mean():.0f} tokens = {lengths.mean() * KV_BYTES_PER_TOKEN / 2**30:.3f} GiB")
contiguous = MAX_LEN * count
paged = sum(math.ceil(n / PAGE) * PAGE for n in lengths.tolist())
used = int(lengths.sum())
print(f"Waste with contiguous {MAX_LEN}-token reservation = {1 - used / contiguous:.3f}")
print(f"Waste with {PAGE}-token pages = {1 - used / paged:.3f}")
budget = 40 * 2**30
per_request_contiguous = MAX_LEN * KV_BYTES_PER_TOKEN
per_request_paged = paged / count * KV_BYTES_PER_TOKEN
print(f"Requests that fit in 40 GiB, contiguous = {int(budget // per_request_contiguous)}")
print(f"Requests that fit in 40 GiB, paged (average) = {int(budget // per_request_paged)}")
