import assert from "node:assert/strict";
import test from "node:test";

test("placeholder keeps cli test target wired", () => {
  assert.equal("sushi-agent".includes("sushi"), true);
});
