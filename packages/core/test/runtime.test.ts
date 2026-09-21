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
      const assistantMessage = request.messages.find(
        (message) => message.role === "assistant",
      );
      assert.deepEqual(assistantMessage?.toolCalls, calls);
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

test("does not start a run when its signal is already aborted", async () => {
  const controller = new AbortController();
  controller.abort(new Error("cancel before start"));
  let modelCalls = 0;
  const model: ModelProvider = {
    name: "test",
    async generate() {
      modelCalls += 1;
      return { output: "unexpected" };
    },
  };

  const agent = createAgent({ model });

  await assert.rejects(
    agent.run("hello", { signal: controller.signal }),
    /cancel before start/,
  );
  assert.equal(modelCalls, 0);
});

test("propagates cancellation during a tool call", async () => {
  const controller = new AbortController();
  let modelCalls = 0;
  const model: ModelProvider = {
    name: "tool-model",
    async generate() {
      modelCalls += 1;
      return {
        output: "calling tool",
        toolCalls: [{ id: "call-1", name: "cancel", input: {} }],
      };
    },
  };
  const cancel = defineSkill({
    name: "cancel",
    description: "Cancel the current run.",
    inputSchema: { type: "object" },
    run() {
      controller.abort(new Error("cancel during tool"));
      throw new Error("tool observed cancellation");
    },
  });

  const agent = createAgent({ model, skills: [cancel] });

  await assert.rejects(
    agent.run("cancel", { signal: controller.signal }),
    /cancel during tool/,
  );
  assert.equal(modelCalls, 1);
});
