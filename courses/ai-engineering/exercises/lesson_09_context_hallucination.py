import random
import numpy as np

print("=== Lesson 9: context windows, memory and hallucination ===")
print("A toy model of mechanisms. Nothing here measures a real LLM.\n")

print("=== Part 1: the chat history is resent on every call ===")
window = 4096
system_tokens = 600
summary_tokens = 300
turns = 20
token_rng = random.Random(9)
messages = []
for turn in range(1, turns + 1):
    messages.append((turn, "user", token_rng.randint(60, 180)))
    messages.append((turn, "assistant", token_rng.randint(150, 400)))
fact_turn = 2


def drop_oldest(history):
    kept = [("system", 0, system_tokens)] + [("msg", t, n) for t, _, n in history]
    while sum(n for _, _, n in kept) > window:
        kept.pop(0)
    return kept


def system_plus_summary(history):
    kept = []
    budget = window - system_tokens - summary_tokens
    for t, _, n in reversed(history):
        if n > budget:
            break
        kept.insert(0, ("msg", t, n))
        budget -= n
    summarized = len(kept) < len(history)
    head = [("system", 0, system_tokens)] + ([("summary", 0, summary_tokens)] if summarized else [])
    return head + kept


billed_full = 0
billed_trunc = 0
print(f"Window = {window} tokens, system prompt = {system_tokens} tokens")
for turn in range(1, turns + 1):
    history = [m for m in messages if m[0] < turn or (m[0] == turn and m[1] == "user")]
    full = system_tokens + sum(n for _, _, n in history)
    sent = sum(n for _, _, n in system_plus_summary(history))
    billed_full += full
    billed_trunc += sent
    if turn in (1, 5, 10, 15, 20):
        print(f"turn {turn:>2}: full history = {full:>5} tokens, sent with summary strategy = {sent:>5}")
print(f"Input tokens billed over {turns} turns, no window: {billed_full}")
print(f"Input tokens billed over {turns} turns, summary strategy: {billed_trunc}")

final_history = [m for m in messages if m[0] < turns or m[1] == "user"]
a = drop_oldest(final_history)
b = system_plus_summary(final_history)
print(f"Drop oldest at turn {turns}: system prompt kept = {any(k == 'system' for k, _, _ in a)}")
print(f"Drop oldest at turn {turns}: oldest turn still present = {min(t for k, t, _ in a if k == 'msg')}")
print(f"Drop oldest at turn {turns}: fact from turn {fact_turn} present = {any(k == 'msg' and t == fact_turn for k, t, _ in a)}")
print(f"Summary strategy: system prompt kept = {any(k == 'system' for k, _, _ in b)}")
print(f"Summary strategy: oldest verbatim turn = {min(t for k, t, _ in b if k == 'msg')}")
print(f"Summary strategy: fact survives only if the summary wrote it down")

print("\n=== Part 2: attention dilution (real softmax math) ===")
margin = 3.0
print(f"One relevant key scores {margin:.1f} above N distractors that score 0")
for n_distractors in (10, 100, 1000, 10000, 100000):
    weight = np.exp(margin) / (np.exp(margin) + n_distractors)
    print(f"N = {n_distractors:>6}: weight on relevant key = {weight:.4f}")
noise_rng = np.random.default_rng(9)
noisy_scores = noise_rng.normal(0.0, 1.0, size=1000)
noisy_weight = np.exp(margin) / (np.exp(margin) + np.exp(noisy_scores).sum())
print(f"N =   1000 with distractor scores ~ Normal(0, 1): weight = {noisy_weight:.4f}")

print("\nPosition bias toy: we ADD a U-shaped bias, so the U-shape is an input, not a finding")
n_keys = 1000
positions = np.linspace(0.0, 1.0, n_keys)
bias = 1.0 * (2.0 * positions - 1.0) ** 2
for label, index in (("start", 0), ("middle", n_keys // 2), ("end", n_keys - 1)):
    scores = bias.copy()
    scores[index] += margin
    weights = np.exp(scores - scores.max())
    weights /= weights.sum()
    print(f"relevant key at {label:>6}: weight = {weights[index]:.4f}")

print("\n=== Part 3: calibration and abstention (synthetic predictions) ===")
cal_rng = np.random.default_rng(42)
count = 2000
confidence = cal_rng.uniform(0.5, 1.0, size=count)
overconfident_correct = cal_rng.uniform(size=count) < 0.5 + 0.6 * (confidence - 0.5)
calibrated_correct = cal_rng.uniform(size=count) < confidence


def ece(conf, correct, edges):
    total = 0.0
    rows = []
    for low, high in zip(edges[:-1], edges[1:]):
        mask = (conf >= low) & ((conf < high) | (high == edges[-1]))
        if mask.sum() == 0:
            continue
        gap = abs(conf[mask].mean() - correct[mask].mean())
        total += mask.sum() / len(conf) * gap
        rows.append((low, high, mask.sum(), conf[mask].mean(), correct[mask].mean()))
    return total, rows


edges = np.round(np.arange(0.5, 1.01, 0.1), 2)
ece_over, rows = ece(confidence, overconfident_correct, edges)
print("bin          count  mean confidence  accuracy")
for low, high, size, mean_conf, acc in rows:
    print(f"[{low:.1f}, {high:.1f})  {size:>5}  {mean_conf:>15.3f}  {acc:>8.3f}")
ece_cal, _ = ece(confidence, calibrated_correct, edges)
print(f"ECE overconfident model = {ece_over:.3f}")
print(f"ECE calibrated model = {ece_cal:.3f}")
print("Abstain below a confidence threshold (overconfident model):")
for threshold in (0.5, 0.7, 0.8, 0.9):
    answered = confidence >= threshold
    print(f"threshold {threshold:.1f}: coverage = {answered.mean():.3f}, accuracy when answering = {overconfident_correct[answered].mean():.3f}")
