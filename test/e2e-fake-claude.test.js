import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Orchestrator } from "../src/orchestrator.js";
import { DEFAULT_CONFIG } from "../src/config.js";
const exec = promisify(execFile);

async function waitFor(predicate, timeout = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error("timed out waiting for fake Claude node");
}

test("fake Claude node runs in worktree, validates, commits, and merges", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "cco-e2e-repo-"));
  const fakeDir = await fs.mkdtemp(path.join(os.tmpdir(), "cco-fake-claude-"));
  const fake = path.join(fakeDir, "claude");
  const claudeSettingsPath = path.join(fakeDir, "settings.json");
  await fs.mkdir(path.join(cwd, "src"));
  await fs.writeFile(path.join(cwd, "src/base.txt"), "base\n");
  await fs.writeFile(path.join(cwd, ".gitignore"), ".cco/\n");
  await fs.writeFile(claudeSettingsPath, JSON.stringify({ env: { ANTHROPIC_BASE_URL: "https://fake-gateway.example.test", ANTHROPIC_AUTH_TOKEN: "fake-gateway-secret" } }));
  await fs.writeFile(fake, `#!/usr/bin/env node\nconst fs = require("node:fs");\nif (process.argv[2] === "--version") { console.log("fake-claude 1.0"); process.exit(0); }\nif (process.argv[2] === "auth") { console.log(JSON.stringify({ loggedIn: true, authMethod: "test" })); process.exit(0); }\nfs.writeFileSync("src/generated.txt", "generated via " + process.env.ANTHROPIC_BASE_URL + "\\n");\nprocess.exit(0);\n`);
  await fs.chmod(fake, 0o755);
  await exec("git", ["init", "-b", "dev"], { cwd });
  await exec("git", ["config", "user.name", "Test"], { cwd });
  await exec("git", ["config", "user.email", "test@example.com"], { cwd });
  await exec("git", ["add", "."], { cwd });
  await exec("git", ["commit", "-m", "initial"], { cwd });

  const orchestrator = new Orchestrator({ ...DEFAULT_CONFIG, cwd, claudeCommand: fake, claudeArgs: ["{prompt}"], claudeSettingsPath, worktreeRoot: ".cco/worktrees", stateFile: ".cco/state.json", validationCommands: ["git diff --check"], taskTimeoutMs: 10000 });
  const task = await orchestrator.createTask({ goal: "generate file", nodes: [{ title: "generate", goal: "create generated file", files: ["src/generated.txt"], agent: "claude" }] });
  await orchestrator.dispatchNode({ taskId: task.id, nodeId: task.nodes[0].id });
  const node = await waitFor(async () => {
    const state = await orchestrator.snapshot();
    const current = state.tasks[task.id].nodes[0];
    return current.status === "review" ? current : current.status === "failed" ? (() => { throw new Error(JSON.stringify(current)); })() : null;
  });
  assert.equal(node.validation.passed, true);
  assert.ok(node.validation.commit);
  const merged = await orchestrator.mergeNode({ taskId: task.id, nodeId: node.id });
  assert.equal(merged.merged, true);
  assert.equal(await fs.readFile(path.join(cwd, "src/generated.txt"), "utf8"), "generated via https://fake-gateway.example.test\n");
  assert.doesNotMatch(JSON.stringify((await orchestrator.snapshot()).events), /fake-gateway-secret/);
  await assert.rejects(fs.access(node.worktree));
  const branches = await exec("git", ["branch", "--list", node.branch], { cwd });
  assert.equal(branches.stdout.trim(), "");
});
