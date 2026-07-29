import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig, DEFAULT_CONFIG } from "../src/config.js";

test("loadConfig uses defaults when project config is absent", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "cco-config-"));
  const config = await loadConfig(cwd);
  assert.equal(config.claudeCommand, DEFAULT_CONFIG.claudeCommand);
  assert.equal(config.cwd, cwd);
});

test("loadConfig merges project overrides", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "cco-config-"));
  await fs.writeFile(path.join(cwd, ".codex-claude.json"), JSON.stringify({ maxConcurrentNodes: 4 }));
  const config = await loadConfig(cwd);
  assert.equal(config.maxConcurrentNodes, 4);
  assert.equal(config.claudeCommand, "claude");
});

test("loadConfig rejects unsafe state paths and invalid concurrency", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "cco-config-"));
  await fs.writeFile(path.join(cwd, ".codex-claude.json"), JSON.stringify({ stateFile: "../state.json", maxConcurrentNodes: 0 }));
  await assert.rejects(loadConfig(cwd), /配置无效/);
});
