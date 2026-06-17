# sushi-agent

Thin, embeddable TypeScript + Rust runtime for small production agents.

`sushi-agent` is named with a small bilingual wink: "sushi" echoes "Su Shi" / 苏轼. The engineering goal is still practical and restrained: give existing systems agent capability without forcing them into a large framework.

The project is aimed at systems that need agent behavior without adopting a large framework. It provides a small TypeScript SDK for model routing, skills, tools, and MCP clients, plus a Rust tool crate for fast local operations that agents often need.

## Goals

- Embed an agent in an existing app with a few explicit interfaces.
- Support multiple LLM providers without binding the app to one vendor.
- Treat skills as portable, versioned capability bundles.
- Speak MCP natively for external tools and data sources.
- Keep hot local utilities in Rust when speed and predictable resource use matter.
- Stay easy to audit: clear traces, simple state, no hidden control plane.

## Packages

| Path                 | Purpose                                                                           |
| -------------------- | --------------------------------------------------------------------------------- |
| `packages/core`      | TypeScript runtime: agent loop, LLM provider contract, skills, tools, MCP client. |
| `packages/cli`       | Small CLI wrapper for local experiments and smoke tests.                          |
| `crates/sushi-tools` | Rust command-line tools for high-throughput file and text operations.             |

## Quick Start

```ts
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
  run: async ({ input }) => ({
    summary: String(input.text).slice(0, 140),
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
```

## Design

The runtime keeps the agent loop deliberately thin:

1. Normalize user input into a run request.
2. Expose registered skills and tools as model-callable capabilities.
3. Route the prompt through a provider adapter.
4. Execute requested tools with explicit input validation.
5. Return output, traces, usage, and errors in a stable shape.

That makes the kit useful as a library inside web services, CLIs, worker queues, and product backends.

## MCP

MCP support is built around stdio JSON-RPC clients. Applications can register MCP servers as tool providers without forcing the rest of the system to know about MCP process management.

```ts
import { createMcpStdioClient } from "@sushi-agent/core";

const mcp = createMcpStdioClient({
  command: "node",
  args: ["./server.js"],
});
```

## Rust Tools

The Rust crate currently includes local text and file utilities:

```bash
cargo run -p sushi-tools -- stats README.md
cargo run -p sushi-tools -- top-words README.md --limit 20
cargo run -p sushi-tools -- find README.md agent
```

These are intentionally generic. The boundary is designed so more tools can be exposed to TypeScript through process calls first, then upgraded to native bindings later if needed.

## Maintenance

This repository is configured with:

- GitHub Actions CI for TypeScript and Rust.
- A scheduled weekly maintenance workflow.
- Dependabot updates for npm, Cargo, and GitHub Actions.

See [MAINTENANCE.md](MAINTENANCE.md) for the operating rhythm.
