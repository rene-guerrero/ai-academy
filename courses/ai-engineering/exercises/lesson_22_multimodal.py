import numpy as np

rng = np.random.default_rng(22)
patch = 16


def make_image(size):
    yy, xx = np.mgrid[0:size, 0:size] / size
    image = np.zeros((size, size))
    image[(xx - 0.3) ** 2 + (yy - 0.35) ** 2 < 0.15 ** 2] = 1.0
    image[(xx > 0.55) & (xx < 0.85) & (yy > 0.55) & (yy < 0.8)] = 0.6
    return image


def patchify(image):
    rows, cols = image.shape[0] // patch, image.shape[1] // patch
    grid = image[: rows * patch, : cols * patch].reshape(rows, patch, cols, patch)
    return grid.transpose(0, 2, 1, 3).reshape(rows * cols, patch * patch), rows, cols


print("=== Part A: an image becomes a grid of patch tokens ===")
image = make_image(224)
patches, rows, cols = patchify(image)
print(f"Image 224x224 -> grid {rows} x {cols} = {rows * cols} patches of {patch * patch} values")
print("Patch map (# circle, + rectangle, . background):")
means = patches.mean(axis=1).reshape(rows, cols)
for r in range(rows):
    print("  " + "".join("#" if m > 0.7 else "+" if m > 0.3 else "." for m in means[r]))
rebuilt = patches.reshape(rows, cols, patch, patch).transpose(0, 2, 1, 3).reshape(224, 224)
print(f"Patches reassemble the exact image: {np.array_equal(rebuilt, image)}")

print("\nToken count versus resolution (16x16 patches):")
base = (224 // patch) ** 2
for size in [224, 448, 896, 1344]:
    tokens = (size // patch) ** 2
    print(f"  {size:>4} px: {size // patch:>2} x {size // patch:<2} = {tokens:>5} tokens  ({tokens / base:.0f}x the 224 count)")

d_model = 64
projection = rng.normal(size=(patch * patch, d_model)) / np.sqrt(patch * patch)
positions = np.arange(rows * cols)[:, None]
freqs = 1.0 / (10000 ** (np.arange(0, d_model, 2) / d_model))
position_table = np.zeros((rows * cols, d_model))
position_table[:, 0::2] = np.sin(positions * freqs)
position_table[:, 1::2] = np.cos(positions * freqs)
embeddings = patches @ projection + position_table
print(f"\nPatch embeddings: {patches.shape} @ {projection.shape} + positions = {embeddings.shape}")
background = [i for i in range(rows * cols) if means.flat[i] == 0.0]
same_content = np.allclose(patches[background[0]], patches[background[1]])
differ = not np.allclose(embeddings[background[0]], embeddings[background[1]])
print(f"Two background patches: same pixels {same_content}, different embeddings after positions {differ}")

print("\nSmall text at low resolution: 1-pixel stripes drawn at 896 px")
stripes = np.zeros((896, 896))
stripes[:, ::2] = 1.0
for factor in [1, 2, 4]:
    small = stripes.reshape(896 // factor, factor, 896 // factor, factor).mean(axis=(1, 3))
    print(f"  downsampled to {896 // factor:>3} px: stripe contrast = {small.max() - small.min():.3f}")

print("\n=== Part B: contrastive image-text embeddings (CLIP-style) ===")
concepts = ["a cat", "an invoice", "a bar chart", "a login screen"]
dim = 32


def normalize(m):
    return m / np.linalg.norm(m, axis=1, keepdims=True)


anchors = normalize(rng.normal(size=(len(concepts), dim)))


def embed(noise, count=1):
    base = np.repeat(anchors, count, axis=0)
    return normalize(base + noise * rng.normal(size=base.shape) / np.sqrt(dim))


image_vectors = embed(0.8)
text_vectors = embed(0.8)
similarity = image_vectors @ text_vectors.T
print("Cosine similarity (rows = images, columns = captions)")
for name, row in zip(concepts, similarity):
    print(f"  {name:>15}  " + "  ".join(f"{s:6.3f}" for s in row))


def info_nce(img, txt, temperature):
    logits = img @ txt.T / temperature
    logits = logits - logits.max(axis=1, keepdims=True)
    log_probs = logits - np.log(np.exp(logits).sum(axis=1, keepdims=True))
    logits_t = (txt @ img.T) / temperature
    logits_t = logits_t - logits_t.max(axis=1, keepdims=True)
    log_probs_t = logits_t - np.log(np.exp(logits_t).sum(axis=1, keepdims=True))
    return -(np.diag(log_probs).mean() + np.diag(log_probs_t).mean()) / 2


print(f"InfoNCE loss, matched pairs:  {info_nce(image_vectors, text_vectors, 0.07):.3f}")
print(f"InfoNCE loss, shuffled pairs: {info_nce(image_vectors, text_vectors[[1, 2, 3, 0]], 0.07):.3f}")
print(f"Loss of a model that cannot tell pairs apart: ln(4) = {np.log(4):.3f}")

labels = np.repeat(np.arange(len(concepts)), 25)
for noise in [1.0, 3.0, 6.0]:
    new_images = embed(noise, 25)
    predicted = (new_images @ text_vectors.T).argmax(axis=1)
    print(f"Zero-shot accuracy on 100 new images, noise {noise:.1f}: {(predicted == labels).mean():.2f}")

print("\n=== Part C: audio becomes frames ===")
rate = 16000
t = np.arange(rate) / rate
signal = np.where(t < 0.5, np.sin(2 * np.pi * 440 * t), np.sin(2 * np.pi * 1000 * t))
signal = signal + 0.05 * rng.normal(size=rate)
window, hop = int(0.025 * rate), int(0.010 * rate)
count = 1 + (len(signal) - window) // hop
frames = np.stack([signal[i * hop: i * hop + window] for i in range(count)]) * np.hanning(window)
spectrum = np.abs(np.fft.rfft(frames, axis=1))
bin_hz = rate / window
print(f"Window {window} samples (25 ms), hop {hop} samples (10 ms), bin width {bin_hz:.0f} Hz")
print(f"Frames for 1 second: {count}  (about {rate // hop} per second)")
print(f"Frames for a 30-second clip: {1 + (30 * rate - window) // hop}")
peaks = spectrum.argmax(axis=1) * bin_hz
first = np.bincount(peaks[: count // 2 - 2].astype(int)).argmax()
second = np.bincount(peaks[count // 2 + 2:].astype(int)).argmax()
print(f"Dominant frequency, first half: {first} Hz")
print(f"Dominant frequency, second half: {second} Hz")
print(f"Spectrum per frame: {spectrum.shape[1]} values, so the clip is a {count} x {spectrum.shape[1]} matrix")
