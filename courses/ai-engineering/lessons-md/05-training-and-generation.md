---
title: Training and generation
summary: Next-token loss, cross-entropy, teacher forcing, and how temperature and top-p turn probabilities into text.
area: A
n: 5
minutes: 30
author: claude
drafted: 2026-10-16
reviewed: 
runtime: pyodide
exercise: exercises/lesson_05_training_generation.py
regenerated: true
level: foundations
prereqs: 04-transformer-block
---

## The hook

Nobody programs a language model to answer questions. The only thing it is ever asked to do, trillions of times, is this: given the text so far, assign high probability to the word that actually came next.

Everything else, translation, code, reasoning-like behavior, falls out of doing that one thing extremely well. And when you chat with it, the "same" model gives different answers on every run, because the output is *sampled*, not computed.

## The simple explanation

**Training** is practice with an answer key. Take a text from the internet. At every position, make the model guess the probabilities of all possible next tokens, then measure how much probability it put on the token that actually follows. Nudge the weights so that next time it puts a bit more there. Repeat for an enormous amount of text.

**Generation** is the opposite direction: ask the model for probabilities of the next token, pick one, append it, and repeat.

Where the analogy stops: the model never "knows" it is being quizzed on meaning. It is rewarded for matching the statistics of its training text, and that is both the source of its abilities and of its confident mistakes.

## Under the hood

### The training objective

At each position the model outputs logits, softmax makes probabilities `p`, and the loss for that position is the **cross-entropy** against the true next token `y`:

```
loss = -log p[y]
```

If the model gives the right token probability 1, the loss is 0. If it gives probability 0.1, the loss is about 2.3. The loss is averaged over all positions and all examples.

A model that knows nothing assigns equal probability to every token in a vocabulary of size `V`. Its loss is `ln(V)`. For `V = 10` that is 2.3026, which the exercise confirms: a freshly initialized model starts almost exactly there. Training lowers it.

### Teacher forcing

During training, at every position the model is fed the *true* previous tokens, not its own earlier guesses. Because of the causal mask (lesson 3), one forward pass over a sequence of length `n` produces `n - 1` predictions and loss terms at once. That parallelism is why training scales to enormous data. At generation time there is no such luxury: each token depends on the previous sampled one, so decoding is sequential.

### Gradient descent

The loss is a function of the weights. Backpropagation computes its gradient, the direction in which each weight should move to reduce loss, and the optimizer moves every weight by `lr` (the learning rate) times its gradient, in the opposite direction. For softmax with cross-entropy, the gradient with respect to the logits has a very clean form: `p - onehot(y)`. The exercise uses exactly that to train a bigram model with a few lines of NumPy.

```mermaid
flowchart LR
  T["Training text"] --> F["Forward pass<br/>all positions at once"]
  F --> L["Cross-entropy<br/>vs the real next tokens"]
  L --> G["Backpropagation<br/>gradients"]
  G --> U["Update weights"]
  U --> F
```

### The loss floor

Loss does not reach 0 on natural text, or in the exercise. The exercise trains a **bigram** model: it sees only the previous token. After "the", the corpus continues with cat, dog, mat or rug, and one token of context cannot tell which. The best a bigram model can do on this corpus is the conditional entropy given one token, about 0.59. The exercise gets close, around 0.64 after 300 steps. A model with two tokens of context would do better ("on the" is always followed by mat or rug, "to the" by cat or dog), which is the follow-up at the end. Real language models face the same kind of irreducible uncertainty, which is also why a training loss of 0 means memorization, not understanding.

### From probabilities to text

The model gives a distribution. You choose how to draw from it:

- **Greedy:** always take the highest probability token. Deterministic, often repetitive.
- **Temperature `T`:** divide logits by `T` before softmax. `T < 1` sharpens the distribution (more predictable), `T > 1` flattens it (more random). As `T` approaches 0 it becomes greedy; as `T` grows it approaches uniform.
- **Top-k:** keep only the `k` most likely tokens.
- **Top-p (nucleus):** keep the smallest set of tokens whose cumulative probability reaches `p`, so the cutoff adapts to how confident the model is.

Low temperature does not make a model correct. It makes it consistent. A wrong answer can be sampled every time.

## The engineering connection

- **Why outputs vary.** Sampling is built in. Set temperature near 0 for extraction, classification or tests. Use higher values for brainstorming. Even at 0, different hardware and batching can cause small nondeterminism, so never rely on bit-exact repeats.
- **Why hallucination exists.** The objective rewards plausible continuations, not truth. When the training data does not determine the answer, the model still has to put its probability somewhere.
- **Training versus inference economics.** Training is a huge, one-off, parallel job. Inference is repeated, sequential per token and memory-bound. This shapes both pricing and architecture.
- **Phases beyond next-token training.** Pretraining is this lesson. Instruction tuning continues with the same next-token loss on curated conversations; preference and reinforcement learning stages then optimize a reward instead. All of them start from the pretrained weights, which is why pretraining sets the ceiling.
- **Structured output.** Constrained decoding masks tokens that would break a grammar or JSON schema before sampling. Like top-p it zeroes out part of the distribution, but the filter is validity, not probability mass.

## Hands-on challenge

File: `lessons/lesson_05_training_generation.py`. Numpy only. It trains a tiny bigram model on a 42-word corpus with hand-written gradients, then generates text under different sampling settings. About 10 minutes.

**Predict before you run:**

1. What is the loss of the untrained model? Compute `ln(V)` first.
2. Will training reach loss 0? If not, what is the lowest it can reach, and why?
3. After the word "the", what will the learned distribution look like?
4. What does temperature do to the entropy of that distribution at 0.2 and at 5?
5. Which setting will produce the most repetitive text, and which the most chaotic?

::: predict
P: untrained | number | claim:untrained | 0.05 | What is the loss of the untrained model?
P: final | number | claim:loss300 | 0.05 | What is the loss after 300 steps?
P: zero | choice:yes=Yes;no=No | no | | Will training reach a loss of 0?
:::

The run command is at the bottom of this page.

<details>
<summary>What the script printed for me (open after predicting)</summary>

- `V = {{claim:vocab}}`, `ln(V) = {{claim:lnv}}`, untrained loss {{claim:untrained}}.
- Loss: {{claim:loss1}} after step 1, {{claim:loss20}} at step 20, {{claim:loss50}} at step 50, {{claim:loss100}} at step 100, {{claim:loss300}} at step 300. It plateaus, and does not go to 0.
- After "the": {{claim:after_the}}.
- Entropy after "the": {{claim:ent02}} at T=0.2, {{claim:ent1}} at T=1, {{claim:ent5}} at T=5 (the maximum possible for 10 tokens is 2.30).
- Low temperature gives loops: "{{claim:sample_cold}}". High temperature with no top-p gives word salad: "{{claim:sample_hot}}". Top-p 0.5 reduces the damage at T=3 but does not remove it: "{{claim:sample_hot_nucleus}}". The distribution is flat enough that top-p keeps several tokens, and "ran to mat" is a transition the corpus never had.
- The sampled lines are identical on every run because both seeds are fixed. Training and sampling use separate generators, so changing the sampling seed leaves the losses untouched.

</details>

Follow-ups: increase the corpus and watch the floor move. Replace the bigram table with a two-token context. Implement top-k and compare it with top-p at the same temperature.

## Takeaways

1. Training minimizes cross-entropy on next-token prediction. A model that knows nothing has loss `ln(V)`, and the loss floor is the unpredictability of the data.
2. Teacher forcing makes training parallel across positions. Generation is inherently sequential.
3. Temperature reshapes the distribution and top-p truncates its tail. They control randomness, not correctness.

**Check question:** you set temperature to 0 for a classification task and still see wrong answers every time for one input. What does that tell you, and what would you change instead of the temperature?

**Next up:** putting this to work. Retrieval and context are how we give a frozen model knowledge it was never trained on.

::: quiz
Q: A freshly initialized model with a 50,000-token vocabulary: what is its loss, roughly, and why?
A: About ln(50000), near 10.8. With no knowledge it spreads probability evenly, so every correct token gets probability 1/50000 and the loss is minus the log of that.
Q: Why can training process a whole document in one forward pass while generation is token by token?
A: Teacher forcing feeds the true text and the causal mask hides the future, so every position is a prediction at once. In generation each next token depends on the token just sampled, so steps are sequential.
Q: Temperature 0 and the answer is still wrong every time. What does that tell you?
A: The model's top token is wrong for that input. Temperature only controls randomness. Fix the prompt, the retrieved context or the model, not the sampling.
:::

## References

- Holtzman et al., "The Curious Case of Neural Text Degeneration" (2019), the nucleus (top-p) sampling paper: https://arxiv.org/abs/1904.09751
- Radford et al., "Language Models are Unsupervised Multitask Learners" (2019), next-token pretraining at scale: https://cdn.openai.com/better-language-models/language_models_are_unsupervised_multitask_learners.pdf
- Ouyang et al., "Training language models to follow instructions with human feedback" (2022), the stages after pretraining: https://arxiv.org/abs/2203.02155
