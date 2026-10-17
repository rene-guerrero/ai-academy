import base64
import os

import regex

ASSETS = os.environ.get("AIA_ASSETS", "/home/pyodide/assets")

PATTERNS = {
    "cl100k_base": r"""'(?i:[sdmt]|ll|ve|re)|[^\r\n\p{L}\p{N}]?+\p{L}+|\p{N}{1,3}| ?[^\s\p{L}\p{N}]++[\r\n]*|\s*[\r\n]|\s+(?!\S)|\s+""",
}

_cache = {}


def _load_ranks(name):
    path = os.path.join(ASSETS, f"{name}.tiktoken")
    ranks = {}
    with open(path, "rb") as f:
        for line in f:
            if not line.strip():
                continue
            token, rank = line.split()
            ranks[base64.b64decode(token)] = int(rank)
    return ranks


def _merge(piece, ranks):
    parts = [piece[i:i + 1] for i in range(len(piece))]
    while len(parts) > 1:
        best_rank = None
        best_index = -1
        for i in range(len(parts) - 1):
            rank = ranks.get(parts[i] + parts[i + 1])
            if rank is not None and (best_rank is None or rank < best_rank):
                best_rank = rank
                best_index = i
        if best_index < 0:
            break
        parts[best_index:best_index + 2] = [parts[best_index] + parts[best_index + 1]]
    return [ranks[p] for p in parts]


class Encoding:
    def __init__(self, name):
        if name not in PATTERNS:
            raise ValueError(f"Unknown encoding {name!r}. Available in the browser: {', '.join(PATTERNS)}")
        self.name = name
        self._ranks = _load_ranks(name)
        self._decoder = {rank: token for token, rank in self._ranks.items()}
        self._pattern = regex.compile(PATTERNS[name])
        self.n_vocab = len(self._ranks)

    def encode(self, text, allowed_special=(), disallowed_special=()):
        ids = []
        for match in self._pattern.finditer(text):
            piece = match.group().encode("utf-8")
            rank = self._ranks.get(piece)
            if rank is not None:
                ids.append(rank)
            else:
                ids.extend(_merge(piece, self._ranks))
        return ids

    def encode_ordinary(self, text):
        return self.encode(text)

    def decode_bytes(self, tokens):
        return b"".join(self._decoder[t] for t in tokens)

    def decode(self, tokens, errors="replace"):
        return self.decode_bytes(tokens).decode("utf-8", errors=errors)

    def decode_single_token_bytes(self, token):
        return self._decoder[token]


def get_encoding(name):
    if name not in _cache:
        _cache[name] = Encoding(name)
    return _cache[name]


def encoding_for_model(model_name):
    return get_encoding("cl100k_base")


def list_encoding_names():
    return list(PATTERNS)
