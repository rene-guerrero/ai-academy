import ast
import io
import json
import re
import subprocess
import sys
import time
import tokenize
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ALLOWED_IMPORTS = set(sys.stdlib_module_names) | {"numpy"}
TIME_LIMIT = 1.0
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")


def run_tests(code, tests):
    namespace = {"__name__": "__challenge__"}
    started = time.perf_counter()
    try:
        exec(compile(code, "<your code>", "exec"), namespace)
    except BaseException as exc:
        return {"load": f"{type(exc).__name__}: {exc}", "passed": 0, "failed": 0, "errors": [], "seconds": time.perf_counter() - started}
    passed = 0
    failed = 0
    errors = []
    for node in ast.parse(tests).body:
        module = ast.Module(body=[node], type_ignores=[])
        try:
            exec(compile(module, "<tests>", "exec"), namespace)
            if isinstance(node, ast.Assert):
                passed += 1
        except BaseException as exc:
            failed += 1
            errors.append(f"line {node.lineno}: {type(exc).__name__}: {exc}")
            if not isinstance(node, ast.Assert):
                break
    return {"load": None, "passed": passed, "failed": failed, "errors": errors, "seconds": time.perf_counter() - started}


def worker():
    job = json.load(sys.stdin)
    out = {name: run_tests(job[name], job["tests"]) for name in ("solution", "starter")}
    json.dump(out, sys.stdout)


def comments(code):
    try:
        return [t.start[0] for t in tokenize.generate_tokens(io.StringIO(code).readline) if t.type == tokenize.COMMENT]
    except (tokenize.TokenError, SyntaxError):
        return []


def imports(code):
    names = set()
    for node in ast.walk(ast.parse(code)):
        if isinstance(node, ast.Import):
            names.update(a.name.split(".")[0] for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module and not node.level:
            names.add(node.module.split(".")[0])
    return names


def check_static(where, item, problems):
    for field in ("title", "prompt", "hint"):
        value = item.get(field)
        if not isinstance(value, dict) or not all(isinstance(value.get(l), str) and value[l].strip() for l in ("en", "es")):
            problems.append(f"{where}: {field} needs non-empty en and es text")
    for field in ("starter", "tests", "solution"):
        code = item.get(field)
        if not isinstance(code, str) or not code.strip():
            problems.append(f"{where}: {field} is missing")
            continue
        try:
            ast.parse(code)
        except SyntaxError as exc:
            problems.append(f"{where}: {field} does not parse: {exc}")
            continue
        lines = comments(code)
        if lines:
            problems.append(f"{where}: {field} has comments on lines {lines}")
        bad = sorted(imports(code) - ALLOWED_IMPORTS)
        if bad:
            problems.append(f"{where}: {field} imports {', '.join(bad)}; only the standard library and numpy run in the browser")
    if isinstance(item.get("starter"), str) and "raise NotImplementedError" not in item["starter"]:
        problems.append(f"{where}: starter should raise NotImplementedError")
    if isinstance(item.get("tests"), str):
        try:
            body = ast.parse(item["tests"]).body
        except SyntaxError:
            body = []
        asserts = [n for n in body if isinstance(n, ast.Assert)]
        if body and not asserts:
            problems.append(f"{where}: tests have no top-level assert")
        for n in asserts:
            if n.msg is None:
                problems.append(f"{where}: tests line {n.lineno} has an assert without a message")


def main():
    problems = []
    total = 0
    slowest = (0.0, "")
    for course in sorted(p for p in (ROOT / "courses").iterdir() if (p / "challenges").is_dir()):
        lessons = {p.stem for p in (course / "lessons-md").glob("*.md")}
        for file in sorted((course / "challenges").glob("*.json")):
            if file.stem not in lessons:
                problems.append(f"{file.relative_to(ROOT)}: no lesson named {file.stem}")
            try:
                items = json.loads(file.read_text(encoding="utf-8"))
            except json.JSONDecodeError as exc:
                problems.append(f"{file.relative_to(ROOT)}: invalid JSON: {exc}")
                continue
            if not isinstance(items, list) or not items:
                problems.append(f"{file.relative_to(ROOT)}: expected a non-empty list")
                continue
            seen = set()
            for item in items:
                cid = item.get("id", "")
                where = f"{course.name}/{file.stem}:{cid}"
                if not ID_RE.match(str(cid)) or cid in seen:
                    problems.append(f"{where}: id must be unique and match {ID_RE.pattern}")
                seen.add(cid)
                before = len(problems)
                check_static(where, item, problems)
                if len(problems) > before:
                    continue
                total += 1
                try:
                    proc = subprocess.run([sys.executable, __file__, "--worker"], input=json.dumps(item), capture_output=True, text=True, timeout=30, cwd=ROOT)
                except subprocess.TimeoutExpired:
                    problems.append(f"{where}: timed out")
                    continue
                if proc.returncode:
                    problems.append(f"{where}: worker failed: {proc.stderr.strip()[-400:]}")
                    continue
                result = json.loads(proc.stdout)
                sol, start = result["solution"], result["starter"]
                if sol["load"] or sol["failed"]:
                    problems.append(f"{where}: solution fails its tests: {sol['load'] or '; '.join(sol['errors'])}")
                if not start["load"] and not start["failed"]:
                    problems.append(f"{where}: starter passes the tests; they test nothing")
                if sol["seconds"] > TIME_LIMIT:
                    problems.append(f"{where}: solution and tests take {sol['seconds']:.2f} s; keep them under {TIME_LIMIT:.0f} s")
                if sol["seconds"] > slowest[0]:
                    slowest = (sol["seconds"], where)
    for p in problems:
        print("FAIL", p)
    print(f"{total} challenges checked, {len(problems)} problems" + (f", slowest {slowest[1]} {slowest[0] * 1000:.0f} ms" if total else ""))
    return 1 if problems else 0


if __name__ == "__main__":
    if sys.argv[1:] == ["--worker"]:
        worker()
    else:
        sys.exit(main())
