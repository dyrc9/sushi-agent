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

  attachLineHandler(lines, pending);
  attachExitHandler(child, pending);

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
  pending: Map<
    number,
    { resolve(value: JsonValue): void; reject(error: Error): void }
  >,
): void {
  lines.on("line", (line) => {
    const message = JSON.parse(line) as {
      id?: number;
      result?: JsonValue;
      error?: { message?: string };
    };
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

function attachExitHandler(
  child: ChildProcessWithoutNullStreams,
  pending: Map<
    number,
    { resolve(value: JsonValue): void; reject(error: Error): void }
  >,
): void {
  child.once("exit", (code, signal) => {
    const error = new Error(
      `MCP process exited: code=${code ?? "none"} signal=${signal ?? "none"}`,
    );
    for (const waiter of pending.values()) {
      waiter.reject(error);
    }
    pending.clear();
  });
}
