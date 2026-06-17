import {
  createTraceEvent,
  MemoryTraceSink,
  type TraceEvent,
  type TraceSink,
} from "./trace.js";
import { skillToTool, type Skill } from "./skill.js";
import { ToolRegistry, type ToolDefinition, type ToolResult } from "./tool.js";
import type { AgentInput, JsonObject, RunContext, Usage } from "./types.js";
import type { AgentMessage, ModelProvider, ModelTool } from "./model.js";

export interface AgentOptions {
  model: ModelProvider;
  systemPrompt?: string;
  skills?: Skill[];
  tools?: ToolDefinition[];
  traceSink?: TraceSink;
  maxToolRounds?: number;
}

export interface AgentRunResult {
  output: string;
  trace: TraceEvent[];
  toolResults: ToolResult[];
  usage: Usage;
}

export interface AgentRuntime {
  run(
    input: AgentInput,
    options?: { signal?: AbortSignal },
  ): Promise<AgentRunResult>;
  tools: ToolRegistry;
}

export function createAgent(options: AgentOptions): AgentRuntime {
  const memorySink = new MemoryTraceSink();
  const traceSink = options.traceSink ?? memorySink;
  const tools = new ToolRegistry([
    ...(options.tools ?? []),
    ...(options.skills ?? []).map((skill) => skillToTool(skill)),
  ]);

  async function record(event: TraceEvent): Promise<void> {
    memorySink.record(event);
    if (traceSink !== memorySink) {
      await traceSink.record(event);
    }
  }

  return {
    tools,
    async run(input, runOptions) {
      const request = normalizeInput(input);
      const traceStart = memorySink.events.length;
      const usage: Usage = {};
      const toolResults: ToolResult[] = [];
      const messages: AgentMessage[] = [
        ...(options.systemPrompt
          ? [{ role: "system" as const, content: options.systemPrompt }]
          : []),
        { role: "user", content: request.input },
      ];

      await record(
        createTraceEvent("agent.start", {
          input: request.input,
          context: request.context,
        }),
      );

      const maxToolRounds = options.maxToolRounds ?? 3;
      for (let round = 0; round <= maxToolRounds; round += 1) {
        const modelTools: ModelTool[] = tools.list().map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema as JsonObject,
        }));

        await record(
          createTraceEvent("model.request", {
            provider: options.model.name,
            round,
            toolCount: modelTools.length,
          }),
        );

        const modelResponse = await options.model.generate({
          messages,
          tools: modelTools,
          context: request.context,
          signal: runOptions?.signal,
        });

        mergeUsage(usage, modelResponse.usage);
        await record(
          createTraceEvent(
            "model.response",
            {
              provider: options.model.name,
              round,
              output: modelResponse.output,
              toolCallCount: modelResponse.toolCalls?.length ?? 0,
            },
            modelResponse.usage,
          ),
        );

        if (!modelResponse.toolCalls?.length) {
          await record(
            createTraceEvent("agent.end", { reason: "model-output" }, usage),
          );
          return {
            output: modelResponse.output,
            trace: memorySink.events.slice(traceStart),
            toolResults,
            usage,
          };
        }

        messages.push({ role: "assistant", content: modelResponse.output });

        for (const call of modelResponse.toolCalls) {
          const tool = tools.get(call.name);
          if (!tool) {
            const result = {
              callId: call.id,
              name: call.name,
              error: `Unknown tool: ${call.name}`,
            };
            toolResults.push(result);
            messages.push({
              role: "tool",
              name: call.name,
              toolCallId: call.id,
              content: result.error,
            });
            await record(createTraceEvent("tool.error", result));
            continue;
          }

          await record(
            createTraceEvent("tool.start", {
              callId: call.id,
              name: call.name,
              input: call.input,
            }),
          );
          try {
            const output = await tool.run({
              input: call.input,
              context: request.context,
              signal: runOptions?.signal,
            });
            const result: ToolResult = {
              callId: call.id,
              name: call.name,
              output,
            };
            toolResults.push(result);
            messages.push({
              role: "tool",
              name: call.name,
              toolCallId: call.id,
              content: JSON.stringify(output),
            });
            await record(
              createTraceEvent("tool.end", {
                callId: call.id,
                name: call.name,
                output,
              }),
            );
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            const result = { callId: call.id, name: call.name, error: message };
            toolResults.push(result);
            messages.push({
              role: "tool",
              name: call.name,
              toolCallId: call.id,
              content: message,
            });
            await record(createTraceEvent("tool.error", result));
          }
        }
      }

      const output = `Stopped after ${maxToolRounds} tool rounds.`;
      await record(
        createTraceEvent("agent.end", { reason: "max-tool-rounds" }, usage),
      );
      return {
        output,
        trace: memorySink.events.slice(traceStart),
        toolResults,
        usage,
      };
    },
  };
}

function normalizeInput(input: AgentInput): {
  input: string;
  context: RunContext;
  metadata?: JsonObject;
} {
  if (typeof input === "string") {
    return { input, context: {} };
  }
  return {
    input: input.input,
    context: input.context ?? {},
    metadata: input.metadata,
  };
}

function mergeUsage(target: Usage, source: Usage | undefined): void {
  if (!source) {
    return;
  }
  target.inputTokens = (target.inputTokens ?? 0) + (source.inputTokens ?? 0);
  target.outputTokens = (target.outputTokens ?? 0) + (source.outputTokens ?? 0);
  target.totalTokens = (target.totalTokens ?? 0) + (source.totalTokens ?? 0);
  target.latencyMs = (target.latencyMs ?? 0) + (source.latencyMs ?? 0);
}
