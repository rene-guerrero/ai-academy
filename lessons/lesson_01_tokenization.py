import tiktoken

encoding = tiktoken.get_encoding("cl100k_base")

samples = [
    "strawberry",
    " strawberry",
    "Strawberry",
    "fresa",
    "12345678",
    "The quick brown fox",
]

print("=== Lesson 1: tokenization ===")
print("Predict the token counts and splits before reading the output.\n")

for text in samples:
    ids = encoding.encode(text)
    pieces = [encoding.decode([i]) for i in ids]
    print(f"{text!r:28} tokens={len(ids):<3} ids={ids} pieces={pieces}")

english = "I would like to know how I can get a refund for the product I bought last week."
spanish = "Quisiera saber cómo puedo obtener un reembolso por el producto que compré la semana pasada."

print("\n=== Bonus: English vs Spanish ===")
for label, text in [("English", english), ("Spanish", spanish)]:
    print(f"{label:8} characters={len(text):<4} tokens={len(encoding.encode(text))}")
