import assert from "node:assert/strict";
import test from "node:test";
import { createHttpJsonModel } from "../src/index.js";

test("createHttpJsonModel posts mapped requests and parses mapped responses", async () => {
  let seenUrl = "";
  let seenInit: RequestInit | undefined;

  await withMockFetch(async (input, init) => {
    seenUrl = String(input);
    seenInit = init;
    return new Response(JSON.stringify({ text: "ok", usage: { totalTokens: 9 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }, async () => {
    const model = createHttpJsonModel({
      name: "http-test",
      endpoint: "https://models.example.test/v1/generate",
      headers: { "x-test-header": "present" },
      mapRequest(request) {
        return {
          prompt: request.messages.at(-1)?.content ?? "",
          toolNames: request.tools.map((tool) => tool.name),
        };
      },
      mapResponse(response) {
        assert.deepEqual(response, { text: "ok", usage: { totalTokens: 9 } });
        return {
          output: "mapped:ok",
          usage: { totalTokens: 9 },
          raw: response,
        };
      },
    });

    const result = await model.generate({
      messages: [{ role: "user", content: "hello" }],
      tools: [
        {
          name: "sum",
          description: "Add numbers",
          inputSchema: { type: "object" },
        },
      ],
      context: {},
    });

    assert.equal(result.output, "mapped:ok");
    assert.equal(result.usage?.totalTokens, 9);
  });

  assert.equal(seenUrl, "https://models.example.test/v1/generate");
  assert.equal(seenInit?.method, "POST");
  assert.equal(
    new Headers(seenInit?.headers).get("x-test-header"),
    "present",
  );
  assert.deepEqual(JSON.parse(String(seenInit?.body)), {
    prompt: "hello",
    toolNames: ["sum"],
  });
});

test("createHttpJsonModel includes response body on non-2xx errors", async () => {
  await withMockFetch(
    async () =>
      new Response(JSON.stringify({ error: "rate_limited", retryAfterMs: 250 }), {
        status: 429,
        headers: { "content-type": "application/json" },
      }),
    async () => {
      const model = createHttpJsonModel({
        name: "http-test",
        endpoint: "https://models.example.test/v1/generate",
      });

      await assert.rejects(
        model.generate({
          messages: [{ role: "user", content: "hello" }],
          tools: [],
          context: {},
        }),
        /status 429.*body=.*rate_limited/,
      );
    },
  );
});

test("createHttpJsonModel includes response body on invalid JSON", async () => {
  await withMockFetch(
    async () =>
      new Response("upstream overloaded", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    async () => {
      const model = createHttpJsonModel({
        name: "http-test",
        endpoint: "https://models.example.test/v1/generate",
      });

      await assert.rejects(
        model.generate({
          messages: [{ role: "user", content: "hello" }],
          tools: [],
          context: {},
        }),
        /not valid JSON.*body=.*upstream overloaded/,
      );
    },
  );
});

test("createHttpJsonModel extracts OpenAI-compatible output, tool calls, and usage by default", async () => {
  await withMockFetch(
    async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "Need a tool",
                tool_calls: [
                  {
                    id: "call_123",
                    type: "function",
                    function: {
                      name: "sum",
                      arguments: JSON.stringify({ a: 3, b: 4 }),
                    },
                  },
                ],
              },
            },
          ],
          usage: {
            prompt_tokens: 11,
            completion_tokens: 7,
            total_tokens: 18,
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    async () => {
      const model = createHttpJsonModel({
        name: "http-test",
        endpoint: "https://models.example.test/v1/generate",
      });

      const result = await model.generate({
        messages: [{ role: "user", content: "hello" }],
        tools: [],
        context: {},
      });

      assert.equal(result.output, "Need a tool");
      assert.deepEqual(result.toolCalls, [
        {
          id: "call_123",
          name: "sum",
          input: { a: 3, b: 4 },
        },
      ]);
      assert.deepEqual(result.usage, {
        inputTokens: 11,
        outputTokens: 7,
        totalTokens: 18,
      });
    },
  );
});

test("createHttpJsonModel joins text content parts from OpenAI-compatible responses", async () => {
  await withMockFetch(
    async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: [
                  { type: "text", text: "first line" },
                  { type: "text", text: "second line" },
                ],
              },
            },
          ],
          usage: {
            input_tokens: 5,
            output_tokens: 2,
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    async () => {
      const model = createHttpJsonModel({
        name: "http-test",
        endpoint: "https://models.example.test/v1/generate",
      });

      const result = await model.generate({
        messages: [{ role: "user", content: "hello" }],
        tools: [],
        context: {},
      });

      assert.equal(result.output, "first line\nsecond line");
      assert.deepEqual(result.usage, {
        inputTokens: 5,
        outputTokens: 2,
        totalTokens: 7,
      });
    },
  );
});

async function withMockFetch<T>(
  mockFetch: typeof fetch,
  run: () => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}
