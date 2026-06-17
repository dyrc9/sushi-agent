#!/usr/bin/env node
import { createAgent, createEchoModel, defineSkill } from "@sushi-agent/core";

async function main(argv: string[]): Promise<void> {
  const command = argv[2] ?? "run";
  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command !== "run") {
    throw new Error(`Unknown command: ${command}`);
  }

  const prompt = argv.slice(3).join(" ").trim();
  if (!prompt) {
    throw new Error('Missing prompt. Try: sushi-agent run "summarize this"');
  }

  const inspect = defineSkill({
    name: "inspect",
    description: "Return basic information about the current prompt.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string" },
      },
      required: ["text"],
    },
    run: ({ input }) => {
      const text = String(input.text ?? "");
      return {
        chars: text.length,
        words: text.split(/\s+/).filter(Boolean).length,
      };
    },
  });

  const agent = createAgent({
    model: createEchoModel(),
    skills: [inspect],
    systemPrompt: "You are sushi-agent, a thin embeddable agent runtime.",
  });
  const result = await agent.run(prompt);
  console.log(result.output);
}

function printHelp(): void {
  console.log(`sushi-agent

Usage:
  sushi-agent run "prompt"
  sushi-agent help`);
}

main(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
