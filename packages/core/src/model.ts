import type { ToolCall } from "./tool.js";
import type { JsonObject, JsonValue, Usage } from "./types.js";

export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface AgentMessage {
  role: MessageRole;
  content: string;
  name?: string;
  toolCallId?: string;
}

export interface ModelTool {
  name: string;
  description: string;
  inputSchema: JsonObject;
}

export interface ModelRequest {
  messages: AgentMessage[];
  tools: ModelTool[];
  context: JsonObject;
  signal?: AbortSignal;
}

export interface ModelResponse {
  output: string;
  toolCalls?: ToolCall[];
  usage?: Usage;
  raw?: JsonValue;
}

export interface ModelProvider {
  name: string;
  generate(request: ModelRequest): Promise<ModelResponse>;
}

export function createEchoModel(name = "echo"): ModelProvider {
  return {
    name,
    async generate(request) {
      const lastUser = [...request.messages]
        .reverse()
        .find((message) => message.role === "user");
      const availableTools =
        request.tools.map((tool) => tool.name).join(", ") || "none";
      return {
        output: `Echo: ${lastUser?.content ?? ""}\nAvailable tools: ${availableTools}`,
        usage: {
          inputTokens: estimateTokens(
            request.messages.map((message) => message.content).join("\n"),
          ),
          outputTokens: 8,
        },
      };
    },
  };
}

export function createHttpJsonModel(options: {
  name: string;
  endpoint: string;
  headers?: Record<string, string>;
  mapRequest?: (request: ModelRequest) => JsonObject;
  mapResponse?: (response: JsonValue) => ModelResponse;
}): ModelProvider {
  return {
    name: options.name,
    async generate(request) {
      const body = options.mapRequest?.(request) ?? {
        messages: request.messages,
        tools: request.tools,
        context: request.context,
      };

      const response = await fetch(options.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...options.headers,
        },
        body: JSON.stringify(body),
        signal: request.signal,
      });

      if (!response.ok) {
        throw new Error(`Model request failed with status ${response.status}`);
      }

      const json = (await response.json()) as JsonValue;
      return (
        options.mapResponse?.(json) ?? {
          output: extractOutput(json),
          raw: json,
        }
      );
    },
  };
}

function extractOutput(value: JsonValue): string {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const output = value.output ?? value.text ?? value.content;
    if (typeof output === "string") {
      return output;
    }
  }
  return JSON.stringify(value);
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
