import json
import math
import os
import unicodedata

import numpy as np

ASSETS = os.environ.get("AIA_ASSETS", "/home/pyodide/assets")
AVAILABLE = {
    "all-MiniLM-L6-v2": "minilm",
    "sentence-transformers/all-MiniLM-L6-v2": "minilm",
    "intfloat/multilingual-e5-small": "e5",
    "multilingual-e5-small": "e5",
}


def _is_whitespace(ch):
    return ch in " \t\n\r" or unicodedata.category(ch) == "Zs"


def _is_control(ch):
    if ch in "\t\n\r":
        return False
    return unicodedata.category(ch) in ("Cc", "Cf")


def _is_punctuation(ch):
    cp = ord(ch)
    if 33 <= cp <= 47 or 58 <= cp <= 64 or 91 <= cp <= 96 or 123 <= cp <= 126:
        return True
    return unicodedata.category(ch).startswith("P")


def _is_cjk(cp):
    return (
        0x4E00 <= cp <= 0x9FFF or 0x3400 <= cp <= 0x4DBF or 0x20000 <= cp <= 0x2A6DF
        or 0x2A700 <= cp <= 0x2B73F or 0x2B740 <= cp <= 0x2B81F or 0x2B820 <= cp <= 0x2CEAF
        or 0xF900 <= cp <= 0xFAFF or 0x2F800 <= cp <= 0x2FA1F
    )


class _WordPiece:
    def __init__(self, vocab_path, lower=True):
        with open(vocab_path, encoding="utf-8") as f:
            tokens = [line.rstrip("\n") for line in f]
        self.vocab = {t: i for i, t in enumerate(tokens)}
        self.ids_to_tokens = tokens
        self.lower = lower
        self.unk = self.vocab["[UNK]"]
        self.cls = self.vocab["[CLS]"]
        self.sep = self.vocab["[SEP]"]
        self.pad = self.vocab["[PAD]"]

    def _basic(self, text):
        cleaned = []
        for ch in text:
            cp = ord(ch)
            if cp == 0 or cp == 0xFFFD or _is_control(ch):
                continue
            if _is_whitespace(ch):
                cleaned.append(" ")
            elif _is_cjk(cp):
                cleaned.append(f" {ch} ")
            else:
                cleaned.append(ch)
        words = []
        for token in "".join(cleaned).split():
            if self.lower:
                token = token.lower()
                token = "".join(c for c in unicodedata.normalize("NFD", token) if unicodedata.category(c) != "Mn")
            current = []
            for ch in token:
                if _is_punctuation(ch):
                    if current:
                        words.append("".join(current))
                        current = []
                    words.append(ch)
                else:
                    current.append(ch)
            if current:
                words.append("".join(current))
        return words

    def _wordpiece(self, word):
        if len(word) > 100:
            return [self.unk]
        ids = []
        start = 0
        while start < len(word):
            end = len(word)
            found = None
            while start < end:
                piece = word[start:end]
                if start > 0:
                    piece = "##" + piece
                if piece in self.vocab:
                    found = self.vocab[piece]
                    break
                end -= 1
            if found is None:
                return [self.unk]
            ids.append(found)
            start = end
        return ids

    def encode(self, text, max_length):
        ids = []
        for word in self._basic(text):
            ids.extend(self._wordpiece(word))
        ids = ids[: max_length - 2]
        return [self.cls] + ids + [self.sep]


class _Unigram:
    def __init__(self, vocab_path):
        with open(vocab_path, encoding="utf-8") as f:
            data = json.load(f)
        vocab = data["vocab"]
        self.pieces = {p: (i, float(score)) for i, (p, score) in enumerate(vocab)}
        self.ids_to_tokens = [p for p, _ in vocab]
        self.unk = int(data["unk"])
        self.cls = int(data["bos"])
        self.sep = int(data["eos"])
        self.pad = int(data["pad"])
        self.special = {self.ids_to_tokens[i] for i in (self.unk, self.cls, self.sep, self.pad)}
        self.max_piece = max(len(p) for p in self.pieces)
        self.unk_score = min(score for _, score in vocab) - 10.0

    def _words(self, text):
        text = unicodedata.normalize("NFKC", text)
        cleaned = []
        for ch in text:
            cp = ord(ch)
            if cp == 0 or cp == 0xFFFD or _is_control(ch):
                continue
            cleaned.append(" " if _is_whitespace(ch) else ch)
        joined = "".join(cleaned)
        words = ["\u2581" + w for w in joined.split()]
        if words and joined.endswith(" "):
            words.append("\u2581")
        return words

    def _viterbi(self, word):
        n = len(word)
        best = [None] * (n + 1)
        best[0] = (0.0, 0, -1)
        for end in range(1, n + 1):
            top = None
            for start in range(max(0, end - self.max_piece), end):
                prev = best[start]
                if prev is None:
                    continue
                piece = word[start:end]
                hit = self.pieces.get(piece)
                if hit is not None and piece not in self.special:
                    score = prev[0] + hit[1]
                    token = hit[0]
                elif end - start == 1:
                    score = prev[0] + self.unk_score
                    token = self.unk
                else:
                    continue
                if top is None or score > top[0]:
                    top = (score, start, token)
            best[end] = top
        ids = []
        pos = n
        while pos > 0:
            _, start, token = best[pos]
            if not (token == self.unk and ids and ids[-1] == self.unk):
                ids.append(token)
            pos = start
        ids.reverse()
        return ids

    def encode(self, text, max_length):
        ids = []
        for word in self._words(text):
            ids.extend(self._viterbi(word))
        ids = ids[: max_length - 2]
        return [self.cls] + ids + [self.sep]


def _erf(x):
    sign = np.sign(x)
    a = np.abs(x)
    t = 1.0 / (1.0 + 0.5 * a)
    y = 1.0 - t * np.exp(
        -a * a - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))))
    )
    return sign * y


def _gelu(x):
    return 0.5 * x * (1.0 + _erf(x / math.sqrt(2.0)))


def _layer_norm(x, w, b, eps):
    mean = x.mean(axis=-1, keepdims=True)
    var = ((x - mean) ** 2).mean(axis=-1, keepdims=True)
    return (x - mean) / np.sqrt(var + eps) * w + b


class SentenceTransformer:
    def __init__(self, model_name_or_path="all-MiniLM-L6-v2", device=None, **kwargs):
        key = AVAILABLE.get(model_name_or_path)
        if key is None:
            raise ValueError(f"Model {model_name_or_path!r} is not available in the browser. Available: all-MiniLM-L6-v2, intfloat/multilingual-e5-small")
        with open(os.path.join(ASSETS, f"{key}.json"), encoding="utf-8") as f:
            self.config = json.load(f)
        if self.config.get("tokenizer") == "unigram":
            self.tokenizer = _Unigram(os.path.join(ASSETS, f"{key}-vocab.json"))
        else:
            self.tokenizer = _WordPiece(os.path.join(ASSETS, f"{key}-vocab.txt"), self.config.get("do_lower_case", True))
        data = np.load(os.path.join(ASSETS, f"{key}.npz"))
        self._q = {}
        self._w = {}
        for name in data.files:
            if name.endswith(".scale"):
                continue
            arr = data[name]
            if arr.dtype == np.int8:
                scale = data[name + ".scale"].astype(np.float32)
                if name == "embeddings.word_embeddings.weight":
                    self._q[name] = (arr, scale)
                else:
                    self._w[name] = (arr.astype(np.float32) * scale[:, None])
            else:
                self._w[name] = arr.astype(np.float32)
        self.max_seq_length = int(self.config.get("max_seq_length", 256))

    def get_sentence_embedding_dimension(self):
        return int(self.config["hidden_size"])

    def _word_embeddings(self, ids):
        name = "embeddings.word_embeddings.weight"
        if name in self._q:
            q, scale = self._q[name]
            return q[ids].astype(np.float32) * scale[ids][..., None]
        return self._w[name][ids]

    def _linear(self, x, name):
        return x @ self._w[name + ".weight"].T + self._w[name + ".bias"]

    def _forward(self, ids, mask, trace=None):
        c = self.config
        eps = float(c.get("layer_norm_eps", 1e-12))
        heads = int(c["num_attention_heads"])
        hidden = int(c["hidden_size"])
        head_dim = hidden // heads
        batch, length = ids.shape
        w = self._w
        offset = int(c.get("position_offset", 0))
        x = self._word_embeddings(ids) + w["embeddings.position_embeddings.weight"][offset:offset + length][None] + w["embeddings.token_type_embeddings.weight"][0][None, None]
        x = _layer_norm(x, w["embeddings.LayerNorm.weight"], w["embeddings.LayerNorm.bias"], eps)
        bias = (1.0 - mask[:, None, None, :].astype(np.float32)) * np.float32(-1e9)
        if trace is not None:
            trace.append({"layer": 0, "states": x})
        for i in range(int(c["num_hidden_layers"])):
            p = f"encoder.layer.{i}."
            q = self._linear(x, p + "attention.self.query").reshape(batch, length, heads, head_dim).transpose(0, 2, 1, 3)
            k = self._linear(x, p + "attention.self.key").reshape(batch, length, heads, head_dim).transpose(0, 2, 1, 3)
            v = self._linear(x, p + "attention.self.value").reshape(batch, length, heads, head_dim).transpose(0, 2, 1, 3)
            scores = q @ k.transpose(0, 1, 3, 2) / np.float32(math.sqrt(head_dim)) + bias
            scores = scores - scores.max(axis=-1, keepdims=True)
            probs = np.exp(scores)
            probs = probs / probs.sum(axis=-1, keepdims=True)
            context = (probs @ v).transpose(0, 2, 1, 3).reshape(batch, length, hidden)
            x = _layer_norm(self._linear(context, p + "attention.output.dense") + x, w[p + "attention.output.LayerNorm.weight"], w[p + "attention.output.LayerNorm.bias"], eps)
            h = _gelu(self._linear(x, p + "intermediate.dense"))
            x = _layer_norm(self._linear(h, p + "output.dense") + x, w[p + "output.LayerNorm.weight"], w[p + "output.LayerNorm.bias"], eps)
            if trace is not None:
                trace.append({"layer": i + 1, "attention": probs, "states": x})
        return x

    def encode(self, sentences, batch_size=32, normalize_embeddings=False, convert_to_numpy=True, show_progress_bar=None, **kwargs):
        single = isinstance(sentences, str)
        texts = [sentences] if single else list(sentences)
        out = []
        for start in range(0, len(texts), batch_size):
            chunk = texts[start:start + batch_size]
            encoded = [self.tokenizer.encode(t, self.max_seq_length) for t in chunk]
            length = max(len(e) for e in encoded)
            ids = np.full((len(chunk), length), self.tokenizer.pad, dtype=np.int64)
            mask = np.zeros((len(chunk), length), dtype=np.int64)
            for r, e in enumerate(encoded):
                ids[r, : len(e)] = e
                mask[r, : len(e)] = 1
            states = self._forward(ids, mask)
            m = mask[..., None].astype(np.float32)
            pooled = (states * m).sum(axis=1) / np.clip(m.sum(axis=1), 1e-9, None)
            if self.config.get("normalize", True) or normalize_embeddings:
                pooled = pooled / np.clip(np.linalg.norm(pooled, axis=1, keepdims=True), 1e-12, None)
            out.append(pooled.astype(np.float32))
        result = np.concatenate(out, axis=0)
        return result[0] if single else result
