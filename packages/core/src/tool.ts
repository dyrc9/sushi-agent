import type { JsonObject, JsonSchema, JsonValue, RunContext } from "./types.js";

export interface ToolCall {
  id: string;
  name: string;
  input: JsonObject;
}

export interface ToolResult {
  callId: string;
  name: string;
  output?: JsonValue;
  error?: string;
}

export interface ToolRunRequest {
  input: JsonObject;
  context: RunContext;
  signal?: AbortSignal;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  run(request: ToolRunRequest): Promise<JsonValue> | JsonValue;
}

export function defineTool(tool: ToolDefinition): ToolDefinition {
  assertCapabilityName(tool.name);
  return tool;
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  constructor(tools: ToolDefinition[] = []) {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  register(tool: ToolDefinition): void {
    assertCapabilityName(tool.name);
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }
}

export function assertCapabilityName(name: string): void {
  if (!/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(name)) {
    throw new Error(`Invalid capability name: ${name}`);
  }
}
