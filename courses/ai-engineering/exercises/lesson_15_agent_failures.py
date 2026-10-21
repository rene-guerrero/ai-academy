import random
from math import comb

STEPS, EPISODES, CONTEXT_LIMIT, STEP_BUDGET = 8, 1000, 40, 16
P_WRONG_TOOL, P_MALFORMED, P_TRANSIENT, P_REPEAT = 0.01, 0.06, 0.06, 0.04
P_STAY_LOOPED, P_BREAK_AFTER_HINT = 0.95, 0.90
P_FIX_OPAQUE, P_FIX_STRUCTURED = 0.35, 0.90
P_COMMITTED_BEFORE_TIMEOUT, P_RETRY_OK = 0.5, 0.8
TOOLS = ["search_orders", "get_order", "update_address", "get_order",
         "issue_refund", "get_order", "send_email", "close_ticket"]
WRITES = {"update_address", "issue_refund", "send_email", "close_ticket"}


def run_episode(rng, guards, steps=STEPS, scale=1.0, trace=None):
    done, calls, dup, longest_run, run = 0, 0, 0, 0, 0
    mode, corrupted, ghost_write = "normal", False, False
    last_sig, last_was_write = None, False
    cap = STEP_BUDGET if "budget" in guards else CONTEXT_LIMIT
    log = trace.append if trace is not None else (lambda line: None)
    while done < steps:
        if calls >= cap:
            return False, calls, longest_run, dup, "step limit"
        calls += 1
        tool = TOOLS[done % len(TOOLS)]
        sig = (tool, f"order=1042,step={done}")
        if mode == "looping":
            run += 1
            longest_run = max(longest_run, run)
            if "loop" in guards:
                note = "blocked: identical call already made, result reused"
                if rng.random() < P_BREAK_AFTER_HINT:
                    mode = "normal"
            else:
                note = "executed again"
                dup += int(last_was_write)
                if rng.random() > P_STAY_LOOPED:
                    mode = "normal"
            log(f"{last_sig[0]}({last_sig[1]}) -> repeat of last completed call, {note}")
            continue
        run, longest_run = 1, max(longest_run, 1)
        if mode == "malformed":
            fix = P_FIX_STRUCTURED if "structured" in guards else P_FIX_OPAQUE
            if rng.random() >= fix:
                log(f"{tool}(bad args) -> error, still malformed")
                continue
            mode, outcome = "normal", "ok"
        else:
            u = rng.random()
            edges = [e * scale for e in (P_WRONG_TOOL, P_MALFORMED, P_TRANSIENT, P_REPEAT)]
            labels = ["ok (wrong tool, silently wrong data)", "malformed", "transient", "repeat"]
            hits = [label for i, label in enumerate(labels) if u < sum(edges[:i + 1])]
            outcome = hits[0] if hits and (hits[0] != "repeat" or last_sig) else "ok"
        if outcome == "repeat":
            mode, calls = "looping", calls - 1
            continue
        if outcome == "malformed":
            mode = "malformed"
            detail = "schema error with field name" if "structured" in guards else "opaque 'Error'"
            log(f"{tool}(bad args) -> {detail}")
            continue
        if outcome == "transient":
            committed = tool in WRITES and rng.random() < P_COMMITTED_BEFORE_TIMEOUT
            if "retry" in guards and any(rng.random() < P_RETRY_OK for _ in range(3)):
                outcome = "ok after harness retry, idempotency key deduped"
            else:
                ghost_write = ghost_write or committed
                log(f"{tool}({sig[1]}) -> timeout" + (" (write had committed)" if committed else ""))
                continue
        corrupted = corrupted or outcome.startswith("ok (wrong")
        dup += int(ghost_write and "retry" not in guards)
        ghost_write = False
        log(f"{tool}({sig[1]}) -> {outcome}")
        last_sig, last_was_write = sig, tool in WRITES
        done += 1
    reason = "wrong result" if corrupted else "duplicate side effect" if dup else "success"
    return reason == "success", calls, longest_run, dup, reason


CONFIGS = [
    ("no guards", set()),
    ("+ step budget", {"budget"}),
    ("+ loop detection", {"budget", "loop"}),
    ("+ structured errors", {"budget", "loop", "structured"}),
    ("+ idempotent retries", {"budget", "loop", "structured", "retry"}),
]

print("=== Lesson 15: why agents fail (seeded simulation, not a real model) ===")
print(f"Task: {STEPS} tool calls, {EPISODES} episodes per configuration, guards are cumulative\n")
print(f"{'configuration':22} success  mean_calls  loop_rate  dup_side_effects")
for name, guards in CONFIGS:
    rng = random.Random(15)
    results = [run_episode(rng, guards) for _ in range(EPISODES)]
    success, mean_calls = (sum(r[i] for r in results) / EPISODES for i in (0, 1))
    loop_rate, dups = sum(r[2] >= 3 for r in results) / EPISODES, sum(r[3] for r in results)
    print(f"{name:22} {success:.3f}    {mean_calls:6.2f}      {loop_rate:.3f}      {dups}")
    if not guards:
        reasons = sorted(set(r[4] for r in results))
        breakdown = ", ".join(f"{k}={sum(r[4] == k for r in results)}" for k in reasons)
print(f"\nNo-guard outcomes: {breakdown}")

print("\n=== Compounding error: strict agent, any failed step ends the task ===")
for p in (0.95, 0.99):
    for n in (1, 5, 10, 20, 50):
        rng = random.Random(1000 + n)
        wins = sum(all(rng.random() < p for _ in range(n)) for _ in range(EPISODES))
        print(f"p={p:.2f} n={n:2d}  analytic p**n={p ** n:.3f}  simulated={wins / EPISODES:.3f}")

print("\n=== Reliability: 50 tasks of varying difficulty, 10 trials each, all guards ===")
task_rng = random.Random(77)
trials, k = 10, 3
pass1 = pass_at_k = pass_hat_k = 0.0
for task in range(50):
    steps, scale = task_rng.randint(4, 14), task_rng.uniform(0.5, 2.5)
    rng = random.Random(5000 + task)
    wins = sum(run_episode(rng, CONFIGS[-1][1], steps, scale)[0] for _ in range(trials))
    pass1 += wins / trials
    pass_at_k += 1 - comb(trials - wins, k) / comb(trials, k)
    pass_hat_k += comb(wins, k) / comb(trials, k)
print(f"pass@1 = {pass1 / 50:.3f}")
print(f"pass@{k} = {pass_at_k / 50:.3f}  (at least one of {k} tries succeeds)")
print(f"pass^{k} = {pass_hat_k / 50:.3f}  (all {k} tries succeed)")

print("\n=== One failing trace from the no-guard run ===")
rng = random.Random(15)
for episode in range(EPISODES):
    trace = []
    ok, calls, longest, dup, reason = run_episode(rng, set(), trace=trace)
    if reason == "step limit":
        break
print(f"episode {episode}: {reason} after {calls} calls")
grouped = []
for line in trace:
    if grouped and grouped[-1][0] == line:
        grouped[-1][1] += 1
    else:
        grouped.append([line, 1])
for line, count in grouped:
    print(f"  {line}" + (f"   x{count}" if count > 1 else ""))
