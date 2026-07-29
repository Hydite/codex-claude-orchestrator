import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildMarketplace, COMMUNITY_MARKETPLACE_NAME, PLUGIN_NAME, readJson } from "../scripts/lib/distribution.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("buildMarketplace creates an installable standard marketplace tree", async () => {
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cco-marketplace-"));
  const output = path.join(outputRoot, "generated");
  const result = await buildMarketplace({ repoRoot, outputRoot: output });
  assert.equal(result.marketplaceName, COMMUNITY_MARKETPLACE_NAME);
  const marketplace = await readJson(path.join(output, ".agents/plugins/marketplace.json"));
  assert.equal(marketplace.plugins[0].source.path, `./plugins/${PLUGIN_NAME}`);
  const manifest = await readJson(path.join(output, "plugins", PLUGIN_NAME, ".codex-plugin/plugin.json"));
  assert.equal(manifest.name, PLUGIN_NAME);
  await fs.access(path.join(output, "plugins", PLUGIN_NAME, "src/mcp-server.js"));
  for (const readme of ["README.md", "README.zh-CN.md", "README.ja.md", "README.ko.md"]) {
    await fs.access(path.join(output, "plugins", PLUGIN_NAME, readme));
  }
  await fs.access(path.join(output, "plugins", PLUGIN_NAME, "docs/images/dashboard-board.jpg"));
  await fs.access(path.join(output, "plugins", PLUGIN_NAME, "docs/images/dashboard-running.jpg"));
  await fs.access(path.join(output, "plugins", PLUGIN_NAME, "docs/images/dashboard-blocked.jpg"));
  await fs.access(path.join(output, "plugins", PLUGIN_NAME, "docs/images/dashboard-ready.jpg"));
  await assert.rejects(fs.access(path.join(output, "plugins", PLUGIN_NAME, "test")));
  await assert.rejects(fs.access(path.join(output, "plugins", PLUGIN_NAME, "node_modules")));
});

test("official build includes submission metadata and standard plugin path", async () => {
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cco-official-"));
  const output = path.join(outputRoot, "generated");
  await buildMarketplace({ repoRoot, outputRoot: output, mode: "official" });
  const entry = await readJson(path.join(output, "marketplace-entry.json"));
  assert.equal(entry.name, PLUGIN_NAME);
  const apiEntry = await readJson(path.join(output, "api-marketplace-entry.json"));
  assert.equal(apiEntry.name, PLUGIN_NAME);
  const apiMarketplace = await readJson(path.join(output, ".agents/plugins/api_marketplace.json"));
  assert.equal(apiMarketplace.plugins[0].name, PLUGIN_NAME);
  await fs.access(path.join(output, "SUBMISSION.md"));
  await fs.access(path.join(output, "plugins", PLUGIN_NAME, ".codex-plugin/plugin.json"));
});
