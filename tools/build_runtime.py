import base64
import datetime
import hashlib
import json
import os
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "runtime-cache"
SHIMS = ROOT / "site-src" / "runtime" / "shims"
PYODIDE = ROOT / "node_modules" / "pyodide"
NEEDED = ["numpy", "regex"]
MINILM_TOLERANCE = 0.005
E5_TOLERANCE = 0.01
E5_MODEL = "intfloat/multilingual-e5-small"


def log(msg):
    print(f"[runtime] {msg}", flush=True)


def download(url, dest, sha256=None):
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and (sha256 is None or hashlib.sha256(dest.read_bytes()).hexdigest() == sha256):
        return True
    try:
        with urllib.request.urlopen(url, timeout=120) as res:
            data = res.read()
    except Exception as exc:
        log(f"  {url}: {exc}")
        return False
    if sha256 and hashlib.sha256(data).hexdigest() != sha256:
        log(f"  {url}: sha256 mismatch")
        return False
    dest.write_bytes(data)
    return True


def pyodide_wheels():
    lock = json.loads((PYODIDE / "pyodide-lock.json").read_text())
    version = json.loads((PYODIDE / "package.json").read_text())["version"]
    packages = lock["packages"]
    wanted = []

    def add(name):
        if name in wanted:
            return
        wanted.append(name)
        for dep in packages[name].get("depends", []):
            add(dep)

    for name in NEEDED:
        add(name)
    bases = [f"https://cdn.jsdelivr.net/pyodide/v{version}/full/", f"https://cdn.jsdelivr.net/pyodide/{version}/full/"]
    for name in wanted:
        info = packages[name]
        dest = OUT / "pyodide" / info["file_name"]
        if not any(download(base + info["file_name"], dest, info.get("sha256")) for base in bases):
            raise SystemExit(f"Could not download the Pyodide package {name} ({info['file_name']}) for Pyodide {version}")
        log(f"wheel {info['file_name']} ({dest.stat().st_size // 1024} KB)")


def tiktoken_vocab():
    import tiktoken

    enc = tiktoken.get_encoding("cl100k_base")
    ranks = enc._mergeable_ranks
    dest = OUT / "assets" / "cl100k_base.tiktoken"
    dest.parent.mkdir(parents=True, exist_ok=True)
    with dest.open("wb") as f:
        for token, rank in sorted(ranks.items(), key=lambda x: x[1]):
            f.write(base64.b64encode(token) + b" " + str(rank).encode() + b"\n")
    log(f"cl100k_base vocabulary ({dest.stat().st_size // 1024} KB, {len(ranks)} tokens)")


def quantize(weights, mode):
    import numpy as np

    store = {}
    for name, value in weights.items():
        value = value.astype(np.float32)
        is_matrix = value.ndim == 2 and "LayerNorm" not in name and "position_embeddings" not in name and "token_type_embeddings" not in name
        use_int8 = mode == "int8" or (mode == "mixed" and name == "embeddings.word_embeddings.weight")
        if is_matrix and use_int8:
            scale = np.abs(value).max(axis=1) / 127.0
            scale[scale == 0] = 1.0
            store[name] = np.round(value / scale[:, None]).astype(np.int8)
            store[name + ".scale"] = scale.astype(np.float32)
        elif is_matrix:
            store[name] = value.astype(np.float16)
        else:
            store[name] = value
    return store


def minilm():
    import numpy as np
    from sentence_transformers import SentenceTransformer as RealModel

    real = RealModel("all-MiniLM-L6-v2", device="cpu")
    bert = real[0].auto_model
    config = bert.config
    weights = {k: v.detach().cpu().float().numpy() for k, v in bert.state_dict().items() if not k.startswith("pooler.") and v.is_floating_point()}
    weights = {k.removeprefix("bert."): v for k, v in weights.items()}
    vocab = sorted(real.tokenizer.get_vocab().items(), key=lambda x: x[1])
    assets = OUT / "assets"
    assets.mkdir(parents=True, exist_ok=True)
    (assets / "minilm-vocab.txt").write_text("\n".join(t for t, _ in vocab) + "\n", encoding="utf-8")
    normalize = any(type(m).__name__ == "Normalize" for m in real)
    meta = {
        "hidden_size": config.hidden_size,
        "num_hidden_layers": config.num_hidden_layers,
        "num_attention_heads": config.num_attention_heads,
        "intermediate_size": config.intermediate_size,
        "layer_norm_eps": config.layer_norm_eps,
        "max_seq_length": real.max_seq_length,
        "do_lower_case": bool(getattr(real.tokenizer, "do_lower_case", True)),
        "normalize": normalize,
    }
    (assets / "minilm.json").write_text(json.dumps(meta))
    sentences = sentences_for_check()
    reference = real.encode(sentences, normalize_embeddings=True)
    os.environ["AIA_ASSETS"] = str(assets)
    import importlib.util

    spec = importlib.util.spec_from_file_location("aia_sentence_transformers", SHIMS / "sentence_transformers.py")
    shim = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(shim)

    best = None
    for mode in ("int8", "mixed", "fp16"):
        np.savez_compressed(assets / "minilm.npz", **quantize(weights, mode))
        model = shim.SentenceTransformer("all-MiniLM-L6-v2")
        ours = model.encode(sentences, normalize_embeddings=True)
        sims_ref = reference @ reference.T
        sims_ours = ours @ ours.T
        diff = float(np.abs(sims_ref - sims_ours).max())
        log(f"MiniLM {mode}: {(assets / 'minilm.npz').stat().st_size // 1024} KB, max cosine difference {diff:.5f} over {len(sentences)} sentences")
        best = (mode, diff)
        if diff <= MINILM_TOLERANCE:
            break
    if best[1] > MINILM_TOLERANCE:
        raise SystemExit(f"The NumPy MiniLM differs from PyTorch by {best[1]:.4f}, above {MINILM_TOLERANCE}")
    meta["weights"] = best[0]
    meta["max_cosine_difference"] = round(best[1], 6)
    (assets / "minilm.json").write_text(json.dumps(meta))


def latin(piece):
    return all(ord(ch) < 0x250 or 0x2000 <= ord(ch) <= 0x206F or 0x20A0 <= ord(ch) <= 0x20CF or ch == "\u2581" for ch in piece)


def e5_sentences():
    found = list(sentences_for_check())
    for md in sorted((ROOT / "courses").glob("*/lessons-md/**/*.md")):
        text = md.read_text(encoding="utf-8").split("\n---", 2)[-1]
        paragraphs = [p.strip().replace("\n", " ") for p in text.split("\n\n") if p.strip() and not p.startswith(("```", "|", "#", ":::", "<", "P:", "Q:", "A:"))]
        found.extend("passage: " + p[:400].rstrip() for p in paragraphs[:4])
    queries = json.loads((ROOT / "tests" / "search-eval.json").read_text(encoding="utf-8"))["queries"]
    for q in queries:
        found.extend(["query: " + q["en"], "query: " + q["es"]])
    seen = []
    for s in found:
        if s not in seen:
            seen.append(s)
    return seen


def e5():
    import numpy as np
    from sentence_transformers import SentenceTransformer as RealModel

    real = RealModel(E5_MODEL, device="cpu")
    model = real[0].auto_model
    config = model.config
    weights = {k: v.detach().cpu().float().numpy() for k, v in model.state_dict().items() if not k.startswith("pooler.") and v.is_floating_point()}
    weights = {k.removeprefix("roberta.").removeprefix("bert."): v for k, v in weights.items()}
    tok = real.tokenizer
    spec = json.loads(tok.backend_tokenizer.to_str())["model"]
    vocab = spec["vocab"]
    special = {tok.bos_token_id, tok.eos_token_id, tok.pad_token_id, tok.unk_token_id}
    assets = OUT / "assets"
    assets.mkdir(parents=True, exist_ok=True)
    meta = {
        "hidden_size": config.hidden_size,
        "num_hidden_layers": config.num_hidden_layers,
        "num_attention_heads": config.num_attention_heads,
        "intermediate_size": config.intermediate_size,
        "layer_norm_eps": config.layer_norm_eps,
        "max_seq_length": min(512, real.max_seq_length),
        "normalize": True,
        "tokenizer": "unigram",
        "position_offset": int(config.pad_token_id) + 1,
    }
    sentences = e5_sentences()
    covered = [s for s in sentences if latin(s)]
    reference = real.encode(covered, normalize_embeddings=True, batch_size=32)
    sims_ref = reference @ reference.T
    os.environ["AIA_ASSETS"] = str(assets)
    import importlib.util

    spec_mod = importlib.util.spec_from_file_location("aia_sentence_transformers_e5", SHIMS / "sentence_transformers.py")
    shim = importlib.util.module_from_spec(spec_mod)
    spec_mod.loader.exec_module(shim)
    latin_ids = [i for i, (piece, _) in enumerate(vocab) if i not in special and latin(piece)]
    by_score = sorted(latin_ids, key=lambda i: -vocab[i][1])
    short = {i for i in latin_ids if len(vocab[i][0]) <= 2}
    log(f"multilingual-e5-small: {len(vocab)} pieces, {len(latin_ids)} Latin-script")

    def write(keep, mode):
        keep = sorted(set(keep) | special)
        remap = {old: new for new, old in enumerate(keep)}
        pruned = dict(weights)
        pruned["embeddings.word_embeddings.weight"] = weights["embeddings.word_embeddings.weight"][keep]
        (assets / "e5-vocab.json").write_text(json.dumps({"vocab": [vocab[i] for i in keep], "unk": remap[tok.unk_token_id], "bos": remap[tok.bos_token_id], "eos": remap[tok.eos_token_id], "pad": remap[tok.pad_token_id]}, ensure_ascii=False), encoding="utf-8")
        (assets / "e5.json").write_text(json.dumps(meta))
        np.savez_compressed(assets / "e5.npz", **quantize(pruned, mode))
        return len(keep), sum((assets / f).stat().st_size for f in ("e5.npz", "e5-vocab.json"))

    write(range(len(vocab)), "fp16")
    full = shim._Unigram(str(assets / "e5-vocab.json"))
    mismatched = [s for s in sentences if full.encode(s, meta["max_seq_length"]) != tok(s, truncation=True, max_length=meta["max_seq_length"])["input_ids"]]
    log(f"Unigram tokenizer: {len(sentences) - len(mismatched)}/{len(sentences)} sentences tokenized exactly like Hugging Face")
    for s in mismatched[:3]:
        want = tok.convert_ids_to_tokens(tok(s, truncation=True, max_length=meta["max_seq_length"])["input_ids"])
        got = [vocab[i][0] for i in full.encode(s, meta["max_seq_length"])]
        at = next((i for i, (a, b) in enumerate(zip(want, got)) if a != b), min(len(want), len(got)))
        log(f"  mismatch in {s[:60]!r}: Hugging Face {want[max(0, at - 2):at + 4]} shim {got[max(0, at - 2):at + 4]}")
    best = None
    for limit, mode in ((30000, "int8"), (30000, "mixed"), (60000, "mixed"), (None, "mixed"), (None, "fp16")):
        keep = set(by_score[:limit] if limit else latin_ids) | short
        count, size = write(keep, mode)
        ours = shim.SentenceTransformer(E5_MODEL).encode(covered, normalize_embeddings=True, batch_size=32)
        delta = np.abs(sims_ref - ours @ ours.T)
        diff = float(delta.max())
        log(f"e5 {mode}, {count} pieces: {size // 1024} KB, max cosine difference {diff:.5f}, median {float(np.median(delta)):.5f} over {len(covered)} Latin-script sentences")
        best = (mode, count, diff)
        if diff <= E5_TOLERANCE:
            break
    if best[2] > E5_TOLERANCE:
        raise SystemExit(f"The NumPy multilingual-e5-small differs from PyTorch by {best[2]:.4f}, above {E5_TOLERANCE}")
    meta.update({"weights": best[0], "vocab_size": best[1], "max_cosine_difference": round(best[2], 6), "tokenizer_exact": len(sentences) - len(mismatched), "tokenizer_checked": len(sentences), "checked_sentences": len(covered)})
    (assets / "e5.json").write_text(json.dumps(meta))


def sentences_for_check():
    found = []
    for script in sorted((ROOT / "courses").glob("*/exercises/*.py")):
        text = script.read_text(encoding="utf-8")
        if "sentence_transformers" in text:
            found.extend(re.findall(r'"([^"\n]{3,200})"', text))
    found.extend(["Café crème, naïve résumé!", "中文 tokens", "Order #48213 has shipped", "x" * 300])
    seen = []
    for s in found:
        if s not in seen:
            seen.append(s)
    return seen


def exercises():
    return sorted((ROOT / "courses").glob("*/exercises/*.py"))


def run(script, shims=False):
    env = dict(os.environ, PYTHONHASHSEED="0", PYTHONIOENCODING="utf-8")
    if shims:
        env["PYTHONPATH"] = str(SHIMS)
        env["AIA_ASSETS"] = str(OUT / "assets")
    result = subprocess.run([sys.executable, str(script)], cwd=ROOT, env=env, capture_output=True, text=True, timeout=900)
    if result.returncode != 0:
        raise SystemExit(f"{script.relative_to(ROOT)} failed{' with shims' if shims else ''}:\n{result.stderr[-3000:]}")
    return result.stdout


def numbers(text):
    return [float(x) for x in re.findall(r"-?\d+\.\d+", text)]


def record_outputs():
    meta = {"date": datetime.date.today().isoformat(), "python": sys.version.split()[0], "checks": {}}
    for script in exercises():
        course = script.parent.parent.name
        dest = OUT / "outputs" / course / (script.stem + ".txt")
        dest.parent.mkdir(parents=True, exist_ok=True)
        real = run(script)
        dest.write_text(real, encoding="utf-8")
        print(f"----- BEGIN OUTPUT {course}/{script.name} -----\n{real}----- END OUTPUT {course}/{script.name} -----", flush=True)
        text = script.read_text(encoding="utf-8")
        uses = [m for m in ("tiktoken", "sentence_transformers") if re.search(rf"^\s*(from|import)\s+{m}\b", text, re.M)]
        status = "real"
        if uses:
            ours = run(script, shims=True)
            if "tiktoken" in uses and "sentence_transformers" not in uses:
                if ours != real:
                    raise SystemExit(f"{script.name}: the browser tiktoken produces different output than real tiktoken")
                status = "identical"
            else:
                a, b = numbers(real), numbers(ours)
                worst = max((abs(x - y) for x, y in zip(a, b)), default=0.0)
                if len(a) != len(b) or worst > 0.02:
                    raise SystemExit(f"{script.name}: browser output differs from real output (worst numeric difference {worst:.4f})")
                status = f"within {worst:.4f}"
        meta["checks"][f"{course}/{script.name}"] = status
        log(f"output {course}/{script.name}: {len(real.splitlines())} lines, browser shim check: {status}")
    (OUT / "outputs" / "meta.json").write_text(json.dumps(meta, indent=2))


def main():
    steps = sys.argv[1:] or ["wheels", "vocab", "minilm", "e5", "outputs"]
    if "wheels" in steps:
        pyodide_wheels()
    if "vocab" in steps:
        tiktoken_vocab()
    if "minilm" in steps:
        minilm()
    if "e5" in steps:
        e5()
    if "outputs" in steps:
        record_outputs()
    log("done")


if __name__ == "__main__":
    main()
