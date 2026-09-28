import { createInterface } from "node:readline";

const cancelledRequestIds: number[] = [];
const lines = createInterface({ input: process.stdin });

lines.on("line", (line) => {
  const message = JSON.parse(line) as {
    id?: number;
    method: string;
    params?: { requestId?: number };
  };

  if (message.method === "notifications/cancelled") {
    if (typeof message.params?.requestId === "number") {
      cancelledRequestIds.push(message.params.requestId);
    }
    return;
  }

  if (message.method === "wait") {
    return;
  }

  process.stdout.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: message.id,
      result: { cancelledRequestIds },
    })}\n`,
  );
});
