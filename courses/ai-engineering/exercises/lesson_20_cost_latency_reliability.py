import random

import numpy as np

N = 10_000
PREFIX_TOKENS = 1_200
CONFIDENCE_THRESHOLD = 0.5
rng = np.random.default_rng(20)
user_tokens = np.round(rng.lognormal(np.log(400), 0.6, N)).astype(int)
output_tokens = np.clip(np.round(rng.lognormal(np.log(250), 0.5, N)), 20, 2000).astype(int)
difficulty = rng.random(N)
u_large, u_small, u_backup = rng.random(N), rng.random(N), rng.random(N)
confidence = 1 - difficulty + rng.normal(0, 0.15, N)
noise = {name: rng.lognormal(0, 0.3, N) for name in ["large", "small", "backup"]}
cache_hit = rng.random(N) < 0.25

MODELS = {
    "large": {"in": 3.00, "cached": 0.30, "out": 15.00, "ttft": 0.6, "per_token": 0.015},
    "small": {"in": 0.15, "cached": 0.015, "out": 0.60, "ttft": 0.25, "per_token": 0.005},
    "backup": {"in": 3.50, "cached": 3.50, "out": 17.50, "ttft": 0.8, "per_token": 0.018},
}
QUALITY_DROP = {"large": 0.12, "small": 0.35, "backup": 0.15}
UNIFORMS = {"large": u_large, "small": u_small, "backup": u_backup}


def model_call(name, i, prompt_cache):
    m = MODELS[name]
    cached = PREFIX_TOKENS if prompt_cache else 0
    fresh = PREFIX_TOKENS + user_tokens[i] - cached
    cost = (fresh * m["in"] + cached * m["cached"] + output_tokens[i] * m["out"]) / 1e6
    ttft = m["ttft"] * noise[name][i]
    total = ttft + output_tokens[i] * m["per_token"] * noise[name][i]
    correct = UNIFORMS[name][i] < 0.97 - QUALITY_DROP[name] * difficulty[i]
    return cost, ttft, total, correct


def resilient_call(name, i, prompt_cache, flaky, retries, jitter_rng):
    spent, elapsed = 0.0, 0.0
    for attempt in range(retries + 1):
        u = flaky.random() if flaky else 1.0
        if u >= 0.07:
            cost, ttft, total, correct = model_call(name, i, prompt_cache)
            return spent + cost, elapsed + ttft, elapsed + total, correct, True
        if u < 0.04:
            elapsed += 0.4
        else:
            elapsed += 3.0 if retries else 30.0
        if attempt < retries:
            elapsed += jitter_rng.uniform(0, 0.5 * 2 ** attempt)
    if not retries:
        return spent, elapsed, elapsed, False, False
    cost, ttft, total, correct = model_call("backup", i, False)
    return spent + cost, elapsed + ttft, elapsed + total, correct, True


def simulate(route, prompt_cache=False, response_cache=False, flaky=False, retries=0):
    flaky_rng = random.Random(7) if flaky else None
    jitter_rng = random.Random(11)
    costs, ttfts, totals, correct_all, ok_all = [], [], [], [], []
    escalations = 0
    for i in range(N):
        if response_cache and cache_hit[i]:
            cost, ttft, total, ok = 0.0, 0.02, 0.02, True
            first = "small" if route and confidence[i] >= CONFIDENCE_THRESHOLD else "large"
            correct = model_call(first, i, prompt_cache)[3]
        else:
            name = "small" if route else "large"
            cost, ttft, total, correct, ok = resilient_call(name, i, prompt_cache, flaky_rng, retries, jitter_rng)
            if route and ok and confidence[i] < CONFIDENCE_THRESHOLD:
                escalations += 1
                c2, t2, tot2, correct, ok = resilient_call("large", i, prompt_cache, flaky_rng, retries, jitter_rng)
                cost, ttft, total = cost + c2, total + t2, total + tot2
        costs.append(cost)
        ttfts.append(ttft)
        totals.append(total)
        correct_all.append(correct and ok)
        ok_all.append(ok)
    return np.array(costs), np.array(ttfts), np.array(totals), np.mean(correct_all), np.mean(ok_all), escalations / N


print("=== Lesson 20: cost, latency and reliability (all prices and latencies are illustrative) ===")
print("Illustrative prices in $ per million tokens (input / cached input / output):")
for name, m in MODELS.items():
    print(f"  {name:7} {m['in']:6.3f} / {m['cached']:6.3f} / {m['out']:6.2f}")
print(f"Workload: {N} requests, shared prefix {PREFIX_TOKENS} tokens, "
      f"mean user input {user_tokens.mean():.0f}, mean output {output_tokens.mean():.0f} tokens")
large_cost = model_call("large", 0, False)[0]
print(f"Request 0 on large: input {PREFIX_TOKENS + user_tokens[0]} tokens, output {output_tokens[0]} tokens, cost ${large_cost:.5f}")
in_share = np.sum((PREFIX_TOKENS + user_tokens) * 3.00) / np.sum((PREFIX_TOKENS + user_tokens) * 3.00 + output_tokens * 15.00)
print(f"Share of large-model cost that is input tokens: {in_share:.3f}\n")

configs = [
    ("1 large only", dict(route=False)),
    ("2 router small->large", dict(route=True)),
    ("3 + prompt cache", dict(route=True, prompt_cache=True)),
    ("4 + response cache", dict(route=True, prompt_cache=True, response_cache=True)),
    ("5 flaky, no safeguards", dict(route=True, prompt_cache=True, response_cache=True, flaky=True)),
    ("6 flaky, retry+fallback", dict(route=True, prompt_cache=True, response_cache=True, flaky=True, retries=2)),
]
print(f"{'config':25} {'$/1k req':>9} {'p50 s':>7} {'p95 s':>7} {'p99 s':>7} {'quality':>8} {'avail':>7} {'escal':>6}")
for label, kwargs in configs:
    costs, ttfts, totals, quality, avail, escal = simulate(**kwargs)
    p50, p95, p99 = np.percentile(totals, [50, 95, 99])
    print(f"{label:25} {costs.mean() * 1000:9.2f} {p50:7.2f} {p95:7.2f} {p99:7.2f} {quality:8.3f} {avail:7.3f} {escal:6.3f}")
    if label.startswith("1"):
        ttft_p50, total_p50 = np.percentile(ttfts, 50), p50
print(f"\nStreaming, config 1: p50 time to first token {ttft_p50:.2f} s versus p50 full response {total_p50:.2f} s")

print("\n=== Retry storm: 1000 clients fail at t=0 and retry 3 times while the server is still down ===")
clients, base, bucket = 1000, 1.0, 0.1
jitter_rng = random.Random(5)
print(f"{'attempt':>7} {'max in one 100 ms bucket, no jitter':>37} {'with full jitter':>18}")
plain_t, jitter_t = [0.0] * clients, [0.0] * clients
for attempt in range(3):
    plain_t = [t + base * 2 ** attempt for t in plain_t]
    jitter_t = [t + jitter_rng.uniform(0, base * 2 ** attempt) for t in jitter_t]
    plain_max = max(np.bincount(np.floor(np.array(plain_t) / bucket + 1e-9).astype(int)))
    jitter_max = max(np.bincount(np.floor(np.array(jitter_t) / bucket).astype(int)))
    print(f"{attempt + 1:>7} {plain_max:>37} {jitter_max:>18}")
