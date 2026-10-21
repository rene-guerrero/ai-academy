import numpy as np

BOOTSTRAPS = 2000
LOW_INDEX = int(0.025 * BOOTSTRAPS)
HIGH_INDEX = int(0.975 * BOOTSTRAPS) - 1
GATE_MARGIN = -0.02


def simulate_app_results(n, rng, lose_rate, gain_rate):
    baseline = rng.random(n) < 0.80
    flip = rng.random(n)
    candidate = np.where(baseline, flip >= lose_rate, flip < gain_rate)
    return baseline.astype(int), candidate.astype(int)


def bootstrap_interval(values, rng):
    n = len(values)
    indices = rng.integers(0, n, size=(BOOTSTRAPS, n))
    means = np.sort(values[indices].sum(axis=1)) / n
    return means[LOW_INDEX], means[HIGH_INDEX]


def gate(low):
    return "PASS" if low >= GATE_MARGIN else "FAIL"


print("=== Part 1: accuracy with bootstrap 95% intervals ===")
print(f"Gate: pass when the lower bound of the difference is at least {GATE_MARGIN:+.2f}")
print("True accuracy: baseline 0.80, candidate 0.82 (a real +2 point improvement)")
for n in [50, 500, 2000]:
    rng = np.random.default_rng(11)
    baseline, candidate = simulate_app_results(n, rng, 0.05, 0.30)
    a_low, a_high = bootstrap_interval(baseline, rng)
    b_low, b_high = bootstrap_interval(candidate, rng)
    d_low, d_high = bootstrap_interval(candidate - baseline, rng)
    print(f"n={n:>4}  baseline {baseline.mean():.4f} [{a_low:.4f}, {a_high:.4f}]  candidate {candidate.mean():.4f} [{b_low:.4f}, {b_high:.4f}]")
    print(f"n={n:>4}  paired difference {(candidate - baseline).mean():+.4f} [{d_low:+.4f}, {d_high:+.4f}]  gate {gate(d_low)}")

discordant = 0.80 * 0.05 + 0.20 * 0.30
paired_sd = np.sqrt(discordant - 0.02 ** 2)
unpaired_sd = np.sqrt(0.80 * 0.20 + 0.82 * 0.18)
print(f"Examples for a +-0.02 interval on the difference, paired: {int(np.ceil((1.96 * paired_sd / 0.02) ** 2))}")
print(f"Examples for a +-0.02 interval on the difference, unpaired: {int(np.ceil((1.96 * unpaired_sd / 0.02) ** 2))}")

print("\n=== Part 1b: the regression gate on a candidate that is 3 points worse ===")
rng = np.random.default_rng(12)
baseline, regressed = simulate_app_results(500, rng, 0.08, 0.17)
r_low, r_high = bootstrap_interval(regressed - baseline, rng)
print(f"Regressed candidate, n=500: paired difference {(regressed - baseline).mean():+.4f} [{r_low:+.4f}, {r_high:+.4f}]  gate {gate(r_low)}")

print("\n=== Part 2: a judge with position bias ===")
rng = np.random.default_rng(21)
pairs = 400
quality_gap = rng.normal(0.0, 1.0, pairs)
human_prefers_first = (quality_gap + rng.normal(0.0, 0.3, pairs)) > 0
position_bias = 0.6
judge_noise = 0.5
order_ab = (quality_gap + position_bias + rng.normal(0.0, judge_noise, pairs)) > 0
order_ba_first_wins = (-quality_gap + position_bias + rng.normal(0.0, judge_noise, pairs)) > 0
order_ba = ~order_ba_first_wins
consistent = order_ab == order_ba
always_first = order_ab & order_ba_first_wins
always_second = ~order_ab & ~order_ba_first_wins
print(f"Pairs judged in both orders: {pairs}")
print(f"Verdict flips when the order is swapped: {(~consistent).mean():.3f}")
print(f"Picked whichever answer was shown first, both times: {always_first.mean():.3f}")
print(f"Picked whichever answer was shown second, both times: {always_second.mean():.3f}")
print(f"Agreement with humans, one order only: {(order_ab == human_prefers_first).mean():.3f}")
print(f"Agreement with humans, consistent verdicts only: {(order_ab[consistent] == human_prefers_first[consistent]).mean():.3f}")
print(f"Share of pairs with a consistent verdict: {consistent.mean():.3f}")

print("\n=== Part 3: judge against human labels with Cohen's kappa ===")


def cohen_kappa(a, b):
    observed = (a == b).mean()
    expected = a.mean() * b.mean() + (1 - a.mean()) * (1 - b.mean())
    return observed, expected, (observed - expected) / (1 - expected)


rng = np.random.default_rng(31)
items = 300
human_pass = rng.random(items) < 0.85
judge_pass = np.where(human_pass, rng.random(items) < 0.93, rng.random(items) < 0.55)
always_pass = np.ones(items, dtype=bool)
for name, verdicts in [("real judge", judge_pass), ("always pass", always_pass)]:
    observed, expected, kappa = cohen_kappa(human_pass.astype(float), verdicts.astype(float))
    print(f"{name:<11}  raw agreement {observed:.3f}  chance agreement {expected:.3f}  kappa {kappa:.3f}")
missed_failures = (~human_pass & judge_pass).sum()
print(f"Human failures: {(~human_pass).sum()}, of which the judge passed: {missed_failures}")
