---
title: A small neural network from scratch
summary: Tensors and shapes, the forward pass, backpropagation with a gradient check, mini-batch training, and how to see and fix overfitting, in NumPy with the PyTorch equivalent alongside.
area: D
n: 16
minutes: 35
author: claude
drafted: 2026-10-21
reviewed: 
runtime: pyodide
exercise: exercises/lesson_16_small_network.py
level: core
prereqs: 04-transformer-block, 05-training-and-generation
---

## The hook

A network with {{claim:big_params}} parameters is trained on 30 points. Its training loss keeps falling for 1,500 epochs, its training accuracy climbs toward 100%, and every dashboard that only watches the training loss says it is improving. Meanwhile its loss on fresh data from the same distribution has been getting worse since about epoch {{claim:early_epoch}}.

Nothing crashed and nothing threw an exception. The only way to see it is to hold back data the model never trains on and look at both curves. This lesson builds the whole thing by hand in a short NumPy script, so that later, when PyTorch does it for you, you know what each line is hiding.

## The simple explanation

A neural network is a function with a lot of adjustable knobs. Training is a loop: run the function on a few examples, measure how wrong it is with a single number (the loss), work out for every knob which way to turn it to make that number smaller, turn every knob a little, and repeat.

The "work out which way" step is backpropagation. It is not magic and not an approximation: it is the chain rule from calculus, applied from the output back to the input, reusing the values computed on the way forward. Where the analogy breaks: the knobs are not independent. Turning one changes what the others should do, which is why you take many small steps instead of one big one. And "smaller loss on the examples you practise on" is not the goal. The goal is smaller loss on examples you have never seen, and the two can move in opposite directions.

## Under the hood

### Tensors and shapes

A tensor is an n-dimensional array with a shape. Almost every bug in a hand-written network is a shape bug, so the exercise prints them. A batch of 32 two-dimensional points is `(32, 2)`. The first layer has a weight matrix `W1` of shape `(2, 16)` and a bias `b1` of shape `(16,)`. The second layer maps 16 hidden units to 2 class scores: `W2` is `(16, 2)`, `b2` is `(2,)`. In total {{claim:param_count}} numbers. The convention matters: rows are examples, columns are features. Then `x @ W1` is `(32, 2) @ (2, 16) = (32, 16)`, and the bias broadcasts across the 32 rows. In C# terms, think of a batch as a table: one row per example, one column per feature, and every layer is a projection of that table into new columns.

### The forward pass

```
h      = tanh(x @ W1 + b1)
logits = h @ W2 + b2
p      = softmax(logits)
loss   = mean(-log p[y])
```

The `tanh` is what makes it a neural network and not a linear model. Without it, `(x @ W1) @ W2` collapses into a single matrix `x @ (W1 @ W2)`, and two layers would be no more expressive than one. The loss is the same cross-entropy as in lesson 5, with 2 classes instead of a vocabulary. A model that knows nothing would give each class probability 0.5 and a loss of `ln 2 = 0.693`. The freshly initialized network in the exercise scores {{claim:untrained_loss}} on validation data, worse than knowing nothing: random weights make it confidently wrong on many points, and confident mistakes are what cross-entropy punishes most.

### Backpropagation and the chain rule

Backpropagation walks the forward pass backwards. Each step multiplies the incoming gradient by the local derivative of one operation:

```
d_logits = (p - onehot(y)) / n
dW2      = h.T @ d_logits
db2      = d_logits.sum(axis=0)
d_h      = d_logits @ W2.T
d_z1     = d_h * (1 - h ** 2)
dW1      = x.T @ d_z1
db1      = d_z1.sum(axis=0)
```

Two patterns cover almost everything. For a matrix product `a @ W`, the gradient for `W` is `a.T @ upstream` and the gradient passed back to `a` is `upstream @ W.T`; the transposes are exactly what makes the shapes line up. For an elementwise function, multiply by its derivative; for `tanh` that is `1 - tanh²`, computed from `h`, which the forward pass already stored. That storage is why training uses much more memory than inference: every intermediate activation is kept until the backward pass has used it.

How do you know the backward code is right? You check it against the definition of a derivative. Nudge one parameter up by `eps = 1e-5`, then down, and take `(loss_plus - loss_minus) / (2 * eps)`. Compare with the analytic gradient using the relative error `|a - n| / (|a| + |n|)`, which runs from 0 (identical) to 1 (opposite signs, or one of them zero). The exercise checks all {{claim:param_count}} partial derivatives. With correct backprop the worst one is below 1e-6: `{{claim:gradcheck}}`. Leave out the `1 - h²` factor, a bug that does not crash and still lowers the loss for the first epochs, and the worst relative error is {{claim:buggy_error}}: at least one partial derivative has the wrong sign.

### Mini-batches and the training loop

Computing the gradient on all the data for every step is accurate but slow; using one example is fast but noisy. A mini-batch is the compromise. The exercise shuffles 400 training points every epoch and walks them in batches of 32, which is {{claim:steps_per_epoch}} weight updates per epoch (the last batch has 16 points). Each update is `param -= lr * grad`: plain stochastic gradient descent (SGD).

The other 200 points are the validation set. They are never used to compute a gradient. After each epoch the script measures loss and accuracy on both sets. On this well-sized problem the two curves fall together and end close: {{claim:small_train_acc}} training accuracy and {{claim:small_val_acc}} validation accuracy after 100 epochs. Validation slightly above training is noise: with 200 points, one point is half a percentage point.

### Overfitting, early stopping and weight decay

Now the hook. 30 noisy points, a hidden layer of 100 units ({{claim:big_params}} parameters), full-batch gradient descent for 1,500 epochs. The noise pushes some points deep into the other moon, so pushing training accuracy toward 100% can only come from memorizing them. Training loss falls the whole time. Validation loss goes from {{claim:overfit_val_loss_300}} at epoch 300 to {{claim:overfit_val_loss_final}} at the end. Final training accuracy is {{claim:overfit_train_acc}} against {{claim:overfit_val_acc}} on validation. The signature of overfitting is that gap, and validation loss rising while training loss falls.

Two standard fixes:
- **Early stopping:** keep the weights from the epoch with the lowest validation loss. Here that is epoch {{claim:early_epoch}}, with validation accuracy {{claim:early_val_acc}}. It limits the damage but does not make the model better than its best early moment.
- **Weight decay (L2 regularization):** add `0.5 * λ * sum(W²)` to the loss, so every gradient gets an extra `λ * W` and large weights are pulled toward zero. With `λ = 0.01` the same network, same data, same start ends at {{claim:decay_val_acc}} validation accuracy. Its training accuracy is lower, which is the point: it can no longer afford the sharp, wiggly boundary that memorization needs.

In this run weight decay beats early stopping. That depends on the data and the seed (the follow-ups let you see it change), which is why you compare them on validation data instead of picking one by habit.

### The same model in PyTorch

This is not run here; PyTorch does not run in this page. It is the same network and loop:

```python
import torch
from torch import nn

model = nn.Sequential(nn.Linear(2, 16), nn.Tanh(), nn.Linear(16, 2))
loss_fn = nn.CrossEntropyLoss()
optimizer = torch.optim.SGD(model.parameters(), lr=0.5, weight_decay=0.0)

x_train_t, y_train_t = torch.tensor(x_train, dtype=torch.float32), torch.tensor(y_train, dtype=torch.long)
x_val_t, y_val_t = torch.tensor(x_val, dtype=torch.float32), torch.tensor(y_val, dtype=torch.long)
train_set = torch.utils.data.TensorDataset(x_train_t, y_train_t)
loader = torch.utils.data.DataLoader(train_set, batch_size=32, shuffle=True)

for epoch in range(100):
    model.train()
    for xb, yb in loader:
        optimizer.zero_grad()
        loss = loss_fn(model(xb), yb)
        loss.backward()
        optimizer.step()
    model.eval()
    with torch.no_grad():
        val_logits = model(x_val_t)
        val_loss = loss_fn(val_logits, y_val_t).item()
        val_acc = (val_logits.argmax(dim=1) == y_val_t).float().mean().item()
```

| NumPy exercise | PyTorch |
|---|---|
| `np.ndarray` with a shape | `torch.Tensor`, same shapes, can live on a GPU |
| `W1`, `b1`, `W2`, `b2` in a dict | `nn.Linear` layers inside an `nn.Module` (`nn.Sequential` here) |
| softmax plus `-log p[y]` | `nn.CrossEntropyLoss`, which takes raw logits |
| hand-written `loss_and_grads` | autograd: `loss.backward()` fills `param.grad` for every parameter |
| `params[name] -= lr * grads[name]` | `optimizer.step()`, after `optimizer.zero_grad()` clears old gradients |
| shuffled index batches | `DataLoader(..., shuffle=True)` |
| `weight_decay * W` in the gradient | `SGD(..., weight_decay=λ)` |
| evaluating without updating | `model.eval()` and `torch.no_grad()` |

Three differences worth knowing. `nn.Linear` uses its own default initialization, so the numbers will not match the exercise. `weight_decay` in the optimizer also decays the biases, which the exercise does not. And `model.train()` / `model.eval()` change nothing for this model; they switch layers such as dropout and batch normalization between training and inference behaviour, so forgetting `eval()` in a model that has them silently changes its predictions.

## The engineering connection

- **Always log validation metrics next to training metrics.** A training loss curve alone cannot tell learning from memorization. This holds when you fine-tune a language model too: watch eval loss on held-out examples, not just the training loss the job prints.
- **Early stopping is a checkpoint policy.** Save a checkpoint whenever validation loss improves and stop after a patience window with no improvement. Choosing that epoch or `λ` by validation score means you have tuned on the validation set, so report final quality on a separate test set.
- **Gradient checks catch silent bugs.** A wrong derivative can still lower the loss for a while, so the training curve will not tell you. Any time you write a custom layer or loss, compare it with finite differences on a tiny input in float64 before trusting it.
- **Weight decay with Adam is not L2.** With plain SGD, adding `λW` to the gradient and shrinking weights each step are the same thing. With adaptive optimizers they differ, which is why AdamW applies decay separately from the gradient.

## Hands-on challenge

File: `courses/ai-engineering/exercises/lesson_16_small_network.py`. NumPy only. It builds a two-moons dataset, a 2-layer tanh network with hand-written backprop, checks the gradients against finite differences, trains with mini-batch SGD while printing train and validation metrics, then overfits a larger network on 30 points and compares no regularization, early stopping and weight decay. About 15 minutes.

**Predict before you run:**

1. Will the untrained network's validation loss be below, near, or above `ln 2 = 0.693`?
2. With the `1 - h²` factor left out of backprop, how large will the worst relative error be on a scale from 0 to 1?
3. After 1,500 epochs on 30 points with no regularization, what validation accuracy will the large network have?
4. Which gives the best validation accuracy: no regularization, early stopping, or weight decay 0.01?

::: predict
P: untrained | choice:below=Below ln 2;near=Near ln 2;above=Above ln 2 | above | | Where is the untrained network's validation loss relative to ln 2?
P: bug | number | claim:buggy_error | 0.25 | Worst relative error with the tanh derivative left out (0 to 1)?
P: overfit | number | claim:overfit_val_acc | 0.05 | Validation accuracy of the overfit network after 1,500 epochs?
P: winner | choice:none=No regularization;early=Early stopping;decay=Weight decay 0.01 | decay | | Which gives the best validation accuracy?
:::

The run command is at the bottom of this page.

<details>
<summary>What the script printed for me (open after predicting)</summary>

- {{claim:param_count}} parameters; untrained validation loss {{claim:untrained_loss}}, above `ln 2` because random weights are confidently wrong on part of the data.
- Gradient check: correct backprop below 1e-6 is `{{claim:gradcheck}}`; without the tanh derivative the worst relative error is {{claim:buggy_error}}, the maximum of the scale.
- Mini-batch SGD with {{claim:steps_per_epoch}} steps per epoch reaches {{claim:small_train_acc}} train and {{claim:small_val_acc}} validation accuracy. No overfitting with 400 points and {{claim:param_count}} parameters.
- The {{claim:big_params}}-parameter network on 30 points: validation loss rises from {{claim:overfit_val_loss_300}} to {{claim:overfit_val_loss_final}} while training loss falls; final accuracy {{claim:overfit_train_acc}} train against {{claim:overfit_val_acc}} validation.
- Early stopping picks epoch {{claim:early_epoch}} ({{claim:early_val_acc}} validation accuracy). Weight decay 0.01 ends at {{claim:decay_val_acc}}, the best of the three in this run.

</details>

Follow-ups: change the seed `160` and see how often weight decay wins over early stopping. Try `λ = 0.001` and `0.1` and find where it starts to underfit. Replace `tanh` with ReLU, update the derivative, and make the gradient check pass again (if one entry fails, a pre-activation within `eps` of 0, where ReLU has a kink, is the usual cause).

## Takeaways

1. A network is matrix products plus nonlinearities, and getting the shapes right (rows are examples, columns are features) is most of the work.
2. Backpropagation is the chain rule run in reverse over stored activations. Verify it with finite differences; a wrong gradient can still lower the loss.
3. Overfitting is visible only on held-out data: training loss falls while validation loss rises. Early stopping and weight decay are the first tools, chosen by validation results.

**Check question:** your fine-tuning job shows training loss steadily decreasing and evaluation loss bottoming out at step 400 and rising after that. Which checkpoint do you ship, and what two things would you try next?

**Next up:** fine-tuning and LoRA. The same loop, started from a pretrained model, with most of its weights frozen.

::: quiz
Q: Why does a 2-layer network need a nonlinearity like tanh between the layers?
A: Without it, `(x @ W1) @ W2` equals `x @ (W1 @ W2)`, a single linear layer. The nonlinearity is what lets stacked layers represent curved decision boundaries.
Q: For `out = a @ W`, what are the gradients with respect to `W` and `a`, given the upstream gradient `g`?
A: `dW = a.T @ g` and `da = g @ W.T`. The transposes are exactly what makes the shapes match the shapes of `W` and `a`.
Q: Training accuracy reaches 100% and validation accuracy drops. Name the problem and two fixes.
A: Overfitting: the model memorizes training noise. Stop early at the lowest validation loss, add weight decay, or get more data or a smaller model.
:::

## References

- Rumelhart, Hinton and Williams, "Learning representations by back-propagating errors", Nature (1986): https://www.nature.com/articles/323533a0
- Goodfellow, Bengio and Courville, "Deep Learning" (2016), chapter 6 on backpropagation and chapter 7 on regularization and early stopping: https://www.deeplearningbook.org/
- Stanford CS231n notes, "Neural Networks Part 3", including gradient checks: https://cs231n.github.io/neural-networks-3/
- Loshchilov and Hutter, "Decoupled Weight Decay Regularization" (2017), the AdamW paper: https://arxiv.org/abs/1711.05101
- PyTorch tutorials, "Learn the Basics" (tensors, autograd, nn.Module, optimization loop): https://pytorch.org/tutorials/beginner/basics/intro.html
