import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import type { JsonObject, JsonValue } from "./types.js";

export interface McpStdioClientOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface McpRequestOptions {
  signal?: AbortSignal;
}

export interface McpClient {
  request(
    method: string,
    params?: JsonObject,
    options?: McpRequestOptions,
  ): Promise<JsonValue>;
  close(): void;
}

interface PendingRequest {
  resolve(value: JsonValue): void;
  reject(reason?: unknown): void;
  cleanup(): void;
}

export function createMcpStdioClient(
  options: McpStdioClientOptions,
): McpClient {
  let nextId = 1;
  const stderrBuffer = createStderrBuffer();
  const pending = new Map<number, PendingRequest>();

  const child = spawn(options.command, options.args ?? [], {
    cwd: options.cwd,
    env: options.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lines = createInterface({ input: child.stdout });

  attachStderrHandler(child, stderrBuffer);
  attachLineHandler(lines, child, pending, stderrBuffer);
  attachExitHandler(child, pending, stderrBuffer);

  return {
    request(method, params, requestOptions) {
      const signal = requestOptions?.signal;
      if (signal?.aborted) {
        return Promise.reject(signal.reason);
      }

      const id = nextId;
      nextId += 1;
      const payload = {
        jsonrpc: "2.0",
        id,
        method,
        params: params ?? {},
      };

      return new Promise<JsonValue>((resolve, reject) => {
        const onAbort = () => {
          const waiter = takePending(pending, id);
          if (!waiter) {
            return;
          }
          sendCancellation(child, id, signal?.reason);
          waiter.reject(signal?.reason);
        };
        pending.set(id, {
          resolve,
          reject,
          cleanup: () => signal?.removeEventListener("abort", onAbort),
        });
        signal?.addEventListener("abort", onAbort, { once: true });

        child.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
          if (error) {
            takePending(pending, id)?.reject(error);
          }
        });
      });
    },
    close() {
      lines.close();
      child.kill();
    },
  };
}

function attachLineHandler(
  lines: Interface,
  child: ChildProcessWithoutNullStreams,
  pending: Map<number, PendingRequest>,
  stderrBuffer: ReturnType<typeof createStderrBuffer>,
): void {
  lines.on("line", (line) => {
    let message: {
      id?: number;
      result?: JsonValue;
      error?: { message?: string };
    };
    try {
      message = JSON.parse(line) as {
        id?: number;
        result?: JsonValue;
        error?: { message?: string };
      };
    } catch (error) {
      rejectPending(
        pending,
        formatProtocolError(
          "MCP process emitted invalid JSON",
          stderrBuffer,
          error,
          line,
        ),
      );
      child.kill();
      return;
    }
    if (typeof message.id !== "number") {
      return;
    }
    const waiter = takePending(pending, message.id);
    if (!waiter) {
      return;
    }
    if (message.error) {
      waiter.reject(new Error(message.error.message ?? "MCP request failed"));
      return;
    }
    waiter.resolve(message.result ?? null);
  });
}

function attachStderrHandler(
  child: ChildProcessWithoutNullStreams,
  stderrBuffer: ReturnType<typeof createStderrBuffer>,
): void {
  child.stderr.on("data", (chunk: string | Buffer) => {
    stderrBuffer.push(String(chunk));
  });
}

function attachExitHandler(
  child: ChildProcessWithoutNullStreams,
  pending: Map<number, PendingRequest>,
  stderrBuffer: ReturnType<typeof createStderrBuffer>,
): void {
  child.once("exit", (code, signal) => {
    rejectPending(
      pending,
      new Error(
        `MCP process exited: code=${code ?? "none"} signal=${
          signal ?? "none"
        }${formatStderrSuffix(stderrBuffer)}`,
      ),
    );
  });
  child.once("error", (error) => {
    rejectPending(
      pending,
      new Error(
        `MCP process failed to start: ${error.message}${formatStderrSuffix(
          stderrBuffer,
        )}`,
      ),
    );
  });
}

function rejectPending(
  pending: Map<number, PendingRequest>,
  error: Error,
): void {
  for (const waiter of pending.values()) {
    waiter.cleanup();
    waiter.reject(error);
  }
  pending.clear();
}

function takePending(
  pending: Map<number, PendingRequest>,
  id: number,
): PendingRequest | undefined {
  const waiter = pending.get(id);
  if (waiter) {
    pending.delete(id);
    waiter.cleanup();
  }
  return waiter;
}

function sendCancellation(
  child: ChildProcessWithoutNullStreams,
  requestId: number,
  reason: unknown,
): void {
  if (!child.stdin.writable) {
    return;
  }
  const payload = {
    jsonrpc: "2.0",
    method: "notifications/cancelled",
    params: {
      requestId,
      reason: reason instanceof Error ? reason.message : String(reason),
    },
  };
  child.stdin.write(`${JSON.stringify(payload)}\n`, () => {});
}

function createStderrBuffer(limit = 4000) {
  let content = "";
  return {
    push(chunk: string) {
      content += chunk;
      if (content.length > limit) {
        content = content.slice(-limit);
      }
    },
    read() {
      return content.trim();
    },
  };
}

function formatProtocolError(
  message: string,
  stderrBuffer: ReturnType<typeof createStderrBuffer>,
  error: unknown,
  line: string,
): Error {
  const reason = error instanceof Error ? error.message : String(error);
  return new Error(
    `${message}: ${reason}; line=${JSON.stringify(line)}${formatStderrSuffix(
      stderrBuffer,
    )}`,
  );
}

function formatStderrSuffix(
  stderrBuffer: ReturnType<typeof createStderrBuffer>,
): string {
  const stderr = stderrBuffer.read();
  return stderr ? `; stderr=${JSON.stringify(stderr)}` : "";
}
