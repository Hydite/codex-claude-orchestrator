import test from "node:test";
import assert from "node:assert/strict";
import { ClaudeRuntime, findClaudeProcessError } from "../src/claude-runtime.js";

test("detects Claude API failures that still exit with code zero", () => {
  const output = `${JSON.stringify({ type: "system", subtype: "init" })}\n${JSON.stringify({ type: "result", is_error: true, api_error_status: 403, result: "Failed to authenticate" })}\n`;
  assert.equal(findClaudeProcessError(output), "Failed to authenticate");
  assert.equal(findClaudeProcessError('{"type":"result","is_error":false,"result":"ok"}\n'), null);
});

test("buildArgs applies node-level tool and model orchestration", () => {
  const runtime = new ClaudeRuntime({ claudeArgs: ["-p", "{prompt}"] }, {});
  assert.deepEqual(runtime.buildArgs("goal", { tools: ["Read", "Edit"], model: "sonnet" }), ["-p", "goal", "--allowedTools", "Read,Edit", "--model", "sonnet"]);
});
