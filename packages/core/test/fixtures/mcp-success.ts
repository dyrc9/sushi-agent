import { createInterface } from "node:readline";

const lines = createInterface({ input: process.stdin });

lines.on("line", (line) => {
  const message = JSON.parse(line) as {
    id: number;
    method: string;
    params?: unknown;
  };

  process.stdout.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        method: message.method,
        params: message.params ?? null,
      },
    })}\n`,
  );
});
