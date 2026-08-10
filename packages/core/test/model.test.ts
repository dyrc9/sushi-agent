import assert from "node:assert/strict";
import test from "node:test";
import {
  createAnthropicMessagesRequestMapper,
  createAnthropicMessagesResponseMapper,
  createHttpJsonModel,
  createOpenAIChatRequestMapper,
} from "../src/index.js";
import type { JsonObject } from "../src/index.js";

test("createAnthropicMessagesRequestMapper formats system prompts and tools", () => {
  const mapRequest = createAnthropicMessagesRequestMapper({
    model: "claude-model",
    maxTokens: 1024,
    additionalBody: {
      temperature: 0.2,
      model: "ignored-model",
      max_tokens: 1,
      system: "ignored system",
      messages: [],
      tools: [],
    },
  });

  assert.deepEqual(
    mapRequest({
      messages: [
        { role: "system", content: "Be concise." },
        { role: "user", content: "add two numbers" },
        {
          role: "assistant",
          content: "I'll calculate that.",
          toolCalls: [
            {
              id: "toolu_123",
              name: "sum",
              input: { a: 3, b: 4 },
            },
          ],
        },
        {
          role: "tool",
          content: "7",
          name: "sum",
          toolCallId: "toolu_123",
        },
        {
          role: "tool",
          content: "saved",
          name: "store",
          toolCallId: "toolu_456",
        },
      ],
      tools: [
        {
          name: "sum",
          description: "Add numbers",
          inputSchema: {
            type: "object",
            properties: {
              a: { type: "number" },
              b: { type: "number" },
            },
            required: ["a", "b"],
          },
        },
      ],
      context: {},
    }),
    {
      temperature: 0.2,
      model: "claude-model",
      max_tokens: 1024,
      system: "Be concise.",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "add two numbers" }],
        },
        {
          role: "assistant",
          content: [
            { type: "text", text: "I'll calculate that." },
            {
              type: "tool_use",
              id: "toolu_123",
              name: "sum",
              input: { a: 3, b: 4 },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_123",
              content: "7",
            },
            {
              type: "tool_result",
              tool_use_id: "toolu_456",
              content: "saved",
            },
          ],
        },
      ],
      tools: [
        {
          name: "sum",
          description: "Add numbers",
          input_schema: {
            type: "object",
            properties: {
              a: { type: "number" },
              b: { type: "number" },
            },
            required: ["a", "b"],
          },
        },
      ],
    },
  );
});

test("createAnthropicMessagesResponseMapper extracts content, tools, and usage", () => {
  const mapResponse = createAnthropicMessagesResponseMapper();
  const response: JsonObject = {
    content: [
      { type: "text", text: "I'll calculate that." },
      {
        type: "tool_use",
        id: "toolu_123",
        name: "sum",
        input: { a: 3, b: 4 },
      },
      { type: "text", text: "One moment." },
    ],
    usage: { input_tokens: 12, output_tokens: 8 },
  };

  assert.deepEqual(mapResponse(response), {
    output: "I'll calculate that.\nOne moment.",
    toolCalls: [
      {
        id: "toolu_123",
        name: "sum",
        input: { a: 3, b: 4 },
      },
    ],
    usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
    raw: response,
  });
});

test("createAnthropicMessagesRequestMapper rejects tool results without an ID", () => {
  const mapRequest = createAnthropicMessagesRequestMapper({
    model: "claude-model",
    maxTokens: 1024,
  });

  assert.throws(
    () =>
      mapRequest({
        messages: [{ role: "tool", content: "7" }],
        tools: [],
        context: {},
      }),
    /toolCallId/,
  );
});

test("createOpenAIChatRequestMapper formats messages and function tools", () => {
  const mapRequest = createOpenAIChatRequestMapper({ model: "small-model" });

  assert.deepEqual(
    mapRequest({
      messages: [
        { role: "user", content: "add two numbers" },
        {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "call_123",
              name: "sum",
              input: { a: 3, b: 4 },
            },
          ],
        },
        {
          role: "tool",
          content: "7",
          name: "sum",
          toolCallId: "call_123",
        },
      ],
      tools: [
        {
          name: "sum",
          description: "Add numbers",
          inputSchema: {
            type: "object",
            properties: {
              a: { type: "number" },
              b: { type: "number" },
            },
            required: ["a", "b"],
          },
        },
      ],
      context: { tenant: "example" },
    }),
    {
      model: "small-model",
      messages: [
        { role: "user", content: "add two numbers" },
        {
          role: "assistant",
          content: "",
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
        {
          role: "tool",
          content: "7",
          name: "sum",
          tool_call_id: "call_123",
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "sum",
            description: "Add numbers",
            parameters: {
              type: "object",
              properties: {
                a: { type: "number" },
                b: { type: "number" },
              },
              required: ["a", "b"],
            },
          },
        },
      ],
    },
  );
});

test("createOpenAIChatRequestMapper adds provider fields without replacing runtime fields", () => {
  const mapRequest = createOpenAIChatRequestMapper({
    model: "small-model",
    additionalBody: {
      temperature: 0.2,
      response_format: { type: "json_object" },
      model: "ignored-model",
      messages: [],
      tools: [],
    },
  });

  assert.deepEqual(
    mapRequest({
      messages: [{ role: "user", content: "return JSON" }],
      tools: [
        {
          name: "lookup",
          description: "Look up a value",
          inputSchema: { type: "object" },
        },
      ],
      context: {},
    }),
    {
      temperature: 0.2,
      response_format: { type: "json_object" },
      model: "small-model",
      messages: [{ role: "user", content: "return JSON" }],
      tools: [
        {
          type: "function",
          function: {
            name: "lookup",
            description: "Look up a value",
            parameters: { type: "object" },
          },
        },
      ],
    },
  );
});

test("createHttpJsonModel posts mapped requests and parses mapped responses", async () => {
  let seenUrl = "";
  let seenInit: RequestInit | undefined;

  await withMockFetch(
    async (input, init) => {
      seenUrl = String(input);
      seenInit = init;
      return new Response(
        JSON.stringify({ text: "ok", usage: { totalTokens: 9 } }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    },
    async () => {
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
    },
  );

  assert.equal(seenUrl, "https://models.example.test/v1/generate");
  assert.equal(seenInit?.method, "POST");
  assert.equal(new Headers(seenInit?.headers).get("x-test-header"), "present");
  assert.deepEqual(JSON.parse(String(seenInit?.body)), {
    prompt: "hello",
    toolNames: ["sum"],
  });
});

test("createHttpJsonModel includes response body on non-2xx errors", async () => {
  await withMockFetch(
    async () =>
      new Response(
        JSON.stringify({ error: "rate_limited", retryAfterMs: 250 }),
        {
          status: 429,
          headers: { "content-type": "application/json" },
        },
      ),
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
