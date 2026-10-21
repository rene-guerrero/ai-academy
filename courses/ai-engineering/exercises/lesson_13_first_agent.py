import ast
import json
import math
import operator

INVENTORY = {
    "SKU-08": {"name": "cable", "stock": 5, "price": 7.25},
    "SKU-17": {"name": "adapter", "stock": 10, "price": 12.50},
    "SKU-42": {"name": "dock", "stock": 1, "price": 40.00},
}
ORDERS = {
    "A-1001": [{"sku": "SKU-17", "qty": 3}, {"sku": "SKU-42", "qty": 2}, {"sku": "SKU-08", "qty": 1}],
    "C-3003": [{"sku": "SKU-99", "qty": 4}],
}
TOOLS = [
    {"name": "order_lookup", "description": "Return the lines of an order.",
     "parameters": {"type": "object", "properties": {"order_id": {"type": "string"}}, "required": ["order_id"]}},
    {"name": "inventory_lookup", "description": "Return stock and unit price for a SKU.",
     "parameters": {"type": "object", "properties": {"sku": {"type": "string"}}, "required": ["sku"]}},
    {"name": "calculator", "description": "Evaluate an arithmetic expression.",
     "parameters": {"type": "object", "properties": {"expression": {"type": "string"}}, "required": ["expression"]}},
]
OPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv}


def evaluate(node):
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return node.value
    if isinstance(node, ast.BinOp) and type(node.op) in OPS:
        return OPS[type(node.op)](evaluate(node.left), evaluate(node.right))
    raise ValueError("unsupported expression")


def run_tool(name, args):
    if name == "order_lookup":
        return {"lines": ORDERS[args["order_id"]]} if args["order_id"] in ORDERS else {"error": "unknown order"}
    if name == "inventory_lookup":
        return dict(INVENTORY[args["sku"]], sku=args["sku"]) if args["sku"] in INVENTORY else {"error": "unknown sku"}
    return {"value": round(evaluate(ast.parse(args["expression"], mode="eval").body), 2)}


def validate(name, args):
    schema = next((t["parameters"] for t in TOOLS if t["name"] == name), None)
    if schema is None:
        return "unknown tool"
    missing = [key for key in schema["required"] if not isinstance(args.get(key), str)]
    return f"missing or non-string: {missing}" if missing else None


def tokens(payload):
    return math.ceil(len(json.dumps(payload)) / 4)


def results_by_tool(messages):
    calls = {c["id"]: c for m in messages if m["role"] == "assistant" for c in m.get("tool_calls", [])}
    return [(calls[m["tool_call_id"]], json.loads(m["content"])) for m in messages if m["role"] == "tool"]


def write_answer(order_id, lines, stock, total):
    short = [f"{l['sku']} short by {l['qty'] - stock[l['sku']]['stock']}" for l in lines if stock[l["sku"]]["stock"] < l["qty"]]
    verdict = "can ship in full" if not short else "cannot ship in full (" + ", ".join(short) + ")"
    return f"Order {order_id} {verdict}; total value {total:.2f}"


def scripted_policy(messages):
    order_id = messages[0]["content"].split()[-1]
    seen = results_by_tool(messages)
    order = [r for c, r in seen if c["name"] == "order_lookup"]
    if not order:
        return {"name": "order_lookup", "arguments": {"order_id": order_id}}
    if "error" in order[-1]:
        return f"Order {order_id} does not exist"
    lines = order[-1]["lines"]
    stock = {r["sku"]: r for c, r in seen if c["name"] == "inventory_lookup" and "error" not in r}
    for line in lines:
        if line["sku"] not in stock:
            return {"name": "inventory_lookup", "arguments": {"sku": line["sku"]}}
    totals = [r["value"] for c, r in seen if c["name"] == "calculator"]
    if not totals:
        expression = " + ".join(f"{l['qty']} * {stock[l['sku']]['price']:.2f}" for l in lines)
        return {"name": "calculator", "arguments": {"expression": expression}}
    return write_answer(order_id, lines, stock, totals[-1])


def agent(task, max_steps, max_tokens, show=True):
    messages = [{"role": "user", "content": task}]
    used = 0
    for step in range(1, max_steps + 1):
        prompt_tokens = tokens({"tools": TOOLS, "messages": messages})
        if used + prompt_tokens > max_tokens:
            return f"stopped by token budget before call {step}", step - 1, used
        decision = scripted_policy(messages)
        if isinstance(decision, str):
            reply = {"role": "assistant", "content": decision}
            used += prompt_tokens + tokens(reply)
            if show:
                print(f"  step {step}: final answer, no tool call  [prompt {prompt_tokens} tok]")
            return decision, step, used
        call = dict(decision, id=f"call_{step}")
        reply = {"role": "assistant", "content": None, "tool_calls": [call]}
        used += prompt_tokens + tokens(reply)
        error = validate(call["name"], call["arguments"])
        result = {"error": error} if error else run_tool(call["name"], call["arguments"])
        messages.append(reply)
        messages.append({"role": "tool", "tool_call_id": call["id"], "content": json.dumps(result)})
        if show:
            print(f"  step {step}: {call['name']}({json.dumps(call['arguments'])}) -> {json.dumps(result)}  [prompt {prompt_tokens} tok]")
    return f"stopped by step budget after {max_steps} model calls", max_steps, used


def workflow(order_id):
    lines = run_tool("order_lookup", {"order_id": order_id})["lines"]
    stock = {l["sku"]: run_tool("inventory_lookup", {"sku": l["sku"]}) for l in lines}
    expression = " + ".join(f"{l['qty']} * {stock[l['sku']]['price']:.2f}" for l in lines)
    total = run_tool("calculator", {"expression": expression})["value"]
    prompt = {"messages": [{"role": "user", "content": f"Summarize order {order_id}: {json.dumps(lines)} {json.dumps(stock)} total {total}"}]}
    answer = write_answer(order_id, lines, stock, total)
    return answer, 1, tokens(prompt) + tokens({"role": "assistant", "content": answer})


print("Tokens are estimated as ceil(characters of the JSON payload / 4); the policy is a deterministic stand-in for an LLM.")
print(f"Tool definitions alone: {tokens({'tools': TOOLS})} tokens, resent on every model call")
print("\n=== Task 1 as an agent: the policy picks every step ===")
task = "Can we ship order A-1001"
answer, calls, used = agent(task, max_steps=8, max_tokens=10000)
print(f"Agent answer: {answer}")
print(f"Agent model calls = {calls}")
print(f"Agent tokens = {used}")
print("\n=== Task 1 as a workflow: code picks every step, one model call writes the answer ===")
answer_w, calls_w, used_w = workflow("A-1001")
print(f"Workflow answer: {answer_w}")
print(f"Workflow model calls = {calls_w}")
print(f"Workflow tokens = {used_w}")
print(f"Same answer: {answer == answer_w}; the workflow call sends no tool definitions")
print(f"Token ratio agent/workflow = {used / used_w:.1f}")
answer, calls, used = agent(task, max_steps=8, max_tokens=1500, show=False)
print(f"\nTask 1 with a 1500-token budget: {answer} (calls {calls}, tokens {used})")
print("\n=== Task 2: an unknown SKU, and a policy that keeps retrying ===")
answer, calls, used = agent("Can we ship order C-3003", max_steps=5, max_tokens=10000)
print(f"Loop result: {answer}, tokens {used}")
