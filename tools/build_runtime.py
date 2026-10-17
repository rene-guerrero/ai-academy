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


def quantize(weights, use_int8):
    import numpy as np

    store = {}
    for name, value in weights.items():
        value = value.astype(np.float32)
        is_matrix = value.ndim == 2 and "LayerNorm" not in name and "position_embeddings" not in name and "token_type_embeddings" not in name
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
    for use_int8 in (True, False):
        np.savez_compressed(assets / "minilm.npz", **quantize(weights, use_int8))
        model = shim.SentenceTransformer("all-MiniLM-L6-v2")
        ours = model.encode(sentences, normalize_embeddings=True)
        sims_ref = reference @ reference.T
        sims_ours = ours @ ours.T
        diff = float(np.abs(sims_ref - sims_ours).max())
        log(f"MiniLM {'int8' if use_int8 else 'fp16'}: {(assets / 'minilm.npz').stat().st_size // 1024} KB, max cosine difference {diff:.5f} over {len(sentences)} sentences")
        best = ("int8" if use_int8 else "fp16", diff)
        if diff <= MINILM_TOLERANCE:
            break
    if best[1] > MINILM_TOLERANCE:
        raise SystemExit(f"The NumPy MiniLM differs from PyTorch by {best[1]:.4f}, above {MINILM_TOLERANCE}")
    meta["weights"] = best[0]
    meta["max_cosine_difference"] = round(best[1], 6)
    (assets / "minilm.json").write_text(json.dumps(meta))


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
    steps = sys.argv[1:] or ["wheels", "vocab", "minilm", "outputs"]
    if "wheels" in steps:
        pyodide_wheels()
    if "vocab" in steps:
        tiktoken_vocab()
    if "minilm" in steps:
        minilm()
    if "outputs" in steps:
        record_outputs()
    log("done")


if __name__ == "__main__":
    main()
