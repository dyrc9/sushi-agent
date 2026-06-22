import { createInterface } from "node:readline";

const lines = createInterface({ input: process.stdin });

lines.on("line", () => {
  process.stderr.write("protocol panic\n");
  process.stdout.write("not json\n");
});
