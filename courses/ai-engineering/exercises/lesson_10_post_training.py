import re
import numpy as np

rng = np.random.default_rng(10)


def softmax(z):
    e = np.exp(z - z.max())
    return e / e.sum()


def kl(p, q):
    return float(np.sum(p * np.log(p / q)))


def sigmoid(x):
    return 1.0 / (1.0 + np.exp(-x))


print("=== Lesson 10: post-training on a toy policy ===")
print("Each prompt has a fixed menu of candidate responses; the policy is a softmax over their logits.\n")

print("=== Part 1: supervised fine-tuning (SFT) ===")
conversation = [("system", "You are a helpful assistant."), ("user", "What is a null reference?"), ("assistant", "It means you used a variable that points to nothing.")]
total_tokens = sum(len(text.split()) for _, text in conversation)
loss_tokens = sum(len(text.split()) for role, text in conversation if role == "assistant")
print(f"Conversation words = {total_tokens}, words that count in the loss = {loss_tokens}")

prompts = 3
candidates = 4
base_logits = rng.normal(scale=1.0, size=(prompts, candidates))
demonstrations = np.array([2, 0, 3])
logits = base_logits.copy()
sft_lr = 0.5
for step in range(31):
    probs = np.array([softmax(row) for row in logits])
    if step in (0, 5, 10, 30):
        demo_prob = probs[np.arange(prompts), demonstrations].mean()
        loss = -np.log(probs[np.arange(prompts), demonstrations]).mean()
        print(f"SFT step {step:>2}: mean P(demonstrated) = {demo_prob:.3f}  loss = {loss:.3f}")
    grad = probs.copy()
    grad[np.arange(prompts), demonstrations] -= 1.0
    logits -= sft_lr * grad / prompts
sft_logits = logits.copy()

print("\n=== Part 2: DPO on preference pairs against a frozen reference ===")
answers = ["clear, with an example", "clear but terse", "correct but rude", "off-topic"]
reference_logits = np.array([0.0, 0.6, 0.3, -0.4])
reference = softmax(reference_logits)
pairs = [(0, 1, 0.8), (1, 2, 0.9)]
print("Reference: " + "  ".join(f"{a} {p:.3f}" for a, p in zip(answers, reference)))
print("Preferences: 'example' beats 'terse' 80% of the time, 'terse' beats 'rude' 90% of the time")
for beta in (0.5, 0.1):
    theta = reference_logits.copy()
    for step in range(6000):
        policy = softmax(theta)
        delta = np.log(policy) - np.log(reference)
        grad = np.zeros(candidates)
        for chosen, rejected, share in pairs:
            margin = beta * (delta[chosen] - delta[rejected])
            push = share * sigmoid(-margin) - (1.0 - share) * sigmoid(margin)
            grad[chosen] -= beta * push
            grad[rejected] += beta * push
        theta -= 1.0 * grad
    policy = softmax(theta)
    delta = np.log(policy) - np.log(reference)
    implied = beta * (delta[0] - delta[1])
    print(f"beta={beta:<4} P(example)={policy[0]:.3f} P(terse)={policy[1]:.3f} P(rude)={policy[2]:.3f} P(off-topic)={policy[3]:.3f}")
    print(f"beta={beta:<4} log-ratio gap example-terse = {delta[0] - delta[1]:.3f}  implied reward margin = {implied:.3f}  KL to reference = {kl(policy, reference):.3f}")
print(f"ln(0.8/0.2) = {np.log(4):.3f}")

print("\n=== Part 3: a flawed reward model versus a verifier ===")
responses = ["42", "17 + 25 = 42.", "43", "Great question! Let us carefully add these two numbers step by step, carrying the one, which gives us 43."]
labels = ["short right", "worked right", "short wrong", "long wrong"]


def verifier(text):
    numbers = re.findall(r"\d+", text)
    return 1.0 if numbers and numbers[-1] == "42" else 0.0


correct = np.array([verifier(r) for r in responses])
length = np.array([len(r.split()) for r in responses], dtype=float)
proxy = correct + 0.15 * length
ref3 = softmax(np.array([0.8, 0.6, 0.2, -0.2]))
print("Prompt: What is 17 + 25?")
for label, r, c, p, q in zip(labels, responses, correct, proxy, ref3):
    print(f"  {label:<12} words={int(len(r.split())):>2} verifier={c:.0f} proxy reward={p:.2f} P_ref={q:.3f}")
print(f"Reference accuracy = {float(ref3 @ correct):.3f}")


def optimize(reward, penalty, steps=3000, lr=0.5):
    theta = np.log(ref3)
    for _ in range(steps):
        policy = softmax(theta)
        shaped = reward - penalty * np.log(policy / ref3)
        theta += lr * policy * (shaped - policy @ shaped)
    return softmax(theta)


for name, reward, penalty in [("proxy", proxy, 0.0), ("proxy", proxy, 0.5), ("proxy", proxy, 2.0), ("verifier", correct, 0.5)]:
    policy = optimize(reward, penalty)
    print(f"{name:<8} reward, KL coef {penalty:.1f}: P(long wrong)={policy[3]:.3f} accuracy={float(policy @ correct):.3f} proxy={float(policy @ proxy):.3f} KL={kl(policy, ref3):.3f}")
