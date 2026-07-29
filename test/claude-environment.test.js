import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveClaudeEnvironment } from "../src/claude-environment.js";

test("auto mode prefers Claude settings gateway and removes competing process credentials", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cco-gateway-"));
  const settingsPath = path.join(directory, "settings.json");
  await fs.writeFile(settingsPath, JSON.stringify({ env: { ANTHROPIC_BASE_URL: "https://gateway.example.test/v1", ANTHROPIC_AUTH_TOKEN: "gateway-secret", API_TIMEOUT_MS: "90000" } }));
  const result = await resolveClaudeEnvironment({ claudeEnvironmentSource: "auto", claudeSettingsPath: settingsPath }, { PATH: "/bin", ANTHROPIC_API_KEY: "oauth-competing-key" });
  assert.equal(result.environment.ANTHROPIC_BASE_URL, "https://gateway.example.test/v1");
  assert.equal(result.environment.ANTHROPIC_AUTH_TOKEN, "gateway-secret");
  assert.equal(result.environment.ANTHROPIC_API_KEY, undefined);
  assert.equal(result.info.source, "claude-settings");
  assert.equal(result.info.gatewayReady, true);
  assert.equal(result.info.baseUrlOrigin, "https://gateway.example.test");
  assert.doesNotMatch(JSON.stringify(result.info), /gateway-secret|oauth-competing-key/);
});

test("process mode ignores Claude settings gateway", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cco-gateway-"));
  const settingsPath = path.join(directory, "settings.json");
  await fs.writeFile(settingsPath, JSON.stringify({ env: { ANTHROPIC_BASE_URL: "https://settings.example.test", ANTHROPIC_AUTH_TOKEN: "settings-secret" } }));
  const result = await resolveClaudeEnvironment({ claudeEnvironmentSource: "process", claudeSettingsPath: settingsPath }, { ANTHROPIC_BASE_URL: "https://process.example.test", ANTHROPIC_API_KEY: "process-secret" });
  assert.equal(result.environment.ANTHROPIC_BASE_URL, "https://process.example.test");
  assert.equal(result.environment.ANTHROPIC_API_KEY, "process-secret");
  assert.equal(result.info.source, "process");
});
