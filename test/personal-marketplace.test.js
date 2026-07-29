import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installPersonal, personalStatus, uninstallPersonal } from "../scripts/lib/personal-marketplace.mjs";
import { PLUGIN_NAME, readJson, writeJsonAtomic } from "../scripts/lib/distribution.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("personal installer preserves marketplace metadata and supports update/uninstall", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "cco-personal-"));
  const marketplaceFile = path.join(home, ".agents/plugins/marketplace.json");
  await writeJsonAtomic(marketplaceFile, {
    name: "personal",
    interface: { displayName: "My Personal Plugins" },
    plugins: [{ name: "existing", source: { source: "local", path: "./plugins/existing" }, policy: { installation: "AVAILABLE", authentication: "ON_USE" }, category: "Productivity" }]
  });
  const installed = await installPersonal({ repoRoot, home, register: false });
  assert.equal(installed.marketplaceName, "personal");
  let marketplace = await readJson(marketplaceFile);
  assert.equal(marketplace.interface.displayName, "My Personal Plugins");
  assert.deepEqual(marketplace.plugins.map((plugin) => plugin.name), ["existing", PLUGIN_NAME]);
  let status = await personalStatus({ home });
  assert.equal(status.installed, true);
  assert.equal(status.listed, true);
  assert.equal(status.version, "0.3.1");

  await installPersonal({ repoRoot, home, register: false, update: true });
  status = await personalStatus({ home });
  assert.match(status.version, /^0\.3\.1\+codex\.local-/);

  await uninstallPersonal({ home, register: false });
  status = await personalStatus({ home });
  assert.equal(status.installed, false);
  assert.equal(status.listed, false);
  marketplace = await readJson(marketplaceFile);
  assert.deepEqual(marketplace.plugins.map((plugin) => plugin.name), ["existing"]);
});
