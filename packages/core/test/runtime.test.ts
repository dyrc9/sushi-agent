import assert from "node:assert/strict";
import test from "node:test";
import {
  createAgent,
  defineSkill,
  type ModelProvider,
  type ToolCall,
} from "../src/index.js";

test("runs a simple model without tools", async () => {
  const model: ModelProvider = {
    name: "test",
    async generate() {
      return { output: "done" };
    },
  };

  const agent = createAgent({ model });
  const result = await agent.run("hello");

  assert.equal(result.output, "done");
  assert.equal(result.toolResults.length, 0);
  assert.equal(result.trace.at(-1)?.type, "agent.end");
});

test("executes model-requested skills and feeds results back", async () => {
  const calls: ToolCall[] = [
    { id: "call-1", name: "sum", input: { a: 2, b: 5 } },
  ];
  let round = 0;
  const model: ModelProvider = {
    name: "tool-model",
    async generate(request) {
      round += 1;
      if (round === 1) {
        assert.equal(request.tools[0]?.name, "sum");
        return { output: "calling tool", toolCalls: calls };
      }
      const toolMessage = request.messages.find(
        (message) => message.role === "tool",
      );
      return { output: `answer:${toolMessage?.content ?? ""}` };
    },
  };

  const sum = defineSkill({
    name: "sum",
    description: "Add two numbers.",
    inputSchema: {
      type: "object",
      properties: {
        a: { type: "number" },
        b: { type: "number" },
      },
      required: ["a", "b"],
    },
    run: ({ input }) => Number(input.a) + Number(input.b),
  });

  const agent = createAgent({ model, skills: [sum] });
  const result = await agent.run("add");

  assert.equal(result.output, "answer:7");
  assert.deepEqual(result.toolResults[0], {
    callId: "call-1",
    name: "sum",
    output: 7,
  });
});
