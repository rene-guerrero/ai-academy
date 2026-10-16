import math
import re
from collections import Counter

import numpy as np
from sentence_transformers import SentenceTransformer

DOCS = {
    "refund": "Refund policy: you can return any product within 30 days of delivery and receive your money back.",
    "password": "To reset your password, open Settings, choose Security and click Forgot password.",
    "shipping": "Standard shipping takes 3 to 5 business days. Express shipping arrives in 1 to 2 days.",
    "err4021": "Error ERR-4021 means the payment gateway timed out. Retry the payment after one minute.",
    "err4012": "Error ERR-4012 means the card was declined by the issuing bank. Use a different card.",
    "invoice": "Invoices are emailed on the first day of each month and can be downloaded from the Billing page.",
    "cancel": "You can cancel your subscription at any time from Billing. Access continues until the period ends.",
    "damaged": "If your order arrives damaged, send us a photo within 7 days and we will send a replacement.",
    "privacy": "We never sell personal data. You can request deletion of your account data at any time.",
    "twofactor": "Enable two-factor authentication to protect your account with a code from an authenticator app.",
    "address": "Change your delivery address before the order ships from the Orders page.",
    "student": "Students get a 20 percent discount with a valid university email address.",
}

QUERIES = [
    ("How do I get my money back?", "refund"),
    ("I forgot my login credentials", "password"),
    ("How long until my package shows up?", "shipping"),
    ("What does ERR-4021 mean?", "err4021"),
    ("ERR-4012", "err4012"),
    ("When will I receive my bill?", "invoice"),
    ("Stop my plan", "cancel"),
    ("The item I got is broken", "damaged"),
    ("Delete my data", "privacy"),
    ("Extra security for my account", "twofactor"),
    ("Is there a discount for universities?", "student"),
    ("Update where my order is going", "address"),
]

DOC_IDS = list(DOCS)


def tokenize(text):
    return re.findall(r"[a-z0-9\-]+", text.lower())


class BM25:
    def __init__(self, docs, k1=1.5, b=0.75):
        self.tokens = [tokenize(docs[doc_id]) for doc_id in docs]
        self.n = len(self.tokens)
        self.avg_len = sum(len(t) for t in self.tokens) / self.n
        self.df = Counter(word for t in self.tokens for word in set(t))
        self.k1 = k1
        self.b = b

    def scores(self, query):
        result = np.zeros(self.n)
        for index, doc_tokens in enumerate(self.tokens):
            counts = Counter(doc_tokens)
            for word in tokenize(query):
                if word not in counts:
                    continue
                idf = math.log(1 + (self.n - self.df[word] + 0.5) / (self.df[word] + 0.5))
                f = counts[word]
                norm = f + self.k1 * (1 - self.b + self.b * len(doc_tokens) / self.avg_len)
                result[index] += idf * f * (self.k1 + 1) / norm
        return result


def ranking_from_scores(scores):
    order = np.argsort(-scores, kind="stable")
    return [DOC_IDS[i] for i in order]


def reciprocal_rank_fusion(rankings, k=60):
    fused = Counter()
    for ranking in rankings:
        for position, doc_id in enumerate(ranking):
            fused[doc_id] += 1 / (k + position + 1)
    return [doc_id for doc_id, _ in fused.most_common()]


def evaluate(name, all_rankings):
    n = len(QUERIES)
    hit1 = sum(r[0] == expected for r, (_, expected) in zip(all_rankings, QUERIES)) / n
    hit3 = sum(expected in r[:3] for r, (_, expected) in zip(all_rankings, QUERIES)) / n
    mrr = sum(1 / (r.index(expected) + 1) for r, (_, expected) in zip(all_rankings, QUERIES)) / n
    print(f"{name:10} hit@1={hit1:.2f}  hit@3={hit3:.2f}  MRR={mrr:.2f}")


model = SentenceTransformer("all-MiniLM-L6-v2")
doc_vectors = model.encode([DOCS[i] for i in DOC_IDS], normalize_embeddings=True)
bm25 = BM25(DOCS)

keyword_rankings = []
vector_rankings = []
hybrid_rankings = []

for query, _ in QUERIES:
    keyword = ranking_from_scores(bm25.scores(query))
    query_vector = model.encode(query, normalize_embeddings=True)
    vector = ranking_from_scores(doc_vectors @ query_vector)
    keyword_rankings.append(keyword)
    vector_rankings.append(vector)
    hybrid_rankings.append(reciprocal_rank_fusion([keyword, vector]))

print("=== Lesson 6: semantic search evaluation ===")
evaluate("keyword", keyword_rankings)
evaluate("vector", vector_rankings)
evaluate("hybrid", hybrid_rankings)

print("\nTop-1 misses per method:")
for name, rankings in [("keyword", keyword_rankings), ("vector", vector_rankings), ("hybrid", hybrid_rankings)]:
    misses = [
        f"{query!r} -> got {r[0]}, wanted {expected}"
        for r, (query, expected) in zip(rankings, QUERIES)
        if r[0] != expected
    ]
    print(f"\n{name} ({len(misses)} misses)")
    for line in misses:
        print(f"  {line}")
