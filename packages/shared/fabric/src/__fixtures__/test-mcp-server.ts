/**
 * Minimal MCP server for testing — exported as a code string.
 *
 * Implements the MCP JSON-RPC 2.0 protocol over process.stdin/stdout:
 * - initialize handshake
 * - tools/list discovery
 * - tools/call dispatch
 * - shutdown notification
 *
 * Registers one tool: "greet" — returns "Hello, {name}!"
 */
export const TEST_MCP_SERVER_CODE = `
var tools = [
  {
    name: "greet",
    description: "Greet someone by name",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name to greet" }
      },
      required: ["name"]
    }
  }
];

var buffer = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', function(chunk) {
  buffer += chunk;
  var idx;
  while ((idx = buffer.indexOf('\\n')) !== -1) {
    var line = buffer.substring(0, idx).trim();
    buffer = buffer.substring(idx + 1);
    if (line.length === 0) continue;
    try {
      handleMessage(JSON.parse(line));
    } catch (e) {
      // ignore malformed JSON
    }
  }
});

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: id, result: result }) + '\\n');
}

function respondError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: id, error: { code: code, message: message } }) + '\\n');
}

function handleMessage(msg) {
  if (msg.method === 'initialize') {
    respond(msg.id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "test-mcp-server", version: "1.0.0" }
    });
    return;
  }

  if (msg.method === 'notifications/initialized') {
    return;
  }

  if (msg.method === 'tools/list') {
    respond(msg.id, { tools: tools });
    return;
  }

  if (msg.method === 'tools/call') {
    var name = msg.params.name;
    var args = msg.params.arguments || {};
    if (name === 'greet') {
      respond(msg.id, {
        content: [{ type: "text", text: "Hello, " + (args.name || "world") + "!" }]
      });
    } else {
      respondError(msg.id, -32601, "Unknown tool: " + name);
    }
    return;
  }

  if (msg.method === 'notifications/shutdown' || msg.method === 'shutdown') {
    process.exit(0);
    return;
  }

  if (msg.id !== undefined) {
    respondError(msg.id, -32601, "Method not found: " + msg.method);
  }
}

process.stdin.resume();
`;
