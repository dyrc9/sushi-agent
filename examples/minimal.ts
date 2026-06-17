import { createAgent, createEchoModel, defineSkill } from "@sushi-agent/core";

const summarize = defineSkill({
  name: "summarize",
  description: "Produce a concise summary.",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string" },
    },
    required: ["text"],
  },
  run: ({ input }) => ({
    summary: String(input.text ?? "").slice(0, 140),
  }),
});

const agent = createAgent({
  model: createEchoModel(),
  skills: [summarize],
});

const result = await agent.run({
  input: "Summarize the project direction.",
  context: { project: "sushi-agent" },
});

console.log(result.output);
