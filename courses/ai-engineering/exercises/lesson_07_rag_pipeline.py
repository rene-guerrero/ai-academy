import math
import re

documents = [
    ("expenses", "Travel expense policy. Employees book flights through the travel portal. Economy class is required for flights under six hours. Meals while traveling are reimbursed up to 60 euros per day. Receipts are mandatory for any single expense above 25 euros. Claims must be submitted within 30 days of returning from the trip, otherwise finance rejects them."),
    ("backups", "Database backup runbook. Database backups run every night at 02:00 UTC on the primary cluster. Each nightly snapshot is copied to a second region. Snapshots are kept for 35 days and then deleted automatically. A restore drill is performed every quarter by the on-call database engineer."),
    ("oncall", "On-call handbook. The primary on-call engineer must acknowledge a page within 5 minutes. If the page is not acknowledged, it escalates to the secondary engineer after 15 minutes. On-call shifts last one week and rotate every Monday at 10:00. Engineers receive a stipend of 300 euros for each week on call."),
    ("incidents", "Incident severity guide. A SEV1 is a full outage of a customer facing service. A SEV2 is a degraded service or a partial outage. For a SEV1 the incident commander posts a status update every 30 minutes. Every SEV1 and SEV2 requires a written postmortem within five business days."),
    ("laptops", "Hardware refresh policy. Company equipment is replaced on a three year cycle. To get a replacement machine early, open a ticket in the IT portal with the asset tag. Lost or stolen devices must be reported to security within 24 hours so the disk can be wiped remotely."),
    ("leave", "Vacation and leave policy. Full time employees accrue 25 days of paid vacation per year. Up to 5 unused days can be carried over into the next year. Requests longer than two weeks need approval from the department head. Parental leave is 16 weeks at full pay."),
    ("access", "Production access policy. Engineers get production access only through the break glass tool. Each grant expires automatically after 4 hours. Every grant is logged and reviewed by the security team the next morning. Contractors are never granted production access."),
    ("deploys", "Deployment runbook. Deploys to production happen Monday to Thursday between 09:00 and 16:00. No deploys are allowed on Fridays or during a declared freeze. Every deploy needs one approving code review and a green pipeline. A rollback must be possible within 10 minutes."),
    ("passwords", "Password and authentication standard. Passwords must have at least 14 characters. Multi factor authentication is mandatory for email, the VPN and the cloud console. Service account keys are rotated every 90 days by the platform team."),
    ("retention", "Customer data retention policy. Customer support tickets are retained for 2 years. Application logs that contain personal data are deleted after 30 days. When a customer closes the account, their profile data is erased within 60 days."),
    ("vendors", "Vendor onboarding procedure. Any new vendor that processes customer data needs a security review before the contract is signed. The review takes about ten business days. Purchases above 10000 euros also require approval from the chief financial officer."),
    ("remote", "Remote work policy. Employees may work remotely up to three days per week. Working from another country is allowed for at most 30 days per year. The company pays a home office allowance of 500 euros once, in the first month."),
]

questions = [
    ("What is the daily meal limit when traveling?", "expenses", "60 euros"),
    ("Within how many days must expense claims be submitted?", "expenses", "30 days"),
    ("How long are database backups kept?", "backups", "35 days"),
    ("How often is a restore drill performed?", "backups", "every quarter"),
    ("How fast must the on-call engineer acknowledge a page?", "oncall", "5 minutes"),
    ("How much is the on-call stipend per week?", "oncall", "300 euros"),
    ("How often does the incident commander post updates during a SEV1?", "incidents", "every 30 minutes"),
    ("How do I get a new laptop?", "laptops", "open a ticket"),
    ("How many unused vacation days carry over?", "leave", "5 unused days"),
    ("When does a production access grant expire?", "access", "4 hours"),
    ("Can I deploy on a Friday?", "deploys", "No deploys are allowed on Fridays"),
    ("How often are service account keys rotated?", "passwords", "90 days"),
    ("When are logs with personal data deleted?", "retention", "30 days"),
    ("Who must approve a purchase above 10000 euros?", "vendors", "chief financial officer"),
]

stopwords = set("a an the is are be of to for in on at by and or do i can how what when who must within much many does per as it its their any up into with get".split())


def tokenize(text):
    return [t for t in re.findall(r"[a-z0-9:]+", text.lower()) if t not in stopwords]


def chunk_words(text, size, overlap):
    words = text.split()
    starts = range(0, max(len(words) - overlap, 1), size - overlap)
    return [" ".join(words[start:start + size]) for start in starts]


class BM25:
    def __init__(self, texts, k1=1.2, b=0.75):
        self.docs = [tokenize(t) for t in texts]
        self.avg_len = sum(len(d) for d in self.docs) / len(self.docs)
        self.k1, self.b = k1, b
        df = {}
        for d in self.docs:
            for term in sorted(set(d)):
                df[term] = df.get(term, 0) + 1
        n = len(self.docs)
        self.idf = {t: math.log(1 + (n - f + 0.5) / (f + 0.5)) for t, f in df.items()}

    def score(self, query, i):
        doc = self.docs[i]
        total = 0.0
        for term in tokenize(query):
            tf = doc.count(term)
            if tf:
                norm = tf + self.k1 * (1 - self.b + self.b * len(doc) / self.avg_len)
                total += self.idf[term] * tf * (self.k1 + 1) / norm
        return total

    def search(self, query, k):
        scored = [(self.score(query, i), i) for i in range(len(self.docs))]
        scored.sort(key=lambda pair: (-pair[0], pair[1]))
        return [i for s, i in scored[:k] if s > 0]


def build_prompt(question, sources):
    tagged = [f"[{number}] {text}" for number, text in enumerate(sources, 1)]
    header = "Answer using only the sources. Cite them like [1]. If the answer is not there, say so."
    return "\n".join([header, ""] + tagged + ["", f"Question: {question}"])


def extractive_answer(question, sources, index):
    query_terms = set(tokenize(question))
    best = (0.0, "", 0)
    for number, text in enumerate(sources, 1):
        for sentence in re.split(r"(?<=\.)\s+", text):
            overlap = query_terms & set(tokenize(sentence))
            score = sum(index.idf.get(t, 0.0) for t in sorted(overlap))
            if score > best[0]:
                best = (score, sentence, number)
    return best[1], best[2]


def run(size, overlap, k):
    chunks = [(doc_id, piece) for doc_id, text in documents for piece in chunk_words(text, size, overlap)]
    index = BM25([piece for _, piece in chunks])
    hits = present = correct = correct_given_fact = words_sent = 0
    failures = []
    for question, expected_doc, fact in questions:
        top = index.search(question, k)
        sources = [chunks[i][1] for i in top]
        retrieved_docs = [chunks[i][0] for i in top]
        hit = expected_doc in retrieved_docs
        fact_present = any(fact in text for text in sources)
        sentence, cited = extractive_answer(question, sources, index)
        cited_doc = retrieved_docs[cited - 1] if cited else "none"
        right = fact in sentence and cited_doc == expected_doc
        hits += hit
        present += fact_present
        correct += right
        correct_given_fact += right and fact_present
        words_sent += sum(len(text.split()) for text in sources)
        if not right:
            label = "fact retrieved, answer wrong" if fact_present else ("right document, fact cut off" if hit else "retrieval missed")
            failures.append(f"  [{label}] {question}")
            failures.append(f"    retrieved: {', '.join(retrieved_docs) if retrieved_docs else 'nothing'}")
            failures.append(f"    answer: {sentence if sentence else 'not found'} [{cited}]")
    n = len(questions)
    print(f"--- chunk size {size} words, overlap {overlap}, top-k {k} ---")
    print(f"Chunks indexed = {len(chunks)}, average words sent per question = {words_sent / n:.1f}")
    print(f"Retrieval recall@{k} (right document) = {hits / n:.3f}")
    print(f"Context recall (fact inside retrieved text) = {present / n:.3f}")
    print(f"Answer accuracy (fact in answer, right citation) = {correct / n:.3f}")
    print(f"Answer accuracy when the fact was retrieved = {correct_given_fact / max(present, 1):.3f}")
    print("\n".join(failures))
    return chunks, index


print("=== Lesson 7: a RAG pipeline end to end ===")
print(f"Documents = {len(documents)}, labeled questions = {len(questions)}")
small_chunks, small_index = run(20, 5, 3)
run(60, 15, 3)
question = questions[2][0]
top = small_index.search(question, 3)
print("\n--- assembled prompt for one question, chunk size 20 ---")
print(build_prompt(question, [small_chunks[i][1] for i in top]))
sentence, cited = extractive_answer(question, [small_chunks[i][1] for i in top], small_index)
print(f"Extractive answer: {sentence} [{cited}]")
print("The answerer picks the sentence with the most rare question words. A real LLM replaces it.")
