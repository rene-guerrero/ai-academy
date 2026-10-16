from sentence_transformers import SentenceTransformer

model = SentenceTransformer("all-MiniLM-L6-v2")

pairs = [
    ("The movie was great", "The film was wonderful"),
    ("The movie was great", "The movie was not great"),
    ("Order #48213 has shipped", "Order #48231 has shipped"),
    ("How do I get my money back?", "Refund policy: returns within 30 days"),
    ("How do I get my money back?", "The cat sat on the warm windowsill"),
]

print("=== Lesson 2: embeddings ===")
print("Predict the ranking of the five pairs before reading the output.\n")

results = []
for a, b in pairs:
    va, vb = model.encode([a, b], normalize_embeddings=True)
    results.append((float(va @ vb), a, b))

for score, a, b in results:
    print(f"{score:.3f}  |  {a}  <->  {b}")

print("\nHighest to lowest:")
for score, a, b in sorted(results, reverse=True):
    print(f"{score:.3f}  |  {a}  <->  {b}")

sample_vector = model.encode("dimensions check", normalize_embeddings=True)
print(f"\nEmbedding dimensions: {len(sample_vector)}")
