import json

PROTOCOL_VERSION = "2025-11-25"

ORDERS = {
    "A-1001": {"customer": "Contoso", "status": "shipped", "total": 129.5},
    "A-1002": {"customer": "Fabrikam", "status": "pending", "total": 42.0},
    "A-1003": {"customer": "Contoso", "status": "pending", "total": 310.25},
}

TOOLS = [
    {"name": "get_order", "description": "Return one order by its id, for example A-1001.",
     "inputSchema": {"type": "object", "properties": {"order_id": {"type": "string"}}, "required": ["order_id"]}},
    {"name": "list_orders", "description": "List order ids with a given status.",
     "inputSchema": {"type": "object", "properties": {"status": {"type": "string", "enum": ["pending", "shipped"]}}, "required": ["status"]}},
]

RESOURCES = [{"uri": "orders://policy/refunds", "name": "refund-policy", "mimeType": "text/plain"}]
RESOURCE_TEXT = {"orders://policy/refunds": "Refunds are allowed within 30 days of shipping."}


def encode(message):
    return json.dumps(message, sort_keys=True, separators=(",", ":"))


def validate(schema, arguments):
    if not isinstance(arguments, dict):
        return "arguments must be an object"
    for name in schema["required"]:
        if name not in arguments:
            return f"missing required argument {name}"
    for name, value in sorted(arguments.items()):
        spec = schema["properties"].get(name)
        if spec is None:
            return f"unknown argument {name}"
        if spec["type"] == "string" and not isinstance(value, str):
            return f"{name} must be a string, got {type(value).__name__}"
        if "enum" in spec and value not in spec["enum"]:
            return f"{name} must be one of {spec['enum']}"
    return None


def text_result(text, is_error=False):
    return {"content": [{"type": "text", "text": text}], "isError": is_error}


def call_tool(name, arguments):
    if name == "get_order":
        order = ORDERS.get(arguments["order_id"])
        if order is None:
            return text_result(f"No order {arguments['order_id']}", True)
        return text_result(encode({"order_id": arguments["order_id"], **order}))
    ids = sorted(k for k, v in ORDERS.items() if v["status"] == arguments["status"])
    return text_result(encode(ids))


class OrdersServer:
    def handle(self, line):
        message = json.loads(line)
        method, params = message.get("method"), message.get("params", {})
        if "id" not in message:
            return None
        if method == "initialize":
            result = {"protocolVersion": PROTOCOL_VERSION, "capabilities": {"tools": {"listChanged": False}, "resources": {}},
                      "serverInfo": {"name": "orders-server", "version": "0.1.0"}}
        elif method == "tools/list":
            result = {"tools": TOOLS}
        elif method == "tools/call":
            tool = next((t for t in TOOLS if t["name"] == params.get("name")), None)
            if tool is None:
                return encode({"jsonrpc": "2.0", "id": message["id"], "error": {"code": -32602, "message": "Unknown tool"}})
            problem = validate(tool["inputSchema"], params.get("arguments"))
            result = text_result(f"Invalid arguments: {problem}", True) if problem else call_tool(tool["name"], params["arguments"])
        elif method == "resources/list":
            result = {"resources": RESOURCES}
        elif method == "resources/read":
            uri = params["uri"]
            result = {"contents": [{"uri": uri, "mimeType": "text/plain", "text": RESOURCE_TEXT[uri]}]}
        else:
            return encode({"jsonrpc": "2.0", "id": message["id"], "error": {"code": -32601, "message": f"Method not found: {method}"}})
        return encode({"jsonrpc": "2.0", "id": message["id"], "result": result})


class Client:
    def __init__(self, server):
        self.server, self.next_id, self.wire = server, 1, []

    def send(self, method, params=None, notify=False):
        message = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            message["params"] = params
        if not notify:
            message["id"] = self.next_id
            self.next_id += 1
        line = encode(message)
        self.wire.append(("C->S note" if notify else "C->S", line))
        print(f"C->S {line}")
        reply = self.server.handle(line)
        if reply is None:
            print("S->C (no reply: notifications have no id)")
            return None
        self.wire.append(("S->C", reply))
        print(f"S->C {reply}")
        return json.loads(reply)


print("=== Lesson 14: MCP over an in-process JSON-RPC 2.0 wire ===")
client = Client(OrdersServer())
print("\n--- 1. initialize handshake ---")
init = client.send("initialize", {"protocolVersion": PROTOCOL_VERSION, "capabilities": {}, "clientInfo": {"name": "demo-host", "version": "1.0.0"}})
client.send("notifications/initialized", notify=True)
print("\n--- 2. discovery ---")
listed = client.send("tools/list")
print("\n--- 3. tool calls ---")
ok = client.send("tools/call", {"name": "get_order", "arguments": {"order_id": "A-1003"}})
bad = client.send("tools/call", {"name": "get_order", "arguments": {"order_id": 1003}})
pending = client.send("tools/call", {"name": "list_orders", "arguments": {"status": "pending"}})
print("\n--- 4. resources ---")
client.send("resources/list")
doc = client.send("resources/read", {"uri": "orders://policy/refunds"})
print("\n--- 5. a method the server does not implement ---")
missing = client.send("prompts/list")

print("\n=== Summary ===")
print(f"Negotiated protocol version = {init['result']['protocolVersion']}")
print(f"Server capabilities = {','.join(sorted(init['result']['capabilities']))}")
print(f"Tools advertised = {len(listed['result']['tools'])}")
print(f"tools/list response size = {len(encode(listed))} bytes")
print(f"get_order A-1003 isError = {str(ok['result']['isError']).lower()}")
print(f"get_order 1003 isError = {str(bad['result']['isError']).lower()}")
print(f"get_order 1003 text = {bad['result']['content'][0]['text']}")
print(f"Pending orders = {pending['result']['content'][0]['text']}")
print(f"Refund policy = {doc['result']['contents'][0]['text']}")
print(f"prompts/list error code = {missing['error']['code']}")
requests = sum(1 for d, _ in client.wire if d == "C->S")
notifications = sum(1 for d, _ in client.wire if d == "C->S note")
print(f"Client requests = {requests}, notifications = {notifications}, server replies = {sum(1 for d, _ in client.wire if d == 'S->C')}")
print(f"Total bytes on the wire = {sum(len(l) + 1 for _, l in client.wire)}")
