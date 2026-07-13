import type { ToolCall } from "./tool.js";
import type { JsonObject, JsonValue, Usage } from "./types.js";

export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface AgentMessage {
  role: MessageRole;
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
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

export interface OpenAIChatRequestOptions {
  model: string;
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
      const responseText = await response.text();

      if (!response.ok) {
        throw new Error(
          formatHttpError(
            `Model request failed with status ${response.status}`,
            responseText,
          ),
        );
      }

      const json = parseJsonResponse(responseText);
      return (
        options.mapResponse?.(json) ?? {
          output: extractOutput(json),
          toolCalls: extractToolCalls(json),
          usage: extractUsage(json),
          raw: json,
        }
      );
    },
  };
}

export function createOpenAIChatRequestMapper(
  options: OpenAIChatRequestOptions,
): (request: ModelRequest) => JsonObject {
  return (request) => ({
    model: options.model,
    messages: request.messages.map((message) => ({
      role: message.role,
      content: message.content,
      ...(message.name ? { name: message.name } : {}),
      ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
      ...(message.toolCalls?.length
        ? {
            tool_calls: message.toolCalls.map((toolCall) => ({
              id: toolCall.id,
              type: "function",
              function: {
                name: toolCall.name,
                arguments: JSON.stringify(toolCall.input),
              },
            })),
          }
        : {}),
    })),
    tools: request.tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    })),
  });
}

function extractOutput(value: JsonValue): string {
  if (typeof value === "string") {
    return value;
  }
  const chatMessage = extractChatMessage(value);
  if (chatMessage) {
    const content = chatMessage.content;
    if (typeof content === "string") {
      return content;
    }
    if (Array.isArray(content)) {
      const text = content
        .map((part) => {
          if (
            part &&
            typeof part === "object" &&
            !Array.isArray(part) &&
            part.type === "text" &&
            typeof part.text === "string"
          ) {
            return part.text;
          }
          return "";
        })
        .filter(Boolean)
        .join("\n");
      if (text) {
        return text;
      }
    }
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

function extractToolCalls(value: JsonValue): ToolCall[] | undefined {
  const chatMessage = extractChatMessage(value);
  if (!chatMessage) {
    return undefined;
  }

  const toolCalls = chatMessage.tool_calls;
  if (!Array.isArray(toolCalls)) {
    return undefined;
  }

  const parsed = toolCalls.flatMap((toolCall, index) => {
    if (!toolCall || typeof toolCall !== "object" || Array.isArray(toolCall)) {
      return [];
    }
    const functionCall = toolCall.function;
    if (
      !functionCall ||
      typeof functionCall !== "object" ||
      Array.isArray(functionCall) ||
      typeof functionCall.name !== "string"
    ) {
      return [];
    }

    const rawArguments = functionCall.arguments;
    const input = parseToolArguments(rawArguments);
    if (!input) {
      return [];
    }

    return [
      {
        id:
          typeof toolCall.id === "string" && toolCall.id
            ? toolCall.id
            : `tool-call-${index + 1}`,
        name: functionCall.name,
        input,
      },
    ];
  });

  return parsed.length > 0 ? parsed : undefined;
}

function parseToolArguments(value: JsonValue): JsonObject | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value) as JsonValue;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function extractUsage(value: JsonValue): Usage | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const rawUsage = value.usage;
  if (!rawUsage || typeof rawUsage !== "object" || Array.isArray(rawUsage)) {
    return undefined;
  }

  const usage: Usage = {};
  const inputTokens = numberOrUndefined(
    rawUsage.input_tokens ?? rawUsage.prompt_tokens,
  );
  const outputTokens = numberOrUndefined(
    rawUsage.output_tokens ?? rawUsage.completion_tokens,
  );
  const totalTokens = numberOrUndefined(rawUsage.total_tokens);

  if (inputTokens !== undefined) {
    usage.inputTokens = inputTokens;
  }
  if (outputTokens !== undefined) {
    usage.outputTokens = outputTokens;
  }
  if (totalTokens !== undefined) {
    usage.totalTokens = totalTokens;
  } else if (inputTokens !== undefined || outputTokens !== undefined) {
    usage.totalTokens = (inputTokens ?? 0) + (outputTokens ?? 0);
  }

  return Object.keys(usage).length > 0 ? usage : undefined;
}

function extractChatMessage(value: JsonValue): JsonObject | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const choices = value.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return undefined;
  }
  const firstChoice = choices[0];
  if (
    !firstChoice ||
    typeof firstChoice !== "object" ||
    Array.isArray(firstChoice)
  ) {
    return undefined;
  }
  const message = firstChoice.message;
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return undefined;
  }
  return message;
}

function numberOrUndefined(value: JsonValue | undefined): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function parseJsonResponse(responseText: string): JsonValue {
  try {
    return JSON.parse(responseText) as JsonValue;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      formatHttpError(
        `Model response was not valid JSON: ${reason}`,
        responseText,
      ),
    );
  }
}

function formatHttpError(message: string, responseText: string): string {
  const body = responseText.trim();
  if (!body) {
    return message;
  }
  const bodyPreview =
    body.length > 500 ? `${body.slice(0, 500)}...<truncated>` : body;
  return `${message}; body=${JSON.stringify(bodyPreview)}`;
}
