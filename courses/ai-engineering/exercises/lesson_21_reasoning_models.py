import numpy as np

LEVELS = ["easy", "medium", "hard"]
COUNTS = {"easy": 1200, "medium": 1200, "hard": 600}
P_COT = {"easy": 0.85, "medium": 0.60, "hard": 0.30}
P_DIRECT = {"easy": 0.75, "medium": 0.35, "hard": 0.10}
MEAN_TOKENS = {"easy": 250, "medium": 450, "hard": 800}
TRAP_SHARE = {"easy": 0.3, "medium": 0.5, "hard": 0.8}
DISTRACTORS = 30
DIRECT_TOKENS = 8
VERIFIER_TOKENS = 100
K_VALUES = [1, 3, 5, 9, 15]
K_MAX = max(K_VALUES)

levels = np.repeat(np.arange(3), [COUNTS[name] for name in LEVELS])
n_problems = len(levels)


def per_level(table):
    return np.array([table[name] for name in LEVELS])[levels]


def sample_answers(rng, p, trap_share):
    correct = rng.random((n_problems, K_MAX)) < p[:, None]
    to_trap = rng.random((n_problems, K_MAX)) < trap_share[:, None]
    spread = rng.integers(2, DISTRACTORS + 2, size=(n_problems, K_MAX))
    wrong = np.where(to_trap, 1, spread)
    return np.where(correct, 0, wrong)


def plurality(row):
    values, first_seen, counts = np.unique(row, return_index=True, return_counts=True)
    best = counts.max()
    tied = first_seen[counts == best]
    return row[tied.min()]


def run_world(title, trap_share_table, seed):
    rng = np.random.default_rng(seed)
    p = per_level(P_COT)
    answers = sample_answers(rng, p, per_level(trap_share_table))
    lengths = np.maximum(50, rng.normal(per_level(MEAN_TOKENS)[:, None], per_level(MEAN_TOKENS)[:, None] * 0.2, (n_problems, K_MAX))).astype(int)
    trap_bonus = 0.5 if max(trap_share_table.values()) > 0 else 0.0
    scores = (answers == 0) * 1.0 + (answers == 1) * trap_bonus + rng.normal(0, 0.8, (n_problems, K_MAX))
    direct_ok = rng.random(n_problems) < per_level(P_DIRECT)
    print(f"\n=== {title} ===")
    print(f"{'config':<16}{'accuracy':>9}{'tokens/problem':>16}{'latency tokens':>16}{'acc per 1k tok':>16}")
    rows = [("direct answer", direct_ok, np.full(n_problems, DIRECT_TOKENS), np.full(n_problems, DIRECT_TOKENS))]
    for k in K_VALUES:
        votes = np.array([plurality(row) for row in answers[:, :k]])
        cost = lengths[:, :k].sum(axis=1)
        latency = lengths[:, :k].max(axis=1)
        rows.append((f"vote k={k}", votes == 0, cost, latency))
    for k in K_VALUES[1:]:
        pick = answers[np.arange(n_problems), scores[:, :k].argmax(axis=1)]
        cost = lengths[:, :k].sum(axis=1) + VERIFIER_TOKENS * k
        latency = lengths[:, :k].max(axis=1) + VERIFIER_TOKENS
        rows.append((f"best-of k={k}", pick == 0, cost, latency))
    results = {}
    for name, ok, cost, latency in rows:
        accuracy = ok.mean()
        per_1k = accuracy / (cost.mean() / 1000)
        print(f"{name:<16}{accuracy:>9.3f}{cost.mean():>16.0f}{latency.mean():>16.0f}{per_1k:>16.3f}")
        results[name] = ok
    print("accuracy by difficulty:")
    for name in ["direct answer", "vote k=1", "vote k=15", "best-of k=15"]:
        parts = "  ".join(f"{LEVELS[i]}={results[name][levels == i].mean():.3f}" for i in range(3))
        print(f"  {name:<14} {parts}")


print("=== Lesson 21: test-time compute (a simulation, not a real model) ===")
print(f"Problems: {n_problems} (" + ", ".join(f"{name} {COUNTS[name]} p={P_COT[name]:.2f}" for name in LEVELS) + ")")
print(f"Wrong answers: {DISTRACTORS} possible distractors, plus one 'trap' answer in world B")

run_world("World A: independent errors (wrong answers spread out)", {name: 0.0 for name in LEVELS}, 21)
run_world("World B: correlated errors (a shared trap answer)", TRAP_SHARE, 21)

print("\n=== C: one problem, p(correct) = 0.40 per sample, 20000 trials ===")
print(f"{'k':>3}{'errors spread out':>20}{'errors on one trap':>20}")
rng = np.random.default_rng(5)
trials = 20000
single_p = np.full(trials, 0.40)
for k in K_VALUES:
    row = []
    for share in [0.0, 1.0]:
        correct = rng.random((trials, k)) < single_p[:, None]
        spread = rng.integers(2, DISTRACTORS + 2, size=(trials, k))
        wrong = np.where(rng.random((trials, k)) < share, 1, spread)
        answers = np.where(correct, 0, wrong)
        row.append(np.mean([plurality(r) == 0 for r in answers]))
    print(f"{k:>3}{row[0]:>20.3f}{row[1]:>20.3f}")
print("Voting converges to the most likely single answer, not to the correct one.")
