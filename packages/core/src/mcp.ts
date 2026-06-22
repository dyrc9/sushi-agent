import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import type { JsonObject, JsonValue } from "./types.js";

export interface McpStdioClientOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface McpClient {
  request(method: string, params?: JsonObject): Promise<JsonValue>;
  close(): void;
}

export function createMcpStdioClient(
  options: McpStdioClientOptions,
): McpClient {
  let nextId = 1;
  const stderrBuffer = createStderrBuffer();
  const pending = new Map<
    number,
    {
      resolve(value: JsonValue): void;
      reject(error: Error): void;
    }
  >();

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
    request(method, params) {
      const id = nextId;
      nextId += 1;
      const payload = {
        jsonrpc: "2.0",
        id,
        method,
        params: params ?? {},
      };

      return new Promise<JsonValue>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        child.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
          if (error) {
            pending.delete(id);
            reject(error);
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
  pending: Map<
    number,
    { resolve(value: JsonValue): void; reject(error: Error): void }
  >,
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
    const waiter = pending.get(message.id);
    if (!waiter) {
      return;
    }
    pending.delete(message.id);
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
  pending: Map<
    number,
    { resolve(value: JsonValue): void; reject(error: Error): void }
  >,
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
  pending: Map<
    number,
    { resolve(value: JsonValue): void; reject(error: Error): void }
  >,
  error: Error,
): void {
  for (const waiter of pending.values()) {
    waiter.reject(error);
  }
  pending.clear();
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
