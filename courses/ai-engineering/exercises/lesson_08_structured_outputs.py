import json
import numpy as np

TICKET_SCHEMA = {"type": "object", "required": ["title", "priority", "estimate_hours"], "additionalProperties": False,
                 "properties": {"title": {"type": "string"}, "priority": {"type": "string", "enum": ["low", "medium", "high"]},
                                "estimate_hours": {"type": "integer"}, "tags": {"type": "array", "items": {"type": "string"}}}}
TOOLS = {"create_ticket": TICKET_SCHEMA}
PY_TYPES = {"object": dict, "array": list, "string": str, "integer": int, "number": (int, float), "boolean": bool}


def has_type(value, name):
    return isinstance(value, PY_TYPES[name]) and (name == "boolean" or not isinstance(value, bool))


def validate(value, schema, path="$"):
    if not has_type(value, schema["type"]):
        return [f"{path}: expected {schema['type']}, got {type(value).__name__}"]
    errors = []
    if "enum" in schema and value not in schema["enum"]:
        errors.append(f"{path}: {value!r} not in {schema['enum']}")
    if schema["type"] == "object":
        for key in schema.get("required", []):
            if key not in value:
                errors.append(f"{path}: missing required '{key}'")
        for key in sorted(value):
            if key in schema["properties"]:
                errors += validate(value[key], schema["properties"][key], f"{path}.{key}")
            elif schema.get("additionalProperties") is False:
                errors.append(f"{path}: unexpected '{key}'")
    if schema["type"] == "array":
        for i, item in enumerate(value):
            errors += validate(item, schema["items"], f"{path}[{i}]")
    return errors


def check_tool_call(name, arguments_text):
    if name not in TOOLS:
        return [f"unknown tool '{name}'"]
    try:
        arguments = json.loads(arguments_text)
    except json.JSONDecodeError as error:
        return [f"not JSON: {error.msg}"]
    return validate(arguments, TOOLS[name])


print("=== Part 1: validating tool-call arguments ===")
calls = [
    ("create_ticket", '{"title": "Fix login", "priority": "high", "estimate_hours": 3}'),
    ("create_ticket", '{"title": "Fix login", "priority": "urgent", "estimate_hours": "3"}'),
    ("create_ticket", '{"title": "Fix login", "priority": "low", "estimate_hours": 2} Done!'),
    ("create_ticket", '{"priority": "low", "estimate_hours": 2, "owner": "ana", "tags": ["ui", 7]}'),
    ("delete_database", '{}'),
]
for index, (name, text) in enumerate(calls, 1):
    errors = check_tool_call(name, text)
    print(f"call {index}: {'valid' if not errors else 'INVALID: ' + '; '.join(errors)}")

print("\n=== Part 2: a noisy model, validation and retries ===")
rng = np.random.default_rng(8)
GOOD = {"title": "Fix login", "priority": "high", "estimate_hours": 3}
BROKEN = [json.dumps({"title": "Fix login", "priority": "high"}), json.dumps(dict(GOOD, estimate_hours="3 hours")),
          json.dumps(GOOD) + " Let me know if you need anything else.", json.dumps(dict(GOOD, priority="urgent"))]


def noisy_model(error_rate):
    return json.dumps(GOOD) if rng.random() >= error_rate else BROKEN[rng.integers(len(BROKEN))]


requests, max_retries = 2000, 2
first_ok, final_ok, total_calls, hard_final_ok, hard_count = 0, 0, 0, 0, 0
for _ in range(requests):
    hard = rng.random() < 0.2
    error_rate = 0.85 if hard else 0.15
    for attempt in range(max_retries + 1):
        total_calls, ok = total_calls + 1, not check_tool_call("create_ticket", noisy_model(error_rate))
        if ok:
            break
    first_ok, final_ok = first_ok + (ok and attempt == 0), final_ok + ok
    hard_count, hard_final_ok = hard_count + hard, hard_final_ok + (ok and hard)
p_first = first_ok / requests
print(f"first-try validity = {p_first:.3f}")
print(f"validity after {max_retries} retries = {final_ok / requests:.3f}")
print(f"independence estimate 1-(1-p)^3 = {1 - (1 - p_first) ** 3:.3f}")
print(f"hard inputs valid after retries = {hard_final_ok / hard_count:.3f}")
print(f"model calls per request = {total_calls / requests:.3f}")

print("\n=== Part 3: constrained decoding on a toy vocabulary ===")
VOCAB = ["{", '"priority"', ":", '"low"', '"medium"', '"high"', '"urgent"', "}", "Sure", "<eos>"]
GRAMMAR = [["{"], ['"priority"'], [":"], ['"low"', '"medium"', '"high"'], ["}"], ["<eos>"]]
VALUES = ['"low"', '"medium"', '"high"', '"urgent"']
index_of = {token: i for i, token in enumerate(VOCAB + ["<start>"])}
logits = np.random.default_rng(3).normal(0.0, 0.5, size=(len(VOCAB) + 1, len(VOCAB)))
for previous, preferred, bias in [("<start>", "{", 6.0), ("<start>", "Sure", 2.0), ("{", '"priority"', 6.0), ('"priority"', ":", 6.0),
                                  (":", '"low"', 3.0), (":", '"medium"', 3.5), (":", '"high"', 4.5), (":", '"urgent"', 3.8), ("}", "<eos>", 6.0)]:
    logits[index_of[previous], index_of[preferred]] += bias
for value in VALUES:
    logits[index_of[value], index_of["}"]] += 6.0


def distribution(previous, step=None):
    exp = np.exp(logits[index_of[previous]] - logits[index_of[previous]].max())
    probs = exp / exp.sum()
    if step is None:
        return probs, 0.0
    allowed = np.array([token in GRAMMAR[step] for token in VOCAB])
    return np.where(allowed, probs, 0.0) / probs[allowed].sum(), probs[~allowed].sum()


def generate(sample_rng, masked):
    tokens, removed = ["<start>"], 0.0
    for step in range(len(GRAMMAR)):
        probs, mass = distribution(tokens[-1], step if masked else None)
        tokens.append(VOCAB[sample_rng.choice(len(VOCAB), p=probs)])
        removed += mass
    valid = all(token in allowed_set for token, allowed_set in zip(tokens[1:], GRAMMAR))
    return tokens[1:], valid, removed / len(GRAMMAR)


exact = 1.0
for step, previous in enumerate(["<start>", "{", '"priority"']):
    exact *= distribution(previous)[0][index_of[GRAMMAR[step][0]]]
exact *= sum(distribution(":")[0][index_of[v]] * distribution(v)[0][index_of["}"]] * distribution("}")[0][index_of["<eos>"]] for v in GRAMMAR[3])
raw, masked = distribution(":")[0], distribution(":", 3)[0]
print("after ':'   token      model p   masked p")
for token in VALUES:
    print(f"            {token:<10} {raw[index_of[token]]:.3f}     {masked[index_of[token]]:.3f}")
print(f"exact P(valid) without mask = {exact:.3f}")
for use_mask in [False, True]:
    results = [generate(np.random.default_rng(11 + i), use_mask) for i in range(2000)]
    valid_rate = np.mean([valid for _, valid, _ in results])
    high_rate = np.mean([tokens[3] == '"high"' for tokens, valid, _ in results if valid])
    print(f"{'mask' if use_mask else 'no mask':<8} valid = {valid_rate:.3f}  high among valid = {high_rate:.3f}  mass removed per step = {np.mean([r for _, _, r in results]):.3f}")
print("masked example:", " ".join(generate(np.random.default_rng(5), True)[0][:-1]))
