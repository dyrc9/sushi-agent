import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createMcpStdioClient } from "../src/index.js";

const fixtureDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);

test("returns JSON-RPC results from a stdio MCP server", async () => {
  const client = createMcpStdioClient({
    command: process.execPath,
    args: [path.join(fixtureDir, "mcp-success.js")],
  });

  try {
    const result = await client.request("sum", { a: 2, b: 5 });
    assert.deepEqual(result, {
      method: "sum",
      params: { a: 2, b: 5 },
    });
  } finally {
    client.close();
  }
});

test("rejects pending requests when the MCP server emits invalid JSON", async () => {
  const client = createMcpStdioClient({
    command: process.execPath,
    args: [path.join(fixtureDir, "mcp-invalid-json.js")],
  });

  try {
    await assert.rejects(
      client.request("broken", {}),
      /invalid JSON.*line=.*not json.*stderr=.*protocol panic/,
    );
  } finally {
    client.close();
  }
});

test("includes stderr when the MCP server exits before replying", async () => {
  const client = createMcpStdioClient({
    command: process.execPath,
    args: [path.join(fixtureDir, "mcp-exit.js")],
  });

  try {
    await assert.rejects(
      client.request("hang", {}),
      /exited: code=7 signal=none.*stderr=.*fatal: connection lost/,
    );
  } finally {
    client.close();
  }
});
