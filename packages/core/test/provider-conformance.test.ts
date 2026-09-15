import assert from "node:assert/strict";
import test from "node:test";
import {
  createAgent,
  createAnthropicMessagesRequestMapper,
  createAnthropicMessagesResponseMapper,
  createHttpJsonModel,
  createOpenAIChatRequestMapper,
  defineSkill,
  type JsonObject,
  type JsonSchema,
  type ModelProvider,
} from "../src/index.js";

interface ProviderFixture {
  name: string;
  createModel(endpoint: string): ModelProvider;
  responses: JsonObject[];
  assertRequests(requests: JsonObject[]): void;
}

const sumTool: JsonSchema = {
  type: "object",
  properties: {
    a: { type: "number" },
    b: { type: "number" },
  },
  required: ["a", "b"],
};

const fixtures: ProviderFixture[] = [
  {
    name: "OpenAI-compatible chat",
    createModel: (endpoint) =>
      createHttpJsonModel({
        name: "openai-compatible",
        endpoint,
        mapRequest: createOpenAIChatRequestMapper({ model: "test-model" }),
      }),
    responses: [
      {
        choices: [
          {
            message: {
              content: "I'll calculate that.",
              tool_calls: [
                {
                  id: "call_sum",
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
        usage: { prompt_tokens: 10, completion_tokens: 4 },
      },
      {
        choices: [{ message: { content: "The total is 7." } }],
        usage: { prompt_tokens: 14, completion_tokens: 5 },
      },
    ],
    assertRequests(requests) {
      assert.deepEqual(requests, [
        {
          model: "test-model",
          messages: [
            { role: "system", content: "Be concise." },
            { role: "user", content: "Add 3 and 4." },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "sum",
                description: "Add two numbers.",
                parameters: sumTool,
              },
            },
          ],
        },
        {
          model: "test-model",
          messages: [
            { role: "system", content: "Be concise." },
            { role: "user", content: "Add 3 and 4." },
            {
              role: "assistant",
              content: "I'll calculate that.",
              tool_calls: [
                {
                  id: "call_sum",
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
              tool_call_id: "call_sum",
            },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "sum",
                description: "Add two numbers.",
                parameters: sumTool,
              },
            },
          ],
        },
      ]);
    },
  },
  {
    name: "Anthropic Messages",
    createModel: (endpoint) =>
      createHttpJsonModel({
        name: "anthropic",
        endpoint,
        mapRequest: createAnthropicMessagesRequestMapper({
          model: "test-model",
          maxTokens: 256,
        }),
        mapResponse: createAnthropicMessagesResponseMapper(),
      }),
    responses: [
      {
        content: [
          { type: "text", text: "I'll calculate that." },
          {
            type: "tool_use",
            id: "call_sum",
            name: "sum",
            input: { a: 3, b: 4 },
          },
        ],
        usage: { input_tokens: 10, output_tokens: 4 },
      },
      {
        content: [{ type: "text", text: "The total is 7." }],
        usage: { input_tokens: 14, output_tokens: 5 },
      },
    ],
    assertRequests(requests) {
      assert.deepEqual(requests, [
        {
          model: "test-model",
          max_tokens: 256,
          system: "Be concise.",
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: "Add 3 and 4." }],
            },
          ],
          tools: [
            {
              name: "sum",
              description: "Add two numbers.",
              input_schema: sumTool,
            },
          ],
        },
        {
          model: "test-model",
          max_tokens: 256,
          system: "Be concise.",
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: "Add 3 and 4." }],
            },
            {
              role: "assistant",
              content: [
                { type: "text", text: "I'll calculate that." },
                {
                  type: "tool_use",
                  id: "call_sum",
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
                  tool_use_id: "call_sum",
                  content: "7",
                },
              ],
            },
          ],
          tools: [
            {
              name: "sum",
              description: "Add two numbers.",
              input_schema: sumTool,
            },
          ],
        },
      ]);
    },
  },
];

for (const fixture of fixtures) {
  test(`${fixture.name} completes a tool-call round trip`, async () => {
    const requests: JsonObject[] = [];
    let responseIndex = 0;

    await withMockFetch(
      async (_input, init) => {
        const body = init?.body;
        assert.ok(typeof body === "string");
        requests.push(JSON.parse(body) as JsonObject);
        const response = fixture.responses[responseIndex];
        responseIndex += 1;
        assert.ok(response, "provider requested an unexpected extra response");
        return new Response(JSON.stringify(response), { status: 200 });
      },
      async () => {
        const sum = defineSkill({
          name: "sum",
          description: "Add two numbers.",
          inputSchema: sumTool,
          run: ({ input }) => Number(input.a) + Number(input.b),
        });
        const agent = createAgent({
          model: fixture.createModel(
            `https://${fixture.name.toLowerCase().replaceAll(" ", "-")}.test`,
          ),
          systemPrompt: "Be concise.",
          skills: [sum],
        });

        const result = await agent.run("Add 3 and 4.");

        assert.equal(result.output, "The total is 7.");
        assert.deepEqual(result.toolResults, [
          { callId: "call_sum", name: "sum", output: 7 },
        ]);
        assert.deepEqual(result.usage, {
          inputTokens: 24,
          outputTokens: 9,
          totalTokens: 33,
          latencyMs: 0,
        });
      },
    );

    assert.equal(responseIndex, fixture.responses.length);
    fixture.assertRequests(requests);
  });
}

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
