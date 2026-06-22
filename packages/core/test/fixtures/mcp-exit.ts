import { createInterface } from "node:readline";

const lines = createInterface({ input: process.stdin });

lines.on("line", () => {
  process.stderr.write("fatal: connection lost\n");
  process.exit(7);
});
