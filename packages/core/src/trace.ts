import type { JsonObject, Usage } from "./types.js";

export type TraceEventType =
  | "agent.start"
  | "model.request"
  | "model.response"
  | "tool.start"
  | "tool.end"
  | "tool.error"
  | "agent.end";

export interface TraceEvent {
  type: TraceEventType;
  at: string;
  data?: JsonObject;
  usage?: Usage;
}

export interface TraceSink {
  record(event: TraceEvent): void | Promise<void>;
}

export class MemoryTraceSink implements TraceSink {
  readonly events: TraceEvent[] = [];

  record(event: TraceEvent): void {
    this.events.push(event);
  }
}

export function createTraceEvent(
  type: TraceEventType,
  data?: JsonObject,
  usage?: Usage,
): TraceEvent {
  return {
    type,
    at: new Date().toISOString(),
    data,
    usage,
  };
}
